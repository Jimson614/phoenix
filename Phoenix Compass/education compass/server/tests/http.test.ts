import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { AddressInfo } from 'node:net'
import test from 'node:test'
import { MockWechatAuthProvider, WechatApiAuthProvider } from '../src/auth/wechat-auth-provider'
import { validateSourceCatalog } from '../src/domain/source-catalog'
import { createAppServer } from '../src/http/app'
import { InMemoryRateLimiter, RateLimiter } from '../src/http/rate-limiter'
import { MockPaymentProvider } from '../src/payments/mock-payment-provider'
import { decryptMessage, encryptMessage, messageSignature, WechatMessageCodec } from '../src/payments/wechat-message'
import { PaymentPushService } from '../src/services/payment-push-service'
import { AssessmentService } from '../src/services/assessment-service'
import { AuthService } from '../src/services/auth-service'
import { OrderService, seedProducts } from '../src/services/order-service'
import { ProfileService } from '../src/services/profile-service'
import { ReportService } from '../src/services/report-service'
import { InMemoryStore } from '../src/store/memory-store'

const secret = 'http-test-session-secret-with-more-than-32-characters'
const PUSH_TOKEN = 'synthetictoken01'
const PUSH_AES_KEY = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
const catalog = validateSourceCatalog({
  version: 'TEST-VERIFIED-1', dataAsOf: '2026-08-15', reviewedAt: '2026-08-19T00:00:00Z', reviewedBy: 'Test reviewer',
  entries: [{ sourceId: 'OFFICIAL-TEST-1', title: 'Official reviewed test source', applicableYear: '2026', verifiedAt: '2026-08-19T00:00:00Z' }]
})

async function listen(rateLimiter?: RateLimiter, readiness?: () => Promise<void>) {
  const store = new InMemoryStore()
  await seedProducts(store, new Date().toISOString())
  const auth = new AuthService(store, new MockWechatAuthProvider(), secret)
  const profiles = new ProfileService(store)
  const assessments = new AssessmentService(store, catalog)
  const mockPay = new MockPaymentProvider(secret)
  const orders = new OrderService(store, mockPay, catalog, true)
  const reports = new ReportService(store)
  const payments = new PaymentPushService(new WechatMessageCodec({ token: PUSH_TOKEN, encodingAesKey: PUSH_AES_KEY, appId: 'wx0123456789abcdef' }), orders)
  const server = createAppServer({
    auth, profiles, assessments, orders, reports, payments,
    ...(rateLimiter ? { rateLimiter } : {}),
    ...(readiness ? { readiness } : {})
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    store, auth, mockPay, orders, server,
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function jsonRequest(base: string, path: string, options: RequestInit = {}): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  })
  const body = response.status === 204 ? null : await response.json()
  return { response, body }
}

test('profile sync and assessment draft GET round-trip over frozen HTTP contract', async () => {
  const app = await listen()
  try {
    const login = await jsonRequest(app.base, '/v1/auth/wechat/session', { method: 'POST', body: JSON.stringify({ code: 'http-user-code' }) })
    assert.equal(login.response.status, 200)
    const authorization = { Authorization: `Bearer ${login.body.accessToken}` }
    const familyResult = await jsonRequest(app.base, '/v1/me/family', {
      method: 'PUT', headers: authorization,
      body: JSON.stringify({ familyName: 'HTTP家庭', parentName: '家长', phone: '13800000000', location: '香港', goal: '方向探索' })
    })
    assert.equal(familyResult.response.status, 200)
    const studentResult = await jsonRequest(app.base, '/v1/me/students', {
      method: 'POST', headers: authorization,
      body: JSON.stringify({ name: '学生', age: 16, educationSystem: 'DSE', grade: '中五' })
    })
    assert.equal(studentResult.response.status, 201)
    const create = await jsonRequest(app.base, `/v1/students/${studentResult.body.student.id}/education-assessments`, {
      method: 'POST', headers: authorization,
      body: JSON.stringify({
        familyId: familyResult.body.family.id,
        questionnaireVersion: 'education_compass_v1',
        studentVersion: studentResult.body.student.studentVersion,
        consent: { consentVersion: 'education_compass_guardian_v1', scope: 'education_compass_report', guardianConfirmed: true }
      })
    })
    assert.equal(create.response.status, 201)
    const answers = { identity_type: '香港永久居民', target_region: ['香港'], academic_summary: '阶段成绩记录' }
    const saved = await jsonRequest(app.base, `/v1/assessments/${create.body.assessmentId}/draft`, {
      method: 'PUT', headers: authorization, body: JSON.stringify({ answers })
    })
    assert.equal(saved.response.status, 200)
    const restored = await jsonRequest(app.base, `/v1/assessments/${create.body.assessmentId}/draft`, {
      method: 'GET', headers: authorization
    })
    assert.equal(restored.response.status, 200)
    assert.deepEqual(restored.body.answers, answers)
    assert.equal(restored.body.questionnaireVersion, 'education_compass_v1')
  } finally {
    await app.close()
  }
})

