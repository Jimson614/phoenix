const api = require('./api')

const CONSENT_VERSION = 'agent_analysis_opt_in_v1.0.0-rc1'
const CONSENT_SCOPE = 'AI_ANALYSIS'
const DEFAULT_MAX_MESSAGE_CHARS = 2000
const DEFAULT_MAX_REPLIES = 3
const TERMINAL_RUN_STATUSES = ['SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED']

function unwrap(result, keys = []) {
  let value = result && result.data ? result.data : result
  for (const key of keys) {
    if (value && value[key] !== undefined) return value[key]
  }
  return value
}

function randomPart() {
  try {
    if (wx.getRandomValues) {
      const bytes = new Uint8Array(12)
      wx.getRandomValues(bytes)
      return Array.prototype.map.call(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
    }
  } catch (error) {}
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`
}

function createIdempotencyKey(purpose = 'agent') {
  const safePurpose = String(purpose).replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'agent'
  return `pfs_${safePurpose}_${randomPart()}`.slice(0, 96)
}

function normalizeSource(source, index) {
  if (typeof source === 'string') return { alias: `S${index + 1}`, name: source, detail: '' }
  const value = source || {}
  const alias = value.alias || value.sourceAlias || value.sourceId || `S${index + 1}`
  const name = value.name || value.title || value.publisher || alias
  const detail = [
    value.applicableYear ? `适用 ${value.applicableYear}` : '',
    value.dataVersion || value.version || '',
    value.dataAsOf || value.verifiedAt ? `核验 ${value.dataAsOf || value.verifiedAt}` : ''
  ].filter(Boolean).join(' · ')
  return { alias, name, detail }
}

function normalizeReply(value) {
  if (!value) return null
  const reply = value.reply || value.result || value.output || value
  if (typeof reply === 'string') {
    return {
      answer: reply, keyPoints: [], nextSteps: [], limitations: ['仅解释当前报告，不保证录取或升学结果。'],
      sources: [], safety: { level: 'STANDARD', requiresGuardianAttention: false }
    }
  }
  if (!reply || typeof reply !== 'object') return null
  const sources = reply.sources || reply.sourceReferences || reply.trustedSources || []
  return {
    answer: typeof reply.answer === 'string' ? reply.answer : '',
    keyPoints: Array.isArray(reply.keyPoints) ? reply.keyPoints : [],
    nextSteps: Array.isArray(reply.nextSteps) ? reply.nextSteps : [],
    limitations: Array.isArray(reply.limitations) ? reply.limitations : [],
    sources: Array.isArray(sources) ? sources.map(normalizeSource) : [],
    safety: reply.safety || { level: 'STANDARD', requiresGuardianAttention: false }
  }
}

function normalizeConversation(result) {
  const conversation = unwrap(result, ['conversation']) || {}
  const limits = conversation.limits || {}
  return {
    ...conversation,
    conversationId: conversation.conversationId || conversation.id || '',
    reportId: conversation.reportId || conversation.report_id || '',
    consentStatus: conversation.consentStatus || conversation.consent_status || '',
    maxMessageChars: Number(limits.maxMessageChars || conversation.maxMessageChars || DEFAULT_MAX_MESSAGE_CHARS),
    maxRepliesPerReport: Number(limits.maxRepliesPerReport || limits.maxTurns || conversation.maxRepliesPerReport || DEFAULT_MAX_REPLIES),
    remainingReplies: Number(conversation.remainingReplies === undefined
      ? (limits.remainingReplies === undefined ? DEFAULT_MAX_REPLIES : limits.remainingReplies)
      : conversation.remainingReplies)
  }
}

function normalizeRun(result) {
  const run = unwrap(result, ['run']) || {}
  const error = run.error && typeof run.error === 'object' ? run.error : {}
  const status = String(run.status || 'QUEUED').toUpperCase()
  const reply = normalizeReply(run.reply || run.result || run.output)
  return {
    ...run,
    runId: run.runId || run.id || '',
    conversationId: run.conversationId || run.conversation_id || '',
    status,
    retryAfterMs: Math.max(250, Math.min(Number(run.retryAfterMs || run.retry_after_ms || 1000), 5000)),
    code: run.code || run.errorCode || run.error_code || error.code || null,
    message: run.message || run.safeMessage || run.userMessage || error.message || (reply && reply.answer) || '',
    reply,
    remainingReplies: run.remainingReplies === undefined ? null : Number(run.remainingReplies)
  }
}

function normalizeMessage(message, index) {
  const role = String(message.role || '').toUpperCase()
  const reply = role === 'ASSISTANT' ? normalizeReply(message.reply || message.content || message) : null
  return {
    id: message.messageId || message.id || `message_${index}`,
    role,
    content: role === 'USER' && typeof message.content === 'string' ? message.content : '',
    reply,
    safetyState: message.safetyState || message.safety_state || 'ALLOWED',
    createdAt: message.createdAt || message.created_at || ''
  }
}

async function createConversation(reportId, idempotencyKey) {
  const result = await api.request(`/v1/reports/${encodeURIComponent(reportId)}/agent-conversations`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    data: consentPayload()
  })
  return normalizeConversation(result)
}

function consentPayload() {
  return {
    consentVersion: CONSENT_VERSION,
    scope: CONSENT_SCOPE,
    locale: 'zh-CN',
    studentConfirmed: true,
    guardianConfirmed: true
  }
}

async function listConversations(reportId) {
  const result = await api.request(`/v1/reports/${encodeURIComponent(reportId)}/agent-conversations`)
  const payload = unwrap(result) || {}
  const conversations = Array.isArray(payload) ? payload : (payload.conversations || [])
  return conversations.map(normalizeConversation)
}

async function sendMessage(conversationId, message, idempotencyKey) {
  const value = String(message || '').trim()
  if (!value) throw new api.ApiError('请输入需要解读的问题', { code: 'AGENT_MESSAGE_REQUIRED' })
  if (value.length > DEFAULT_MAX_MESSAGE_CHARS) {
    throw new api.ApiError(`问题不能超过 ${DEFAULT_MAX_MESSAGE_CHARS} 个字符`, { code: 'AGENT_MESSAGE_TOO_LONG' })
  }
  const result = await api.request(`/v1/agent-conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, data: { message: value }
  })
  return normalizeRun(result)
}

