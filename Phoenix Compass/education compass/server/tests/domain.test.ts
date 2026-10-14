import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { MockWechatAuthProvider } from '../src/auth/wechat-auth-provider'
import { loadConfig } from '../src/config'
import { AppError } from '../src/domain/errors'
import { QUESTIONNAIRE_FIELDS, QUESTIONNAIRE_TOTAL_WEIGHT, calculateCompleteness, normalizeAnswers } from '../src/domain/questionnaire'
import { assertReportQa, generateSixModuleReport } from '../src/domain/report-builder'
import { SourceCatalog, validateSourceCatalog, PLACEHOLDER_SOURCE_CATALOG } from '../src/domain/source-catalog'
import { MockPaymentProvider } from '../src/payments/mock-payment-provider'
import { TransactionResult } from '../src/payments/payment-provider'
import { parseXpayPush } from '../src/payments/xpay-events'
import { AccountService, dependencyOrder } from '../src/services/account-service'
import { ExportService } from '../src/services/export-service'
import { AssessmentService } from '../src/services/assessment-service'
import { AuthService } from '../src/services/auth-service'
import { OrderService, seedProducts } from '../src/services/order-service'
import { ProfileService } from '../src/services/profile-service'
import { ReportService } from '../src/services/report-service'
import { FileStore } from '../src/store/file-store'
import { InMemoryStore } from '../src/store/memory-store'
import { PostgresStore } from '../src/store/postgres-store'
import { Store, StoreTransaction } from '../src/store/store'
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

// The buyer pays with a fresh wx.login code of the signed-in WeChat account.
function payer(context: Awaited<ReturnType<typeof setup>>) {
  return context.auth.payerSession(context.session.user.id, 'alice-login-code')
}

/** The xpay_goods_deliver_notify WeChat would push for an attempt, as the push service parses it. */
function deliveryFor(context: Awaited<ReturnType<typeof setup>>, outTradeNo: string, overrides: Record<string, unknown> = {}): TransactionResult {
  const push = parseXpayPush(context.mockPay.deliveryEvent(outTradeNo, overrides))
  assert.ok(push.kind === 'DELIVER')
  return push.transaction
}

function refundPushFor(context: Awaited<ReturnType<typeof setup>>, outRefundNo: string, overrides: Record<string, unknown> = {}) {
  const push = parseXpayPush(context.mockPay.refundEvent(outRefundNo, overrides))
  assert.ok(push.kind === 'REFUND')
  return push.refund
}

async function createPaid(context: Awaited<ReturnType<typeof setup>>) {
  const { submitted } = await createSubmitted(context)
  const order = await context.orders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: `purchase-${submitted.assessmentId}`
  })
  const payment = await context.orders.createVirtualPayment(context.session.user.id, order.orderId, await payer(context))
  assert.equal(payment.status, 'PENDING')
  context.mockPay.setOrderState(payment.outTradeNo, 'SUCCESS')
  const delivery = deliveryFor(context, payment.outTradeNo)
  await context.orders.handleDelivery(delivery)
  return { order, submitted, delivery }
}

test('student profile age accepts numbers and strings, normalizes blanks, and rejects invalid values', async () => {
  const context = await setup()

  for (const age of [null, '', '   ']) {
    const student = await context.profiles.createStudent(context.session.user.id, { age })
    assert.equal(student.age, null)
  }

  for (const [input, expected] of [[3, 3], [100, 100], [' 16 ', 16]] as const) {
    const student = await context.profiles.createStudent(context.session.user.id, { age: input })
    assert.equal(student.age, expected)
  }

  for (const age of [2, 101, 16.5, '2', '101', '16.5', 'not-a-number', '1e2', '0x10', '+16']) {
    await assert.rejects(
      context.profiles.createStudent(context.session.user.id, { age }),
      (error: unknown) => error instanceof AppError && error.status === 400 && error.code === 'INVALID_PROFILE'
    )
  }

  await assert.rejects(
    context.profiles.createStudent(context.session.user.id, { age: true as unknown as string }),
    (error: unknown) => error instanceof AppError && error.status === 400 && error.code === 'INVALID_PROFILE'
  )
})

test('student profile education system canonicalizes codes and legacy labels', async () => {
  const context = await setup()
  const cases = [
    ['GAOKAO', 'GAOKAO'], ['DSE', 'DSE'], ['IGCSE', 'IGCSE'], ['A_LEVEL', 'A_LEVEL'],
    ['AP_US', 'AP_US'], ['IB', 'IB'], ['OTHER', 'OTHER'],
    ['内地课程', 'GAOKAO'], ['内地课程／高考', 'GAOKAO'], ['A-Level', 'A_LEVEL'],
    ['内地课程/高考', 'GAOKAO'], ['高考', 'GAOKAO'], ['A LEVEL', 'A_LEVEL'],
    ['AP / 美式课程', 'AP_US'], ['AP／美式课程', 'AP_US'], ['AP／美国课程', 'AP_US'],
    ['美式课程', 'AP_US'], ['其他', 'OTHER'], ['其他体系', 'OTHER']
  ] as const

  for (const [input, expected] of cases) {
    const student = await context.profiles.createStudent(context.session.user.id, { educationSystem: input })
    assert.equal(student.educationSystem, expected)
  }

  for (const educationSystem of [null, '', '   ']) {
    const student = await context.profiles.createStudent(context.session.user.id, { educationSystem })
    assert.equal(student.educationSystem, null)
  }

  await assert.rejects(
    context.profiles.createStudent(context.session.user.id, { educationSystem: 'UNKNOWN_SYSTEM' }),
    (error: unknown) => error instanceof AppError && error.status === 400 && error.code === 'INVALID_PROFILE'
  )
})

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
  assert.equal(loadConfig(base).listenHost, '127.0.0.1')
  assert.equal(loadConfig({ ...base, LISTEN_HOST: '0.0.0.0' }).listenHost, '0.0.0.0')
  assert.throws(() => loadConfig({ ...base, LISTEN_HOST: 'localhost' }), (error: unknown) => error instanceof AppError && error.code === 'CONFIG_INVALID')
  assert.equal(loadConfig({ ...base, PAID_COMPASS_ENABLED: 'true' }).paidCompassEnabled, true)
  assert.throws(() => loadConfig({ ...base, PAID_COMPASS_ENABLED: 'yes' }), (error: unknown) => error instanceof AppError && error.code === 'CONFIG_INVALID')
})

