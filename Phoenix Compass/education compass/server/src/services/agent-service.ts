import { AgentContentCrypto, agentMessageAad, agentReportVersion, agentRunRequestAad } from '../ai/crypto'
import {
  agentAssessmentVersion,
  buildAssessmentAnalysisContext,
  buildPaidReportAnalysisContext,
  contextDigestForAssessment,
  contextDigestForPaidReportAnalysis
} from '../ai/context/assessment-context'
import { publicSourceDto } from '../ai/context/report-context'
import {
  AGENT_PROMPT_VERSION,
  AgentConversationTurn,
  AgentProvider,
  AgentProviderError,
  AgentReplyDraft,
  FrozenAgentRequest
} from '../ai/provider/agent-provider'
import { createOpenAISafetyIdentifier } from '../ai/provider/openai-responses-provider'
import {
  FREE_ASSESSMENT_PROMPT_VERSION,
  PAID_REPORT_ANALYSIS_PROMPT_VERSION
} from '../ai/prompt/report-followup-v1'
import {
  inspectLocalInput,
  LocalSafetyDecision,
  redactContextText,
  stableBlockedReply,
  validateAgentReplyDraft
} from '../ai/safety/local-safety'
import { AppError, invariant } from '../domain/errors'
import {
  AI_ANALYSIS_CONSENT_COPY,
  AI_ANALYSIS_CONSENT_COPY_SHA256,
  AI_ANALYSIS_CONSENT_VERSION,
  consentCopySha256,
  CORE_ASSESSMENT_CONSENT_COPY,
  CORE_ASSESSMENT_CONSENT_VERSION,
  isExactActiveAiAnalysisConsent,
  STUDENT_ASSESSMENT_ASSENT_COPY,
  STUDENT_ASSESSMENT_ASSENT_VERSION
} from '../domain/education-compass/consent-policy'
import {
  AgentConversation,
  AgentConversationPurpose,
  AgentMessage,
  AgentRun,
  Assessment,
  Report,
  SourceReference
} from '../domain/model'
import { InMemoryRateLimiter, RateLimiter } from '../http/rate-limiter'
import { AgentRepository, fenceAgentStudentAccess } from '../store/agent-repository'
import { Store, StoreTransaction } from '../store/store'
import { Clock, IdFactory, iso, randomId, systemClock } from '../utils/runtime'
import { AgentExecutionError, AgentRunExecutionInput, AgentRunExecutionResult } from '../worker/agent-worker'

const LEGACY_CONSENT_SCOPE = 'ai_education_agent' as const
const LEGACY_CONSENT_VERSION = 'ai_agent_guardian_v1' as const
const TERMS_VERSION = 'ai-agent-guardian-terms-v1'
const REPORT_TERMS_SUMMARY = '监护人同意使用已购报告的必要脱敏字段进行有限 AI 解读，并可随时撤回和删除对话。'
const ASSESSMENT_TERMS_SUMMARY = '监护人同意使用本次免费测评中必要的结构化、脱敏字段进行一次有限 AI 分析；不发送自由文本或客户身份资料，并可删除结果。'

export interface AgentServiceConfig {
  enabled: boolean
  safetyHmacKey: string
  maxMessageCharacters: number
  maxRepliesPerReport: number
  maxActiveRunsPerUser: number
  messagesPerMinute: number
  retentionDays: number
}

export interface CreateAgentConversationRequest {
  consentVersion: typeof LEGACY_CONSENT_VERSION | typeof AI_ANALYSIS_CONSENT_VERSION
  scope: typeof LEGACY_CONSENT_SCOPE | 'AI_ANALYSIS'
  guardianConfirmed: true
  studentConfirmed?: true
  locale?: 'zh-CN'
}

export interface AgentReplyDto extends Omit<AgentReplyDraft, 'sourceAliases'> {
  sources: Array<Record<string, string>>
}

export interface AgentRunDto {
  runId: string
  conversationId: string
  status: AgentRun['status']
  analysisType?: Extract<AgentConversationPurpose, 'ASSESSMENT_ANALYSIS' | 'REPORT_ANALYSIS'>
  remainingReplies: number
  retryAfterMs?: number
  reply?: AgentReplyDto
  error?: { code: string; message: string }
}

interface Eligibility {
  conversation: AgentConversation
  report: Report
  assessment?: Assessment
}

interface AnalysisContext {
  context: FrozenAgentRequest['report']
  sourceMap: Record<string, SourceReference>
}

function idempotencyKey(value: unknown): string {
  invariant(typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value), 400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 格式无效')
  return value
}

function isSignedAiConsentRequest(request: CreateAgentConversationRequest): boolean {
  return request?.consentVersion === AI_ANALYSIS_CONSENT_VERSION &&
    request.scope === 'AI_ANALYSIS' && request.locale === 'zh-CN' &&
    request.studentConfirmed === true && request.guardianConfirmed === true
}

function assertAgentConsent(request: CreateAgentConversationRequest, signedRequired = false): void {
  const legacy = request?.consentVersion === LEGACY_CONSENT_VERSION &&
    request.scope === LEGACY_CONSENT_SCOPE && request.guardianConfirmed === true &&
    request.studentConfirmed === undefined && request.locale === undefined
  const signed = isSignedAiConsentRequest(request)
  invariant((signedRequired ? signed : legacy || signed), 400, 'AGENT_CONSENT_INVALID',
    signedRequired ? 'V0.5 AI 分析必须由学生本人和监护人确认当前冻结版本授权' : 'AI 专项同意无效')
}

function consentTerms(request: CreateAgentConversationRequest, fallbackSummary: string): {
  termsVersion: string
  termsSummary: string
} {
  return isSignedAiConsentRequest(request)
    ? { termsVersion: AI_ANALYSIS_CONSENT_VERSION, termsSummary: AI_ANALYSIS_CONSENT_COPY }
    : { termsVersion: TERMS_VERSION, termsSummary: fallbackSummary }
}

function analysisType(purpose: AgentConversationPurpose): AgentRunDto['analysisType'] {
  return purpose === 'ASSESSMENT_ANALYSIS' || purpose === 'REPORT_ANALYSIS' ? purpose : undefined
}

