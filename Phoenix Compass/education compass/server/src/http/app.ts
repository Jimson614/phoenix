import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { AppError, errorEnvelope, invariant } from '../domain/errors'
import { AuthService } from '../services/auth-service'
import { AssessmentService, CreateAssessmentInput } from '../services/assessment-service'
import { OrderService } from '../services/order-service'
import { FamilyInput, ProfileService, StudentInput } from '../services/profile-service'
import { ReportService } from '../services/report-service'
import { AgentService } from '../services/agent-service'
import { EducationCompassService } from '../services/education-compass-service'
import { FeishuSyncService } from '../integrations/feishu/sync-service'
import { routeAgentRequest } from './agent-routes'
import { InMemoryRateLimiter, RateLimiter } from './rate-limiter'

export interface AppDependencies {
  auth: AuthService
  profiles: ProfileService
  assessments: AssessmentService
  orders: OrderService
  reports: ReportService
  education?: EducationCompassService
  agent?: AgentService
  feishu?: FeishuSyncService
  rateLimiter?: RateLimiter
  readiness?: () => Promise<void>
  logger?: { error(message: string, context?: Record<string, unknown>): void }
}

const MAX_BODY_BYTES = 1_100_000
const MAX_WEBHOOK_BODY_BYTES = 128_000
const BODY_TIMEOUT_MS = 10_000
const WEBHOOK_BODY_TIMEOUT_MS = 5_000

function securityHeaders(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('Cache-Control', 'private, no-store')
}

function json(response: ServerResponse, status: number, body?: unknown): void {
  securityHeaders(response)
  response.statusCode = status
  if (body === undefined) {
    response.end()
    return
  }
  const raw = Buffer.from(JSON.stringify(body), 'utf8')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', raw.length)
  response.end(raw)
}

async function readRawBody(
  request: IncomingMessage,
  maxBytes = MAX_BODY_BYTES,
  timeoutMs = BODY_TIMEOUT_MS
): Promise<Buffer> {
  let timer: NodeJS.Timeout | undefined
  const read = (async (): Promise<Buffer> => {
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.length
      if (total > maxBytes) {
        request.destroy()
        throw new AppError(413, 'BODY_TOO_LARGE', '请求内容过大')
      }
      chunks.push(buffer)
    }
    return Buffer.concat(chunks)
  })()
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      request.destroy()
      reject(new AppError(408, 'BODY_READ_TIMEOUT', '请求内容读取超时'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([read, deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function parseJson(raw: Buffer): Record<string, unknown> {
  if (!raw.length) return {}
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as unknown
    invariant(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), 400, 'INVALID_JSON', 'JSON 请求体必须是对象')
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(400, 'INVALID_JSON', '请求体不是有效 JSON')
  }
}

function authToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization ?? ''
  if (!authorization.startsWith('Bearer ')) {
    throw new AppError(401, 'AUTH_REQUIRED', '请先登录')
  }
  return authorization.slice('Bearer '.length)
}

function idempotencyHeader(request: IncomingMessage): string {
  const raw = request.headers['idempotency-key']
  const value = Array.isArray(raw) ? raw[0] : raw
  invariant(typeof value === 'string', 400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少 Idempotency-Key 请求头')
  return value
}

function exactBody(body: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key))
  invariant(unknown.length === 0, 400, 'UNKNOWN_REQUEST_FIELDS', '请求体包含未知字段', { fields: unknown })
  return body
}

function exactQuery(url: URL, allowed: readonly string[] = []): void {
  const keys = [...url.searchParams.keys()]
  invariant(keys.every((key) => allowed.includes(key)) && new Set(keys).size === keys.length,
    400, 'QUERY_INVALID', '查询参数无效')
}

function pathSegment(value: string, label = '资源 ID'): string {
  try {
    const decoded = decodeURIComponent(value)
    invariant(decoded.length > 0 && decoded.length <= 128 && !/[\u0000-\u001f\u007f/\\]/.test(decoded),
      400, 'PATH_PARAMETER_INVALID', `${label} 无效`)
    return decoded
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(400, 'PATH_PARAMETER_INVALID', `${label} 无效`)
  }
}