test('production config pins verified TLS database and the live virtual payment environment', () => {
  const production = {
    NODE_ENV: 'production', SESSION_SECRET: sessionSecret, PAYMENT_PROVIDER: 'wechat',
    DATABASE_URL: 'postgresql://phoenix:secret@db.example.com/phoenix?sslmode=verify-full',
    WECHAT_APP_ID: 'wx1234567890abcdef', WECHAT_APP_SECRET: 'app-secret', PUBLIC_BASE_URL: 'https://api.example.com',
    WECHAT_XPAY_OFFER_ID: '1450664905', WECHAT_XPAY_APP_KEY: 'synthetic-live-app-key-0001',
    WECHAT_MESSAGE_TOKEN: 'synthetictoken01', WECHAT_MESSAGE_AES_KEY: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
    SOURCE_CATALOG_MODE: 'verified', SOURCE_CATALOG_PATH: '/run/config/source-catalog.json'
  }
  const invalid = (error: unknown) => error instanceof AppError && error.code === 'CONFIG_INVALID'
  const loaded = loadConfig(production)
  assert.equal(loaded.listenHost, '127.0.0.1')
  assert.equal(loaded.virtualPaymentEnv, 0, 'production defaults to the live environment')
  // 道具管理 accepts item IDs of at most 20 characters.
  assert.equal(loaded.virtualPaymentGrowthProductId, 'EC_GROWTH_REPORT_V1')
  assert.throws(() => loadConfig({ ...production, WECHAT_XPAY_GROWTH_PRODUCT_ID: 'A'.repeat(21) }), invalid)
  assert.throws(() => loadConfig({ ...production, LISTEN_HOST: '0.0.0.0' }), invalid)
  assert.throws(() => loadConfig({ ...production, DATABASE_URL: 'postgresql://db.example.com/phoenix?sslmode=require' }), invalid)
  assert.throws(() => loadConfig({ ...production, WECHAT_XPAY_ENV: '1' }), invalid, 'production never pays in the sandbox')
  assert.throws(() => loadConfig({ ...production, WECHAT_XPAY_APP_KEY: '' }), invalid)
  assert.throws(() => loadConfig({ ...production, WECHAT_XPAY_APP_KEY: sessionSecret }), invalid, 'the AppKey is not shared with other secrets')
  assert.throws(() => loadConfig({ ...production, WECHAT_XPAY_OFFER_ID: 'offer' }), invalid)
  assert.throws(() => loadConfig({ ...production, WECHAT_MESSAGE_TOKEN: 'a!' }), invalid)
  assert.throws(() => loadConfig({ ...production, WECHAT_MESSAGE_AES_KEY: 'too-short' }), invalid)
  assert.equal(loadConfig({ ...production, NODE_ENV: 'test', WECHAT_XPAY_ENV: '1', DATABASE_URL: '' }).virtualPaymentEnv, 1)
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
  assert.equal(locked?.sourceCatalogVersion, catalog.version)
  assert.equal(locked?.dataAsOf, catalog.dataAsOf)
  assert.deepEqual(locked?.versions, {
    studentVersion: context.student.studentVersion,
    ruleVersion: 'education-rules-v1',
    dataVersion: catalog.version,
    promptVersion: 'deterministic-explanation-v1',
    templateVersion: 'compass-six-modules-v1'
  })
  assert.deepEqual(locked?.sources, [
    {
      sourceId: `USER_INPUT:${assessment.id}`,
      applicableYear: catalog.dataAsOf.slice(0, 4),
      verifiedAt: catalog.dataAsOf,
      dataVersion: 'education_compass_v1'
    },
    {
      sourceId: 'PHOENIX_RULESET:EDUCATION_V1',
      applicableYear: catalog.dataAsOf.slice(0, 4),
      verifiedAt: catalog.dataAsOf,
      dataVersion: 'rules-v1'
    },
    {
      sourceId: 'HKU-UG-ADMISSIONS-2026',
      applicableYear: '2026',
      verifiedAt: '2026-08-19',
      dataVersion: catalog.version
    }
  ])
  assert.deepEqual(locked?.modules?.map((module) => module.key), [
    'student_profile', 'strengths', 'major_directions', 'university_match', 'routes', 'action_plan'
  ])
  const job = await context.store.read((tx) => tx.findOne('reportJobs', { reportId: submitted.reportId }))
  assert.equal(job?.status, 'SUCCEEDED')
  assert.equal(job?.orderId, null)
})

test('report QA rejects every prohibited admissions promise phrase', () => {
  const keys = ['student_profile', 'strengths', 'major_directions', 'university_match', 'routes', 'action_plan'] as const
  for (const phrase of ['保证', '一定录取', '保录', '稳进', '保底', '百分百', '录取率']) {
    const modules = keys.map((key, index) => ({
      key,
      title: `模块${index + 1}`,
      summary: index === 3 ? `违规表述：${phrase}` : '合成安全说明',
      items: []
    }))
    assert.throws(() => assertReportQa(modules), (error: unknown) =>
      error instanceof AppError && error.code === 'REPORT_QA_FAILED', phrase)
  }
})