function blockedDecision(code: string | null): LocalSafetyDecision {
  if (code === 'CRISIS_CONTENT' || code === 'OPENAI_INPUT_MODERATION_GUARDIAN_ATTENTION') {
    return {
      action: 'BLOCK', normalized: '', code: 'CRISIS_CONTENT', category: 'crisis',
      safeMessage: '如果孩子或任何人正面临立即危险，请立刻联系身边可信成年人和当地紧急服务。此功能不能处理危机情况，请尽快寻求合资格专业人员协助。',
      requiresGuardianAttention: true
    }
  }
  if (code === 'PII_DETECTED') {
    return {
      action: 'BLOCK', normalized: '', code: 'PII_DETECTED', category: 'pii',
      safeMessage: '为保护孩子与家庭隐私，请移除姓名、电话、邮箱、学校、证件或详细地址后重新提问。',
      requiresGuardianAttention: false
    }
  }
  if (code === 'PROFESSIONAL_BOUNDARY') {
    return {
      action: 'BLOCK', normalized: '', code: 'PROFESSIONAL_BOUNDARY', category: 'professional_boundary',
      safeMessage: 'AI 解读不能提供诊断、法律或财务结论，也不能保证录取结果。请改为询问报告中已呈现的方向、依据或下一步行动。',
      requiresGuardianAttention: false
    }
  }
  if (code === 'OPENAI_INPUT_MODERATION_BLOCKED') {
    return {
      action: 'BLOCK', normalized: '', code: 'PROMPT_INJECTION', category: 'moderation',
      safeMessage: '该内容无法由 AI 解读继续处理。请删除敏感或不适宜内容后，改为询问已购报告中的结论、依据或行动建议。',
      requiresGuardianAttention: false
    }
  }
  return {
    action: 'BLOCK', normalized: '', code: 'PROMPT_INJECTION', category: 'out_of_scope',
    safeMessage: '该请求超出报告解读范围。你可以继续询问报告中的结论、来源、限制或行动建议。',
    requiresGuardianAttention: false
  }
}

function publicError(run: AgentRun): { code: string; message: string } {
  if (run.status === 'BLOCKED') {
    const reply = stableBlockedReply(blockedDecision(run.errorCode))
    return { code: run.errorCode ?? 'AGENT_INPUT_BLOCKED', message: reply.answer }
  }
  if (run.status === 'CANCELLED') return { code: 'AGENT_ACCESS_REVOKED', message: '当前报告权益、同意或会话状态已变化，本次解读已取消。' }
  return { code: 'AGENT_TEMPORARILY_UNAVAILABLE', message: 'AI 解读暂时不可用，请稍后再试。' }
}

export class AgentService {
  private readonly rateLimiter: RateLimiter

  constructor(
    private readonly store: Store,
    private readonly repository: AgentRepository,
    private readonly crypto: AgentContentCrypto,
    private readonly provider: AgentProvider,
    private readonly config: AgentServiceConfig,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdFactory = randomId,
    rateLimiter?: RateLimiter
  ) {
    this.rateLimiter = rateLimiter ?? new InMemoryRateLimiter(() => this.clock().getTime())
  }

  async createConversation(
    userId: string,
    reportId: string,
    request: CreateAgentConversationRequest,
    rawIdempotencyKey: string
  ): Promise<Record<string, unknown>> {
    this.requireEnabled()
    assertAgentConsent(request)
    const source = await this.requirePaidReportSource(userId, reportId, false)
    await this.ensureV05AiConsent(userId, source.assessment, request)
    const key = idempotencyKey(rawIdempotencyKey)
    const expiresAt = new Date(this.clock().getTime() + this.config.retentionDays * 24 * 60 * 60 * 1000).toISOString()
    const terms = consentTerms(request, REPORT_TERMS_SUMMARY)
    const result = await this.repository.createOrReuseConversation({
      userId,
      reportId,
      purpose: 'REPORT_FOLLOWUP',
      creationKeyDigest: this.crypto.keyedDigest('conversation-idempotency', { userId, reportId, purpose: 'REPORT_FOLLOWUP', key }),
      creationInputDigest: this.crypto.keyedDigest('conversation-input', { userId, reportId, purpose: 'REPORT_FOLLOWUP', request }),
      promptVersion: AGENT_PROMPT_VERSION,
      expiresAt,
      termsVersion: terms.termsVersion,
      termsSummary: terms.termsSummary,
      termsDigest: this.crypto.keyedDigest('consent-terms', terms),
      guardianConfirmed: true
    })
    const remainingReplies = await this.repository.remainingReplies(userId, reportId, this.config.maxRepliesPerReport)
    return {
      conversationId: result.conversation.id,
      purpose: result.conversation.purpose,
      status: result.conversation.status,
      expiresAt: result.conversation.expiresAt,
      created: result.created,
      limits: {
        maxMessageChars: this.config.maxMessageCharacters,
        maxRepliesPerReport: this.config.maxRepliesPerReport,
        remainingReplies
      }
    }
  }

  async createAssessmentAnalysis(
    userId: string,
    assessmentId: string,
    request: CreateAgentConversationRequest,
    rawIdempotencyKey: string
  ): Promise<AgentRunDto> {
    this.requireEnabled()
    assertAgentConsent(request)
    const source = await this.requireAssessmentSource(userId, assessmentId, false)
    await this.ensureV05AiConsent(userId, source.assessment, request)
    return this.createOneShotAnalysis(userId, source.assessment, source.report, 'ASSESSMENT_ANALYSIS', request, rawIdempotencyKey)
  }

  async createReportAnalysis(
    userId: string,
    reportId: string,
    request: CreateAgentConversationRequest,
    rawIdempotencyKey: string
  ): Promise<AgentRunDto> {
    this.requireEnabled()
    assertAgentConsent(request)
    const source = await this.requirePaidReportSource(userId, reportId, false)
    await this.ensureV05AiConsent(userId, source.assessment, request)
    return this.createOneShotAnalysis(userId, source.assessment, source.report, 'REPORT_ANALYSIS', request, rawIdempotencyKey)
  }

