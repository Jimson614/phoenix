import { randomInt } from 'node:crypto'
import { invariant } from '../domain/errors'
import { MastersStaff, MastersStaffRole } from '../domain/masters/contracts'
import { normalizeStaffRole } from '../domain/masters/validation'
import { Store, StoreTransaction } from '../store/store'
import { addMilliseconds, Clock, IdFactory, iso, randomId, randomToken, systemClock, tokenDigest } from '../utils/runtime'

// Staff open the web workbench with a short one-time code issued in the Mini Program, and founders
// grant roles with an enrolment code the person issues for themselves. Codes live in the sessions
// table (id prefix mwc_) with a hash keyed by a separate derived secret, so a code can never pass
// AuthService.authenticate and act as a session token.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O, 1/I/L
const CODE_LENGTH = 10 // about 49.5 bits; codes are short-lived and single use
const CODE_ID_PREFIX = 'mwc'
export const WORKBENCH_LOGIN_CODE_TTL_MS = 5 * 60_000
export const WORKBENCH_ENROLL_CODE_TTL_MS = 30 * 60_000
export const WORKBENCH_SESSION_TTL_MS = 8 * 60 * 60_000

export type WorkbenchCodePurpose = 'login' | 'enroll'

export function normalizeWorkbenchCode(raw: unknown): string {
  const code = typeof raw === 'string' ? raw.toUpperCase().replace(/[\s-]/g, '') : ''
  invariant(code.length === CODE_LENGTH && [...code].every((char) => CODE_ALPHABET.includes(char)), 400, 'MASTERS_WORKBENCH_CODE_FORMAT', '请输入 10 位登录码或申请码')
  return code
}

function formatCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

export class MastersWorkbenchAuth {
  constructor(
    private readonly store: Store,
    private readonly sessionSecret: string,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdFactory = randomId
  ) {
    invariant(sessionSecret.length >= 32, 500, 'SESSION_SECRET_INVALID', 'SESSION_SECRET 至少需要32个字符')
  }

  private codeHash(purpose: WorkbenchCodePurpose, code: string): string {
    return tokenDigest(`${purpose}:${code}`, `${this.sessionSecret}:masters-workbench-code`)
  }

  private async activeStaff(tx: StoreTransaction, userId: string): Promise<MastersStaff | null> {
    return tx.findOne('mastersStaff', { userId, status: 'ACTIVE' })
  }

  async status(userId: string): Promise<{ staff: { role: MastersStaffRole; status: string } | null }> {
    const staff = await this.store.read((tx) => tx.findOne('mastersStaff', { userId }))
    return { staff: staff ? { role: staff.role, status: staff.status } : null }
  }

  /** A login code needs an active staff grant; an enrolment code can be issued by anyone signed in. */
  async issueCode(userId: string, purpose: WorkbenchCodePurpose): Promise<{ code: string; expiresAt: string }> {
    const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
    const ttl = purpose === 'login' ? WORKBENCH_LOGIN_CODE_TTL_MS : WORKBENCH_ENROLL_CODE_TTL_MS
    const expiresAt = addMilliseconds(this.clock(), ttl)
    await this.store.transaction(async (tx) => {
      if (purpose === 'login') invariant(await this.activeStaff(tx, userId), 403, 'MASTERS_STAFF_REQUIRED', '未获工作台授权，请先请 Founder 授予角色')
      await tx.insert('sessions', { id: this.ids(CODE_ID_PREFIX), userId, tokenHash: this.codeHash(purpose, code), expiresAt, revokedAt: null, createdAt: iso(this.clock) })
    })
    return { code: formatCode(code), expiresAt }
  }