test('admin refund endpoint enforces RBAC and Idempotency-Key', async () => {
  const app = await listen()
  try {
    const userLogin = await app.auth.createWechatSession('refund-normal-user')
    const adminCode = 'refund-admin-code'
    const adminOpenid = `mock_${createHash('sha256').update(adminCode).digest('hex').slice(0, 24)}`
    const adminId = 'usr_http_admin'
    await app.store.transaction(async (tx) => {
      await tx.insert('users', { id: adminId, role: 'admin', createdAt: new Date().toISOString() })
      await tx.insert('wechatIdentities', { id: 'wxi_http_admin', userId: adminId, openid: adminOpenid, unionid: null, createdAt: new Date().toISOString() })
      await tx.insert('orders', {
        id: 'ord_http_paid', outTradeNo: 'PXHTTPPAID000001', userId: userLogin.user.id,
        familyId: 'fam_http', studentId: 'stu_http', assessmentId: 'asm_http', reportId: 'rpt_http',
        productCode: 'COMPASS_REPORT_SINGLE_39_9', amountFen: 3990, currency: 'CNY', status: 'PAID',
        idempotencyKey: 'purchase-http-paid', provider: 'mock', providerPrepayId: null, paymentParams: null,
        providerTransactionId: 'mock_tx_http', lastProviderQueryAt: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
        paidAt: new Date().toISOString(), refundedAt: null
      })
    })
    const adminLogin = await app.auth.createWechatSession(adminCode)
    assert.equal(adminLogin.user.role, 'admin')
    const normalAttempt = await jsonRequest(app.base, '/v1/admin/orders/ord_http_paid/refunds', {
      method: 'POST', headers: { Authorization: `Bearer ${userLogin.accessToken}`, 'Idempotency-Key': 'http-refund-key-1' },
      body: JSON.stringify({ reason: '测试退款' })
    })
    assert.equal(normalAttempt.response.status, 403)

    const first = await jsonRequest(app.base, '/v1/admin/orders/ord_http_paid/refunds', {
      method: 'POST', headers: { Authorization: `Bearer ${adminLogin.accessToken}`, 'Idempotency-Key': 'http-refund-key-1' },
      body: JSON.stringify({ reason: '用户确认退款' })
    })
    assert.equal(first.response.status, 202)
    const second = await jsonRequest(app.base, '/v1/admin/orders/ord_http_paid/refunds', {
      method: 'POST', headers: { Authorization: `Bearer ${adminLogin.accessToken}`, 'Idempotency-Key': 'http-refund-key-1' },
      body: JSON.stringify({ reason: '重复请求' })
    })
    assert.equal(second.response.status, 202)
    assert.equal(second.body.refund.id, first.body.refund.id)
    const reused = await jsonRequest(app.base, '/v1/admin/orders/ord_other/refunds', {
      method: 'POST', headers: { Authorization: `Bearer ${adminLogin.accessToken}`, 'Idempotency-Key': 'http-refund-key-1' },
      body: JSON.stringify({ reason: '错误重用幂等键' })
    })
    assert.equal(reused.response.status, 409)
    assert.equal(reused.body.error.code, 'IDEMPOTENCY_KEY_REUSED')
  } finally {
    await app.close()
  }
})