function normalizedPeerAddress(request: IncomingMessage): string {
  const raw = request.socket.remoteAddress ?? 'unknown'
  return raw.startsWith('::ffff:') ? raw.slice('::ffff:'.length) : raw
}

function clientAddress(request: IncomingMessage): string {
  const peer = normalizedPeerAddress(request)
  const trustedLocalProxy = peer === '127.0.0.1' || peer === '::1'
  if (!trustedLocalProxy) return peer
  const forwarded = request.headers['x-forwarded-for']
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded
  const chain = typeof forwardedValue === 'string'
    ? forwardedValue.split(',').map((item) => item.trim()).filter(Boolean)
    : []
  const candidate = chain.at(-1) ?? (Array.isArray(request.headers['x-real-ip'])
    ? request.headers['x-real-ip'][0]
    : request.headers['x-real-ip'])
  return typeof candidate === 'string' && isIP(candidate) > 0 ? candidate : peer
}

function headerBag(request: IncomingMessage): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.join(',') : value
  ]))
}

function validateWebhookIngress(request: IncomingMessage): Record<string, string | undefined> {
  const headers = headerBag(request)
  const required: Array<[string, number]> = [
    ['wechatpay-timestamp', 32], ['wechatpay-nonce', 256],
    ['wechatpay-serial', 256], ['wechatpay-signature', 1024]
  ]
  for (const [name, maxLength] of required) {
    const value = headers[name] ?? ''
    invariant(value.length > 0 && value.length <= maxLength, 401, 'WECHATPAY_HEADER_INVALID', `微信支付回调头 ${name} 无效`)
  }
  const timestamp = Number(headers['wechatpay-timestamp'])
  const skewSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp)
  invariant(Number.isInteger(timestamp) && skewSeconds <= 300, 401, 'WECHATPAY_TIMESTAMP_INVALID', '微信支付回调时间戳无效')
  const contentLengthRaw = headers['content-length']
  if (contentLengthRaw !== undefined) {
    const contentLength = Number(contentLengthRaw)
    invariant(Number.isInteger(contentLength) && contentLength >= 0 && contentLength <= MAX_WEBHOOK_BODY_BYTES, 413, 'BODY_TOO_LARGE', '微信支付回调内容过大')
  }
  return headers
}