test('assessment submit independently rejects a generator that forges QA or report provenance', async () => {
  const context = await setup()
  const assessment = await context.assessments.create(context.session.user.id, context.student.id, {
    familyId: context.family.id,
    questionnaireVersion: 'education_compass_v1',
    studentVersion: context.student.studentVersion,
    consent: {
      consentVersion: 'education_compass_guardian_v1',
      scope: 'education_compass_report',
      guardianConfirmed: true
    }
  })
  await context.assessments.saveDraft(context.session.user.id, assessment.id, validAnswers)

  const forgedQa = new AssessmentService(context.store, catalog, clock, randomId, (shell, current, student, now) => {
    const report = generateSixModuleReport(shell, current, student, now)
    report.modules![0]!.summary = '保证获得目标学校录取'
    report.qaPassed = true
    return report
  })
  await expectCode(forgedQa.submit(context.session.user.id, assessment.id), 'REPORT_QA_FAILED')

  const forgedSource = new AssessmentService(context.store, catalog, clock, randomId, (shell, current, student, now) => {
    const report = generateSixModuleReport(shell, current, student, now)
    report.sources.push({
      sourceId: 'UNAPPROVED-CANDIDATE-FACT', applicableYear: '2099',
      verifiedAt: '2099-01-01', dataVersion: 'unreviewed'
    })
    return report
  })
  await expectCode(forgedSource.submit(context.session.user.id, assessment.id), 'REPORT_QA_FAILED')
  const persisted = await context.assessments.getDraft(context.session.user.id, assessment.id)
  assert.equal(persisted.status, 'DRAFT')
  assert.equal((await context.store.read((tx) => tx.findMany('reports', { assessmentId: assessment.id }))).length, 0)
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

test('prepay independently rechecks launch switch, source catalog, report QA, consent, and active product', async () => {
  const switchedOff = await setup()
  const switchedOffSubmitted = await createSubmitted(switchedOff)
  const switchedOffOrder = await switchedOff.orders.createOrder(
    switchedOff.session.user.id,
    switchedOffSubmitted.submitted.assessmentId,
    { productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'prepay-kill-switch' }
  )
  const disabledPrepay = new OrderService(switchedOff.store, switchedOff.mockPay, catalog, false, clock)
  await expectCode(
    disabledPrepay.createVirtualPayment(switchedOff.session.user.id, switchedOffOrder.orderId, await payer(switchedOff)),
    'PAID_COMPASS_DISABLED'
  )

  const catalogChanged = await setup()
  const catalogChangedSubmitted = await createSubmitted(catalogChanged)
  const catalogChangedOrder = await catalogChanged.orders.createOrder(
    catalogChanged.session.user.id,
    catalogChangedSubmitted.submitted.assessmentId,
    { productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'prepay-source-catalog' }
  )
  const unverifiedPrepay = new OrderService(
    catalogChanged.store,
    catalogChanged.mockPay,
    PLACEHOLDER_SOURCE_CATALOG,
    true,
    clock
  )
  await expectCode(
    unverifiedPrepay.createVirtualPayment(catalogChanged.session.user.id, catalogChangedOrder.orderId, await payer(catalogChanged)),
    'SOURCE_CATALOG_NOT_VERIFIED'
  )

  const qaChanged = await setup()
  const qaChangedSubmitted = await createSubmitted(qaChanged)
  const qaChangedOrder = await qaChanged.orders.createOrder(
    qaChanged.session.user.id,
    qaChangedSubmitted.submitted.assessmentId,
    { productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'prepay-report-qa' }
  )
  await qaChanged.store.transaction(async (tx) => {
    await tx.update('reports', qaChangedSubmitted.submitted.reportId, { qaPassed: false })
  })
  await expectCode(
    qaChanged.orders.createVirtualPayment(qaChanged.session.user.id, qaChangedOrder.orderId, await payer(qaChanged)),
    'REPORT_QA_REQUIRED'
  )

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
  await expectCode(revoked.orders.createVirtualPayment(revoked.session.user.id, revokedOrder.orderId, await payer(revoked)), 'GUARDIAN_CONSENT_REQUIRED')

  const disabled = await setup()
  const disabledSubmitted = await createSubmitted(disabled)
  const disabledOrder = await disabled.orders.createOrder(disabled.session.user.id, disabledSubmitted.submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'prepay-disabled-product'
  })
  await disabled.store.transaction(async (tx) => { await tx.update('products', 'COMPASS_REPORT_SINGLE_39_9', { active: false }) })
  await expectCode(disabled.orders.createVirtualPayment(disabled.session.user.id, disabledOrder.orderId, await payer(disabled)), 'PRODUCT_UNAVAILABLE')
})

test('concurrent duplicate order creation is idempotent and membership SKU cannot unlock a report', async () => {
  const context = await setup()
  const { submitted } = await createSubmitted(context)
  const input = {
    productCode: 'COMPASS_REPORT_SINGLE_39_9',
    idempotencyKey: 'concurrent-order-key'
  }
  const orders = await Promise.all(Array.from({ length: 20 }, () =>
    context.orders.createOrder(context.session.user.id, submitted.assessmentId, input)
  ))
  assert.equal(new Set(orders.map((order) => order.orderId)).size, 1)
  assert.equal((await context.store.read((tx) => tx.findMany('orders', {
    userId: context.session.user.id,
    assessmentId: submitted.assessmentId
  }))).length, 1)
  await expectCode(context.orders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'PHOENIX_MEMBER_199', idempotencyKey: 'membership-not-report'
  }), 'PRODUCT_NOT_SUPPORTED')
})

test('server query reconciliation is throttled, recovers a missing callback, and cancels expired NOTPAY orders', async () => {
  const context = await setup()
  const { submitted } = await createSubmitted(context)
  const order = await context.orders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'query-recovery-order'
  })
  await context.orders.createVirtualPayment(context.session.user.id, order.orderId, await payer(context))
  const originalQuery = context.mockPay.queryAttempt.bind(context.mockPay)
  let queryCount = 0
  context.mockPay.queryAttempt = async (outTradeNo: string) => { queryCount += 1; return originalQuery(outTradeNo) }
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId)).status, 'PENDING')
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId)).status, 'PENDING')
  assert.equal(queryCount, 1, 'repeated client polling must not repeatedly query WeChat')
  await context.store.transaction(async (tx) => { await tx.update('orders', order.orderId, { lastProviderQueryAt: '2026-08-20T09:00:00.000Z' }) })
  context.mockPay.setOrderState(order.outTradeNo, 'SUCCESS')
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId)).status, 'PAID')
  assert.equal(queryCount, 2)
  assert.equal((await context.reports.get(context.session.user.id, submitted.reportId)).access, 'full')
  assert.equal(context.mockPay.isDelivered(order.outTradeNo), true, 'a payment settled by query is reported as delivered')

  const second = await setup()
  const secondSubmitted = await createSubmitted(second)
  const expiring = await second.orders.createOrder(second.session.user.id, secondSubmitted.submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'expired-notpay-order'
  })
  await second.orders.createVirtualPayment(second.session.user.id, expiring.orderId, await payer(second))
  const queryWithoutOptionalPendingFields = second.mockPay.queryAttempt.bind(second.mockPay)
  second.mockPay.queryAttempt = async (outTradeNo: string) => {
    const result = await queryWithoutOptionalPendingFields(outTradeNo)
    if (result.tradeState !== 'NOTPAY') return result
    const { totalFen: _totalFen, payerOpenid: _payerOpenid, ...officialOptionalShape } = result
    return officialOptionalShape
  }
  await second.store.transaction(async (tx) => {
    await tx.update('orders', expiring.orderId, { expiresAt: '2026-08-20T09:00:00.000Z', lastProviderQueryAt: null })
  })
  assert.equal((await second.orders.getOrder(second.session.user.id, expiring.orderId)).status, 'CANCELLED')
  // Virtual payment has no close call: the expired, unpaid order is cancelled on our side only.
  assert.equal((await second.mockPay.queryAttempt(expiring.outTradeNo)).tradeState, 'NOTPAY')
})

test('3990 payment callback is idempotent and only delivers the already-QA-passed report', async () => {
  const context = await setup()
  const { order, submitted, delivery } = await createPaid(context)
  await Promise.all(Array.from({ length: 20 }, () => context.orders.handleDelivery(delivery)))
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

  await expectCode(context.orders.handleDelivery({ ...delivery, totalFen: 1 }), 'PAYMENT_EVENT_CONFLICT')
})

