import { createHmac } from 'node:crypto'
import OpenAI from 'openai'
import type { ModerationCreateParams, ModerationCreateResponse } from 'openai/resources/moderations'
import type { Response, ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses'
import { invariant } from '../../domain/errors'
import {
  FREE_ASSESSMENT_ANALYSIS_INSTRUCTIONS,
  PAID_REPORT_ANALYSIS_INSTRUCTIONS,
  REPORT_FOLLOWUP_INSTRUCTIONS,
  serializeReportFollowupInput
} from '../prompt/report-followup-v1'
import { validateAgentReplyDraft } from '../safety/local-safety'
import {
  AgentModerationResult,
  AgentProvider,
  AgentProviderError,
  AgentProviderInput,
  AgentProviderResult
} from './agent-provider'

const OFFICIAL_OPENAI_ORIGIN = 'https://api.openai.com/v1'
const MAX_RETRY_DELAY_MS = 2_000

export interface OpenAIClientPort {
  responses: {
    create(params: ResponseCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<Response>
  }
  moderations: {
    create(params: ModerationCreateParams, options?: { signal?: AbortSignal }): Promise<ModerationCreateResponse>
  }
}

export interface OpenAIResponsesProviderOptions {
  apiKey: string
  model: string
  moderationModel: string
  timeoutMs: number
  maxOutputTokens: number
  client?: OpenAIClientPort
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
}

function responseSchema(aliases: readonly string[]): Record<string, unknown> {
  const aliasEnum = aliases.length > 0 ? [...aliases] : ['__NO_SOURCE_AVAILABLE__']
  return {
    type: 'object',
    additionalProperties: false,
    required: ['answer', 'keyPoints', 'nextSteps', 'limitations', 'sourceAliases', 'safety'],
    properties: {
      answer: { type: 'string', minLength: 1, maxLength: 4000 },
      keyPoints: { type: 'array', minItems: 0, maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 500 } },
      nextSteps: { type: 'array', minItems: 0, maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 500 } },
      limitations: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 500 } },
      sourceAliases: {
        type: 'array', minItems: 0, maxItems: Math.min(20, aliases.length),
        items: { type: 'string', enum: aliasEnum }
      },
      safety: {
        type: 'object', additionalProperties: false,
        required: ['level', 'requiresGuardianAttention'],
        properties: {
          level: { type: 'string', enum: ['STANDARD'] },
          requiresGuardianAttention: { type: 'boolean' }
        }
      }
    }
  }
}

function parseRetryAfter(headers: unknown): number | undefined {
  const getter = (headers as { get?: (name: string) => string | null } | undefined)?.get
  const raw = typeof getter === 'function' ? getter.call(headers, 'retry-after') : null
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_DELAY_MS, Math.ceil(seconds * 1000))
  const at = Date.parse(raw)
  if (!Number.isNaN(at)) return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, at - Date.now()))
  return undefined
}

function providerError(error: unknown): AgentProviderError {
  if (error instanceof AgentProviderError) return error
  const candidate = error as { status?: number; name?: string; headers?: unknown }
  const retryAfterMs = parseRetryAfter(candidate.headers)
  if (candidate.name === 'APIConnectionTimeoutError' || candidate.name === 'AbortError') {
    return new AgentProviderError('OPENAI_TIMEOUT', true, retryAfterMs)
  }
  if (candidate.name === 'APIConnectionError' || error instanceof TypeError) {
    return new AgentProviderError('OPENAI_CONNECTION_ERROR', true, retryAfterMs)
  }
  if (candidate.status === 429) return new AgentProviderError('OPENAI_RATE_LIMITED', true, retryAfterMs)
  if (candidate.status !== undefined && candidate.status >= 500) return new AgentProviderError('OPENAI_UPSTREAM_ERROR', true, retryAfterMs)
  if (candidate.status === 401 || candidate.status === 403) return new AgentProviderError('OPENAI_AUTH_ERROR', false)
  if (candidate.status !== undefined && candidate.status >= 400) return new AgentProviderError('OPENAI_REQUEST_REJECTED', false)
  return new AgentProviderError('OPENAI_UNKNOWN_ERROR', false)
}

export function createOpenAISafetyIdentifier(userId: string, hmacKey: string): string {
  invariant(Buffer.byteLength(hmacKey, 'utf8') >= 32, 500, 'OPENAI_SAFETY_KEY_INVALID', 'OpenAI safety HMAC Key 至少需要32字节')
  const digest = createHmac('sha256', hmacKey)
    .update('phoenix:openai-safety-id:v1\0', 'utf8')
    .update(userId, 'utf8')
    .digest('base64url')
  return `phx_v1_${digest}`.slice(0, 64)
}

export class OpenAIResponsesProvider implements AgentProvider {
  readonly name = 'openai' as const
  readonly model: string
  private readonly client: OpenAIClientPort
  private readonly moderationModel: string
  private readonly maxOutputTokens: number
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly random: () => number

