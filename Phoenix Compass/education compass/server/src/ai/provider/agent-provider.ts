import { SourceReference } from '../../domain/model'

export const AGENT_PROMPT_VERSION = 'report-followup-v1'

export type AgentSafetyLevel = 'STANDARD'

export interface AgentReplyDraft {
  answer: string
  keyPoints: string[]
  nextSteps: string[]
  limitations: string[]
  sourceAliases: string[]
  safety: {
    level: AgentSafetyLevel
    requiresGuardianAttention: boolean
  }
}

export interface AgentSourceAlias {
  alias: string
  applicableYear: string
  verifiedAt: string
  dataVersion: string
}

export interface AgentReportModuleContext {
  key: string
  title: string
  summary: string
  items: string[]
}

export interface AgentReportContext {
  dataAsOf: string
  confidence: 'low' | 'medium' | 'high'
  disclaimer: string
  modules: AgentReportModuleContext[]
  sources: AgentSourceAlias[]
}

export interface AgentConversationTurn {
  role: 'USER' | 'ASSISTANT'
  content: string
}

export interface AgentProviderInput {
  taskType?: 'REPORT_FOLLOWUP' | 'ASSESSMENT_ANALYSIS' | 'REPORT_ANALYSIS'
  safetyIdentifier: string
  report: AgentReportContext
  history: AgentConversationTurn[]
  message: string
}

export interface FrozenAgentRequest extends AgentProviderInput {
  schemaVersion: 'phoenix-agent-request-v1'
  promptVersion: string
  sourceMap: Record<string, SourceReference>
}

export interface AgentModerationResult {
  allowed: boolean
  categories: string[]
  requiresGuardianAttention: boolean
}

export interface AgentProviderResult {
  draft: AgentReplyDraft
  model: string
  inputTokens: number
  outputTokens: number
}

export interface AgentProvider {
  readonly name: 'mock' | 'openai' | 'deepseek'
  readonly model: string
  moderate(input: string, signal?: AbortSignal): Promise<AgentModerationResult>
  createReportFollowup(input: AgentProviderInput, signal?: AbortSignal): Promise<AgentProviderResult>
}

export class AgentProviderError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(code: string, retryable: boolean, retryAfterMs?: number) {
    super(code)
    this.name = 'AgentProviderError'
    this.code = code
    this.retryable = retryable
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs
  }
}
