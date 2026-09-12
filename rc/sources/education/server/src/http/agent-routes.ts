import { IncomingMessage } from 'node:http'
import { AppError, invariant } from '../domain/errors'
import { AgentService, CreateAgentConversationRequest } from '../services/agent-service'

const MAX_AGENT_BODY_BYTES = 16_384
const AGENT_BODY_TIMEOUT_MS = 10_000

export interface AgentRouteResult {
  status: number
  body?: unknown
}

export type AgentHttpService = Pick<AgentService,
  | 'createConversation'
  | 'createAssessmentAnalysis'
  | 'createReportAnalysis'
  | 'sendMessage'
  | 'getRun'
  | 'getLatestAssessmentAnalysis'
  | 'getLatestReportAnalysis'
  | 'listMessages'
  | 'listConversations'
  | 'deleteConversation'
  | 'revokeConsent'
  | 'withdrawAiAnalysisConsent'
>

function exactObject(value: unknown, allowed: readonly string[], code: string): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 400, code, '请求体必须是 JSON 对象')
  const record = value as Record<string, unknown>
  invariant(Object.keys(record).every((key) => allowed.includes(key)), 400, 'AGENT_UNKNOWN_FIELD', '请求体包含未知字段')
  return record
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let timer: NodeJS.Timeout | undefined
  const reading = (async (): Promise<Buffer> => {
    const chunks: Buffer[] = []
    let total = 0
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      total += chunk.length
      invariant(total <= MAX_AGENT_BODY_BYTES, 413, 'AGENT_BODY_TOO_LARGE', 'Agent 请求体过大')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  })()
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new AppError(408, 'AGENT_BODY_TIMEOUT', 'Agent 请求体读取超时')), AGENT_BODY_TIMEOUT_MS)
  })
  try {
    const raw = await Promise.race([reading, deadline])
    invariant(raw.length > 0, 400, 'AGENT_BODY_REQUIRED', '请求体不能为空')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8')) as unknown
    } catch {
      throw new AppError(400, 'INVALID_JSON', '请求体不是有效 JSON')
    }
    invariant(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), 400, 'INVALID_JSON', 'JSON 请求体必须是对象')
    return parsed as Record<string, unknown>
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function idempotencyHeader(request: IncomingMessage): string {
  const value = request.headers['idempotency-key']
  const normalized = Array.isArray(value) ? value[0] : value
  invariant(typeof normalized === 'string' && normalized.length > 0, 400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少 Idempotency-Key')
  return normalized
}

async function consentBody(request: IncomingMessage): Promise<CreateAgentConversationRequest> {
  const body = exactObject(await readJson(request), [
    'consentVersion', 'scope', 'guardianConfirmed', 'studentConfirmed', 'locale'
  ], 'AGENT_CONSENT_INVALID')
  invariant(Object.keys(body).length >= 3, 400, 'AGENT_CONSENT_INVALID', 'Agent 专项同意字段不完整')
  return {
    consentVersion: body.consentVersion as CreateAgentConversationRequest['consentVersion'],
    scope: body.scope as CreateAgentConversationRequest['scope'],
    guardianConfirmed: body.guardianConfirmed as true,
    ...(body.studentConfirmed === undefined ? {} : { studentConfirmed: body.studentConfirmed as true }),
    ...(body.locale === undefined ? {} : { locale: body.locale as 'zh-CN' })
  }
}

function segment(value: string): string {
  try {
    const decoded = decodeURIComponent(value)
    invariant(/^[A-Za-z0-9_-]{3,128}$/.test(decoded), 400, 'AGENT_RESOURCE_ID_INVALID', '资源 ID 无效')
    return decoded
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(400, 'AGENT_RESOURCE_ID_INVALID', '资源 ID 无效')
  }
}

function requireQuery(url: URL, allowed: readonly string[]): void {
  const keys = [...url.searchParams.keys()]
  invariant(keys.every((key) => allowed.includes(key)), 400, 'AGENT_QUERY_INVALID', '查询参数无效')
  invariant(new Set(keys).size === keys.length, 400, 'AGENT_QUERY_INVALID', '查询参数不得重复')
}

export async function routeAgentRequest(input: {
  service: AgentHttpService
  userId: string
  method: string
  url: URL
  request: IncomingMessage
}): Promise<AgentRouteResult | null> {
  const { service, userId, method, url, request } = input

  const aiConsent = url.pathname.match(/^\/v1\/me\/ai-analysis-consents\/([^/]+)$/)
  if (method === 'DELETE' && aiConsent?.[1]) {
    requireQuery(url, [])
    return { status: 200, body: await service.withdrawAiAnalysisConsent(userId, segment(aiConsent[1])) }
  }

  const assessmentAnalyses = url.pathname.match(/^\/v1\/assessments\/([^/]+)\/agent-analyses(?:\/(latest))?$/)
  if (assessmentAnalyses?.[1]) {
    requireQuery(url, [])
    const assessmentId = segment(assessmentAnalyses[1])
    if (method === 'POST' && !assessmentAnalyses[2]) {
      return {
        status: 202,
        body: await service.createAssessmentAnalysis(userId, assessmentId, await consentBody(request), idempotencyHeader(request))
      }
    }
    if (method === 'GET' && assessmentAnalyses[2] === 'latest') {
      return { status: 200, body: await service.getLatestAssessmentAnalysis(userId, assessmentId) }
    }
    return null
  }

  const reportAnalyses = url.pathname.match(/^\/v1\/reports\/([^/]+)\/agent-analyses(?:\/(latest))?$/)
  if (reportAnalyses?.[1]) {
    requireQuery(url, [])
    const reportId = segment(reportAnalyses[1])
    if (method === 'POST' && !reportAnalyses[2]) {
      return {
        status: 202,
        body: await service.createReportAnalysis(userId, reportId, await consentBody(request), idempotencyHeader(request))
      }
    }
    if (method === 'GET' && reportAnalyses[2] === 'latest') {
      return { status: 200, body: await service.getLatestReportAnalysis(userId, reportId) }
    }
    return null
  }

  const reportConversations = url.pathname.match(/^\/v1\/reports\/([^/]+)\/agent-conversations$/)
  if (reportConversations?.[1]) {
    requireQuery(url, [])
    const reportId = segment(reportConversations[1])
    if (method === 'POST') {
      return {
        status: 201,
        body: await service.createConversation(userId, reportId, await consentBody(request), idempotencyHeader(request))
      }
    }
    if (method === 'GET') {
      return { status: 200, body: await service.listConversations(userId, reportId) }
    }
    return null
  }

  const conversationMessages = url.pathname.match(/^\/v1\/agent-conversations\/([^/]+)\/messages$/)
  if (conversationMessages?.[1]) {
    const conversationId = segment(conversationMessages[1])
    if (method === 'POST') {
      requireQuery(url, [])
      const body = exactObject(await readJson(request), ['message'], 'AGENT_MESSAGE_INVALID')
      invariant(Object.keys(body).length === 1, 400, 'AGENT_MESSAGE_INVALID', '消息请求体只能包含 message')
      return {
        status: 202,
        body: await service.sendMessage(userId, conversationId, body.message, idempotencyHeader(request))
      }
    }
    if (method === 'GET') {
      requireQuery(url, ['cursor', 'limit'])
      const cursor = url.searchParams.has('cursor') ? url.searchParams.get('cursor') ?? '' : undefined
      const rawLimit = url.searchParams.get('limit')
      const limit = rawLimit === null ? 20 : Number(rawLimit)
      return { status: 200, body: await service.listMessages(userId, conversationId, cursor, limit) }
    }
    return null
  }

  const run = url.pathname.match(/^\/v1\/agent-runs\/([^/]+)$/)
  if (method === 'GET' && run?.[1]) {
    requireQuery(url, [])
    return { status: 200, body: await service.getRun(userId, segment(run[1])) }
  }

  const analysisRun = url.pathname.match(/^\/v1\/agent-analyses\/([^/]+)$/)
  if (method === 'GET' && analysisRun?.[1]) {
    requireQuery(url, [])
    return { status: 200, body: await service.getRun(userId, segment(analysisRun[1])) }
  }

  const revokeConsent = url.pathname.match(/^\/v1\/agent-conversations\/([^/]+)\/consent$/)
  if (method === 'DELETE' && revokeConsent?.[1]) {
    requireQuery(url, [])
    await service.revokeConsent(userId, segment(revokeConsent[1]))
    return { status: 204 }
  }

  const conversation = url.pathname.match(/^\/v1\/agent-conversations\/([^/]+)$/)
  if (method === 'DELETE' && conversation?.[1]) {
    requireQuery(url, [])
    await service.deleteConversation(userId, segment(conversation[1]))
    return { status: 204 }
  }

  return null
}