test('HTTP rate limiter emits stable 429 error envelope', async () => {
  const rejectAll: RateLimiter = { consume: () => false }
  const app = await listen(rejectAll)
  try {
    const result = await jsonRequest(app.base, '/v1/auth/wechat/session', {
      method: 'POST', body: JSON.stringify({ code: 'rate-limited-code' })
    })
    assert.equal(result.response.status, 429)
    assert.equal(result.body.error.code, 'RATE_LIMITED')
  } finally {
    await app.close()
  }
})

test('HTTP contract rejects unknown bodies, malformed path escapes, and unknown queries', async () => {
  const app = await listen()
  try {
    const badLogin = await jsonRequest(app.base, '/v1/auth/wechat/session', {
      method: 'POST', body: JSON.stringify({ code: 12345 })
    })
    assert.equal(badLogin.response.status, 400)
    assert.equal(badLogin.body.error.code, 'INVALID_WECHAT_CODE')
    const unknownLogin = await jsonRequest(app.base, '/v1/auth/wechat/session', {
      method: 'POST', body: JSON.stringify({ code: 'strict-login', ignored: true })
    })
    assert.equal(unknownLogin.response.status, 400)
    assert.equal(unknownLogin.body.error.code, 'UNKNOWN_REQUEST_FIELDS')
    const query = await jsonRequest(app.base, '/health?ignored=true')
    assert.equal(query.response.status, 400)
    assert.equal(query.body.error.code, 'QUERY_INVALID')

    const login = await app.auth.createWechatSession('strict-contract-user')
    const malformed = await jsonRequest(app.base, '/v1/me/students/%E0%A4%A', {
      headers: { Authorization: `Bearer ${login.accessToken}` }
    })
    assert.equal(malformed.response.status, 400)
    assert.equal(malformed.body.error.code, 'PATH_PARAMETER_INVALID')
    const unknownProfile = await jsonRequest(app.base, '/v1/me/family', {
      method: 'PUT', headers: { Authorization: `Bearer ${login.accessToken}` },
      body: JSON.stringify({ familyName: '家庭', unexpected: 'must-not-be-ignored' })
    })
    assert.equal(unknownProfile.response.status, 400)
    assert.equal(unknownProfile.body.error.code, 'UNKNOWN_REQUEST_FIELDS')
  } finally {
    await app.close()
  }
})

test('trusted local reverse proxy address separates login rate-limit buckets', async () => {
  const keys: string[] = []
  const capture: RateLimiter = { consume: (key) => { keys.push(key); return true } }
  const app = await listen(capture)
  try {
    const result = await jsonRequest(app.base, '/v1/auth/wechat/session', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '203.0.113.9, 198.51.100.7' },
      body: JSON.stringify({ code: 'proxied-login' })
    })
    assert.equal(result.response.status, 200)
    assert.equal(keys[0], 'auth:198.51.100.7')
  } finally {
    await app.close()
  }
})

test('health is a read-only readiness check with a stable unavailable envelope', async () => {
  let checks = 0
  const app = await listen(undefined, async () => {
    checks += 1
    throw new Error('synthetic store outage')
  })
  try {
    const result = await jsonRequest(app.base, '/health')
    assert.equal(result.response.status, 503)
    assert.equal(result.body.error.code, 'SERVICE_NOT_READY')
    assert.equal(checks, 1)
  } finally {
    await app.close()
  }
})