test('forged transaction fields and cross-user resource access never grant paid content', async () => {
  const context = await setup()
  const { submitted } = await createSubmitted(context)
  const order = await context.orders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'negative-callback-order'
  })
  await context.orders.createVirtualPayment(context.session.user.id, order.orderId, await payer(context))
  context.mockPay.setOrderState(order.outTradeNo, 'SUCCESS')
  const valid = deliveryFor(context, order.outTradeNo)
  const cases: Array<[string, Partial<TransactionResult>, string]> = [
    ['bad-env', { env: 0 }, 'PAYMENT_ENV_MISMATCH'],
    ['bad-attempt', { outTradeNo: `PX${'0'.repeat(30)}` }, 'PAYMENT_ATTEMPT_UNKNOWN'],
    ['bad-amount', { totalFen: 1 }, 'PAYMENT_AMOUNT_MISMATCH'],
    ['bad-product', { productId: 'SOME_OTHER_ITEM' }, 'PAYMENT_PRODUCT_MISMATCH'],
    ['bad-payer', { payerOpenid: 'openid_wrong' }, 'PAYMENT_PAYER_MISMATCH'],
    ['missing-tx', { transactionId: '' }, 'PAYMENT_TRANSACTION_ID_MISSING']
  ]
  for (const [suffix, changes, code] of cases) {
    await expectCode(context.orders.handleDelivery({ ...valid, ...changes, eventId: `negative-${suffix}` }), code)
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
  const refundPush = refundPushFor(context, refund.outRefundNo)
  await context.orders.handleRefundPush(refundPush)
  const repeated = await context.orders.handleRefundPush(refundPush)
  assert.equal(repeated.ignored, false)
  assert.equal((await context.store.read((tx) => tx.findMany('paymentEvents', { eventKind: 'REFUND' }))).length, 1, 'a repeated refund push is applied once')
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
  const successful = refundPushFor(context, refund.outRefundNo)
  for (const refundStatus of ['PROCESSING', 'CLOSED', 'ABNORMAL'] as const) {
    await context.orders.handleRefundPush({ ...successful, eventId: `stale-after-success-${refundStatus}`, refundStatus })
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
    await context.orders.handleRefundPush(refundPushFor(context, refund.outRefundNo))
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

test('portable store does not expose a transaction whose durable commit hook failed', async () => {
  class RejectingCommitStore extends InMemoryStore {
    rejectCommits = true

    protected override async afterCommit(): Promise<void> {
      if (this.rejectCommits) throw new Error('simulated durable write failure')
    }
  }

  const store = new RejectingCommitStore()
  await assert.rejects(store.transaction(async (tx) => {
    await tx.insert('users', { id: 'usr_failed_commit', role: 'family_user', createdAt: clock().toISOString() })
  }), /simulated durable write failure/)
  assert.equal(await store.read((tx) => tx.findById('users', 'usr_failed_commit')), null)

  store.rejectCommits = false
  await store.transaction(async (tx) => {
    await tx.insert('users', { id: 'usr_committed', role: 'family_user', createdAt: clock().toISOString() })
  })
  assert.equal((await store.read((tx) => tx.findById('users', 'usr_committed')))?.id, 'usr_committed')
})

test('account deletion removes personal data, keeps the financial record, and cannot run twice', async () => {
  const context = await setup()
  const { order } = await createPaid(context)
  const userId = context.session.user.id
  const accounts = new AccountService(context.store, clock)

  const before = await context.store.read(async (tx) => ({
    families: await tx.findMany('families', { userId }),
    students: await tx.findMany('students', { familyId: context.family.id }),
    assessments: await tx.findMany('assessments', { userId }),
    reports: await tx.findMany('reports', { userId }),
    identities: await tx.findMany('wechatIdentities', { userId }),
    sessions: await tx.findMany('sessions', { userId }),
    entitlements: await tx.findMany('entitlements', { userId })
  }))
  assert.ok(before.families.length && before.students.length && before.assessments.length &&
    before.reports.length && before.identities.length && before.entitlements.length,
    'the fixture must actually contain personal data before deletion is meaningful')

  // 幂等记录：夹具里的旧式下单不写这张表，手动放一条，否则下面的断言是空转。
  await context.store.transaction(async (tx) => {
    await tx.insert('idempotencyRecords', {
      id: 'idem_deletion_probe', userId, domain: 'ORDER_CREATE', keyDigest: 'k', inputDigest: 'i',
      status: 'COMPLETED', resourceType: 'order', resourceId: order.orderId, responseStatus: 201,
      responseDigest: 'r', createdAt: clock().toISOString(), updatedAt: clock().toISOString(), completedAt: clock().toISOString()
    })
  })

  const receipt = await accounts.deleteAccount(userId)
  assert.equal(receipt.retainedOrders, 1)

  const after = await context.store.read(async (tx) => ({
    families: await tx.findMany('families', { userId }),
    students: await tx.findMany('students', { familyId: context.family.id }),
    assessments: await tx.findMany('assessments', { userId }),
    reports: await tx.findMany('reports', { userId }),
    consents: await tx.findMany('consents', { userId }),
    identities: await tx.findMany('wechatIdentities', { userId }),
    sessions: await tx.findMany('sessions', { userId }),
    timeline: await tx.findMany('timelineEvents', { userId }),
    orders: await tx.findMany('orders', { userId }),
    entitlements: await tx.findMany('entitlements', { userId }),
    user: await tx.findById('users', userId),
    audit: await tx.findMany('auditLogs', { entityId: userId })
  }))

  // 个人数据必须删干净
  assert.deepEqual(after.families, [])
  assert.deepEqual(after.students, [])
  assert.deepEqual(after.assessments, [])
  assert.deepEqual(after.reports, [])
  assert.deepEqual(after.consents, [])
  assert.deepEqual(after.timeline, [])
  assert.deepEqual(after.identities, [], 'the openid link to a real person must not survive deletion')
  assert.deepEqual(after.sessions, [], 'every session must be revoked')
  assert.deepEqual(await context.store.read((tx) => tx.findMany('idempotencyRecords', { userId })), [],
    'idempotency records hold digests of personal input and outlive their purpose once the account is gone')

  // 财务凭证必须留下，且与个人数据脱钩
  assert.equal(after.orders.length, 1)
  assert.equal(after.orders[0]!.id, order.orderId)
  assert.equal(after.orders[0]!.amountFen, 3990)
  assert.equal(after.orders[0]!.status, 'PAID')
  assert.equal(after.orders[0]!.familyId, null)
  assert.equal(after.orders[0]!.studentId, null)
  assert.equal(after.orders[0]!.assessmentId, null)
  assert.equal(after.orders[0]!.reportId, null)
  assert.equal(after.entitlements.length, 1)
  assert.equal(after.entitlements[0]!.reportId, null)

  // users 行保留但只剩下没有个人信息的字段
  assert.ok(after.user?.deletedAt, 'the tombstone must record when the account was closed')
  assert.deepEqual(Object.keys(after.user ?? {}).sort(), ['createdAt', 'deletedAt', 'id', 'role'])

  // 审计记录只留数量，不留个人信息
  const entry = after.audit.find((row) => row.action === 'ACCOUNT_DELETED')
  assert.ok(entry, 'deletion must be auditable')
  assert.equal(entry?.actorUserId, null)
  const metadata = JSON.stringify(entry?.metadata ?? {})
  assert.ok(!metadata.includes('13800000000') && !metadata.includes('示例学校'),
    'the audit trail must not become the place personal data survives deletion')

  // 不可重复执行
  await expectCode(accounts.deleteAccount(userId), 'ACCOUNT_ALREADY_DELETED')
})

test('an order detached by account deletion cannot re-enter a business flow', async () => {
  const context = await setup()
  // 用未支付订单：已支付的订单在更早的状态检查就被拒，走不到脱钩守卫。
  const { submitted } = await createSubmitted(context)
  const order = await context.orders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: `detached-${submitted.assessmentId}`
  })
  // Two more purchases that already have a signed payment attempt. Once detached, all three share a
  // null assessment, which PostgreSQL's one-active-purchase index does not treat as equal.
  const waitingOrders = []
  for (let i = 0; i < 2; i += 1) {
    const other = await createSubmitted(context)
    const created = await context.orders.createOrder(context.session.user.id, other.submitted.assessmentId, {
      productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: `detached-${other.submitted.assessmentId}`
    })
    await context.orders.createVirtualPayment(context.session.user.id, created.orderId, await payer(context))
    waitingOrders.push(created)
  }
  const waiting = waitingOrders[0]!
  const accounts = new AccountService(context.store, clock)
  await accounts.deleteAccount(context.session.user.id)

  const detached = await context.store.read((tx) => tx.findById('orders', order.orderId))
  assert.equal(detached?.amountFen, 3990, 'the financial record must survive')
  assert.equal(detached?.assessmentId, null, 'but it must no longer point at personal data')
  // Nothing was signed for it, so no payment can arrive: it is closed rather than left open forever.
  assert.equal(detached?.status, 'CANCELLED')
  await expectCode(
    context.orders.createVirtualPayment(context.session.user.id, order.orderId, { openid: 'deleted', sessionKey: 'deleted' }),
    'ORDER_NOT_PAYABLE'
  )

  // A signed attempt may still be paid, so that order keeps its state.
  const stillWaiting = await context.store.read((tx) => tx.findById('orders', waiting.orderId))
  assert.equal(stillWaiting?.status, 'PENDING')
  // 需要个人数据的流程必须明确拒绝，而不是拿着 null 去查库、报出难以追查的错。
  // The identity is gone with the account, so the payer is synthetic: the order guard answers first.
  await expectCode(
    context.orders.createVirtualPayment(context.session.user.id, waiting.orderId, { openid: 'deleted', sessionKey: 'deleted' }),
    'ORDER_DETACHED'
  )
})

