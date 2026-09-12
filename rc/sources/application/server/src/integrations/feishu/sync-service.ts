import { createHash, createHmac, randomUUID } from 'node:crypto'
import { AppError, invariant } from '../../domain/errors'
import { FeishuEntityType, IntegrationLink } from '../../domain/model'
import { isExactActiveFeishuProfileConsent } from '../../domain/education-compass/consent-policy'
import { Store, StoreTransaction } from '../../store/store'
import { Clock, IdFactory, iso, randomId, systemClock } from '../../utils/runtime'
import { FeishuApiError, FeishuBitableGateway, FeishuRecordFields } from './bitable-client'
import {
  assertFeishuProjectionFields,
  CUSTOMER_PROFILE_FEISHU_ALLOWLISTS,
  CUSTOMER_PROFILE_FEISHU_CORE_FIELDS,
  FEISHU_TABLE_CONTRACTS,
  requiredFeishuSchemaFields
} from './schema-contract'

const PROJECTION_VERSION = 'phoenix_feishu_ops_v1'
const PROCESSING_LEASE_MS = 120_000
const MAX_SCAN_ROWS = 10_000
const SCHEMA_VALIDATION_TTL_MS = 15 * 60_000

interface Projection {
  entityType: FeishuEntityType
  entityId: string
  tableId: string
  uniqueField: string
  fields: FeishuRecordFields
  sourceUpdatedAt: string
  consentFamilyId?: string
  consentStudentId?: string | null
  v05ConsentBoundProfile: boolean
}

interface SyncClaim {
  link: IntegrationLink
  fields: FeishuRecordFields
  payloadDigest: string
  requestBody: string
}

export interface FeishuSyncResult {
  enabled: boolean
  discovered: number
  attempted: number
  succeeded: number
  failed: number
  skipped: number
}

function compact(input: Record<string, string | number | boolean | string[] | null | undefined>): FeishuRecordFields {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== undefined && value !== '')) as FeishuRecordFields
}

function digest(fields: FeishuRecordFields): string {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex')
}

export class FeishuSyncService {
  private running = false
  private schemaState: 'DISABLED' | 'UNKNOWN' | 'VALID' | 'INVALID'
  private schemaErrorCode: string | null = null
  private schemaCheckedAt: string | null = null
  private schemaValidatedAtMs = 0

  constructor(
    private readonly store: Store,
    private readonly gateway: FeishuBitableGateway | null,
    private readonly tables: Record<FeishuEntityType, string>,
    private readonly pseudonymKey: string,
    private readonly environment: string,
    private readonly defaultBatchSize = 50,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdFactory = randomId,
    private readonly customerProfileFieldsEnabled = false
  ) {
    if (gateway) {
      invariant(Buffer.byteLength(pseudonymKey, 'utf8') >= 32, 500, 'FEISHU_PSEUDONYM_KEY_INVALID', '飞书伪名密钥至少需要32字节')
      invariant(environment.trim().length > 0, 500, 'FEISHU_ENVIRONMENT_INVALID', '飞书同步环境标识无效')
    }
    this.schemaState = gateway ? 'UNKNOWN' : 'DISABLED'
  }

  get enabled(): boolean { return this.gateway !== null }

  async manualReconcile(actorUserId: string, limit = this.defaultBatchSize): Promise<FeishuSyncResult> {
    invariant(actorUserId.length > 0, 401, 'AUTH_REQUIRED', '请先登录')
    invariant(Number.isInteger(limit) && limit > 0 && limit <= 200, 400, 'FEISHU_SYNC_LIMIT_INVALID', '飞书同步批量上限无效')
    const now = iso(this.clock)
    await this.store.transaction(async (tx) => {
      const blocked = await tx.findMany('integrationLinks', { provider: 'feishu_bitable', status: 'BLOCKED' })
      const retryableBlocked = blocked.filter((link) => link.lastErrorCode !== 'FEISHU_CONSENT_WITHDRAWN')
      for (const link of retryableBlocked) await tx.update('integrationLinks', link.id, { status: 'FAILED', nextAttemptAt: null, updatedAt: now })
      await tx.insert('auditLogs', {
        id: this.ids('aud'), actorUserId, action: 'FEISHU_RECONCILE_REQUESTED',
        entityType: 'integration', entityId: 'feishu_bitable', metadata: { limit, requeuedBlocked: retryableBlocked.length }, createdAt: now
      })
    })
    return this.reconcile(limit)
  }