  async sendMessage(userId: string, conversationId: string, rawMessage: unknown, rawIdempotencyKey: string): Promise<AgentRunDto> {
    this.requireEnabled()
    invariant(await this.rateLimiter.consume(`agent:${userId}`, this.config.messagesPerMinute, 60_000), 429, 'AGENT_RATE_LIMITED', 'AI 解读请求过于频繁，请稍后再试')
    const key = idempotencyKey(rawIdempotencyKey)
    const eligibility = await this.requireContentAccess(userId, conversationId)
    invariant(eligibility.conversation.purpose === 'REPORT_FOLLOWUP', 409,
      'AGENT_ANALYSIS_IS_ONE_SHOT', '免费测评分析和已购报告总分析不接受追加消息')
    const decision = inspectLocalInput(rawMessage, this.config.maxMessageCharacters)
    const runId = this.ids('arun')
    const userMessageId = this.ids('amsg')
    const messageForDigest = decision.action === 'ALLOW' ? decision.normalized : String(rawMessage)
    const common = {
      runId,
      userMessageId,
      userId,
      conversationId,
      idempotencyKeyDigest: this.crypto.keyedDigest('message-idempotency', { userId, conversationId, key }),
      inputDigest: this.crypto.keyedDigest('message-input', { conversationId, message: messageForDigest }),
      reportVersion: agentReportVersion(eligibility.report),
      contextDigest: contextDigestForPaidReportAnalysis(eligibility.assessment!, eligibility.report, this.crypto),
      provider: this.provider.name,
      model: this.provider.model,
      promptVersion: eligibility.conversation.promptVersion,
      maxRepliesPerReport: this.config.maxRepliesPerReport,
      maxActiveRunsPerUser: this.config.maxActiveRunsPerUser
    } as const

    if (decision.action === 'BLOCK') {
      const result = await this.repository.enqueueRun({
        ...common,
        contentEnvelope: null,
        requestEnvelope: null,
        disposition: 'BLOCK',
        blockedSafetyState: decision.requiresGuardianAttention ? 'ESCALATE' : 'BLOCKED',
        blockedErrorCode: decision.code ?? 'AGENT_INPUT_BLOCKED'
      })
      return {
        runId: result.run.id,
        conversationId,
        status: 'BLOCKED',
        remainingReplies: result.remainingReplies,
        reply: this.replyDto(stableBlockedReply(decision), {})
      }
    }

    const history = await this.recentHistory(eligibility.conversation)
    invariant(eligibility.assessment, 409, 'AGENT_CONTEXT_CHANGED', '报告关联的测评快照无效')
    const built = buildPaidReportAnalysisContext(eligibility.assessment, eligibility.report)
    const frozen: FrozenAgentRequest = {
      schemaVersion: 'phoenix-agent-request-v1',
      promptVersion: AGENT_PROMPT_VERSION,
      taskType: 'REPORT_FOLLOWUP',
      safetyIdentifier: createOpenAISafetyIdentifier(userId, this.config.safetyHmacKey),
      report: built.context,
      sourceMap: built.sourceMap,
      history,
      message: decision.normalized
    }
    const result = await this.repository.enqueueRun({
      ...common,
      contentEnvelope: this.crypto.encryptJson(decision.normalized, agentMessageAad({
        messageId: userMessageId, conversationId, role: 'USER', contentVersion: eligibility.conversation.promptVersion
      })),
      requestEnvelope: this.crypto.encryptJson(frozen, agentRunRequestAad({
        runId, conversationId, promptVersion: eligibility.conversation.promptVersion
      })),
      disposition: 'QUEUE'
    })
    return {
      runId: result.run.id,
      conversationId,
      status: result.run.status,
      remainingReplies: result.remainingReplies,
      retryAfterMs: 1000
    }
  }

  async getRun(userId: string, runId: string): Promise<AgentRunDto> {
    const run = await this.repository.getRun(runId)
    invariant(run, 404, 'AGENT_RUN_NOT_FOUND', 'Agent 任务不存在')
    invariant(run.userId === userId, 403, 'AGENT_RUN_FORBIDDEN', '无权访问该 Agent 任务')
    const eligibility = await this.requireContentAccess(userId, run.conversationId)
    const type = analysisType(eligibility.conversation.purpose)
    const remainingReplies = type ? 0 : await this.repository.remainingReplies(userId, run.reportId, this.config.maxRepliesPerReport)
    const analysis = type ? { analysisType: type } : {}
    if (run.status === 'QUEUED' || run.status === 'RUNNING') {
      return { runId: run.id, conversationId: run.conversationId, status: run.status, remainingReplies, ...analysis, retryAfterMs: 1000 }
    }
    if (run.status === 'SUCCEEDED') {
      invariant(run.assistantMessageId, 500, 'AGENT_REPLY_MISSING', 'Agent 回复不存在')
      const messages = await this.repository.listMessages(run.conversationId, undefined, 100)
      const message = messages.find((item) => item.id === run.assistantMessageId)
      invariant(message?.contentEnvelope, 410, 'AGENT_REPLY_PURGED', 'Agent 回复已按保留策略清除')
      const reply = this.crypto.decryptJson<AgentReplyDto>(message.contentEnvelope, agentMessageAad({
        messageId: message.id, conversationId: message.conversationId,
        role: 'ASSISTANT', contentVersion: eligibility.conversation.promptVersion
      }))
      return { runId: run.id, conversationId: run.conversationId, status: run.status, remainingReplies, ...analysis, reply }
    }
    if (run.status === 'BLOCKED') {
      return {
        runId: run.id,
        conversationId: run.conversationId,
        status: run.status,
        remainingReplies,
        ...analysis,
        reply: this.replyDto(stableBlockedReply(blockedDecision(run.errorCode)), {}),
        error: publicError(run)
      }
    }
    return { runId: run.id, conversationId: run.conversationId, status: run.status, remainingReplies, ...analysis, error: publicError(run) }
  }

  async getLatestAssessmentAnalysis(userId: string, assessmentId: string): Promise<Record<string, unknown>> {
    const source = await this.requireAssessmentSource(userId, assessmentId, false)
    if (!(await this.hasActiveAiConsent(userId, source.assessment))) return { analysis: null }
    return this.latestAnalysis(userId, source.report.id, 'ASSESSMENT_ANALYSIS')
  }

  async getLatestReportAnalysis(userId: string, reportId: string): Promise<Record<string, unknown>> {
    const source = await this.requirePaidReportSource(userId, reportId, false)
    if (!(await this.hasActiveAiConsent(userId, source.assessment))) return { analysis: null }
    return this.latestAnalysis(userId, reportId, 'REPORT_ANALYSIS')
  }

  async listMessages(userId: string, conversationId: string, cursor?: string, limit = 20): Promise<Record<string, unknown>> {
    const eligibility = await this.requireContentAccess(userId, conversationId)
    invariant(Number.isInteger(limit) && limit > 0 && limit <= 50, 400, 'AGENT_PAGE_LIMIT_INVALID', '分页数量无效')
    const repositoryCursor = cursor === undefined ? undefined : this.decodeCursor(conversationId, cursor)
    const messages = await this.repository.listMessages(conversationId, repositoryCursor, limit + 1)
    const page = messages.slice(0, limit)
    return {
      messages: page.map((message) => this.messageDto(message, eligibility.conversation)).filter((item) => item !== null),
      nextCursor: messages.length > limit && page.length > 0
        ? this.encodeCursor(conversationId, page[page.length - 1]!.id)
        : null
    }
  }

  async listConversations(userId: string, reportId: string): Promise<Record<string, unknown>> {
    await this.requireReportOwner(userId, reportId)
    const activeEntitlement = await this.store.read((tx) => tx.findOne('entitlements', { userId, reportId, status: 'ACTIVE' }))
    const summaries = await this.repository.listConversationSummaries(userId, reportId, 'REPORT_FOLLOWUP')
    return {
      conversations: summaries.map(({ conversation, consent, messageCount, retainedContentCount }) => ({
        conversationId: conversation.id,
        status: conversation.status,
        consentStatus: consent.revokedAt ? 'REVOKED' : 'ACTIVE',
        accessStatus: activeEntitlement ? 'ACTIVE' : 'REFUNDED_OR_REVOKED',
        createdAt: conversation.createdAt,
        expiresAt: conversation.expiresAt,
        messageCount,
        retainedContentCount
      }))
    }
  }

