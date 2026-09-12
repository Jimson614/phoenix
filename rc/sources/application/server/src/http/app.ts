import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
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
import { MastersHttp } from '../masters/http'
import { workbenchHtml, workbenchCss, workbenchJs } from '../masters/workbench'

export interface AppDependencies {
  auth: AuthService
  profiles: ProfileService
  assessments: AssessmentService
  orders: OrderService
  reports: ReportService
  education?: EducationCompassService
  masters?: MastersHttp
  agent?: AgentService
  feishu?: FeishuSyncService
  rateLimiter?: RateLimiter
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
  invariant(authorization.startsWith('Bearer '), 401, 'AUTH_REQUIRED', '请先登录')
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
    const url = new URL(request.url ?? '/', 'http://localhost')
    const method = request.method ?? 'GET'
    const mastersRequest = url.pathname.startsWith('/v1/masters/') || url.pathname.startsWith('/v1/internal/masters')
    const requestId = randomUUID()
    if (mastersRequest) response.setHeader('X-Request-ID', requestId)
    try {
      if (method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true })

      if (method === 'GET' && ['/internal/masters', '/internal/masters/app.js', '/internal/masters/style.css'].includes(url.pathname)) {
        invariant(deps.masters, 404, 'ROUTE_NOT_FOUND', '接口不存在')
        securityHeaders(response)
        response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
        const js = url.pathname.endsWith('.js'), css = url.pathname.endsWith('.css')
        response.setHeader('Content-Type', js ? 'application/javascript; charset=utf-8' : css ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8')
        response.end(js ? workbenchJs : css ? workbenchCss : workbenchHtml)
        return
      }

      if (method === 'POST' && url.pathname === '/v1/auth/wechat/session') {
        invariant(await rateLimiter.consume(`auth:${request.socket.remoteAddress ?? 'unknown'}`, 10, 60_000), 429, 'RATE_LIMITED', '请求过于频繁，请稍后重试')
        const body = parseJson(await readRawBody(request))
        return json(response, 200, await deps.auth.createWechatSession(String(body.code ?? '')))
      }
      if (method === 'DELETE' && url.pathname === '/v1/auth/session') {
        invariant(await rateLimiter.consume(`auth-revoke:${request.socket.remoteAddress ?? 'unknown'}`, 30, 60_000), 429, 'RATE_LIMITED', '请求过于频繁，请稍后重试')
        await deps.auth.revokeSession(authToken(request))
        return json(response, 204)
      }

      if (method === 'POST' && url.pathname === '/v1/webhooks/wechat-pay/transactions') {
        const headers = validateWebhookIngress(request)
        invariant(await rateLimiter.consume(`webhook:${request.socket.remoteAddress ?? 'unknown'}`, 300, 60_000), 429, 'RATE_LIMITED', '回调请求过于频繁')
        invariant(activeWebhooks < 50, 429, 'WEBHOOK_BUSY', '回调处理繁忙')
        activeWebhooks += 1
        try { await deps.orders.handleTransactionNotification(headers, await readRawBody(request, MAX_WEBHOOK_BODY_BYTES, WEBHOOK_BODY_TIMEOUT_MS)) } finally { activeWebhooks -= 1 }
        return json(response, 204)
      }
      if (method === 'POST' && url.pathname === '/v1/webhooks/wechat-pay/refunds') {
        const headers = validateWebhookIngress(request)
        invariant(await rateLimiter.consume(`webhook:${request.socket.remoteAddress ?? 'unknown'}`, 300, 60_000), 429, 'RATE_LIMITED', '回调请求过于频繁')
        invariant(activeWebhooks < 50, 429, 'WEBHOOK_BUSY', '回调处理繁忙')
        activeWebhooks += 1
        try { await deps.orders.handleRefundNotification(headers, await readRawBody(request, MAX_WEBHOOK_BODY_BYTES, WEBHOOK_BODY_TIMEOUT_MS)) } finally { activeWebhooks -= 1 }
        return json(response, 204)
      }

      const user = await deps.auth.authenticate(authToken(request))
      if (method !== 'GET') {
        const normalizedRoute = url.pathname.replace(/\/[A-Za-z0-9_-]{8,}/g, '/:id')
        invariant(await rateLimiter.consume(`write:${user.id}:${normalizedRoute}`, 30, 60_000), 429, 'RATE_LIMITED', '操作过于频繁，请稍后重试')
      }

      if (mastersRequest) {
        invariant(deps.masters, 503, 'MASTERS_DISABLED', '香港硕士咨询尚未开启')
        const result = await deps.masters.route(user.id, method, url, request, () => readRawBody(request).then(parseJson))
        if (result.binary) {
          securityHeaders(response)
          response.statusCode = result.status
          response.setHeader('Content-Type', result.contentType ?? 'application/octet-stream')
          response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.filename ?? 'document')}`)
          response.setHeader('Content-Length', result.binary.length)
          response.end(result.binary)
          return
        }
        return json(response, result.status, { ...(result.body ?? {}), request_id: requestId })
      }

      if (/\/(?:agent-conversations|agent-runs|agent-analyses|ai-analysis-consents)(?:\/|$)/.test(url.pathname)) {
        invariant(deps.agent, 503, 'AGENT_DISABLED', 'AI 解读功能尚未配置')
        const routed = await routeAgentRequest({ service: deps.agent, userId: user.id, method, url, request })
        if (routed) return json(response, routed.status, routed.body)
      }

      if (url.pathname === '/v1/admin/integrations/feishu/status' && method === 'GET') {
        invariant(user.role === 'admin', 403, 'ADMIN_REQUIRED', '仅管理员可查看飞书同步状态')
        invariant(deps.feishu, 503, 'FEISHU_INTEGRATION_UNAVAILABLE', '飞书同步服务未配置')
        return json(response, 200, await deps.feishu.status())
      }
      if (url.pathname === '/v1/admin/integrations/feishu/reconcile' && method === 'POST') {
        invariant(user.role === 'admin', 403, 'ADMIN_REQUIRED', '仅管理员可触发飞书同步')
        invariant(deps.feishu, 503, 'FEISHU_INTEGRATION_UNAVAILABLE', '飞书同步服务未配置')
        const body = parseJson(await readRawBody(request))
        const limit = body.limit === undefined ? undefined : Number(body.limit)
        return json(response, 202, await deps.feishu.manualReconcile(user.id, limit))
      }
      if (url.pathname === '/v1/admin/integrations/feishu/validate-schema' && method === 'POST') {
        invariant(user.role === 'admin', 403, 'ADMIN_REQUIRED', '仅管理员可校验飞书字段合同')
        invariant(deps.feishu, 503, 'FEISHU_INTEGRATION_UNAVAILABLE', '飞书同步服务未配置')
        await readRawBody(request)
        return json(response, 200, await deps.feishu.validateSchema())
      }

      if (url.pathname === '/v1/me/family') {
        if (method === 'GET') return json(response, 200, { family: await deps.profiles.getFamily(user.id) })
        if (method === 'PUT') {
          const body = parseJson(await readRawBody(request)) as unknown as FamilyInput
          return json(response, 200, { family: await deps.profiles.upsertFamily(user.id, body) })
        }
      }

      if (url.pathname === '/v1/me/students') {
        if (method === 'GET') return json(response, 200, { students: await deps.profiles.listStudents(user.id) })
        if (method === 'POST') {
          const body = parseJson(await readRawBody(request)) as unknown as StudentInput
          return json(response, 201, { student: await deps.profiles.createStudent(user.id, body) })
        }
      }

      const ownStudent = url.pathname.match(/^\/v1\/me\/students\/([^/]+)$/)
      if (ownStudent?.[1]) {
        const studentId = decodeURIComponent(ownStudent[1])
        if (method === 'GET') return json(response, 200, { student: await deps.profiles.getStudent(user.id, studentId) })
        if (method === 'PUT') {
          const body = parseJson(await readRawBody(request)) as unknown as StudentInput
          return json(response, 200, { student: await deps.profiles.updateStudent(user.id, studentId, body) })
        }
      }

      if (method === 'GET' && url.pathname === '/v1/me/reports') {
        return json(response, 200, { reports: await deps.profiles.listReports(user.id) })
      }
      if (method === 'GET' && url.pathname === '/v1/me/timeline') {
        return json(response, 200, { events: await deps.profiles.timeline(user.id) })
      }
      if (method === 'GET' && url.pathname === '/v1/me/advisor-requests') {
        return json(response, 200, { requests: await deps.profiles.listAdvisorRequests(user.id) })
      }
      if (method === 'POST' && url.pathname === '/v1/advisor-requests') {
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
        invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
        return json(response, 200, await deps.education.state(user.id))
      }
      const questionnaireVersion = url.pathname.match(/^\/v1\/education-compass\/questionnaires\/([^/]+)$/)
      if (method === 'GET' && questionnaireVersion?.[1]) {
        invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
        const bank = deps.education.questionnaireByVersion(
          decodeURIComponent(questionnaireVersion[1]),
          url.searchParams.get('educationSystem') ?? undefined
        )
        return json(response, 200, { questionnaire: bank })
      }
      if (method === 'GET' && url.pathname === '/v1/education-compass/products/growth-discovery') {
        invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
        return json(response, 200, { product: await deps.education.product() })
      }
      if (method === 'POST' && url.pathname === '/v1/education-compass/free-parent-assessments') {
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
        invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
        return json(response, 200, await deps.education.setFeishuProfileConsent(user.id, parseJson(await readRawBody(request))))
      }
      if (method === 'PUT' && url.pathname === '/v1/me/integration-consents/advisor-contact') {
        const body = parseJson(await readRawBody(request))
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
          decodeURIComponent(educationConsent[1]),
          educationConsent[2] as 'CORE_ASSESSMENT' | 'STUDENT_ASSESSMENT_ASSENT'
        ))
      }

      const createAssessment = url.pathname.match(/^\/v1\/students\/([^/]+)\/education-assessments$/)
      if (method === 'POST' && createAssessment?.[1]) {
        const rawBody = parseJson(await readRawBody(request))
        if (rawBody.assessmentKind === 'STUDENT_GROWTH_DISCOVERY') {
          invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
          const assessment = await deps.education.createGrowthDiscovery(
            user.id, decodeURIComponent(createAssessment[1]), rawBody, idempotencyHeader(request)
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
        const body = rawBody as unknown as CreateAssessmentInput
        const assessment = await deps.assessments.create(user.id, decodeURIComponent(createAssessment[1]), body)
        return json(response, 201, {
          assessmentId: assessment.id,
          status: assessment.status,
          questionnaireVersion: assessment.questionnaireVersion
        })
      }

      const assessmentQuestionnaire = url.pathname.match(/^\/v1\/assessments\/([^/]+)\/questionnaire$/)
      if (method === 'GET' && assessmentQuestionnaire?.[1]) {
        invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
        return json(response, 200, {
          questionnaire: await deps.education.questionnaire(user.id, decodeURIComponent(assessmentQuestionnaire[1]))
        })
      }
      const assessmentResult = url.pathname.match(/^\/v1\/assessments\/([^/]+)\/result$/)
      if (method === 'GET' && assessmentResult?.[1]) {
        invariant(deps.education, 503, 'EDUCATION_COMPASS_V05_DISABLED', '新版 Education Compass 尚未配置')
        return json(response, 200, await deps.education.result(user.id, decodeURIComponent(assessmentResult[1])))
      }

      const assessmentAction = url.pathname.match(/^\/v1\/assessments\/([^/]+)\/(draft|submit|preview|orders)$/)
      if (assessmentAction?.[1] && assessmentAction[2]) {
        const assessmentId = decodeURIComponent(assessmentAction[1])
        const v05 = deps.education ? await deps.education.usesV05Contract(user.id, assessmentId) : false
        if (method === 'GET' && assessmentAction[2] === 'draft') {
          if (v05) return json(response, 200, await deps.education!.getDraft(user.id, assessmentId))
          return json(response, 200, await deps.assessments.getDraft(user.id, assessmentId))
        }
        if (method === 'PUT' && assessmentAction[2] === 'draft') {
          const body = parseJson(await readRawBody(request))
          if (v05) return json(response, 200, await deps.education!.saveDraft(user.id, assessmentId, body))
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
          return json(response, 201, await deps.orders.createOrder(user.id, assessmentId, {
            productCode: String(body.productCode ?? ''),
            idempotencyKey: String(body.idempotencyKey ?? '')
          }))
        }
      }

      const prepay = url.pathname.match(/^\/v1\/orders\/([^/]+)\/wechat-prepay$/)
      if (method === 'POST' && prepay?.[1]) {
        await readRawBody(request)
        return json(response, 200, await deps.orders.createWechatPrepay(user.id, decodeURIComponent(prepay[1])))
      }
      const order = url.pathname.match(/^\/v1\/orders\/([^/]+)$/)
      if (method === 'GET' && order?.[1]) {
        return json(response, 200, await deps.orders.getOrder(user.id, decodeURIComponent(order[1])))
      }

      const adminRefund = url.pathname.match(/^\/v1\/admin\/orders\/([^/]+)\/refunds$/)
      if (method === 'POST' && adminRefund?.[1]) {
        const body = parseJson(await readRawBody(request))
        const headerValue = request.headers['idempotency-key']
        const idempotencyKey = Array.isArray(headerValue) ? headerValue[0] : headerValue
        const refund = await deps.orders.requestRefund(user.id, decodeURIComponent(adminRefund[1]), {
          idempotencyKey: idempotencyKey ?? String(body.idempotencyKey ?? ''),
          reason: String(body.reason ?? '')
        })
        return json(response, 202, { refund })
      }

      const reportPdf = url.pathname.match(/^\/v1\/reports\/([^/]+)\/pdf$/)
      if (method === 'GET' && reportPdf?.[1]) {
        const reportId = decodeURIComponent(reportPdf[1])
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
        const body = parseJson(await readRawBody(request))
        const feedback = await deps.reports.submitFeedback(user.id, decodeURIComponent(reportFeedback[1]), {
          rating: Number(body.rating), tags: body.tags, comment: body.comment,
          advisorContactRequested: body.advisorContactRequested
        })
        return json(response, 201, { feedbackId: feedback.id, createdAt: feedback.createdAt })
      }
      const report = url.pathname.match(/^\/v1\/reports\/([^/]+)$/)
      if (method === 'GET' && report?.[1]) {
        const reportId = decodeURIComponent(report[1])
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
      if (mastersRequest) envelope.body.request_id = requestId
      const code = ((envelope.body.error as Record<string, unknown>)?.code ?? 'UNKNOWN') as string
      if (envelope.status >= 500) logger.error('request_failed', { method, route: url.pathname, code })
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
