import { invariant } from '../domain/errors'
import { buildLockedReport, generateSixModuleReport } from '../domain/report-builder'
import { calculateCompleteness, normalizeAnswers, QUESTIONNAIRE_VERSION } from '../domain/questionnaire'
import { Assessment, Report, ReportPreview, Student } from '../domain/model'
import { PLACEHOLDER_SOURCE_CATALOG, SourceCatalog } from '../domain/source-catalog'
import { Store } from '../store/store'
import { Clock, IdFactory, iso, randomId, systemClock } from '../utils/runtime'
import { appendTimeline } from './profile-service'

export interface CreateAssessmentInput {
  familyId: string
  questionnaireVersion: string
  studentVersion: string
  consent: {
    consentVersion: string
    scope: 'education_compass_report'
    guardianConfirmed: boolean
  }
}

export class AssessmentService {
  constructor(
    private readonly store: Store,
    private readonly sourceCatalog: SourceCatalog = PLACEHOLDER_SOURCE_CATALOG,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdFactory = randomId,
    private readonly reportGenerator: (report: Report, assessment: Assessment, student: Student, now: string) => Report = generateSixModuleReport
  ) {}

  async create(userId: string, studentId: string, input: CreateAssessmentInput): Promise<Assessment> {
    invariant(input.questionnaireVersion === QUESTIONNAIRE_VERSION, 400, 'QUESTIONNAIRE_VERSION_UNSUPPORTED', '不支持该问卷版本')
    invariant(input.consent?.guardianConfirmed === true, 403, 'GUARDIAN_CONSENT_REQUIRED', '需要监护人确认后才能开始问卷')
    invariant(input.consent.scope === 'education_compass_report', 400, 'CONSENT_SCOPE_INVALID', '监护人同意范围无效')
    invariant(typeof input.consent.consentVersion === 'string' && input.consent.consentVersion.trim().length > 0, 400, 'CONSENT_VERSION_REQUIRED', '缺少监护人同意版本')
    const now = iso(this.clock)
    return this.store.transaction(async (tx) => {
      const student = await tx.findById('students', studentId, { forUpdate: true })
      invariant(student, 404, 'STUDENT_NOT_FOUND', '孩子档案不存在')
      const family = await tx.findById('families', student.familyId)
      invariant(family?.userId === userId && family.id === input.familyId, 403, 'ASSESSMENT_FORBIDDEN', '家庭或孩子归属校验失败')
      invariant(student.studentVersion === input.studentVersion, 409, 'STUDENT_VERSION_STALE', '孩子档案已更新，请刷新后重试')
      const consent = await tx.insert('consents', {
        id: this.ids('cns'), userId, familyId: family.id, studentId,
        consentVersion: input.consent.consentVersion.trim(), scope: 'education_compass_report',
        guardianConfirmed: true, agreedAt: now, revokedAt: null
      })
      return tx.insert('assessments', {
        id: this.ids('asm'), userId, familyId: family.id, studentId, consentId: consent.id,
        questionnaireVersion: QUESTIONNAIRE_VERSION, studentVersion: student.studentVersion,
        answers: {}, status: 'DRAFT', completenessScore: 0,
        missingFields: calculateCompleteness({}).missingFields, reportId: null,
        createdAt: now, updatedAt: now, submittedAt: null,
        assessmentKind: 'LEGACY_EDUCATION_COMPASS', assessmentLevel: 'LEGACY', respondentRole: 'LEGACY_UNSPECIFIED',
        sourceAssessmentId: null, educationSystem: null, sourceEntry: 'LEGACY_V0_4_1',
        bankVersions: { legacy: QUESTIONNAIRE_VERSION }, schemaDigest: null,
        commonBankVersion: QUESTIONNAIRE_VERSION, systemBankVersion: null,
        respondentConfirmation: 'LEGACY_UNSPECIFIED', coreConsentGrantId: null,
        studentAssentGrantId: null, resultKind: 'LEGACY_EDUCATION_COMPASS_REPORT', draftRevision: 1,
        submittedInputDigest: null
      })
    })
  }

  async saveDraft(userId: string, assessmentId: string, answersInput: unknown): Promise<Assessment> {
    const answers = normalizeAnswers(answersInput)
    const completeness = calculateCompleteness(answers)
    const now = iso(this.clock)
    return this.store.transaction(async (tx) => {
      const assessment = await tx.findById('assessments', assessmentId, { forUpdate: true })
      invariant(assessment, 404, 'ASSESSMENT_NOT_FOUND', '问卷不存在')
      invariant(assessment.userId === userId, 403, 'ASSESSMENT_FORBIDDEN', '无权修改该问卷')
      invariant(assessment.status === 'DRAFT', 409, 'ASSESSMENT_ALREADY_SUBMITTED', '问卷已经提交')
      return tx.update('assessments', assessmentId, {
        answers,
        completenessScore: completeness.score,
        missingFields: completeness.missingFields,
        updatedAt: now,
        draftRevision: (assessment.draftRevision ?? 0) + 1
      })
    })
  }