  async deleteConversation(userId: string, conversationId: string): Promise<void> {
    await this.repository.cancelConversation(userId, conversationId)
  }

  async revokeConsent(userId: string, conversationId: string): Promise<void> {
    const context = await this.store.transaction(async (tx) => {
      const conversation = await tx.findById('agentConversations', conversationId, { forUpdate: true })
      invariant(conversation, 404, 'AGENT_CONVERSATION_NOT_FOUND', 'Agent 会话不存在')
      invariant(conversation.userId === userId, 403, 'AGENT_CONVERSATION_FORBIDDEN', '无权撤回该 Agent 会话同意')
      const report = await tx.findById('reports', conversation.reportId, { forUpdate: true })
      const assessment = report ? await tx.findById('assessments', report.assessmentId, { forUpdate: true }) : null
      if (assessment && this.isV05Assessment(assessment)) {
        const active = await tx.findOne('consentGrants', {
          userId, subjectType: 'STUDENT', subjectId: assessment.studentId,
          scope: 'AI_ANALYSIS', withdrawnAt: null
        }, { forUpdate: true })
        if (active) await tx.update('consentGrants', active.id, { withdrawnAt: iso(this.clock), updatedAt: iso(this.clock) })
      }
      return { studentId: assessment?.studentId ?? null }
    })
    await this.repository.cancelConversation(userId, conversationId)
    if (!context.studentId) return
    const related = await this.store.read((tx) => tx.findMany('agentConversations', { userId, studentId: context.studentId! }))
    for (const conversation of related) {
      if (conversation.id !== conversationId && conversation.status === 'ACTIVE') {
        await this.repository.cancelConversation(userId, conversation.id)
      }
    }
  }

  async withdrawAiAnalysisConsent(userId: string, studentId: string): Promise<Record<string, unknown>> {
    const now = iso(this.clock)
    const fenced = await this.store.transaction(async (tx) => {
      const student = await tx.findById('students', studentId, { forUpdate: true })
      invariant(student, 404, 'STUDENT_NOT_FOUND', '学生档案不存在')
      const family = await tx.findById('families', student.familyId, { forUpdate: true })
      invariant(family?.userId === userId, 403, 'AI_ANALYSIS_CONSENT_FORBIDDEN', '无权管理该学生的 AI 分析授权')
      const active = await tx.findOne('consentGrants', {
        userId, subjectType: 'STUDENT', subjectId: studentId,
        scope: 'AI_ANALYSIS', withdrawnAt: null
      }, { forUpdate: true })
      if (active) await tx.update('consentGrants', active.id, { withdrawnAt: now, updatedAt: now })
      return fenceAgentStudentAccess(tx, userId, studentId, now, 'AI_ANALYSIS_CONSENT_WITHDRAWN')
    })
    return {
      scope: 'AI_ANALYSIS', studentId, enabled: false,
      consentVersion: AI_ANALYSIS_CONSENT_VERSION, updatedAt: now, fenced
    }
  }

  async capability(userId: string, reportId: string): Promise<Record<string, unknown>> {
    const report = await this.requireReportOwner(userId, reportId)
    const entitlement = await this.store.read((tx) => tx.findOne('entitlements', { userId, reportId, status: 'ACTIVE' }))
    const remainingReplies = await this.repository.remainingReplies(userId, reportId, this.config.maxRepliesPerReport)
    const summaries = await this.repository.listConversationSummaries(userId, reportId, 'REPORT_FOLLOWUP')
    const active = summaries.find(({ conversation, consent }) => conversation.status === 'ACTIVE' && !consent.revokedAt && Date.parse(conversation.expiresAt) > this.clock().getTime())
    const latest = summaries[0]
    let reasonCode: string | null = null
    if (!this.config.enabled) reasonCode = 'AGENT_DISABLED'
    else if (!entitlement) reasonCode = 'REPORT_PAYMENT_REQUIRED'
    else if (report.status !== 'READY' || report.deliveryStatus !== 'DELIVERED' || !report.qaPassed ||
      !Array.isArray(report.modules) || report.modules.length === 0) reasonCode = 'REPORT_NOT_READY'
    else if (remainingReplies <= 0) reasonCode = 'AGENT_REPLY_LIMIT_REACHED'
    return {
      available: reasonCode === null,
      reasonCode,
      maxRepliesPerReport: this.config.maxRepliesPerReport,
      remainingReplies,
      activeConversationId: active?.conversation.id ?? null,
      consentStatus: active ? 'ACTIVE' : latest?.consent.revokedAt ? 'REVOKED' : 'NOT_GRANTED',
      hasConversations: summaries.length > 0,
      conversationCount: summaries.length,
      managementAvailable: summaries.length > 0
    }
  }