  private pseudonym(entityType: FeishuEntityType, entityId: string): string {
    if (!entityId) return ''
    return `PHX-${createHmac('sha256', this.pseudonymKey)
      .update(`${this.environment}:${entityType}:${entityId}`)
      .digest('hex').slice(0, 24)}`
  }

  async reconcile(limit = this.defaultBatchSize): Promise<FeishuSyncResult> {
    invariant(Number.isInteger(limit) && limit > 0 && limit <= 200, 400, 'FEISHU_SYNC_LIMIT_INVALID', '飞书同步批量上限无效')
    if (!this.gateway) return { enabled: false, discovered: 0, attempted: 0, succeeded: 0, failed: 0, skipped: 0 }
    if (this.running) return { enabled: true, discovered: 0, attempted: 0, succeeded: 0, failed: 0, skipped: 0 }
    this.running = true
    try {
      if (this.gateway.listFields && this.clock().getTime() - this.schemaValidatedAtMs >= SCHEMA_VALIDATION_TTL_MS) {
        await this.validateSchema()
      }
      if (this.gateway.listFields) {
        invariant(this.schemaState === 'VALID', 503, this.schemaErrorCode ?? 'FEISHU_SCHEMA_INVALID', '飞书字段合同未通过校验')
      }
      const projections = await this.collectProjections()
      let attempted = 0
      let succeeded = 0
      let failed = 0
      let skipped = 0
      for (const projection of projections) {
        if (attempted >= limit) break
        const payloadDigest = digest(projection.fields)
        let claim: SyncClaim | null
        try {
          claim = await this.claim(projection, payloadDigest)
        } catch (error) {
          if (error instanceof AppError && ['UNIQUE_CONSTRAINT', 'DUPLICATE_INTEGRATION_LINK'].includes(error.code)) {
            skipped += 1
            continue
          }
          throw error
        }
        if (!claim) { skipped += 1; continue }
        attempted += 1
        try {
          if (!(await this.hasActiveProjectionConsent(projection))) {
            await this.fenceConsentWithdrawal(claim.link)
            skipped += 1
            attempted -= 1
            continue
          }
          const result = await this.gateway.upsertRecord({
            tableId: projection.tableId,
            uniqueField: projection.uniqueField,
            uniqueValue: String(claim.fields[projection.uniqueField] ?? ''),
            clientToken: claim.link.operationToken ?? '',
            knownRecordId: claim.link.externalRecordId ?? null,
            fields: claim.fields,
            requestBody: claim.requestBody
          })
          await this.complete(claim.link, result.recordId, claim.payloadDigest)
          succeeded += 1
        } catch (error) {
          await this.fail(claim.link, error)
          failed += 1
        }
      }
      return { enabled: true, discovered: projections.length, attempted, succeeded, failed, skipped }
    } finally {
      this.running = false
    }
  }

