import { invariant } from '../domain/errors'
import {
  CORE_ASSESSMENT_CONSENT_COPY,
  CORE_ASSESSMENT_CONSENT_VERSION,
  STUDENT_ASSESSMENT_ASSENT_COPY,
  STUDENT_ASSESSMENT_ASSENT_VERSION,
  consentCopySha256
} from '../domain/education-compass/consent-policy'
import { buildNextSupportCapabilityV1, NextSupportCapabilityV1 } from '../domain/education-compass/next-support'
import { Assessment, Feedback, Report } from '../domain/model'
import { renderSimpleReportPdf } from '../pdf/simple-pdf'
import { Store, StoreTransaction } from '../store/store'
import { Clock, IdFactory, iso, randomId, systemClock } from '../utils/runtime'

export type ReportResponse =
  | {
      access: 'preview'
      reportId: string
      status: Report['status']
      deliveryStatus: Report['deliveryStatus']
      qaPassed: boolean
      preview: Report['preview']
      entitled: boolean
      reportKind: Report['reportKind']
      resultVersion: string | null | undefined
      capabilities: { nextSupport: Readonly<NextSupportCapabilityV1> }
    }
  | {
      access: 'full'
      reportId: string
      status: 'READY'
      deliveryStatus: 'DELIVERED'
      qaPassed: true
      entitled: true
      preview: Report['preview']
      full: {
        modules: NonNullable<Report['modules']>
        sources: Report['sources']
        dataAsOf: string
        versions: Report['versions']
        confidence: Report['confidence']
        disclaimer: string
        result?: Record<string, unknown>
      }
      reportKind: Report['reportKind']
      resultVersion: string | null | undefined
      capabilities: { nextSupport: Readonly<NextSupportCapabilityV1> }
    }