test('refund window closes after seven days or once the PDF is downloaded, and merchant fault overrides both', async () => {
  const context = await setup()
  const adminId = 'usr_admin_window'
  await context.store.transaction(async (tx) => {
    await tx.insert('users', { id: adminId, role: 'admin', createdAt: clock().toISOString() })
  })

  // 1. 窗口内、未下载 → 允许
  const inWindow = await createPaid(context)
  const refund = await context.orders.requestRefund(adminId, inWindow.order.orderId, {
    idempotencyKey: 'window-ok-0001', reason: '窗口内未下载'
  })
  assert.equal(refund.status, 'PROCESSING')

  // 2. 支付超过 7 天 → 拒绝
  const expired = await setup()
  const expiredPaid = await createPaid(expired)
  await expired.store.transaction(async (tx) => {
    await tx.insert('users', { id: adminId, role: 'admin', createdAt: clock().toISOString() })
    await tx.update('orders', expiredPaid.order.orderId, {
      paidAt: new Date(clock().getTime() - 8 * 86_400_000).toISOString()
    })
  })
  await expectCode(expired.orders.requestRefund(adminId, expiredPaid.order.orderId, {
    idempotencyKey: 'window-expired-1', reason: '超期退款'
  }), 'REFUND_WINDOW_EXPIRED')

  // 我方原因豁免窗口
  const merchantFault = await expired.orders.requestRefund(adminId, expiredPaid.order.orderId, {
    idempotencyKey: 'window-expired-2', reason: '来源目录撤回', policyException: 'MERCHANT_FAULT'
  })
  assert.equal(merchantFault.status, 'PROCESSING')
  const audit = await expired.store.read((tx) => tx.findMany('auditLogs', { entityId: expiredPaid.order.orderId }))
  const requested = audit.find((row) => row.action === 'refund_requested')
  assert.equal((requested?.metadata as Record<string, unknown>)?.policyException, 'MERCHANT_FAULT',
    'bypassing the window must be recorded, or nobody can later answer why this one was refundable')

  // 3. 已下载 PDF → 拒绝
  const downloaded = await setup()
  const downloadedPaid = await createPaid(downloaded)
  await downloaded.store.transaction(async (tx) => {
    await tx.insert('users', { id: adminId, role: 'admin', createdAt: clock().toISOString() })
  })
  const downloadedReportId = downloadedPaid.order.reportId
  assert.ok(downloadedReportId, 'a paid order must still carry its report id')
  const pdf = await downloaded.reports.pdf(downloaded.session.user.id, downloadedReportId)
  assert.ok(pdf.length > 0)
  const afterDownload = await downloaded.store.read((tx) => tx.findById('reports', downloadedReportId))
  assert.ok(afterDownload?.pdfFirstDownloadedAt, 'the first download must be recorded, or the policy has nothing to read')

  await expectCode(downloaded.orders.requestRefund(adminId, downloadedPaid.order.orderId, {
    idempotencyKey: 'downloaded-1', reason: '已下载后退款'
  }), 'REFUND_REPORT_DOWNLOADED')

  const forced = await downloaded.orders.requestRefund(adminId, downloadedPaid.order.orderId, {
    idempotencyKey: 'downloaded-2', reason: '报告事实错误', policyException: 'MERCHANT_FAULT'
  })
  assert.equal(forced.status, 'PROCESSING')
})

