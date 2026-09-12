import { createHash } from 'node:crypto'
import { canonicalJson } from '../ai/crypto'
import {
  EDUCATION_COMPASS_DISCLAIMER,
  EDUCATION_COMPASS_DISCLAIMER_VERSION,
  EducationSystem,
  FAMILY_SNAPSHOT_VERSION,
  FREE_PARENT_QUESTIONNAIRE_VERSION,
  GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION,
  GROWTH_DISCOVERY_REPORT_VERSION,
  LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION,
  LEGACY_GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION,
  QuestionnaireBank,
  StudentGrowthDiscoveryReportV1
} from '../domain/education-compass/contracts'
import {
  CORE_ASSESSMENT_CONSENT_COPY as CORE_COPY,
  CORE_ASSESSMENT_CONSENT_VERSION as CORE_COPY_VERSION,
  FEISHU_PROFILE_MIRROR_CONSENT_COPY as FEISHU_COPY,
  FEISHU_PROFILE_MIRROR_CONSENT_VERSION as FEISHU_COPY_VERSION,
  isExactActiveCoreAssessmentConsent,
  isExactActiveStudentAssessmentAssent,
  STUDENT_ASSESSMENT_ASSENT_COPY as ASSENT_COPY,
  STUDENT_ASSESSMENT_ASSENT_VERSION as ASSENT_COPY_VERSION
} from '../domain/education-compass/consent-policy'
import {
  buildFamilyEducationSnapshotV1,
  buildStudentGrowthDiscoveryReportV1
} from '../domain/education-compass/result-builder'
import {
  getEducationCompassQuestionnaireBank,
  getEducationCompassRegistryIntegrity,
  isEducationSystem
} from '../domain/education-compass/registry'
import {
  switchEducationSystemAnswers,
  validateQuestionnaireAnswers
} from '../domain/education-compass/validator'
import { AppError, invariant } from '../domain/errors'
import {
  Assessment,
  ConsentGrant,
  EducationSourceEntry,
  IdempotencyRecord,
  Report,
  ReportModule,
  Student
} from '../domain/model'
import { GROWTH_DISCOVERY_PRODUCT_CODE } from '../domain/products'
import { Store, StoreTransaction } from '../store/store'
import { fenceAgentStudentAccess } from '../store/agent-repository'
import { Clock, IdFactory, iso, randomId, systemClock } from '../utils/runtime'
import { appendTimeline } from './profile-service'

const SOURCE_ENTRIES: readonly EducationSourceEntry[] = [
  'MINIPROGRAM_HOME', 'LEVEL_1_RESULT', 'DIRECT_LEVEL_2', 'XIAOHONGSHU_CONTENT',
  'ADVISOR_REFERRAL', 'INTERNAL_UAT'
]

export interface FreeParentCreateInput {
  studentId: string
  sourceEntry: EducationSourceEntry
  consent: {
    scope: 'CORE_ASSESSMENT'
    copyVersion: typeof CORE_COPY_VERSION
    locale: 'zh-CN'
    guardianAuthorityConfirmed: true
  }
}

export interface GrowthDiscoveryCreateInput {
  assessmentKind: 'STUDENT_GROWTH_DISCOVERY'
  sourceAssessmentId: string
  sourceEntry: 'LEVEL_1_RESULT' | 'INTERNAL_UAT'
  educationSystem: EducationSystem
  respondent: 'STUDENT'
  assent: {
    scope: 'STUDENT_ASSESSMENT_ASSENT'
    copyVersion: typeof ASSENT_COPY_VERSION
    locale: 'zh-CN'
    studentConfirmed: true
  }
}

export interface SaveEducationDraftInput {
  revision: number
  answers: unknown
  educationSystem?: EducationSystem
  clientSaveToken?: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function exactObject(value: unknown, allowed: readonly string[], code = 'REQUEST_BODY_INVALID'): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 400, code, '请求体必须是对象')
  const record = value as Record<string, unknown>
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key))
  invariant(unknown.length === 0, 400, 'UNKNOWN_REQUEST_FIELDS', '请求体包含未知字段', { fields: unknown })
  return record
}

function sourceEntry(value: unknown): EducationSourceEntry {
  invariant(typeof value === 'string' && SOURCE_ENTRIES.includes(value as EducationSourceEntry),
    400, 'SOURCE_ENTRY_INVALID', '来源入口无效')
  return value as EducationSourceEntry
}