test('in-memory limiter bounds high-cardinality buckets and admits keys after expiry', () => {
  let now = 1_000
  const limiter = new InMemoryRateLimiter(() => now, 2)
  assert.equal(limiter.consume('one', 1, 1_000), true)
  assert.equal(limiter.consume('two', 1, 1_000), true)
  assert.equal(limiter.consume('three', 1, 1_000), false)
  now = 2_001
  assert.equal(limiter.consume('three', 1, 1_000), true)
})

test('Wechat auth provider maps network and malformed provider responses without leaking details', async () => {
  const unavailable = new WechatApiAuthProvider('appid', 'secret', (async () => {
    throw new TypeError('private network detail')
  }) as typeof fetch)
  await assert.rejects(unavailable.exchangeCode('wx-code'), (error: unknown) =>
    (error as { code?: string }).code === 'WECHAT_LOGIN_UNAVAILABLE')

  const malformed = new WechatApiAuthProvider('appid', 'secret', (async () =>
    new Response('not-json', { status: 200 })) as typeof fetch)
  await assert.rejects(malformed.exchangeCode('wx-code'), (error: unknown) =>
    (error as { code?: string }).code === 'WECHAT_LOGIN_RESPONSE_INVALID')

  const contradictory = new WechatApiAuthProvider('appid', 'secret', (async () =>
    Response.json({ openid: 'openid', errcode: 40029 })) as typeof fetch)
  await assert.rejects(contradictory.exchangeCode('wx-code'), (error: unknown) =>
    (error as { code?: string }).code === 'WECHAT_LOGIN_FAILED')
})

test('message push ingress echoes only a signed URL check, refuses unsigned and plaintext pushes, and sets short server deadlines', async () => {
  const app = await listen()
  try {
    assert.equal(app.server.requestTimeout, 10_000)
    assert.equal(app.server.headersTimeout, 5_000)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = '1514711492'
    const signature = messageSignature(PUSH_TOKEN, timestamp, nonce)
    const verified = await fetch(`${app.base}/v1/webhooks/wechat-message?${new URLSearchParams({ signature, timestamp, nonce, echostr: 'echo-4375120948' })}`)
    assert.equal(verified.status, 200)
    assert.equal(await verified.text(), 'echo-4375120948')
    const forged = await fetch(`${app.base}/v1/webhooks/wechat-message?${new URLSearchParams({ signature: '0'.repeat(40), timestamp, nonce, echostr: 'echo' })}`)
    assert.equal(forged.status, 401)

    const unsigned = await jsonRequest(app.base, `/v1/webhooks/wechat-message?${new URLSearchParams({ signature, timestamp, nonce, encrypt_type: 'aes' })}`, {
      method: 'POST', body: JSON.stringify({ ToUserName: 'gh_synthetic', Encrypt: 'AAAA' })
    })
    assert.equal(unsigned.response.status, 401)
    assert.equal(unsigned.body.error.code, 'WECHAT_MESSAGE_SIGNATURE_INVALID')
    const plaintext = await jsonRequest(app.base, `/v1/webhooks/wechat-message?${new URLSearchParams({ signature, timestamp, nonce })}`, {
      method: 'POST', body: JSON.stringify({ Event: 'xpay_goods_deliver_notify', OutTradeNo: 'PX0000000000' })
    })
    assert.equal(plaintext.response.status, 401)
    assert.equal(plaintext.body.error.code, 'WECHAT_MESSAGE_PLAINTEXT_REFUSED')
    const unexpectedQuery = await jsonRequest(app.base, `/v1/webhooks/wechat-message?${new URLSearchParams({ signature, timestamp, nonce, echostr: 'x', extra: '1' })}`)
    assert.equal(unexpectedQuery.response.status, 400)
  } finally {
    await app.close()
  }
})

