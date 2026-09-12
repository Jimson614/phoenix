import { randomUUID } from 'node:crypto'
import { PoolClient, QueryResultRow } from 'pg'
import { agentReportVersion } from '../ai/crypto'
import { agentAssessmentVersion } from '../ai/context/assessment-context'
import { AppError, invariant } from '../domain/errors'
import {
  consentCopySha256,
  CORE_ASSESSMENT_CONSENT_COPY,
  CORE_ASSESSMENT_CONSENT_VERSION,
  isExactActiveAiAnalysisConsent,
  STUDENT_ASSESSMENT_ASSENT_COPY,
  STUDENT_ASSESSMENT_ASSENT_VERSION
} from '../domain/education-compass/consent-policy'
import {
  AgentConsent,
  AgentConversation,
  AgentConversationPurpose,
  AgentEncryptedEnvelope,
  AgentMessage,
  AgentMessageSafetyState,
  AgentRun,
  AgentWorkerHeartbeat,
  Assessment,
  Report
} from '../domain/model'
import { Clock, IdFactory, iso, randomId, systemClock } from '../utils/runtime'
import { PostgresStore } from './postgres-store'
import { Store, StoreTransaction } from './store'

const DIGEST_PATTERN = /^[A-Za-z0-9._:-]{16,256}$/
const VERSION_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/
const TERMINAL_RUN_STATUSES = new Set<AgentRun['status']>(['SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED'])

export async function fenceAgentStudentAccess(
  tx: StoreTransaction,
  userId: string,
  studentId: string,
  now: string,
  errorCode = 'AGENT_CONSENT_WITHDRAWN'
): Promise<{ conversations: number; runs: number; messages: number }> {
  const conversations = await tx.findMany('agentConversations', { userId, studentId })
  let runCount = 0
  let messageCount = 0
  for (const conversation of conversations) {
    if (conversation.status === 'ACTIVE') {
      await tx.update('agentConversations', conversation.id, {
        status: 'CLOSED', updatedAt: now, closedAt: conversation.closedAt ?? now
      })
    }
    const legacyConsent = await tx.findById('agentConsents', conversation.consentId, { forUpdate: true })
    if (legacyConsent && !legacyConsent.revokedAt) {
      await tx.update('agentConsents', legacyConsent.id, { revokedAt: now, updatedAt: now })
    }
    for (const message of await tx.findMany('agentMessages', { conversationId: conversation.id })) {
      if (message.contentEnvelope !== null || !message.purgedAt) {
        await tx.update('agentMessages', message.id, { contentEnvelope: null, purgedAt: message.purgedAt ?? now })
        messageCount += 1
      }
    }
    for (const run of await tx.findMany('agentRuns', { conversationId: conversation.id })) {
      const pending = run.status === 'QUEUED' || run.status === 'RUNNING'
      await tx.update('agentRuns', run.id, {
        ...(pending ? { status: 'CANCELLED' as const, completedAt: now, errorCode } : {}),
        requestEnvelope: null, leaseToken: null, leaseOwner: null, leaseExpiresAt: null,
        fenceVersion: pending ? run.fenceVersion + 1 : run.fenceVersion,
        updatedAt: now, purgedAt: run.purgedAt ?? now
      })
      runCount += 1
    }
  }
  return { conversations: conversations.length, runs: runCount, messages: messageCount }
}

export interface CreateAgentConversationInput {
  userId: string
  reportId: string
  purpose?: AgentConversationPurpose
  creationKeyDigest: string
  creationInputDigest: string
  promptVersion: string
  expiresAt: string
  termsVersion: string
  termsSummary: string
  termsDigest: string
  guardianConfirmed: true
}

export interface CreateAgentConversationResult {
  conversation: AgentConversation
  consent: AgentConsent
  created: boolean
}

export interface EnqueueAgentRunInput {
  userId: string
  conversationId: string
  runId: string
  userMessageId: string
  idempotencyKeyDigest: string
  inputDigest: string
  contentEnvelope: AgentEncryptedEnvelope | null
  requestEnvelope: AgentEncryptedEnvelope | null
  reportVersion: string
  contextDigest: string
  provider: AgentRun['provider']
  model: string
  promptVersion: string
  disposition?: 'QUEUE' | 'BLOCK'
  blockedSafetyState?: Extract<AgentMessageSafetyState, 'BLOCKED' | 'ESCALATE'>
  blockedErrorCode?: string
  maxRepliesPerReport?: number
  maxActiveRunsPerUser?: number
}

export interface EnqueueAgentRunResult {
  run: AgentRun
  userMessage: AgentMessage
  reused: boolean
  remainingReplies: number
}

export interface AgentConversationSummary {
  conversation: AgentConversation
  consent: AgentConsent
  messageCount: number
  retainedContentCount: number
}

export interface ClaimAgentRunsInput {
  workerId: string
  batchSize: number
  leaseMs: number
  now?: string
}

export interface CompleteAgentRunInput {
  runId: string
  leaseToken: string
  fenceVersion: number
  assistantMessageId: string
  contentEnvelope: AgentEncryptedEnvelope
  safetyState: AgentMessageSafetyState
  terminalStatus?: 'SUCCEEDED' | 'BLOCKED'
  errorCode?: string
  inputTokens?: number
  outputTokens?: number
  now?: string
}

export interface FailAgentRunInput {
  runId: string
  leaseToken: string
  fenceVersion: number
  errorCode: string
  retryable: boolean
  maxAttempts: number
  nextAttemptAt?: string
  now?: string
}

export interface PurgeAgentContentInput {
  contentBefore: string
  now?: string
  batchSize?: number
}

export interface PurgeAgentContentResult {
  expiredConversations: number
  purgedMessages: number
  purgedRuns: number
  removedHeartbeats: number
}

export type AgentReportContextDigest = (report: Report) => string
export type AgentAssessmentContextDigest = (assessment: Assessment, report: Report) => string
export type AgentPaidAnalysisContextDigest = (assessment: Assessment, report: Report) => string

function validateDigest(value: string, label: string): void {
  invariant(DIGEST_PATTERN.test(value), 400, 'AGENT_DIGEST_INVALID', `${label} 无效`)
}

function validateVersion(value: string, label: string): void {
  invariant(VERSION_PATTERN.test(value), 400, 'AGENT_VERSION_INVALID', `${label} 无效`)
}

function validDate(value: string, label: string): number {
  const parsed = Date.parse(value)
  invariant(Number.isFinite(parsed), 400, 'AGENT_DATE_INVALID', `${label} 无效`)
  return parsed
}

function positiveInteger(value: number, max: number, label: string): number {
  invariant(Number.isInteger(value) && value > 0 && value <= max, 400, 'AGENT_LIMIT_INVALID', `${label} 无效`)
  return value
}

function mapRow<T>(row: QueryResultRow): T {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
    result[camel] = value instanceof Date ? value.toISOString() : value
  }
  return result as T
}

function leaseOwned(run: AgentRun, leaseToken: string, fenceVersion: number, now: string): boolean {
  return run.status === 'RUNNING' && run.leaseToken === leaseToken && run.fenceVersion === fenceVersion &&
    Boolean(run.leaseExpiresAt) && Date.parse(run.leaseExpiresAt ?? '') > Date.parse(now)
}

