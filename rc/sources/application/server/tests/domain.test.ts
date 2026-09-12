import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { MockWechatAuthProvider } from '../src/auth/wechat-auth-provider'
import { loadConfig } from '../src/config'
import { AppError } from '../src/domain/errors'
import { QUESTIONNAIRE_FIELDS, QUESTIONNAIRE_TOTAL_WEIGHT, calculateCompleteness, normalizeAnswers } from '../src/domain/questionnaire'
import { SourceCatalog, validateSourceCatalog, PLACEHOLDER_SOURCE_CATALOG } from '../src/domain/source-catalog'
import { MockPaymentProvider } from '../src/payments/mock-payment-provider'
import { AssessmentService } from '../src/services/assessment-service'
import { AuthService } from '../src/services/auth-service'
import { OrderService, seedProducts } from '../src/services/order-service'
import { ProfileService } from '../src/services/profile-service'
import { ReportService } from '../src/services/report-service'
import { FileStore } from '../src/store/file-store'
import { InMemoryStore } from '../src/store/memory-store'
import { PostgresStore } from '../src/store/postgres-store'
import { Clock, randomId } from '../src/utils/runtime'

const fixedDate = new Date('2026-08-20T10:00:00.000Z')
const clock: Clock = () => new Date(fixedDate)
const sessionSecret = 'test-session-secret-that-is-longer-than-32-characters'

const catalog: SourceCatalog = validateSourceCatalog({
  version: 'HK-UG-2026.08-reviewed',
  dataAsOf: '2026-08-15',
  reviewedAt: '2026-08-19T08:00:00.000Z',
  reviewedBy: 'Phoenix Education Review Team',
  entries: [{
    sourceId: 'HKU-UG-ADMISSIONS-2026',
    title: 'Reviewed official undergraduate admissions source',
    applicableYear: '2026',
    verifiedAt: '2026-08-19T08:00:00.000Z'
  }]
})

const validAnswers: Record<string, unknown> = {
  identity_type: '香港永久居民',
  school_stage: '高中',
  education_system: 'DSE',
  target_enrollment_year: '2—3 年',
  academic_summary: '最近主要学科表现稳定，并保留原始成绩记录。',
  language_level: '英语校内成绩稳定',
  strongest_subjects: '数学、物理',
  learning_feeling: '基本稳定',
  strengths: ['逻辑力', '创造力'],
  interests: '机器人与音乐',
  strength_evidence: '完成过一个小型机器人项目',
  challenges: ['目标不清晰'],
  parent_observation: '选科时容易摇摆',
  parent_expectation: '独立选择',
  future_goal: '探索工程方向',
  target_region: ['香港', '英国'],
  target_major: '工程、计算机',
  route_preference: '学术升学',
  backup_route_acceptance: '愿意',
  annual_budget: '25—50 万元',
  available_time: '每周一次',
  support_need: ['方向梳理', '项目体验'],
  location_preference: '优先大湾区'
}

function answersForScore(target: number): Record<string, unknown> {
  const possibilities = new Map<number, string[]>([[0, []]])
  for (const field of QUESTIONNAIRE_FIELDS) {
    for (const [score, keys] of [...possibilities.entries()]) {
      const next = score + field.weight
      if (next <= target && !possibilities.has(next)) possibilities.set(next, [...keys, field.key])
    }
  }
  const keys = possibilities.get(target)
  assert(keys, `questionnaire weights must be able to produce ${target}`)
  return Object.fromEntries(keys.map((key) => [key, validAnswers[key]]))
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof AppError && error.code === code)
}