  async execute(input: AgentRunExecutionInput<FrozenAgentRequest>): Promise<AgentRunExecutionResult<AgentReplyDto> & { terminalStatus?: 'SUCCEEDED' | 'BLOCKED' }> {
    if (!this.config.enabled) throw new AgentExecutionError('AGENT_DISABLED')
    const request = input.request
    if (request.schemaVersion !== 'phoenix-agent-request-v1' || request.promptVersion !== input.run.promptVersion) {
      throw new AgentExecutionError('AGENT_FROZEN_REQUEST_INVALID')
    }
    const taskType = request.taskType ?? 'REPORT_FOLLOWUP'
    if (!['REPORT_FOLLOWUP', 'ASSESSMENT_ANALYSIS', 'REPORT_ANALYSIS'].includes(taskType)) {
      throw new AgentExecutionError('AGENT_FROZEN_REQUEST_INVALID')
    }
    const expectedInputDigest = this.crypto.keyedDigest('message-input', {
      conversationId: input.run.conversationId,
      message: request.message
    })
    const contextDigestNamespace = taskType === 'ASSESSMENT_ANALYSIS'
      ? 'assessment-context'
      : taskType === 'REPORT_ANALYSIS' || request.taskType === 'REPORT_FOLLOWUP'
        ? 'paid-analysis-context'
        : 'report-context'
    if (expectedInputDigest !== input.run.inputDigest || this.crypto.keyedDigest(contextDigestNamespace, request.report) !== input.run.contextDigest) {
      throw new AgentExecutionError('AGENT_FROZEN_REQUEST_MISMATCH')
    }
    const eligibility = await this.requireExecutionAccess(input.run)
    if (eligibility.conversation.purpose !== taskType) throw new AgentExecutionError('AGENT_FROZEN_REQUEST_MISMATCH')

    try {
      const moderation = await this.provider.moderate(request.message, input.signal)
      if (!moderation.allowed) {
        const decision: LocalSafetyDecision = {
          action: 'BLOCK', normalized: '', code: 'CRISIS_CONTENT', category: moderation.categories.join(','),
          safeMessage: '该内容需要由监护人或合资格专业人员进一步关注，AI 解读不会继续处理。若存在立即危险，请联系可信成年人和当地紧急服务。',
          requiresGuardianAttention: moderation.requiresGuardianAttention
        }
        return {
          reply: this.replyDto(stableBlockedReply(decision), {}),
          safetyState: moderation.requiresGuardianAttention ? 'ESCALATE' : 'BLOCKED',
          terminalStatus: 'BLOCKED',
          errorCode: moderation.requiresGuardianAttention
            ? 'OPENAI_INPUT_MODERATION_GUARDIAN_ATTENTION'
            : 'OPENAI_INPUT_MODERATION_BLOCKED'
        }
      }
      const result = await this.provider.createReportFollowup({
        taskType,
        safetyIdentifier: request.safetyIdentifier,
        report: request.report,
        history: request.history,
        message: request.message
      }, input.signal)
      const aliases = request.report.sources.map((source) => source.alias)
      const draft = validateAgentReplyDraft(result.draft, aliases)
      return {
        reply: this.replyDto(draft, request.sourceMap),
        safetyState: draft.safety.requiresGuardianAttention ? 'ESCALATE' : 'ALLOWED',
        terminalStatus: 'SUCCEEDED',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens
      }
    } catch (error) {
      if (error instanceof AgentExecutionError) throw error
      if (error instanceof AgentProviderError) throw new AgentExecutionError(error.code)
      if (error instanceof AppError) throw new AgentExecutionError(error.code)
      throw new AgentExecutionError('AGENT_EXECUTION_FAILED')
    }
  }

  private async recentHistory(conversation: AgentConversation): Promise<AgentConversationTurn[]> {
    const messages = await this.repository.listMessages(conversation.id, undefined, 12)
    const history: AgentConversationTurn[] = []
    for (const message of messages.slice(-6)) {
      if (!message.contentEnvelope) continue
      try {
        const value = this.crypto.decryptJson<unknown>(message.contentEnvelope, agentMessageAad({
          messageId: message.id, conversationId: message.conversationId,
          role: message.role, contentVersion: conversation.promptVersion
        }))
        if (message.role === 'USER' && typeof value === 'string') {
          history.push({ role: 'USER', content: redactContextText(value).slice(0, this.config.maxMessageCharacters) })
        }
        if (message.role === 'ASSISTANT' && value !== null && typeof value === 'object' && typeof (value as { answer?: unknown }).answer === 'string') {
          history.push({ role: 'ASSISTANT', content: redactContextText(String((value as { answer: string }).answer)).slice(0, 4000) })
        }
      } catch {
        throw new AppError(500, 'AGENT_CONTENT_DECRYPT_FAILED', 'Agent 内容无法安全读取')
      }
    }
    return history
  }

  private messageDto(message: AgentMessage, conversation: AgentConversation): Record<string, unknown> | null {
    if (!message.contentEnvelope) {
      if (message.role === 'USER') return null
      return { messageId: message.id, role: message.role, content: null, safetyState: message.safetyState, createdAt: message.createdAt }
    }
    const value = this.crypto.decryptJson<unknown>(message.contentEnvelope, agentMessageAad({
      messageId: message.id, conversationId: message.conversationId,
      role: message.role, contentVersion: conversation.promptVersion
    }))
    if (message.role === 'USER') {
      invariant(typeof value === 'string', 500, 'AGENT_CONTENT_INVALID', 'Agent 用户消息格式无效')
      return { messageId: message.id, role: message.role, content: value, safetyState: message.safetyState, createdAt: message.createdAt }
    }
    invariant(value !== null && typeof value === 'object', 500, 'AGENT_CONTENT_INVALID', 'Agent 回复格式无效')
    return { messageId: message.id, role: message.role, reply: value, safetyState: message.safetyState, createdAt: message.createdAt }
  }

  private replyDto(draft: AgentReplyDraft, sourceMap: FrozenAgentRequest['sourceMap']): AgentReplyDto {
    return {
      answer: draft.answer,
      keyPoints: draft.keyPoints,
      nextSteps: draft.nextSteps,
      limitations: draft.limitations,
      sources: draft.sourceAliases.map((alias) => sourceMap[alias] ? publicSourceDto(alias, sourceMap[alias]) : null)
        .filter((item): item is Record<string, string> => item !== null),
      safety: draft.safety
    }
  }

  private async requireContentAccess(userId: string, conversationId: string): Promise<Eligibility> {
    return this.store.transaction(async (tx) => {
      const conversation = await tx.findById('agentConversations', conversationId, { forUpdate: true })
      invariant(conversation, 404, 'AGENT_CONVERSATION_NOT_FOUND', 'Agent 会话不存在')
      invariant(conversation.userId === userId, 403, 'AGENT_CONVERSATION_FORBIDDEN', '无权访问该 Agent 会话')
      invariant(conversation.status === 'ACTIVE' && Date.parse(conversation.expiresAt) > this.clock().getTime(), 409, 'AGENT_CONVERSATION_INACTIVE', 'Agent 会话已关闭或过期')
      const consent = await tx.findById('agentConsents', conversation.consentId, { forUpdate: true })
      invariant(consent?.guardianConfirmed && !consent.revokedAt, 403, 'AGENT_CONSENT_REQUIRED', 'Agent 专项同意无效或已撤回')
      const report = await tx.findById('reports', conversation.reportId, { forUpdate: true })
      invariant(report && report.userId === userId, 403, 'REPORT_FORBIDDEN', '无权访问该报告')
      if (conversation.purpose === 'ASSESSMENT_ANALYSIS') {
        const assessment = await tx.findById('assessments', report.assessmentId, { forUpdate: true })
        const legacyReady = assessment?.assessmentKind !== 'FREE_PARENT_COMPASS' &&
          assessment?.assessmentKind !== 'STUDENT_GROWTH_DISCOVERY' &&
          assessment?.status === 'PREVIEW_READY' && assessment.completenessScore >= 70 &&
          Array.isArray(report.modules) && report.modules.length > 0
        const v05Ready = assessment?.assessmentKind === 'FREE_PARENT_COMPASS' && assessment.status === 'SUBMITTED' &&
          report.reportKind === 'FAMILY_EDUCATION_SNAPSHOT' && Boolean(report.resultPayload)
        invariant(assessment && assessment.userId === userId && assessment.reportId === report.id &&
          report.qaPassed && (legacyReady || v05Ready),
          409, 'AGENT_ASSESSMENT_NOT_READY', '免费测评尚未完成提交和 QA')
        const guardianConsent = await tx.findById('consents', assessment.consentId, { forUpdate: true })
        invariant(guardianConsent?.guardianConfirmed && !guardianConsent.revokedAt,
          403, 'GUARDIAN_CONSENT_REQUIRED', '免费测评监护人同意无效或已撤回')
        await this.assertV05AssessmentConsents(tx, userId, assessment, true)
        return { conversation, report, assessment }
      }
      const reportContentReady = report.reportKind === 'STUDENT_GROWTH_DISCOVERY'
        ? Boolean(report.resultPayload) && Array.isArray(report.modules) && report.modules.length === 6
        : Array.isArray(report.modules) && report.modules.length > 0
      invariant(report.status === 'READY' && report.deliveryStatus === 'DELIVERED' && report.qaPassed &&
        reportContentReady, 409, 'REPORT_NOT_READY', '报告尚未完成交付和 QA')
      const entitlement = await tx.findOne('entitlements', { userId, reportId: report.id, status: 'ACTIVE' })
      invariant(entitlement, 403, 'REPORT_PAYMENT_REQUIRED', '需要有效报告权益')
      if (report.reportKind === 'STUDENT_GROWTH_DISCOVERY') {
        invariant(entitlement.productCode === 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1', 403,
          'REPORT_PAYMENT_REQUIRED', '需要匹配学生成长发现报告的有效权益')
      }
      const assessment = await tx.findById('assessments', report.assessmentId, { forUpdate: true })
      invariant(assessment && assessment.userId === userId && assessment.reportId === report.id,
        409, 'AGENT_CONTEXT_CHANGED', '报告关联的测评快照无效')
      await this.assertV05AssessmentConsents(tx, userId, assessment, true)
      return { conversation, report, assessment }
    })
  }

