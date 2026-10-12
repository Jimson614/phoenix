import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import { MockWechatAuthProvider } from '../src/auth/wechat-auth-provider'
import { AuthService } from '../src/services/auth-service'
import { ProfileService } from '../src/services/profile-service'
import { AssessmentService } from '../src/services/assessment-service'
import { OrderService } from '../src/services/order-service'
import { ReportService } from '../src/services/report-service'
import { MastersService } from '../src/services/masters-service'
import { MastersHttp } from '../src/masters/http'
import { MastersWorkbenchAuth, WORKBENCH_LOGIN_CODE_TTL_MS } from '../src/masters/workbench-auth'
import { PrivateFiles } from '../src/masters/private-files'
import { MockPaymentProvider } from '../src/payments/mock-payment-provider'
import { validateSourceCatalog } from '../src/domain/source-catalog'
import { createAppServer } from '../src/http/app'
import { FileStore } from '../src/store/file-store'

// Staff reach the web workbench with a one-time code issued in the Mini Program instead of pasting a
// raw session token, and founders grant roles with a code the person issues for themselves.
const secret = 'masters-workbench-fictional-test-session-secret-only'
const catalog = validateSourceCatalog({ version: 'MASTERS-SYNTHETIC-TEST', dataAsOf: '2026-09-05', reviewedAt: '2026-09-05T00:00:00.000Z', reviewedBy: 'Synthetic fixture', entries: [{ sourceId: 'SYNTHETIC-TEST', title: 'Synthetic source', applicableYear: '2026', verifiedAt: '2026-09-05T00:00:00.000Z' }] })

async function start(directory: string) {
  const store = await FileStore.open(join(directory, 'database.json'))
  const files = new PrivateFiles(join(directory, 'private'))
  await files.initialize()
  const service = new MastersService(store)
  let now = new Date('2026-10-12T02:00:00.000Z')
  const clock = () => now
  const workbench = new MastersWorkbenchAuth(store, secret, clock)
  const auth = new AuthService(store, new MockWechatAuthProvider(), secret)
  const server = createAppServer({ auth, profiles: new ProfileService(store), assessments: new AssessmentService(store, catalog), orders: new OrderService(store, new MockPaymentProvider(secret), catalog, false), reports: new ReportService(store), masters: new MastersHttp(service, files, store, '', workbench) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = async (path: string, token = '', method = 'GET', body?: unknown): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', 'Idempotency-Key': `wb-${Math.random().toString(36).slice(2)}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json().catch(() => ({})) }
  }
  const login = async (code: string) => (await call('/v1/auth/wechat/session', '', 'POST', { code })).body
  return { store, workbench, base, call, login, advance: (ms: number) => { now = new Date(now.getTime() + ms) }, close: () => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) }
}