async function setup(sourceCatalog: SourceCatalog = catalog) {
  const store = new InMemoryStore()
  await seedProducts(store, clock().toISOString())
  const auth = new AuthService(store, new MockWechatAuthProvider(), sessionSecret, clock)
  const session = await auth.createWechatSession('alice-login-code')
  const profiles = new ProfileService(store, clock)
  const family = await profiles.upsertFamily(session.user.id, {
    familyName: '测试家庭', parentName: '家长', phone: '13800000000', location: '香港', goal: '探索适合的教育方向'
  })
  const student = await profiles.createStudent(session.user.id, {
    name: '学生', age: 16, gender: '女', school: '示例学校', educationSystem: 'DSE', grade: '中五',
    interest: '机器人与音乐', goal: '探索工程方向'
  })
  const assessments = new AssessmentService(store, sourceCatalog, clock)
  const mockPay = new MockPaymentProvider(sessionSecret, { clock })
  const orders = new OrderService(store, mockPay, sourceCatalog, true, clock)
  const reports = new ReportService(store, clock)
  return { store, auth, session, profiles, family, student, assessments, mockPay, orders, reports }
}

async function createSubmitted(context: Awaited<ReturnType<typeof setup>>, answers = validAnswers) {
  const assessment = await context.assessments.create(context.session.user.id, context.student.id, {
    familyId: context.family.id,
    questionnaireVersion: 'education_compass_v1',
    studentVersion: context.student.studentVersion,
    consent: { consentVersion: 'education_compass_guardian_v1', scope: 'education_compass_report', guardianConfirmed: true }
  })
  await context.assessments.saveDraft(context.session.user.id, assessment.id, answers)
  const submitted = await context.assessments.submit(context.session.user.id, assessment.id)
  return { assessment, submitted }
}

async function createPaid(context: Awaited<ReturnType<typeof setup>>) {
  const { submitted } = await createSubmitted(context)
  const order = await context.orders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: `purchase-${submitted.assessmentId}`
  })
  const prepay = await context.orders.createWechatPrepay(context.session.user.id, order.orderId)
  assert.equal(prepay.status, 'PENDING')
  context.mockPay.setOrderState(order.outTradeNo, 'SUCCESS')
  const transaction = await context.mockPay.queryOrder(order.outTradeNo)
  const notification = context.mockPay.makeTransactionNotification({ ...transaction, eventId: `event-${order.orderId}` })
  await context.orders.handleTransactionNotification(notification.headers, notification.rawBody)
  return { order, submitted, notification }
}

test('23-field questionnaire contract matches the client contract and preserves 69/70/100 answers', async () => {
  assert.equal(QUESTIONNAIRE_FIELDS.length, 23)
  assert.equal(QUESTIONNAIRE_TOTAL_WEIGHT, 100)
  const sharedContract = JSON.parse(await readFile(resolve(__dirname, '../../../models/questionnaire-contract.json'), 'utf8')) as {
    version: string; completenessThreshold: number; fields: Array<{ key: string; type: string; weight: number }>
  }
  assert.equal(sharedContract.version, 'education_compass_v1')
  assert.equal(sharedContract.completenessThreshold, 70)
  assert.deepEqual(sharedContract.fields, QUESTIONNAIRE_FIELDS.map(({ key, type, weight }) => ({ key, type, weight })))
  assert.equal(calculateCompleteness(answersForScore(69)).score, 69)
  assert.equal(calculateCompleteness(answersForScore(70)).score, 70)
  assert.equal(calculateCompleteness(validAnswers).score, 100)
  assert.deepEqual(normalizeAnswers(validAnswers), validAnswers)
  assert.throws(() => normalizeAnswers({ ...validAnswers, unexpected_secret: 'x' }), (error: unknown) => error instanceof AppError && error.code === 'UNKNOWN_ANSWER_FIELDS')
})

test('paid Compass kill switch defaults off and rejects invalid configuration', () => {
  const base = { NODE_ENV: 'test', SESSION_SECRET: sessionSecret }
  assert.equal(loadConfig(base).paidCompassEnabled, false)
  assert.equal(loadConfig({ ...base, PAID_COMPASS_ENABLED: 'true' }).paidCompassEnabled, true)
  assert.throws(() => loadConfig({ ...base, PAID_COMPASS_ENABLED: 'yes' }), (error: unknown) => error instanceof AppError && error.code === 'CONFIG_INVALID')
})

