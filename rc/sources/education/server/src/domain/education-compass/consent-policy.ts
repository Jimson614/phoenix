import { createHash } from 'node:crypto'
import type { ConsentGrant } from '../model'

export const CORE_ASSESSMENT_CONSENT_VERSION = 'guardian_core_assessment_v1.0.0-rc1' as const
export const STUDENT_ASSESSMENT_ASSENT_VERSION = 'student_assent_growth_discovery_v1.0.0-rc1' as const
export const AI_ANALYSIS_CONSENT_VERSION = 'agent_analysis_opt_in_v1.0.0-rc1' as const
export const FEISHU_PROFILE_MIRROR_CONSENT_VERSION = 'feishu_profile_mirror_opt_in_v1.0.0-rc1' as const
export const ADVISOR_CONTACT_CONSENT_VERSION = 'advisor_contact_opt_in_v1.0.0-rc1' as const

export const CORE_ASSESSMENT_CONSENT_COPY =
  '我已了解本测评用于形成教育成长快照与下一步支持建议。我确认有权为该家庭／未成年学生管理必要资料，并同意系统按隐私说明保存版本化问卷与结果。我可以撤回非必要授权；撤回不会被解释为学生能力或意愿不足。'

export const STUDENT_ASSESSMENT_ASSENT_COPY =
  '这份测评需要由我本人作答。我知道可以暂停、退出或不回答选填成绩区间，也不会因此得到负面评价。我同意系统用本次回答生成成长快照；如果不愿继续，我可以现在退出。'

export const AI_ANALYSIS_CONSENT_COPY =
  '我同意将去标识化的结构化测评结果发送给受控 AI 服务作解释。AI 不会决定核心结果，也不得生成诊断、排名、录取概率或无来源事实。我可以不启用或之后撤回该功能。'

export const FEISHU_PROFILE_MIRROR_CONSENT_COPY =
  '我同意将下方列明的客户资料同步到凤启受控的飞书多维表格，用于运营与顾问跟进。问卷原始答案、学习过程全文、支付资料和证件资料不会同步；我可以申请撤回和停止后续同步。'

export const ADVISOR_CONTACT_CONSENT_COPY =
  '我同意授权的凤启顾问查看必要摘要并就我选择的教育支持联系我。顾问不能修改测评规则，也不能查看未授权的原始作答或学习过程全文。'

export function consentCopySha256(copy: string): string {
  return createHash('sha256').update(copy, 'utf8').digest('hex')
}

export const AI_ANALYSIS_CONSENT_COPY_SHA256 = consentCopySha256(AI_ANALYSIS_CONSENT_COPY)
export const FEISHU_PROFILE_MIRROR_CONSENT_COPY_SHA256 = consentCopySha256(FEISHU_PROFILE_MIRROR_CONSENT_COPY)

export interface AssessmentConsentSubject {
  userId: string
  familyId: string
  studentId: string
}

export function isExactActiveCoreAssessmentConsent(
  grant: ConsentGrant | null | undefined,
  subject: AssessmentConsentSubject
): grant is ConsentGrant {
  return Boolean(
    grant &&
    grant.userId === subject.userId &&
    grant.familyId === subject.familyId &&
    grant.studentId === subject.studentId &&
    grant.subjectType === 'STUDENT' &&
    grant.subjectId === subject.studentId &&
    grant.scope === 'CORE_ASSESSMENT' &&
    grant.subjectRole === 'PARENT_GUARDIAN' &&
    grant.copyVersion === CORE_ASSESSMENT_CONSENT_VERSION &&
    grant.copyTextHash === consentCopySha256(CORE_ASSESSMENT_CONSENT_COPY) &&
    grant.locale === 'zh-CN' &&
    grant.guardianAuthorityStatus === 'CONFIRMED' &&
    !grant.withdrawnAt
  )
}

export function isExactActiveStudentAssessmentAssent(
  grant: ConsentGrant | null | undefined,
  subject: AssessmentConsentSubject
): grant is ConsentGrant {
  return Boolean(
    grant &&
    grant.userId === subject.userId &&
    grant.familyId === subject.familyId &&
    grant.studentId === subject.studentId &&
    grant.subjectType === 'STUDENT' &&
    grant.subjectId === subject.studentId &&
    grant.scope === 'STUDENT_ASSESSMENT_ASSENT' &&
    grant.subjectRole === 'STUDENT' &&
    grant.copyVersion === STUDENT_ASSESSMENT_ASSENT_VERSION &&
    grant.copyTextHash === consentCopySha256(STUDENT_ASSESSMENT_ASSENT_COPY) &&
    grant.locale === 'zh-CN' &&
    grant.guardianAuthorityStatus === 'NOT_APPLICABLE' &&
    !grant.withdrawnAt
  )
}

export function isExactActiveAiAnalysisConsent(
  grant: ConsentGrant | null | undefined,
  userId: string,
  studentId: string
): grant is ConsentGrant {
  return Boolean(
    grant &&
    grant.userId === userId &&
    grant.studentId === studentId &&
    grant.subjectType === 'STUDENT' &&
    grant.subjectId === studentId &&
    grant.scope === 'AI_ANALYSIS' &&
    grant.subjectRole === 'STUDENT' &&
    grant.copyVersion === AI_ANALYSIS_CONSENT_VERSION &&
    grant.copyTextHash === AI_ANALYSIS_CONSENT_COPY_SHA256 &&
    grant.locale === 'zh-CN' &&
    grant.guardianAuthorityStatus === 'CONFIRMED' &&
    !grant.withdrawnAt
  )
}

export function isExactActiveFeishuProfileConsent(
  grant: ConsentGrant | null | undefined,
  familyId: string,
  studentId: string
): grant is ConsentGrant {
  return Boolean(
    grant &&
    grant.familyId === familyId &&
    grant.studentId === studentId &&
    grant.subjectType === 'STUDENT' &&
    grant.subjectId === studentId &&
    grant.scope === 'FEISHU_PROFILE_MIRROR' &&
    grant.subjectRole === 'PARENT_GUARDIAN' &&
    grant.copyVersion === FEISHU_PROFILE_MIRROR_CONSENT_VERSION &&
    grant.copyTextHash === FEISHU_PROFILE_MIRROR_CONSENT_COPY_SHA256 &&
    grant.locale === 'zh-CN' &&
    grant.guardianAuthorityStatus === 'CONFIRMED' &&
    !grant.withdrawnAt
  )
}
