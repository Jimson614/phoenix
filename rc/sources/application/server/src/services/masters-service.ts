import { createHash } from 'node:crypto'
import { canonicalJson } from '../ai/crypto'
import { AppError, invariant } from '../domain/errors'
import { assertReportSources } from '../masters/report-assistance'
import {
  MASTERS_CONTRACT_VERSION,
  MASTERS_REPORT_TEMPLATE_VERSION,
  MASTERS_SERVICE_CONSENT_VERSION,
  mastersConsentCopy,
  MastersAddDocumentInput,
  MastersAssignment,
  MastersAuditLog,
  MastersClaimJobOptions,
  MastersConfirmInput,
  MastersConsent,
  MastersConsultation,
  MastersConsultationDetail,
  MastersCreateInput,
  MastersDocument,
  MastersDocumentExtraction,
  MastersDocumentType,
  MastersDocumentTypeAlias,
  MastersExtractionResolutionInput,
  MastersIdempotencyDomain,
  MastersIdempotencyRecord,
  MastersInternalConsultationDetail,
  MastersPatchInput,
  MastersProfile,
  MastersReport,
  MastersReportDecisionInput,
  MastersReportEditInput,
  MastersReportJob,
  MastersReportPayload,
  MastersReportReviewInput,
  MastersRequestDocumentsInput,
  MastersServiceConsentInput,
  MastersSnapshot,
  MastersStaff,
  MastersStaffRole
} from '../domain/masters/contracts'
import {
  calculateReadiness,
  exactReportPatch,
  hashText,
  mergeProfile,
  normalizeDocumentType,
  normalizeStaffRole,
  parseServiceConsent,
  reportTemplate,
  requiredFields,
  validateAddDocumentInput,
  validateConfirmInput,
  validateCreateInput,
  validateExtraction,
  validatePatchInput,
  validateProfileDraft
} from '../domain/masters/validation'
import { EntityMap } from '../domain/model'
import { Store, StoreTransaction } from '../store/store'
import { Clock, IdFactory, iso, randomId, systemClock } from '../utils/runtime'

export interface MastersServiceOptions {
  leaseMs?: number
  maxAttempts?: number
  retentionDays?: number
}

type DetailResult = MastersConsultationDetail | MastersInternalConsultationDetail
type RecordValue = Record<string, unknown>

const DEFAULT_LEASE_MS = 5 * 60 * 1000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_RETENTION_DAYS = 30
const MAX_DOCUMENTS_PER_CONSULTATION = 20

/** Fields that a student may explicitly accept from a document extraction.
 * Identity, contact, adult confirmation and education status stay manual so a
 * parser can never silently alter access or submission eligibility. */
const EXTRACTION_PROFILE_FIELDS = new Set([
  'name', 'institution', 'degree', 'major', 'graduationYear', 'graduationDate',
  'averageScore', 'gpa', 'gpaScale', 'classRank', 'languageStatus', 'languageType',
  'languageScores', 'targetYear', 'targetMajors', 'targetInstitutions', 'targetPreference'
])

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function stringKey(value: unknown, field: string): string {
  invariant(typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value), 400, 'IDEMPOTENCY_KEY_INVALID', `${field} 无效`)
  return value
}

function nowDate(clock: Clock): Date {
  return clock()
}

function dateAfter(clock: Clock, milliseconds: number): string {
  return new Date(clock().getTime() + milliseconds).toISOString()
}