test('production config pins verified TLS database and exact public WeChat callback origins', () => {
  const production = {
    NODE_ENV: 'production', SESSION_SECRET: sessionSecret, PAYMENT_PROVIDER: 'wechat',
    DATABASE_URL: 'postgresql://phoenix:secret@db.example.com/phoenix?sslmode=verify-full',
    WECHAT_APP_ID: 'wx1234567890abcdef', WECHAT_APP_SECRET: 'app-secret', WECHAT_MCH_ID: '1900000001',
    WECHAT_MCH_CERT_SERIAL_NO: 'CERT_SERIAL', WECHAT_MCH_PRIVATE_KEY_PATH: '/run/secrets/merchant.pem',
    WECHATPAY_API_V3_KEY: '12345678901234567890123456789012', WECHATPAY_PUBLIC_KEY_ID: 'PUB_KEY_ID',
    WECHATPAY_PUBLIC_KEY_PATH: '/run/secrets/wechat.pem', PUBLIC_BASE_URL: 'https://api.example.com',
    WECHAT_PAY_NOTIFY_URL: 'https://api.example.com/v1/webhooks/wechat-pay/transactions',
    WECHAT_REFUND_NOTIFY_URL: 'https://api.example.com/v1/webhooks/wechat-pay/refunds',
    SOURCE_CATALOG_MODE: 'verified', SOURCE_CATALOG_PATH: '/run/config/source-catalog.json'
  }
  assert.equal(loadConfig(production).publicBaseUrl, production.PUBLIC_BASE_URL)
  assert.throws(() => loadConfig({ ...production, DATABASE_URL: 'postgresql://db.example.com/phoenix?sslmode=require' }), (error: unknown) => error instanceof AppError && error.code === 'CONFIG_INVALID')
  assert.throws(() => loadConfig({ ...production, WECHAT_PAY_NOTIFY_URL: 'https://evil.example/v1/webhooks/wechat-pay/transactions' }), (error: unknown) => error instanceof AppError && error.code === 'CONFIG_INVALID')
  assert.throws(() => loadConfig({ ...production, PUBLIC_BASE_URL: 'https://user@api.example.com' }), (error: unknown) => error instanceof AppError && error.code === 'CONFIG_INVALID')
})

test('draft round-trip, 69 gate, and pre-charge six-module QA lock', async () => {
  const context = await setup()
  const assessment = await context.assessments.create(context.session.user.id, context.student.id, {
    familyId: context.family.id, questionnaireVersion: 'education_compass_v1', studentVersion: context.student.studentVersion,
    consent: { consentVersion: 'education_compass_guardian_v1', scope: 'education_compass_report', guardianConfirmed: true }
  })
  const answer69 = answersForScore(69)
  await context.assessments.saveDraft(context.session.user.id, assessment.id, answer69)
  const persisted = await context.assessments.getDraft(context.session.user.id, assessment.id)
  assert.deepEqual(persisted.answers, answer69)
  assert.equal(persisted.completenessScore, 69)
  await expectCode(context.assessments.submit(context.session.user.id, assessment.id), 'ASSESSMENT_INCOMPLETE')
  assert.equal((await context.store.read((tx) => tx.findMany('reports'))).length, 0)

  const answer70 = answersForScore(70)
  await context.assessments.saveDraft(context.session.user.id, assessment.id, answer70)
  const submitted = await context.assessments.submit(context.session.user.id, assessment.id)
  const locked = await context.store.read((tx) => tx.findById('reports', submitted.reportId))
  assert.equal(locked?.status, 'LOCKED')
  assert.equal(locked?.deliveryStatus, 'LOCKED')
  assert.equal(locked?.qaPassed, true)
  assert.equal(locked?.sourceCatalogVerified, true)
  assert.deepEqual(locked?.modules?.map((module) => module.key), [
    'student_profile', 'strengths', 'major_directions', 'university_match', 'routes', 'action_plan'
  ])
  const job = await context.store.read((tx) => tx.findOne('reportJobs', { reportId: submitted.reportId }))
  assert.equal(job?.status, 'SUCCEEDED')
  assert.equal(job?.orderId, null)
})