test('the first PDF download timestamp does not drift on later downloads', async () => {
  const context = await setup()
  const { order } = await createPaid(context)
  const reportId = order.reportId
  assert.ok(reportId, 'a paid order must still carry its report id')
  await context.reports.pdf(context.session.user.id, reportId)
  const first = await context.store.read((tx) => tx.findById('reports', reportId))
  await context.reports.pdf(context.session.user.id, reportId)
  const second = await context.store.read((tx) => tx.findById('reports', reportId))
  assert.equal(second?.pdfFirstDownloadedAt, first?.pdfFirstDownloadedAt,
    '"first downloaded" must stay the first, otherwise the refund window silently reopens')
})

test('an in-flight refund can always be retried, whatever the window says', async () => {
  const context = await setup()
  const { order } = await createPaid(context)
  const adminId = 'usr_admin_retry'
  await context.store.transaction(async (tx) => {
    await tx.insert('users', { id: adminId, role: 'admin', createdAt: clock().toISOString() })
  })
  const started = await context.orders.requestRefund(adminId, order.orderId, {
    idempotencyKey: 'retry-0001', reason: '窗口内发起'
  })
  // 退款已在途；此时窗口过期不该把它卡死在中间状态。
  await context.store.transaction(async (tx) => {
    await tx.update('orders', order.orderId, {
      paidAt: new Date(clock().getTime() - 30 * 86_400_000).toISOString()
    })
  })
  const retried = await context.orders.requestRefund(adminId, order.orderId, {
    idempotencyKey: 'retry-0002', reason: '超期后重试同一笔'
  })
  assert.equal(retried.id, started.id, 'a retry must reuse the in-flight refund rather than be rejected')
})

test('personal data export covers the account, excludes credentials, and never leaks another user', async () => {
  const context = await setup()
  const { order, submitted } = await createPaid(context)

  // 第二个用户，用来证明导出以 userId 为界
  const other = await context.auth.createWechatSession('bob-login-code')
  const otherProfiles = new ProfileService(context.store, clock)
  await otherProfiles.upsertFamily(other.user.id, {
    familyName: '另一个家庭', parentName: '另一位家长', phone: '13700000000', location: '深圳', goal: '不该出现在别人的导出里'
  })

  const exports = new ExportService(context.store, clock)
  const bundle = await exports.exportForUser(context.session.user.id)
  const data = bundle.data as Record<string, unknown>

  assert.equal(bundle.schema, 'phoenix_education_compass_personal_data_export_v1')
  assert.ok(bundle.exportedAt)

  // 覆盖到该用户的实际数据
  assert.equal((data.families as unknown[]).length, 1)
  assert.equal((data.students as unknown[]).length, 1)
  assert.equal((data.assessments as unknown[]).length, 1)
  assert.equal((data.reports as unknown[]).length, 1)
  assert.equal((data.orders as unknown[]).length, 1)
  assert.equal((data.guardianConsents as unknown[]).length, 1)

  // 问卷答案必须真的在里面——导出一份没有答案的"答案"没有意义
  const assessment = (data.assessments as Array<Record<string, unknown>>)[0]
  assert.equal(assessment?.id, submitted.assessmentId)
  assert.ok(assessment?.answers && Object.keys(assessment.answers as object).length > 0)

  const serialized = JSON.stringify(bundle)

  // 凭据类字段必须缺席。断言真实值而不是字段名——"openid" 这个词本身会出现在
  // 下面的排除说明里，按词匹配会把说明文字误判成泄露。
  const credentials = await context.store.read(async (tx) => ({
    identity: (await tx.findMany('wechatIdentities', { userId: context.session.user.id }))[0],
    session: (await tx.findMany('sessions', { userId: context.session.user.id }))[0]
  }))
  assert.ok(credentials.identity?.openid, 'the fixture must actually have an openid for this check to mean anything')
  assert.ok(!serialized.includes(credentials.identity.openid),
    'the WeChat account identifier must not travel in an export file')
  assert.ok(credentials.session?.tokenHash)
  assert.ok(!serialized.includes(credentials.session.tokenHash),
    'session credentials are authentication material, not personal data')

  // 排除项要写明，而不是悄悄省略
  const excluded = bundle.excludedFields as Array<Record<string, string>>
  assert.ok(excluded.some((item) => item.field.includes('openid') && item.reason.length > 0))

  // 另一个用户的数据一条都不能出现
  assert.ok(!serialized.includes('另一个家庭'))
  assert.ok(!serialized.includes('13700000000'))
  assert.ok(!serialized.includes(other.user.id))

  // 本人的数据确实在
  assert.ok(serialized.includes('13800000000'))
  assert.ok(serialized.includes(order.orderId))
})

test('export refuses a deleted account and states the AI gap honestly when the agent is off', async () => {
  const context = await setup()
  await createSubmitted(context)
  const exports = new ExportService(context.store, clock)

  // Agent 未启用时，如实标注而不是假装这部分不存在
  const bundle = await exports.exportForUser(context.session.user.id)
  const ai = (bundle.data as Record<string, unknown>).aiConversations as Record<string, unknown>
  assert.equal(ai.exported, false)
  assert.ok(String(ai.reason).length > 0, 'an un-exported section must say why')

  // 注销之后没有可导出的东西，且要明确区别于"账号不存在"
  await new AccountService(context.store, clock).deleteAccount(context.session.user.id)
  await expectCode(exports.exportForUser(context.session.user.id), 'ACCOUNT_DELETED')
  await expectCode(exports.exportForUser('usr_never_existed'), 'USER_NOT_FOUND')
})

test('assessments are deleted children-first so no RESTRICT reference is ever violated', () => {
  const level1 = { id: 'asm_l1', sourceAssessmentId: null }
  const level2 = { id: 'asm_l2', sourceAssessmentId: 'asm_l1' }
  const level3 = { id: 'asm_l3', sourceAssessmentId: 'asm_l2' }
  const loose = { id: 'asm_x', sourceAssessmentId: null }
  const order = dependencyOrder([level1, loose, level2, level3]).map((item) => item.id)
  assert.ok(order.indexOf('asm_l3') < order.indexOf('asm_l2'), 'level 3 must go before the level 2 it references')
  assert.ok(order.indexOf('asm_l2') < order.indexOf('asm_l1'), 'level 2 must go before the level 1 it references')
  assert.equal(order.length, 4)
  // 数据里不该有环；真出现时不能死循环，要把剩下的交给数据库报出真实错误。
  assert.equal(dependencyOrder([{ id: 'a', sourceAssessmentId: 'b' }, { id: 'b', sourceAssessmentId: 'a' }]).length, 2)
})