export class ReportService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdFactory = randomId
  ) {}

  async get(userId: string, reportId: string): Promise<ReportResponse> {
    return this.store.transaction(async (tx) => {
      const report = await tx.findById('reports', reportId)
      invariant(report, 404, 'REPORT_NOT_FOUND', '报告不存在')
      invariant(report.userId === userId, 403, 'REPORT_FORBIDDEN', '无权访问该报告')
      const assessment = await this.assertV05AssessmentConsents(tx, userId, report)
      const nextSupport = async (access: 'preview' | 'full'): Promise<Readonly<NextSupportCapabilityV1>> => {
        const source = assessment?.sourceAssessmentId
          ? await tx.findById('assessments', assessment.sourceAssessmentId)
          : null
        const sourceLevel1Answers = source?.userId === userId && source.familyId === report.familyId &&
          source.studentId === report.studentId && source.assessmentKind === 'FREE_PARENT_COMPASS'
          ? source.answers
          : null
        return buildNextSupportCapabilityV1({
          sourceAssessmentId: report.assessmentId,
          sourceReportId: report.id,
          sourceLevel1Answers,
          growthAnswers: assessment?.assessmentKind === 'STUDENT_GROWTH_DISCOVERY' ? assessment.answers : null,
          reportAccess: access
        })
      }
      const entitlement = await tx.findOne('entitlements', { userId, reportId, status: 'ACTIVE' })
      const growthReportReady = report.reportKind === 'STUDENT_GROWTH_DISCOVERY' &&
        entitlement?.productCode === 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1' && Boolean(report.resultPayload)
      const legacyReportReady = report.reportKind !== 'STUDENT_GROWTH_DISCOVERY' &&
        Array.isArray(report.modules) && report.modules.length > 0
      if (!entitlement || report.status !== 'READY' || report.deliveryStatus !== 'DELIVERED' ||
        !report.qaPassed || (!growthReportReady && !legacyReportReady)) {
        return {
          access: 'preview' as const,
          reportId,
          status: report.status,
          deliveryStatus: report.deliveryStatus,
          qaPassed: report.qaPassed,
          preview: report.preview,
          entitled: Boolean(entitlement),
          reportKind: report.reportKind,
          resultVersion: report.resultVersion,
          capabilities: { nextSupport: await nextSupport('preview') }
        }
      }
      return {
        access: 'full' as const,
        reportId,
        status: 'READY' as const,
        deliveryStatus: 'DELIVERED' as const,
        qaPassed: true as const,
        entitled: true as const,
        preview: report.preview,
        reportKind: report.reportKind,
        resultVersion: report.resultVersion,
        capabilities: { nextSupport: await nextSupport('full') },
        full: {
          modules: report.modules ?? [],
          sources: report.sources,
          dataAsOf: report.dataAsOf,
          versions: report.versions,
          confidence: report.confidence,
          disclaimer: report.disclaimer,
          ...(growthReportReady && report.resultPayload ? { result: report.resultPayload } : {})
        }
      }
    })
  }

  async pdf(userId: string, reportId: string): Promise<Buffer> {
    const report = await this.store.transaction(async (tx) => {
      const report = await tx.findById('reports', reportId)
      invariant(report, 404, 'REPORT_NOT_FOUND', '报告不存在')
      invariant(report.userId === userId, 403, 'REPORT_FORBIDDEN', '无权访问该报告')
      await this.assertV05AssessmentConsents(tx, userId, report)
      const entitlement = await tx.findOne('entitlements', { userId, reportId, status: 'ACTIVE' })
      invariant(entitlement, 403, 'REPORT_PAYMENT_REQUIRED', '需要完成支付才能下载报告')
      const contentReady = report.reportKind === 'STUDENT_GROWTH_DISCOVERY'
        ? entitlement.productCode === 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1' && Boolean(report.resultPayload) &&
          Array.isArray(report.modules) && report.modules.length === 6
        : Array.isArray(report.modules) && report.modules.length > 0
      invariant(report.status === 'READY' && report.deliveryStatus === 'DELIVERED' && report.qaPassed && contentReady,
        409, 'REPORT_NOT_READY', '报告尚未交付完成')
      // 只记第一次：退款政策要判断的是"有没有下过"，重复写入既无意义，
      // 也会让"首次下载时间"这个事实随后续下载漂移。
      if (!report.pdfFirstDownloadedAt) {
        return tx.update('reports', report.id, { pdfFirstDownloadedAt: iso(this.clock) })
      }
      return report
    })
    return renderSimpleReportPdf(report)
  }

  async submitFeedback(
    userId: string,
    reportId: string,
    input: { rating: number; tags?: unknown; comment?: unknown; advisorContactRequested?: unknown }
  ): Promise<Pick<Feedback, 'id' | 'createdAt'>> {
    invariant(Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5, 400, 'FEEDBACK_RATING_INVALID', '评分必须为1至5')
    const tags = Array.isArray(input.tags) ? input.tags.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : []
    invariant(tags.length <= 10 && tags.every((tag) => tag.length <= 40), 400, 'FEEDBACK_TAGS_INVALID', '反馈标签无效')
    const comment = typeof input.comment === 'string' ? input.comment.trim() : ''
    invariant(comment.length <= 2000, 400, 'FEEDBACK_COMMENT_TOO_LONG', '反馈内容不能超过2000字符')
    const advisorContactRequested = input.advisorContactRequested === true
    const now = iso(this.clock)
    return this.store.transaction(async (tx) => {
      const report = await tx.findById('reports', reportId)
      invariant(report, 404, 'REPORT_NOT_FOUND', '报告不存在')
      invariant(report.userId === userId, 403, 'REPORT_FORBIDDEN', '无权反馈该报告')
      await this.assertV05AssessmentConsents(tx, userId, report)
      const entitlement = await tx.findOne('entitlements', { userId, reportId, status: 'ACTIVE' })
      invariant(entitlement && report.status === 'READY', 403, 'REPORT_PAYMENT_REQUIRED', '仅已解锁报告可以提交反馈')
      const feedback = await tx.insert('feedback', {
        id: this.ids('fbk'), userId, reportId,
        rating: input.rating as Feedback['rating'], tags, comment,
        advisorContactRequested, createdAt: now
      })
      return { id: feedback.id, createdAt: feedback.createdAt }
    })
  }

  private async assertV05AssessmentConsents(
    tx: StoreTransaction,
    userId: string,
    report: Report
  ): Promise<Assessment | null> {
    if (report.reportKind !== 'FAMILY_EDUCATION_SNAPSHOT' && report.reportKind !== 'STUDENT_GROWTH_DISCOVERY') return null
    const assessment = await tx.findById('assessments', report.assessmentId, { forUpdate: true })
    invariant(assessment?.userId === userId && assessment.reportId === report.id,
      409, 'REPORT_ASSESSMENT_MISMATCH', '报告关联的测评快照无效')
    const core = assessment.coreConsentGrantId
      ? await tx.findById('consentGrants', assessment.coreConsentGrantId, { forUpdate: true })
      : null
    invariant(core?.userId === userId && core.familyId === assessment.familyId &&
      core.studentId === assessment.studentId && core.subjectType === 'STUDENT' &&
      core.subjectId === assessment.studentId && core.scope === 'CORE_ASSESSMENT' &&
      core.subjectRole === 'PARENT_GUARDIAN' &&
      core.copyVersion === CORE_ASSESSMENT_CONSENT_VERSION &&
      core.copyTextHash === consentCopySha256(CORE_ASSESSMENT_CONSENT_COPY) &&
      core.locale === 'zh-CN' && core.guardianAuthorityStatus === 'CONFIRMED' && !core.withdrawnAt,
      403, 'CORE_ASSESSMENT_CONSENT_REQUIRED', '核心测评同意缺失或已撤回')
    if (report.reportKind !== 'STUDENT_GROWTH_DISCOVERY') return assessment
    const assent = assessment.studentAssentGrantId
      ? await tx.findById('consentGrants', assessment.studentAssentGrantId, { forUpdate: true })
      : null
    invariant(assent?.userId === userId && assent.familyId === assessment.familyId &&
      assent.studentId === assessment.studentId && assent.subjectType === 'STUDENT' &&
      assent.subjectId === assessment.studentId && assent.scope === 'STUDENT_ASSESSMENT_ASSENT' &&
      assent.copyVersion === STUDENT_ASSESSMENT_ASSENT_VERSION && assent.subjectRole === 'STUDENT' &&
      assent.copyTextHash === consentCopySha256(STUDENT_ASSESSMENT_ASSENT_COPY) &&
      assent.locale === 'zh-CN' && assent.guardianAuthorityStatus === 'NOT_APPLICABLE' && !assent.withdrawnAt,
      403, 'STUDENT_ASSESSMENT_ASSENT_REQUIRED', '学生本人同意缺失或已撤回')
    return assessment
  }
}