  private async requireExecutionAccess(run: AgentRun): Promise<Eligibility> {
    try {
      const eligibility = await this.requireContentAccess(run.userId, run.conversationId)
      if (eligibility.conversation.purpose === 'ASSESSMENT_ANALYSIS') {
        invariant(eligibility.assessment, 409, 'AGENT_CONTEXT_CHANGED', '免费测评快照无效')
        invariant(agentAssessmentVersion(eligibility.assessment, eligibility.report) === run.reportVersion,
          409, 'AGENT_REPORT_VERSION_MISMATCH', '免费测评版本已变化')
        invariant(contextDigestForAssessment(eligibility.assessment, eligibility.report, this.crypto) === run.contextDigest,
          409, 'AGENT_CONTEXT_CHANGED', '免费测评上下文已变化')
      } else if (eligibility.conversation.purpose === 'REPORT_ANALYSIS') {
        invariant(eligibility.assessment, 409, 'AGENT_CONTEXT_CHANGED', '已购报告测评快照无效')
        invariant(agentReportVersion(eligibility.report) === run.reportVersion, 409, 'AGENT_REPORT_VERSION_MISMATCH', '报告版本已变化')
        invariant(contextDigestForPaidReportAnalysis(eligibility.assessment, eligibility.report, this.crypto) === run.contextDigest,
          409, 'AGENT_CONTEXT_CHANGED', '已购报告分析上下文已变化')
      } else {
        invariant(eligibility.assessment, 409, 'AGENT_CONTEXT_CHANGED', '报告关联的测评快照无效')
        invariant(agentReportVersion(eligibility.report) === run.reportVersion, 409, 'AGENT_REPORT_VERSION_MISMATCH', '报告版本已变化')
        invariant(contextDigestForPaidReportAnalysis(eligibility.assessment, eligibility.report, this.crypto) === run.contextDigest,
          409, 'AGENT_CONTEXT_CHANGED', '报告上下文已变化')
      }
      return eligibility
    } catch (error) {
      throw new AgentExecutionError(error instanceof AppError ? error.code : 'AGENT_ACCESS_REVOKED')
    }
  }

  private async createOneShotAnalysis(
    userId: string,
    assessment: Assessment,
    report: Report,
    purpose: Extract<AgentConversationPurpose, 'ASSESSMENT_ANALYSIS' | 'REPORT_ANALYSIS'>,
    request: CreateAgentConversationRequest,
    rawIdempotencyKey: string
  ): Promise<AgentRunDto> {
    invariant(await this.rateLimiter.consume(`agent:${userId}`, this.config.messagesPerMinute, 60_000),
      429, 'AGENT_RATE_LIMITED', 'AI 分析请求过于频繁，请稍后再试')
    const key = idempotencyKey(rawIdempotencyKey)
    const promptVersion = purpose === 'ASSESSMENT_ANALYSIS'
      ? FREE_ASSESSMENT_PROMPT_VERSION
      : PAID_REPORT_ANALYSIS_PROMPT_VERSION
    const termsSummary = purpose === 'ASSESSMENT_ANALYSIS' ? ASSESSMENT_TERMS_SUMMARY : REPORT_TERMS_SUMMARY
    const terms = consentTerms(request, termsSummary)
    const expiresAt = new Date(this.clock().getTime() + this.config.retentionDays * 24 * 60 * 60 * 1000).toISOString()
    const created = await this.repository.createOrReuseConversation({
      userId,
      reportId: report.id,
      purpose,
      creationKeyDigest: this.crypto.keyedDigest('conversation-idempotency', { userId, reportId: report.id, purpose, key }),
      creationInputDigest: this.crypto.keyedDigest('conversation-input', { userId, reportId: report.id, purpose, request }),
      promptVersion,
      expiresAt,
      termsVersion: terms.termsVersion,
      termsSummary: terms.termsSummary,
      termsDigest: this.crypto.keyedDigest('consent-terms', { purpose, ...terms }),
      guardianConfirmed: true
    })
    const built: AnalysisContext = purpose === 'ASSESSMENT_ANALYSIS'
      ? buildAssessmentAnalysisContext(assessment, report)
      : buildPaidReportAnalysisContext(assessment, report)
    const message = purpose === 'ASSESSMENT_ANALYSIS'
      ? '请生成本次免费测评的有限结构化分析。'
      : '请生成本次已购报告的结构化总分析。'
    const sourceVersion = purpose === 'ASSESSMENT_ANALYSIS'
      ? agentAssessmentVersion(assessment, report)
      : agentReportVersion(report)
    const contextDigest = purpose === 'ASSESSMENT_ANALYSIS'
      ? contextDigestForAssessment(assessment, report, this.crypto)
      : contextDigestForPaidReportAnalysis(assessment, report, this.crypto)
    const runId = this.ids('arun')
    const userMessageId = this.ids('amsg')
    const frozen: FrozenAgentRequest = {
      schemaVersion: 'phoenix-agent-request-v1',
      promptVersion,
      taskType: purpose,
      safetyIdentifier: createOpenAISafetyIdentifier(userId, this.config.safetyHmacKey),
      report: built.context,
      sourceMap: built.sourceMap,
      history: [],
      message
    }
    const queued = await this.repository.enqueueRun({
      userId,
      conversationId: created.conversation.id,
      runId,
      userMessageId,
      idempotencyKeyDigest: this.crypto.keyedDigest('message-idempotency', {
        userId, conversationId: created.conversation.id, purpose, key
      }),
      inputDigest: this.crypto.keyedDigest('message-input', { conversationId: created.conversation.id, message }),
      contentEnvelope: this.crypto.encryptJson(message, agentMessageAad({
        messageId: userMessageId, conversationId: created.conversation.id, role: 'USER', contentVersion: promptVersion
      })),
      requestEnvelope: this.crypto.encryptJson(frozen, agentRunRequestAad({
        runId, conversationId: created.conversation.id, promptVersion
      })),
      reportVersion: sourceVersion,
      contextDigest,
      provider: this.provider.name,
      model: this.provider.model,
      promptVersion,
      maxRepliesPerReport: this.config.maxRepliesPerReport,
      maxActiveRunsPerUser: this.config.maxActiveRunsPerUser
    })
    return this.getRun(userId, queued.run.id)
  }