  constructor(options: OpenAIResponsesProviderOptions) {
    invariant(options.apiKey.trim().length > 0, 500, 'OPENAI_API_KEY_REQUIRED', 'OPENAI_API_KEY 未配置')
    invariant(options.model.trim().length > 0, 500, 'OPENAI_MODEL_REQUIRED', 'OPENAI_MODEL 未配置')
    invariant(options.moderationModel.trim().length > 0, 500, 'OPENAI_MODERATION_MODEL_REQUIRED', 'OPENAI_MODERATION_MODEL 未配置')
    invariant(Number.isInteger(options.timeoutMs) && options.timeoutMs >= 1000 && options.timeoutMs <= 120_000, 500, 'OPENAI_TIMEOUT_INVALID', 'OpenAI timeout 无效')
    invariant(Number.isInteger(options.maxOutputTokens) && options.maxOutputTokens >= 128 && options.maxOutputTokens <= 4000, 500, 'OPENAI_OUTPUT_LIMIT_INVALID', 'OpenAI 输出 token 上限无效')
    this.model = options.model
    this.moderationModel = options.moderationModel
    this.maxOutputTokens = options.maxOutputTokens
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.random = options.random ?? Math.random
    if (options.client) {
      this.client = options.client
    } else {
      const sdk = new OpenAI({
        apiKey: options.apiKey,
        baseURL: OFFICIAL_OPENAI_ORIGIN,
        timeout: options.timeoutMs,
        maxRetries: 0
      })
      this.client = {
        responses: { create: (params, requestOptions) => sdk.responses.create(params, requestOptions) },
        moderations: { create: (params, requestOptions) => sdk.moderations.create(params, requestOptions) }
      }
    }
  }

  async moderate(input: string, signal?: AbortSignal): Promise<AgentModerationResult> {
    invariant(input.trim().length > 0, 500, 'OPENAI_MODERATION_INPUT_INVALID', 'moderation 输入为空')
    const response = await this.executeWithRetry(() => this.client.moderations.create({
      model: this.moderationModel,
      input
    }, signal ? { signal } : undefined))
    const result = response.results[0]
    if (!result) throw new AgentProviderError('OPENAI_MODERATION_EMPTY', false)
    const categories = Object.entries(result.categories)
      .filter(([, flagged]) => flagged === true)
      .map(([category]) => category)
    return {
      allowed: !result.flagged,
      categories,
      requiresGuardianAttention: categories.some((category) => /self-harm|sexual\/minors|violence/.test(category))
    }
  }

  async createReportFollowup(input: AgentProviderInput, signal?: AbortSignal): Promise<AgentProviderResult> {
    invariant(/^phx_v1_[A-Za-z0-9_-]+$/.test(input.safetyIdentifier) && input.safetyIdentifier.length <= 64, 500, 'OPENAI_SAFETY_ID_INVALID', 'OpenAI safety identifier 无效')
    const aliases = input.report.sources.map((source) => source.alias)
    const instructions = input.taskType === 'ASSESSMENT_ANALYSIS'
      ? FREE_ASSESSMENT_ANALYSIS_INSTRUCTIONS
      : input.taskType === 'REPORT_ANALYSIS'
        ? PAID_REPORT_ANALYSIS_INSTRUCTIONS
        : REPORT_FOLLOWUP_INSTRUCTIONS
    const responseFormatName = input.taskType === 'ASSESSMENT_ANALYSIS'
      ? 'phoenix_assessment_analysis_v1'
      : input.taskType === 'REPORT_ANALYSIS'
        ? 'phoenix_report_analysis_v1'
        : 'phoenix_report_followup_v1'
    const response = await this.executeWithRetry(() => this.client.responses.create({
      model: this.model,
      instructions,
      input: serializeReportFollowupInput(input),
      store: false,
      stream: false,
      max_output_tokens: this.maxOutputTokens,
      safety_identifier: input.safetyIdentifier,
      tools: [],
      tool_choice: 'none',
      parallel_tool_calls: false,
      text: {
        format: {
          type: 'json_schema',
          name: responseFormatName,
          strict: true,
          schema: responseSchema(aliases)
        }
      }
    }, signal ? { signal } : undefined))

    if (response.status === 'incomplete') throw new AgentProviderError('OPENAI_INCOMPLETE', false)
    if (response.status === 'failed' || response.error) throw new AgentProviderError('OPENAI_RESPONSE_FAILED', false)
    if (response.status !== 'completed') throw new AgentProviderError('OPENAI_STATUS_UNKNOWN', false)
    const refusal = response.output.some((item) => item.type === 'message' && item.content.some((part) => part.type === 'refusal'))
    if (refusal) throw new AgentProviderError('OPENAI_REFUSAL', false)
    if (!response.output_text.trim()) throw new AgentProviderError('OPENAI_OUTPUT_EMPTY', false)

    let parsed: unknown
    try {
      parsed = JSON.parse(response.output_text)
    } catch {
      throw new AgentProviderError('OPENAI_OUTPUT_JSON_INVALID', false)
    }
    const draft = validateAgentReplyDraft(parsed, aliases)
    const outputModeration = await this.moderate([
      draft.answer, ...draft.keyPoints, ...draft.nextSteps, ...draft.limitations
    ].join('\n'), signal)
    if (!outputModeration.allowed) throw new AgentProviderError('OPENAI_OUTPUT_MODERATION_BLOCKED', false)
    return {
      draft,
      model: response.model,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0
    }
  }

  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        const mapped = providerError(error)
        if (!mapped.retryable || attempt === 1) throw mapped
        const base = mapped.retryAfterMs ?? 250 * (2 ** attempt)
        const jitter = Math.floor(this.random() * 100)
        await this.sleep(Math.min(MAX_RETRY_DELAY_MS, base + jitter))
      }
    }
    throw new AgentProviderError('OPENAI_UNKNOWN_ERROR', false)
  }
}
