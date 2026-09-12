import {
  AgentModerationResult,
  AgentProvider,
  AgentProviderError,
  AgentProviderInput,
  AgentProviderResult
} from './agent-provider'

export class MockAgentProvider implements AgentProvider {
  readonly name = 'mock' as const
  readonly model = 'phoenix-deterministic-agent-mock-v1'
  calls = { moderation: 0, generation: 0 }

  async moderate(input: string, _signal?: AbortSignal): Promise<AgentModerationResult> {
    this.calls.moderation += 1
    const blocked = input.includes('[MOCK_MODERATION_BLOCK]')
    return {
      allowed: !blocked,
      categories: blocked ? ['mock_blocked'] : [],
      requiresGuardianAttention: blocked
    }
  }

  async createReportFollowup(input: AgentProviderInput, _signal?: AbortSignal): Promise<AgentProviderResult> {
    this.calls.generation += 1
    if (input.message.includes('[MOCK_TIMEOUT]')) throw new AgentProviderError('OPENAI_TIMEOUT', true)
    if (input.message.includes('[MOCK_REFUSAL]')) throw new AgentProviderError('OPENAI_REFUSAL', false)
    const aliases = input.report.sources.slice(0, 2).map((source) => source.alias)
    const focus = input.report.modules[0]?.items[0] ?? input.report.modules[0]?.summary ?? '当前快照中的已验证信息'
    const isFree = input.taskType === 'ASSESSMENT_ANALYSIS'
    const isPaidAnalysis = input.taskType === 'REPORT_ANALYSIS'
    return {
      model: this.model,
      inputTokens: 0,
      outputTokens: 0,
      draft: {
        answer: isFree
          ? `根据本次免费测评，可以先围绕“${focus.slice(0, 80)}”观察当前线索。`
          : isPaidAnalysis
            ? `根据已购完整报告，整体分析可先围绕“${focus.slice(0, 80)}”梳理重点。`
            : `根据已购报告，可以先围绕“${focus.slice(0, 80)}”理解本次结论。`,
        keyPoints: [isFree ? '结果仅来自本次免费测评的脱敏快照。' : '结论仅来自当前已购报告快照。'],
        nextSteps: ['与孩子一起选择一个可在两周内验证的小行动。'],
        limitations: [isFree ? '免费 AI 分析不包含完整付费六模块报告，也不代表录取结果或专业诊断。' : '这是 AI 辅助解读，不代表录取结果或专业诊断。'],
        sourceAliases: aliases,
        safety: { level: 'STANDARD', requiresGuardianAttention: false }
      }
    }
  }
}