  private async latestAnalysis(
    userId: string,
    reportId: string,
    purpose: Extract<AgentConversationPurpose, 'ASSESSMENT_ANALYSIS' | 'REPORT_ANALYSIS'>
  ): Promise<Record<string, unknown>> {
    const summaries = await this.repository.listConversationSummaries(userId, reportId, purpose)
    for (const summary of summaries) {
      const runs = await this.store.read((tx) => tx.findMany('agentRuns', { conversationId: summary.conversation.id }))
      const latest = runs.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
      if (latest) return { analysis: await this.getRun(userId, latest.id) }
    }
    return { analysis: null }
  }

  private async ensureV05AiConsent(
    userId: string,
    assessment: Assessment,
    request: CreateAgentConversationRequest
  ): Promise<void> {
    if (!this.isV05Assessment(assessment)) return
    assertAgentConsent(request, true)
    const now = iso(this.clock)
    await this.store.transaction(async (tx) => {
      const current = await tx.findById('assessments', assessment.id, { forUpdate: true })
      invariant(current?.userId === userId && current.studentId === assessment.studentId,
        409, 'AGENT_CONTEXT_CHANGED', '测评关联学生已变化')
      await this.assertV05AssessmentConsents(tx, userId, current, false)
      const active = await tx.findOne('consentGrants', {
        userId, subjectType: 'STUDENT', subjectId: current.studentId,
        scope: 'AI_ANALYSIS', withdrawnAt: null
      }, { forUpdate: true })
      if (active) {
        invariant(isExactActiveAiAnalysisConsent(active, userId, current.studentId), 409,
          'AI_ANALYSIS_CONSENT_VERSION_CONFLICT', '已有不同版本的 AI 分析授权，请先撤回后重新确认')
        return
      }
      await tx.insert('consentGrants', {
        id: this.ids('cgr'), userId, familyId: current.familyId, studentId: current.studentId,
        subjectType: 'STUDENT', subjectId: current.studentId, scope: 'AI_ANALYSIS',
        subjectRole: 'STUDENT', copyVersion: AI_ANALYSIS_CONSENT_VERSION,
        copyTextHash: AI_ANALYSIS_CONSENT_COPY_SHA256, locale: 'zh-CN',
        guardianAuthorityStatus: 'CONFIRMED',
        sourceEntry: current.sourceEntry ?? 'INTERNAL_UAT',
        auditMetadata: {
          guardianConfirmed: true, studentConfirmed: true,
          channel: 'MINIPROGRAM', purpose: 'AI_ANALYSIS'
        },
        grantedAt: now, withdrawnAt: null, createdAt: now, updatedAt: now
      })
    })
  }

  // A first visit has no AI consent yet: "latest" must report no analysis so the client shows the
  // consent form instead of an error. Earlier runs stay hidden until consent is active again.
  private async hasActiveAiConsent(userId: string, assessment: Assessment): Promise<boolean> {
    if (!this.isV05Assessment(assessment)) return true
    const ai = await this.store.read((tx) => tx.findOne('consentGrants', {
      userId, subjectType: 'STUDENT', subjectId: assessment.studentId,
      scope: 'AI_ANALYSIS', withdrawnAt: null
    }))
    return isExactActiveAiAnalysisConsent(ai, userId, assessment.studentId)
  }

  private isV05Assessment(assessment: Assessment): boolean {
    return assessment.assessmentKind === 'FREE_PARENT_COMPASS' ||
      assessment.assessmentKind === 'STUDENT_GROWTH_DISCOVERY'
  }

  private async assertV05AssessmentConsents(
    tx: StoreTransaction,
    userId: string,
    assessment: Assessment,
    requireAi: boolean
  ): Promise<void> {
    if (!this.isV05Assessment(assessment)) return
    const core = assessment.coreConsentGrantId
      ? await tx.findById('consentGrants', assessment.coreConsentGrantId, { forUpdate: true })
      : null
    invariant(core?.userId === userId && core.familyId === assessment.familyId &&
      core.studentId === assessment.studentId && core.subjectType === 'STUDENT' &&
      core.subjectId === assessment.studentId && core.scope === 'CORE_ASSESSMENT' &&
      core.subjectRole === 'PARENT_GUARDIAN' && core.copyVersion === CORE_ASSESSMENT_CONSENT_VERSION &&
      core.copyTextHash === consentCopySha256(CORE_ASSESSMENT_CONSENT_COPY) &&
      core.locale === 'zh-CN' && core.guardianAuthorityStatus === 'CONFIRMED' && !core.withdrawnAt,
      403, 'CORE_ASSESSMENT_CONSENT_REQUIRED', '核心测评同意无效或已撤回')
    if (assessment.assessmentKind === 'STUDENT_GROWTH_DISCOVERY') {
      const assent = assessment.studentAssentGrantId
        ? await tx.findById('consentGrants', assessment.studentAssentGrantId, { forUpdate: true })
        : null
      invariant(assent?.userId === userId && assent.familyId === assessment.familyId &&
        assent.studentId === assessment.studentId && assent.subjectType === 'STUDENT' &&
        assent.subjectId === assessment.studentId && assent.scope === 'STUDENT_ASSESSMENT_ASSENT' &&
        assent.subjectRole === 'STUDENT' && assent.copyVersion === STUDENT_ASSESSMENT_ASSENT_VERSION &&
        assent.copyTextHash === consentCopySha256(STUDENT_ASSESSMENT_ASSENT_COPY) &&
        assent.locale === 'zh-CN' && assent.guardianAuthorityStatus === 'NOT_APPLICABLE' && !assent.withdrawnAt,
        403, 'STUDENT_ASSESSMENT_ASSENT_REQUIRED', '学生本人同意无效或已撤回')
    }
    if (!requireAi) return
    const ai = await tx.findOne('consentGrants', {
      userId, subjectType: 'STUDENT', subjectId: assessment.studentId,
      scope: 'AI_ANALYSIS', withdrawnAt: null
    }, { forUpdate: true })
    invariant(isExactActiveAiAnalysisConsent(ai, userId, assessment.studentId), 403,
      'AI_ANALYSIS_CONSENT_REQUIRED', 'AI 分析授权缺失、版本不匹配或已撤回')
  }