test('placeholder catalog, failed QA, and report generation failure all block ordering', async () => {
  const context = await setup()
  const { submitted } = await createSubmitted(context)
  const disabledOrders = new OrderService(context.store, context.mockPay, catalog, false, clock)
  await expectCode(disabledOrders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'disabled-order-key'
  }), 'PAID_COMPASS_DISABLED')
  const placeholderOrders = new OrderService(context.store, context.mockPay, PLACEHOLDER_SOURCE_CATALOG, true, clock)
  await expectCode(placeholderOrders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'placeholder-order-key'
  }), 'SOURCE_CATALOG_NOT_VERIFIED')

  await context.store.transaction(async (tx) => { await tx.update('reports', submitted.reportId, { qaPassed: false }) })
  await expectCode(context.orders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'failed-qa-order-key'
  }), 'REPORT_QA_REQUIRED')

  const broken = new AssessmentService(context.store, catalog, clock, randomId, () => { throw new Error('generator failed') })
  const assessment = await broken.create(context.session.user.id, context.student.id, {
    familyId: context.family.id, questionnaireVersion: 'education_compass_v1', studentVersion: context.student.studentVersion,
    consent: { consentVersion: 'education_compass_guardian_v1', scope: 'education_compass_report', guardianConfirmed: true }
  })
  await broken.saveDraft(context.session.user.id, assessment.id, validAnswers)
  await assert.rejects(broken.submit(context.session.user.id, assessment.id), /generator failed/)
  const after = await broken.getDraft(context.session.user.id, assessment.id)
  assert.equal(after.status, 'DRAFT')
  await expectCode(context.orders.createOrder(context.session.user.id, assessment.id, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'generator-failed-order'
  }), 'ASSESSMENT_NOT_READY')
})

test('prepay rechecks guardian consent and active product after order creation', async () => {
  const revoked = await setup()
  const revokedSubmitted = await createSubmitted(revoked)
  const revokedOrder = await revoked.orders.createOrder(revoked.session.user.id, revokedSubmitted.submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'prepay-revoked-consent'
  })
  await revoked.store.transaction(async (tx) => {
    const assessment = await tx.findById('assessments', revokedSubmitted.submitted.assessmentId)
    assert(assessment)
    await tx.update('consents', assessment.consentId, { revokedAt: '2026-08-20T10:05:00.000Z' })
  })
  await expectCode(revoked.orders.createOrder(revoked.session.user.id, revokedSubmitted.submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'order-after-consent-revoked'
  }), 'GUARDIAN_CONSENT_REQUIRED')
  await expectCode(revoked.orders.createWechatPrepay(revoked.session.user.id, revokedOrder.orderId), 'GUARDIAN_CONSENT_REQUIRED')

  const disabled = await setup()
  const disabledSubmitted = await createSubmitted(disabled)
  const disabledOrder = await disabled.orders.createOrder(disabled.session.user.id, disabledSubmitted.submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'prepay-disabled-product'
  })
  await disabled.store.transaction(async (tx) => { await tx.update('products', 'COMPASS_REPORT_SINGLE_39_9', { active: false }) })
  await expectCode(disabled.orders.createWechatPrepay(disabled.session.user.id, disabledOrder.orderId), 'PRODUCT_UNAVAILABLE')
})