function idempotencyKey(value: string): string {
  invariant(/^[A-Za-z0-9._:-]{8,128}$/.test(value), 400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 格式无效')
  return value
}

function recordPayload<T extends object>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function lockedPreview(reportId: string, assessmentId: string, at: string): Report['preview'] {
  return {
    reportId,
    assessmentId,
    completenessScore: 100,
    confidence: 'high',
    profileSummary: '',
    oneStrength: '',
    oneRisk: '',
    routeOverview: '',
    tableOfContents: [],
    dataAsOf: at.slice(0, 10),
    disclaimer: EDUCATION_COMPASS_DISCLAIMER,
    canPurchase: true
  }
}

function growthModules(result: StudentGrowthDiscoveryReportV1): ReportModule[] {
  const signalItems = (value: readonly { code: string; status: string }[]): string[] =>
    value.map((item) => `${item.code} · ${item.status}`)
  return [
    { key: 'student_snapshot', title: 'Student Snapshot', summary: `${result.student_snapshot.education_system} · ${result.student_snapshot.grade_stage}`, items: [...result.student_snapshot.target_regions] },
    { key: 'strength_signals', title: 'Strength Signals', summary: '基于不同题号的交叉证据形成。', items: signalItems(result.strength_signals) },
    { key: 'learning_bottlenecks', title: 'Learning Bottlenecks', summary: '用于发现近期可验证的学习卡点。', items: signalItems(result.learning_bottlenecks) },
    { key: 'subject_focus', title: 'Subject Focus', summary: '最多呈现三个当前学科重点。', items: signalItems(result.subject_focus) },
    { key: 'growth_direction', title: 'Growth Direction', summary: '兴趣方向需要继续用真实行动验证。', items: signalItems(result.growth_direction) },
    { key: 'action_plan_30d', title: '30-Day Action Plan', summary: result.action_plan_30d.selected_action_code, items: result.action_plan_30d.goals.map((goal) => goal.code) }
  ]
}

export class EducationCompassService {
  constructor(
    private readonly store: Store,
    private readonly growthPaymentEnabled = false,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdFactory = randomId
  ) {}

  questionnaireByVersion(version: string, educationSystemInput?: unknown): QuestionnaireBank {
    if (version === FREE_PARENT_QUESTIONNAIRE_VERSION || version === LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION) {
      invariant(educationSystemInput === undefined, 400, 'EDUCATION_SYSTEM_NOT_APPLICABLE', '免费家长问卷不接受体系分支')
      return getEducationCompassQuestionnaireBank('LEVEL_1', null, version)
    }
    invariant(version === GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION || version === LEGACY_GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION, 404,
      'QUESTIONNAIRE_VERSION_NOT_FOUND', '问卷版本不存在')
    invariant(isEducationSystem(educationSystemInput), 400, 'EDUCATION_SYSTEM_REQUIRED', '学生问卷需要教育体系 code')
    return getEducationCompassQuestionnaireBank('LEVEL_2', educationSystemInput, version)
  }

  registryIntegrity(): ReturnType<typeof getEducationCompassRegistryIntegrity> {
    return getEducationCompassRegistryIntegrity()
  }

  async usesV05Contract(userId: string, assessmentId: string): Promise<boolean> {
    return this.store.read(async (tx) => {
      const assessment = await tx.findById('assessments', assessmentId)
      invariant(assessment, 404, 'ASSESSMENT_NOT_FOUND', '问卷不存在')
      const isV05 = assessment.assessmentKind === 'FREE_PARENT_COMPASS' ||
        assessment.assessmentKind === 'STUDENT_GROWTH_DISCOVERY'
      if (isV05) invariant(assessment.userId === userId, 403, 'ASSESSMENT_FORBIDDEN', '无权访问该问卷')
      return isV05
    })
  }

  async state(userId: string): Promise<Record<string, unknown>> {
    return this.store.read(async (tx) => {
      const family = await tx.findOne('families', { userId })
      if (!family) return { familyId: null, students: [], nextAction: 'CREATE_FAMILY_PROFILE' }
      const students = (await tx.findMany('students', { familyId: family.id }))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      const states: Array<Record<string, unknown>> = []
      for (const student of students) {
        const candidates = (await tx.findMany('assessments', { userId, studentId: student.id }))
          .filter((item) => item.assessmentKind === 'FREE_PARENT_COMPASS' || item.assessmentKind === 'STUDENT_GROWTH_DISCOVERY')
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        let current: Assessment | undefined
        for (const candidate of candidates) {
          if (await this.hasActiveAssessmentConsents(tx, candidate)) {
            current = candidate
            break
          }
        }
        let nextAction = 'START_FREE_PARENT_COMPASS'
        let orderId: string | null = null
        if (current?.status === 'DRAFT') nextAction = current.assessmentKind === 'FREE_PARENT_COMPASS'
          ? 'CONTINUE_FREE_PARENT_COMPASS'
          : 'CONTINUE_STUDENT_GROWTH_DISCOVERY'
        if (current?.assessmentKind === 'FREE_PARENT_COMPASS' && current.status === 'SUBMITTED') {
          const report = current.reportId ? await tx.findById('reports', current.reportId) : null
          const snapshot = report?.resultPayload
          nextAction = snapshot?.next_step_status === 'AVAILABLE' ? 'START_LEVEL_2' : 'VIEW_FAMILY_EDUCATION_SNAPSHOT'
        }
        if (current?.assessmentKind === 'STUDENT_GROWTH_DISCOVERY' && current.status === 'SUBMITTED') {
          const report = current.reportId ? await tx.findById('reports', current.reportId) : null
          const entitlement = current.reportId
            ? await tx.findOne('entitlements', { userId, reportId: current.reportId, status: 'ACTIVE' })
            : null
          const activeOrders = (await tx.findMany('orders', {
            userId, assessmentId: current.id, productCode: GROWTH_DISCOVERY_PRODUCT_CODE
          })).filter((order) => ['CREATED', 'PENDING', 'PAID', 'REFUNDING'].includes(order.status))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          orderId = activeOrders[0]?.id ?? null
          const fullReportReady = entitlement?.productCode === GROWTH_DISCOVERY_PRODUCT_CODE &&
            report?.status === 'READY' && report.deliveryStatus === 'DELIVERED' && report.qaPassed &&
            Boolean(report.resultPayload)
          nextAction = fullReportReady
            ? 'VIEW_FULL_REPORT'
            : orderId ? 'CHECK_ORDER_STATUS' : 'VIEW_STUDENT_GROWTH_LOCKED_RESULT'
        }
        states.push({
          studentId: student.id,
          profileStatus: student.profileStatus ?? 'LEGACY_COMPLETE',
          assessmentId: current?.id ?? null,
          sourceAssessmentId: current?.assessmentKind === 'FREE_PARENT_COMPASS'
            ? (current.status === 'SUBMITTED' ? current.id : null)
            : (current?.sourceAssessmentId ?? null),
          assessmentKind: current?.assessmentKind ?? null,
          status: current?.status ?? null,
          reportId: current?.reportId ?? null,
          orderId,
          revision: current?.draftRevision ?? null,
          coverage: current?.completenessScore ?? 0,
          educationSystem: current?.educationSystem ?? student.educationSystem ?? null,
          gradeStage: current?.gradeStage ?? student.gradeStage ?? student.grade ?? null,
          resultKind: current?.resultKind ?? null,
          nextAction
        })
      }
      const primary = states[0]
      return {
        familyId: family.id,
        students: states,
        ...(primary ?? {}),
        nextAction: primary?.nextAction ?? 'CREATE_STUDENT_PROFILE'
      }
    })
  }

  async createFreeParent(userId: string, rawInput: unknown, rawKey: string): Promise<Assessment> {
    const input = this.parseFreeCreate(rawInput)
    const key = idempotencyKey(rawKey)
    const now = iso(this.clock)
    return this.store.transaction(async (tx) => {
      const replay = await this.findIdempotency(tx, userId, 'ASSESSMENT_CREATE', key, input)
      if (replay) return this.requireAssessmentResource(tx, replay)
      const student = await tx.findById('students', input.studentId, { forUpdate: true })
      invariant(student, 404, 'STUDENT_NOT_FOUND', '学生档案不存在')
      const family = await tx.findById('families', student.familyId)
      invariant(family?.userId === userId, 403, 'ASSESSMENT_FORBIDDEN', '学生不属于当前家庭')
      const consent = await this.ensureActiveConsent(tx, {
        userId, familyId: family.id, studentId: student.id, subjectType: 'STUDENT', subjectId: student.id,
        subjectRole: 'PARENT_GUARDIAN', scope: 'CORE_ASSESSMENT', copyVersion: CORE_COPY_VERSION,
        copyTextHash: sha256(CORE_COPY), locale: 'zh-CN', guardianAuthorityStatus: 'CONFIRMED',
        sourceEntry: input.sourceEntry,
        auditMetadata: { guardianConfirmed: true, studentConfirmed: false, channel: 'MINIPROGRAM', purpose: 'CORE_ASSESSMENT' }
      }, now)
      const compatibilityConsent = await tx.insert('consents', {
        id: this.ids('cns'), userId, familyId: family.id, studentId: student.id,
        consentVersion: CORE_COPY_VERSION, scope: 'education_compass_report',
        guardianConfirmed: true, agreedAt: now, revokedAt: null
      })
      const bank = getEducationCompassQuestionnaireBank('LEVEL_1', null)
      const assessment = await tx.insert('assessments', {
        id: this.ids('asm'), userId, familyId: family.id, studentId: student.id, consentId: compatibilityConsent.id,
        questionnaireVersion: bank.questionnaireVersion, studentVersion: student.studentVersion,
        answers: {}, status: 'DRAFT', completenessScore: 0,
        missingFields: [...bank.requiredQuestionIds], reportId: null, createdAt: now, updatedAt: now, submittedAt: null,
        assessmentKind: 'FREE_PARENT_COMPASS', assessmentLevel: 'LEVEL_1', respondentRole: 'PARENT_GUARDIAN',
        sourceAssessmentId: null, educationSystem: null, gradeStage: null, sourceEntry: input.sourceEntry,
        commonBankVersion: bank.commonBankVersion, systemBankVersion: null,
        bankVersions: { common: bank.commonBankVersion }, schemaDigest: bank.schemaDigest,
        respondentConfirmation: 'PARENT_GUARDIAN_CONFIRMED', coreConsentGrantId: consent.id,
        studentAssentGrantId: null, resultKind: 'FAMILY_EDUCATION_SNAPSHOT', draftRevision: 1,
        submittedInputDigest: null
      })
      await this.completeIdempotency(tx, userId, 'ASSESSMENT_CREATE', key, input, 'assessment', assessment.id, 201, now)
      return assessment
    })
  }

  async createGrowthDiscovery(userId: string, studentId: string, rawInput: unknown, rawKey: string): Promise<Assessment> {
    const input = this.parseGrowthCreate(rawInput)
    const key = idempotencyKey(rawKey)
    const now = iso(this.clock)
    return this.store.transaction(async (tx) => {
      const replay = await this.findIdempotency(tx, userId, 'ASSESSMENT_CREATE', key, { studentId, ...input })
      if (replay) return this.requireAssessmentResource(tx, replay)
      const student = await tx.findById('students', studentId, { forUpdate: true })
      invariant(student, 404, 'STUDENT_NOT_FOUND', '学生档案不存在')
      const family = await tx.findById('families', student.familyId)
      invariant(family?.userId === userId, 403, 'ASSESSMENT_FORBIDDEN', '学生不属于当前家庭')
      const source = await tx.findById('assessments', input.sourceAssessmentId, { forUpdate: true })
      invariant(source?.userId === userId && source.studentId === student.id &&
        source.assessmentKind === 'FREE_PARENT_COMPASS' && source.status === 'SUBMITTED',
        409, 'LEVEL_1_SOURCE_REQUIRED', '开始学生测评前需要已完成的免费家长测评')
      await this.assertActiveAssessmentConsents(tx, source)
      const sourceReport = source.reportId
        ? await tx.findById('reports', source.reportId, { forUpdate: true })
        : null
      invariant(sourceReport?.reportKind === 'FAMILY_EDUCATION_SNAPSHOT' && sourceReport.resultPayload,
        409, 'LEVEL_1_RESULT_REQUIRED', '免费家长测评结果尚未生成')
      invariant(sourceReport.resultPayload.next_step_status === 'AVAILABLE', 409,
        'LEVEL_2_NOT_AVAILABLE', '当前家庭快照未建议直接进入学生本人测评')
      const assent = await this.ensureActiveConsent(tx, {
        userId, familyId: family.id, studentId: student.id, subjectType: 'STUDENT', subjectId: student.id,
        subjectRole: 'STUDENT', scope: 'STUDENT_ASSESSMENT_ASSENT', copyVersion: ASSENT_COPY_VERSION,
        copyTextHash: sha256(ASSENT_COPY), locale: 'zh-CN', guardianAuthorityStatus: 'NOT_APPLICABLE',
        sourceEntry: input.sourceEntry,
        auditMetadata: { guardianConfirmed: false, studentConfirmed: true, channel: 'MINIPROGRAM', purpose: 'STUDENT_ASSESSMENT_ASSENT' }
      }, now)
      const bank = getEducationCompassQuestionnaireBank('LEVEL_2', input.educationSystem)
      const bankVersions = {
        common: bank.commonBankVersion,
        ...(bank.systemBankVersion ? { system: bank.systemBankVersion } : {})
      }
      const assessment = await tx.insert('assessments', {
        id: this.ids('asm'), userId, familyId: family.id, studentId: student.id, consentId: source.consentId,
        questionnaireVersion: bank.questionnaireVersion, studentVersion: student.studentVersion,
        answers: {}, status: 'DRAFT', completenessScore: 0,
        missingFields: [...bank.requiredQuestionIds], reportId: null, createdAt: now, updatedAt: now, submittedAt: null,
        assessmentKind: 'STUDENT_GROWTH_DISCOVERY', assessmentLevel: 'LEVEL_2', respondentRole: 'STUDENT',
        sourceAssessmentId: source.id, educationSystem: input.educationSystem,
        gradeStage: student.gradeStage ?? null, sourceEntry: input.sourceEntry,
        commonBankVersion: bank.commonBankVersion, systemBankVersion: bank.systemBankVersion,
        bankVersions, schemaDigest: bank.schemaDigest, respondentConfirmation: 'CONFIRM_STUDENT_SELF',
        coreConsentGrantId: source.coreConsentGrantId ?? null, studentAssentGrantId: assent.id,
        resultKind: 'STUDENT_GROWTH_DISCOVERY', draftRevision: 1, submittedInputDigest: null
      })
      await this.completeIdempotency(tx, userId, 'ASSESSMENT_CREATE', key, { studentId, ...input }, 'assessment', assessment.id, 201, now)
      return assessment
    })
  }

  async questionnaire(userId: string, assessmentId: string): Promise<QuestionnaireBank> {
    return this.store.transaction(async (tx) => {
      const assessment = await this.ownedAssessment(tx, userId, assessmentId)
      await this.assertActiveAssessmentConsents(tx, assessment)
      return this.bankForAssessment(assessment)
    })
  }

  async getDraft(userId: string, assessmentId: string): Promise<Record<string, unknown>> {
    // Keep the consent rows locked through selection of the answer payload so a
    // concurrent withdrawal cannot race a stale read of a minor's draft.
    return this.store.transaction(async (tx) => {
      const assessment = await this.ownedAssessment(tx, userId, assessmentId)
      await this.assertActiveAssessmentConsents(tx, assessment)
      return {
        assessmentId: assessment.id,
        assessmentKind: assessment.assessmentKind,
        status: assessment.status,
        questionnaireVersion: assessment.questionnaireVersion,
        schemaDigest: assessment.schemaDigest,
        educationSystem: assessment.educationSystem ?? null,
        revision: assessment.draftRevision ?? 1,
        answers: assessment.answers,
        completenessCoverage: assessment.completenessScore,
        missingRequiredQuestionIds: assessment.missingFields
      }
    })
  }

  async saveDraft(userId: string, assessmentId: string, rawInput: unknown): Promise<Record<string, unknown>> {
    const input = this.parseDraft(rawInput)
    const now = iso(this.clock)
    return this.store.transaction(async (tx) => {
      const assessment = await this.ownedAssessment(tx, userId, assessmentId, true)
      await this.assertActiveAssessmentConsents(tx, assessment)
      invariant(assessment.status === 'DRAFT', 409, 'ASSESSMENT_ALREADY_SUBMITTED', '已提交的问卷不可修改')
      invariant(input.revision === (assessment.draftRevision ?? 1), 409, 'DRAFT_REVISION_STALE', '草稿版本已更新，请重新加载', {
        currentRevision: assessment.draftRevision ?? 1
      })
      let educationSystem = assessment.educationSystem ?? null
      let answersInput = input.answers
      if (assessment.assessmentKind === 'STUDENT_GROWTH_DISCOVERY' && input.educationSystem &&
        educationSystem && input.educationSystem !== educationSystem) {
        const switched = switchEducationSystemAnswers(input.answers, educationSystem, input.educationSystem, undefined, assessment.questionnaireVersion)
        answersInput = switched.answers
        educationSystem = input.educationSystem
        await tx.insert('auditLogs', {
          id: this.ids('aud'), actorUserId: userId, action: 'SYSTEM_ROUTE_CHANGED', entityType: 'assessment',
          entityId: assessment.id, metadata: { removedQuestionIds: switched.removedQuestionIds }, createdAt: now
        })
      }
      const level = assessment.assessmentKind === 'FREE_PARENT_COMPASS' ? 'LEVEL_1' : 'LEVEL_2'
      const validated = validateQuestionnaireAnswers({
        level,
        educationSystem: level === 'LEVEL_1' ? null : educationSystem as EducationSystem,
        questionnaireVersion: assessment.questionnaireVersion,
        answers: answersInput,
        mode: 'DRAFT'
      })
      const bank = level === 'LEVEL_1'
        ? getEducationCompassQuestionnaireBank('LEVEL_1', null, assessment.questionnaireVersion)
        : getEducationCompassQuestionnaireBank('LEVEL_2', educationSystem as EducationSystem, assessment.questionnaireVersion)
      const nextRevision = (assessment.draftRevision ?? 1) + 1
      const updated = await tx.update('assessments', assessment.id, {
        answers: recordPayload(validated.answers),
        completenessScore: validated.completenessCoverage,
        missingFields: [...validated.missingRequiredQuestionIds],
        educationSystem: level === 'LEVEL_1'
          ? (typeof validated.answers.FP02 === 'string' ? validated.answers.FP02 as EducationSystem : null)
          : educationSystem,
        gradeStage: level === 'LEVEL_1'
          ? (typeof validated.answers.FP01 === 'string' ? validated.answers.FP01 : null)
          : (typeof validated.answers.EGD02 === 'string' ? validated.answers.EGD02 : (assessment.gradeStage ?? null)),
        commonBankVersion: bank.commonBankVersion,
        systemBankVersion: bank.systemBankVersion,
        bankVersions: { common: bank.commonBankVersion, ...(bank.systemBankVersion ? { system: bank.systemBankVersion } : {}) },
        schemaDigest: bank.schemaDigest,
        respondentConfirmation: validated.answers.EGD01 === 'EXIT_NOT_STUDENT'
          ? 'EXIT_NOT_STUDENT'
          : (assessment.respondentConfirmation ?? (level === 'LEVEL_1' ? 'PARENT_GUARDIAN_CONFIRMED' : 'CONFIRM_STUDENT_SELF')),
        draftRevision: nextRevision,
        updatedAt: now
      })
      return {
        assessmentId: updated.id,
        revision: nextRevision,
        status: updated.status,
        educationSystem: updated.educationSystem ?? null,
        completenessCoverage: updated.completenessScore,
        missingRequiredQuestionIds: updated.missingFields,
        canSubmit: validated.canSubmit,
        respondentExitRequested: validated.respondentExitRequested,
        ...(input.clientSaveToken ? { clientSaveToken: input.clientSaveToken } : {})
      }
    })
  }

  async submit(userId: string, assessmentId: string, rawBody: unknown, rawKey: string): Promise<Record<string, unknown>> {
    const submitBody = exactObject(rawBody, ['revision'])
    invariant(Number.isInteger(submitBody.revision) && Number(submitBody.revision) >= 1,
      400, 'DRAFT_REVISION_INVALID', 'revision 无效')
    const key = idempotencyKey(rawKey)
    const now = iso(this.clock)
    return this.store.transaction(async (tx) => {
      const assessment = await this.ownedAssessment(tx, userId, assessmentId, true)
      await this.assertActiveAssessmentConsents(tx, assessment)
      invariant(submitBody.revision === (assessment.draftRevision ?? 1), 409, 'DRAFT_REVISION_STALE', '草稿版本已更新，请重新加载', {
        currentRevision: assessment.draftRevision ?? 1
      })
      const replay = await this.findIdempotency(tx, userId, 'ASSESSMENT_SUBMIT', key, {
        assessmentId, revision: assessment.draftRevision, answers: assessment.answers
      })
      if (replay) return this.submissionResponse(await this.requireAssessmentResource(tx, replay), tx)
      invariant(assessment.status === 'DRAFT', 409, 'ASSESSMENT_ALREADY_SUBMITTED', '问卷已经提交')
      const bank = this.bankForAssessment(assessment)
      const level = assessment.assessmentKind === 'FREE_PARENT_COMPASS' ? 'LEVEL_1' : 'LEVEL_2'
      const validated = validateQuestionnaireAnswers({
        level,
        educationSystem: level === 'LEVEL_1' ? null : assessment.educationSystem as EducationSystem,
        questionnaireVersion: assessment.questionnaireVersion,
        answers: assessment.answers,
        mode: 'SUBMIT'
      })
      invariant(validated.schemaDigest === assessment.schemaDigest, 409, 'QUESTIONNAIRE_SCHEMA_CHANGED', '问卷结构版本已变化')
      const result = assessment.assessmentKind === 'FREE_PARENT_COMPASS'
        ? buildFamilyEducationSnapshotV1(
            { familyId: assessment.familyId, studentId: assessment.studentId, assessmentId },
            validated.answers,
            { questionnaireVersion: assessment.questionnaireVersion }
          )
        : buildStudentGrowthDiscoveryReportV1(
            { familyId: assessment.familyId, studentId: assessment.studentId, assessmentId },
            assessment.educationSystem as EducationSystem,
            validated.answers,
            { questionnaireVersion: assessment.questionnaireVersion }
          )
      const reportId = this.ids('rpt')
      const isFree = assessment.assessmentKind === 'FREE_PARENT_COMPASS'
      const payload = recordPayload(result)
      const report: Report = {
        id: reportId, userId, familyId: assessment.familyId, studentId: assessment.studentId,
        assessmentId, status: isFree ? 'READY' : 'LOCKED', deliveryStatus: isFree ? 'DELIVERED' : 'LOCKED',
        preview: lockedPreview(reportId, assessmentId, now), modules: isFree ? null : growthModules(result as StudentGrowthDiscoveryReportV1),
        sources: [], dataAsOf: now.slice(0, 10), disclaimer: EDUCATION_COMPASS_DISCLAIMER,
        confidence: 'high', versions: {
          studentVersion: assessment.studentVersion,
          ruleVersion: 'education_compass_deterministic_rules_v1.0.0-rc1',
          dataVersion: bank.schemaDigest,
          promptVersion: 'none',
          templateVersion: isFree ? FAMILY_SNAPSHOT_VERSION : GROWTH_DISCOVERY_REPORT_VERSION
        },
        qaPassed: true, sourceCatalogVerified: false, sourceCatalogVersion: 'not-applicable',
        createdAt: now, updatedAt: now,
        reportKind: isFree ? 'FAMILY_EDUCATION_SNAPSHOT' : 'STUDENT_GROWTH_DISCOVERY',
        resultVersion: result.result_version, resultPayload: payload,
        ruleVersion: 'education_compass_deterministic_rules_v1.0.0-rc1',
        disclaimerVersion: EDUCATION_COMPASS_DISCLAIMER_VERSION,
        disclaimerTextHash: sha256(EDUCATION_COMPASS_DISCLAIMER)
      }
      await tx.insert('reports', report)
      await tx.insert('reportJobs', {
        id: this.ids('job'), orderId: null, reportId, status: 'SUCCEEDED', attempts: 1,
        lastError: null, createdAt: now, updatedAt: now
      })
      const submittedEducationSystem = isFree
        ? (result as { education_system: EducationSystem }).education_system
        : (result as StudentGrowthDiscoveryReportV1).student_snapshot.education_system
      const submittedGradeStage = isFree
        ? (result as { grade_stage: string }).grade_stage
        : (result as StudentGrowthDiscoveryReportV1).student_snapshot.grade_stage
      const student = await tx.findById('students', assessment.studentId, { forUpdate: true })
      invariant(student, 409, 'STUDENT_NOT_FOUND', '学生档案不存在')
      const studentRevision = Number(student.studentVersion.replace(/^v/, ''))
      await tx.update('students', student.id, {
        educationSystem: submittedEducationSystem,
        grade: submittedGradeStage,
        gradeStage: submittedGradeStage,
        profileStatus: 'COMPLETE_FOR_LEVEL_2',
        profileSchemaVersion: 'student_profile_v0.5.0',
        studentVersion: `v${Number.isFinite(studentRevision) ? studentRevision + 1 : 2}`,
        updatedAt: now
      })
      const submitted = await tx.update('assessments', assessment.id, {
        status: 'SUBMITTED', reportId, completenessScore: 100, missingFields: [], submittedAt: now,
        submittedInputDigest: sha256(canonicalJson(validated.answers)), updatedAt: now,
        educationSystem: submittedEducationSystem,
        gradeStage: submittedGradeStage,
        respondentConfirmation: isFree ? 'PARENT_GUARDIAN_CONFIRMED' : 'CONFIRM_STUDENT_SELF'
      })
      await this.completeIdempotency(tx, userId, 'ASSESSMENT_SUBMIT', key, {
        assessmentId, revision: assessment.draftRevision, answers: assessment.answers
      }, 'assessment', assessment.id, 200, now)
      return this.submissionResponse(submitted, tx)
    })
  }

  async result(userId: string, assessmentId: string): Promise<Record<string, unknown>> {
    // Use a real transaction so PostgreSQL keeps the consent locks until the
    // report payload has been selected; Store.read releases SELECT locks after
    // each statement and could otherwise race with a withdrawal.
    return this.store.transaction(async (tx) => {
      const assessment = await this.ownedAssessment(tx, userId, assessmentId)
      await this.assertActiveAssessmentConsents(tx, assessment)
      invariant(assessment.status === 'SUBMITTED' && assessment.reportId, 409, 'RESULT_NOT_READY', '问卷尚未提交')
      const report = await tx.findById('reports', assessment.reportId)
      invariant(report?.resultPayload, 409, 'RESULT_NOT_READY', '结果尚未生成')
      if (assessment.assessmentKind === 'FREE_PARENT_COMPASS') {
        return { assessmentId, resultState: 'READY', reportId: report.id, result: report.resultPayload }
      }
      const entitlement = await tx.findOne('entitlements', { userId, reportId: report.id, status: 'ACTIVE' })
      if (entitlement?.productCode !== GROWTH_DISCOVERY_PRODUCT_CODE || report.status !== 'READY' || report.deliveryStatus !== 'DELIVERED') {
        return this.lockedResponse(assessment, report)
      }
      return {
        assessmentId, resultState: 'READY', reportId: report.id,
        resultKind: report.reportKind, resultVersion: report.resultVersion, result: report.resultPayload
      }
    })
  }

  async product(): Promise<Record<string, unknown>> {
    return this.store.read(async (tx) => {
      const product = await tx.findById('products', GROWTH_DISCOVERY_PRODUCT_CODE)
      invariant(product?.active, 404, 'PRODUCT_UNAVAILABLE', '学生成长发现商品不可用')
      return {
        productCode: product.code,
        productName: product.name,
        amountFen: product.amountFen,
        currency: product.currency,
        displayPrice: `¥${(product.amountFen / 100).toFixed(2)}`,
        paymentTiming: 'AFTER_SUBMIT_BEFORE_REPORT',
        paymentEnabled: this.growthPaymentEnabled
      }
    })
  }

  async setFeishuProfileConsent(userId: string, rawInput: unknown): Promise<Record<string, unknown>> {
    const body = exactObject(rawInput, ['studentId', 'enabled', 'copyVersion', 'locale', 'guardianAuthorityConfirmed'])
    invariant(typeof body.studentId === 'string' && body.studentId.length > 0, 400, 'STUDENT_ID_REQUIRED', '缺少学生ID')
    invariant(typeof body.enabled === 'boolean', 400, 'CONSENT_ENABLED_INVALID', 'enabled 必须是布尔值')
    invariant(body.copyVersion === FEISHU_COPY_VERSION && body.locale === 'zh-CN' && body.guardianAuthorityConfirmed === true,
      400, 'FEISHU_CONSENT_INVALID', '飞书资料镜像同意版本无效')
    const now = iso(this.clock)
    return this.store.transaction(async (tx) => {
      const student = await tx.findById('students', body.studentId as string)
      invariant(student, 404, 'STUDENT_NOT_FOUND', '学生档案不存在')
      const family = await tx.findById('families', student.familyId)
      invariant(family?.userId === userId, 403, 'CONSENT_FORBIDDEN', '无权管理该学生同意')
      const active = await tx.findOne('consentGrants', {
        userId, subjectType: 'STUDENT', subjectId: student.id, scope: 'FEISHU_PROFILE_MIRROR', withdrawnAt: null
      })
      if (body.enabled === false) {
        if (active) await tx.update('consentGrants', active.id, { withdrawnAt: now, updatedAt: now })
        let remoteMinimizationTargets = 0
        for (const target of [
          { entityType: 'student_profile' as const, entityId: student.id },
          { entityType: 'family_profile' as const, entityId: family.id }
        ]) {
          const links = await tx.findMany('integrationLinks', {
            provider: 'feishu_bitable', entityType: target.entityType, entityId: target.entityId
          })
          for (const link of links) {
            if (link.externalRecordId) remoteMinimizationTargets += 1
            await tx.update('integrationLinks', link.id, {
              status: 'BLOCKED', leaseToken: null, operationToken: null,
              operationDigest: null, operationBody: null,
              lastErrorCode: 'FEISHU_CONSENT_WITHDRAWN', nextAttemptAt: null, updatedAt: now
            })
          }
        }
        if (remoteMinimizationTargets > 0) {
          await tx.insert('auditLogs', {
            id: this.ids('aud'), actorUserId: userId,
            action: 'FEISHU_REMOTE_MINIMIZATION_REVIEW_REQUIRED',
            entityType: 'student', entityId: student.id,
            metadata: {
              reason: 'CONSENT_WITHDRAWN', remoteRecordCount: remoteMinimizationTargets,
              sopStatus: 'BLOCKED_EXTERNAL_PRIVACY_APPROVAL'
            },
            createdAt: now
          })
        }
        return { scope: 'FEISHU_PROFILE_MIRROR', enabled: false, updatedAt: now }
      }
      const grant = await this.ensureActiveConsent(tx, {
        userId, familyId: family.id, studentId: student.id, subjectType: 'STUDENT', subjectId: student.id,
        subjectRole: 'PARENT_GUARDIAN', scope: 'FEISHU_PROFILE_MIRROR', copyVersion: FEISHU_COPY_VERSION,
        copyTextHash: sha256(FEISHU_COPY), locale: 'zh-CN', guardianAuthorityStatus: 'CONFIRMED',
        sourceEntry: 'MINIPROGRAM_HOME',
        auditMetadata: { guardianConfirmed: true, studentConfirmed: false, channel: 'MINIPROGRAM', purpose: 'FEISHU_PROFILE_MIRROR' }
      }, now)
      return { scope: grant.scope, enabled: true, consentVersion: grant.copyVersion, updatedAt: grant.updatedAt }
    })
  }

  async withdrawAssessmentConsent(
    userId: string,
    studentId: string,
    scope: 'CORE_ASSESSMENT' | 'STUDENT_ASSESSMENT_ASSENT'
  ): Promise<Record<string, unknown>> {
    invariant(scope === 'CORE_ASSESSMENT' || scope === 'STUDENT_ASSESSMENT_ASSENT',
      400, 'ASSESSMENT_CONSENT_SCOPE_INVALID', '只能撤回核心测评同意或学生本人 assent')
    const now = iso(this.clock)
    return this.store.transaction(async (tx) => {
      const student = await tx.findById('students', studentId, { forUpdate: true })
      invariant(student, 404, 'STUDENT_NOT_FOUND', '学生档案不存在')
      const family = await tx.findById('families', student.familyId)
      invariant(family?.userId === userId, 403, 'CONSENT_FORBIDDEN', '无权管理该学生同意')
      const active = await tx.findMany('consentGrants', {
        userId, familyId: family.id, studentId, subjectType: 'STUDENT', subjectId: studentId,
        scope, withdrawnAt: null
      })
      for (const grant of active) {
        await tx.update('consentGrants', grant.id, { withdrawnAt: now, updatedAt: now })
      }
      if (scope === 'CORE_ASSESSMENT' && active.length) {
        const grantIds = new Set(active.map((grant) => grant.id))
        const assessments = await tx.findMany('assessments', { userId, familyId: family.id, studentId })
        for (const assessment of assessments.filter((item) =>
          item.assessmentKind !== 'LEGACY_EDUCATION_COMPASS' && item.coreConsentGrantId && grantIds.has(item.coreConsentGrantId))) {
          const compatibility = await tx.findById('consents', assessment.consentId, { forUpdate: true })
          if (compatibility && !compatibility.revokedAt) {
            await tx.update('consents', compatibility.id, { revokedAt: now })
          }
        }
      }
      const agentFence = await fenceAgentStudentAccess(
        tx, userId, studentId, now,
        scope === 'CORE_ASSESSMENT' ? 'CORE_ASSESSMENT_CONSENT_WITHDRAWN' : 'STUDENT_ASSESSMENT_ASSENT_WITHDRAWN'
      )
      await tx.insert('auditLogs', {
        id: this.ids('aud'), actorUserId: userId, action: 'ASSESSMENT_CONSENT_WITHDRAWN',
        entityType: 'student', entityId: studentId,
        metadata: { scope, withdrawnGrantCount: active.length, agentFence }, createdAt: now
      })
      await appendTimeline(tx, this.ids, now, {
        userId, familyId: family.id, eventType: 'assessment_consent_withdrawn',
        description: scope === 'CORE_ASSESSMENT' ? '已撤回核心测评授权' : '学生已撤回本人测评同意',
        reportId: null, orderId: null
      })
      return { scope, studentId, enabled: false, withdrawnAt: now, withdrawnGrantCount: active.length }
    })
  }

  private parseFreeCreate(raw: unknown): FreeParentCreateInput {
    const body = exactObject(raw, ['studentId', 'sourceEntry', 'consent'])
    invariant(typeof body.studentId === 'string' && body.studentId.length > 0, 400, 'STUDENT_ID_REQUIRED', '缺少学生ID')
    const consent = exactObject(body.consent, ['scope', 'copyVersion', 'locale', 'guardianAuthorityConfirmed'], 'CONSENT_INVALID')
    invariant(consent.scope === 'CORE_ASSESSMENT' && consent.copyVersion === CORE_COPY_VERSION &&
      consent.locale === 'zh-CN' && consent.guardianAuthorityConfirmed === true, 400, 'CONSENT_INVALID', '核心测评同意无效')
    return {
      studentId: body.studentId,
      sourceEntry: sourceEntry(body.sourceEntry),
      consent: consent as unknown as FreeParentCreateInput['consent']
    }
  }

  private parseGrowthCreate(raw: unknown): GrowthDiscoveryCreateInput {
    const body = exactObject(raw, ['assessmentKind', 'sourceAssessmentId', 'sourceEntry', 'educationSystem', 'respondent', 'assent'])
    invariant(body.assessmentKind === 'STUDENT_GROWTH_DISCOVERY' && typeof body.sourceAssessmentId === 'string' &&
      (body.sourceEntry === 'LEVEL_1_RESULT' || body.sourceEntry === 'INTERNAL_UAT') &&
      isEducationSystem(body.educationSystem) && body.respondent === 'STUDENT',
      400, 'GROWTH_DISCOVERY_CREATE_INVALID', '学生成长发现创建参数无效')
    const assent = exactObject(body.assent, ['scope', 'copyVersion', 'locale', 'studentConfirmed'], 'STUDENT_ASSENT_INVALID')
    invariant(assent.scope === 'STUDENT_ASSESSMENT_ASSENT' && assent.copyVersion === ASSENT_COPY_VERSION &&
      assent.locale === 'zh-CN' && assent.studentConfirmed === true, 400, 'STUDENT_ASSENT_INVALID', '学生本人同意无效')
    return {
      assessmentKind: 'STUDENT_GROWTH_DISCOVERY', sourceAssessmentId: body.sourceAssessmentId,
      sourceEntry: body.sourceEntry, educationSystem: body.educationSystem, respondent: 'STUDENT',
      assent: assent as unknown as GrowthDiscoveryCreateInput['assent']
    }
  }

  private parseDraft(raw: unknown): SaveEducationDraftInput {
    const body = exactObject(raw, ['revision', 'answers', 'educationSystem', 'clientSaveToken'])
    invariant(Number.isInteger(body.revision) && Number(body.revision) >= 1, 400, 'DRAFT_REVISION_INVALID', 'revision 无效')
    invariant(body.answers !== null && typeof body.answers === 'object' && !Array.isArray(body.answers),
      400, 'INVALID_ANSWERS', 'answers 必须是对象')
    invariant(body.educationSystem === undefined || isEducationSystem(body.educationSystem),
      400, 'EDUCATION_SYSTEM_INVALID', '教育体系 code 无效')
    invariant(body.clientSaveToken === undefined ||
      (typeof body.clientSaveToken === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(body.clientSaveToken)),
      400, 'CLIENT_SAVE_TOKEN_INVALID', 'clientSaveToken 无效')
    return {
      revision: Number(body.revision), answers: body.answers,
      ...(body.educationSystem ? { educationSystem: body.educationSystem as EducationSystem } : {}),
      ...(body.clientSaveToken ? { clientSaveToken: body.clientSaveToken as string } : {})
    }
  }

  private bankForAssessment(assessment: Assessment): QuestionnaireBank {
    invariant(assessment.assessmentKind === 'FREE_PARENT_COMPASS' || assessment.assessmentKind === 'STUDENT_GROWTH_DISCOVERY',
      409, 'ASSESSMENT_VERSION_LEGACY', '该接口不处理历史问卷')
    return assessment.assessmentKind === 'FREE_PARENT_COMPASS'
      ? getEducationCompassQuestionnaireBank('LEVEL_1', null, assessment.questionnaireVersion)
      : getEducationCompassQuestionnaireBank('LEVEL_2', assessment.educationSystem as EducationSystem, assessment.questionnaireVersion)
  }

  private async ownedAssessment(tx: StoreTransaction, userId: string, assessmentId: string, forUpdate = false): Promise<Assessment> {
    const assessment = await tx.findById('assessments', assessmentId, { forUpdate })
    invariant(assessment, 404, 'ASSESSMENT_NOT_FOUND', '问卷不存在')
    invariant(assessment.userId === userId, 403, 'ASSESSMENT_FORBIDDEN', '无权访问该问卷')
    invariant(assessment.assessmentKind !== 'LEGACY_EDUCATION_COMPASS', 409, 'ASSESSMENT_VERSION_LEGACY', '该接口不处理历史问卷')
    return assessment
  }

  private async insertConsent(
    tx: StoreTransaction,
    value: Omit<ConsentGrant, 'id' | 'grantedAt' | 'withdrawnAt' | 'createdAt' | 'updatedAt'>,
    now: string
  ): Promise<ConsentGrant> {
    return tx.insert('consentGrants', {
      id: this.ids('cgr'), ...value, grantedAt: now, withdrawnAt: null, createdAt: now, updatedAt: now
    })
  }

  private async ensureActiveConsent(
    tx: StoreTransaction,
    value: Omit<ConsentGrant, 'id' | 'grantedAt' | 'withdrawnAt' | 'createdAt' | 'updatedAt'>,
    now: string
  ): Promise<ConsentGrant> {
    const active = await tx.findOne('consentGrants', {
      userId: value.userId,
      subjectType: value.subjectType,
      subjectId: value.subjectId,
      scope: value.scope,
      withdrawnAt: null
    }, { forUpdate: true })
    if (!active) return this.insertConsent(tx, value, now)
    invariant(active.familyId === value.familyId && active.studentId === value.studentId &&
      active.subjectRole === value.subjectRole && active.copyVersion === value.copyVersion &&
      active.copyTextHash === value.copyTextHash && active.locale === value.locale &&
      active.guardianAuthorityStatus === value.guardianAuthorityStatus,
      409, 'CONSENT_ACTIVE_VERSION_CONFLICT', '当前主体已有不同版本的有效同意，请先完成受控撤回或版本迁移')
    return active
  }

  private async assertActiveAssessmentConsents(tx: StoreTransaction, assessment: Assessment): Promise<void> {
    invariant(assessment.coreConsentGrantId, 403, 'CORE_ASSESSMENT_CONSENT_REQUIRED', '核心测评同意缺失或已撤回')
    const core = await tx.findById('consentGrants', assessment.coreConsentGrantId, { forUpdate: true })
    invariant(core?.userId === assessment.userId && core.familyId === assessment.familyId &&
      core.studentId === assessment.studentId && core.subjectType === 'STUDENT' &&
      core.subjectId === assessment.studentId && core.scope === 'CORE_ASSESSMENT' &&
      core.subjectRole === 'PARENT_GUARDIAN' && core.copyVersion === CORE_COPY_VERSION &&
      core.copyTextHash === sha256(CORE_COPY) && core.locale === 'zh-CN' &&
      core.guardianAuthorityStatus === 'CONFIRMED' && !core.withdrawnAt,
      403, 'CORE_ASSESSMENT_CONSENT_REQUIRED', '核心测评同意缺失或已撤回')
    if (assessment.assessmentKind !== 'STUDENT_GROWTH_DISCOVERY') return
    invariant(assessment.studentAssentGrantId, 403, 'STUDENT_ASSESSMENT_ASSENT_REQUIRED', '学生本人同意缺失或已撤回')
    const assent = await tx.findById('consentGrants', assessment.studentAssentGrantId, { forUpdate: true })
    invariant(assent?.userId === assessment.userId && assent.familyId === assessment.familyId &&
      assent.studentId === assessment.studentId && assent.subjectType === 'STUDENT' &&
      assent.subjectId === assessment.studentId && assent.scope === 'STUDENT_ASSESSMENT_ASSENT' &&
      assent.copyVersion === ASSENT_COPY_VERSION && assent.subjectRole === 'STUDENT' &&
      assent.copyTextHash === sha256(ASSENT_COPY) && assent.locale === 'zh-CN' &&
      assent.guardianAuthorityStatus === 'NOT_APPLICABLE' && !assent.withdrawnAt,
      403, 'STUDENT_ASSESSMENT_ASSENT_REQUIRED', '学生本人同意缺失或已撤回')
  }

  private async hasActiveAssessmentConsents(tx: StoreTransaction, assessment: Assessment): Promise<boolean> {
    const subject = {
      userId: assessment.userId,
      familyId: assessment.familyId,
      studentId: assessment.studentId
    }
    const core = assessment.coreConsentGrantId
      ? await tx.findById('consentGrants', assessment.coreConsentGrantId)
      : null
    if (!isExactActiveCoreAssessmentConsent(core, subject)) return false
    if (assessment.assessmentKind !== 'STUDENT_GROWTH_DISCOVERY') return true
    const assent = assessment.studentAssentGrantId
      ? await tx.findById('consentGrants', assessment.studentAssentGrantId)
      : null
    return isExactActiveStudentAssessmentAssent(assent, subject)
  }

  private async findIdempotency(
    tx: StoreTransaction,
    userId: string,
    domain: IdempotencyRecord['domain'],
    key: string,
    input: unknown
  ): Promise<IdempotencyRecord | null> {
    const keyDigest = sha256(key)
    const inputDigest = sha256(canonicalJson(input))
    const record = await tx.findOne('idempotencyRecords', { userId, domain, keyDigest }, { forUpdate: true })
    if (!record) return null
    invariant(record.inputDigest === inputDigest, 409, 'IDEMPOTENCY_KEY_REUSED', '相同 Idempotency-Key 已用于不同输入')
    invariant(record.status === 'COMPLETED' && record.resourceId, 409, 'IDEMPOTENCY_IN_PROGRESS', '幂等请求仍在处理中')
    return record
  }

  private async completeIdempotency(
    tx: StoreTransaction,
    userId: string,
    domain: IdempotencyRecord['domain'],
    key: string,
    input: unknown,
    resourceType: string,
    resourceId: string,
    responseStatus: number,
    now: string
  ): Promise<void> {
    await tx.insert('idempotencyRecords', {
      id: this.ids('idem'), userId, domain, keyDigest: sha256(key), inputDigest: sha256(canonicalJson(input)),
      status: 'COMPLETED', resourceType, resourceId, responseStatus,
      responseDigest: sha256(canonicalJson({ resourceType, resourceId, responseStatus })),
      createdAt: now, updatedAt: now, completedAt: now
    })
  }

  private async requireAssessmentResource(tx: StoreTransaction, record: IdempotencyRecord): Promise<Assessment> {
    invariant(record.resourceType === 'assessment' && record.resourceId, 500, 'IDEMPOTENCY_RESOURCE_INVALID', '幂等资源无效')
    const assessment = await tx.findById('assessments', record.resourceId)
    invariant(assessment, 500, 'IDEMPOTENCY_RESOURCE_MISSING', '幂等资源不存在')
    return assessment
  }

  private async submissionResponse(assessment: Assessment, tx: StoreTransaction): Promise<Record<string, unknown>> {
    invariant(assessment.reportId, 500, 'RESULT_NOT_READY', '提交结果缺少报告')
    const report = await tx.findById('reports', assessment.reportId)
    invariant(report?.resultPayload, 500, 'RESULT_NOT_READY', '提交结果缺少报告内容')
    if (assessment.assessmentKind === 'FREE_PARENT_COMPASS') {
      return { assessmentId: assessment.id, status: 'SUBMITTED', reportId: report.id, resultState: 'READY', result: report.resultPayload }
    }
    return this.lockedResponse(assessment, report)
  }

  private lockedResponse(assessment: Assessment, report: Report): Record<string, unknown> {
    return {
      assessmentId: assessment.id,
      reportId: report.id,
      resultState: 'LOCKED',
      productCode: GROWTH_DISCOVERY_PRODUCT_CODE,
      amountFen: 3990,
      currency: 'CNY',
      nextAction: 'PURCHASE_TO_UNLOCK_REPORT',
      systemResultMarker: assessment.educationSystem === 'IB' || assessment.educationSystem === 'OTHER'
        ? 'SYSTEM_BANK_PENDING'
        : 'FULL_SYSTEM_BANK'
    }
  }
}