  private async requireAssessmentSource(
    userId: string,
    assessmentId: string,
    requireAi = true
  ): Promise<{ assessment: Assessment; report: Report }> {
    return this.store.transaction(async (tx) => {
      const assessment = await tx.findById('assessments', assessmentId)
      invariant(assessment, 404, 'ASSESSMENT_NOT_FOUND', '问卷不存在')
      invariant(assessment.userId === userId, 403, 'ASSESSMENT_FORBIDDEN', '无权访问该问卷')
      invariant(assessment.assessmentKind !== 'STUDENT_GROWTH_DISCOVERY', 409,
        'AGENT_PAID_REPORT_REQUIRED', '学生成长发现只能在付款解锁后使用完整报告 AI 分析')
      const ready = assessment.assessmentKind === 'FREE_PARENT_COMPASS'
        ? assessment.status === 'SUBMITTED' && assessment.reportId
        : assessment.status === 'PREVIEW_READY' && assessment.completenessScore >= 70 && assessment.reportId
      invariant(ready, 409, 'AGENT_ASSESSMENT_NOT_READY', '免费测评尚未完成提交')
      const reportId = assessment.reportId
      invariant(reportId, 409, 'AGENT_ASSESSMENT_NOT_READY', '免费测评尚未生成结果')
      const report = await tx.findById('reports', reportId)
      const contentReady = assessment.assessmentKind === 'FREE_PARENT_COMPASS'
        ? report?.reportKind === 'FAMILY_EDUCATION_SNAPSHOT' && Boolean(report.resultPayload)
        : Array.isArray(report?.modules) && report.modules.length > 0
      invariant(report && report.userId === userId && report.assessmentId === assessment.id && report.qaPassed && contentReady,
        409, 'AGENT_ASSESSMENT_NOT_READY', '免费测评快照尚未通过安全校验')
      const consent = await tx.findById('consents', assessment.consentId)
      invariant(consent?.guardianConfirmed && !consent.revokedAt,
        403, 'GUARDIAN_CONSENT_REQUIRED', '免费测评监护人同意无效或已撤回')
      await this.assertV05AssessmentConsents(tx, userId, assessment, requireAi)
      return { assessment, report }
    })
  }

  private async requirePaidReportSource(
    userId: string,
    reportId: string,
    requireAi = true
  ): Promise<{ assessment: Assessment; report: Report }> {
    return this.store.transaction(async (tx) => {
      const report = await tx.findById('reports', reportId)
      invariant(report, 404, 'REPORT_NOT_FOUND', '报告不存在')
      invariant(report.userId === userId, 403, 'REPORT_FORBIDDEN', '无权访问该报告')
      const contentReady = report.reportKind === 'STUDENT_GROWTH_DISCOVERY'
        ? Boolean(report.resultPayload) && Array.isArray(report.modules) && report.modules.length === 6
        : Array.isArray(report.modules) && report.modules.length > 0
      invariant(report.status === 'READY' && report.deliveryStatus === 'DELIVERED' && report.qaPassed && contentReady,
        409, 'REPORT_NOT_READY', '报告尚未完成交付和 QA')
      const entitlement = await tx.findOne('entitlements', { userId, reportId, status: 'ACTIVE' })
      invariant(entitlement, 403, 'REPORT_PAYMENT_REQUIRED', '需要有效报告权益')
      if (report.reportKind === 'STUDENT_GROWTH_DISCOVERY') {
        invariant(entitlement.productCode === 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1', 403,
          'REPORT_PAYMENT_REQUIRED', '需要匹配学生成长发现报告的有效权益')
      }
      const assessment = await tx.findById('assessments', report.assessmentId)
      invariant(assessment && assessment.userId === userId && assessment.reportId === report.id,
        409, 'AGENT_CONTEXT_CHANGED', '报告关联的测评快照无效')
      await this.assertV05AssessmentConsents(tx, userId, assessment, requireAi)
      return { assessment, report }
    })
  }

  private async requireReportOwner(userId: string, reportId: string): Promise<Report> {
    return this.store.read(async (tx) => {
      const report = await tx.findById('reports', reportId)
      invariant(report, 404, 'REPORT_NOT_FOUND', '报告不存在')
      invariant(report.userId === userId, 403, 'REPORT_FORBIDDEN', '无权访问该报告')
      return report
    })
  }

  private encodeCursor(conversationId: string, messageId: string): string {
    const payload = {
      v: 1,
      id: messageId,
      mac: this.crypto.keyedDigest('message-cursor', { conversationId, messageId })
    }
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  }

  private decodeCursor(conversationId: string, cursor: string): string {
    invariant(/^[A-Za-z0-9_-]{16,512}$/.test(cursor), 400, 'AGENT_CURSOR_INVALID', '消息游标无效')
    try {
      const decoded = Buffer.from(cursor, 'base64url')
      invariant(decoded.toString('base64url') === cursor, 400, 'AGENT_CURSOR_INVALID', '消息游标无效')
      const value = JSON.parse(decoded.toString('utf8')) as unknown
      invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 400, 'AGENT_CURSOR_INVALID', '消息游标无效')
      const record = value as Record<string, unknown>
      invariant(Object.keys(record).length === 3 && record.v === 1 && typeof record.id === 'string' && typeof record.mac === 'string',
        400, 'AGENT_CURSOR_INVALID', '消息游标无效')
      invariant(/^amsg_[A-Za-z0-9_-]{8,100}$/.test(record.id), 400, 'AGENT_CURSOR_INVALID', '消息游标无效')
      const expected = this.crypto.keyedDigest('message-cursor', { conversationId, messageId: record.id })
      invariant(record.mac === expected, 400, 'AGENT_CURSOR_INVALID', '消息游标无效')
      return record.id
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(400, 'AGENT_CURSOR_INVALID', '消息游标无效')
    }
  }

  private requireEnabled(): void {
    invariant(this.config.enabled, 503, 'AGENT_DISABLED', 'AI 解读功能尚未启用')
  }
}