export function createHttpHandler(deps: AppDependencies): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const logger = deps.logger ?? console
  const rateLimiter = deps.rateLimiter ?? new InMemoryRateLimiter()
  let activeWebhooks = 0
  return async (request, response) => {
    const method = request.method ?? 'GET'
    let route = '/'
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      route = url.pathname
      if (method === 'GET' && url.pathname === '/health') {
        exactQuery(url)
        try {
          await deps.readiness?.()
        } catch {
          throw new AppError(503, 'SERVICE_NOT_READY', '服务暂未就绪')
        }
        return json(response, 200, { ok: true })
      }

      if (method === 'POST' && url.pathname === '/v1/auth/wechat/session') {
        exactQuery(url)
        invariant(await rateLimiter.consume(`auth:${clientAddress(request)}`, 10, 60_000), 429, 'RATE_LIMITED', '请求过于频繁，请稍后重试')
        const body = exactBody(parseJson(await readRawBody(request)), ['code'])
        invariant(typeof body.code === 'string', 400, 'INVALID_WECHAT_CODE', '微信登录 code 无效')
        return json(response, 200, await deps.auth.createWechatSession(body.code))
      }
      if (method === 'DELETE' && url.pathname === '/v1/auth/session') {
        exactQuery(url)
        invariant(await rateLimiter.consume(`auth-revoke:${clientAddress(request)}`, 30, 60_000), 429, 'RATE_LIMITED', '请求过于频繁，请稍后重试')
        await deps.auth.revokeSession(authToken(request))
        return json(response, 204)
      }

      if (method === 'POST' && url.pathname === '/v1/webhooks/wechat-pay/transactions') {
        exactQuery(url)
        const headers = validateWebhookIngress(request)
        invariant(await rateLimiter.consume(`webhook:${clientAddress(request)}`, 300, 60_000), 429, 'RATE_LIMITED', '回调请求过于频繁')
        invariant(activeWebhooks < 50, 429, 'WEBHOOK_BUSY', '回调处理繁忙')
        activeWebhooks += 1
        try { await deps.orders.handleTransactionNotification(headers, await readRawBody(request, MAX_WEBHOOK_BODY_BYTES, WEBHOOK_BODY_TIMEOUT_MS)) } finally { activeWebhooks -= 1 }
        return json(response, 204)
      }
      if (method === 'POST' && url.pathname === '/v1/webhooks/wechat-pay/refunds') {
        exactQuery(url)
        const headers = validateWebhookIngress(request)
        invariant(await rateLimiter.consume(`webhook:${clientAddress(request)}`, 300, 60_000), 429, 'RATE_LIMITED', '回调请求过于频繁')
        invariant(activeWebhooks < 50, 429, 'WEBHOOK_BUSY', '回调处理繁忙')
        activeWebhooks += 1
        try { await deps.orders.handleRefundNotification(headers, await readRawBody(request, MAX_WEBHOOK_BODY_BYTES, WEBHOOK_BODY_TIMEOUT_MS)) } finally { activeWebhooks -= 1 }
        return json(response, 204)
      }

      const token = authToken(request)
      const user = await deps.auth.authenticate(token)
      if (method !== 'GET') {
        const normalizedRoute = url.pathname.replace(/\/[A-Za-z0-9_-]{8,}/g, '/:id')
        invariant(await rateLimiter.consume(`write:${user.id}:${normalizedRoute}`, 30, 60_000), 429, 'RATE_LIMITED', '操作过于频繁，请稍后重试')
      }

      if (/\/(?:agent-conversations|agent-runs|agent-analyses|ai-analysis-consents)(?:\/|$)/.test(url.pathname)) {
        invariant(deps.agent, 503, 'AGENT_DISABLED', 'AI 解读功能尚未配置')
        const routed = await routeAgentRequest({ service: deps.agent, userId: user.id, method, url, request })
        if (routed) return json(response, routed.status, routed.body)
      }

      if (url.pathname === '/v1/admin/integrations/feishu/status' && method === 'GET') {
        exactQuery(url)
        invariant(user.role === 'admin', 403, 'ADMIN_REQUIRED', '仅管理员可查看飞书同步状态')
        invariant(deps.feishu, 503, 'FEISHU_INTEGRATION_UNAVAILABLE', '飞书同步服务未配置')
        return json(response, 200, await deps.feishu.status())
      }
      if (url.pathname === '/v1/admin/integrations/feishu/reconcile' && method === 'POST') {
        exactQuery(url)
        invariant(user.role === 'admin', 403, 'ADMIN_REQUIRED', '仅管理员可触发飞书同步')
        invariant(deps.feishu, 503, 'FEISHU_INTEGRATION_UNAVAILABLE', '飞书同步服务未配置')
        const body = exactBody(parseJson(await readRawBody(request)), ['limit'])
        const limit = body.limit === undefined ? undefined : Number(body.limit)
        return json(response, 202, await deps.feishu.manualReconcile(user.id, limit))
      }
      if (url.pathname === '/v1/admin/integrations/feishu/validate-schema' && method === 'POST') {
        exactQuery(url)
        invariant(user.role === 'admin', 403, 'ADMIN_REQUIRED', '仅管理员可校验飞书字段合同')
        invariant(deps.feishu, 503, 'FEISHU_INTEGRATION_UNAVAILABLE', '飞书同步服务未配置')
        exactBody(parseJson(await readRawBody(request)), [])
        return json(response, 200, await deps.feishu.validateSchema())
      }

      if (url.pathname === '/v1/me/family') {
        exactQuery(url)
        if (method === 'GET') return json(response, 200, { family: await deps.profiles.getFamily(user.id) })
        if (method === 'PUT') {
          const body = exactBody(parseJson(await readRawBody(request)), [
            'familyName', 'parentName', 'phone', 'location', 'goal'
          ]) as unknown as FamilyInput
          return json(response, 200, { family: await deps.profiles.upsertFamily(user.id, body) })
        }
      }

      if (url.pathname === '/v1/me/students') {
        exactQuery(url)
        if (method === 'GET') return json(response, 200, { students: await deps.profiles.listStudents(user.id) })
        if (method === 'POST') {
          const body = exactBody(parseJson(await readRawBody(request)), [
            'name', 'age', 'gender', 'school', 'educationSystem', 'grade', 'interest', 'goal'
          ]) as unknown as StudentInput
          return json(response, 201, { student: await deps.profiles.createStudent(user.id, body) })
        }
      }

      const ownStudent = url.pathname.match(/^\/v1\/me\/students\/([^/]+)$/)
      if (ownStudent?.[1]) {
        exactQuery(url)
        const studentId = pathSegment(ownStudent[1], '学生 ID')
        if (method === 'GET') return json(response, 200, { student: await deps.profiles.getStudent(user.id, studentId) })
        if (method === 'PUT') {
          const body = exactBody(parseJson(await readRawBody(request)), [
            'name', 'age', 'gender', 'school', 'educationSystem', 'grade', 'interest', 'goal'
          ]) as unknown as StudentInput
          return json(response, 200, { student: await deps.profiles.updateStudent(user.id, studentId, body) })
        }
      }

      if (method === 'GET' && url.pathname === '/v1/me/reports') {
        exactQuery(url)
        return json(response, 200, { reports: await deps.profiles.listReports(user.id) })
      }
      if (method === 'GET' && url.pathname === '/v1/me/timeline') {
        exactQuery(url)
        return json(response, 200, { events: await deps.profiles.timeline(user.id) })
      }
      if (method === 'GET' && url.pathname === '/v1/me/advisor-requests') {
        exactQuery(url)
        return json(response, 200, { requests: await deps.profiles.listAdvisorRequests(user.id) })
      }
      if (method === 'POST' && url.pathname === '/v1/advisor-requests') {
        exactQuery(url)
        const body = exactBody(parseJson(await readRawBody(request)), [
          'preferredTime', 'topic', 'note', 'reportId', 'studentId', 'intent', 'consent'
        ])
        const consent = exactBody(
          body.consent && typeof body.consent === 'object' && !Array.isArray(body.consent)
            ? body.consent as Record<string, unknown>
            : {},
          ['scope', 'copyVersion', 'locale', 'guardianAuthorityConfirmed']
        )
        const advisorRequest = await deps.profiles.createAdvisorRequest(user.id, {
          preferredTime: String(body.preferredTime ?? ''), topic: String(body.topic ?? ''),
          ...(typeof body.note === 'string' ? { note: body.note } : {}),
          ...(typeof body.reportId === 'string' ? { reportId: body.reportId } : {}),
          ...(typeof body.studentId === 'string' ? { studentId: body.studentId } : {}),
          ...(body.intent !== undefined ? { intent: body.intent } : {}),
          consent: {
            scope: consent.scope as 'ADVISOR_CONTACT',
            copyVersion: consent.copyVersion as 'advisor_contact_opt_in_v1.0.0-rc1',
            locale: consent.locale as 'zh-CN',
            guardianAuthorityConfirmed: consent.guardianAuthorityConfirmed as true
          }
        })
        return json(response, 201, { request: advisorRequest })
      }

      if (method === 'GET' && url.pathname === '/v1/me/education-compass/state') {
        exactQuery(url)
        invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
        return json(response, 200, await deps.education.state(user.id))
      }
      const questionnaireVersion = url.pathname.match(/^\/v1\/education-compass\/questionnaires\/([^/]+)$/)
      if (method === 'GET' && questionnaireVersion?.[1]) {
        invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
        exactQuery(url, ['educationSystem'])
        const bank = deps.education.questionnaireByVersion(
          pathSegment(questionnaireVersion[1], '问卷版本'),
          url.searchParams.get('educationSystem') ?? undefined
        )
        return json(response, 200, { questionnaire: bank })
      }
      if (method === 'GET' && url.pathname === '/v1/education-compass/products/growth-discovery') {
        exactQuery(url)
        invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
        return json(response, 200, { product: await deps.education.product() })
      }
      if (method === 'POST' && url.pathname === '/v1/education-compass/free-parent-assessments') {
        exactQuery(url)
        invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
        const body = parseJson(await readRawBody(request))
        const assessment = await deps.education.createFreeParent(user.id, body, idempotencyHeader(request))
        return json(response, 201, {
          assessmentId: assessment.id,
          assessmentKind: assessment.assessmentKind,
          status: assessment.status,
          questionnaireVersion: assessment.questionnaireVersion,
          schemaDigest: assessment.schemaDigest,
          revision: assessment.draftRevision
        })
      }
      if (method === 'PUT' && url.pathname === '/v1/me/integration-consents/feishu-profile') {
        exactQuery(url)
        invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
        return json(response, 200, await deps.education.setFeishuProfileConsent(user.id, parseJson(await readRawBody(request))))
      }
      if (method === 'PUT' && url.pathname === '/v1/me/integration-consents/advisor-contact') {
        exactQuery(url)
        const body = exactBody(parseJson(await readRawBody(request)), [
          'studentId', 'enabled', 'copyVersion', 'locale', 'guardianAuthorityConfirmed'
        ])
        return json(response, 200, await deps.profiles.setAdvisorContactConsent(user.id, {
          ...(typeof body.studentId === 'string' ? { studentId: body.studentId } : {}),
          enabled: body.enabled as boolean,
          copyVersion: String(body.copyVersion ?? ''),
          locale: String(body.locale ?? ''),
          guardianAuthorityConfirmed: body.guardianAuthorityConfirmed === true
        }))
      }
      const educationConsent = url.pathname.match(
        /^\/v1\/me\/education-compass\/consents\/([^/]+)\/(CORE_ASSESSMENT|STUDENT_ASSESSMENT_ASSENT)$/
      )
      if (method === 'DELETE' && educationConsent?.[1] && educationConsent[2]) {
        invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
        invariant([...url.searchParams.keys()].length === 0, 400, 'CONSENT_QUERY_INVALID', '撤回同意不接受查询参数')
        return json(response, 200, await deps.education.withdrawAssessmentConsent(
          user.id,
          pathSegment(educationConsent[1], '学生 ID'),
          educationConsent[2] as 'CORE_ASSESSMENT' | 'STUDENT_ASSESSMENT_ASSENT'
        ))
      }

      const createAssessment = url.pathname.match(/^\/v1\/students\/([^/]+)\/education-assessments$/)
      if (method === 'POST' && createAssessment?.[1]) {
        exactQuery(url)
        const rawBody = parseJson(await readRawBody(request))
        if (rawBody.assessmentKind === 'STUDENT_GROWTH_DISCOVERY') {
          invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
          const assessment = await deps.education.createGrowthDiscovery(
            user.id, pathSegment(createAssessment[1], '学生 ID'), rawBody, idempotencyHeader(request)
          )
          return json(response, 201, {
            assessmentId: assessment.id,
            assessmentKind: assessment.assessmentKind,
            status: assessment.status,
            questionnaireVersion: assessment.questionnaireVersion,
            schemaDigest: assessment.schemaDigest,
            revision: assessment.draftRevision
          })
        }
        const body = exactBody(rawBody, ['familyId', 'questionnaireVersion', 'studentVersion', 'consent'])
        const consent = exactBody(
          body.consent && typeof body.consent === 'object' && !Array.isArray(body.consent)
            ? body.consent as Record<string, unknown>
            : {},
          ['consentVersion', 'scope', 'guardianConfirmed']
        )
        const assessment = await deps.assessments.create(user.id, pathSegment(createAssessment[1], '学生 ID'), {
          ...body,
          consent
        } as unknown as CreateAssessmentInput)
        return json(response, 201, {
          assessmentId: assessment.id,
          status: assessment.status,
          questionnaireVersion: assessment.questionnaireVersion
        })
      }

      const assessmentQuestionnaire = url.pathname.match(/^\/v1\/assessments\/([^/]+)\/questionnaire$/)
      if (method === 'GET' && assessmentQuestionnaire?.[1]) {
        exactQuery(url)
        invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
        return json(response, 200, {
          questionnaire: await deps.education.questionnaire(user.id, pathSegment(assessmentQuestionnaire[1], '测评 ID'))
        })
      }
      const assessmentResult = url.pathname.match(/^\/v1\/assessments\/([^/]+)\/result$/)
      if (method === 'GET' && assessmentResult?.[1]) {
        exactQuery(url)
        invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
        return json(response, 200, await deps.education.result(user.id, pathSegment(assessmentResult[1], '测评 ID')))
      }

      const assessmentAction = url.pathname.match(/^\/v1\/assessments\/([^/]+)\/(draft|submit|preview|orders)$/)
      if (assessmentAction?.[1] && assessmentAction[2]) {
        exactQuery(url)
        const assessmentId = pathSegment(assessmentAction[1], '测评 ID')
        const v05 = deps.education ? await deps.education.usesV05Contract(user.id, assessmentId) : false
        if (method === 'GET' && assessmentAction[2] === 'draft') {
          if (v05) return json(response, 200, await deps.education!.getDraft(user.id, assessmentId))
          return json(response, 200, await deps.assessments.getDraft(user.id, assessmentId))
        }
        if (method === 'PUT' && assessmentAction[2] === 'draft') {
          const body = parseJson(await readRawBody(request))
          if (v05) return json(response, 200, await deps.education!.saveDraft(user.id, assessmentId, body))
          exactBody(body, ['answers'])
          const assessment = await deps.assessments.saveDraft(user.id, assessmentId, body.answers)
          return json(response, 200, {
            assessmentId: assessment.id,
            status: assessment.status,
            completenessScore: assessment.completenessScore,
            missingFields: assessment.missingFields
          })
        }
        if (method === 'POST' && assessmentAction[2] === 'submit') {
          const body = parseJson(await readRawBody(request))
          if (v05) return json(response, 200, await deps.education!.submit(user.id, assessmentId, body, idempotencyHeader(request)))
          exactBody(body, [])
          return json(response, 200, await deps.assessments.submit(user.id, assessmentId))
        }
        if (method === 'GET' && assessmentAction[2] === 'preview') {
          return json(response, 200, await deps.assessments.preview(user.id, assessmentId))
        }
        if (method === 'POST' && assessmentAction[2] === 'orders') {
          const body = parseJson(await readRawBody(request))
          if (v05) {
            exactBody(body, ['productCode'])
            return json(response, 201, await deps.orders.createOrder(user.id, assessmentId, {
              productCode: String(body.productCode ?? ''), idempotencyKey: idempotencyHeader(request)
            }))
          }
          exactBody(body, ['productCode', 'idempotencyKey'])
          return json(response, 201, await deps.orders.createOrder(user.id, assessmentId, {
            productCode: String(body.productCode ?? ''),
            idempotencyKey: String(body.idempotencyKey ?? '')
          }))
        }
      }

      const prepay = url.pathname.match(/^\/v1\/orders\/([^/]+)\/wechat-prepay$/)
      if (method === 'POST' && prepay?.[1]) {
        exactQuery(url)
        exactBody(parseJson(await readRawBody(request)), [])
        return json(response, 200, await deps.orders.createWechatPrepay(user.id, pathSegment(prepay[1], '订单 ID')))
      }
      const order = url.pathname.match(/^\/v1\/orders\/([^/]+)$/)
      if (method === 'GET' && order?.[1]) {
        exactQuery(url)
        return json(response, 200, await deps.orders.getOrder(user.id, pathSegment(order[1], '订单 ID')))
      }

      const adminRefund = url.pathname.match(/^\/v1\/admin\/orders\/([^/]+)\/refunds$/)
      if (method === 'POST' && adminRefund?.[1]) {
        exactQuery(url)
        const body = exactBody(parseJson(await readRawBody(request)), ['idempotencyKey', 'reason'])
        const headerValue = request.headers['idempotency-key']
        const idempotencyKey = Array.isArray(headerValue) ? headerValue[0] : headerValue
        const refund = await deps.orders.requestRefund(user.id, pathSegment(adminRefund[1], '订单 ID'), {
          idempotencyKey: idempotencyKey ?? String(body.idempotencyKey ?? ''),
          reason: String(body.reason ?? '')
        })
        return json(response, 202, { refund })
      }

      const reportPdf = url.pathname.match(/^\/v1\/reports\/([^/]+)\/pdf$/)
      if (method === 'GET' && reportPdf?.[1]) {
        exactQuery(url)
        const reportId = pathSegment(reportPdf[1], '报告 ID')
        const pdf = await deps.reports.pdf(user.id, reportId)
        securityHeaders(response)
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/pdf')
        response.setHeader('Content-Disposition', `attachment; filename="phoenix-compass-report-${reportId}.pdf"`)
        response.setHeader('Content-Length', pdf.length)
        response.end(pdf)
        return
      }
      const reportFeedback = url.pathname.match(/^\/v1\/reports\/([^/]+)\/feedback$/)
      if (method === 'POST' && reportFeedback?.[1]) {
        exactQuery(url)
        const body = exactBody(parseJson(await readRawBody(request)), [
          'rating', 'tags', 'comment', 'advisorContactRequested'
        ])
        const feedback = await deps.reports.submitFeedback(user.id, pathSegment(reportFeedback[1], '报告 ID'), {
          rating: Number(body.rating), tags: body.tags, comment: body.comment,
          advisorContactRequested: body.advisorContactRequested
        })
        return json(response, 201, { feedbackId: feedback.id, createdAt: feedback.createdAt })
      }
      const report = url.pathname.match(/^\/v1\/reports\/([^/]+)$/)
      if (method === 'GET' && report?.[1]) {
        exactQuery(url)
        const reportId = pathSegment(report[1], '报告 ID')
        const value = await deps.reports.get(user.id, reportId)
        const agentFollowup = deps.agent
          ? await deps.agent.capability(user.id, reportId)
          : {
              available: false,
              reasonCode: 'AGENT_DISABLED',
              maxRepliesPerReport: 3,
              remainingReplies: 0,
              activeConversationId: null,
              consentStatus: 'NOT_GRANTED',
              hasConversations: false,
              conversationCount: 0,
              managementAvailable: false
            }
        return json(response, 200, {
          ...value,
          capabilities: { ...value.capabilities, agentFollowup }
        })
      }

      throw new AppError(404, 'ROUTE_NOT_FOUND', '接口不存在')
    } catch (error) {
      const envelope = errorEnvelope(error)
      const code = ((envelope.body.error as Record<string, unknown>)?.code ?? 'UNKNOWN') as string
      if (envelope.status >= 500) logger.error('request_failed', { method, route, code })
      json(response, envelope.status, envelope.body)
    }
  }
}

export function createAppServer(deps: AppDependencies): Server {
  const handler = createHttpHandler(deps)
  const server = createServer((request, response) => { void handler(request, response) })
  server.requestTimeout = 10_000
  server.headersTimeout = 5_000
  server.keepAliveTimeout = 5_000
  server.timeout = 15_000
  return server
}