async function getRun(runId) {
  return normalizeRun(await api.request(`/v1/agent-runs/${encodeURIComponent(runId)}`))
}

async function listMessages(conversationId, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 20), 50))
  const cursor = options.cursor ? `&cursor=${encodeURIComponent(options.cursor)}` : ''
  const result = await api.request(`/v1/agent-conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}${cursor}`)
  const payload = unwrap(result) || {}
  const messages = Array.isArray(payload) ? payload : (payload.messages || [])
  return {
    messages: messages.map(normalizeMessage),
    nextCursor: payload.nextCursor || payload.next_cursor || null
  }
}

async function deleteConversation(conversationId) {
  await api.request(`/v1/agent-conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' })
}

async function withdrawConsent(conversationId) {
  await api.request(`/v1/agent-conversations/${encodeURIComponent(conversationId)}/consent`, { method: 'DELETE' })
}

async function withdrawStudentConsent(studentId) {
  return api.request(`/v1/me/ai-analysis-consents/${encodeURIComponent(studentId)}`, { method: 'DELETE' })
}

module.exports = {
  CONSENT_SCOPE,
  CONSENT_VERSION,
  DEFAULT_MAX_MESSAGE_CHARS,
  DEFAULT_MAX_REPLIES,
  TERMINAL_RUN_STATUSES,
  createConversation,
  consentPayload,
  createIdempotencyKey,
  deleteConversation,
  getRun,
  listConversations,
  listMessages,
  normalizeConversation,
  normalizeReply,
  normalizeRun,
  sendMessage,
  withdrawConsent,
  withdrawStudentConsent
}