export class AgentRepository {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdFactory = randomId,
    private readonly contextDigestForReport?: AgentReportContextDigest,
    private readonly contextDigestForAssessment?: AgentAssessmentContextDigest,
    private readonly contextDigestForPaidAnalysis?: AgentPaidAnalysisContextDigest
  ) {}

  async createOrReuseConversation(input: CreateAgentConversationInput): Promise<CreateAgentConversationResult> {
    const purpose = input.purpose ?? 'REPORT_FOLLOWUP'
    invariant(['REPORT_FOLLOWUP', 'ASSESSMENT_ANALYSIS', 'REPORT_ANALYSIS'].includes(purpose),
      400, 'AGENT_PURPOSE_INVALID', 'Agent 会话用途无效')
    validateDigest(input.creationKeyDigest, '创建幂等摘要')
    validateDigest(input.creationInputDigest, '创建输入摘要')
    validateDigest(input.termsDigest, '同意条款摘要')
    validateVersion(input.promptVersion, 'Prompt 版本')
    validateVersion(input.termsVersion, '同意条款版本')
    invariant(typeof input.termsSummary === 'string' && input.termsSummary.trim() === input.termsSummary &&
      input.termsSummary.length >= 1 && input.termsSummary.length <= 1000,
      400, 'AGENT_TERMS_SUMMARY_INVALID', '同意条款摘要无效')
    invariant(input.guardianConfirmed === true, 400, 'AGENT_GUARDIAN_CONFIRMATION_REQUIRED', '必须由监护人确认')
    const now = iso(this.clock)
    invariant(validDate(input.expiresAt, '会话到期时间') > Date.parse(now), 400, 'AGENT_EXPIRY_INVALID', '会话到期时间必须晚于当前时间')

    try {
      return await this.store.transaction(async (tx) => {
        const report = await tx.findById('reports', input.reportId, { forUpdate: true })
        invariant(report, 404, 'REPORT_NOT_FOUND', '报告不存在')
        const user = await tx.findById('users', input.userId)
        invariant(user?.role === 'family_user', 403, 'AGENT_GUARDIAN_ROLE_REQUIRED', '当前账户不能创建报告解读会话')
        await this.requirePurposeAccess(tx, input.userId, report, purpose)

        const keyed = await tx.findOne('agentConversations', {
          userId: input.userId, reportId: input.reportId, purpose, creationKeyDigest: input.creationKeyDigest
        }, { forUpdate: true })
        if (keyed) {
          invariant(keyed.creationInputDigest === input.creationInputDigest, 409, 'AGENT_IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求')
          const consent = await tx.findById('agentConsents', keyed.consentId)
          invariant(consent, 500, 'AGENT_CONSENT_MISSING', 'Agent 同意记录缺失')
          await this.requireActiveConversation(tx, keyed, report, now)
          return { conversation: keyed, consent, created: false }
        }

        const active = await tx.findOne('agentConversations', {
          userId: input.userId, reportId: input.reportId, purpose, status: 'ACTIVE'
        }, { forUpdate: true })
        if (active && Date.parse(active.expiresAt) > Date.parse(now)) {
          const consent = await tx.findById('agentConsents', active.consentId)
          invariant(consent && !consent.revokedAt, 409, 'AGENT_CONSENT_INVALID', '活动会话的同意无效')
          await this.requireActiveConversation(tx, active, report, now)
          return { conversation: active, consent, created: false }
        }
        if (active) await this.expireConversation(tx, active, now)

        const consent: AgentConsent = {
          id: this.ids('acn'), userId: input.userId, familyId: report.familyId,
          studentId: report.studentId, reportId: report.id, scope: 'ai_education_agent',
          consentVersion: 'ai_agent_guardian_v1', guardianConfirmed: true,
          actorUserId: input.userId, actorRole: 'family_user', termsVersion: input.termsVersion,
          termsSummary: input.termsSummary, termsDigest: input.termsDigest,
          agreedAt: now, revokedAt: null, createdAt: now, updatedAt: now
        }
        const conversation: AgentConversation = {
          id: this.ids('acv'), userId: input.userId, familyId: report.familyId,
          studentId: report.studentId, reportId: report.id, consentId: consent.id,
          purpose, status: 'ACTIVE', promptVersion: input.promptVersion,
          creationKeyDigest: input.creationKeyDigest, creationInputDigest: input.creationInputDigest,
          createdAt: now, updatedAt: now, expiresAt: input.expiresAt, closedAt: null
        }
        await tx.insert('agentConsents', consent)
        await tx.insert('agentConversations', conversation)
        return { conversation, consent, created: true }
      })
    } catch (error) {
      if (!(error instanceof AppError) || !['UNIQUE_CONSTRAINT', 'DUPLICATE_AGENT_CONVERSATION'].includes(error.code)) throw error
      const recovered = await this.store.transaction(async (tx) => {
        const report = await tx.findById('reports', input.reportId, { forUpdate: true })
        invariant(report, 404, 'REPORT_NOT_FOUND', '报告不存在')
        const user = await tx.findById('users', input.userId)
        invariant(user?.role === 'family_user', 403, 'AGENT_GUARDIAN_ROLE_REQUIRED', '当前账户不能创建报告解读会话')
        await this.requirePurposeAccess(tx, input.userId, report, purpose)
        const keyed = await tx.findOne('agentConversations', {
          userId: input.userId, reportId: input.reportId, purpose, creationKeyDigest: input.creationKeyDigest
        }, { forUpdate: true }) ?? await tx.findOne('agentConversations', {
          userId: input.userId, reportId: input.reportId, purpose, status: 'ACTIVE'
        }, { forUpdate: true })
        if (!keyed) return null
        if (keyed.creationKeyDigest === input.creationKeyDigest) {
          invariant(keyed.creationInputDigest === input.creationInputDigest, 409, 'AGENT_IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求')
        }
        const consent = await tx.findById('agentConsents', keyed.consentId, { forUpdate: true })
        if (!consent) return null
        await this.requireActiveConversation(tx, keyed, report, now)
        return { conversation: keyed, consent, created: false }
      })
      if (recovered) return recovered
      throw error
    }
  }

  async enqueueRun(input: EnqueueAgentRunInput): Promise<EnqueueAgentRunResult> {
    invariant(/^arun_[A-Za-z0-9_-]{8,100}$/.test(input.runId), 400, 'AGENT_RUN_ID_INVALID', 'Agent run ID 无效')
    invariant(/^amsg_[A-Za-z0-9_-]{8,100}$/.test(input.userMessageId), 400, 'AGENT_MESSAGE_ID_INVALID', 'Agent message ID 无效')
    validateDigest(input.idempotencyKeyDigest, '消息幂等摘要')
    validateDigest(input.inputDigest, '消息输入摘要')
    validateDigest(input.contextDigest, '上下文摘要')
    validateVersion(input.promptVersion, 'Prompt 版本')
    const maxReplies = positiveInteger(input.maxRepliesPerReport ?? 3, 3, '每报告回复上限')
    const maxActive = positiveInteger(input.maxActiveRunsPerUser ?? 2, 20, '用户并发上限')
    const disposition = input.disposition ?? 'QUEUE'
    if (disposition === 'QUEUE') {
      invariant(input.contentEnvelope && input.requestEnvelope, 400, 'AGENT_ENCRYPTED_CONTENT_REQUIRED', '入队内容必须加密')
    } else {
      invariant(input.contentEnvelope === null && input.requestEnvelope === null, 400, 'AGENT_BLOCKED_CONTENT_FORBIDDEN', '被阻断正文不得持久化')
    }
    const now = iso(this.clock)

    return this.store.transaction(async (tx) => {
      // Keep the same PostgreSQL lock order as conversation creation: report -> conversation.
      // The first conversation read is only used to discover the report row; all authorization
      // decisions use the row re-read under FOR UPDATE after the report lock is held.
      const observedConversation = await tx.findById('agentConversations', input.conversationId)
      invariant(observedConversation, 404, 'AGENT_CONVERSATION_NOT_FOUND', 'Agent 会话不存在')
      invariant(observedConversation.userId === input.userId, 403, 'AGENT_CONVERSATION_FORBIDDEN', '无权访问该 Agent 会话')
      const report = await tx.findById('reports', observedConversation.reportId, { forUpdate: true })
      invariant(report, 404, 'REPORT_NOT_FOUND', '报告不存在')
      const conversation = await tx.findById('agentConversations', input.conversationId, { forUpdate: true })
      invariant(conversation, 404, 'AGENT_CONVERSATION_NOT_FOUND', 'Agent 会话不存在')
      invariant(conversation.userId === input.userId, 403, 'AGENT_CONVERSATION_FORBIDDEN', '无权访问该 Agent 会话')
      invariant(conversation.reportId === report.id, 409, 'AGENT_CONVERSATION_CHANGED', 'Agent 会话关联报告已变化')
      await tx.findById('users', input.userId, { forUpdate: true })
      await this.requireActiveConversation(tx, conversation, report, now)
      await this.requireRunContextCurrent(tx, conversation, report, input.reportVersion, input.contextDigest)

      const existing = await tx.findOne('agentRuns', {
        conversationId: conversation.id, idempotencyKeyDigest: input.idempotencyKeyDigest
      }, { forUpdate: true })
      if (existing) return this.existingEnqueueResult(tx, existing, input.inputDigest, maxReplies)

      if (conversation.purpose !== 'REPORT_FOLLOWUP') {
        const prior = (await tx.findMany('agentRuns', { conversationId: conversation.id }))[0]
        if (prior) return this.existingEnqueueResult(tx, prior, input.inputDigest, maxReplies)
      }

      invariant(input.promptVersion === conversation.promptVersion, 409, 'AGENT_PROMPT_VERSION_MISMATCH', '会话 Prompt 版本不一致')
      const allRuns = await tx.findMany('agentRuns', { userId: input.userId })
      const reserved = await this.reservedFollowupRuns(tx, input.userId, report.id, allRuns)
      if (disposition === 'QUEUE') {
        if (conversation.purpose === 'REPORT_FOLLOWUP') {
          invariant(reserved < maxReplies, 409, 'AGENT_REPLY_LIMIT_REACHED', '该报告的 AI 解读次数已用完')
        }
        invariant(allRuns.filter((run) => ['QUEUED', 'RUNNING'].includes(run.status)).length < maxActive,
          429, 'AGENT_CONCURRENCY_LIMIT', '当前 Agent 任务过多，请稍后再试')
        const pending = await tx.findOne('agentRuns', { conversationId: conversation.id, status: 'QUEUED' }) ??
          await tx.findOne('agentRuns', { conversationId: conversation.id, status: 'RUNNING' })
        invariant(!pending, 409, 'AGENT_RUN_PENDING', '该会话已有处理中任务')
      }

      const message: AgentMessage = {
        id: input.userMessageId, conversationId: conversation.id, role: 'USER',
        contentEnvelope: disposition === 'QUEUE' ? input.contentEnvelope : null,
        safetyState: disposition === 'QUEUE' ? 'ALLOWED' : (input.blockedSafetyState ?? 'BLOCKED'),
        createdAt: now, purgedAt: disposition === 'QUEUE' ? null : now
      }
      const run: AgentRun = {
        id: input.runId, conversationId: conversation.id, userId: input.userId,
        reportId: report.id, userMessageId: message.id, assistantMessageId: null,
        status: disposition === 'QUEUE' ? 'QUEUED' : 'BLOCKED',
        idempotencyKeyDigest: input.idempotencyKeyDigest, inputDigest: input.inputDigest,
        requestEnvelope: disposition === 'QUEUE' ? input.requestEnvelope : null,
        reportVersion: input.reportVersion, contextDigest: input.contextDigest,
        provider: input.provider, model: input.model, promptVersion: input.promptVersion,
        attempts: 0, leaseToken: null, leaseOwner: null, leaseExpiresAt: null, fenceVersion: 0,
        nextAttemptAt: now, errorCode: disposition === 'BLOCK' ? (input.blockedErrorCode ?? 'AGENT_INPUT_BLOCKED') : null,
        inputTokens: null, outputTokens: null, createdAt: now, updatedAt: now,
        completedAt: disposition === 'BLOCK' ? now : null, purgedAt: disposition === 'BLOCK' ? now : null
      }
      await tx.insert('agentMessages', message)
      await tx.insert('agentRuns', run)
      return {
        run, userMessage: message, reused: false,
        remainingReplies: Math.max(0, maxReplies - reserved -
          (disposition === 'QUEUE' && conversation.purpose === 'REPORT_FOLLOWUP' ? 1 : 0))
      }
    })
  }

  async getConversation(id: string): Promise<AgentConversation | null> {
    return this.store.read((tx) => tx.findById('agentConversations', id))
  }

  async getRun(id: string): Promise<AgentRun | null> {
    return this.store.read((tx) => tx.findById('agentRuns', id))
  }

  async listMessages(conversationId: string, cursor?: string, limit = 20): Promise<AgentMessage[]> {
    positiveInteger(limit, 100, '消息分页上限')
    return this.store.read(async (tx) => {
      const rows = (await tx.findMany('agentMessages', { conversationId }))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      const start = cursor ? Math.max(0, rows.findIndex((row) => row.id === cursor) + 1) : 0
      return rows.slice(start, start + limit)
    })
  }

  async listConversationSummaries(
    userId: string,
    reportId: string,
    purpose?: AgentConversationPurpose
  ): Promise<AgentConversationSummary[]> {
    return this.store.read(async (tx) => {
      const conversations = (await tx.findMany('agentConversations', { userId, reportId }))
        .filter((item) => purpose === undefined || item.purpose === purpose)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      const result: AgentConversationSummary[] = []
      for (const conversation of conversations) {
        const consent = await tx.findById('agentConsents', conversation.consentId)
        if (!consent) continue
        const messages = await tx.findMany('agentMessages', { conversationId: conversation.id })
        result.push({
          conversation, consent, messageCount: messages.length,
          retainedContentCount: messages.filter((message) => message.contentEnvelope !== null).length
        })
      }
      return result
    })
  }

  async remainingReplies(userId: string, reportId: string, maxReplies = 3): Promise<number> {
    positiveInteger(maxReplies, 3, '每报告回复上限')
    return this.store.read(async (tx) => {
      const runs = await tx.findMany('agentRuns', { userId, reportId })
      const reserved = await this.reservedFollowupRuns(tx, userId, reportId, runs)
      return Math.max(0, maxReplies - reserved)
    })
  }

  async claimRuns(input: ClaimAgentRunsInput): Promise<AgentRun[]> {
    positiveInteger(input.batchSize, 100, 'worker 批量上限')
    positiveInteger(input.leaseMs, 3_600_000, 'worker 租约时间')
    invariant(/^[A-Za-z0-9_.:-]{8,200}$/.test(input.workerId), 400, 'AGENT_WORKER_ID_INVALID', 'worker ID 无效')
    const now = input.now ?? iso(this.clock)
    validDate(now, '领取时间')
    if (this.store instanceof PostgresStore) return this.claimPostgres(this.store, input, now)
    return this.claimPortable(input, now)
  }

  async renewLease(runId: string, leaseToken: string, fenceVersion: number, leaseMs: number, now = iso(this.clock)): Promise<AgentRun | null> {
    positiveInteger(leaseMs, 3_600_000, 'worker 租约时间')
    return this.store.transaction(async (tx) => {
      const run = await tx.findById('agentRuns', runId, { forUpdate: true })
      if (!run || !leaseOwned(run, leaseToken, fenceVersion, now)) return null
      return tx.update('agentRuns', run.id, {
        leaseExpiresAt: new Date(Date.parse(now) + leaseMs).toISOString(), updatedAt: now
      })
    })
  }

  async completeRun(input: CompleteAgentRunInput): Promise<AgentRun | null> {
    const now = input.now ?? iso(this.clock)
    invariant(/^amsg_[A-Za-z0-9_-]{8,100}$/.test(input.assistantMessageId), 400, 'AGENT_MESSAGE_ID_INVALID', 'Agent message ID 无效')
    const terminalStatus = input.terminalStatus ?? 'SUCCEEDED'
    if (terminalStatus === 'BLOCKED') {
      invariant(input.safetyState !== 'ALLOWED', 400, 'AGENT_BLOCKED_SAFETY_STATE_INVALID', '被阻断回复必须标记安全状态')
      if (input.errorCode) {
        invariant(/^[A-Z0-9_:-]{3,100}$/.test(input.errorCode), 400, 'AGENT_ERROR_CODE_INVALID', 'Agent 错误码无效')
      }
    }
    return this.store.transaction(async (tx) => {
      const run = await tx.findById('agentRuns', input.runId, { forUpdate: true })
      if (!run || !leaseOwned(run, input.leaseToken, input.fenceVersion, now)) return null
      if (!await this.runStillEligible(tx, run, now)) return this.cancelRunInTransaction(tx, run, now, 'AGENT_ACCESS_REVOKED')
      invariant(!run.assistantMessageId, 409, 'AGENT_RUN_ALREADY_COMPLETED', 'Agent 任务已存在回复')
      const message: AgentMessage = {
        id: input.assistantMessageId, conversationId: run.conversationId, role: 'ASSISTANT',
        contentEnvelope: input.contentEnvelope, safetyState: input.safetyState,
        createdAt: now, purgedAt: null
      }
      if (terminalStatus === 'BLOCKED') {
        const userMessageId = run.userMessageId
        invariant(userMessageId, 500, 'AGENT_MESSAGE_MISSING', 'Agent 用户消息记录缺失')
        const userMessage = await tx.findById('agentMessages', userMessageId, { forUpdate: true })
        invariant(userMessage && userMessage.conversationId === run.conversationId && userMessage.role === 'USER',
          500, 'AGENT_MESSAGE_MISSING', 'Agent 用户消息记录缺失')
        await tx.update('agentMessages', userMessage.id, {
          contentEnvelope: null, safetyState: input.safetyState, purgedAt: now
        })
      }
      await tx.insert('agentMessages', message)
      return tx.update('agentRuns', run.id, {
        assistantMessageId: message.id, status: terminalStatus, requestEnvelope: null,
        leaseToken: null, leaseOwner: null, leaseExpiresAt: null,
        errorCode: terminalStatus === 'BLOCKED' ? (input.errorCode ?? 'AGENT_INPUT_BLOCKED_BY_MODERATION') : null,
        inputTokens: input.inputTokens ?? null, outputTokens: input.outputTokens ?? null,
        updatedAt: now, completedAt: now, purgedAt: now
      })
    })
  }

  async failRun(input: FailAgentRunInput): Promise<AgentRun | null> {
    positiveInteger(input.maxAttempts, 20, '最大尝试次数')
    invariant(/^[A-Z0-9_:-]{3,100}$/.test(input.errorCode), 400, 'AGENT_ERROR_CODE_INVALID', 'Agent 错误码无效')
    const now = input.now ?? iso(this.clock)
    return this.store.transaction(async (tx) => {
      const run = await tx.findById('agentRuns', input.runId, { forUpdate: true })
      if (!run || !leaseOwned(run, input.leaseToken, input.fenceVersion, now)) return null
      const eligible = await this.runStillEligible(tx, run, now)
      if (input.retryable && eligible && run.attempts < input.maxAttempts) {
        const nextAttemptAt = input.nextAttemptAt ?? new Date(Date.parse(now) + 1_000).toISOString()
        invariant(Date.parse(nextAttemptAt) > Date.parse(now), 400, 'AGENT_RETRY_TIME_INVALID', '重试时间必须晚于当前时间')
        return tx.update('agentRuns', run.id, {
          status: 'QUEUED', leaseToken: null, leaseOwner: null, leaseExpiresAt: null,
          nextAttemptAt, errorCode: input.errorCode, updatedAt: now
        })
      }
      if (!eligible) return this.cancelRunInTransaction(tx, run, now, 'AGENT_ACCESS_REVOKED')
      return tx.update('agentRuns', run.id, {
        status: 'FAILED', requestEnvelope: null, leaseToken: null, leaseOwner: null,
        leaseExpiresAt: null, errorCode: input.errorCode, updatedAt: now,
        completedAt: now, purgedAt: now
      })
    })
  }

  async cancelConversation(userId: string, conversationId: string, now = iso(this.clock)): Promise<AgentConversation> {
    return this.store.transaction(async (tx) => {
      const conversation = await tx.findById('agentConversations', conversationId, { forUpdate: true })
      invariant(conversation, 404, 'AGENT_CONVERSATION_NOT_FOUND', 'Agent 会话不存在')
      invariant(conversation.userId === userId, 403, 'AGENT_CONVERSATION_FORBIDDEN', '无权删除该 Agent 会话')
      await this.clearConversationContent(tx, conversation, now, 'CLOSED')
      return (await tx.findById('agentConversations', conversation.id)) ?? conversation
    })
  }

  async purgeExpired(input: PurgeAgentContentInput): Promise<PurgeAgentContentResult> {
    const now = input.now ?? iso(this.clock)
    const contentBeforeMs = validDate(input.contentBefore, '内容保留截止时间')
    invariant(contentBeforeMs <= Date.parse(now), 400, 'AGENT_RETENTION_CUTOFF_INVALID', '内容保留截止时间不能晚于当前时间')
    const batchSize = positiveInteger(input.batchSize ?? 100, 1_000, '清理批量上限')
    return this.store.transaction(async (tx) => {
      let expiredConversations = 0
      let purgedMessages = 0
      let purgedRuns = 0
      let removedHeartbeats = 0
      const conversations = (await tx.findMany('agentConversations'))
        .filter((item) => item.status === 'ACTIVE' && Date.parse(item.expiresAt) <= Date.parse(now))
        .slice(0, batchSize)
      for (const conversation of conversations) {
        await this.clearConversationContent(tx, conversation, now, 'EXPIRED')
        expiredConversations += 1
      }
      const messages = (await tx.findMany('agentMessages'))
        .filter((item) => item.contentEnvelope !== null && Date.parse(item.createdAt) <= contentBeforeMs)
        .slice(0, batchSize)
      for (const message of messages) {
        await tx.update('agentMessages', message.id, { contentEnvelope: null, purgedAt: now })
        purgedMessages += 1
      }
      const runs = (await tx.findMany('agentRuns'))
        .filter((item) => item.requestEnvelope !== null && TERMINAL_RUN_STATUSES.has(item.status) && Date.parse(item.createdAt) <= contentBeforeMs)
        .slice(0, batchSize)
      for (const run of runs) {
        await tx.update('agentRuns', run.id, { requestEnvelope: null, purgedAt: now, updatedAt: now })
        purgedRuns += 1
      }
      const heartbeats = (await tx.findMany('agentWorkerHeartbeats'))
        .filter((item) => Date.parse(item.expiresAt) <= Date.parse(now)).slice(0, batchSize)
      for (const heartbeat of heartbeats) {
        if (await tx.delete('agentWorkerHeartbeats', heartbeat.id)) removedHeartbeats += 1
      }
      return { expiredConversations, purgedMessages, purgedRuns, removedHeartbeats }
    })
  }

  async upsertHeartbeat(heartbeat: AgentWorkerHeartbeat): Promise<AgentWorkerHeartbeat> {
    return this.store.transaction(async (tx) => {
      const existing = await tx.findById('agentWorkerHeartbeats', heartbeat.id, { forUpdate: true })
      return existing ? tx.update('agentWorkerHeartbeats', heartbeat.id, heartbeat) : tx.insert('agentWorkerHeartbeats', heartbeat)
    })
  }

  async releaseWorkerLeases(workerId: string, now = iso(this.clock)): Promise<number> {
    return this.store.transaction(async (tx) => {
      const runs = await tx.findMany('agentRuns', { status: 'RUNNING', leaseOwner: workerId })
      for (const run of runs) {
        await tx.update('agentRuns', run.id, {
          status: 'QUEUED', leaseToken: null, leaseOwner: null, leaseExpiresAt: null,
          fenceVersion: run.fenceVersion + 1, nextAttemptAt: now, updatedAt: now
        })
      }
      return runs.length
    })
  }

  private async existingEnqueueResult(
    tx: StoreTransaction,
    run: AgentRun,
    inputDigest: string,
    maxReplies: number
  ): Promise<EnqueueAgentRunResult> {
    invariant(run.inputDigest === inputDigest, 409, 'AGENT_IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同消息')
    const message = run.userMessageId ? await tx.findById('agentMessages', run.userMessageId) : null
    invariant(message, 500, 'AGENT_MESSAGE_MISSING', 'Agent 用户消息记录缺失')
    const runs = await tx.findMany('agentRuns', { userId: run.userId, reportId: run.reportId })
    const reserved = await this.reservedFollowupRuns(tx, run.userId, run.reportId, runs)
    return { run, userMessage: message, reused: true, remainingReplies: Math.max(0, maxReplies - reserved) }
  }

  private async requirePaidReport(tx: StoreTransaction, userId: string, report: Report): Promise<void> {
    invariant(report.userId === userId, 403, 'REPORT_FORBIDDEN', '无权访问该报告')
    const contentReady = report.reportKind === 'STUDENT_GROWTH_DISCOVERY'
      ? Boolean(report.resultPayload) && Array.isArray(report.modules) && report.modules.length === 6
      : Array.isArray(report.modules) && report.modules.length > 0
    invariant(report.status === 'READY' && report.deliveryStatus === 'DELIVERED' && report.qaPassed &&
      contentReady,
      409, 'REPORT_NOT_READY', '报告尚未完成交付和 QA')
    const entitlement = await tx.findOne('entitlements', { userId, reportId: report.id, status: 'ACTIVE' })
    invariant(entitlement, 403, 'REPORT_PAYMENT_REQUIRED', '需要有效报告权益')
    if (report.reportKind === 'STUDENT_GROWTH_DISCOVERY') {
      invariant(entitlement.productCode === 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1', 403,
        'REPORT_PAYMENT_REQUIRED', '需要匹配学生成长发现报告的有效权益')
      const assessment = await tx.findById('assessments', report.assessmentId, { forUpdate: true })
      invariant(assessment && assessment.userId === userId && assessment.reportId === report.id,
        409, 'AGENT_CONTEXT_CHANGED', '报告关联的测评快照无效')
      await this.requireV05Consents(tx, userId, assessment)
    }
  }

  private async requireFreeAssessment(tx: StoreTransaction, userId: string, report: Report): Promise<Assessment> {
    const reportReady = report.reportKind === 'FAMILY_EDUCATION_SNAPSHOT'
      ? Boolean(report.resultPayload)
      : Array.isArray(report.modules) && report.modules.length > 0
    invariant(report.userId === userId && report.qaPassed && reportReady,
      409, 'AGENT_ASSESSMENT_NOT_READY', '免费测评尚未完成提交和 QA')
    const assessment = await tx.findById('assessments', report.assessmentId)
    invariant(assessment?.assessmentKind !== 'STUDENT_GROWTH_DISCOVERY', 409,
      'AGENT_PAID_REPORT_REQUIRED', '学生成长发现只能在付款解锁后使用完整报告 AI 分析')
    const assessmentReady = assessment?.assessmentKind === 'FREE_PARENT_COMPASS'
      ? assessment.status === 'SUBMITTED'
      : assessment?.status === 'PREVIEW_READY' && assessment.completenessScore >= 70
    invariant(assessment && assessment.userId === userId && assessment.reportId === report.id &&
      assessmentReady,
      409, 'AGENT_ASSESSMENT_NOT_READY', '免费测评尚未完成提交')
    const guardianConsent = await tx.findById('consents', assessment.consentId)
    invariant(guardianConsent?.guardianConfirmed && !guardianConsent.revokedAt,
      403, 'GUARDIAN_CONSENT_REQUIRED', '免费测评监护人同意无效或已撤回')
    if (assessment.assessmentKind === 'FREE_PARENT_COMPASS') {
      await this.requireV05Consents(tx, userId, assessment)
    }
    return assessment
  }

  private async requireV05Consents(tx: StoreTransaction, userId: string, assessment: Assessment): Promise<void> {
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
    const ai = await tx.findOne('consentGrants', {
      userId, subjectType: 'STUDENT', subjectId: assessment.studentId,
      scope: 'AI_ANALYSIS', withdrawnAt: null
    }, { forUpdate: true })
    invariant(isExactActiveAiAnalysisConsent(ai, userId, assessment.studentId), 403,
      'AI_ANALYSIS_CONSENT_REQUIRED', 'AI 分析授权缺失、版本不匹配或已撤回')
  }

  private async requirePurposeAccess(
    tx: StoreTransaction,
    userId: string,
    report: Report,
    purpose: AgentConversationPurpose
  ): Promise<void> {
    if (purpose === 'ASSESSMENT_ANALYSIS') {
      await this.requireFreeAssessment(tx, userId, report)
      return
    }
    await this.requirePaidReport(tx, userId, report)
  }

  private async requireActiveConversation(
    tx: StoreTransaction,
    conversation: AgentConversation,
    report: Report,
    now: string
  ): Promise<void> {
    invariant(conversation.status === 'ACTIVE' && Date.parse(conversation.expiresAt) > Date.parse(now),
      409, 'AGENT_CONVERSATION_INACTIVE', 'Agent 会话已关闭或过期')
    const consent = await tx.findById('agentConsents', conversation.consentId, { forUpdate: true })
    invariant(consent && consent.userId === conversation.userId && consent.reportId === conversation.reportId &&
      consent.guardianConfirmed && !consent.revokedAt, 403, 'AGENT_CONSENT_REQUIRED', 'Agent 专项同意无效或已撤回')
    await this.requirePurposeAccess(tx, conversation.userId, report, conversation.purpose)
  }

  private async runStillEligible(tx: StoreTransaction, run: AgentRun, now: string): Promise<boolean> {
    try {
      const conversation = await tx.findById('agentConversations', run.conversationId, { forUpdate: true })
      if (!conversation || conversation.userId !== run.userId || conversation.reportId !== run.reportId) return false
      const report = await tx.findById('reports', run.reportId, { forUpdate: true })
      if (!report) return false
      await this.requireActiveConversation(tx, conversation, report, now)
      await this.requireRunContextCurrent(tx, conversation, report, run.reportVersion, run.contextDigest)
      return true
    } catch (error) {
      if (error instanceof AppError) return false
      throw error
    }
  }

  private async expireConversation(tx: StoreTransaction, conversation: AgentConversation, now: string): Promise<void> {
    await this.clearConversationContent(tx, conversation, now, 'EXPIRED')
  }

  private async clearConversationContent(
    tx: StoreTransaction,
    conversation: AgentConversation,
    now: string,
    status: 'CLOSED' | 'EXPIRED'
  ): Promise<void> {
    await tx.update('agentConversations', conversation.id, { status, updatedAt: now, closedAt: conversation.closedAt ?? now })
    const consent = await tx.findById('agentConsents', conversation.consentId, { forUpdate: true })
    if (consent && !consent.revokedAt) await tx.update('agentConsents', consent.id, { revokedAt: now, updatedAt: now })
    for (const message of await tx.findMany('agentMessages', { conversationId: conversation.id })) {
      if (message.contentEnvelope !== null || !message.purgedAt) {
        await tx.update('agentMessages', message.id, { contentEnvelope: null, purgedAt: message.purgedAt ?? now })
      }
    }
    for (const run of await tx.findMany('agentRuns', { conversationId: conversation.id })) {
      const pending = ['QUEUED', 'RUNNING'].includes(run.status)
      await tx.update('agentRuns', run.id, {
        ...(pending ? { status: 'CANCELLED' as const, completedAt: now, errorCode: 'AGENT_CONVERSATION_CLOSED' } : {}),
        requestEnvelope: null, leaseToken: null, leaseOwner: null, leaseExpiresAt: null,
        fenceVersion: pending ? run.fenceVersion + 1 : run.fenceVersion,
        updatedAt: now, purgedAt: run.purgedAt ?? now
      })
    }
  }

  private async cancelRunInTransaction(tx: StoreTransaction, run: AgentRun, now: string, errorCode: string): Promise<AgentRun> {
    return tx.update('agentRuns', run.id, {
      status: 'CANCELLED', requestEnvelope: null, leaseToken: null, leaseOwner: null,
      leaseExpiresAt: null, fenceVersion: run.fenceVersion + 1, errorCode,
      updatedAt: now, completedAt: now, purgedAt: now
    })
  }

  private async claimPortable(input: ClaimAgentRunsInput, now: string): Promise<AgentRun[]> {
    const leaseExpiresAt = new Date(Date.parse(now) + input.leaseMs).toISOString()
    return this.store.transaction(async (tx) => {
      const candidates = (await tx.findMany('agentRuns'))
        .filter((run) => (run.status === 'QUEUED' && Date.parse(run.nextAttemptAt) <= Date.parse(now)) ||
          (run.status === 'RUNNING' && Boolean(run.leaseExpiresAt) && Date.parse(run.leaseExpiresAt ?? '') <= Date.parse(now)))
        .sort((left, right) => left.nextAttemptAt.localeCompare(right.nextAttemptAt) || left.createdAt.localeCompare(right.createdAt))
      const claimed: AgentRun[] = []
      for (const run of candidates) {
        if (!await this.runStillEligible(tx, run, now)) {
          await this.cancelRunInTransaction(tx, run, now, 'AGENT_ACCESS_REVOKED')
          continue
        }
        if (claimed.length >= input.batchSize) continue
        claimed.push(await tx.update('agentRuns', run.id, {
          status: 'RUNNING', attempts: run.attempts + 1,
          leaseToken: `${input.workerId}:${randomUUID()}`, leaseOwner: input.workerId,
          leaseExpiresAt, fenceVersion: run.fenceVersion + 1, updatedAt: now
        }))
      }
      return claimed
    })
  }

  private async claimPostgres(store: PostgresStore, input: ClaimAgentRunsInput, now: string): Promise<AgentRun[]> {
    const leaseExpiresAt = new Date(Date.parse(now) + input.leaseMs).toISOString()
    const tokenPrefix = `${input.workerId}:${randomUUID()}`
    const client = await store.pool.connect()
    try {
      await client.query('BEGIN')
      await this.cancelInvalidPostgresRuns(client, now, input.batchSize)
      const result = await client.query(`
        WITH candidates AS (
          SELECT ar.id, ar.report_id
          FROM agent_runs ar
          JOIN agent_conversations ac ON ac.id = ar.conversation_id
          JOIN agent_consents agc ON agc.id = ac.consent_id
          JOIN reports r ON r.id = ar.report_id
          JOIN assessments a ON a.id = r.assessment_id
          JOIN guardian_consents gc ON gc.id = a.consent_id
          WHERE (
            (ar.status = 'QUEUED' AND ar.next_attempt_at <= $1::timestamptz)
            OR (ar.status = 'RUNNING' AND ar.lease_expires_at <= $1::timestamptz)
          )
            AND ac.status = 'ACTIVE' AND ac.expires_at > $1::timestamptz
            AND ac.user_id = ar.user_id AND ac.report_id = ar.report_id
            AND agc.user_id = ar.user_id AND agc.report_id = ar.report_id
            AND agc.guardian_confirmed AND agc.revoked_at IS NULL
            AND r.user_id = ar.user_id
            AND r.qa_passed
            AND (
              a.assessment_kind = 'LEGACY_EDUCATION_COMPASS'
              OR EXISTS (
                SELECT 1 FROM consent_grants ai_consent
                WHERE ai_consent.user_id = ar.user_id
                  AND ai_consent.family_id = a.family_id
                  AND ai_consent.student_id = a.student_id
                  AND ai_consent.subject_type = 'STUDENT'
                  AND ai_consent.subject_id = a.student_id
                  AND ai_consent.scope = 'AI_ANALYSIS'
                  AND ai_consent.subject_role = 'STUDENT'
                  AND ai_consent.copy_version = 'agent_analysis_opt_in_v1.0.0-rc1'
                  AND ai_consent.copy_text_hash = '08b562b215b1280eac5709bd8a48ce9a2c6b897729bfc8fc6bbcaf90e6355fb1'
                  AND ai_consent.locale = 'zh-CN'
                  AND ai_consent.guardian_authority_status = 'CONFIRMED'
                  AND ai_consent.withdrawn_at IS NULL
              )
            )
            AND (
              (
                r.report_kind = 'LEGACY_EDUCATION_COMPASS_REPORT'
                AND jsonb_typeof(r.modules) = 'array' AND jsonb_array_length(r.modules) > 0
              )
              OR (r.report_kind = 'FAMILY_EDUCATION_SNAPSHOT' AND r.result_payload IS NOT NULL)
              OR (
                r.report_kind = 'STUDENT_GROWTH_DISCOVERY' AND r.result_payload IS NOT NULL
                AND jsonb_typeof(r.modules) = 'array' AND jsonb_array_length(r.modules) = 6
              )
            )
            AND (
              (
                ac.purpose = 'ASSESSMENT_ANALYSIS'
                AND a.user_id = ar.user_id AND a.report_id = ar.report_id
                AND gc.user_id = ar.user_id AND gc.guardian_confirmed AND gc.revoked_at IS NULL
                AND (
                  (
                    a.assessment_kind = 'LEGACY_EDUCATION_COMPASS'
                    AND a.status = 'PREVIEW_READY' AND a.completeness_score >= 70
                  )
                  OR (
                    a.assessment_kind = 'FREE_PARENT_COMPASS' AND a.status = 'SUBMITTED'
                    AND r.report_kind = 'FAMILY_EDUCATION_SNAPSHOT'
                    AND EXISTS (
                      SELECT 1 FROM consent_grants core_consent
                      WHERE core_consent.user_id = ar.user_id
                        AND core_consent.student_id = a.student_id
                        AND core_consent.scope = 'CORE_ASSESSMENT'
                        AND core_consent.subject_type = 'STUDENT'
                        AND core_consent.subject_id = a.student_id
                        AND core_consent.subject_role = 'PARENT_GUARDIAN'
                        AND core_consent.copy_version = 'guardian_core_assessment_v1.0.0-rc1'
                        AND core_consent.copy_text_hash = '334a1e8e455dfef386fcaf491acea3dac23b13c4ece010cfad66d1087f6a84a5'
                        AND core_consent.locale = 'zh-CN'
                        AND core_consent.guardian_authority_status = 'CONFIRMED'
                        AND core_consent.withdrawn_at IS NULL
                    )
                  )
                )
              )
              OR (
                ac.purpose IN ('REPORT_FOLLOWUP', 'REPORT_ANALYSIS')
                AND r.status = 'READY' AND r.delivery_status = 'DELIVERED'
                AND ar.report_version = concat_ws('|',
                  r.versions->>'studentVersion', r.versions->>'ruleVersion', r.versions->>'dataVersion',
                  r.versions->>'promptVersion', r.versions->>'templateVersion', r.source_catalog_version
                )
                AND EXISTS (
                  SELECT 1 FROM entitlements e
                  WHERE e.user_id = ar.user_id AND e.report_id = ar.report_id AND e.status = 'ACTIVE'
                    AND (
                      r.report_kind <> 'STUDENT_GROWTH_DISCOVERY'
                      OR e.product_code = 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1'
                    )
                )
                AND (
                  r.report_kind <> 'STUDENT_GROWTH_DISCOVERY'
                  OR (
                    EXISTS (
                      SELECT 1 FROM consent_grants core_consent
                      WHERE core_consent.id = a.core_consent_grant_id
                        AND core_consent.user_id = ar.user_id
                        AND core_consent.family_id = a.family_id
                        AND core_consent.student_id = a.student_id
                        AND core_consent.subject_type = 'STUDENT'
                        AND core_consent.subject_id = a.student_id
                        AND core_consent.scope = 'CORE_ASSESSMENT'
                        AND core_consent.subject_role = 'PARENT_GUARDIAN'
                        AND core_consent.copy_version = 'guardian_core_assessment_v1.0.0-rc1'
                        AND core_consent.copy_text_hash = '334a1e8e455dfef386fcaf491acea3dac23b13c4ece010cfad66d1087f6a84a5'
                        AND core_consent.locale = 'zh-CN'
                        AND core_consent.guardian_authority_status = 'CONFIRMED'
                        AND core_consent.withdrawn_at IS NULL
                    )
                    AND EXISTS (
                      SELECT 1 FROM consent_grants assent_consent
                      WHERE assent_consent.id = a.student_assent_grant_id
                        AND assent_consent.user_id = ar.user_id
                        AND assent_consent.family_id = a.family_id
                        AND assent_consent.student_id = a.student_id
                        AND assent_consent.subject_type = 'STUDENT'
                        AND assent_consent.subject_id = a.student_id
                        AND assent_consent.scope = 'STUDENT_ASSESSMENT_ASSENT'
                        AND assent_consent.subject_role = 'STUDENT'
                        AND assent_consent.copy_version = 'student_assent_growth_discovery_v1.0.0-rc1'
                        AND assent_consent.copy_text_hash = '0ab8f89835cfe500f97944324ab58a3cf2cce27913fc5af5d02461227b2a821d'
                        AND assent_consent.locale = 'zh-CN'
                        AND assent_consent.guardian_authority_status = 'NOT_APPLICABLE'
                        AND assent_consent.withdrawn_at IS NULL
                    )
                  )
                )
              )
            )
          ORDER BY ar.next_attempt_at, ar.created_at, ar.id
          FOR UPDATE OF ar, r SKIP LOCKED
          LIMIT $2
        )
        UPDATE agent_runs ar
        SET status = 'RUNNING', attempts = ar.attempts + 1,
            lease_token = $3 || ':' || ar.id, lease_owner = $4,
            lease_expires_at = $5::timestamptz, fence_version = ar.fence_version + 1,
            updated_at = $1::timestamptz
        FROM candidates c
        WHERE ar.id = c.id
        RETURNING ar.*
      `, [now, input.batchSize, tokenPrefix, input.workerId, leaseExpiresAt])
      const claimed = result.rows.map((row) => mapRow<AgentRun>(row))
      const valid: AgentRun[] = []
      for (const run of claimed) {
        const reportResult = await client.query('SELECT * FROM reports WHERE id = $1', [run.reportId])
        const reportRow = reportResult.rows[0]
        const conversationResult = await client.query('SELECT purpose FROM agent_conversations WHERE id = $1', [run.conversationId])
        const purpose = conversationResult.rows[0]?.purpose as AgentConversationPurpose | undefined
        const report = reportRow ? mapRow<Report>(reportRow) : null
        let contextCurrent = false
        if (report && purpose === 'ASSESSMENT_ANALYSIS') {
          const assessmentResult = await client.query('SELECT * FROM assessments WHERE id = $1', [report.assessmentId])
          const assessmentRow = assessmentResult.rows[0]
          if (assessmentRow) {
            const assessment = mapRow<Assessment>(assessmentRow)
            contextCurrent = run.reportVersion === agentAssessmentVersion(assessment, report) &&
              run.contextDigest === this.currentAssessmentContextDigest(assessment, report)
          }
        } else if (report && purpose === 'REPORT_ANALYSIS') {
          const assessmentResult = await client.query('SELECT * FROM assessments WHERE id = $1', [report.assessmentId])
          const assessmentRow = assessmentResult.rows[0]
          if (assessmentRow) {
            const assessment = mapRow<Assessment>(assessmentRow)
            contextCurrent = run.reportVersion === agentReportVersion(report) &&
              run.contextDigest === this.currentPaidAnalysisContextDigest(assessment, report)
          }
        } else if (report && purpose === 'REPORT_FOLLOWUP') {
          const assessmentResult = await client.query('SELECT * FROM assessments WHERE id = $1', [report.assessmentId])
          const assessmentRow = assessmentResult.rows[0]
          if (assessmentRow) {
            const assessment = mapRow<Assessment>(assessmentRow)
            contextCurrent = run.reportVersion === agentReportVersion(report) &&
              run.contextDigest === this.currentPaidAnalysisContextDigest(assessment, report)
          }
        }
        if (contextCurrent) {
          valid.push(run)
          continue
        }
        await client.query(`
          UPDATE agent_runs
          SET status = 'CANCELLED', request_envelope = NULL,
              lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
              fence_version = fence_version + 1, error_code = 'AGENT_CONTEXT_VERSION_MISMATCH',
              updated_at = $2::timestamptz, completed_at = $2::timestamptz, purged_at = $2::timestamptz
          WHERE id = $1 AND status = 'RUNNING'
        `, [run.id, now])
      }
      await client.query('COMMIT')
      return valid
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async cancelInvalidPostgresRuns(client: PoolClient, now: string, batchSize: number): Promise<void> {
    await client.query(`
      WITH invalid AS (
        SELECT ar.id
        FROM agent_runs ar
        WHERE (
          (ar.status = 'QUEUED' AND ar.next_attempt_at <= $1::timestamptz)
          OR (ar.status = 'RUNNING' AND ar.lease_expires_at <= $1::timestamptz)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM agent_conversations ac
          JOIN agent_consents agc ON agc.id = ac.consent_id
          JOIN reports r ON r.id = ar.report_id
          JOIN assessments a ON a.id = r.assessment_id
          JOIN guardian_consents gc ON gc.id = a.consent_id
          WHERE ac.id = ar.conversation_id
            AND ac.status = 'ACTIVE' AND ac.expires_at > $1::timestamptz
            AND ac.user_id = ar.user_id AND ac.report_id = ar.report_id
            AND agc.user_id = ar.user_id AND agc.report_id = ar.report_id
            AND agc.guardian_confirmed AND agc.revoked_at IS NULL
            AND r.user_id = ar.user_id
            AND r.qa_passed
            AND (
              a.assessment_kind = 'LEGACY_EDUCATION_COMPASS'
              OR EXISTS (
                SELECT 1 FROM consent_grants ai_consent
                WHERE ai_consent.user_id = ar.user_id
                  AND ai_consent.family_id = a.family_id
                  AND ai_consent.student_id = a.student_id
                  AND ai_consent.subject_type = 'STUDENT'
                  AND ai_consent.subject_id = a.student_id
                  AND ai_consent.scope = 'AI_ANALYSIS'
                  AND ai_consent.subject_role = 'STUDENT'
                  AND ai_consent.copy_version = 'agent_analysis_opt_in_v1.0.0-rc1'
                  AND ai_consent.copy_text_hash = '08b562b215b1280eac5709bd8a48ce9a2c6b897729bfc8fc6bbcaf90e6355fb1'
                  AND ai_consent.locale = 'zh-CN'
                  AND ai_consent.guardian_authority_status = 'CONFIRMED'
                  AND ai_consent.withdrawn_at IS NULL
              )
            )
            AND (
              (
                r.report_kind = 'LEGACY_EDUCATION_COMPASS_REPORT'
                AND jsonb_typeof(r.modules) = 'array' AND jsonb_array_length(r.modules) > 0
              )
              OR (r.report_kind = 'FAMILY_EDUCATION_SNAPSHOT' AND r.result_payload IS NOT NULL)
              OR (
                r.report_kind = 'STUDENT_GROWTH_DISCOVERY' AND r.result_payload IS NOT NULL
                AND jsonb_typeof(r.modules) = 'array' AND jsonb_array_length(r.modules) = 6
              )
            )
            AND (
              (
                ac.purpose = 'ASSESSMENT_ANALYSIS'
                AND a.user_id = ar.user_id AND a.report_id = ar.report_id
                AND gc.user_id = ar.user_id AND gc.guardian_confirmed AND gc.revoked_at IS NULL
                AND (
                  (
                    a.assessment_kind = 'LEGACY_EDUCATION_COMPASS'
                    AND a.status = 'PREVIEW_READY' AND a.completeness_score >= 70
                  )
                  OR (
                    a.assessment_kind = 'FREE_PARENT_COMPASS' AND a.status = 'SUBMITTED'
                    AND r.report_kind = 'FAMILY_EDUCATION_SNAPSHOT'
                    AND EXISTS (
                      SELECT 1 FROM consent_grants core_consent
                      WHERE core_consent.user_id = ar.user_id
                        AND core_consent.student_id = a.student_id
                        AND core_consent.scope = 'CORE_ASSESSMENT'
                        AND core_consent.subject_type = 'STUDENT'
                        AND core_consent.subject_id = a.student_id
                        AND core_consent.subject_role = 'PARENT_GUARDIAN'
                        AND core_consent.copy_version = 'guardian_core_assessment_v1.0.0-rc1'
                        AND core_consent.copy_text_hash = '334a1e8e455dfef386fcaf491acea3dac23b13c4ece010cfad66d1087f6a84a5'
                        AND core_consent.locale = 'zh-CN'
                        AND core_consent.guardian_authority_status = 'CONFIRMED'
                        AND core_consent.withdrawn_at IS NULL
                    )
                  )
                )
              )
              OR (
                ac.purpose IN ('REPORT_FOLLOWUP', 'REPORT_ANALYSIS')
                AND r.status = 'READY' AND r.delivery_status = 'DELIVERED'
                AND ar.report_version = concat_ws('|',
                  r.versions->>'studentVersion', r.versions->>'ruleVersion', r.versions->>'dataVersion',
                  r.versions->>'promptVersion', r.versions->>'templateVersion', r.source_catalog_version
                )
                AND EXISTS (
                  SELECT 1 FROM entitlements e
                  WHERE e.user_id = ar.user_id AND e.report_id = ar.report_id AND e.status = 'ACTIVE'
                    AND (
                      r.report_kind <> 'STUDENT_GROWTH_DISCOVERY'
                      OR e.product_code = 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1'
                  )
                )
                AND (
                  r.report_kind <> 'STUDENT_GROWTH_DISCOVERY'
                  OR (
                    EXISTS (
                      SELECT 1 FROM consent_grants core_consent
                      WHERE core_consent.id = a.core_consent_grant_id
                        AND core_consent.user_id = ar.user_id
                        AND core_consent.family_id = a.family_id
                        AND core_consent.student_id = a.student_id
                        AND core_consent.subject_type = 'STUDENT'
                        AND core_consent.subject_id = a.student_id
                        AND core_consent.scope = 'CORE_ASSESSMENT'
                        AND core_consent.subject_role = 'PARENT_GUARDIAN'
                        AND core_consent.copy_version = 'guardian_core_assessment_v1.0.0-rc1'
                        AND core_consent.copy_text_hash = '334a1e8e455dfef386fcaf491acea3dac23b13c4ece010cfad66d1087f6a84a5'
                        AND core_consent.locale = 'zh-CN'
                        AND core_consent.guardian_authority_status = 'CONFIRMED'
                        AND core_consent.withdrawn_at IS NULL
                    )
                    AND EXISTS (
                      SELECT 1 FROM consent_grants assent_consent
                      WHERE assent_consent.id = a.student_assent_grant_id
                        AND assent_consent.user_id = ar.user_id
                        AND assent_consent.family_id = a.family_id
                        AND assent_consent.student_id = a.student_id
                        AND assent_consent.subject_type = 'STUDENT'
                        AND assent_consent.subject_id = a.student_id
                        AND assent_consent.scope = 'STUDENT_ASSESSMENT_ASSENT'
                        AND assent_consent.subject_role = 'STUDENT'
                        AND assent_consent.copy_version = 'student_assent_growth_discovery_v1.0.0-rc1'
                        AND assent_consent.copy_text_hash = '0ab8f89835cfe500f97944324ab58a3cf2cce27913fc5af5d02461227b2a821d'
                        AND assent_consent.locale = 'zh-CN'
                        AND assent_consent.guardian_authority_status = 'NOT_APPLICABLE'
                        AND assent_consent.withdrawn_at IS NULL
                    )
                  )
                )
              )
            )
        )
        ORDER BY ar.next_attempt_at, ar.created_at, ar.id
        FOR UPDATE OF ar SKIP LOCKED
        LIMIT $2
      )
      UPDATE agent_runs ar
      SET status = 'CANCELLED', request_envelope = NULL,
          lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
          fence_version = ar.fence_version + 1, error_code = 'AGENT_ACCESS_REVOKED',
          updated_at = $1::timestamptz, completed_at = $1::timestamptz, purged_at = $1::timestamptz
      FROM invalid
      WHERE ar.id = invalid.id
    `, [now, batchSize])
  }

  private currentContextDigest(report: Report): string {
    invariant(this.contextDigestForReport, 500, 'AGENT_CONTEXT_DIGEST_UNAVAILABLE', 'Agent 报告上下文摘要器未配置')
    const digest = this.contextDigestForReport(report)
    validateDigest(digest, '报告上下文摘要')
    return digest
  }

  private currentAssessmentContextDigest(assessment: Assessment, report: Report): string {
    invariant(this.contextDigestForAssessment, 500, 'AGENT_CONTEXT_DIGEST_UNAVAILABLE', '免费测评上下文摘要器未配置')
    const digest = this.contextDigestForAssessment(assessment, report)
    validateDigest(digest, '免费测评上下文摘要')
    return digest
  }

  private currentPaidAnalysisContextDigest(assessment: Assessment, report: Report): string {
    invariant(this.contextDigestForPaidAnalysis, 500, 'AGENT_CONTEXT_DIGEST_UNAVAILABLE', '已购报告分析上下文摘要器未配置')
    const digest = this.contextDigestForPaidAnalysis(assessment, report)
    validateDigest(digest, '已购报告分析上下文摘要')
    return digest
  }

  private async requireRunContextCurrent(
    tx: StoreTransaction,
    conversation: AgentConversation,
    report: Report,
    sourceVersion: string,
    contextDigest: string
  ): Promise<void> {
    if (conversation.purpose === 'ASSESSMENT_ANALYSIS') {
      const assessment = await this.requireFreeAssessment(tx, conversation.userId, report)
      invariant(sourceVersion === agentAssessmentVersion(assessment, report),
        409, 'AGENT_REPORT_VERSION_MISMATCH', '免费测评版本已变化')
      invariant(contextDigest === this.currentAssessmentContextDigest(assessment, report),
        409, 'AGENT_CONTEXT_VERSION_MISMATCH', '免费测评上下文已变化')
      return
    }
    if (conversation.purpose === 'REPORT_ANALYSIS') {
      const assessment = await tx.findById('assessments', report.assessmentId)
      invariant(assessment && assessment.userId === conversation.userId && assessment.reportId === report.id,
        409, 'AGENT_CONTEXT_VERSION_MISMATCH', '已购报告关联的测评快照已变化')
      invariant(sourceVersion === agentReportVersion(report), 409, 'AGENT_REPORT_VERSION_MISMATCH', '报告版本已变化')
      invariant(contextDigest === this.currentPaidAnalysisContextDigest(assessment, report),
        409, 'AGENT_CONTEXT_VERSION_MISMATCH', '已购报告分析上下文已变化')
      return
    }
    const assessment = await tx.findById('assessments', report.assessmentId)
    invariant(assessment && assessment.userId === conversation.userId && assessment.reportId === report.id,
      409, 'AGENT_CONTEXT_VERSION_MISMATCH', '报告关联的测评快照已变化')
    invariant(sourceVersion === agentReportVersion(report), 409, 'AGENT_REPORT_VERSION_MISMATCH', '报告版本已变化')
    invariant(contextDigest === this.currentPaidAnalysisContextDigest(assessment, report),
      409, 'AGENT_CONTEXT_VERSION_MISMATCH', '报告上下文已变化')
  }

  private async reservedFollowupRuns(
    tx: StoreTransaction,
    userId: string,
    reportId: string,
    runs?: AgentRun[]
  ): Promise<number> {
    const candidates = runs ?? await tx.findMany('agentRuns', { userId, reportId })
    let reserved = 0
    for (const run of candidates) {
      if (!['SUCCEEDED', 'QUEUED', 'RUNNING'].includes(run.status)) continue
      const conversation = await tx.findById('agentConversations', run.conversationId)
      if (conversation?.purpose === 'REPORT_FOLLOWUP') reserved += 1
    }
    return reserved
  }
}