test('one-time workbench codes: founder bootstrap, role grants by enrolment code, login, expiry and logout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'masters-workbench-auth-'))
  const app = await start(dir)
  try {
    const founder = await app.login('synthetic-workbench-founder')
    const advisor = await app.login('synthetic-workbench-advisor')
    const outsider = await app.login('synthetic-workbench-outsider')

    // Nobody is staff yet: status says so and a login code is refused.
    assert.deepEqual((await app.call('/v1/masters/workbench/status', founder.accessToken)).body.staff, null)
    assert.equal((await app.call('/v1/masters/workbench/login-code', founder.accessToken, 'POST', {})).status, 403)

    // The first founder comes from the server-side bootstrap with the person's own enrolment code.
    const founderEnrol = await app.call('/v1/masters/workbench/enroll-code', founder.accessToken, 'POST', {})
    assert.equal(founderEnrol.status, 201)
    assert.match(founderEnrol.body.code, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/, 'codes avoid 0/O/1/I/L and are grouped for reading aloud')
    const bootstrapped = await app.workbench.bootstrapFounder(founderEnrol.body.code)
    assert.equal(bootstrapped.role, 'founder')
    assert.equal(bootstrapped.userId, founder.user.id)
    await assert.rejects(() => app.workbench.bootstrapFounder(founderEnrol.body.code), /无效|过期|Founder/, 'a second bootstrap is refused')
    const secondFounderCode = (await app.call('/v1/masters/workbench/enroll-code', outsider.accessToken, 'POST', {})).body.code
    await assert.rejects(() => app.workbench.bootstrapFounder(secondFounderCode), /已有/, 'bootstrap only runs while no founder exists')

    // A code is never a session token, raw or with its purpose prefix.
    const loginCode = await app.call('/v1/masters/workbench/login-code', founder.accessToken, 'POST', {})
    assert.equal(loginCode.status, 201)
    assert.ok(Date.parse(loginCode.body.expiresAt) - Date.parse('2026-10-12T02:00:00.000Z') === WORKBENCH_LOGIN_CODE_TTL_MS)
    for (const attempt of [loginCode.body.code, loginCode.body.code.replace('-', ''), `login:${loginCode.body.code.replace('-', '')}`]) {
      assert.equal((await app.call('/v1/internal/masters/me', attempt)).status, 401, `code must not authenticate: ${attempt}`)
    }

    // Exchanging the code gives a workbench session; the same code cannot be used twice.
    const session = await app.call('/v1/internal/masters/workbench-session', '', 'POST', { code: loginCode.body.code.toLowerCase().replace('-', ' ') })
    assert.equal(session.status, 200)
    assert.equal(session.body.staff.role, 'founder')
    assert.equal((await app.call('/v1/internal/masters/me', session.body.accessToken)).body.staff.role, 'founder')
    assert.equal((await app.call('/v1/internal/masters/workbench-session', '', 'POST', { code: loginCode.body.code })).status, 401)

    // Founder grants a role with the advisor's own enrolment code; non-founders and self-grants are refused.
    const advisorEnrol = (await app.call('/v1/masters/workbench/enroll-code', advisor.accessToken, 'POST', {})).body.code
    const ownEnrol = (await app.call('/v1/masters/workbench/enroll-code', founder.accessToken, 'POST', {})).body.code
    assert.equal((await app.call('/v1/internal/masters/staff', session.body.accessToken, 'POST', { enrollCode: ownEnrol, role: 'advisor' })).status, 400)
    const granted = await app.call('/v1/internal/masters/staff', session.body.accessToken, 'POST', { enrollCode: advisorEnrol, role: 'advisor' })
    assert.equal(granted.status, 201)
    assert.equal(granted.body.staff.role, 'advisor')
    assert.equal(granted.body.staff.grantedBy, founder.user.id)
    assert.equal((await app.call('/v1/internal/masters/staff', session.body.accessToken, 'POST', { enrollCode: advisorEnrol, role: 'advisor' })).status, 401, 'an enrolment code is used once')
    assert.deepEqual((await app.call('/v1/masters/workbench/status', advisor.accessToken)).body.staff, { role: 'advisor', status: 'ACTIVE' })
    const listed = await app.call('/v1/internal/masters/staff', session.body.accessToken)
    assert.deepEqual(listed.body.staff.map((row: { role: string }) => row.role).sort(), ['advisor', 'founder'])

    const advisorLogin = (await app.call('/v1/masters/workbench/login-code', advisor.accessToken, 'POST', {})).body.code
    const advisorSession = (await app.call('/v1/internal/masters/workbench-session', '', 'POST', { code: advisorLogin })).body
    assert.equal(advisorSession.staff.role, 'advisor')
    const outsiderEnrol = (await app.call('/v1/masters/workbench/enroll-code', outsider.accessToken, 'POST', {})).body.code
    assert.equal((await app.call('/v1/internal/masters/staff', advisorSession.accessToken, 'POST', { enrollCode: outsiderEnrol, role: 'advisor' })).status, 403, 'only a founder grants roles')

    // An unused code expires; a suspended person can neither get nor use a login code.
    const stale = (await app.call('/v1/masters/workbench/login-code', advisor.accessToken, 'POST', {})).body.code
    app.advance(WORKBENCH_LOGIN_CODE_TTL_MS + 1000)
    assert.equal((await app.call('/v1/internal/masters/workbench-session', '', 'POST', { code: stale })).status, 401)
    const pending = (await app.call('/v1/masters/workbench/login-code', advisor.accessToken, 'POST', {})).body.code
    assert.equal((await app.call(`/v1/internal/masters/staff/${advisor.user.id}/suspend`, session.body.accessToken, 'POST', {})).status, 200)
    assert.equal((await app.call('/v1/internal/masters/workbench-session', '', 'POST', { code: pending })).status, 403)
    assert.equal((await app.call('/v1/masters/workbench/login-code', advisor.accessToken, 'POST', {})).status, 403)

    // Logging out revokes the workbench session at once.
    assert.equal((await app.call('/v1/auth/session', session.body.accessToken, 'DELETE')).status, 204)
    assert.equal((await app.call('/v1/internal/masters/me', session.body.accessToken)).status, 401)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('the unauthenticated code exchange is rate limited and rejects malformed codes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'masters-workbench-rate-'))
  const app = await start(dir)
  try {
    assert.equal((await app.call('/v1/internal/masters/workbench-session', '', 'POST', { code: 'not-a-code' })).status, 400)
    assert.equal((await app.call('/v1/internal/masters/workbench-session', '', 'POST', { code: 'ABCDE-FGHJK', extra: true })).status, 400)
    let limited = 0
    for (let attempt = 0; attempt < 35; attempt += 1) {
      const result = await app.call('/v1/internal/masters/workbench-session', '', 'POST', { code: 'ABCDE-FGHJK' })
      if (result.status === 429) limited += 1
      else assert.equal(result.status, 401)
    }
    assert.ok(limited > 0, 'repeated guesses must be rate limited')
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('the workbench page signs in with a login code, revokes the session on logout and lets a founder grant roles', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'masters-workbench-page-'))
  const app = await start(dir)
  try {
    const html = await (await fetch(`${app.base}/internal/masters`)).text()
    const js = await (await fetch(`${app.base}/internal/masters/app.js`)).text()
    for (const id of ['login-code', 'code-connect', 'token', 'connect', 'logout', 'staff-panel', 'enroll-code', 'staff-role', 'grant-staff', 'staff-list']) {
      assert.ok(html.includes(`id="${id}"`), `workbench page must contain #${id}`)
    }
    assert.ok(js.includes("'/v1/internal/masters/workbench-session'"), 'the page must exchange the login code without a bearer token')
    assert.ok(/fetch\('\/v1\/auth\/session',\s*\{method:'DELETE'/.test(js), 'logging out must revoke the server session')
    assert.ok(js.includes("api+'/staff'") && js.includes("'/suspend'"), 'a founder must be able to grant and suspend roles')
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