  /** Marks a code used and returns its owner. Unknown, used and expired codes look the same. */
  private async redeem(tx: StoreTransaction, purpose: WorkbenchCodePurpose, rawCode: unknown): Promise<string> {
    const code = normalizeWorkbenchCode(rawCode)
    const row = await tx.findOne('sessions', { tokenHash: this.codeHash(purpose, code) }, { forUpdate: true })
    const valid = row && row.id.startsWith(`${CODE_ID_PREFIX}_`) && !row.revokedAt && new Date(row.expiresAt).getTime() > this.clock().getTime()
    invariant(valid, 401, 'MASTERS_WORKBENCH_CODE_INVALID', purpose === 'login' ? '登录码无效、已使用或已过期，请在小程序重新生成' : '申请码无效、已使用或已过期，请对方重新生成')
    await tx.update('sessions', row!.id, { revokedAt: iso(this.clock) })
    return row!.userId
  }

  async exchangeLoginCode(rawCode: unknown): Promise<{ accessToken: string; expiresAt: string; staff: { role: MastersStaffRole } }> {
    const code = normalizeWorkbenchCode(rawCode)
    const accessToken = randomToken()
    const expiresAt = addMilliseconds(this.clock(), WORKBENCH_SESSION_TTL_MS)
    const role = await this.store.transaction(async (tx) => {
      const userId = await this.redeem(tx, 'login', code)
      const staff = await this.activeStaff(tx, userId)
      invariant(staff, 403, 'MASTERS_STAFF_REQUIRED', '工作台授权已暂停或不存在')
      // An ordinary session row, so AuthService.authenticate and logout treat it like any other.
      await tx.insert('sessions', { id: this.ids('ses'), userId, tokenHash: tokenDigest(accessToken, this.sessionSecret), expiresAt, revokedAt: null, createdAt: iso(this.clock) })
      return staff.role
    })
    return { accessToken, expiresAt, staff: { role } }
  }

  async grantByEnrollCode(founderUserId: string, rawCode: unknown, rawRole: unknown): Promise<MastersStaff> {
    const role = normalizeStaffRole(rawRole)
    const code = normalizeWorkbenchCode(rawCode)
    return this.store.transaction(async (tx) => {
      const founder = await this.activeStaff(tx, founderUserId)
      invariant(founder?.role === 'founder', 403, 'MASTERS_FOUNDER_REQUIRED', '只有 Founder 可以授予工作台角色')
      const targetUserId = await this.redeem(tx, 'enroll', code)
      invariant(targetUserId !== founderUserId, 400, 'MASTERS_STAFF_SELF_GRANT', '不能给自己授予角色')
      return this.upsertStaff(tx, targetUserId, role, founderUserId)
    })
  }

  /** Server-side only (scripts/masters-grant-first-founder.js): works while no active founder exists. */
  async bootstrapFounder(rawCode: unknown): Promise<MastersStaff> {
    const code = normalizeWorkbenchCode(rawCode)
    return this.store.transaction(async (tx) => {
      invariant(!(await tx.findOne('mastersStaff', { role: 'founder', status: 'ACTIVE' })), 409, 'MASTERS_FOUNDER_EXISTS', '已有 Founder，请由 Founder 在工作台授予角色')
      const userId = await this.redeem(tx, 'enroll', code)
      return this.upsertStaff(tx, userId, 'founder', null)
    })
  }

  async listStaff(founderUserId: string): Promise<MastersStaff[]> {
    return this.store.read(async (tx) => {
      const founder = await this.activeStaff(tx, founderUserId)
      invariant(founder?.role === 'founder', 403, 'MASTERS_FOUNDER_REQUIRED', '只有 Founder 可以查看工作人员')
      return (await tx.findMany('mastersStaff')).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    })
  }

  private async upsertStaff(tx: StoreTransaction, userId: string, role: MastersStaffRole, grantedBy: string | null): Promise<MastersStaff> {
    const now = iso(this.clock)
    const current = await tx.findOne('mastersStaff', { userId }, { forUpdate: true })
    if (current) return tx.update('mastersStaff', current.id, { role, status: 'ACTIVE', grantedBy, updatedAt: now })
    return tx.insert('mastersStaff', { id: this.ids('mstf'), userId, role, status: 'ACTIVE', grantedBy, createdAt: now, updatedAt: now })
  }
}