test('account deletion never UPDATEs an assessment, because the v005 trigger re-validates on update', async () => {
  const context = await setup()
  const { submitted } = await createPaid(context)
  // 造一条真实的引用链：第二级测评的 sourceAssessmentId 指向第一级。
  // 没有这条链，"先置空再删"的旧逻辑一次 UPDATE 都不会发出，测试就是空转。
  const childId = 'asm_level2_child'
  await context.store.transaction(async (tx) => {
    const parent = await tx.findById('assessments', submitted.assessmentId)
    assert.ok(parent)
    await tx.insert('assessments', { ...parent, id: childId, reportId: null, sourceAssessmentId: parent.id })
  })
  const deletedAssessments: string[] = []
  const updatedTables: string[] = []
  const spying: Store = {
    read: (work) => context.store.read(work),
    transaction: (work) => context.store.transaction((tx) => work({
      ...tx,
      findById: tx.findById.bind(tx), findOne: tx.findOne.bind(tx), findMany: tx.findMany.bind(tx),
      insert: tx.insert.bind(tx),
      delete: (table, id) => { if (table === 'assessments') deletedAssessments.push(id); return tx.delete(table, id) },
      update: (table, id, changes) => { updatedTables.push(table); return tx.update(table, id, changes) }
    } as StoreTransaction))
  }
  await new AccountService(spying, clock).deleteAccount(context.session.user.id)
  // 内存库没有触发器，测不出数据库会拒绝；所以把规则本身钉住：
  // 注销时 assessments 只能 DELETE。在真实库上 UPDATE 它会撞上
  // assessments_consent_links_v005_trigger，整个注销事务回滚。
  assert.ok(!updatedTables.includes('assessments'), `assessments must not be updated during deletion, got: ${updatedTables.join(',')}`)
  assert.ok(deletedAssessments.indexOf(childId) >= 0 && deletedAssessments.indexOf(childId) < deletedAssessments.indexOf(submitted.assessmentId),
    `the referencing level 2 must be deleted before its level 1 source, got: ${deletedAssessments.join(',')}`)
})

test('a retried virtual payment gets a new order number, and a late delivery for the earlier attempt still settles the order once', async () => {
  const context = await setup()
  const { submitted } = await createSubmitted(context)
  const order = await context.orders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'retry-attempt-order'
  })
  const first = await context.orders.createVirtualPayment(context.session.user.id, order.orderId, await payer(context))
  assert.equal(first.outTradeNo, order.outTradeNo, 'the first attempt uses the order number')
  // The buyer cancels; the platform accepts an order number once, so the retry needs another.
  const second = await context.orders.createVirtualPayment(context.session.user.id, order.orderId, await payer(context))
  assert.notEqual(second.outTradeNo, first.outTradeNo)
  assert.equal(JSON.parse(second.virtualPayment.signData).outTradeNo, second.outTradeNo)
  const pending = await context.store.read((tx) => tx.findById('orders', order.orderId))
  assert.deepEqual(pending?.paymentParams, { attempts: [first.outTradeNo, second.outTradeNo] })

  // The first attempt was paid after all, and its delivery push arrives late.
  context.mockPay.setOrderState(first.outTradeNo, 'SUCCESS')
  await context.orders.handleDelivery(deliveryFor(context, first.outTradeNo))
  const paid = await context.store.read((tx) => tx.findById('orders', order.orderId))
  assert.equal(paid?.status, 'PAID')
  assert.equal(paid?.outTradeNo, first.outTradeNo, 'refunds name the attempt that was paid')
  assert.equal((await context.reports.get(context.session.user.id, submitted.reportId)).access, 'full')

  // If the second attempt was paid too, the order keeps one payment and flags the other for a manual refund.
  context.mockPay.setOrderState(second.outTradeNo, 'SUCCESS')
  await context.orders.handleDelivery(deliveryFor(context, second.outTradeNo))
  const after = await context.store.read(async (tx) => ({
    order: await tx.findById('orders', order.orderId),
    entitlements: await tx.findMany('entitlements', { orderId: order.orderId }),
    audit: await tx.findMany('auditLogs', { action: 'DUPLICATE_PAYMENT_MANUAL_REFUND_REQUIRED' })
  }))
  assert.equal(after.order?.status, 'PAID')
  assert.equal(after.order?.providerTransactionId, `mock_tx_${first.outTradeNo}`)
  assert.equal(after.entitlements.length, 1)
  assert.equal(after.audit.length, 1)
  assert.equal(after.audit[0]?.metadata.outTradeNo, second.outTradeNo)
  await expectCode(context.orders.createVirtualPayment(context.session.user.id, order.orderId, await payer(context)), 'ORDER_ALREADY_PAID')
})

test('a retry first settles an earlier attempt that was paid without a push instead of charging again', async () => {
  const context = await setup()
  const { submitted } = await createSubmitted(context)
  const order = await context.orders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'retry-after-lost-push'
  })
  const first = await context.orders.createVirtualPayment(context.session.user.id, order.orderId, await payer(context))
  context.mockPay.setOrderState(first.outTradeNo, 'SUCCESS')
  await expectCode(context.orders.createVirtualPayment(context.session.user.id, order.orderId, await payer(context)), 'ORDER_ALREADY_PAID')
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId, false)).status, 'PAID')
  assert.equal(context.mockPay.isDelivered(first.outTradeNo), true, 'a payment settled by query is reported as delivered')
})

test('a virtual payment is signed only for the signed-in WeChat account and only for products sold as an item', async () => {
  const context = await setup()
  const { submitted } = await createSubmitted(context)
  const order = await context.orders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'payer-and-item-order'
  })
  await expectCode(context.auth.payerSession(context.session.user.id, 'bob-login-code'), 'PAYMENT_PAYER_MISMATCH')
  const alice = await payer(context)
  await expectCode(context.orders.createVirtualPayment(context.session.user.id, order.orderId, { ...alice, openid: 'someone-else' }), 'PAYMENT_PAYER_MISMATCH')
  const withoutItems = new OrderService(context.store, new MockPaymentProvider(sessionSecret, { clock, products: {} }), catalog, true, clock)
  await expectCode(withoutItems.createVirtualPayment(context.session.user.id, order.orderId, alice), 'VIRTUAL_PAYMENT_PRODUCT_NOT_CONFIGURED')
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId, false)).status, 'CREATED', 'a refused attempt leaves the order untouched')
})

