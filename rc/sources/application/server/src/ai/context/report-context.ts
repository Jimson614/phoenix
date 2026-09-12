import { Report, SourceReference } from '../../domain/model'
import { invariant } from '../../domain/errors'
import { AgentContentCrypto } from '../crypto'
import { AgentReportContext } from '../provider/agent-provider'
import { assertSafeAgentReportContext, redactContextText } from '../safety/local-safety'

const MAX_CONTEXT_TEXT_LENGTH = 20_000

export function sanitizeAgentSource(reference: SourceReference): SourceReference {
  invariant(reference.sourceId.startsWith('USER_INPUT:') || /^[A-Za-z0-9_.:/-]{1,120}$/.test(reference.sourceId),
    409, 'AGENT_CONTEXT_UNSAFE', '报告包含不可信来源标识')
  invariant(/^[A-Za-z0-9_.:/ -]{1,40}$/.test(reference.applicableYear), 409, 'AGENT_CONTEXT_UNSAFE', '报告来源适用年份无效')
  invariant(reference.verifiedAt.length <= 40 && Number.isFinite(Date.parse(reference.verifiedAt)) &&
    !/[\u0000-\u001f\u007f]/u.test(reference.verifiedAt), 409, 'AGENT_CONTEXT_UNSAFE', '报告来源验证时间无效')
  invariant(/^[A-Za-z0-9_.:/-]{1,120}$/.test(reference.dataVersion), 409, 'AGENT_CONTEXT_UNSAFE', '报告来源数据版本无效')
  return {
    sourceId: reference.sourceId.startsWith('USER_INPUT:') ? 'PHOENIX_REPORT_SNAPSHOT' : reference.sourceId,
    applicableYear: reference.applicableYear,
    verifiedAt: reference.verifiedAt,
    dataVersion: reference.dataVersion
  }
}

export function buildAgentReportContext(report: Report): {
  context: AgentReportContext
  sourceMap: Record<string, SourceReference>
} {
  invariant(report.status === 'READY' && report.deliveryStatus === 'DELIVERED' && report.qaPassed &&
    Array.isArray(report.modules) && report.modules.length > 0, 409, 'AGENT_REPORT_NOT_READY', '报告尚未完成交付')
  invariant(/^\d{4}-\d{2}-\d{2}$/.test(report.dataAsOf) && Number.isFinite(Date.parse(report.dataAsOf)),
    409, 'AGENT_CONTEXT_UNSAFE', '报告数据日期无效')
  const sourceMap: Record<string, SourceReference> = {}
  const sources = report.sources.slice(0, 20).map((source, index) => {
    const alias = `S${index + 1}`
    const sanitized = sanitizeAgentSource(source)
    sourceMap[alias] = sanitized
    return {
      alias,
      applicableYear: sanitized.applicableYear,
      verifiedAt: sanitized.verifiedAt,
      dataVersion: sanitized.dataVersion
    }
  })
  const context: AgentReportContext = {
    dataAsOf: report.dataAsOf,
    confidence: report.confidence,
    disclaimer: redactContextText(report.disclaimer).slice(0, 1000),
    modules: report.modules.map((module) => ({
      key: module.key,
      title: redactContextText(module.title).slice(0, 120),
      summary: redactContextText(module.summary).slice(0, 1600),
      items: (module.items ?? []).slice(0, 12).map((item) => redactContextText(item).slice(0, 500))
    })),
    sources
  }
  assertSafeAgentReportContext(context)
  invariant(JSON.stringify(context).length <= MAX_CONTEXT_TEXT_LENGTH, 409, 'AGENT_CONTEXT_TOO_LARGE', '报告上下文超过安全上限')
  return { context, sourceMap }
}

export function contextDigestForReport(report: Report, crypto: AgentContentCrypto): string {
  return crypto.keyedDigest('report-context', buildAgentReportContext(report).context)
}

export function publicSourceDto(alias: string, source: SourceReference): Record<string, string> {
  return {
    alias,
    name: source.sourceId === 'PHOENIX_ASSESSMENT_SNAPSHOT'
      ? '本次免费测评快照'
      : source.sourceId.startsWith('USER_INPUT:') || source.sourceId === 'PHOENIX_REPORT_SNAPSHOT'
        ? '本次已购报告快照'
        : source.sourceId,
    applicableYear: source.applicableYear,
    verifiedAt: source.verifiedAt,
    dataVersion: source.dataVersion
  }
}