test('logout revokes full-report and PDF HTTP access for the presented bearer session', async () => {
  const app = await listen()
  try {
    const login = await app.auth.createWechatSession('logout-user-code')
    const authorization = { Authorization: `Bearer ${login.accessToken}` }
    const now = new Date().toISOString()
    await app.store.transaction(async (tx) => {
      await tx.insert('reports', {
        id: 'rpt_logout_http',
        userId: login.user.id,
        familyId: 'fam_logout_http',
        studentId: 'stu_logout_http',
        assessmentId: 'asm_logout_http',
        status: 'READY',
        deliveryStatus: 'DELIVERED',
        preview: {
          reportId: 'rpt_logout_http', assessmentId: 'asm_logout_http', completenessScore: 100,
          confidence: 'high', profileSummary: '合成画像', oneStrength: '合成优势', oneRisk: '合成风险',
          routeOverview: '合成路线', tableOfContents: ['学生成长画像'], dataAsOf: '2026-08-20',
          disclaimer: '合成免责声明', canPurchase: false
        },
        modules: [{ key: 'student_profile', title: '学生成长画像', summary: '仅用于会话撤销测试', items: [] }],
        sources: [],
        dataAsOf: '2026-08-20',
        disclaimer: '合成免责声明',
        confidence: 'high',
        versions: {
          studentVersion: 'student-v1', ruleVersion: 'rules-v1', dataVersion: 'data-v1',
          promptVersion: 'prompt-v1', templateVersion: 'template-v1'
        },
        qaPassed: true,
        sourceCatalogVerified: true,
        sourceCatalogVersion: 'data-v1',
        createdAt: now,
        updatedAt: now,
        reportKind: 'LEGACY_EDUCATION_COMPASS_REPORT',
        resultVersion: 'legacy-v1',
        resultPayload: null,
        ruleVersion: 'rules-v1',
        disclaimerVersion: 'disclaimer-v1',
        disclaimerTextHash: null
      })
      await tx.insert('entitlements', {
        id: 'ent_logout_http', userId: login.user.id, orderId: 'ord_logout_http',
        reportId: 'rpt_logout_http', productCode: 'COMPASS_REPORT_SINGLE_39_9',
        status: 'ACTIVE', grantedAt: now, revokedAt: null
      })
    })
    const before = await jsonRequest(app.base, '/v1/me/family', { headers: authorization })
    assert.equal(before.response.status, 200)
    const reportBefore = await jsonRequest(app.base, '/v1/reports/rpt_logout_http', { headers: authorization })
    assert.equal(reportBefore.response.status, 200)
    assert.equal(reportBefore.body.access, 'full')
    const pdfBefore = await fetch(`${app.base}/v1/reports/rpt_logout_http/pdf`, { headers: authorization })
    assert.equal(pdfBefore.status, 200)
    assert.equal(Buffer.from(await pdfBefore.arrayBuffer()).subarray(0, 8).toString('ascii'), '%PDF-1.4')

    const expiredLogin = await app.auth.createWechatSession('expired-report-user-code')
    await app.store.transaction(async (tx) => {
      const session = await tx.findOne('sessions', { userId: expiredLogin.user.id })
      assert(session)
      await tx.update('sessions', session.id, { expiresAt: '2000-01-01T00:00:00.000Z' })
    })
    const expiredAuthorization = { Authorization: `Bearer ${expiredLogin.accessToken}` }
    for (const path of ['/v1/reports/rpt_logout_http', '/v1/reports/rpt_logout_http/pdf']) {
      const expired = await jsonRequest(app.base, path, { headers: expiredAuthorization })
      assert.equal(expired.response.status, 401, path)
      assert.equal(expired.body.error.code, 'SESSION_EXPIRED', path)
    }

    const logout = await jsonRequest(app.base, '/v1/auth/session', { method: 'DELETE', headers: authorization })
    assert.equal(logout.response.status, 204)
    for (const path of ['/v1/me/family', '/v1/reports/rpt_logout_http', '/v1/reports/rpt_logout_http/pdf']) {
      const after = await jsonRequest(app.base, path, { headers: authorization })
      assert.equal(after.response.status, 401, path)
      assert.equal(after.body.error.code, 'SESSION_INVALID', path)
    }
  } finally {
    await app.close()
  }
})