test('server query reconciliation is throttled, recovers a missing callback, and closes expired NOTPAY orders', async () => {
  const context = await setup()
  const { submitted } = await createSubmitted(context)
  const order = await context.orders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'query-recovery-order'
  })
  await context.orders.createWechatPrepay(context.session.user.id, order.orderId)
  const originalQuery = context.mockPay.queryOrder.bind(context.mockPay)
  let queryCount = 0
  context.mockPay.queryOrder = async (outTradeNo: string) => { queryCount += 1; return originalQuery(outTradeNo) }
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId)).status, 'PENDING')
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId)).status, 'PENDING')
  assert.equal(queryCount, 1, 'repeated client polling must not repeatedly query WeChat')
  await context.store.transaction(async (tx) => { await tx.update('orders', order.orderId, { lastProviderQueryAt: '2026-08-20T09:00:00.000Z' }) })
  context.mockPay.setOrderState(order.outTradeNo, 'SUCCESS')
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId)).status, 'PAID')
  assert.equal(queryCount, 2)
  assert.equal((await context.reports.get(context.session.user.id, submitted.reportId)).access, 'full')

  const second = await setup()
  const secondSubmitted = await createSubmitted(second)
  const expiring = await second.orders.createOrder(second.session.user.id, secondSubmitted.submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'expired-notpay-order'
  })
  await second.orders.createWechatPrepay(second.session.user.id, expiring.orderId)
  const queryWithoutOptionalPendingFields = second.mockPay.queryOrder.bind(second.mockPay)
  second.mockPay.queryOrder = async (outTradeNo: string) => {
    const result = await queryWithoutOptionalPendingFields(outTradeNo)
    if (result.tradeState !== 'NOTPAY') return result
    const { totalFen: _totalFen, currency: _currency, payerOpenid: _payerOpenid, ...officialOptionalShape } = result
    return officialOptionalShape
  }
  await second.store.transaction(async (tx) => {
    await tx.update('orders', expiring.orderId, { expiresAt: '2026-08-20T09:00:00.000Z', lastProviderQueryAt: null })
  })
  assert.equal((await second.orders.getOrder(second.session.user.id, expiring.orderId)).status, 'CANCELLED')
  assert.equal((await second.mockPay.queryOrder(expiring.outTradeNo)).tradeState, 'CLOSED')
})

test('3990 payment callback is idempotent and only delivers the already-QA-passed report', async () => {
  const context = await setup()
  const { order, submitted, notification } = await createPaid(context)
  await Promise.all(Array.from({ length: 20 }, () => context.orders.handleTransactionNotification(notification.headers, notification.rawBody)))
  const current = await context.orders.getOrder(context.session.user.id, order.orderId, false)
  assert.equal(current.status, 'PAID')
  assert.equal(current.amountFen, 3990)

  const response = await context.reports.get(context.session.user.id, submitted.reportId)
  assert.equal(response.access, 'full')
  if (response.access === 'full') assert.equal(response.full.modules.length, 6)
  const pdf = await context.reports.pdf(context.session.user.id, submitted.reportId)
  assert.equal(pdf.subarray(0, 8).toString('ascii'), '%PDF-1.4')
  const feedback = await context.reports.submitFeedback(context.session.user.id, submitted.reportId, {
    rating: 5, tags: ['清晰'], comment: '有帮助', advisorContactRequested: true
  })
  assert(feedback.id)

  const counts = await context.store.read(async (tx) => ({
    entitlements: (await tx.findMany('entitlements', { orderId: order.orderId })).length,
    jobs: (await tx.findMany('reportJobs', { reportId: submitted.reportId })).length,
    deliveries: (await tx.findMany('timelineEvents', { orderId: order.orderId, eventType: 'report_unlocked' })).length
  }))
  assert.deepEqual(counts, { entitlements: 1, jobs: 1, deliveries: 1 })

  const transaction = await context.mockPay.queryOrder(order.outTradeNo)
  const conflict = context.mockPay.makeTransactionNotification({ ...transaction, eventId: `event-${order.orderId}`, totalFen: 1 })
  await expectCode(context.orders.handleTransactionNotification(conflict.headers, conflict.rawBody), 'PAYMENT_EVENT_CONFLICT')
})