  async status(): Promise<Record<string, unknown>> {
    const links = await this.store.read((tx) => tx.findMany('integrationLinks', { provider: 'feishu_bitable' }))
    const counts = { PENDING: 0, PROCESSING: 0, SYNCED: 0, FAILED: 0, BLOCKED: 0 }
    links.forEach((link) => { counts[link.status] += 1 })
    const lastSyncedAt = links.map((link) => link.lastSyncedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null
    return {
      enabled: this.enabled,
      projectionVersion: PROJECTION_VERSION,
      customerProfileFieldsEnabled: this.customerProfileFieldsEnabled,
      configuredEntities: Object.entries(this.tables).filter(([, tableId]) => Boolean(tableId)).map(([entityType]) => entityType),
      schema: { state: this.schemaState, checkedAt: this.schemaCheckedAt, errorCode: this.schemaErrorCode },
      counts,
      lastSyncedAt
    }
  }

  async validateSchema(): Promise<{ state: 'DISABLED' | 'VALID' | 'INVALID'; checkedAt: string; errorCode: string | null }> {
    const checkedAt = iso(this.clock)
    this.schemaCheckedAt = checkedAt
    if (!this.gateway) {
      this.schemaState = 'DISABLED'
      return { state: 'DISABLED', checkedAt, errorCode: null }
    }
    if (!this.gateway.listFields) {
      this.schemaState = 'INVALID'
      this.schemaErrorCode = 'FEISHU_SCHEMA_INSPECTION_UNAVAILABLE'
      throw new AppError(503, this.schemaErrorCode, '飞书字段合同无法校验')
    }
    try {
      for (const [entityType, tableId] of Object.entries(this.tables) as Array<[FeishuEntityType, string]>) {
        const remoteFields = await this.gateway.listFields(tableId)
        const contract = FEISHU_TABLE_CONTRACTS[entityType]
        const byName = new Map(remoteFields.map((field) => [field.name, field]))
        for (const [fieldName, kind] of Object.entries(requiredFeishuSchemaFields(entityType, this.customerProfileFieldsEnabled))) {
          const remote = byName.get(fieldName)
          invariant(remote, 503, 'FEISHU_SCHEMA_FIELD_MISSING', '飞书字段合同缺少必需字段')
          const expectedType = kind === 'number' ? 2 : 1
          invariant(remote.type === expectedType, 503, 'FEISHU_SCHEMA_FIELD_TYPE_MISMATCH', '飞书字段类型与合同不一致')
        }
        const primary = byName.get(contract.primaryField)
        invariant(primary?.isPrimary === true, 503, 'FEISHU_SCHEMA_PRIMARY_FIELD_MISMATCH', '飞书主字段与合同不一致')
      }
      this.schemaState = 'VALID'
      this.schemaErrorCode = null
      this.schemaValidatedAtMs = this.clock().getTime()
      return { state: 'VALID', checkedAt, errorCode: null }
    } catch (error) {
      this.schemaState = 'INVALID'
      this.schemaErrorCode = error instanceof AppError ? error.code : 'FEISHU_SCHEMA_VALIDATION_FAILED'
      this.schemaValidatedAtMs = this.clock().getTime()
      throw error
    }
  }

  private async collectProjections(): Promise<Projection[]> {
    const snapshot = await this.store.read(async (tx) => ({
      families: await tx.findMany('families'),
      students: await tx.findMany('students'),
      assessments: await tx.findMany('assessments'),
      reports: await tx.findMany('reports'),
      orders: await tx.findMany('orders'),
      feedback: await tx.findMany('feedback'),
      advisorRequests: await tx.findMany('advisorRequests'),
      consentGrants: await tx.findMany('consentGrants')
    }))
    const projections: Projection[] = []
    const add = (
      entityType: FeishuEntityType,
      entityId: string,
      uniqueField: string,
      sourceUpdatedAt: string,
      values: Parameters<typeof compact>[0],
      consent?: { familyId: string; studentId?: string | null },
      v05ConsentBoundProfile = false
    ): void => {
      const tableId = this.tables[entityType]
      if (!tableId) return
      const contract = FEISHU_TABLE_CONTRACTS[entityType]
      invariant(uniqueField === contract.primaryField, 500, 'FEISHU_PRIMARY_FIELD_MISMATCH', '飞书投影主键与字段合同不一致')
      for (const fieldName of Object.keys(values)) {
        invariant(Object.hasOwn(contract.fields, fieldName), 500, 'FEISHU_PROJECTION_FIELD_FORBIDDEN', '飞书投影包含未授权字段')
      }
      invariant(!v05ConsentBoundProfile || Boolean(consent), 500,
        'FEISHU_V05_PROFILE_CONSENT_MISSING', 'V0.5 飞书资料投影缺少授权绑定')
      const fields = v05ConsentBoundProfile
        ? compact(values)
        : compact({ ...values, schema_version: PROJECTION_VERSION, source_updated_at: sourceUpdatedAt })
      this.assertProjectionFields(entityType, fields, v05ConsentBoundProfile)
      projections.push({
        entityType, entityId, tableId, uniqueField, sourceUpdatedAt,
        fields, v05ConsentBoundProfile,
        ...(consent ? { consentFamilyId: consent.familyId, consentStudentId: consent.studentId ?? null } : {})
      })
    }
    const v05Assessments = snapshot.assessments.filter((item) =>
      item.assessmentKind === 'FREE_PARENT_COMPASS' || item.assessmentKind === 'STUDENT_GROWTH_DISCOVERY')
    const v05StudentIds = new Set([
      ...v05Assessments.map((item) => item.studentId),
      ...snapshot.students.filter((item) =>
        item.profileStatus === 'PROVISIONAL' || item.profileStatus === 'COMPLETE' ||
        Boolean(item.profileSchemaVersion && !item.profileSchemaVersion.startsWith('legacy_'))
      ).map((item) => item.id)
    ])
    const v05FamilyIds = new Set([
      ...v05Assessments.map((item) => item.familyId),
      ...snapshot.families.filter((item) =>
        item.profileStatus === 'PROVISIONAL' || item.profileStatus === 'COMPLETE' ||
        Boolean(item.profileSchemaVersion && !item.profileSchemaVersion.startsWith('legacy_'))
      ).map((item) => item.id),
      ...snapshot.students.filter((item) => v05StudentIds.has(item.id)).map((item) => item.familyId)
    ])
    const activeMirrorConsents = snapshot.consentGrants.filter((item) =>
      Boolean(item.studentId) && isExactActiveFeishuProfileConsent(item, item.familyId, item.studentId as string))
    const mirrorConsentByStudent = new Map(activeMirrorConsents
      .filter((item) => Boolean(item.studentId))
      .map((item) => [item.studentId as string, item]))
    const mirrorConsentByFamily = new Map(activeMirrorConsents.map((item) => [item.familyId, item]))
    const allowedV05Family = (familyId: string): boolean =>
      this.customerProfileFieldsEnabled && mirrorConsentByFamily.has(familyId)
    const allowedV05Student = (studentId: string): boolean =>
      this.customerProfileFieldsEnabled && mirrorConsentByStudent.has(studentId)
    const advisorStatus = (familyId: string, studentId?: string | null): string => {
      const requests = snapshot.advisorRequests.filter((request) =>
        request.familyId === familyId &&
        request.status !== 'CANCELLED_BY_CONSENT_WITHDRAWAL' &&
        (!studentId || !request.studentId || request.studentId === studentId))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      return requests[0]?.status ?? 'NONE'
    }

    snapshot.families.forEach((item) => {
      const isV05 = v05FamilyIds.has(item.id)
      const mirrorConsent = mirrorConsentByFamily.get(item.id)
      if (!isV05) {
        const includeOptional = this.customerProfileFieldsEnabled && Boolean(mirrorConsent)
        add('family_profile', item.id, 'family_id', item.updatedAt, {
          family_id: this.pseudonym('family_profile', item.id),
          status: 'ACTIVE',
          created_at: item.createdAt,
          ...(includeOptional ? {
            family_name: item.familyName,
            parent_name: item.parentName,
            phone: item.phone,
            location: item.location,
            goal: item.goal
          } : {})
        }, includeOptional && mirrorConsent
          ? { familyId: item.id, studentId: mirrorConsent.studentId ?? null }
          : undefined)
        return
      }
      if (!allowedV05Family(item.id) || !mirrorConsent) return
      const consentStudent = mirrorConsent?.studentId
        ? snapshot.students.find((student) => student.id === mirrorConsent.studentId)
        : null
      const includeOptional = Boolean(mirrorConsent) && consentStudent?.profileStatus !== 'PROVISIONAL'
      add('family_profile', item.id, 'family_id', item.updatedAt, {
        family_id: this.pseudonym('family_profile', item.id),
        source_entry: mirrorConsent.sourceEntry,
        advisor_status: advisorStatus(item.id, mirrorConsent.studentId),
        consent_state: 'ACTIVE',
        updated_at: item.updatedAt,
        ...(includeOptional ? {
          family_display_name: item.familyName,
          guardian_display_name: item.parentName,
          guardian_phone: item.phone,
          city_region: item.location
        } : {})
      }, { familyId: item.id, studentId: mirrorConsent.studentId ?? null }, true)
    })
    snapshot.students.forEach((item) => {
      const isV05 = v05StudentIds.has(item.id)
      const mirrorConsent = mirrorConsentByStudent.get(item.id)
      if (!isV05) {
        const includeOptional = this.customerProfileFieldsEnabled && Boolean(mirrorConsent)
        add('student_profile', item.id, 'student_id', item.updatedAt, {
          student_id: this.pseudonym('student_profile', item.id),
          family_id: this.pseudonym('family_profile', item.familyId),
          student_version: item.studentVersion,
          created_at: item.createdAt,
          ...(includeOptional ? {
            student_name: item.name,
            age: item.age,
            gender: item.gender,
            school: item.school,
            education_system: item.educationSystem,
            grade: item.grade,
            interest: item.interest,
            goal: item.goal
          } : {})
        }, includeOptional && mirrorConsent
          ? { familyId: item.familyId, studentId: item.id }
          : undefined)
        return
      }
      if (!allowedV05Student(item.id) || !mirrorConsent) return
      const includeOptional = this.customerProfileFieldsEnabled && Boolean(mirrorConsent) && item.profileStatus !== 'PROVISIONAL'
      add('student_profile', item.id, 'student_id', item.updatedAt, {
        student_id: this.pseudonym('student_profile', item.id),
        family_id: this.pseudonym('family_profile', item.familyId),
        source_entry: mirrorConsent.sourceEntry,
        advisor_status: advisorStatus(item.familyId, item.id),
        consent_state: 'ACTIVE',
        updated_at: item.updatedAt,
        ...(includeOptional ? {
          student_display_name: item.name,
          education_system: item.educationSystem,
          grade_stage: item.gradeStage ?? item.grade
        } : {})
      }, { familyId: item.familyId, studentId: item.id }, true)
    })
    snapshot.assessments.filter((item) =>
      item.assessmentKind !== 'FREE_PARENT_COMPASS' && item.assessmentKind !== 'STUDENT_GROWTH_DISCOVERY'
    ).forEach((item) => add('assessment_session', item.id, 'session_id', item.updatedAt, {
      session_id: this.pseudonym('assessment_session', item.id),
      family_id: this.pseudonym('family_profile', item.familyId),
      student_id: this.pseudonym('student_profile', item.studentId),
      questionnaire_version: item.questionnaireVersion, student_version: item.studentVersion,
      status: item.status, completeness: item.completenessScore,
      submitted_at: item.submittedAt, created_at: item.createdAt
    }))
    const v05ReportIds = new Set(snapshot.reports.filter((item) =>
      item.reportKind === 'FAMILY_EDUCATION_SNAPSHOT' || item.reportKind === 'STUDENT_GROWTH_DISCOVERY'
    ).map((item) => item.id))
    snapshot.reports.filter((item) => !v05ReportIds.has(item.id)).forEach((item) => add('report_job', item.id, 'report_id', item.updatedAt, {
      report_id: this.pseudonym('report_job', item.id),
      family_id: this.pseudonym('family_profile', item.familyId),
      student_id: this.pseudonym('student_profile', item.studentId),
      assessment_id: this.pseudonym('assessment_session', item.assessmentId), status: item.status, delivery_status: item.deliveryStatus,
      qa_status: item.qaPassed ? 'PASSED' : 'PENDING', data_version: item.versions.dataVersion,
      rule_version: item.versions.ruleVersion, prompt_version: item.versions.promptVersion,
      template_version: item.versions.templateVersion, source_catalog_version: item.sourceCatalogVersion,
      data_as_of: item.dataAsOf, created_at: item.createdAt
    }))
    snapshot.orders.filter((item) =>
      item.productCode !== 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1' && !v05ReportIds.has(item.reportId)
    ).forEach((item) => add('order_payment', item.id, 'order_id', item.updatedAt, {
      order_id: this.pseudonym('order_payment', item.id),
      family_id: this.pseudonym('family_profile', item.familyId),
      student_id: this.pseudonym('student_profile', item.studentId),
      assessment_id: this.pseudonym('assessment_session', item.assessmentId),
      report_id: this.pseudonym('report_job', item.reportId), product_code: item.productCode,
      amount_fen: item.amountFen, currency: item.currency, channel: 'WECHAT', status: item.status,
      paid_at: item.paidAt, refunded_at: item.refundedAt, created_at: item.createdAt
    }))
    snapshot.feedback.filter((item) => !v05ReportIds.has(item.reportId)).forEach((item) => add('feedback', item.id, 'feedback_id', item.createdAt, {
      feedback_id: this.pseudonym('feedback', item.id),
      report_id: this.pseudonym('report_job', item.reportId), rating: item.rating,
      consult_intent: item.advisorContactRequested ? 'YES' : 'NO',
      created_at: item.createdAt
    }))
    const v05AssessmentIds = new Set(v05Assessments.map((item) => item.id))
    snapshot.advisorRequests.filter((item) => item.status !== 'CANCELLED_BY_CONSENT_WITHDRAWAL')
      .filter((item) => !v05FamilyIds.has(item.familyId) && (!item.studentId || !v05StudentIds.has(item.studentId)))
      .filter((item) =>
      !item.reportId || !v05ReportIds.has(item.reportId)
    ).filter((item) => !item.assessmentId || !v05AssessmentIds.has(item.assessmentId)).forEach((item) => add('advisor_request', item.id, 'request_id', item.updatedAt, {
      request_id: this.pseudonym('advisor_request', item.id),
      family_id: this.pseudonym('family_profile', item.familyId),
      student_id: item.studentId ? this.pseudonym('student_profile', item.studentId) : null,
      report_id: item.reportId ? this.pseudonym('report_job', item.reportId) : null,
      status: item.status, created_at: item.createdAt
    }))
    invariant(projections.length <= MAX_SCAN_ROWS, 503, 'FEISHU_SYNC_SCAN_LIMIT', '飞书同步扫描量超过安全上限')
    return projections.sort((left, right) => left.sourceUpdatedAt.localeCompare(right.sourceUpdatedAt))
  }

  private async claim(projection: Projection, payloadDigest: string): Promise<SyncClaim | null> {
    const now = iso(this.clock)
    const leaseUntil = new Date(this.clock().getTime() + PROCESSING_LEASE_MS).toISOString()
    const leaseToken = this.ids('lck')
    return this.store.transaction(async (tx) => {
      if (!(await this.hasActiveProjectionConsent(projection, tx))) return null
      const existing = await tx.findOne('integrationLinks', {
        provider: 'feishu_bitable', tableId: projection.tableId,
        entityType: projection.entityType, entityId: projection.entityId
      }, { forUpdate: true })
      if (existing) {
        if (existing.status === 'SYNCED' && existing.payloadDigest === payloadDigest) return null
        if (existing.status === 'BLOCKED' && existing.lastErrorCode !== 'FEISHU_CONSENT_WITHDRAWN') return null
        if ((existing.status === 'PROCESSING' || existing.status === 'FAILED') && existing.nextAttemptAt && existing.nextAttemptAt > now) return null
        const hasFrozenOperation = Boolean(existing.operationToken && existing.operationDigest && existing.operationBody)
        let reuseFrozenOperation = hasFrozenOperation
        let operationDigest = hasFrozenOperation ? existing.operationDigest as string : payloadDigest
        let operationBody = hasFrozenOperation ? existing.operationBody as string : JSON.stringify({ fields: projection.fields })
        let fields: FeishuRecordFields
        try {
          const parsed = JSON.parse(operationBody) as { fields?: unknown }
          invariant(parsed.fields !== null && typeof parsed.fields === 'object' && !Array.isArray(parsed.fields), 500, 'FEISHU_OPERATION_BODY_INVALID', '飞书冻结请求体无效')
          fields = parsed.fields as FeishuRecordFields
          this.assertProjectionFields(projection.entityType, fields, projection.v05ConsentBoundProfile)
          invariant(operationBody === JSON.stringify({ fields }), 500, 'FEISHU_OPERATION_BODY_INVALID', '飞书冻结请求体不是规范序列化载荷')
          invariant(digest(fields) === operationDigest, 500, 'FEISHU_OPERATION_DIGEST_MISMATCH', '飞书冻结请求体摘要不一致')
        } catch (error) {
          // Turning the sensitive profile switch off is an explicit egress stop.
          // Never replay a previously frozen PII body after that transition.
          if (
            error instanceof AppError && error.code === 'FEISHU_PROFILE_FIELD_DISABLED' &&
            !this.customerProfileFieldsEnabled &&
            (projection.entityType === 'family_profile' || projection.entityType === 'student_profile')
          ) {
            reuseFrozenOperation = false
            fields = projection.fields
            operationDigest = payloadDigest
            operationBody = JSON.stringify({ fields })
          } else {
            if (error instanceof AppError) throw error
            throw new AppError(500, 'FEISHU_OPERATION_BODY_INVALID', '飞书冻结请求体无效')
          }
        }
        const link = await tx.update('integrationLinks', existing.id, {
          status: 'PROCESSING', attempts: existing.attempts + 1,
          leaseToken,
          operationToken: reuseFrozenOperation ? existing.operationToken ?? null : randomUUID(),
          operationDigest, operationBody,
          lastErrorCode: null, nextAttemptAt: leaseUntil, updatedAt: now
        })
        return { link, fields, payloadDigest: operationDigest, requestBody: operationBody }
      }
      const operationBody = JSON.stringify({ fields: projection.fields })
      const link = await tx.insert('integrationLinks', {
        id: this.ids('ilk'), provider: 'feishu_bitable', tableId: projection.tableId,
        entityType: projection.entityType, entityId: projection.entityId,
        externalRecordId: null, payloadDigest: null, status: 'PROCESSING', attempts: 1, leaseToken,
        operationToken: randomUUID(), operationDigest: payloadDigest, operationBody,
        lastErrorCode: null, nextAttemptAt: leaseUntil, lastSyncedAt: null,
        createdAt: now, updatedAt: now
      })
      return { link, fields: projection.fields, payloadDigest, requestBody: operationBody }
    })
  }

  private async hasActiveProjectionConsent(projection: Projection, tx?: StoreTransaction): Promise<boolean> {
    const consentFamilyId = projection.consentFamilyId
    if (!consentFamilyId) return true
    if (!this.customerProfileFieldsEnabled) return false
    const read = async (current: StoreTransaction): Promise<boolean> => {
      const active = await current.findMany('consentGrants', {
        familyId: consentFamilyId,
        scope: 'FEISHU_PROFILE_MIRROR',
        withdrawnAt: null
      })
      return projection.consentStudentId
        ? active.some((item) => isExactActiveFeishuProfileConsent(item, consentFamilyId, projection.consentStudentId as string))
        : active.some((item) => Boolean(item.studentId) &&
          isExactActiveFeishuProfileConsent(item, consentFamilyId, item.studentId as string))
    }
    return tx ? read(tx) : this.store.read(read)
  }

  private assertProjectionFields(
    entityType: FeishuEntityType,
    fields: Readonly<Record<string, unknown>>,
    v05ConsentBoundProfile: boolean
  ): void {
    const legacyProfile = !v05ConsentBoundProfile &&
      (entityType === 'family_profile' || entityType === 'student_profile')
    if (!legacyProfile) {
      assertFeishuProjectionFields(entityType, fields, this.customerProfileFieldsEnabled, v05ConsentBoundProfile)
      return
    }

    // family_id/student_id overlap the V0.5 allowlist, so the shared validator
    // cannot infer a legacy payload from field names alone. Validate values and
    // the legacy completeness contract first, then apply the exact legacy key
    // set for the current sensitive-field switch.
    assertFeishuProjectionFields(entityType, fields, true, false)
    const profileType = entityType as 'family_profile' | 'student_profile'
    const allowed: readonly string[] = this.customerProfileFieldsEnabled
      ? CUSTOMER_PROFILE_FEISHU_ALLOWLISTS[profileType]
      : CUSTOMER_PROFILE_FEISHU_CORE_FIELDS[profileType]
    for (const fieldName of Object.keys(fields)) {
      invariant(allowed.includes(fieldName), 500,
        this.customerProfileFieldsEnabled ? 'FEISHU_PROJECTION_FIELD_FORBIDDEN' : 'FEISHU_PROFILE_FIELD_DISABLED',
        this.customerProfileFieldsEnabled ? '飞书投影包含未授权字段' : '飞书客户资料字段未启用')
    }
  }

  private async fenceConsentWithdrawal(claimed: IntegrationLink): Promise<void> {
    const now = iso(this.clock)
    await this.store.transaction(async (tx) => {
      const link = await tx.findById('integrationLinks', claimed.id, { forUpdate: true })
      if (!link || link.leaseToken !== claimed.leaseToken) return
      await tx.update('integrationLinks', link.id, {
        status: 'BLOCKED', leaseToken: null, operationToken: null,
        operationDigest: null, operationBody: null,
        lastErrorCode: 'FEISHU_CONSENT_WITHDRAWN', nextAttemptAt: null, updatedAt: now
      })
    })
  }

  private async complete(claimed: IntegrationLink, externalRecordId: string, payloadDigest: string): Promise<void> {
    const now = iso(this.clock)
    await this.store.transaction(async (tx) => {
      const link = await tx.findById('integrationLinks', claimed.id, { forUpdate: true })
      if (!link || link.status !== 'PROCESSING' || link.leaseToken !== claimed.leaseToken) return
      await tx.update('integrationLinks', link.id, {
        externalRecordId, payloadDigest, status: 'SYNCED', attempts: 0,
        leaseToken: null, operationToken: null, operationDigest: null, operationBody: null,
        lastErrorCode: null, nextAttemptAt: null, lastSyncedAt: now, updatedAt: now
      })
    })
  }

  private async fail(claimed: IntegrationLink, error: unknown): Promise<void> {
    const now = iso(this.clock)
    await this.store.transaction(async (tx) => {
      const link = await tx.findById('integrationLinks', claimed.id, { forUpdate: true })
      if (!link || link.status !== 'PROCESSING' || link.leaseToken !== claimed.leaseToken) return
      const attempts = Math.max(1, link.attempts)
      const baseBackoffMs = Math.min(6 * 60 * 60 * 1000, 30_000 * 2 ** Math.min(attempts - 1, 8))
      const jitterRange = Math.min(5_000, Math.floor(baseBackoffMs / 4))
      const jitterSeed = createHash('sha256').update(`${link.id}:${attempts}`).digest().readUInt32BE(0)
      const jitterMs = jitterRange ? jitterSeed % jitterRange : 0
      const providerError = error instanceof FeishuApiError ? error : null
      const retryable = providerError ? providerError.retryable : true
      const exhausted = attempts >= 8
      const blocked = !retryable || exhausted
      const backoffMs = Math.max(baseBackoffMs + jitterMs, providerError?.retryAfterMs ?? 0)
      await tx.update('integrationLinks', link.id, {
        status: blocked ? 'BLOCKED' : 'FAILED',
        leaseToken: null,
        lastErrorCode: providerError ? providerError.code : 'FEISHU_SYNC_FAILED',
        nextAttemptAt: blocked ? null : new Date(this.clock().getTime() + backoffMs).toISOString(),
        updatedAt: now
      })
    })
  }
}
