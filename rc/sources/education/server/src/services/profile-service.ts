import { AppError, invariant } from '../domain/errors'
import {
  ADVISOR_CONTACT_CONSENT_COPY,
  ADVISOR_CONTACT_CONSENT_VERSION,
  CORE_ASSESSMENT_CONSENT_COPY,
  CORE_ASSESSMENT_CONSENT_VERSION,
  STUDENT_ASSESSMENT_ASSENT_COPY,
  STUDENT_ASSESSMENT_ASSENT_VERSION,
  consentCopySha256,
  isExactActiveCoreAssessmentConsent,
  isExactActiveStudentAssessmentAssent
} from '../domain/education-compass/consent-policy'
import { buildLevel3ReservationFromFrozenEvidence } from '../domain/education-compass/next-support'
import { AdvisorRequest, EducationSystem, Family, Report, Student, TimelineEvent } from '../domain/model'
import { COMPASS_PRODUCT_CODE, GROWTH_DISCOVERY_PRODUCT_CODE } from '../domain/products'
import { Store, StoreTransaction } from '../store/store'
import { Clock, IdFactory, iso, randomId, systemClock } from '../utils/runtime'

function text(value: unknown, field: string, max: number, required = true): string {
  invariant(typeof value === 'string', 400, 'INVALID_PROFILE', `${field} 格式无效`)
  const result = value.trim()
  invariant(!required || result.length > 0, 400, 'INVALID_PROFILE', `${field} 不能为空`)
  invariant(result.length <= max, 400, 'INVALID_PROFILE', `${field} 不能超过${max}个字符`)
  return result
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null
  return text(value, field, max, false)
}

const EDUCATION_SYSTEM_BY_INPUT: Readonly<Record<string, EducationSystem>> = Object.freeze({
  GAOKAO: 'GAOKAO',
  DSE: 'DSE',
  IGCSE: 'IGCSE',
  A_LEVEL: 'A_LEVEL',
  AP_US: 'AP_US',
  IB: 'IB',
  OTHER: 'OTHER',
  '内地课程': 'GAOKAO',
  '内地课程／高考': 'GAOKAO',
  '内地课程/高考': 'GAOKAO',
  '高考': 'GAOKAO',
  'A-Level': 'A_LEVEL',
  'A-LEVEL': 'A_LEVEL',
  'A LEVEL': 'A_LEVEL',
  AP: 'AP_US',
  'AP / 美式课程': 'AP_US',
  'AP／美式课程': 'AP_US',
  'AP／美国课程': 'AP_US',
  '美式课程': 'AP_US',
  '其他': 'OTHER',
  '其他体系': 'OTHER'
})

function normalizeEducationSystem(value: unknown): EducationSystem | null {
  if (value === undefined || value === null) return null
  invariant(typeof value === 'string', 400, 'INVALID_PROFILE', 'educationSystem 格式无效')
  const input = value.trim()
  if (!input) return null
  const normalized = EDUCATION_SYSTEM_BY_INPUT[input] ?? EDUCATION_SYSTEM_BY_INPUT[input.toUpperCase()]
  invariant(normalized, 400, 'INVALID_PROFILE', 'educationSystem 格式无效')
  return normalized
}

type AdvisorRequestIntent = 'GENERAL_ADVISOR' | 'DEEP_ASSESSMENT'

function advisorRequestIntent(value: unknown): AdvisorRequestIntent {
  if (value === undefined) return 'GENERAL_ADVISOR'
  invariant(value === 'GENERAL_ADVISOR' || value === 'DEEP_ASSESSMENT', 400,
    'ADVISOR_INTENT_INVALID', '顾问联系意向无效')
  return value
}

export async function appendTimeline(
  tx: StoreTransaction,
  ids: IdFactory,
  at: string,
  event: Omit<TimelineEvent, 'id' | 'occurredAt'>
): Promise<TimelineEvent> {
  return tx.insert('timelineEvents', { id: ids('evt'), ...event, occurredAt: at })
}

export interface FamilyInput {
  familyName?: string | null
  parentName?: string | null
  phone?: string | null
  location?: string | null
  goal?: string | null
}

export interface StudentInput {
  name?: string | null
  age?: number | string | null
  gender?: string | null
  school?: string | null
  educationSystem?: string | null
  grade?: string | null
  interest?: string | null
  goal?: string | null
}

const FAMILY_PROFILE_SCHEMA_VERSION = 'family_profile_v0.5.0'
const STUDENT_PROFILE_SCHEMA_VERSION = 'student_profile_v0.5.0'