test('forged transaction fields and cross-user resource access never grant paid content', async () => {
  const context = await setup()
  const { submitted } = await createSubmitted(context)
  const order = await context.orders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'negative-callback-order'
  })
  await context.orders.createWechatPrepay(context.session.user.id, order.orderId)
  context.mockPay.setOrderState(order.outTradeNo, 'SUCCESS')
  const valid = await context.mockPay.queryOrder(order.outTradeNo)
  const cases: Array<[string, Partial<typeof valid>, string]> = [
    ['bad-app', { appId: 'wx_wrong' }, 'PAYMENT_APPID_MISMATCH'],
    ['bad-mch', { mchId: 'wrong_mch' }, 'PAYMENT_MCHID_MISMATCH'],
    ['bad-amount', { totalFen: 1 }, 'PAYMENT_AMOUNT_MISMATCH'],
    ['bad-currency', { currency: 'USD' }, 'PAYMENT_CURRENCY_MISMATCH'],
    ['bad-payer', { payerOpenid: 'openid_wrong' }, 'PAYMENT_PAYER_MISMATCH'],
    ['missing-tx', { transactionId: '' }, 'PAYMENT_TRANSACTION_ID_MISSING']
  ]
  for (const [suffix, changes, code] of cases) {
    const notification = context.mockPay.makeTransactionNotification({ ...valid, ...changes, eventId: `negative-${suffix}` })
    await expectCode(context.orders.handleTransactionNotification(notification.headers, notification.rawBody), code)
  }
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId, false)).status, 'PENDING')
  assert.equal((await context.store.read((tx) => tx.findMany('entitlements', { orderId: order.orderId }))).length, 0)
  assert.equal((await context.reports.get(context.session.user.id, submitted.reportId)).access, 'preview')

  const otherSession = await context.auth.createWechatSession('bob-login-code')
  await expectCode(context.assessments.getDraft(otherSession.user.id, submitted.assessmentId), 'ASSESSMENT_FORBIDDEN')
  await expectCode(context.assessments.preview(otherSession.user.id, submitted.assessmentId), 'ASSESSMENT_FORBIDDEN')
  await expectCode(context.orders.getOrder(otherSession.user.id, order.orderId, false), 'ORDER_FORBIDDEN')
  await expectCode(context.reports.get(otherSession.user.id, submitted.reportId), 'REPORT_FORBIDDEN')
  await expectCode(context.reports.pdf(otherSession.user.id, submitted.reportId), 'REPORT_FORBIDDEN')
})

test('admin refund is RBAC-protected, idempotent, and revokes report entitlement once', async () => {
  const context = await setup()
  const { order, submitted } = await createPaid(context)
  await expectCode(context.orders.requestRefund(context.session.user.id, order.orderId, {
    idempotencyKey: 'refund-key-0001', reason: '用户确认取消本次报告'
  }), 'ADMIN_REQUIRED')
  const adminId = 'usr_admin_test'
  await context.store.transaction(async (tx) => {
    await tx.insert('users', { id: adminId, role: 'admin', createdAt: clock().toISOString() })
  })
  const refund = await context.orders.requestRefund(adminId, order.orderId, {
    idempotencyKey: 'refund-key-0001', reason: '用户确认取消本次报告'
  })
  const duplicate = await context.orders.requestRefund(adminId, order.orderId, {
    idempotencyKey: 'refund-key-0001', reason: '重复请求不会新建退款'
  })
  assert.equal(duplicate.id, refund.id)
  await expectCode(context.orders.requestRefund(adminId, 'ord_different_order', {
    idempotencyKey: 'refund-key-0001', reason: '错误重用'
  }), 'IDEMPOTENCY_KEY_REUSED')

  context.mockPay.setRefundState(refund.outRefundNo, 'SUCCESS')
  const result = await context.mockPay.queryRefund(refund.outRefundNo)
  const notification = context.mockPay.makeRefundNotification({ ...result, eventId: `refund-event-${refund.id}` })
  await context.orders.handleRefundNotification(notification.headers, notification.rawBody)
  const repeated = await context.orders.handleRefundNotification(notification.headers, notification.rawBody)
  assert.equal(repeated.duplicate, true)
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId, false)).status, 'REFUNDED')
  const report = await context.reports.get(context.session.user.id, submitted.reportId)
  assert.equal(report.access, 'preview')
  await expectCode(context.reports.pdf(context.session.user.id, submitted.reportId), 'REPORT_PAYMENT_REQUIRED')
  const audit = await context.store.read((tx) => tx.findMany('auditLogs', { actorUserId: adminId }))
  assert.equal(audit.length, 1)
  assert.equal(JSON.stringify(audit).includes('用户确认'), false)
})