test('refund pushes for unknown orders are ignored, and a refund made by Apple or in the console withdraws access', async () => {
  const context = await setup()
  const { order, submitted } = await createPaid(context)
  const unknown = await context.orders.handleRefundPush({
    eventId: 'refund-other-env', outTradeNo: `PX${'9'.repeat(30)}`, outRefundNo: '', providerRefundId: 'wx-refund-x',
    refundStatus: 'SUCCESS', refundFen: 3990
  })
  assert.equal(unknown.ignored, true, 'the push belongs to the other environment')
  const applied = await context.orders.handleRefundPush({
    eventId: 'apple-refund-1', outTradeNo: order.outTradeNo, outRefundNo: '', providerRefundId: 'apple-refund-1',
    refundStatus: 'SUCCESS', refundFen: 3990
  })
  assert.equal(applied.ignored, false)
  const state = await context.store.read(async (tx) => ({
    order: await tx.findById('orders', order.orderId),
    refunds: await tx.findMany('refunds', { orderId: order.orderId }),
    entitlement: await tx.findOne('entitlements', { orderId: order.orderId })
  }))
  assert.equal(state.order?.status, 'REFUNDED')
  assert.equal(state.refunds.length, 1)
  assert.equal(state.refunds[0]?.reason, 'PLATFORM_REFUND')
  assert.equal(state.refunds[0]?.status, 'SUCCESS')
  assert.equal(state.entitlement?.status, 'REVOKED')
  assert.equal((await context.reports.get(context.session.user.id, submitted.reportId)).access, 'preview')
})

test('an iOS refund query is answered by the refund window and the download state', async () => {
  const context = await setup()
  const { order, submitted } = await createPaid(context)
  assert.equal((await context.orders.iosRefundQueryDecision(order.outTradeNo)).result_code, 0)
  await context.store.transaction(async (tx) => { await tx.update('reports', submitted.reportId, { pdfFirstDownloadedAt: '2026-08-20T10:30:00.000Z' }) })
  const downloaded = await context.orders.iosRefundQueryDecision(order.outTradeNo)
  assert.equal(downloaded.result_code, 1)
  assert.match(downloaded.evidence, /REPORT_DOWNLOADED_AT/)
  assert.deepEqual(await context.orders.iosRefundQueryDecision('PXunknown000000'), { result_code: 0, result_info: '未找到已支付订单，不拦截', evidence: 'NO_PAID_ORDER' })
  const answers = await context.store.read((tx) => tx.findMany('auditLogs', { action: 'IOS_REFUND_QUERY_ANSWERED' }))
  assert.equal(answers.length, 3)
})

test('an expired attempt the platform never saw is cancelled after a grace period so the purchase can start again', async () => {
  const context = await setup()
  const { submitted } = await createSubmitted(context)
  const order = await context.orders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'never-opened-order'
  })
  await context.orders.createVirtualPayment(context.session.user.id, order.orderId, await payer(context))
  // The buyer never opened the payment sheet, so the platform does not know the order number.
  context.mockPay.queryAttempt = async () => { throw new AppError(502, 'VIRTUAL_PAYMENT_API_ERROR', 'order not found') }
  const expireAt = async (minutesAgo: number) => context.store.transaction(async (tx) => {
    await tx.update('orders', order.orderId, { expiresAt: new Date(clock().getTime() - minutesAgo * 60_000).toISOString(), lastProviderQueryAt: null })
  })
  await expireAt(10)
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId)).status, 'PENDING', 'an unknown attempt is not given up right at expiry')
  await expireAt(31)
  const again = await context.orders.createOrder(context.session.user.id, submitted.assessmentId, {
    productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'never-opened-retry'
  })
  assert.notEqual(again.orderId, order.orderId)
  assert.equal(again.status, 'CREATED')
  assert.equal((await context.orders.getOrder(context.session.user.id, order.orderId, false)).status, 'CANCELLED')
})

test('a late payment for a cancelled order takes over from a newer unpaid order, and is flagged when the newer one was paid', async () => {
  const context = await setup()
  const { submitted } = await createSubmitted(context)
  const purchase = (key: string) => context.orders.createOrder(context.session.user.id, submitted.assessmentId, { productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: key })
  const cancel = (orderId: string) => context.store.transaction(async (tx) => { await tx.update('orders', orderId, { status: 'CANCELLED' }) })

  const old = await purchase('late-payment-old')
  const oldAttempt = await context.orders.createVirtualPayment(context.session.user.id, old.orderId, await payer(context))
  await cancel(old.orderId)
  const newer = await purchase('late-payment-newer')
  await context.orders.createVirtualPayment(context.session.user.id, newer.orderId, await payer(context))
  context.mockPay.setOrderState(oldAttempt.outTradeNo, 'SUCCESS')
  await context.orders.handleDelivery(deliveryFor(context, oldAttempt.outTradeNo))
  assert.equal((await context.orders.getOrder(context.session.user.id, old.orderId, false)).status, 'PAID')
  assert.equal((await context.orders.getOrder(context.session.user.id, newer.orderId, false)).status, 'CANCELLED')

  const second = await setup()
  const secondSubmitted = await createSubmitted(second)
  const first = await second.orders.createOrder(second.session.user.id, secondSubmitted.submitted.assessmentId, { productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'paid-twice-old' })
  const firstAttempt = await second.orders.createVirtualPayment(second.session.user.id, first.orderId, await payer(second))
  await second.store.transaction(async (tx) => { await tx.update('orders', first.orderId, { status: 'CANCELLED' }) })
  const replacement = await second.orders.createOrder(second.session.user.id, secondSubmitted.submitted.assessmentId, { productCode: 'COMPASS_REPORT_SINGLE_39_9', idempotencyKey: 'paid-twice-new' })
  const replacementAttempt = await second.orders.createVirtualPayment(second.session.user.id, replacement.orderId, await payer(second))
  second.mockPay.setOrderState(replacementAttempt.outTradeNo, 'SUCCESS')
  await second.orders.handleDelivery(deliveryFor(second, replacementAttempt.outTradeNo))
  second.mockPay.setOrderState(firstAttempt.outTradeNo, 'SUCCESS')
  await second.orders.handleDelivery(deliveryFor(second, firstAttempt.outTradeNo))
  assert.equal((await second.orders.getOrder(second.session.user.id, first.orderId, false)).status, 'CANCELLED')
  assert.equal((await second.orders.getOrder(second.session.user.id, replacement.orderId, false)).status, 'PAID')
  const flagged = await second.store.read((tx) => tx.findMany('auditLogs', { action: 'DUPLICATE_PAYMENT_MANUAL_REFUND_REQUIRED' }))
  assert.deepEqual(flagged.map((row) => row.entityId), [first.orderId])
})
