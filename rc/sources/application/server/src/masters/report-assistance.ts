import type { MastersReport, MastersReportPayload } from '../domain/masters/contracts'
import { invariant } from '../domain/errors'

export type ReportLevel = 'RULE_DRAFT' | 'INITIAL_ASSESSMENT' | 'ADVISOR_VERIFIED_PLAN'
export interface ReportAssistance {
  level: ReportLevel
  label: string
  complete: boolean
  autoSchoolMatching: 'NOT_IMPLEMENTED'
  explanation: string
  limitations: string[]
}

function usableSourceUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname.includes('.') &&
      !/(^|\.)(localhost|invalid|test|example|local)$/.test(url.hostname) && !/^\d+(\.\d+){3}$/.test(url.hostname)
  } catch { return false }
}

/** This is a human attestation gate. It does not fetch or verify websites. */
export function assertReportSources(payload: MastersReportPayload, applicationSeason: string, now: string): void {
  for (const candidate of payload.candidatePrograms) {
    invariant(candidate.sourceStatus === 'VERIFIED' && candidate.verifiedAt <= now.slice(0, 10), 409, 'MASTERS_SOURCES_UNVERIFIED', '项目来源尚未由顾问核验；请先核验，或移出对外初评版本')
    invariant(/^\d{4}$/.test(applicationSeason) && candidate.intakeYear === applicationSeason, 409, 'MASTERS_SOURCE_SEASON_MISMATCH', '项目申请季与本次咨询不一致，请先核对入学年份')
    invariant(usableSourceUrl(candidate.officialUrl), 409, 'MASTERS_SOURCES_UNVERIFIED', '请提供顾问核验过的正式官网来源')
  }
}

/** Derived on the server; editors cannot promote a report by changing a label. */
export function reportAssistance(report: Pick<MastersReport, 'payload' | 'reviewedBy' | 'reviewedAt'>, applicationSeason?: string): ReportAssistance {
  const payload = report.payload
  const limitations: string[] = []
  if (!payload.candidatePrograms.length) limitations.push('尚无已核验候选项目，仅供背景初评与补件跟进')
  if (payload.candidatePrograms.some(candidate => candidate.sourceStatus !== 'VERIFIED' || candidate.verifiedAt > new Date().toISOString().slice(0, 10) || !usableSourceUrl(candidate.officialUrl))) limitations.push('仍有项目来源待核验')
  if (applicationSeason && payload.candidatePrograms.some(candidate => candidate.intakeYear !== applicationSeason)) limitations.push('项目申请季与咨询入学年份尚未一致')
  if (!payload.suggestedDirections.some(value => value.trim())) limitations.push('申请方向待顾问补充')
  if (!payload.preparationPlan.some(value => value.trim())) limitations.push('准备计划待顾问补充')
  if (!payload.nextStepsAndLimitations.some(value => value.trim())) limitations.push('下一步与风险说明待顾问补充')
  const reviewed = Boolean(report.reviewedBy && report.reviewedAt)
  const complete = reviewed && limitations.length === 0
  const level: ReportLevel = !reviewed ? 'RULE_DRAFT' : complete ? 'ADVISOR_VERIFIED_PLAN' : 'INITIAL_ASSESSMENT'
  return {
    level, complete, autoSchoolMatching: 'NOT_IMPLEMENTED', limitations,
    label: level === 'RULE_DRAFT' ? '待顾问核验草稿' : complete ? '顾问核验后的申请方案' : '初评／待补报告',
    explanation: '当前采用规则草稿与顾问逐项核验；自动选校尚未实现。项目匹配理由为顾问判断，不代表录取承诺。'
  }
}