test('virtual payment pushes: the other environment is acknowledged without effect, an unknown order is retried, and an iOS refund query gets a sealed answer', async () => {
  const app = await listen()
  const appId = 'wx0123456789abcdef'
  const post = async (event: Record<string, unknown>) => {
    const encrypted = encryptMessage(PUSH_AES_KEY, JSON.stringify(event), appId)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = '415670741'
    const query = new URLSearchParams({
      signature: messageSignature(PUSH_TOKEN, timestamp, nonce), timestamp, nonce, openid: 'synthetic-openid',
      encrypt_type: 'aes', msg_signature: messageSignature(PUSH_TOKEN, timestamp, nonce, encrypted)
    })
    return fetch(`${app.base}/v1/webhooks/wechat-message?${query}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ToUserName: 'gh_synthetic', Encrypt: encrypted })
    })
  }
  const base = { ToUserName: 'gh_synthetic', FromUserName: 'official', CreateTime: Math.floor(Date.now() / 1000), MsgType: 'event' }
  const delivery = (env: number) => ({
    ...base, Event: 'xpay_goods_deliver_notify', OpenId: 'synthetic-openid', OutTradeNo: `PX${'7'.repeat(30)}`, Env: env,
    WeChatPayInfo: { MchOrderNo: 'mch-1', TransactionId: 'wx-tx-1', PaidTime: Math.floor(Date.now() / 1000) },
    GoodsInfo: { ProductId: 'COMPASS_REPORT_SINGLE_39_9', Quantity: 1, OrigPrice: 3990, ActualPrice: 3990, Attach: 'ord_not_here' }
  })
  try {
    // The mock provider is the sandbox (Env 1): a live delivery is not ours to apply.
    const otherEnv = await post(delivery(0))
    assert.equal(otherEnv.status, 200)
    assert.equal(await otherEnv.text(), 'success')
    // A delivery for our environment whose order is unknown is refused so WeChat keeps retrying.
    assert.equal((await post(delivery(1))).status, 404)

    const answer = await post({ ...base, Event: 'xpay_subscribe_ios_refund_query_notify', pay_order_id: `PX${'8'.repeat(30)}`, product_id: 'item', provide_status: '1' })
    assert.equal(answer.status, 200)
    const sealed = await answer.json() as { Encrypt: string; MsgSignature: string; TimeStamp: number; Nonce: string }
    assert.equal(sealed.Nonce, '415670741')
    assert.equal(sealed.MsgSignature, messageSignature(PUSH_TOKEN, String(sealed.TimeStamp), sealed.Nonce, sealed.Encrypt))
    assert.deepEqual(JSON.parse(decryptMessage(PUSH_AES_KEY, sealed.Encrypt, appId)), { result_code: 0, result_info: '未找到已支付订单，不拦截', evidence: 'NO_PAID_ORDER' })

    const complaint = await post({ ...base, Event: 'xpay_complaint_notify', OpenId: 'synthetic-openid', MchOrderId: 'PXcomplaint01', ComplaintId: 'cmp-1', ComplaintDetail: '投诉正文不应被保存' })
    assert.equal(await complaint.text(), 'success')
    assert.equal(await (await post({ ...base, Event: 'debug_demo', debug_str: 'hello world' })).text(), 'success')

    const audit = await app.store.read((tx) => tx.findMany('auditLogs'))
    assert.deepEqual(audit.map((row) => row.action).sort(), ['IOS_REFUND_QUERY_ANSWERED', 'PAYMENT_COMPLAINT_RECEIVED', 'PAYMENT_PUSH_OTHER_ENV_IGNORED'])
    assert.ok(!JSON.stringify(audit).includes('投诉正文'), 'complaint text is not kept')
  } finally {
    await app.close()
  }
})