test('synchronous refund success revokes access even when the webhook is lost', async () => {
  const context = await setup()
  const { order, submitted } = await createPaid(context)
  const adminId = 'usr_admin_sync_refund'
  await context.store.transaction(async (tx) => { await tx.insert('users', { id: adminId, role: 'admin', createdAt: clock().toISOString() }) })
  const originalRequest = context.mockPay.requestRefund.bind(context.mockPay)
  context.mockPay.requestRefund = async (paidOrder, refund) => {
    const created = await originalRequest(paidOrder, refund)
    context.mockPay.setRefundState(refund.outRefundNo, 'SUCCESS')
    return { ...created, status: 'SUCCESS' }
  }
  const refund = await context.orders.requestRefund(adminId, order.orderId, {
    idempotencyKey: 'sync-refund-key', reason: '同步退款成功测试'
  })
  assert.equal(refund.status, 'SUCCESS')
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId, false)).status, 'REFUNDED')
  assert.equal((await context.reports.get(context.session.user.id, submitted.reportId)).access, 'preview')
  await expectCode(context.reports.pdf(context.session.user.id, submitted.reportId), 'REPORT_PAYMENT_REQUIRED')
  const successful = await context.mockPay.queryRefund(refund.outRefundNo)
  for (const refundStatus of ['PROCESSING', 'CLOSED', 'ABNORMAL'] as const) {
    const stale = context.mockPay.makeRefundNotification({
      ...successful,
      eventId: `stale-after-success-${refundStatus}`,
      refundStatus
    })
    await context.orders.handleRefundNotification(stale.headers, stale.rawBody)
  }
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId, false)).status, 'REFUNDED')
  const persistedRefund = await context.store.read((tx) => tx.findById('refunds', refund.id))
  assert.equal(persistedRefund?.status, 'SUCCESS')
})

test('a success webhook racing the provider response cannot be downgraded to PROCESSING', async () => {
  const context = await setup()
  const { order, submitted } = await createPaid(context)
  const adminId = 'usr_admin_refund_race'
  await context.store.transaction(async (tx) => { await tx.insert('users', { id: adminId, role: 'admin', createdAt: clock().toISOString() }) })
  const originalRequest = context.mockPay.requestRefund.bind(context.mockPay)
  context.mockPay.requestRefund = async (paidOrder, refund) => {
    const processing = await originalRequest(paidOrder, refund)
    context.mockPay.setRefundState(refund.outRefundNo, 'SUCCESS')
    const success = await context.mockPay.queryRefund(refund.outRefundNo)
    const notification = context.mockPay.makeRefundNotification({ ...success, eventId: `refund-race-${refund.id}` })
    await context.orders.handleRefundNotification(notification.headers, notification.rawBody)
    return processing
  }
  const refund = await context.orders.requestRefund(adminId, order.orderId, {
    idempotencyKey: 'refund-provider-race', reason: '模拟回调先于请求响应'
  })
  assert.equal(refund.status, 'SUCCESS')
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId, false)).status, 'REFUNDED')
  assert.equal((await context.reports.get(context.session.user.id, submitted.reportId)).access, 'preview')
})