function isObject(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmpty(value: unknown, code: string, message: string, max = 2000): string {
  invariant(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 400, code, message)
  return value
}

function activeStatus(status: string): boolean {
  return status === 'UPLOADED'
}

export class MastersService {
  private readonly leaseMs: number
  private readonly maxAttempts: number
  private readonly retentionDays: number

  constructor(
    private readonly store: Store,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdFactory = randomId,
    options: MastersServiceOptions = {}
  ) {
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS
    invariant(Number.isInteger(this.leaseMs) && this.leaseMs >= 1_000 && this.leaseMs <= 60 * 60 * 1000, 500, 'MASTERS_LEASE_CONFIG_INVALID', '报告任务租约配置无效')
    invariant(Number.isInteger(this.maxAttempts) && this.maxAttempts >= 1 && this.maxAttempts <= 10, 500, 'MASTERS_RETRY_CONFIG_INVALID', '报告任务重试配置无效')
    invariant(Number.isInteger(this.retentionDays) && this.retentionDays >= 1 && this.retentionDays <= 90, 500, 'MASTERS_RETENTION_CONFIG_INVALID', '资料保留配置必须为 1 至 90 天')
  }

  /** Versioned contract metadata for the native client capability probe. */
  contract(): RecordValue {
    return {
      contractVersion: MASTERS_CONTRACT_VERSION,
      consentVersion: MASTERS_SERVICE_CONSENT_VERSION,
      serviceConsentText: mastersConsentCopy(this.retentionDays),
      reportTemplateVersion: MASTERS_REPORT_TEMPLATE_VERSION,
      maxDocumentBytes: 10 * 1024 * 1024,
      maxDocuments: MAX_DOCUMENTS_PER_CONSULTATION,
      retentionDays: this.retentionDays,
      aiEnabled: false
    }
  }

  async create(userId: string, rawInput: MastersCreateInput | unknown = {}, idempotencyKey?: string): Promise<DetailResult> {
    const input = validateCreateInput(rawInput)
    const season = input.targetYear ?? 'UNDECIDED'
    const key = idempotencyKey === undefined ? undefined : stringKey(idempotencyKey, 'Idempotency-Key')
    return this.store.transaction(async (tx) => {
      await this.requireUser(tx, userId, true)
      const idem = await this.beginIdempotency(tx, userId, 'CREATE', key, {
        targetYear: season, channel: input.channel ?? '', path: input.path ?? '', linkedStudentId: input.linkedStudentId ?? null,
        serviceConsent: Boolean(input.serviceConsent)
      })
      if (idem?.replay) {
        const existing = await tx.findById('mastersConsultations', idem.record.resourceId as string)
        invariant(existing, 500, 'IDEMPOTENCY_RESOURCE_MISSING', '幂等资源不存在')
        return this.detailTx(tx, existing, userId, false)
      }
      if (input.linkedStudentId) await this.assertLinkedStudent(tx, userId, input.linkedStudentId)
      const existing = await tx.findOne('mastersConsultations', { userId, applicationSeason: season }, { forUpdate: true })
      if (existing) {
        if (idem) await this.finishIdempotency(tx, idem.record.id, 'consultation', existing.id, 200)
        return this.detailTx(tx, existing, userId, false)
      }
      const now = iso(this.clock)
      const consultation = await tx.insert('mastersConsultations', {
        id: this.ids('mcs'), userId, linkedStudentId: input.linkedStudentId ?? null,
        applicationSeason: season, channel: input.channel ?? '', path: input.path ?? '', status: 'DRAFT',
        profile: {}, profileVersion: 1, accuracyConfirmed: false, serviceConsentId: null,
        confirmedSnapshotId: null, submittedAt: null, withdrawnAt: null, createdAt: now, updatedAt: now
      })
      if (input.serviceConsent) {
        const consent = await this.insertConsent(tx, userId, consultation, input.serviceConsent, now)
        await tx.update('mastersConsultations', consultation.id, { serviceConsentId: consent.id, updatedAt: now })
      }
      await this.audit(tx, userId, consultation.id, 'CONSULTATION_CREATED', { contractVersion: MASTERS_CONTRACT_VERSION, applicationSeason: season, path: input.path ?? '' }, now)
      if (idem) await this.finishIdempotency(tx, idem.record.id, 'consultation', consultation.id, 201)
      const current = await tx.findById('mastersConsultations', consultation.id)
      invariant(current, 500, 'CONSULTATION_CREATE_FAILED', '咨询创建失败')
      return this.detailTx(tx, current, userId, false)
    })
  }

  async list(userId: string): Promise<MastersConsultationDetail[]> {
    return this.store.read(async (tx) => {
      await this.requireUser(tx, userId)
      const consultations = await tx.findMany('mastersConsultations', { userId })
      consultations.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      return Promise.all(consultations.map((consultation) => this.detailTx(tx, consultation, userId, false))) as Promise<MastersConsultationDetail[]>
    })
  }

  async detail(userId: string, consultationId: string, internal = false): Promise<DetailResult> {
    return this.store.read(async (tx) => {
      const consultation = await tx.findById('mastersConsultations', consultationId)
      invariant(consultation, 404, 'MASTERS_CONSULTATION_NOT_FOUND', '咨询不存在')
      if (internal) {
        await this.requireInternalAccess(tx, userId, consultation, 'read')
      } else {
        invariant(consultation.userId === userId, 403, 'MASTERS_CONSULTATION_FORBIDDEN', '无权访问该咨询')
        this.assertNotWithdrawn(consultation)
      }
      return this.detailTx(tx, consultation, userId, internal)
    })
  }

  async grantConsent(userId: string, consultationId: string, rawInput: MastersServiceConsentInput | unknown = { accepted: true }, idempotencyKey?: string): Promise<MastersConsent> {
    const consentInput = parseServiceConsent(rawInput)
    invariant(consentInput, 400, 'MASTERS_CONSENT_REQUIRED', '必须明确同意咨询资料授权')
    const key = idempotencyKey === undefined ? undefined : stringKey(idempotencyKey, 'Idempotency-Key')
    return this.store.transaction(async (tx) => {
      const consultation = await this.ownedConsultation(tx, userId, consultationId, true)
      const idem = await this.beginIdempotency(tx, userId, 'CONSENT', key, { consultationId, consent: consentInput })
      if (idem?.replay) {
        const existing = await tx.findById('mastersConsents', idem.record.resourceId as string)
        invariant(existing, 500, 'IDEMPOTENCY_RESOURCE_MISSING', '幂等授权不存在')
        return existing
      }
      const current = await tx.findOne('mastersConsents', { consultationId, withdrawnAt: null }, { forUpdate: true })
      if (current) {
        invariant(current.copyVersion === MASTERS_SERVICE_CONSENT_VERSION && current.copyTextHash === hashText(mastersConsentCopy(this.retentionDays)), 409, 'MASTERS_CONSENT_VERSION_CONFLICT', '当前咨询已有不同版本的有效授权')
        if (idem) await this.finishIdempotency(tx, idem.record.id, 'consent', current.id, 200)
        return current
      }
      const now = iso(this.clock)
      const consent = await this.insertConsent(tx, userId, consultation, consentInput, now)
      await tx.update('mastersConsultations', consultation.id, { serviceConsentId: consent.id, updatedAt: now })
      await this.audit(tx, userId, consultation.id, 'SERVICE_CONSENT_GRANTED', { consentVersion: consent.copyVersion }, now)
      if (idem) await this.finishIdempotency(tx, idem.record.id, 'consent', consent.id, 201)
      return consent
    })
  }

  async patch(userId: string, consultationId: string, rawInput: MastersPatchInput | unknown): Promise<MastersConsultation> {
    const input = validatePatchInput(rawInput)
    return this.store.transaction(async (tx) => {
      await this.requireUser(tx, userId, true)
      const consultation = await this.ownedConsultation(tx, userId, consultationId, true)
      await this.requireActiveConsent(tx, consultation)
      invariant(consultation.profileVersion === input.version, 409, 'MASTERS_VERSION_CONFLICT', '资料已更新，请刷新后重试', { currentVersion: consultation.profileVersion })
      const nextProfile = mergeProfile(consultation.profile, input.profile)
      const season = nextProfile.targetYear || consultation.applicationSeason
      const existingSeason = await tx.findOne('mastersConsultations', { userId, applicationSeason: season })
      invariant(!existingSeason || existingSeason.id === consultation.id, 409, 'MASTERS_SEASON_CONFLICT', '该申请季已有咨询，请从我的咨询继续原记录')
      const nextVersion = consultation.profileVersion + 1
      const nextStatus = consultation.status === 'DRAFT' ? 'DRAFT' : 'NEEDS_INFO'
      const now = iso(this.clock)
      const updated = await tx.update('mastersConsultations', consultation.id, {
        profile: nextProfile, applicationSeason: season, profileVersion: nextVersion, accuracyConfirmed: false, confirmedSnapshotId: null,
        path: input.path ?? consultation.path, status: nextStatus, updatedAt: now
      })
      await this.markReportsStale(tx, consultation.id, now, 'PROFILE_CHANGED')
      await this.audit(tx, userId, consultation.id, 'PROFILE_UPDATED', { fromVersion: consultation.profileVersion, toVersion: nextVersion, fromPath: consultation.path, toPath: updated.path }, now)
      return updated
    })
  }

  async confirm(userId: string, consultationId: string, rawInput: MastersConfirmInput | unknown, idempotencyKey?: string): Promise<MastersSnapshot> {
    const input = validateConfirmInput(rawInput)
    const key = idempotencyKey === undefined ? undefined : stringKey(idempotencyKey, 'Idempotency-Key')
    return this.store.transaction(async (tx) => {
      const consultation = await this.ownedConsultation(tx, userId, consultationId, true)
      if (consultation.serviceConsentId) await this.requireActiveConsent(tx, consultation)
      else invariant(input.consent, 403, 'MASTERS_CONSENT_REQUIRED', '请先同意咨询资料授权')
      invariant(consultation.profileVersion === input.version, 409, 'MASTERS_VERSION_CONFLICT', '资料已更新，请刷新后重试', { currentVersion: consultation.profileVersion })
      const idem = await this.beginIdempotency(tx, userId, 'CONFIRM', key, { consultationId, version: input.version })
      if (idem?.replay) {
        const existing = await tx.findById('mastersSnapshots', idem.record.resourceId as string)
        invariant(existing, 500, 'IDEMPOTENCY_RESOURCE_MISSING', '幂等快照不存在')
        return existing
      }
      if (input.consent) {
        const active = await tx.findOne('mastersConsents', { consultationId, withdrawnAt: null }, { forUpdate: true })
        if (!active) {
          const now = iso(this.clock)
          const consent = await this.insertConsent(tx, userId, consultation, input.consent, now)
          await tx.update('mastersConsultations', consultation.id, { serviceConsentId: consent.id, updatedAt: now })
        }
      }
      let currentConsultation = await tx.findById('mastersConsultations', consultation.id, { forUpdate: true })
      invariant(currentConsultation, 500, 'MASTERS_CONSULTATION_NOT_FOUND', '咨询不存在')
      const activeConsent = await this.requireActiveConsent(tx, currentConsultation)
      await this.reconcileCrossDocumentConflicts(tx, currentConsultation.id, iso(this.clock))
      const documents = await this.activeDocuments(tx, currentConsultation.id)
      const conflicts = documents.some((document) => document.extraction?.conflicts?.some((conflict) => conflict.resolution === 'PENDING'))
      invariant(!conflicts, 409, 'MASTERS_EXTRACTION_CONFLICT', '提取字段存在待确认冲突，请逐项确认')
      const now = iso(this.clock)
      const existingSnapshot = await tx.findOne('mastersSnapshots', { consultationId: currentConsultation.id, profileVersion: currentConsultation.profileVersion }, { forUpdate: true })
      if (existingSnapshot) {
        await tx.update('mastersConsultations', currentConsultation.id, { accuracyConfirmed: true, serviceConsentId: activeConsent.id, confirmedSnapshotId: existingSnapshot.id, updatedAt: now })
        if (idem) await this.finishIdempotency(tx, idem.record.id, 'snapshot', existingSnapshot.id, 200)
        return existingSnapshot
      }
      const snapshot = await tx.insert('mastersSnapshots', {
        id: this.ids('mss'), consultationId: currentConsultation.id, userId, profileVersion: currentConsultation.profileVersion,
        profile: structuredClone(currentConsultation.profile), documentIds: documents.map((document) => document.id),
        accuracyConfirmed: true, confirmedBy: userId, confirmedAt: now, createdAt: now
      })
      await tx.update('mastersConsultations', consultation.id, { accuracyConfirmed: true, serviceConsentId: activeConsent.id, confirmedSnapshotId: snapshot.id, updatedAt: now })
      await this.audit(tx, userId, consultation.id, 'PROFILE_CONFIRMED', { version: consultation.profileVersion, snapshotId: snapshot.id }, now)
      if (idem) await this.finishIdempotency(tx, idem.record.id, 'snapshot', snapshot.id, 200)
      return snapshot
    })
  }

  async submit(userId: string, consultationId: string, rawInput: { version: number } | unknown, idempotencyKey?: string): Promise<MastersConsultation> {
    const version = isObject(rawInput) ? Number(rawInput.version) : Number(rawInput)
    invariant(Number.isInteger(version) && version >= 1, 400, 'MASTERS_VERSION_INVALID', '资料版本无效')
    if (isObject(rawInput)) {
      for (const key of Object.keys(rawInput)) invariant(key === 'version', 400, 'MASTERS_UNKNOWN_FIELD', `不支持字段: ${key}`)
    }
    const key = idempotencyKey === undefined ? undefined : stringKey(idempotencyKey, 'Idempotency-Key')
    return this.store.transaction(async (tx) => {
      const consultation = await this.ownedConsultation(tx, userId, consultationId, true)
      await this.requireActiveConsent(tx, consultation)
      const idem = await this.beginIdempotency(tx, userId, 'SUBMIT', key, { consultationId, version })
      if (idem?.replay) {
        const existing = await tx.findById('mastersConsultations', idem.record.resourceId as string)
        invariant(existing, 500, 'IDEMPOTENCY_RESOURCE_MISSING', '幂等咨询不存在')
        return existing
      }
      invariant(consultation.profileVersion === version, 409, 'MASTERS_VERSION_CONFLICT', '资料已更新，请刷新后重试', { currentVersion: consultation.profileVersion })
      invariant(consultation.profile.adultConfirmed === true, 409, 'MASTERS_ADULT_CONFIRMATION_REQUIRED', '成人申请人需要明确确认已满18岁；未成年人请走人工路径')
      invariant(consultation.accuracyConfirmed === true && consultation.confirmedSnapshotId, 409, 'MASTERS_CONFIRMATION_REQUIRED', '请先核对并确认资料')
      const required = await this.requiredFields(tx, consultation)
      invariant(required.length === 0, 409, 'MASTERS_REQUIRED_FIELDS_MISSING', '请补齐提交所需的基本资料', { fields: required })
      const snapshot = await tx.findById('mastersSnapshots', consultation.confirmedSnapshotId)
      invariant(snapshot?.profileVersion === consultation.profileVersion, 409, 'MASTERS_CONFIRMATION_STALE', '确认快照已过期，请重新确认')
      const now = iso(this.clock)
      const updated = await tx.update('mastersConsultations', consultation.id, { status: 'SUBMITTED', submittedAt: consultation.submittedAt ?? now, updatedAt: now })
      // Submission and queue insertion are one transaction.  A successful
      // consultation can therefore never be committed without a durable
      // report job (and repeated submits reuse the same snapshot job).
      await this.ensureReportJob(tx, updated, snapshot, userId)
      await this.audit(tx, userId, consultation.id, 'CONSULTATION_SUBMITTED', { version, snapshotId: snapshot.id }, now)
      if (idem) await this.finishIdempotency(tx, idem.record.id, 'consultation', consultation.id, 200)
      return updated
    })
  }

  async withdraw(userId: string, consultationId: string): Promise<MastersConsultation> {
    return this.store.transaction(async (tx) => {
      const consultation = await this.ownedConsultation(tx, userId, consultationId, true, true)
      if (consultation.status === 'WITHDRAWN' || consultation.withdrawnAt) return consultation
      const now = iso(this.clock)
      const updated = await tx.update('mastersConsultations', consultation.id, { status: 'WITHDRAWN', withdrawnAt: now, accuracyConfirmed: false, confirmedSnapshotId: null, updatedAt: now })
      const assignments = await tx.findMany('mastersAssignments', { consultationId: consultation.id })
      for (const assignment of assignments.filter((item) => item.status === 'ACTIVE')) {
        await tx.update('mastersAssignments', assignment.id, { status: 'ENDED', endedAt: now, updatedAt: now })
      }
      const jobs = await tx.findMany('mastersReportJobs', { consultationId: consultation.id })
      for (const job of jobs.filter((item) => item.status === 'QUEUED' || item.status === 'RUNNING' || item.status === 'FAILED')) {
        await tx.update('mastersReportJobs', job.id, { status: 'STALE', leaseToken: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
      }
      await this.markReportsStale(tx, consultation.id, now, 'CONSULTATION_WITHDRAWN')
      const consent = await tx.findOne('mastersConsents', { consultationId: consultation.id, withdrawnAt: null }, { forUpdate: true })
      if (consent) await tx.update('mastersConsents', consent.id, { withdrawnAt: now, updatedAt: now })
      await this.audit(tx, userId, consultation.id, 'CONSULTATION_WITHDRAWN', { retentionDays: this.retentionDays }, now)
      return updated
    })
  }

  async addDocument(userId: string, consultationId: string, rawInput: MastersAddDocumentInput | unknown, idempotencyKey?: string): Promise<MastersDocument> {
    const input = validateAddDocumentInput(rawInput)
    const key = idempotencyKey === undefined ? undefined : stringKey(idempotencyKey, 'Idempotency-Key')
    const logicalInput = {
      consultationId, version: input.version, type: normalizeDocumentType(input.type), sha256: input.sha256,
      sizeBytes: input.sizeBytes, originalName: input.originalName, description: input.description ?? null,
      replaceDocumentId: input.replaceDocumentId ?? null
    }
    return this.store.transaction(async (tx) => {
      const consultation = await this.ownedConsultation(tx, userId, consultationId, true)
      await this.requireActiveConsent(tx, consultation)
      const idem = await this.beginIdempotency(tx, userId, 'DOCUMENT_ADD', key, logicalInput)
      if (idem?.replay) {
        const existing = await tx.findById('mastersDocuments', idem.record.resourceId as string)
        invariant(existing, 500, 'IDEMPOTENCY_RESOURCE_MISSING', '幂等附件不存在')
        return existing
      }
      invariant(consultation.profileVersion === input.version, 409, 'MASTERS_VERSION_CONFLICT', '资料已更新，请刷新后重试', { currentVersion: consultation.profileVersion })
      const documents = await this.activeDocuments(tx, consultation.id)
      invariant(documents.length < MAX_DOCUMENTS_PER_CONSULTATION || Boolean(input.replaceDocumentId), 409, 'MASTERS_DOCUMENT_LIMIT', '单个咨询最多保存20份材料')
      if (!input.replaceDocumentId) {
        invariant(documents.filter((document) => document.type === normalizeDocumentType(input.type)).length < MAX_DOCUMENTS_PER_CONSULTATION, 409, 'MASTERS_DOCUMENT_LIMIT', '该材料类别已达到数量上限')
      }
      let replaced: MastersDocument | null = null
      if (input.replaceDocumentId) {
        replaced = await tx.findById('mastersDocuments', input.replaceDocumentId, { forUpdate: true })
        invariant(replaced?.consultationId === consultation.id && replaced.uploadStatus === 'UPLOADED' && !replaced.removedAt, 404, 'MASTERS_DOCUMENT_NOT_FOUND', '待替换材料不存在')
      }
      const now = iso(this.clock)
      const nextVersion = consultation.profileVersion + 1
      if (replaced) await tx.update('mastersDocuments', replaced.id, { uploadStatus: 'REMOVED', removedAt: now, updatedAt: now })
      const extraction = input.extraction === undefined || input.extraction === null ? null : input.extraction
      const extractionStatus = extraction?.status ?? 'PENDING'
      const document = await tx.insert('mastersDocuments', {
        id: this.ids('mdoc'), consultationId: consultation.id, userId, type: normalizeDocumentType(input.type), storageKey: input.storageKey,
        originalName: input.originalName, description: input.description ?? null, mimeType: input.mimeType, sizeBytes: input.sizeBytes,
        sha256: input.sha256, profileVersion: nextVersion, uploadStatus: 'UPLOADED', extractionStatus,
        extraction, uploadedAt: now, updatedAt: now, removedAt: null
      })
      await tx.update('mastersConsultations', consultation.id, { profileVersion: nextVersion, accuracyConfirmed: false, confirmedSnapshotId: null, status: consultation.status === 'DRAFT' ? 'DRAFT' : 'NEEDS_INFO', updatedAt: now })
      await this.reconcileCrossDocumentConflicts(tx, consultation.id, now)
      await this.markReportsStale(tx, consultation.id, now, 'DOCUMENT_CHANGED')
      await this.audit(tx, userId, consultation.id, replaced ? 'DOCUMENT_REPLACED' : 'DOCUMENT_ADDED', {
        documentId: document.id, type: document.type, profileVersion: nextVersion, replacedDocumentId: replaced?.id ?? null
      }, now)
      if (idem) await this.finishIdempotency(tx, idem.record.id, 'document', document.id, 201)
      return document
    })
  }

  /**
   * Checks authorization even when documentId is omitted.  The HTTP layer uses
   * the null result as a cheap preflight before it stores a private file.
   */
  async authorizeDocument(userId: string, consultationId: string, documentId?: string, internal = false): Promise<MastersDocument | null> {
    return this.store.read(async (tx) => {
      const consultation = await tx.findById('mastersConsultations', consultationId)
      invariant(consultation, 404, 'MASTERS_CONSULTATION_NOT_FOUND', '咨询不存在')
      if (internal) await this.requireInternalAccess(tx, userId, consultation, 'document')
      else {
        invariant(consultation.userId === userId, 403, 'MASTERS_CONSULTATION_FORBIDDEN', '无权访问该咨询')
        await this.requireActiveConsent(tx, consultation)
      }
      if (!documentId) return null
      const document = await tx.findById('mastersDocuments', documentId)
      invariant(document?.consultationId === consultation.id && document.userId === consultation.userId && document.uploadStatus === 'UPLOADED' && !document.removedAt, 404, 'MASTERS_DOCUMENT_NOT_FOUND', '材料不存在')
      return document
    })
  }

  async removeDocument(userId: string, consultationId: string, documentId: string, versionOrInput: number | { version: number }): Promise<MastersDocument> {
    const version = typeof versionOrInput === 'number' ? versionOrInput : versionOrInput.version
    invariant(Number.isInteger(version) && version >= 1, 400, 'MASTERS_VERSION_INVALID', '资料版本无效')
    return this.store.transaction(async (tx) => {
      const consultation = await this.ownedConsultation(tx, userId, consultationId, true)
      await this.requireActiveConsent(tx, consultation)
      invariant(consultation.profileVersion === version, 409, 'MASTERS_VERSION_CONFLICT', '资料已更新，请刷新后重试', { currentVersion: consultation.profileVersion })
      const document = await tx.findById('mastersDocuments', documentId, { forUpdate: true })
      invariant(document?.consultationId === consultation.id && document.userId === userId && document.uploadStatus === 'UPLOADED' && !document.removedAt, 404, 'MASTERS_DOCUMENT_NOT_FOUND', '材料不存在')
      const now = iso(this.clock)
      const removed = await tx.update('mastersDocuments', document.id, { uploadStatus: 'REMOVED', removedAt: now, updatedAt: now })
      await tx.update('mastersConsultations', consultation.id, { profileVersion: consultation.profileVersion + 1, accuracyConfirmed: false, confirmedSnapshotId: null, status: consultation.status === 'DRAFT' ? 'DRAFT' : 'NEEDS_INFO', updatedAt: now })
      await this.reconcileCrossDocumentConflicts(tx, consultation.id, now)
      await this.markReportsStale(tx, consultation.id, now, 'DOCUMENT_REMOVED')
      await this.audit(tx, userId, consultation.id, 'DOCUMENT_REMOVED', { documentId, type: document.type, fromVersion: version, toVersion: version + 1 }, now)
      return removed
    })
  }

  async getExtraction(userId: string, consultationId: string, internal = false): Promise<{ profileVersion: number; documents: MastersDocument[] }> {
    return this.store.read(async tx => {
      const consultation = internal ? await this.getInternalConsultation(tx, userId, consultationId, 'extraction') : await this.ownedConsultation(tx, userId, consultationId)
      await this.requireActiveConsent(tx, consultation)
      return { profileVersion: consultation.profileVersion, documents: await this.activeDocuments(tx, consultationId) }
    })
  }

  async resolveExtraction(userId: string, consultationId: string, rawInput: MastersExtractionResolutionInput | unknown): Promise<MastersDocument> {
    invariant(isObject(rawInput), 400, 'MASTERS_EXTRACTION_RESOLUTION_INVALID', '解析确认参数无效')
    const record = rawInput
    invariant(Object.keys(record).every(key => ['version', 'documentId', 'field', 'value', 'accepted'].includes(key)), 400, 'MASTERS_EXTRACTION_RESOLUTION_INVALID', '解析确认包含不支持字段')
    invariant(Number.isInteger(record.version) && Number(record.version) >= 1, 400, 'MASTERS_VERSION_INVALID', '资料版本无效')
    const version = Number(record.version)
    const documentId = nonEmpty(record.documentId, 'MASTERS_EXTRACTION_RESOLUTION_INVALID', 'documentId 不能为空', 200)
    const field = nonEmpty(record.field, 'MASTERS_EXTRACTION_RESOLUTION_INVALID', 'field 不能为空', 100)
    invariant(EXTRACTION_PROFILE_FIELDS.has(field), 400, 'MASTERS_EXTRACTION_FIELD_FORBIDDEN', '该字段不能写入申请资料')
    invariant(typeof record.accepted === 'boolean', 400, 'MASTERS_EXTRACTION_RESOLUTION_INVALID', '请明确接受或拒绝')
    const accepted = record.accepted
    return this.store.transaction(async tx => {
      const consultation = await this.ownedConsultation(tx, userId, consultationId, true)
      await this.requireActiveConsent(tx, consultation)
      invariant(consultation.profileVersion === version, 409, 'MASTERS_VERSION_CONFLICT', '资料已更新，请刷新')
      const document = await tx.findById('mastersDocuments', documentId, { forUpdate: true })
      invariant(document?.consultationId === consultationId && document.userId === userId && document.uploadStatus === 'UPLOADED' && !document.removedAt, 404, 'MASTERS_DOCUMENT_NOT_FOUND', '材料不存在')
      const extraction = document.extraction ? structuredClone(document.extraction) : null
      invariant(extraction && Object.hasOwn(extraction.fields ?? {}, field), 400, 'MASTERS_EXTRACTION_FIELD_FORBIDDEN', '附件没有该候选字段')
      const candidates = this.extractionCandidates(extraction)[field] ?? []
      invariant(!accepted || typeof record.value === 'string' && candidates.includes(record.value), 409, 'MASTERS_EXTRACTION_VALUE_INVALID', '确认值必须来自该附件原始提取结果')
      const value = accepted ? record.value as string : null
      const nextProfile = accepted ? mergeProfile(consultation.profile, validateProfileDraft({ [field]: value })) : consultation.profile
      const now = iso(this.clock)
      extraction.candidates = this.extractionCandidates(extraction)
      extraction.confirmations = [...(extraction.confirmations ?? []).filter(c => c.field !== field), { field, value, documentId, actorUserId: userId, confirmedAt: now }]
      await tx.update('mastersDocuments', documentId, { extraction, updatedAt: now })
      await this.reconcileCrossDocumentConflicts(tx, consultationId, now)
      await tx.update('mastersConsultations', consultationId, { profile: nextProfile, profileVersion: version + 1, accuracyConfirmed: false, confirmedSnapshotId: null, status: consultation.status === 'DRAFT' ? 'DRAFT' : 'NEEDS_INFO', updatedAt: now })
      await this.markReportsStale(tx, consultationId, now, 'EXTRACTION_RESOLVED')
      await this.audit(tx, userId, consultationId, 'EXTRACTION_CONFLICT_RESOLVED', { documentId, field, accepted, fromVersion: version, toVersion: version + 1 }, now)
      return (await tx.findById('mastersDocuments', documentId))!
    })
  }

  async internalList(userId: string): Promise<MastersConsultationDetail[]> {
    return this.store.read(async (tx) => {
      const staff = await this.requireStaff(tx, userId)
      const rows = (await tx.findMany('mastersConsultations')).filter(row => row.status !== 'WITHDRAWN' && !row.withdrawnAt)
      const visible = staff.role === 'founder' || staff.role === 'assignment_manager'
        ? rows
        : rows.filter((consultation) => false)
      let assigned = visible
      if (staff.role === 'advisor') {
        const assignments = await tx.findMany('mastersAssignments', { advisorUserId: userId, status: 'ACTIVE' })
        const ids = new Set(assignments.map((assignment) => assignment.consultationId))
        assigned = rows.filter((consultation) => ids.has(consultation.id))
      }
      assigned.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      return Promise.all(assigned.map((consultation) => this.detailTx(tx, consultation, userId, true))) as Promise<MastersConsultationDetail[]>
    })
  }

  async assign(actorUserId: string, consultationId: string, advisorOrInput: string | RecordValue, idempotencyKey?: string): Promise<MastersAssignment> {
    const advisorUserId = typeof advisorOrInput === 'string' ? advisorOrInput : String(advisorOrInput.advisorUserId ?? '')
    const expectedVersion = typeof advisorOrInput === 'string' || advisorOrInput.version === undefined ? undefined : Number(advisorOrInput.version)
    const key = idempotencyKey === undefined ? undefined : stringKey(idempotencyKey, 'Idempotency-Key')
    return this.store.transaction(async (tx) => {
      const consultation = await this.getInternalConsultation(tx, actorUserId, consultationId, 'assign', true)
      await this.requireStaff(tx, actorUserId, ['founder', 'assignment_manager'])
      if (expectedVersion !== undefined) invariant(consultation.profileVersion === expectedVersion, 409, 'MASTERS_VERSION_CONFLICT', '资料已更新，请刷新后重试', { currentVersion: consultation.profileVersion })
      const normalizedAdvisor = nonEmpty(advisorUserId, 'MASTERS_ADVISOR_REQUIRED', '必须指定顾问', 200)
      const advisor = await tx.findOne('mastersStaff', { userId: normalizedAdvisor, role: 'advisor', status: 'ACTIVE' }, { forUpdate: true })
      invariant(advisor, 403, 'MASTERS_ADVISOR_NOT_AUTHORIZED', '指定用户没有有效顾问授权')
      const idem = await this.beginIdempotency(tx, actorUserId, 'ASSIGN', key, { consultationId, advisorUserId: normalizedAdvisor, version: expectedVersion ?? consultation.profileVersion })
      if (idem?.replay) {
        const existing = await tx.findById('mastersAssignments', idem.record.resourceId as string)
        invariant(existing, 500, 'IDEMPOTENCY_RESOURCE_MISSING', '幂等分配不存在')
        return existing
      }
      const now = iso(this.clock)
      const active = await tx.findOne('mastersAssignments', { consultationId, status: 'ACTIVE' }, { forUpdate: true })
      if (active && active.advisorUserId === normalizedAdvisor) {
        if (idem) await this.finishIdempotency(tx, idem.record.id, 'assignment', active.id, 200)
        return active
      }
      if (active) await tx.update('mastersAssignments', active.id, { status: 'ENDED', endedAt: now, updatedAt: now })
      if (active) for (const report of await tx.findMany('mastersReports', { consultationId })) {
        if (report.status === 'NEEDS_REVIEW' || report.status === 'APPROVED') await tx.update('mastersReports', report.id, { status: 'NEEDS_REVIEW', reviewedBy: null, reviewedAt: null, approvedBy: null, approvedAt: null, updatedAt: now })
      }
      const assignment = await tx.insert('mastersAssignments', {
        id: this.ids('masg'), consultationId, advisorUserId: normalizedAdvisor, assignedBy: actorUserId,
        status: 'ACTIVE', assignedAt: now, endedAt: null, createdAt: now, updatedAt: now
      })
      await tx.update('mastersConsultations', consultation.id, { status: consultation.status === 'DRAFT' ? 'DRAFT' : 'IN_REVIEW', updatedAt: now })
      await this.audit(tx, actorUserId, consultation.id, active ? 'CONSULTATION_REASSIGNED' : 'CONSULTATION_ASSIGNED', { advisorUserId: normalizedAdvisor, assignmentId: assignment.id }, now)
      if (idem) await this.finishIdempotency(tx, idem.record.id, 'assignment', assignment.id, 200)
      return assignment
    })
  }

  async requestDocuments(actorUserId: string, consultationId: string, rawInput: MastersRequestDocumentsInput | MastersDocumentTypeAlias[] | string = {}): Promise<MastersConsultation> {
    const input = this.parseRequestDocuments(rawInput)
    return this.store.transaction(async (tx) => {
      const consultation = await this.getInternalConsultation(tx, actorUserId, consultationId, 'request_documents', true)
      const now = iso(this.clock)
      const types = input.types?.map(normalizeDocumentType) ?? []
      await tx.update('mastersConsultations', consultation.id, { status: 'NEEDS_INFO', updatedAt: now })
      await this.audit(tx, actorUserId, consultation.id, 'DOCUMENTS_REQUESTED', { types, note: input.note ?? '' }, now)
      return tx.findById('mastersConsultations', consultation.id).then((value) => {
        invariant(value, 500, 'CONSULTATION_NOT_FOUND', '咨询不存在')
        return value
      })
    })
  }

  async enqueueReport(actorUserId: string, consultationId: string, rawInput?: { version?: number; idempotencyKey?: string } | number | string, idempotencyKey?: string): Promise<MastersReportJob> {
    const parsed = this.parseEnqueueInput(rawInput)
    if (idempotencyKey !== undefined) parsed.idempotencyKey = idempotencyKey
    const key = parsed.idempotencyKey === undefined ? undefined : stringKey(parsed.idempotencyKey, 'Idempotency-Key')
    return this.store.transaction(async (tx) => {
      const consultation = await this.getInternalConsultation(tx, actorUserId, consultationId, 'enqueue_report', true)
      if (parsed.version !== undefined) invariant(consultation.profileVersion === parsed.version, 409, 'MASTERS_VERSION_CONFLICT', '资料已更新，请刷新后重试', { currentVersion: consultation.profileVersion })
      invariant(consultation.confirmedSnapshotId && consultation.accuracyConfirmed, 409, 'MASTERS_CONFIRMATION_REQUIRED', '生成报告前需要确认资料')
      const snapshot = await tx.findById('mastersSnapshots', consultation.confirmedSnapshotId)
      invariant(snapshot && snapshot.profileVersion === consultation.profileVersion, 409, 'MASTERS_CONFIRMATION_STALE', '确认快照已过期，请重新确认')
      const idem = await this.beginIdempotency(tx, actorUserId, 'ENQUEUE_REPORT', key, { consultationId, version: consultation.profileVersion })
      if (idem?.replay) {
        const existing = await tx.findById('mastersReportJobs', idem.record.resourceId as string)
        invariant(existing, 500, 'IDEMPOTENCY_RESOURCE_MISSING', '幂等报告任务不存在')
        return existing
      }
      const now = iso(this.clock)
      const job = await this.ensureReportJob(tx, consultation, snapshot, actorUserId)
      await this.audit(tx, actorUserId, consultation.id, 'REPORT_ENQUEUED', { jobId: job.id, reportId: job.reportId, sourceProfileVersion: snapshot.profileVersion }, now)
      if (idem) await this.finishIdempotency(tx, idem.record.id, 'report_job', job.id, 202)
      return job
    })
  }

  async editReport(actorUserId: string, consultationId: string, rawInput: MastersReportEditInput | unknown): Promise<MastersReport> {
    const input = this.parseReportEdit(rawInput)
    return this.store.transaction(async (tx) => {
      const consultation = await this.getInternalConsultation(tx, actorUserId, consultationId, 'edit_report', true)
      const report = await this.reportForVersion(tx, consultation, input.version, input.reportId)
      invariant(report.status === 'NEEDS_REVIEW', 409, 'MASTERS_REPORT_EDIT_INVALID_STATE', '当前报告状态不允许编辑')
      const payload = mergeReportWithPatch(report.payload, input.payload)
      const now = iso(this.clock)
      const nextVersion = Math.max(...(await tx.findMany('mastersReports', { consultationId })).map(row => row.version)) + 1
      await tx.update('mastersReports', report.id, { status: 'STALE', updatedAt: now })
      const updated = await tx.insert('mastersReports', { ...report, id: this.ids('mrpt'), version: nextVersion, payload, status: 'NEEDS_REVIEW', editedBy: actorUserId,
        reviewedBy: null, reviewedAt: null, approvedBy: null, approvedAt: null, releasedBy: null, releasedAt: null, createdAt: now, updatedAt: now })
      await this.audit(tx, actorUserId, consultation.id, 'REPORT_EDITED', { reportId: updated.id, version: updated.version, previousReportId: report.id }, now)
      return updated
    })
  }

  async reviewReport(actorUserId: string, consultationId: string, rawInput: MastersReportReviewInput | unknown): Promise<MastersReport> {
    const input = this.parseReportDecision(rawInput)
    return this.store.transaction(async (tx) => {
      const consultation = await this.getInternalConsultation(tx, actorUserId, consultationId, 'review_report', true)
      const report = await this.reportForVersion(tx, consultation, input.version, input.reportId)
      const staff = await this.requireStaff(tx, actorUserId)
      invariant(staff.role === 'advisor', 403, 'MASTERS_REVIEW_FORBIDDEN', '只有顾问可以提交报告复核')
      invariant(report.status === 'NEEDS_REVIEW', 409, 'MASTERS_REPORT_REVIEW_INVALID_STATE', '报告当前状态不允许复核')
      const now = iso(this.clock)
      const updated = await tx.update('mastersReports', report.id, { status: 'NEEDS_REVIEW', reviewedBy: actorUserId, reviewedAt: now, updatedAt: now })
      await this.audit(tx, actorUserId, consultation.id, 'REPORT_REVIEWED', { reportId: report.id, version: report.version, note: input.note ?? '' }, now)
      return updated
    })
  }

  async approveReport(founderUserId: string, consultationId: string, rawInput: MastersReportDecisionInput | unknown): Promise<MastersReport> {
    return this.decideReport(founderUserId, consultationId, rawInput, 'APPROVED')
  }

  async returnReport(founderUserId: string, consultationId: string, rawInput: MastersReportDecisionInput | unknown): Promise<MastersReport> {
    return this.decideReport(founderUserId, consultationId, rawInput, 'RETURNED')
  }

  async releaseReport(founderUserId: string, consultationId: string, rawInput: MastersReportDecisionInput | unknown): Promise<MastersReport> {
    return this.decideReport(founderUserId, consultationId, rawInput, 'RELEASED')
  }

  async getReleasedReport(userId: string, consultationId: string, internal = false): Promise<MastersReport> {
    return this.store.read(async (tx) => {
      const consultation = await tx.findById('mastersConsultations', consultationId)
      invariant(consultation, 404, 'MASTERS_CONSULTATION_NOT_FOUND', '咨询不存在')
      if (internal) await this.requireInternalAccess(tx, userId, consultation, 'report')
      else {
        invariant(consultation.userId === userId, 403, 'MASTERS_REPORT_FORBIDDEN', '无权访问该报告')
        await this.requireActiveConsent(tx, consultation)
      }
      const reports = await tx.findMany('mastersReports', { consultationId })
      const released = reports.filter((report) => report.status === 'RELEASED').sort((left, right) => right.version - left.version)[0]
      invariant(released || !reports.some(report => report.releasedAt && report.status === 'STALE'), 409, 'MASTERS_REPORT_STALE', '资料已变化，请等待复核后的咨询报告')
      invariant(released, 404, 'MASTERS_REPORT_NOT_RELEASED', '咨询报告尚未开放')
      invariant(released.sourceProfileVersion === consultation.profileVersion, 409, 'MASTERS_REPORT_STALE', '资料已变化，请等待新的咨询报告')
      return released
    })
  }

  async claimJob(workerId = `masters-worker-${process.pid}`, options: MastersClaimJobOptions = {}): Promise<MastersReportJob | null> {
    const leaseMs = options.leaseMs ?? this.leaseMs
    const maxAttempts = options.maxAttempts ?? this.maxAttempts
    invariant(Number.isInteger(leaseMs) && leaseMs >= 1_000 && leaseMs <= 60 * 60 * 1000, 400, 'MASTERS_LEASE_CONFIG_INVALID', '报告任务租约配置无效')
    invariant(Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 10, 400, 'MASTERS_RETRY_CONFIG_INVALID', '重试次数无效')
    return this.store.transaction(async (tx) => {
      const now = nowDate(this.clock)
      const nowIso = now.toISOString()
      const jobs = await tx.findMany('mastersReportJobs')
      const candidate = jobs
        .filter((job) => {
          if (job.status === 'QUEUED' || job.status === 'FAILED') return new Date(job.nextAttemptAt).getTime() <= now.getTime() && job.attempts < Math.min(maxAttempts, job.maxAttempts)
          return job.status === 'RUNNING' && Boolean(job.leaseExpiresAt) && new Date(job.leaseExpiresAt as string).getTime() <= now.getTime()
        })
        .sort((left, right) => new Date(left.nextAttemptAt).getTime() - new Date(right.nextAttemptAt).getTime())[0]
      if (!candidate) return null
      // Lock order is consultation -> job -> report.  Re-check all candidate
      // predicates after the locks so two PostgreSQL workers cannot claim the
      // same row after the initial non-locking scan.
      const consultation = await tx.findById('mastersConsultations', candidate.consultationId, { forUpdate: true })
      invariant(consultation, 500, 'MASTERS_CONSULTATION_NOT_FOUND', '咨询不存在')
      const job = await tx.findById('mastersReportJobs', candidate.id, { forUpdate: true })
      invariant(job, 500, 'MASTERS_JOB_NOT_FOUND', '报告任务不存在')
      const due = new Date(job.nextAttemptAt).getTime() <= now.getTime()
      const recoverable = job.status === 'QUEUED' || job.status === 'FAILED' ||
        (job.status === 'RUNNING' && Boolean(job.leaseExpiresAt) && new Date(job.leaseExpiresAt as string).getTime() <= now.getTime())
      invariant(recoverable && (due || job.status === 'RUNNING'), 409, 'MASTERS_JOB_ALREADY_CLAIMED', '报告任务已被其他工作者领取')
      if (job.attempts >= Math.min(maxAttempts, job.maxAttempts)) {
        const failed = await tx.update('mastersReportJobs', job.id, { status: 'FAILED', leaseToken: null, leaseOwner: null, leaseExpiresAt: null, lastError: 'MAX_ATTEMPTS_EXCEEDED', updatedAt: nowIso })
        const report = await tx.findById('mastersReports', job.reportId, { forUpdate: true })
        if (report && report.status !== 'FAILED' && report.status !== 'STALE') await tx.update('mastersReports', report.id, { status: 'FAILED', updatedAt: nowIso })
        return failed
      }
      if (consultation.status === 'WITHDRAWN' || consultation.withdrawnAt || consultation.profileVersion !== job.sourceProfileVersion) {
        const stale = await tx.update('mastersReportJobs', job.id, { status: 'STALE', leaseToken: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: nowIso })
        const report = await tx.findById('mastersReports', job.reportId, { forUpdate: true })
        if (report && report.status !== 'STALE') await tx.update('mastersReports', report.id, { status: 'STALE', updatedAt: nowIso })
        return stale
      }
      const token = this.ids('mlease')
      const claimed = await tx.update('mastersReportJobs', job.id, {
        status: 'RUNNING', attempts: job.attempts + 1, maxAttempts: Math.min(maxAttempts, job.maxAttempts), leaseToken: token, leaseOwner: workerId,
        leaseExpiresAt: dateAfter(this.clock, leaseMs), updatedAt: nowIso, lastError: null
      })
      const report = await tx.findById('mastersReports', job.reportId, { forUpdate: true })
      invariant(report, 500, 'MASTERS_REPORT_NOT_FOUND', '报告不存在')
      invariant(report.sourceProfileVersion === consultation.profileVersion, 409, 'MASTERS_REPORT_STALE', '报告所依据的资料已变化')
      await tx.update('mastersReports', report.id, { status: 'RUNNING', updatedAt: nowIso })
      await this.audit(tx, null, consultation.id, 'REPORT_JOB_CLAIMED', { jobId: job.id, attempt: job.attempts + 1 }, nowIso)
      return claimed
    })
  }

  async completeJob(jobId: string, leaseToken: string, rawPayload?: unknown): Promise<MastersReport> {
    const token = nonEmpty(leaseToken, 'MASTERS_LEASE_INVALID', '报告任务租约无效', 200)
    return this.store.transaction(async (tx) => {
      const unguarded = await tx.findById('mastersReportJobs', jobId)
      invariant(unguarded, 404, 'MASTERS_JOB_NOT_FOUND', '报告任务不存在')
      const consultation = await tx.findById('mastersConsultations', unguarded.consultationId, { forUpdate: true })
      invariant(consultation, 500, 'MASTERS_CONSULTATION_NOT_FOUND', '咨询不存在')
      const job = await tx.findById('mastersReportJobs', jobId, { forUpdate: true })
      invariant(job, 404, 'MASTERS_JOB_NOT_FOUND', '报告任务不存在')
      invariant(job.status === 'RUNNING' && job.leaseToken === token, 409, 'MASTERS_LEASE_CONFLICT', '报告任务租约已失效')
      invariant(job.leaseExpiresAt !== null && new Date(job.leaseExpiresAt).getTime() > this.clock().getTime(), 409, 'MASTERS_LEASE_EXPIRED', '报告任务租约已过期')
      invariant(consultation.profileVersion === job.sourceProfileVersion && consultation.status !== 'WITHDRAWN' && !consultation.withdrawnAt, 409, 'MASTERS_REPORT_STALE', '报告所依据的资料已变化')
      const report = await tx.findById('mastersReports', job.reportId, { forUpdate: true })
      invariant(report, 500, 'MASTERS_REPORT_NOT_FOUND', '报告不存在')
      if (report.sourceProfileVersion !== consultation.profileVersion || report.status === 'STALE') {
        await tx.update('mastersReportJobs', job.id, { status: 'STALE', leaseToken: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: iso(this.clock) })
        await tx.update('mastersReports', report.id, { status: 'STALE', updatedAt: iso(this.clock) })
        throw new AppError(409, 'MASTERS_REPORT_STALE', '报告所依据的资料已变化')
      }
      const payload = rawPayload === undefined ? report.payload : mergeReportWithPatch(report.payload, exactReportPatch(rawPayload))
      const now = iso(this.clock)
      const updated = await tx.update('mastersReports', report.id, { status: 'NEEDS_REVIEW', payload, updatedAt: now })
      await tx.update('mastersReportJobs', job.id, { status: 'NEEDS_REVIEW', leaseToken: null, leaseOwner: null, leaseExpiresAt: null, completedAt: now, updatedAt: now })
      await this.audit(tx, null, consultation.id, 'REPORT_JOB_COMPLETED', { jobId: job.id, reportId: report.id, version: report.version }, now)
      return updated
    })
  }

  async failJob(jobId: string, leaseToken: string, errorCode: string): Promise<MastersReportJob> {
    const token = nonEmpty(leaseToken, 'MASTERS_LEASE_INVALID', '报告任务租约无效', 200)
    const safeError = nonEmpty(errorCode, 'MASTERS_JOB_ERROR_INVALID', '报告任务错误码不能为空', 100)
    return this.store.transaction(async (tx) => {
      const unguarded = await tx.findById('mastersReportJobs', jobId)
      invariant(unguarded, 404, 'MASTERS_JOB_NOT_FOUND', '报告任务不存在')
      const consultation = await tx.findById('mastersConsultations', unguarded.consultationId, { forUpdate: true })
      invariant(consultation, 500, 'MASTERS_CONSULTATION_NOT_FOUND', '咨询不存在')
      const job = await tx.findById('mastersReportJobs', jobId, { forUpdate: true })
      invariant(job, 404, 'MASTERS_JOB_NOT_FOUND', '报告任务不存在')
      invariant(job.status === 'RUNNING' && job.leaseToken === token, 409, 'MASTERS_LEASE_CONFLICT', '报告任务租约已失效')
      invariant(job.leaseExpiresAt !== null && new Date(job.leaseExpiresAt).getTime() > this.clock().getTime(), 409, 'MASTERS_LEASE_EXPIRED', '报告任务租约已过期')
      invariant(consultation.profileVersion === job.sourceProfileVersion && consultation.status !== 'WITHDRAWN' && !consultation.withdrawnAt, 409, 'MASTERS_REPORT_STALE', '报告所依据的资料已变化')
      const report = await tx.findById('mastersReports', job.reportId, { forUpdate: true })
      invariant(report, 500, 'MASTERS_REPORT_NOT_FOUND', '报告不存在')
      const now = iso(this.clock)
      const terminal = job.attempts >= job.maxAttempts
      const next = await tx.update('mastersReportJobs', job.id, {
        status: terminal ? 'FAILED' : 'FAILED', leaseToken: null, leaseOwner: null, leaseExpiresAt: null,
        lastError: safeError, nextAttemptAt: terminal ? now : dateAfter(this.clock, Math.min(60_000 * job.attempts, 15 * 60_000)), updatedAt: now
      })
      await tx.update('mastersReports', job.reportId, { status: terminal ? 'FAILED' : 'FAILED', updatedAt: now })
      await this.audit(tx, null, consultation.id, 'REPORT_JOB_FAILED', { jobId: job.id, errorCode: safeError, retryable: !terminal }, now)
      return next
    })
  }

  /** Staff-only, explicit authorization grant. Old users.role=admin is insufficient. */
  async grantStaff(founderUserId: string, targetUserId: string, rawRole: MastersStaffRole | string): Promise<MastersStaff> {
    const role = normalizeStaffRole(rawRole)
    return this.store.transaction(async (tx) => {
      await this.requireStaff(tx, founderUserId, ['founder'])
      const target = await this.requireUser(tx, targetUserId)
      const now = iso(this.clock)
      const current = await tx.findOne('mastersStaff', { userId: target.id }, { forUpdate: true })
      if (current) return tx.update('mastersStaff', current.id, { role, status: 'ACTIVE', grantedBy: founderUserId, updatedAt: now })
      return tx.insert('mastersStaff', { id: this.ids('mstf'), userId: target.id, role, status: 'ACTIVE', grantedBy: founderUserId, createdAt: now, updatedAt: now })
    })
  }

  async suspendStaff(founderUserId: string, targetUserId: string): Promise<MastersStaff> {
    return this.store.transaction(async (tx) => {
      await this.requireStaff(tx, founderUserId, ['founder'])
      const staff = await tx.findOne('mastersStaff', { userId: targetUserId }, { forUpdate: true })
      invariant(staff, 404, 'MASTERS_STAFF_NOT_FOUND', '工作台授权不存在')
      const now = iso(this.clock)
      return tx.update('mastersStaff', staff.id, { status: 'SUSPENDED', updatedAt: now })
    })
  }

  /** Purge private profile payloads after withdrawal while retaining audit/status rows. */
  async purgeWithdrawn(actorUserId: string, consultationId: string): Promise<{ consultationId: string; purged: boolean }> {
    return this.store.transaction(async (tx) => {
      const consultation = await tx.findById('mastersConsultations', consultationId, { forUpdate: true })
      invariant(consultation, 404, 'MASTERS_CONSULTATION_NOT_FOUND', '咨询不存在')
      if (actorUserId !== consultation.userId) await this.requireStaff(tx, actorUserId, ['founder', 'assignment_manager'])
      invariant(consultation.status === 'WITHDRAWN' && consultation.withdrawnAt, 409, 'MASTERS_PURGE_NOT_ELIGIBLE', '只有已撤回咨询可以清理')
      const now = iso(this.clock)
      await tx.update('mastersConsultations', consultation.id, { profile: {}, updatedAt: now })
      const docs = await tx.findMany('mastersDocuments', { consultationId })
      for (const doc of docs) await tx.update('mastersDocuments', doc.id, { originalName: 'withdrawn-material', description: null, extraction: null, uploadStatus: 'REMOVED', removedAt: doc.removedAt ?? now, updatedAt: now })
      for (const audit of await tx.findMany('mastersAuditLogs', { consultationId })) {
        if ('note' in audit.metadata) { const { note: _note, ...metadata } = audit.metadata; await tx.update('mastersAuditLogs', audit.id, { metadata }) }
      }
      const snapshots = await tx.findMany('mastersSnapshots', { consultationId })
      for (const snapshot of snapshots) await tx.update('mastersSnapshots', snapshot.id, { profile: {}, documentIds: [], confirmedAt: snapshot.confirmedAt })
      const reports = await tx.findMany('mastersReports', { consultationId })
      for (const report of reports) await tx.update('mastersReports', report.id, { payload: emptyReportPayload(), status: 'STALE', updatedAt: now })
      await this.audit(tx, actorUserId, consultation.id, 'WITHDRAWN_DATA_PURGED', { documentCount: docs.length, snapshotCount: snapshots.length, reportCount: reports.length }, now)
      return { consultationId, purged: true }
    })
  }

  async listPurgeCandidates(actorUserId: string): Promise<Array<{ consultationId: string; withdrawnAt: string; eligibleAt: string }>> {
    return this.store.read(async (tx) => {
      await this.requireStaff(tx, actorUserId, ['founder', 'assignment_manager'])
      const cutoff = this.clock().getTime() - this.retentionDays * 24 * 60 * 60 * 1000
      return (await tx.findMany('mastersConsultations')).filter((item) => item.status === 'WITHDRAWN' && item.withdrawnAt && new Date(item.withdrawnAt).getTime() <= cutoff).map((item) => ({
        consultationId: item.id, withdrawnAt: item.withdrawnAt as string, eligibleAt: new Date(new Date(item.withdrawnAt as string).getTime() + this.retentionDays * 24 * 60 * 60 * 1000).toISOString()
      }))
    })
  }

  private async requireUser(tx: StoreTransaction, userId: string, forUpdate = false): Promise<EntityMap['users']> {
    const user = await tx.findById('users', userId, { forUpdate })
    invariant(user, 401, 'AUTH_REQUIRED', '登录用户不存在')
    return user
  }

  private async assertLinkedStudent(tx: StoreTransaction, userId: string, studentId: string): Promise<void> {
    const student = await tx.findById('students', studentId)
    invariant(student, 404, 'LINKED_STUDENT_NOT_FOUND', '关联学生档案不存在')
    const family = await tx.findById('families', student.familyId)
    invariant(family?.userId === userId, 403, 'LINKED_STUDENT_FORBIDDEN', '无权关联该学生档案')
  }

  private assertNotWithdrawn(consultation: MastersConsultation): void {
    invariant(consultation.status !== 'WITHDRAWN' && !consultation.withdrawnAt, 410, 'MASTERS_CONSULTATION_WITHDRAWN', '咨询已撤回')
  }

  private async ownedConsultation(tx: StoreTransaction, userId: string, consultationId: string, forUpdate = false, allowWithdrawn = false): Promise<MastersConsultation> {
    const consultation = await tx.findById('mastersConsultations', consultationId, { forUpdate })
    invariant(consultation, 404, 'MASTERS_CONSULTATION_NOT_FOUND', '咨询不存在')
    invariant(consultation.userId === userId, 403, 'MASTERS_CONSULTATION_FORBIDDEN', '无权访问该咨询')
    if (!allowWithdrawn) this.assertNotWithdrawn(consultation)
    return consultation
  }

  private async requireActiveConsent(tx: StoreTransaction, consultation: MastersConsultation): Promise<MastersConsent> {
    this.assertNotWithdrawn(consultation)
    invariant(consultation.serviceConsentId, 403, 'MASTERS_CONSENT_REQUIRED', '请先同意咨询资料授权')
    const consent = await tx.findById('mastersConsents', consultation.serviceConsentId, { forUpdate: true })
    invariant(consent && consent.consultationId === consultation.id && consent.userId === consultation.userId && consent.accepted && !consent.withdrawnAt && consent.copyVersion === MASTERS_SERVICE_CONSENT_VERSION, 403, 'MASTERS_CONSENT_REQUIRED', '咨询资料授权缺失或已撤回')
    return consent
  }

  private async requireStaff(tx: StoreTransaction, userId: string, roles?: MastersStaffRole[]): Promise<MastersStaff> {
    await this.requireUser(tx, userId)
    const staff = await tx.findOne('mastersStaff', { userId, status: 'ACTIVE' }, { forUpdate: true })
    invariant(staff, 403, 'MASTERS_STAFF_REQUIRED', '未获工作台授权')
    if (roles) invariant(roles.includes(staff.role), 403, 'MASTERS_ROLE_FORBIDDEN', '当前工作台角色无权执行该操作')
    return staff
  }

  private async requireInternalAccess(tx: StoreTransaction, actorUserId: string, consultation: MastersConsultation, operation: string): Promise<MastersStaff> {
    this.assertNotWithdrawn(consultation)
    await this.requireActiveConsent(tx, consultation)
    const staff = await this.requireStaff(tx, actorUserId)
    if (staff.role === 'founder' || staff.role === 'assignment_manager') return staff
    const assignment = await tx.findOne('mastersAssignments', { consultationId: consultation.id, advisorUserId: actorUserId, status: 'ACTIVE' })
    invariant(assignment, 403, 'MASTERS_ASSIGNMENT_REQUIRED', `当前顾问未被授权执行${operation}`)
    return staff
  }

  private async getInternalConsultation(tx: StoreTransaction, actorUserId: string, consultationId: string, operation: string, forUpdate = false): Promise<MastersConsultation> {
    const consultation = await tx.findById('mastersConsultations', consultationId, { forUpdate })
    invariant(consultation, 404, 'MASTERS_CONSULTATION_NOT_FOUND', '咨询不存在')
    await this.requireInternalAccess(tx, actorUserId, consultation, operation)
    return consultation
  }

  private async insertConsent(tx: StoreTransaction, userId: string, consultation: MastersConsultation, input: MastersServiceConsentInput, now: string): Promise<MastersConsent> {
    const parsed = parseServiceConsent(input)
    invariant(parsed, 400, 'MASTERS_CONSENT_REQUIRED', '必须明确同意咨询资料授权')
    return tx.insert('mastersConsents', {
      id: this.ids('mcns'), consultationId: consultation.id, userId, copyVersion: MASTERS_SERVICE_CONSENT_VERSION,
      copyTextHash: hashText(mastersConsentCopy(this.retentionDays)), locale: 'zh-CN', accepted: true,
      grantedAt: now, withdrawnAt: null, createdAt: now, updatedAt: now
    })
  }

  private async activeDocuments(tx: StoreTransaction, consultationId: string): Promise<MastersDocument[]> {
    const rows = await tx.findMany('mastersDocuments', { consultationId })
    return rows.filter((document) => document.uploadStatus === 'UPLOADED' && !document.removedAt)
  }

  /**
   * Rebuild cross-document candidate conflicts from the persisted extraction
   * values.  A parser may only report conflicts within one file; this pass is
   * therefore required after every add/remove/resolve before a snapshot can be
   * confirmed.  Explicit ACCEPTED/REJECTED resolutions are retained, while a
   * missing or inconsistent resolution remains PENDING.
   */
  private extractionCandidates(extraction: MastersDocumentExtraction): Record<string, string[]> {
    if (extraction.candidates) return structuredClone(extraction.candidates)
    const candidates: Record<string, string[]> = {}
    for (const [field, value] of Object.entries(extraction.fields ?? {})) {
      if (typeof value === 'string') candidates[field] = [value]
    }
    // Compatibility for pre-normalized parser output, before derived conflicts
    // have been stored. Persist this once so removed sources cannot linger.
    for (const conflict of extraction.conflicts ?? []) candidates[conflict.field] = [...new Set([...(candidates[conflict.field] ?? []), ...conflict.values])]
    return candidates
  }

  private async reconcileCrossDocumentConflicts(tx: StoreTransaction, consultationId: string, now: string): Promise<void> {
    const documents = await this.activeDocuments(tx, consultationId)
    const candidates = new Map(documents.map(document => [document.id, document.extraction ? this.extractionCandidates(document.extraction) : {}]))
    const fieldValues = new Map<string, Set<string>>()
    for (const fields of candidates.values()) for (const [field, values] of Object.entries(fields)) {
      const combined = fieldValues.get(field) ?? new Set<string>()
      values.forEach(value => combined.add(value)); fieldValues.set(field, combined)
    }
    for (const document of documents) {
      if (!document.extraction) continue
      const extraction = structuredClone(document.extraction)
      extraction.candidates = candidates.get(document.id)!
      extraction.conflicts = []
      for (const field of Object.keys(extraction.candidates)) {
        const values = [...(fieldValues.get(field) ?? [])]
        if (values.length < 2) continue
        const sources = documents.filter(row => Object.hasOwn(candidates.get(row.id) ?? {}, field))
        const decisions = sources.map(row => row.extraction?.confirmations?.find(c => c.field === field))
        const acceptedValues = decisions.filter(c => c && c.value !== null).map(c => c!.value)
        const consistent = new Set(acceptedValues).size <= 1
        const decision = extraction.confirmations?.find(c => c.field === field)
        const resolution = decision && consistent ? (decision.value === null ? 'REJECTED' : 'ACCEPTED') : 'PENDING'
        extraction.conflicts.push({ field, values, resolution })
      }
      if (!['FAILED', 'MANUAL_REVIEW'].includes(extraction.status ?? '')) {
        const allConfirmed = Object.keys(extraction.candidates).length > 0 && Object.keys(extraction.candidates).every(field => extraction.confirmations?.some(c => c.field === field))
        extraction.status = allConfirmed && !extraction.conflicts.some(c => c.resolution === 'PENDING') ? 'SUCCEEDED' : 'NEEDS_CONFIRMATION'
      }
      await tx.update('mastersDocuments', document.id, { extraction, extractionStatus: extraction.status ?? document.extractionStatus, updatedAt: now })
    }
  }

  private async requiredFields(tx: StoreTransaction, consultation: MastersConsultation): Promise<string[]> {
    await this.requireActiveConsent(tx, consultation)
    return requiredFields(consultation.profile)
  }

  private async readinessTx(tx: StoreTransaction, consultation: MastersConsultation) {
    const consent = consultation.serviceConsentId ? await tx.findById('mastersConsents', consultation.serviceConsentId) : null
    const documents = await tx.findMany('mastersDocuments', { consultationId: consultation.id })
    return calculateReadiness(consultation.profile, documents, Boolean(consent && consent.accepted && !consent.withdrawnAt), consultation.status === 'WITHDRAWN')
  }

  /** Create or requeue exactly one durable job for a confirmed snapshot. */
  private async ensureReportJob(tx: StoreTransaction, consultation: MastersConsultation, snapshot: MastersSnapshot, actorUserId: string | null): Promise<MastersReportJob> {
    const existing = (await tx.findMany('mastersReportJobs', { consultationId: consultation.id }))
      .find((job) => job.snapshotId === snapshot.id)
    if (existing) {
      if (existing.status === 'QUEUED' || existing.status === 'RUNNING' || existing.status === 'NEEDS_REVIEW') return existing
      if (existing.status === 'FAILED' && existing.attempts < existing.maxAttempts) {
        const now = iso(this.clock)
        const requeued = await tx.update('mastersReportJobs', existing.id, { status: 'QUEUED', nextAttemptAt: now, lastError: null, completedAt: null, updatedAt: now })
        await tx.update('mastersReports', existing.reportId, { status: 'QUEUED', updatedAt: now })
        return requeued
      }
      throw new AppError(409, 'MASTERS_REPORT_RETRY_EXHAUSTED', '报告任务重试次数已用尽，请由工作台人工处理')
    }
    const now = iso(this.clock)
    const latestReports = await tx.findMany('mastersReports', { consultationId: consultation.id })
    const nextVersion = latestReports.reduce((max, report) => Math.max(max, report.version), 0) + 1
    const readiness = await this.readinessTx(tx, consultation)
    const payload = reportTemplate(snapshot.profile, readiness)
    const report = await tx.insert('mastersReports', {
      id: this.ids('mrpt'), consultationId: consultation.id, snapshotId: snapshot.id, sourceProfileVersion: snapshot.profileVersion,
      version: nextVersion, status: 'QUEUED', templateVersion: MASTERS_REPORT_TEMPLATE_VERSION, payload,
      editedBy: null, reviewedBy: null, approvedBy: null, releasedBy: null, reviewedAt: null, approvedAt: null,
      releasedAt: null, createdAt: now, updatedAt: now
    })
    const job = await tx.insert('mastersReportJobs', {
      id: this.ids('mrjob'), consultationId: consultation.id, snapshotId: snapshot.id, sourceProfileVersion: snapshot.profileVersion,
      reportId: report.id, status: 'QUEUED', attempts: 0, maxAttempts: this.maxAttempts, leaseToken: null,
      leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: now, lastError: null, createdAt: now, updatedAt: now, completedAt: null
    })
    if (actorUserId) await this.audit(tx, actorUserId, consultation.id, 'REPORT_ENQUEUED', { jobId: job.id, reportId: report.id, sourceProfileVersion: snapshot.profileVersion }, now)
    return job
  }

  private async detailTx(tx: StoreTransaction, consultation: MastersConsultation, actorUserId: string, internal: boolean): Promise<DetailResult> {
    const lastRequest = (await tx.findMany('mastersAuditLogs', { consultationId: consultation.id, action: 'DOCUMENTS_REQUESTED' })).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    const documentRequest = lastRequest && consultation.status !== 'WITHDRAWN' ? {
      types: Array.isArray(lastRequest.metadata.types) ? lastRequest.metadata.types as MastersDocumentType[] : [],
      note: typeof lastRequest.metadata.note === 'string' ? lastRequest.metadata.note : '', requestedAt: lastRequest.createdAt
    } : null
    const allDocuments = await tx.findMany('mastersDocuments', { consultationId: consultation.id })
    const activeDocuments = allDocuments.filter((document) => document.uploadStatus === 'UPLOADED' && !document.removedAt)
    const consent = consultation.serviceConsentId ? await tx.findById('mastersConsents', consultation.serviceConsentId) : null
    const assignments = await tx.findMany('mastersAssignments', { consultationId: consultation.id })
    const reports = await tx.findMany('mastersReports', { consultationId: consultation.id })
    const currentReport = reports.sort((left, right) => right.version - left.version)[0] ?? null
    const readiness = calculateReadiness(consultation.profile, activeDocuments, Boolean(consent && consent.accepted && !consent.withdrawnAt), consultation.status === 'WITHDRAWN')
    // A withdrawn consultation may still appear in a staff list for audit
    // purposes, but its applicant payload and original materials are no
    // longer readable through the domain service.
    if (consultation.status === 'WITHDRAWN' || consultation.withdrawnAt) {
      const redactedReport = currentReport
        ? ({
            id: currentReport.id, consultationId: currentReport.consultationId, snapshotId: currentReport.snapshotId,
            sourceProfileVersion: currentReport.sourceProfileVersion, version: currentReport.version,
            status: currentReport.status, templateVersion: currentReport.templateVersion, updatedAt: currentReport.updatedAt
          } as unknown as MastersReport)
        : null
      return {
        ...consultation, profile: {}, serviceConsentId: null, confirmedSnapshotId: null,
        documents: [], consent: null, assignments: [], currentReport: redactedReport,
        ...readiness
      } as DetailResult
    }
    if (internal) {
      return {
        ...consultation, ...readiness, documentRequest, documents: activeDocuments, consent, assignments,
        currentReport
      }
    }
    // Student DTOs never expose storageKey/userId, consent hashes, assignment
    // identities or non-released report payloads.  The structural type is kept
    // compatible with the HTTP projection while the runtime object is narrow.
    const documents = activeDocuments.map((document) => {
      const { storageKey: _storageKey, userId: _userId, ...safe } = document
      return safe as unknown as MastersDocument
    })
    const safeConsent = consent ? {
      id: consent.id, copyVersion: consent.copyVersion, locale: consent.locale,
      accepted: true as const, grantedAt: consent.grantedAt, withdrawnAt: consent.withdrawnAt
    } : null
    const safeAssignments = assignments.map((assignment) => ({ id: assignment.id, status: assignment.status, assignedAt: assignment.assignedAt, endedAt: assignment.endedAt }))
    const safeReport = currentReport && currentReport.status === 'RELEASED'
      ? currentReport
      : currentReport ? ({ id: currentReport.id, consultationId: currentReport.consultationId, snapshotId: currentReport.snapshotId, sourceProfileVersion: currentReport.sourceProfileVersion, version: currentReport.version, status: currentReport.status, templateVersion: currentReport.templateVersion, updatedAt: currentReport.updatedAt } as unknown as MastersReport)
      : null
    return { ...consultation, ...readiness, documentRequest, documents, consent: safeConsent, assignments: safeAssignments, currentReport: safeReport }
  }

  private async markReportsStale(tx: StoreTransaction, consultationId: string, now: string, reason: string): Promise<void> {
    const jobs = await tx.findMany('mastersReportJobs', { consultationId })
    for (const job of jobs.filter((item) => item.status === 'QUEUED' || item.status === 'RUNNING' || item.status === 'FAILED' || item.status === 'NEEDS_REVIEW')) await tx.update('mastersReportJobs', job.id, { status: 'STALE', leaseToken: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
    const reports = await tx.findMany('mastersReports', { consultationId })
    for (const report of reports.filter((item) => item.status !== 'STALE')) await tx.update('mastersReports', report.id, { status: 'STALE', updatedAt: now })
    await this.audit(tx, null, consultationId, 'REPORTS_MARKED_STALE', { reason }, now)
  }

  private async reportForVersion(tx: StoreTransaction, consultation: MastersConsultation, version: number, reportId?: string): Promise<MastersReport> {
    const report = reportId ? await tx.findById('mastersReports', reportId) : (await tx.findMany('mastersReports', { consultationId: consultation.id })).filter((item) => item.version === version)[0]
    invariant(report?.consultationId === consultation.id && report.version === version, 404, 'MASTERS_REPORT_NOT_FOUND', '指定报告版本不存在')
    invariant(report.sourceProfileVersion === consultation.profileVersion && report.status !== 'STALE', 409, 'MASTERS_REPORT_STALE', '报告所依据的资料已变化')
    return report
  }

  private async decideReport(actorUserId: string, consultationId: string, rawInput: MastersReportDecisionInput | unknown, decision: 'APPROVED' | 'RETURNED' | 'RELEASED'): Promise<MastersReport> {
    const input = this.parseReportDecision(rawInput)
    return this.store.transaction(async (tx) => {
      const consultation = await this.getInternalConsultation(tx, actorUserId, consultationId, `report_${decision.toLowerCase()}`, true)
      const staff = await this.requireStaff(tx, actorUserId, ['founder'])
      const report = await this.reportForVersion(tx, consultation, input.version, input.reportId)
      const now = iso(this.clock)
      if (decision === 'APPROVED') {
        invariant(report.status === 'NEEDS_REVIEW', 409, 'MASTERS_REPORT_APPROVAL_INVALID_STATE', '报告当前状态不允许批准')
        invariant(report.reviewedBy !== null && report.reviewedAt !== null, 409, 'MASTERS_REPORT_REVIEW_REQUIRED', '报告必须先由当前顾问完成复核')
        const reviewerStaff = await tx.findOne('mastersStaff', { userId: report.reviewedBy, role: 'advisor', status: 'ACTIVE' })
        invariant(reviewerStaff, 409, 'MASTERS_REPORT_REVIEW_REQUIRED', '报告复核人不是有效顾问')
        const reviewerAssignment = await tx.findOne('mastersAssignments', { consultationId: consultation.id, advisorUserId: report.reviewedBy, status: 'ACTIVE' })
        invariant(reviewerAssignment, 409, 'MASTERS_REPORT_REVIEW_REQUIRED', '报告复核人未被分配到该咨询')
        assertReportSources(report.payload, consultation.applicationSeason, now)
        const updated = await tx.update('mastersReports', report.id, { status: 'APPROVED', approvedBy: staff.userId, approvedAt: now, updatedAt: now })
        await this.audit(tx, actorUserId, consultation.id, 'REPORT_APPROVED', { reportId: report.id, version: report.version, note: input.note ?? '' }, now)
        return updated
      }
      if (decision === 'RELEASED') {
        invariant(report.status === 'APPROVED', 409, 'MASTERS_REPORT_RELEASE_INVALID_STATE', '只有已批准报告可以开放')
        assertReportSources(report.payload, consultation.applicationSeason, now)
        invariant(report.sourceProfileVersion === consultation.profileVersion, 409, 'MASTERS_REPORT_STALE', '报告所依据的资料已变化')
        const updated = await tx.update('mastersReports', report.id, { status: 'RELEASED', releasedBy: staff.userId, releasedAt: now, updatedAt: now })
        await this.audit(tx, actorUserId, consultation.id, 'REPORT_RELEASED', { reportId: report.id, version: report.version }, now)
        return updated
      }
      invariant(report.status === 'NEEDS_REVIEW' || report.status === 'APPROVED', 409, 'MASTERS_REPORT_RETURN_INVALID_STATE', '报告当前状态不允许退回')
      const updated = await tx.update('mastersReports', report.id, {
        status: 'NEEDS_REVIEW', reviewedBy: null, reviewedAt: null, approvedBy: null, approvedAt: null,
        releasedBy: null, releasedAt: null, updatedAt: now
      })
      await this.audit(tx, actorUserId, consultation.id, 'REPORT_RETURNED', { reportId: report.id, version: report.version, note: input.note ?? '' }, now)
      return updated
    })
  }

  private async audit(tx: StoreTransaction, actorUserId: string | null, consultationId: string | null, action: string, metadata: RecordValue, now: string): Promise<MastersAuditLog> {
    return tx.insert('mastersAuditLogs', { id: this.ids('maud'), consultationId, actorUserId, action, metadata, createdAt: now })
  }

  private async beginIdempotency(tx: StoreTransaction, userId: string, domain: MastersIdempotencyDomain, key: string | undefined, input: unknown): Promise<{ record: MastersIdempotencyRecord; replay: boolean } | null> {
    if (key === undefined) return null
    const keyDigest = sha256(key)
    const inputDigest = sha256(canonicalJson(input))
    const found = await tx.findOne('mastersIdempotencyRecords', { userId, domain, keyDigest }, { forUpdate: true })
    if (found) {
      invariant(found.inputDigest === inputDigest, 409, 'IDEMPOTENCY_KEY_REUSED', '相同 Idempotency-Key 已用于不同输入')
      invariant(found.status === 'COMPLETED' && found.resourceId, 409, 'IDEMPOTENCY_IN_PROGRESS', '幂等请求仍在处理中')
      return { record: found, replay: true }
    }
    const now = iso(this.clock)
    const record = await tx.insert('mastersIdempotencyRecords', {
      id: this.ids('mide'), userId, domain, keyDigest, inputDigest, status: 'IN_PROGRESS', resourceType: null,
      resourceId: null, responseStatus: null, createdAt: now, updatedAt: now, completedAt: null
    })
    return { record, replay: false }
  }

  private async finishIdempotency(tx: StoreTransaction, recordId: string, resourceType: string, resourceId: string, responseStatus: number): Promise<void> {
    const now = iso(this.clock)
    await tx.update('mastersIdempotencyRecords', recordId, { status: 'COMPLETED', resourceType, resourceId, responseStatus, updatedAt: now, completedAt: now })
  }

  private parseRequestDocuments(raw: MastersRequestDocumentsInput | MastersDocumentTypeAlias[] | string): MastersRequestDocumentsInput {
    if (Array.isArray(raw)) return { types: raw }
    if (typeof raw === 'string') return { types: [raw as MastersDocumentTypeAlias] }
    if (!isObject(raw)) throw new AppError(400, 'MASTERS_REQUEST_DOCUMENTS_INVALID', '补件参数无效')
    for (const key of Object.keys(raw)) invariant(key === 'types' || key === 'note', 400, 'MASTERS_REQUEST_DOCUMENTS_INVALID', `不支持字段: ${key}`)
    if (raw.types !== undefined) invariant(Array.isArray(raw.types), 400, 'MASTERS_REQUEST_DOCUMENTS_INVALID', 'types 必须是数组')
    const types = raw.types === undefined ? undefined : (raw.types as unknown[]).map((item) => {
      normalizeDocumentType(item); return item as MastersDocumentTypeAlias
    })
    const note = raw.note === undefined ? undefined : nonEmpty(raw.note, 'MASTERS_REQUEST_DOCUMENTS_INVALID', 'note 不能为空', 2000)
    return { ...(types ? { types } : {}), ...(note ? { note } : {}) }
  }

  private parseEnqueueInput(raw: { version?: number; idempotencyKey?: string } | number | string | undefined): { version?: number; idempotencyKey?: string } {
    if (raw === undefined) return {}
    if (typeof raw === 'number') return { version: raw }
    if (typeof raw === 'string') return { idempotencyKey: raw }
    invariant(isObject(raw), 400, 'MASTERS_REPORT_ENQUEUE_INVALID', '报告入队参数无效')
    for (const key of Object.keys(raw)) invariant(key === 'version' || key === 'idempotencyKey', 400, 'MASTERS_REPORT_ENQUEUE_INVALID', `不支持字段: ${key}`)
    const version = raw.version === undefined ? undefined : Number(raw.version)
    if (version !== undefined) invariant(Number.isInteger(version) && version >= 1, 400, 'MASTERS_VERSION_INVALID', '资料版本无效')
    const idempotencyKey = raw.idempotencyKey === undefined ? undefined : stringKey(raw.idempotencyKey, 'Idempotency-Key')
    return { ...(version !== undefined ? { version } : {}), ...(idempotencyKey !== undefined ? { idempotencyKey } : {}) }
  }

  private parseReportEdit(raw: MastersReportEditInput | unknown): MastersReportEditInput {
    invariant(isObject(raw), 400, 'MASTERS_REPORT_PAYLOAD_INVALID', '报告编辑参数无效')
    for (const key of Object.keys(raw)) invariant(['version', 'reportId', 'payload'].includes(key), 400, 'MASTERS_REPORT_PAYLOAD_INVALID', `不支持字段: ${key}`)
    const version = Number(raw.version)
    invariant(Number.isInteger(version) && version >= 1, 400, 'MASTERS_VERSION_INVALID', '报告版本无效')
    const reportId = raw.reportId === undefined ? undefined : nonEmpty(raw.reportId, 'MASTERS_REPORT_PAYLOAD_INVALID', 'reportId 无效', 200)
    return { version, ...(reportId ? { reportId } : {}), payload: exactReportPatch(raw.payload) }
  }

  private parseReportDecision(raw: MastersReportReviewInput | MastersReportDecisionInput | unknown): { version: number; reportId?: string; note?: string } {
    invariant(isObject(raw), 400, 'MASTERS_REPORT_DECISION_INVALID', '报告操作参数无效')
    for (const key of Object.keys(raw)) invariant(['version', 'reportId', 'note'].includes(key), 400, 'MASTERS_REPORT_DECISION_INVALID', `不支持字段: ${key}`)
    const version = Number(raw.version)
    invariant(Number.isInteger(version) && version >= 1, 400, 'MASTERS_VERSION_INVALID', '报告版本无效')
    const reportId = raw.reportId === undefined ? undefined : nonEmpty(raw.reportId, 'MASTERS_REPORT_DECISION_INVALID', 'reportId 无效', 200)
    const note = raw.note === undefined ? undefined : nonEmpty(raw.note, 'MASTERS_REPORT_DECISION_INVALID', 'note 不能为空', 5000)
    return { version, ...(reportId ? { reportId } : {}), ...(note ? { note } : {}) }
  }
}

function mergeReportWithPatch(current: MastersReportPayload, patch: Partial<MastersReportPayload>): MastersReportPayload {
  const next: MastersReportPayload = {
    ...current,
    ...patch,
    strengthsAndGaps: { ...current.strengthsAndGaps, ...(patch.strengthsAndGaps ?? {}) },
    candidatePrograms: patch.candidatePrograms ?? current.candidatePrograms,
    suggestedDirections: patch.suggestedDirections ?? current.suggestedDirections,
    preparationPlan: patch.preparationPlan ?? current.preparationPlan,
    nextStepsAndLimitations: patch.nextStepsAndLimitations ?? current.nextStepsAndLimitations,
    missingFields: patch.missingFields ?? current.missingFields,
    missingDocuments: patch.missingDocuments ?? current.missingDocuments
  }
  return structuredClone(next)
}

function emptyReportPayload(): MastersReportPayload {
  return {
    templateVersion: MASTERS_REPORT_TEMPLATE_VERSION, backgroundSummary: '', strengthsAndGaps: { strengths: [], gaps: [] },
    suggestedDirections: [], candidatePrograms: [], preparationPlan: [], nextStepsAndLimitations: [], missingFields: [],
    missingDocuments: [], verificationStatus: 'NEEDS_REVIEW'
  }
}