  async getDraft(userId: string, assessmentId: string): Promise<{
    assessmentId: string
    status: Assessment['status']
    questionnaireVersion: string
    answers: Record<string, unknown>
    completenessScore: number
  }> {
    return this.store.read(async (tx) => {
      const assessment = await tx.findById('assessments', assessmentId)
      invariant(assessment, 404, 'ASSESSMENT_NOT_FOUND', '问卷不存在')
      invariant(assessment.userId === userId, 403, 'ASSESSMENT_FORBIDDEN', '无权访问该问卷')
      return {
        assessmentId: assessment.id,
        status: assessment.status,
        questionnaireVersion: assessment.questionnaireVersion,
        answers: assessment.answers,
        completenessScore: assessment.completenessScore
      }
    })
  }

  async submit(userId: string, assessmentId: string): Promise<{
    assessmentId: string
    status: 'PREVIEW_READY'
    completenessScore: number
    confidence: 'low' | 'medium' | 'high'
    reportId: string
  }> {
    const now = iso(this.clock)
    return this.store.transaction(async (tx) => {
      let assessment = await tx.findById('assessments', assessmentId, { forUpdate: true })
      invariant(assessment, 404, 'ASSESSMENT_NOT_FOUND', '问卷不存在')
      invariant(assessment.userId === userId, 403, 'ASSESSMENT_FORBIDDEN', '无权提交该问卷')
      const completeness = calculateCompleteness(assessment.answers)
      invariant(completeness.score >= 70, 422, 'ASSESSMENT_INCOMPLETE', '问卷完整度不足70%，请补充缺失项', {
        completenessScore: completeness.score,
        missingFields: completeness.missingFields
      })
      const consent = await tx.findById('consents', assessment.consentId)
      invariant(consent?.guardianConfirmed && !consent.revokedAt, 403, 'GUARDIAN_CONSENT_REQUIRED', '监护人同意无效或已撤回')

      if (assessment.status === 'PREVIEW_READY' && assessment.reportId) {
        return {
          assessmentId: assessment.id,
          status: 'PREVIEW_READY' as const,
          completenessScore: assessment.completenessScore,
          confidence: completeness.confidence,
          reportId: assessment.reportId
        }
      }

      const student = await tx.findById('students', assessment.studentId)
      invariant(student, 409, 'STUDENT_NOT_FOUND', '孩子档案不存在')
      const reportId = this.ids('rpt')
      assessment = await tx.update('assessments', assessment.id, {
        status: 'PREVIEW_READY', completenessScore: completeness.score,
        missingFields: completeness.missingFields, reportId, submittedAt: now, updatedAt: now
      })
      const shell = buildLockedReport(reportId, assessment, student, now, this.sourceCatalog)
      const report = this.reportGenerator(shell, assessment, student, now)
      invariant(report.status === 'LOCKED' && report.deliveryStatus === 'LOCKED' && report.qaPassed && report.modules?.length === 6,
        500, 'REPORT_QA_FAILED', '六模块报告未通过收费前QA')
      await tx.insert('reports', report)
      await tx.insert('reportJobs', {
        id: this.ids('job'), orderId: null, reportId,
        status: 'SUCCEEDED', attempts: 1, lastError: null, createdAt: now, updatedAt: now
      })
      await appendTimeline(tx, this.ids, now, {
        userId, familyId: assessment.familyId, eventType: 'compass_completed',
        description: '已完成 Education Compass 并生成付费预览', reportId, orderId: null
      })
      return {
        assessmentId: assessment.id,
        status: 'PREVIEW_READY' as const,
        completenessScore: completeness.score,
        confidence: completeness.confidence,
        reportId
      }
    })
  }

  async preview(userId: string, assessmentId: string): Promise<ReportPreview> {
    return this.store.read(async (tx) => {
      const assessment = await tx.findById('assessments', assessmentId)
      invariant(assessment, 404, 'ASSESSMENT_NOT_FOUND', '问卷不存在')
      invariant(assessment.userId === userId, 403, 'ASSESSMENT_FORBIDDEN', '无权访问该问卷')
      invariant(assessment.status === 'PREVIEW_READY' && assessment.reportId, 409, 'PREVIEW_NOT_READY', '问卷尚未生成预览')
      const report = await tx.findById('reports', assessment.reportId)
      invariant(report, 409, 'PREVIEW_NOT_READY', '预览尚未生成')
      return report.preview
    })
  }
}