test('durable refund reconciliation revokes access when the final webhook is lost', async () => {
  const context = await setup()
  const { order, submitted } = await createPaid(context)
  const adminId = 'usr_admin_refund_worker'
  await context.store.transaction(async (tx) => { await tx.insert('users', { id: adminId, role: 'admin', createdAt: clock().toISOString() }) })
  const refund = await context.orders.requestRefund(adminId, order.orderId, {
    idempotencyKey: 'refund-worker-recovery', reason: '测试退款对账补偿'
  })
  assert.equal(refund.status, 'PROCESSING')
  context.mockPay.setRefundState(refund.outRefundNo, 'SUCCESS')
  const result = await context.orders.reconcilePendingRefunds(50, 0)
  assert.deepEqual(result, { checked: 1, succeeded: 1, failed: 0 })
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId, false)).status, 'REFUNDED')
  assert.equal((await context.reports.get(context.session.user.id, submitted.reportId)).access, 'preview')
})

test('refund reconciliation replays an intent after a crash before the provider request', async () => {
  const context = await setup()
  const { order, submitted } = await createPaid(context)
  const adminId = 'usr_admin_refund_crash'
  const now = clock().toISOString()
  await context.store.transaction(async (tx) => {
    await tx.insert('users', { id: adminId, role: 'admin', createdAt: now })
    await tx.insert('refunds', {
      id: 'rfd_crash_window', outRefundNo: 'PRCRASHWINDOW001', orderId: order.orderId,
      requestedBy: adminId, idempotencyKey: 'refund-crash-window', reason: '模拟退款请求前崩溃',
      amountFen: 3990, currency: 'CNY', status: 'PROCESSING', providerRefundId: null,
      createdAt: now, updatedAt: now, succeededAt: null
    })
    await tx.update('orders', order.orderId, { status: 'REFUNDING', updatedAt: now })
  })
  assert.deepEqual(await context.orders.reconcilePendingRefunds(50, 0), { checked: 1, succeeded: 0, failed: 0 })
  const replayed = await context.store.read((tx) => tx.findById('refunds', 'rfd_crash_window'))
  assert(replayed?.providerRefundId)
  context.mockPay.setRefundState('PRCRASHWINDOW001', 'SUCCESS')
  assert.deepEqual(await context.orders.reconcilePendingRefunds(50, 0), { checked: 1, succeeded: 1, failed: 0 })
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId, false)).status, 'REFUNDED')
  assert.equal((await context.reports.get(context.session.user.id, submitted.reportId)).access, 'preview')
})

test('file adapter persists isolated state and migration matches production model', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-server-test-'))
  try {
    const path = join(directory, 'state.json')
    const first = await FileStore.open(path)
    await first.transaction(async (tx) => {
      await tx.insert('users', { id: 'usr_file', role: 'family_user', createdAt: clock().toISOString() })
    })
    const reopened = await FileStore.open(path)
    assert.equal((await reopened.read((tx) => tx.findById('users', 'usr_file')))?.id, 'usr_file')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }

  const migration = await readFile(resolve(__dirname, '../../migrations/001_initial_schema.sql'), 'utf8')
  assert.match(migration, /status IN \('CREATED', 'PENDING', 'PAID'/)
  assert.doesNotMatch(migration, /'PAYING'|'EXPIRED'/)
  assert.match(migration, /source_catalog_verified boolean NOT NULL/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS refunds[\s\S]+requested_by text NOT NULL[\s\S]+idempotency_key text NOT NULL/)
  const feishuMigration = await readFile(resolve(__dirname, '../../migrations/002_feishu_bitable_integration.sql'), 'utf8')
  assert.match(feishuMigration, /CREATE TABLE IF NOT EXISTS integration_links/)
  assert.match(feishuMigration, /lease_token text/)
  assert.match(feishuMigration, /operation_token text[\s\S]+operation_digest text[\s\S]+operation_body text/)
  assert.match(feishuMigration, /'BLOCKED'/)
  assert.match(feishuMigration, /UNIQUE \(provider, table_id, entity_type, entity_id\)/)
  assert.match(feishuMigration, /UNIQUE \(provider, table_id, external_record_id\)/)
  const postgres = new PostgresStore({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused', connectionTimeoutMillis: 1 })
  await postgres.close()
})