export class ProfileService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdFactory = randomId
  ) {}

  async getFamily(userId: string): Promise<Family | null> {
    return this.store.read((tx) => tx.findOne('families', { userId }))
  }

  async upsertFamily(userId: string, input: FamilyInput): Promise<Family> {
    const now = iso(this.clock)
    const normalized = {
      familyName: optionalText(input.familyName, 'familyName', 80),
      parentName: optionalText(input.parentName, 'parentName', 80),
      phone: optionalText(input.phone, 'phone', 30),
      location: optionalText(input.location, 'location', 120),
      goal: optionalText(input.goal, 'goal', 500)
    }
    const profileStatus = normalized.familyName && normalized.parentName && normalized.phone ? 'COMPLETE' as const : 'PROVISIONAL' as const
    return this.store.transaction(async (tx) => {
      const existing = await tx.findOne('families', { userId }, { forUpdate: true })
      if (existing) return tx.update('families', existing.id, {
        ...normalized,
        profileStatus,
        profileSchemaVersion: FAMILY_PROFILE_SCHEMA_VERSION,
        updatedAt: now
      })
      const family = await tx.insert('families', {
        id: this.ids('fam'), userId, ...normalized,
        profileStatus, profileSchemaVersion: FAMILY_PROFILE_SCHEMA_VERSION,
        createdAt: now, updatedAt: now
      })
      await appendTimeline(tx, this.ids, now, {
        userId, familyId: family.id, eventType: 'family_created', description: '已建立家庭成长档案', reportId: null, orderId: null
      })
      return family
    })
  }

  async listStudents(userId: string): Promise<Student[]> {
    return this.store.read(async (tx) => {
      const family = await tx.findOne('families', { userId })
      if (!family) return []
      return (await tx.findMany('students', { familyId: family.id }))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    })
  }

  async createStudent(userId: string, input: StudentInput): Promise<Student> {
    const now = iso(this.clock)
    const normalized = this.normalizeStudent(input)
    return this.store.transaction(async (tx) => {
      const family = await tx.findOne('families', { userId }, { forUpdate: true })
      invariant(family, 409, 'FAMILY_REQUIRED', '请先建立家庭档案')
      const student = await tx.insert('students', {
        id: this.ids('stu'), familyId: family.id, ...normalized, studentVersion: 'v1',
        profileStatus: normalized.educationSystem && normalized.grade ? 'COMPLETE_FOR_LEVEL_2' : 'PROVISIONAL',
        profileSchemaVersion: STUDENT_PROFILE_SCHEMA_VERSION,
        gradeStage: normalized.grade ?? null,
        createdAt: now, updatedAt: now
      })
      await appendTimeline(tx, this.ids, now, {
        userId, familyId: family.id, eventType: 'student_created', description: '已添加孩子档案', reportId: null, orderId: null
      })
      return student
    })
  }

  async getStudent(userId: string, studentId: string): Promise<Student> {
    return this.store.read(async (tx) => {
      const student = await tx.findById('students', studentId)
      invariant(student, 404, 'STUDENT_NOT_FOUND', '孩子档案不存在')
      const family = await tx.findById('families', student.familyId)
      invariant(family?.userId === userId, 403, 'STUDENT_FORBIDDEN', '无权访问该孩子档案')
      return student
    })
  }

  async updateStudent(userId: string, studentId: string, input: StudentInput): Promise<Student> {
    const now = iso(this.clock)
    const normalized = this.normalizeStudent(input)
    return this.store.transaction(async (tx) => {
      const student = await tx.findById('students', studentId, { forUpdate: true })
      invariant(student, 404, 'STUDENT_NOT_FOUND', '孩子档案不存在')
      const family = await tx.findById('families', student.familyId)
      invariant(family?.userId === userId, 403, 'STUDENT_FORBIDDEN', '无权修改该孩子档案')
      const revision = Number(student.studentVersion.replace(/^v/, ''))
      return tx.update('students', studentId, {
        ...normalized,
        studentVersion: `v${Number.isFinite(revision) ? revision + 1 : 2}`,
        profileStatus: normalized.educationSystem && normalized.grade ? 'COMPLETE_FOR_LEVEL_2' : 'PROVISIONAL',
        profileSchemaVersion: STUDENT_PROFILE_SCHEMA_VERSION,
        gradeStage: normalized.grade ?? null,
        updatedAt: now
      })
    })
  }

  async listReports(userId: string): Promise<Array<Record<string, unknown>>> {
    return this.store.transaction(async (tx) => {
      const reports = await tx.findMany('reports', { userId })
      const entitlements = await tx.findMany('entitlements', { userId, status: 'ACTIVE' })
      const entitlementByReport = new Map(entitlements.map((item) => [item.reportId, item]))
      const visible: Report[] = []
      for (const report of reports) {
        if (report.reportKind !== 'FAMILY_EDUCATION_SNAPSHOT' && report.reportKind !== 'STUDENT_GROWTH_DISCOVERY') {
          visible.push(report)
          continue
        }
        const assessment = await tx.findById('assessments', report.assessmentId, { forUpdate: true })
        if (!assessment || assessment.userId !== userId || assessment.reportId !== report.id) continue
        const subject = { userId, familyId: assessment.familyId, studentId: assessment.studentId }
        const core = assessment.coreConsentGrantId
          ? await tx.findById('consentGrants', assessment.coreConsentGrantId, { forUpdate: true })
          : null
        if (!isExactActiveCoreAssessmentConsent(core, subject)) continue
        if (report.reportKind === 'STUDENT_GROWTH_DISCOVERY') {
          const assent = assessment.studentAssentGrantId
            ? await tx.findById('consentGrants', assessment.studentAssentGrantId, { forUpdate: true })
            : null
          if (!isExactActiveStudentAssessmentAssent(assent, subject)) continue
        }
        visible.push(report)
      }
      return visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((report) => ({
        ...(() => {
          const candidate = entitlementByReport.get(report.id)
          const entitlement = report.reportKind === 'STUDENT_GROWTH_DISCOVERY'
            ? (candidate?.productCode === GROWTH_DISCOVERY_PRODUCT_CODE ? candidate : undefined)
            : report.reportKind === 'FAMILY_EDUCATION_SNAPSHOT'
              ? undefined
              : (candidate?.productCode === COMPASS_PRODUCT_CODE ? candidate : undefined)
          return {
            productCode: entitlement?.productCode ?? null,
            entitled: Boolean(entitlement)
          }
        })(),
        id: report.id,
        studentId: report.studentId,
        assessmentId: report.assessmentId,
        status: report.status,
        preview: report.preview,
        reportKind: report.reportKind,
        resultVersion: report.resultVersion,
        deliveryStatus: report.deliveryStatus,
        qaPassed: report.qaPassed,
        createdAt: report.createdAt
      }))
    })
  }

  async timeline(userId: string): Promise<TimelineEvent[]> {
    return this.store.read(async (tx) => {
      const events = await tx.findMany('timelineEvents', { userId })
      return events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    })
  }

  async listAdvisorRequests(userId: string): Promise<AdvisorRequest[]> {
    return this.store.read(async (tx) => {
      const requests = await tx.findMany('advisorRequests', { userId })
      return requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    })
  }

  async createAdvisorRequest(userId: string, input: {
    preferredTime: string
    topic: string
    note?: string
    reportId?: string
    studentId?: string
    intent?: unknown
    consent: {
      scope: 'ADVISOR_CONTACT'
      copyVersion: typeof ADVISOR_CONTACT_CONSENT_VERSION
      locale: 'zh-CN'
      guardianAuthorityConfirmed: true
    }
  }): Promise<AdvisorRequest> {
    const now = iso(this.clock)
    const preferredTime = text(input.preferredTime, 'preferredTime', 120)
    const topic = text(input.topic, 'topic', 300)
    const rawNote = optionalText(input.note, 'note', 1000)
    const intent = advisorRequestIntent(input.intent)
    const note = rawNote
      ?.replace(/\b1\d{10}\b/g, '[PHONE_REDACTED]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACTED]')
      .replace(/\b\d{15,18}[0-9Xx]?\b/g, '[ID_REDACTED]') ?? null
    invariant(input.consent?.scope === 'ADVISOR_CONTACT' &&
      input.consent.copyVersion === ADVISOR_CONTACT_CONSENT_VERSION &&
      input.consent.locale === 'zh-CN' && input.consent.guardianAuthorityConfirmed === true,
      400, 'ADVISOR_CONTACT_CONSENT_INVALID', '顾问联系专项同意无效')
    return this.store.transaction(async (tx) => {
      const family = await tx.findOne('families', { userId }, { forUpdate: true })
      invariant(family, 409, 'FAMILY_REQUIRED', '请先建立家庭档案')
      let selectedStudentId = input.studentId ?? null
      let selectedReport: Report | null = null
      if (input.studentId) {
        const student = await tx.findById('students', input.studentId)
        invariant(student?.familyId === family.id, 403, 'ADVISOR_STUDENT_FORBIDDEN', '孩子档案不属于当前家庭')
      }
      if (input.reportId) {
        selectedReport = await tx.findById('reports', input.reportId)
        invariant(selectedReport?.familyId === family.id && selectedReport.userId === userId, 403, 'ADVISOR_REPORT_FORBIDDEN', '报告不属于当前家庭')
        invariant(!selectedStudentId || selectedStudentId === selectedReport.studentId, 409,
          'ADVISOR_CONTEXT_MISMATCH', '顾问联系关联的学生与报告不一致')
        selectedStudentId = selectedReport.studentId
      }
      if (intent === 'DEEP_ASSESSMENT') {
        invariant(selectedReport && input.reportId, 400, 'DEEP_ASSESSMENT_REPORT_REQUIRED', '深度评估意向必须关联已解锁报告')
        invariant(selectedReport.reportKind === 'STUDENT_GROWTH_DISCOVERY' &&
          selectedReport.status === 'READY' && selectedReport.deliveryStatus === 'DELIVERED' &&
          selectedReport.qaPassed && Boolean(selectedReport.resultPayload),
        409, 'DEEP_ASSESSMENT_REPORT_NOT_READY', '深度评估意向仅支持已完整交付的学生成长发现报告')
        const entitlement = await tx.findOne('entitlements', {
          userId, reportId: selectedReport.id, status: 'ACTIVE'
        }, { forUpdate: true })
        invariant(entitlement?.productCode === GROWTH_DISCOVERY_PRODUCT_CODE, 403,
          'DEEP_ASSESSMENT_REPORT_ENTITLEMENT_REQUIRED', '深度评估意向需要有效的学生成长发现报告权益')
        const assessment = await tx.findById('assessments', selectedReport.assessmentId, { forUpdate: true })
        invariant(assessment?.userId === userId && assessment.familyId === family.id &&
          assessment.studentId === selectedReport.studentId && assessment.reportId === selectedReport.id &&
          assessment.assessmentKind === 'STUDENT_GROWTH_DISCOVERY',
        409, 'DEEP_ASSESSMENT_CONTEXT_INVALID', '深度评估来源测评无效')
        const core = assessment.coreConsentGrantId
          ? await tx.findById('consentGrants', assessment.coreConsentGrantId, { forUpdate: true })
          : null
        invariant(core?.userId === userId && core.familyId === family.id && core.studentId === assessment.studentId &&
          core.subjectType === 'STUDENT' && core.subjectId === assessment.studentId &&
          core.scope === 'CORE_ASSESSMENT' && core.subjectRole === 'PARENT_GUARDIAN' &&
          core.copyVersion === CORE_ASSESSMENT_CONSENT_VERSION &&
          core.copyTextHash === consentCopySha256(CORE_ASSESSMENT_CONSENT_COPY) && core.locale === 'zh-CN' &&
          core.guardianAuthorityStatus === 'CONFIRMED' && !core.withdrawnAt,
        403, 'CORE_ASSESSMENT_CONSENT_REQUIRED', '核心测评同意缺失或已撤回')
        const assent = assessment.studentAssentGrantId
          ? await tx.findById('consentGrants', assessment.studentAssentGrantId, { forUpdate: true })
          : null
        invariant(assent?.userId === userId && assent.familyId === family.id && assent.studentId === assessment.studentId &&
          assent.subjectType === 'STUDENT' && assent.subjectId === assessment.studentId &&
          assent.scope === 'STUDENT_ASSESSMENT_ASSENT' && assent.copyVersion === STUDENT_ASSESSMENT_ASSENT_VERSION &&
          assent.subjectRole === 'STUDENT' &&
          assent.copyTextHash === consentCopySha256(STUDENT_ASSESSMENT_ASSENT_COPY) && assent.locale === 'zh-CN' &&
          assent.guardianAuthorityStatus === 'NOT_APPLICABLE' && !assent.withdrawnAt,
        403, 'STUDENT_ASSESSMENT_ASSENT_REQUIRED', '学生本人同意缺失或已撤回')
        const source = assessment.sourceAssessmentId
          ? await tx.findById('assessments', assessment.sourceAssessmentId)
          : null
        const sourceLevel1Answers = source?.userId === userId && source.familyId === family.id &&
          source.studentId === assessment.studentId && source.assessmentKind === 'FREE_PARENT_COMPASS'
          ? source.answers
          : null
        const reservation = buildLevel3ReservationFromFrozenEvidence({
          sourceAssessmentId: assessment.id,
          sourceReportId: selectedReport.id,
          sourceLevel1Answers,
          growthAnswers: assessment.answers,
          reportAccess: 'full'
        })
        invariant(reservation.state === 'AVAILABLE' || reservation.state === 'CONSIDER', 409,
          'DEEP_ASSESSMENT_NOT_AVAILABLE', '当前报告没有已冻结的深度评估触发依据')
      }
      const subjectType = selectedStudentId ? 'STUDENT' as const : 'FAMILY' as const
      const subjectId = selectedStudentId ?? family.id
      const activeConsent = await tx.findOne('consentGrants', {
        userId, subjectType, subjectId, scope: 'ADVISOR_CONTACT', withdrawnAt: null
      }, { forUpdate: true })
      if (activeConsent) {
        invariant(activeConsent.familyId === family.id && activeConsent.studentId === selectedStudentId &&
          activeConsent.subjectRole === 'PARENT_GUARDIAN' &&
          activeConsent.copyVersion === ADVISOR_CONTACT_CONSENT_VERSION &&
          activeConsent.copyTextHash === consentCopySha256(ADVISOR_CONTACT_CONSENT_COPY) &&
          activeConsent.locale === 'zh-CN' && activeConsent.guardianAuthorityStatus === 'CONFIRMED',
          409, 'ADVISOR_CONTACT_CONSENT_VERSION_CONFLICT', '已有不同版本的顾问联系同意')
      } else {
        await tx.insert('consentGrants', {
          id: this.ids('cgr'), userId, familyId: family.id, studentId: selectedStudentId,
          subjectType, subjectId, scope: 'ADVISOR_CONTACT', subjectRole: 'PARENT_GUARDIAN',
          copyVersion: ADVISOR_CONTACT_CONSENT_VERSION,
          copyTextHash: consentCopySha256(ADVISOR_CONTACT_CONSENT_COPY), locale: 'zh-CN',
          guardianAuthorityStatus: 'CONFIRMED', sourceEntry: 'MINIPROGRAM_HOME',
          auditMetadata: { guardianConfirmed: true, studentConfirmed: false, channel: 'MINIPROGRAM', purpose: 'ADVISOR_CONTACT' },
          grantedAt: now, withdrawnAt: null, createdAt: now, updatedAt: now
        })
      }
      const requestAssessmentId = input.reportId
        ? (await tx.findById('reports', input.reportId))?.assessmentId ?? null
        : null
      const request = await tx.insert('advisorRequests', {
        id: this.ids('req'), userId, familyId: family.id, preferredTime, topic,
        note, reportId: input.reportId ?? null, studentId: selectedStudentId,
        assessmentId: requestAssessmentId, intent,
        status: 'PENDING', createdAt: now, updatedAt: now
      })
      await appendTimeline(tx, this.ids, now, {
        userId, familyId: family.id, eventType: 'advisor_requested',
        description: intent === 'DEEP_ASSESSMENT' ? '已申请深度评估顾问联系' : '已申请顾问联系',
        reportId: null, orderId: null
      })
      return request
    })
  }

  async setAdvisorContactConsent(userId: string, input: {
    studentId?: string
    enabled: boolean
    copyVersion: string
    locale: string
    guardianAuthorityConfirmed: boolean
  }): Promise<Record<string, unknown>> {
    invariant(typeof input.enabled === 'boolean' &&
      input.copyVersion === ADVISOR_CONTACT_CONSENT_VERSION && input.locale === 'zh-CN' &&
      input.guardianAuthorityConfirmed === true,
      400, 'ADVISOR_CONTACT_CONSENT_INVALID', '顾问联系专项同意无效')
    const now = iso(this.clock)
    return this.store.transaction(async (tx) => {
      const family = await tx.findOne('families', { userId }, { forUpdate: true })
      invariant(family, 409, 'FAMILY_REQUIRED', '请先建立家庭档案')
      const studentId = input.studentId ?? null
      if (studentId) {
        const student = await tx.findById('students', studentId)
        invariant(student?.familyId === family.id, 403, 'ADVISOR_STUDENT_FORBIDDEN', '孩子档案不属于当前家庭')
      }
      const subjectType = studentId ? 'STUDENT' as const : 'FAMILY' as const
      const subjectId = studentId ?? family.id
      const active = await tx.findOne('consentGrants', {
        userId, subjectType, subjectId, scope: 'ADVISOR_CONTACT', withdrawnAt: null
      }, { forUpdate: true })
      if (!input.enabled) {
        if (active) await tx.update('consentGrants', active.id, { withdrawnAt: now, updatedAt: now })
        const pending = await tx.findMany('advisorRequests', { userId, familyId: family.id, status: 'PENDING' })
        // Family and student consent are separate scopes. Withdrawing the
        // family-level grant must not cancel requests covered by a student's
        // still-active grant (and vice versa).
        const affected = pending.filter((request) => request.studentId === studentId)
        for (const request of affected) {
          await tx.update('advisorRequests', request.id, { status: 'CANCELLED_BY_CONSENT_WITHDRAWAL', updatedAt: now })
          const links = await tx.findMany('integrationLinks', {
            provider: 'feishu_bitable', entityType: 'advisor_request', entityId: request.id
          })
          for (const link of links) {
            await tx.update('integrationLinks', link.id, {
              status: 'BLOCKED', leaseToken: null, operationToken: null,
              operationDigest: null, operationBody: null, nextAttemptAt: null,
              lastErrorCode: 'ADVISOR_CONTACT_CONSENT_WITHDRAWN', updatedAt: now
            })
          }
        }
        await tx.insert('auditLogs', {
          id: this.ids('aud'), actorUserId: userId, action: 'ADVISOR_CONTACT_CONSENT_WITHDRAWN',
          entityType: subjectType.toLowerCase(), entityId: subjectId,
          metadata: { cancelledPendingRequests: affected.length }, createdAt: now
        })
        return { scope: 'ADVISOR_CONTACT', enabled: false, consentVersion: ADVISOR_CONTACT_CONSENT_VERSION, updatedAt: now }
      }
      if (!active) {
        await tx.insert('consentGrants', {
          id: this.ids('cgr'), userId, familyId: family.id, studentId, subjectType, subjectId,
          scope: 'ADVISOR_CONTACT', subjectRole: 'PARENT_GUARDIAN',
          copyVersion: ADVISOR_CONTACT_CONSENT_VERSION,
          copyTextHash: consentCopySha256(ADVISOR_CONTACT_CONSENT_COPY), locale: 'zh-CN',
          guardianAuthorityStatus: 'CONFIRMED', sourceEntry: 'MINIPROGRAM_HOME',
          auditMetadata: { guardianConfirmed: true, studentConfirmed: false, channel: 'MINIPROGRAM', purpose: 'ADVISOR_CONTACT' },
          grantedAt: now, withdrawnAt: null, createdAt: now, updatedAt: now
        })
      }
      return { scope: 'ADVISOR_CONTACT', enabled: true, consentVersion: ADVISOR_CONTACT_CONSENT_VERSION, updatedAt: now }
    })
  }

  private normalizeStudent(input: StudentInput): Omit<Student, 'id' | 'familyId' | 'studentVersion' | 'createdAt' | 'updatedAt'> {
    const rawAge = input.age
    invariant(
      rawAge === undefined || rawAge === null || typeof rawAge === 'number' || typeof rawAge === 'string',
      400,
      'INVALID_PROFILE',
      'age 格式无效'
    )
    const normalizedAge = typeof rawAge === 'string' ? rawAge.trim() : rawAge
    invariant(
      typeof normalizedAge !== 'string' || normalizedAge === '' || /^\d+$/.test(normalizedAge),
      400,
      'INVALID_PROFILE',
      'age 格式无效'
    )
    const age = normalizedAge === undefined || normalizedAge === null || normalizedAge === ''
      ? null
      : Number(normalizedAge)
    invariant(age === null || (Number.isInteger(age) && age >= 3 && age <= 100), 400, 'INVALID_PROFILE', 'age 格式无效')
    return {
      name: optionalText(input.name, 'name', 80),
      age,
      gender: optionalText(input.gender, 'gender', 30),
      school: optionalText(input.school, 'school', 160),
      educationSystem: normalizeEducationSystem(input.educationSystem),
      grade: optionalText(input.grade, 'grade', 80),
      interest: optionalText(input.interest, 'interest', 500),
      goal: optionalText(input.goal, 'goal', 500)
    }
  }
}

export function profileErrorForUnknown(error: unknown): never {
  if (error instanceof AppError) throw error
  throw new AppError(500, 'PROFILE_ERROR', '档案服务暂时不可用')
}
