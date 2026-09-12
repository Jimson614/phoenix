import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { AddressInfo } from 'node:net'
import test from 'node:test'
import { MockWechatAuthProvider } from '../src/auth/wechat-auth-provider'
import { loadConfig } from '../src/config'
import { FeishuEntityType } from '../src/domain/model'
import { FEISHU_PROFILE_MIRROR_CONSENT_COPY_SHA256 } from '../src/domain/education-compass/consent-policy'
import { PLACEHOLDER_SOURCE_CATALOG } from '../src/domain/source-catalog'
import { createAppServer } from '../src/http/app'
import {
  FeishuApiError,
  FeishuBitableClient,
  FeishuBitableGateway
} from '../src/integrations/feishu/bitable-client'
import { FeishuSyncService } from '../src/integrations/feishu/sync-service'
import {
  CUSTOMER_PROFILE_FEISHU_ALLOWLISTS,
  CUSTOMER_PROFILE_FEISHU_CORE_FIELDS,
  CUSTOMER_PROFILE_FEISHU_OPTIONAL_FIELDS,
  FEISHU_TABLE_CONTRACTS,
  V05_CUSTOMER_PROFILE_FEISHU_ALLOWLISTS
} from '../src/integrations/feishu/schema-contract'
import { MockPaymentProvider } from '../src/payments/mock-payment-provider'
import { AssessmentService } from '../src/services/assessment-service'
import { AuthService } from '../src/services/auth-service'
import { EducationCompassService } from '../src/services/education-compass-service'
import { OrderService, seedProducts } from '../src/services/order-service'
import { ProfileService } from '../src/services/profile-service'
import { ReportService } from '../src/services/report-service'
import { InMemoryStore } from '../src/store/memory-store'

const sessionSecret = 'feishu-test-session-secret-with-at-least-32-characters'
const fixedNow = new Date('2026-08-21T08:00:00.000Z')

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function requestMethod(init?: RequestInit): string {
  return String(init?.method ?? 'GET').toUpperCase()
}

let clientTokenSequence = 0
function frozenOperation(fields: Record<string, string | number | boolean | string[]>): {
  clientToken: string
  fields: Record<string, string | number | boolean | string[]>
  requestBody: string
} {
  clientTokenSequence += 1
  return {
    clientToken: `00000000-0000-4000-8000-${String(clientTokenSequence).padStart(12, '0')}`,
    fields,
    requestBody: JSON.stringify({ fields })
  }
}

test('Feishu integration is opt-in and enabled configuration fails closed', () => {
  assert.equal(loadConfig({ NODE_ENV: 'test' }).feishuBitableEnabled, false)
  assert.equal(loadConfig({ NODE_ENV: 'test' }).feishuCustomerProfileFieldsEnabled, false)
  assert.throws(
    () => loadConfig({ NODE_ENV: 'test', FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED: 'true' }),
    (error: unknown) => (error as { code?: string }).code === 'CONFIG_INVALID'
  )
  assert.throws(
    () => loadConfig({ NODE_ENV: 'test', FEISHU_BITABLE_ENABLED: 'true' }),
    (error: unknown) => (error as { code?: string }).code === 'CONFIG_INVALID'
  )
  const enabled = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@db.internal/phoenix',
    SESSION_SECRET: 'session-secret-that-is-at-least-32-characters',
    FEISHU_BITABLE_ENABLED: 'true', FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED: 'true',
    FEISHU_APP_ID: 'cli_test', FEISHU_APP_SECRET: 'app-secret',
    FEISHU_BITABLE_APP_TOKEN: 'bas_test', FEISHU_PSEUDONYM_KEY: 'dedicated-pseudonym-key-at-least-32-bytes',
    FEISHU_BITABLE_TABLE_FAMILY_PROFILE: 'tblFamily', FEISHU_BITABLE_TABLE_STUDENT_PROFILE: 'tblStudent',
    FEISHU_BITABLE_TABLE_ASSESSMENT_SESSION: 'tblAssessment', FEISHU_BITABLE_TABLE_REPORT_JOB: 'tblReport',
    FEISHU_BITABLE_TABLE_ORDER_PAYMENT: 'tblOrder', FEISHU_BITABLE_TABLE_FEEDBACK: 'tblFeedback',
    FEISHU_BITABLE_TABLE_ADVISOR_REQUEST: 'tblAdvisor'
  })
  assert.equal(enabled.feishuBitableEnabled, true)
  assert.equal(enabled.feishuCustomerProfileFieldsEnabled, true)
  assert.equal(enabled.feishuBitableTables.order_payment, 'tblOrder')
})

test('Feishu client caches tenant token and coalesces concurrent token requests', async () => {
  let tokenCalls = 0
  let createCalls = 0
  let releaseToken = (): void => {}
  const tokenGate = new Promise<void>((resolve) => { releaseToken = resolve })
  const authorizedRequests: string[] = []
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input)
    if (url.endsWith('/auth/v3/tenant_access_token/internal')) {
      tokenCalls += 1
      await tokenGate
      return jsonResponse({ code: 0, tenant_access_token: 'tenant-token-1', expire: 7200 })
    }
    authorizedRequests.push(new Headers(init?.headers).get('Authorization') ?? '')
    if (url.includes('/records/search')) return jsonResponse({ code: 0, data: { items: [] } })
    if (requestMethod(init) === 'PUT') {
      return jsonResponse({ code: 0, data: { record: { record_id: 'rec_existing' } } })
    }
    createCalls += 1
    return jsonResponse({ code: 0, data: { record: { record_id: `rec_created_${createCalls}` } } })
  }) as typeof fetch

  const client = new FeishuBitableClient({
    appId: 'cli_test', appSecret: 'secret-value', appToken: 'bas_test', fetchImpl,
    now: () => fixedNow.getTime()
  })
  const first = client.upsertRecord({
    tableId: 'tblTokenCache', uniqueField: 'family_id', uniqueValue: 'PHX-A',
    ...frozenOperation({ family_id: 'PHX-A' })
  })
  const second = client.upsertRecord({
    tableId: 'tblTokenCache', uniqueField: 'family_id', uniqueValue: 'PHX-B',
    ...frozenOperation({ family_id: 'PHX-B' })
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(tokenCalls, 1)
  releaseToken()
  await Promise.all([first, second])

  await client.upsertRecord({
    tableId: 'tblTokenCache', uniqueField: 'family_id', uniqueValue: 'PHX-C',
    knownRecordId: 'rec_existing', ...frozenOperation({ family_id: 'PHX-C' })
  })
  assert.equal(tokenCalls, 1, 'unexpired tenant token should be reused')
  assert.ok(authorizedRequests.length >= 5)
  assert.ok(authorizedRequests.every((value) => value === 'Bearer tenant-token-1'))
})

test('Feishu client rejects HTTP 200 responses whose provider code is non-zero', async () => {
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    if (requestUrl(input).endsWith('/auth/v3/tenant_access_token/internal')) {
      return jsonResponse({ code: 0, tenant_access_token: 'tenant-token-2', expire: 7200 })
    }
    return jsonResponse({ code: 1254060, msg: 'provider detail must not reach users' })
  }) as typeof fetch
  const client = new FeishuBitableClient({
    appId: 'cli_test', appSecret: 'secret-value', appToken: 'bas_test', fetchImpl
  })

  await assert.rejects(
    client.upsertRecord({
      tableId: 'tblProviderCode', uniqueField: 'order_id', uniqueValue: 'PHX-ORDER',
      ...frozenOperation({ order_id: 'PHX-ORDER' })
    }),
    (error: unknown) => {
      assert.ok(error instanceof FeishuApiError)
      assert.equal(error.code, 'FEISHU_API_1254060')
      assert.equal(error.status, 502)
      assert.equal(error.retryable, false)
      assert.doesNotMatch(error.message, /provider detail/)
      return true
    }
  )
})

test('Feishu client classifies provider throttling as retryable and respects retry-after', async () => {
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    if (requestUrl(input).endsWith('/auth/v3/tenant_access_token/internal')) {
      return jsonResponse({ code: 0, tenant_access_token: 'tenant-token-throttle', expire: 7200 })
    }
    return new Response(JSON.stringify({ code: 1254291, msg: 'write conflict' }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Retry-After': '2' }
    })
  }) as typeof fetch
  const client = new FeishuBitableClient({
    appId: 'cli_test', appSecret: 'secret-value', appToken: 'bas_test', fetchImpl
  })
  await assert.rejects(
    client.upsertRecord({
      tableId: 'tblThrottle', uniqueField: 'order_id', uniqueValue: 'PHX-THROTTLE',
      ...frozenOperation({ order_id: 'PHX-THROTTLE' })
    }),
    (error: unknown) => {
      assert.ok(error instanceof FeishuApiError)
      assert.equal(error.code, 'FEISHU_API_1254291')
      assert.equal(error.retryable, true)
      assert.equal(error.retryAfterMs, 2000)
      return true
    }
  )
})

test('Feishu client creates missing records and updates known records', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input)
    if (url.endsWith('/auth/v3/tenant_access_token/internal')) {
      return jsonResponse({ code: 0, tenant_access_token: 'tenant-token-3', expire: 7200 })
    }
    calls.push({
      url,
      method: requestMethod(init),
      body: init?.body ? JSON.parse(String(init.body)) as unknown : null
    })
    if (url.includes('/records/search')) return jsonResponse({ code: 0, data: { items: [] } })
    if (requestMethod(init) === 'PUT') {
      return jsonResponse({ code: 0, data: { record: { record_id: 'rec_known' } } })
    }
    return jsonResponse({ code: 0, data: { record: { record_id: 'rec_new' } } })
  }) as typeof fetch
  const client = new FeishuBitableClient({
    appId: 'cli_test', appSecret: 'secret-value', appToken: 'bas_test', fetchImpl
  })

  const created = await client.upsertRecord({
    tableId: 'tblCreateUpdate', uniqueField: 'order_id', uniqueValue: 'PHX-NEW',
    ...frozenOperation({ order_id: 'PHX-NEW', status: 'PAID' })
  })
  const updated = await client.upsertRecord({
    tableId: 'tblCreateUpdate', uniqueField: 'order_id', uniqueValue: 'PHX-KNOWN',
    knownRecordId: 'rec_known', ...frozenOperation({ order_id: 'PHX-KNOWN', status: 'REFUNDED' })
  })

  assert.deepEqual(created, { recordId: 'rec_new', created: true })
  assert.deepEqual(updated, { recordId: 'rec_known', created: false })
  assert.equal(calls.length, 3)
  assert.match(calls[0]?.url ?? '', /\/records\/search\?page_size=10$/)
  assert.equal(calls[0]?.method, 'POST')
  assert.match(calls[1]?.url ?? '', /\/records\?client_token=[0-9a-f-]+$/)
  assert.equal(calls[1]?.method, 'POST')
  assert.deepEqual(calls[1]?.body, { fields: { order_id: 'PHX-NEW', status: 'PAID' } })
  assert.match(calls[2]?.url ?? '', /\/records\/rec_known\?client_token=[0-9a-f-]+$/)
  assert.equal(calls[2]?.method, 'PUT')
  assert.deepEqual(calls[2]?.body, { fields: { order_id: 'PHX-KNOWN', status: 'REFUNDED' } })
})

test('Feishu client paginates field metadata for schema preflight', async () => {
  const fieldUrls: string[] = []
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = requestUrl(input)
    if (url.endsWith('/auth/v3/tenant_access_token/internal')) {
      return jsonResponse({ code: 0, tenant_access_token: 'tenant-token-fields', expire: 7200 })
    }
    fieldUrls.push(url)
    if (fieldUrls.length === 1) return jsonResponse({
      code: 0, data: { items: [{ field_name: 'order_id', type: 1, ui_type: 'Text', is_primary: true }], has_more: true, page_token: 'next-page' }
    })
    return jsonResponse({
      code: 0, data: { items: [{ field_name: 'amount_fen', type: 2, ui_type: 'Number', is_primary: false }], has_more: false }
    })
  }) as typeof fetch
  const client = new FeishuBitableClient({
    appId: 'cli_test', appSecret: 'secret-value', appToken: 'bas_test', fetchImpl
  })

  const fields = await client.listFields('tblFieldList')
  assert.deepEqual(fields, [
    { name: 'order_id', type: 1, uiType: 'Text', isPrimary: true },
    { name: 'amount_fen', type: 2, uiType: 'Number', isPrimary: false }
  ])
  assert.match(fieldUrls[0] ?? '', /\/fields\?page_size=100$/)
  assert.match(fieldUrls[1] ?? '', /page_token=next-page/)
})

const allTables: Record<FeishuEntityType, string> = {
  family_profile: 'tblFamily',
  student_profile: 'tblStudent',
  assessment_session: 'tblAssessment',
  report_job: 'tblReport',
  order_payment: 'tblOrder',
  feedback: 'tblFeedback',
  advisor_request: 'tblAdvisor'
}

test('Customer profile mirror contracts are exact runtime-frozen allowlists', () => {
  assert.deepEqual(CUSTOMER_PROFILE_FEISHU_CORE_FIELDS.family_profile, [
    'family_id', 'status', 'created_at', 'schema_version', 'source_updated_at'
  ])
  assert.deepEqual(CUSTOMER_PROFILE_FEISHU_CORE_FIELDS.student_profile, [
    'student_id', 'family_id', 'student_version', 'created_at', 'schema_version', 'source_updated_at'
  ])
  assert.deepEqual(CUSTOMER_PROFILE_FEISHU_OPTIONAL_FIELDS.family_profile, [
    'family_name', 'parent_name', 'phone', 'location', 'goal'
  ])
  assert.deepEqual(CUSTOMER_PROFILE_FEISHU_OPTIONAL_FIELDS.student_profile, [
    'student_name', 'age', 'gender', 'school', 'education_system', 'grade', 'interest', 'goal'
  ])
  assert.equal(Object.isFrozen(CUSTOMER_PROFILE_FEISHU_ALLOWLISTS), true)
  assert.equal(Object.isFrozen(CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.family_profile), true)
  assert.equal(Object.isFrozen(FEISHU_TABLE_CONTRACTS.family_profile.fields), true)
  assert.deepEqual(V05_CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.family_profile, [
    'family_id', 'family_display_name', 'guardian_display_name', 'guardian_phone',
    'city_region', 'source_entry', 'advisor_status', 'consent_state', 'updated_at'
  ])
  assert.deepEqual(V05_CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.student_profile, [
    'student_id', 'family_id', 'student_display_name', 'education_system',
    'grade_stage', 'source_entry', 'advisor_status', 'consent_state', 'updated_at'
  ])
  assert.deepEqual(Object.keys(FEISHU_TABLE_CONTRACTS.family_profile.fields).sort(),
    [...new Set([...CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.family_profile, ...V05_CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.family_profile])].sort())
  assert.deepEqual(Object.keys(FEISHU_TABLE_CONTRACTS.student_profile.fields).sort(),
    [...new Set([...CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.student_profile, ...V05_CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.student_profile])].sort())
})

test('Customer pseudonyms are stable across service instances and separated by environment', async () => {
  const profileTables: Record<FeishuEntityType, string> = {
    family_profile: 'tblFamily', student_profile: 'tblStudent', assessment_session: '', report_job: '',
    order_payment: '', feedback: '', advisor_request: ''
  }
  const capture = async (environment: string): Promise<string[]> => {
    const gateway = new CapturingGateway()
    const service = new FeishuSyncService(
      populatedStore(), gateway, profileTables, 'standalone-pseudonym-key-with-32-bytes', environment, 10,
      () => new Date(fixedNow)
    )
    await service.reconcile()
    return gateway.calls.map((call) => call.uniqueValue).sort()
  }
  const first = await capture('staging')
  assert.deepEqual(await capture('staging'), first)
  assert.notDeepEqual(await capture('production'), first)
  assert.ok(first.every((value) => /^PHX-[0-9a-f]{24}$/.test(value)))
})

type GatewayInput = Parameters<FeishuBitableGateway['upsertRecord']>[0]

class CapturingGateway implements FeishuBitableGateway {
  readonly calls: GatewayInput[] = []

  async upsertRecord(input: GatewayInput): Promise<{ recordId: string; created: boolean }> {
    this.calls.push(structuredClone(input))
    return { recordId: input.knownRecordId ?? `rec_${this.calls.length}`, created: !input.knownRecordId }
  }
}

function populatedStore(): InMemoryStore {
  return new InMemoryStore({
    families: [{
      id: 'fam_private_1', userId: 'usr_private_1', familyName: 'PII_FAMILY_NAME',
      parentName: 'PII_PARENT_NAME', phone: '13912345678', location: 'PII_HOME_ADDRESS',
      goal: 'PII_FAMILY_GOAL', createdAt: '2026-08-20T01:00:00.000Z', updatedAt: '2026-08-20T02:00:00.000Z'
    }],
    students: [{
      id: 'stu_private_1', familyId: 'fam_private_1', name: 'PII_STUDENT_NAME', age: 15,
      gender: 'PII_GENDER', school: 'PII_SCHOOL', educationSystem: 'DSE', grade: '中五',
      interest: 'PII_INTEREST', goal: 'PII_STUDENT_GOAL', studentVersion: 'v3',
      createdAt: '2026-08-20T03:00:00.000Z', updatedAt: '2026-08-20T04:00:00.000Z'
    }],
    assessments: [{
      id: 'asm_private_1', userId: 'usr_private_1', familyId: 'fam_private_1', studentId: 'stu_private_1',
      consentId: 'con_private_1', questionnaireVersion: 'education_compass_v1', studentVersion: 'v3',
      answers: { open_answer: 'PII_ASSESSMENT_ANSWER' }, status: 'PREVIEW_READY', completenessScore: 88,
      missingFields: ['PII_MISSING_FIELD'], reportId: 'rpt_private_1',
      createdAt: '2026-08-20T05:00:00.000Z', updatedAt: '2026-08-20T06:00:00.000Z',
      submittedAt: '2026-08-20T06:00:00.000Z'
    }],
    reports: [{
      id: 'rpt_private_1', userId: 'usr_private_1', familyId: 'fam_private_1', studentId: 'stu_private_1',
      assessmentId: 'asm_private_1', status: 'READY', deliveryStatus: 'DELIVERED',
      preview: {
        reportId: 'rpt_private_1', assessmentId: 'asm_private_1', completenessScore: 88,
        confidence: 'high', profileSummary: 'PII_REPORT_PREVIEW', oneStrength: 'PII_STRENGTH',
        oneRisk: 'PII_RISK', routeOverview: 'PII_ROUTE', tableOfContents: ['PII_TOC'],
        dataAsOf: '2026-08-20', disclaimer: 'PII_DISCLAIMER', canPurchase: true
      },
      modules: [{ key: 'student_profile', title: 'PII_MODULE_TITLE', summary: 'PII_MODULE_BODY' }],
      sources: [{ sourceId: 'PII_SOURCE_ID', applicableYear: '2026', verifiedAt: '2026-08-20', dataVersion: 'data-v1' }],
      dataAsOf: '2026-08-20', disclaimer: 'PII_FULL_DISCLAIMER', confidence: 'high',
      versions: { studentVersion: 'v3', ruleVersion: 'rule-v1', dataVersion: 'data-v1', promptVersion: 'prompt-v1', templateVersion: 'template-v1' },
      qaPassed: true, sourceCatalogVerified: true, sourceCatalogVersion: 'catalog-v1',
      createdAt: '2026-08-20T07:00:00.000Z', updatedAt: '2026-08-20T08:00:00.000Z'
    }],
    orders: [{
      id: 'ord_private_1', outTradeNo: 'PII_OUT_TRADE_NO', userId: 'usr_private_1', familyId: 'fam_private_1',
      studentId: 'stu_private_1', assessmentId: 'asm_private_1', reportId: 'rpt_private_1',
      productCode: 'COMPASS_REPORT_SINGLE_39_9', amountFen: 3990, currency: 'CNY', status: 'PAID',
      idempotencyKey: 'PII_IDEMPOTENCY_KEY', provider: 'wechat', providerPrepayId: 'PII_PREPAY_ID',
      paymentParams: { timeStamp: '1', nonceStr: 'PII_NONCE', package: 'PII_PACKAGE', signType: 'RSA', paySign: 'PII_PAY_SIGN' },
      providerTransactionId: 'PII_TRANSACTION_ID', lastProviderQueryAt: null,
      createdAt: '2026-08-20T09:00:00.000Z', updatedAt: '2026-08-20T10:00:00.000Z',
      expiresAt: '2026-08-20T10:30:00.000Z', paidAt: '2026-08-20T10:00:00.000Z', refundedAt: null
    }],
    feedback: [{
      id: 'fdb_private_1', userId: 'usr_private_1', reportId: 'rpt_private_1', rating: 5,
      tags: ['PII_FEEDBACK_TAG'], comment: 'PII_FEEDBACK_COMMENT', advisorContactRequested: true,
      createdAt: '2026-08-20T11:00:00.000Z'
    }],
    advisorRequests: [{
      id: 'adv_private_1', userId: 'usr_private_1', familyId: 'fam_private_1',
      preferredTime: 'PII_PREFERRED_TIME 13912345678', topic: 'PII_ADVISOR_TOPIC', note: 'PII_ADVISOR_NOTE',
      reportId: 'rpt_private_1', studentId: 'stu_private_1', status: 'PENDING',
      createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-20T13:00:00.000Z'
    }]
  })
}

async function grantFeishuProfileMirror(
  store: InMemoryStore,
  familyId: string,
  studentId: string | null = null,
  userId = 'usr_private_1'
): Promise<void> {
  const at = fixedNow.toISOString()
  await store.transaction((tx) => tx.insert('consentGrants', {
    id: `cgr_feishu_${familyId}_${studentId ?? 'family'}`,
    userId,
    familyId,
    studentId,
    subjectType: studentId ? 'STUDENT' : 'FAMILY',
    subjectId: studentId ?? familyId,
    scope: 'FEISHU_PROFILE_MIRROR',
    subjectRole: 'PARENT_GUARDIAN',
    copyVersion: 'feishu_profile_mirror_opt_in_v1.0.0-rc1',
    copyTextHash: FEISHU_PROFILE_MIRROR_CONSENT_COPY_SHA256,
    locale: 'zh-CN',
    guardianAuthorityStatus: 'CONFIRMED',
    sourceEntry: 'MINIPROGRAM_HOME',
    auditMetadata: { guardianConfirmed: true, studentConfirmed: false, channel: 'TEST' },
    grantedAt: at,
    withdrawnAt: null,
    createdAt: at,
    updatedAt: at
  }))
}

test('Feishu reconciliation projects only pseudonymous operational fields and skips unchanged records', async () => {
  const store = populatedStore()
  const gateway = new CapturingGateway()
  let idSequence = 0
  const service = new FeishuSyncService(
    store, gateway, allTables, 'standalone-pseudonym-key-with-32-bytes', 'test', 50,
    () => new Date(fixedNow), (prefix) => `${prefix}_test_${++idSequence}`
  )

  const first = await service.reconcile(20)
  assert.deepEqual(first, { enabled: true, discovered: 7, attempted: 7, succeeded: 7, failed: 0, skipped: 0 })
  assert.equal(gateway.calls.length, 7)

  const serialized = JSON.stringify(gateway.calls)
  const forbiddenValues = [
    'fam_private_1', 'stu_private_1', 'asm_private_1', 'rpt_private_1', 'ord_private_1',
    'fdb_private_1', 'adv_private_1', 'usr_private_1', 'PII_', '13912345678'
  ]
  forbiddenValues.forEach((value) => assert.doesNotMatch(serialized, new RegExp(value)))

  const forbiddenKeys = [
    'familyName', 'parentName', 'phone', 'location', 'goal', 'name', 'age', 'gender', 'school',
    'interest', 'answers', 'missingFields', 'preview', 'modules', 'sources', 'disclaimer',
    'outTradeNo', 'idempotencyKey', 'providerPrepayId', 'paymentParams', 'providerTransactionId',
    'tags', 'comment', 'preferredTime', 'topic', 'note'
  ]
  for (const call of gateway.calls) {
    forbiddenKeys.forEach((key) => assert.equal(Object.hasOwn(call.fields, key), false, `${key} must not be mirrored`))
    assert.match(call.uniqueValue, /^PHX-[0-9a-f]{24}$/)
    assert.equal(call.fields[call.uniqueField], call.uniqueValue)
    assert.equal(call.fields.schema_version, 'phoenix_feishu_ops_v1')
    const entityType = (Object.entries(allTables).find(([, tableId]) => tableId === call.tableId)?.[0]) as FeishuEntityType
    const contract = FEISHU_TABLE_CONTRACTS[entityType]
    assert.equal(call.uniqueField, contract.primaryField)
    assert.ok(Object.keys(call.fields).every((fieldName) => fieldName in contract.fields))
  }

  const second = await service.reconcile(20)
  assert.deepEqual(second, { enabled: true, discovered: 7, attempted: 0, succeeded: 0, failed: 0, skipped: 7 })
  assert.equal(gateway.calls.length, 7, 'unchanged projections must not write to Feishu twice')
  const links = await store.read((tx) => tx.findMany('integrationLinks'))
  assert.equal(links.length, 7)
  assert.ok(links.every((link) => link.status === 'SYNCED' && link.attempts === 0 && Boolean(link.externalRecordId)))
})

test('Legacy customer profile reconcile preserves its core contract and stable pseudonyms', async () => {
  const store = populatedStore()
  const gateway = new CapturingGateway()
  const profileTables: Record<FeishuEntityType, string> = {
    family_profile: 'tblFamily', student_profile: 'tblStudent', assessment_session: '', report_job: '',
    order_payment: '', feedback: '', advisor_request: ''
  }
  const service = new FeishuSyncService(
    store, gateway, profileTables, 'standalone-pseudonym-key-with-32-bytes', 'test', 10,
    () => new Date(fixedNow)
  )

  assert.equal((await service.reconcile()).succeeded, 2)
  const firstFamily = gateway.calls.find((call) => call.tableId === 'tblFamily')
  const firstStudent = gateway.calls.find((call) => call.tableId === 'tblStudent')
  assert.ok(firstFamily)
  assert.ok(firstStudent)
  assert.deepEqual(Object.keys(firstFamily.fields).sort(), [...CUSTOMER_PROFILE_FEISHU_CORE_FIELDS.family_profile].sort())
  assert.deepEqual(Object.keys(firstStudent.fields).sort(), [...CUSTOMER_PROFILE_FEISHU_CORE_FIELDS.student_profile].sort())
  assert.equal(firstFamily.fields.status, 'ACTIVE')
  assert.equal(firstStudent.fields.student_version, 'v3')
  assert.doesNotMatch(JSON.stringify([firstFamily, firstStudent]), /PII_|13912345678/)

  await store.transaction(async (tx) => {
    await tx.update('families', 'fam_private_1', {
      familyName: 'CHANGED_PRIVATE_FAMILY', phone: '13800000000',
      updatedAt: '2026-08-21T09:00:00.000Z'
    })
    await tx.update('students', 'stu_private_1', {
      name: 'CHANGED_PRIVATE_STUDENT', school: 'CHANGED_PRIVATE_SCHOOL', studentVersion: 'v4',
      updatedAt: '2026-08-21T09:01:00.000Z'
    })
  })

  const updated = await service.reconcile()
  assert.deepEqual(updated, { enabled: true, discovered: 2, attempted: 2, succeeded: 2, failed: 0, skipped: 0 })
  const secondFamily = gateway.calls.filter((call) => call.tableId === 'tblFamily').at(-1)
  const secondStudent = gateway.calls.filter((call) => call.tableId === 'tblStudent').at(-1)
  assert.ok(secondFamily)
  assert.ok(secondStudent)
  assert.equal(secondFamily.uniqueValue, firstFamily.uniqueValue)
  assert.equal(secondStudent.uniqueValue, firstStudent.uniqueValue)
  assert.equal(secondFamily.knownRecordId, 'rec_1')
  assert.equal(secondStudent.knownRecordId, 'rec_2')
  assert.equal(secondFamily.fields.source_updated_at, '2026-08-21T09:00:00.000Z')
  assert.equal(secondStudent.fields.source_updated_at, '2026-08-21T09:01:00.000Z')
  assert.equal(secondStudent.fields.student_version, 'v4')
  assert.doesNotMatch(JSON.stringify([secondFamily, secondStudent]), /CHANGED_PRIVATE|13800000000/)

  const unchanged = await service.reconcile()
  assert.deepEqual(unchanged, { enabled: true, discovered: 2, attempted: 0, succeeded: 0, failed: 0, skipped: 2 })
  assert.equal(gateway.calls.length, 4)
})

test('Customer profile fields are mirrored only when the explicit sensitive-field flag is enabled', async () => {
  const store = populatedStore()
  await grantFeishuProfileMirror(store, 'fam_private_1', 'stu_private_1')
  const gateway = new CapturingGateway()
  const profileTables: Record<FeishuEntityType, string> = {
    family_profile: 'tblFamily', student_profile: 'tblStudent', assessment_session: '', report_job: '',
    order_payment: '', feedback: '', advisor_request: ''
  }
  const service = new FeishuSyncService(
    store, gateway, profileTables, 'standalone-pseudonym-key-with-32-bytes', 'test', 10,
    () => new Date(fixedNow), undefined, true
  )

  assert.equal((await service.reconcile()).succeeded, 2)
  const family = gateway.calls.find((call) => call.tableId === 'tblFamily')
  const student = gateway.calls.find((call) => call.tableId === 'tblStudent')
  assert.ok(family)
  assert.ok(student)
  assert.deepEqual(Object.keys(family.fields).sort(), [...CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.family_profile].sort())
  assert.deepEqual(Object.keys(student.fields).sort(), [...CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.student_profile].sort())
  assert.equal(family.fields.family_name, 'PII_FAMILY_NAME')
  assert.equal(family.fields.parent_name, 'PII_PARENT_NAME')
  assert.equal(family.fields.phone, '13912345678')
  assert.equal(family.fields.location, 'PII_HOME_ADDRESS')
  assert.equal(student.fields.student_name, 'PII_STUDENT_NAME')
  assert.equal(student.fields.education_system, 'DSE')
  assert.equal(student.fields.grade, '中五')
  assert.equal(family.fields.goal, 'PII_FAMILY_GOAL')
  assert.equal(student.fields.age, 15)
  assert.equal(student.fields.school, 'PII_SCHOOL')
  assert.equal(student.fields.interest, 'PII_INTEREST')
  const serialized = JSON.stringify(gateway.calls)
  for (const forbidden of [
    'fam_private_1', 'stu_private_1', 'usr_private_1', 'PII_ASSESSMENT_ANSWER',
    'PII_REPORT_PREVIEW', 'PII_MODULE_BODY', 'PII_TRANSACTION_ID', 'PII_OUT_TRADE_NO'
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden))
})

test('Enabled customer profile mirror rejects formula prefixes and oversized values before egress', async () => {
  const baseFamily = {
    id: 'fam_formula', userId: 'usr_formula', familyName: '=HYPERLINK("https://example.invalid")',
    parentName: 'private', phone: '13900000000', location: '', goal: '',
    createdAt: '2026-08-20T01:00:00.000Z', updatedAt: '2026-08-20T02:00:00.000Z'
  }
  const gateway = new CapturingGateway()
  const tables: Record<FeishuEntityType, string> = {
    family_profile: 'tblFamily', student_profile: '', assessment_session: '', report_job: '',
    order_payment: '', feedback: '', advisor_request: ''
  }
  const formulaStudent = {
    id: 'stu_formula', familyId: 'fam_formula', name: 'student', studentVersion: 'v1',
    createdAt: baseFamily.createdAt, updatedAt: baseFamily.updatedAt
  }
  const formulaStore = new InMemoryStore({ families: [baseFamily], students: [formulaStudent] })
  await grantFeishuProfileMirror(formulaStore, 'fam_formula', 'stu_formula', 'usr_formula')
  const formulaService = new FeishuSyncService(
    formulaStore, gateway, tables,
    'standalone-pseudonym-key-with-32-bytes', 'test', 10, () => new Date(fixedNow), undefined, true
  )
  await assert.rejects(formulaService.reconcile(), (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'FEISHU_PROFILE_FORMULA_INJECTION')
    return true
  })

  const oversizedStore = new InMemoryStore({
    families: [{ ...baseFamily, id: 'fam_oversized', familyName: 'A'.repeat(81) }],
    students: [{ ...formulaStudent, id: 'stu_oversized', familyId: 'fam_oversized' }]
  })
  await grantFeishuProfileMirror(oversizedStore, 'fam_oversized', 'stu_oversized', 'usr_formula')
  const oversizedService = new FeishuSyncService(
    oversizedStore,
    gateway, tables, 'standalone-pseudonym-key-with-32-bytes', 'test', 10,
    () => new Date(fixedNow), undefined, true
  )
  await assert.rejects(oversizedService.reconcile(), (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'FEISHU_PROFILE_FIELD_TOO_LONG')
    return true
  })
  assert.equal(gateway.calls.length, 0)
})

test('Persisted retry payload with an unknown customer field fails closed before Feishu egress', async () => {
  const frozenFields = {
    family_id: 'PHX-111111111111111111111111',
    status: 'ACTIVE',
    created_at: '2026-08-20T01:00:00.000Z',
    schema_version: 'phoenix_feishu_ops_v1',
    source_updated_at: '2026-08-20T02:00:00.000Z',
    raw_email: 'private@example.invalid'
  }
  const store = new InMemoryStore({
    families: [{
      id: 'fam_tampered', userId: 'usr_tampered', familyName: 'private', parentName: 'private', phone: '13900000000',
      location: '', goal: '', createdAt: '2026-08-20T01:00:00.000Z', updatedAt: '2026-08-20T02:00:00.000Z'
    }],
    integrationLinks: [{
      id: 'ilk_tampered', provider: 'feishu_bitable', tableId: 'tblFamily',
      entityType: 'family_profile', entityId: 'fam_tampered', externalRecordId: 'rec_tampered',
      payloadDigest: null, status: 'FAILED', attempts: 1, leaseToken: null,
      operationToken: '00000000-0000-4000-8000-000000000999',
      operationDigest: createHash('sha256').update(JSON.stringify(frozenFields)).digest('hex'),
      operationBody: JSON.stringify({ fields: frozenFields }), lastErrorCode: 'FEISHU_TIMEOUT',
      nextAttemptAt: null, lastSyncedAt: null,
      createdAt: '2026-08-20T02:00:00.000Z', updatedAt: '2026-08-20T02:00:00.000Z'
    }]
  })
  let writes = 0
  const gateway: FeishuBitableGateway = {
    async upsertRecord() { writes += 1; return { recordId: 'never', created: false } }
  }
  const profileTables: Record<FeishuEntityType, string> = {
    family_profile: 'tblFamily', student_profile: '', assessment_session: '', report_job: '',
    order_payment: '', feedback: '', advisor_request: ''
  }
  const service = new FeishuSyncService(
    store, gateway, profileTables, 'standalone-pseudonym-key-with-32-bytes', 'test', 10,
    () => new Date(fixedNow)
  )

  await assert.rejects(service.reconcile(), (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'FEISHU_PROJECTION_FIELD_FORBIDDEN')
    return true
  })
  assert.equal(writes, 0)
  assert.equal((await store.read((tx) => tx.findById('integrationLinks', 'ilk_tampered')))?.status, 'FAILED')
})

test('Turning the customer profile flag off discards a frozen sensitive retry body', async () => {
  const oldToken = '00000000-0000-4000-8000-000000000998'
  const sensitiveFields = {
    family_id: 'PHX-111111111111111111111111', status: 'ACTIVE',
    created_at: '2026-08-20T01:00:00.000Z', family_name: 'PRIVATE_FAMILY',
    parent_name: 'PRIVATE_PARENT', phone: '13912345678', location: 'PRIVATE_LOCATION', goal: 'PRIVATE_GOAL',
    schema_version: 'phoenix_feishu_ops_v1', source_updated_at: '2026-08-20T02:00:00.000Z'
  }
  const store = new InMemoryStore({
    families: [{
      id: 'fam_switch_off', userId: 'usr_switch_off', familyName: 'PRIVATE_FAMILY', parentName: 'PRIVATE_PARENT',
      phone: '13912345678', location: 'PRIVATE_LOCATION', goal: 'PRIVATE_GOAL',
      createdAt: '2026-08-20T01:00:00.000Z', updatedAt: '2026-08-20T02:00:00.000Z'
    }],
    integrationLinks: [{
      id: 'ilk_switch_off', provider: 'feishu_bitable', tableId: 'tblFamily',
      entityType: 'family_profile', entityId: 'fam_switch_off', externalRecordId: 'rec_switch_off',
      payloadDigest: null, status: 'FAILED', attempts: 1, leaseToken: null,
      operationToken: oldToken,
      operationDigest: createHash('sha256').update(JSON.stringify(sensitiveFields)).digest('hex'),
      operationBody: JSON.stringify({ fields: sensitiveFields }), lastErrorCode: 'FEISHU_TIMEOUT',
      nextAttemptAt: null, lastSyncedAt: null,
      createdAt: '2026-08-20T02:00:00.000Z', updatedAt: '2026-08-20T02:00:00.000Z'
    }]
  })
  const gateway = new CapturingGateway()
  const profileTables: Record<FeishuEntityType, string> = {
    family_profile: 'tblFamily', student_profile: '', assessment_session: '', report_job: '',
    order_payment: '', feedback: '', advisor_request: ''
  }
  const service = new FeishuSyncService(
    store, gateway, profileTables, 'standalone-pseudonym-key-with-32-bytes', 'test', 10,
    () => new Date(fixedNow)
  )

  assert.equal((await service.reconcile()).succeeded, 1)
  assert.equal(gateway.calls.length, 1)
  assert.notEqual(gateway.calls[0]?.clientToken, oldToken)
  assert.deepEqual(Object.keys(gateway.calls[0]?.fields ?? {}).sort(), [...CUSTOMER_PROFILE_FEISHU_CORE_FIELDS.family_profile].sort())
  assert.doesNotMatch(JSON.stringify(gateway.calls[0]), /PRIVATE_|13912345678/)
})

test('Feishu schema preflight validates all remote field names, primary fields and types', async () => {
  const gateway = new CapturingGateway() as CapturingGateway & Required<Pick<FeishuBitableGateway, 'listFields'>>
  gateway.listFields = async (tableId) => {
    const entityType = Object.entries(allTables).find(([, value]) => value === tableId)?.[0] as FeishuEntityType
    const contract = FEISHU_TABLE_CONTRACTS[entityType]
    return Object.entries(contract.fields).map(([name, kind]) => ({
      name, type: kind === 'number' ? 2 : 1, uiType: kind === 'number' ? 'Number' : 'Text',
      isPrimary: name === contract.primaryField
    }))
  }
  const service = new FeishuSyncService(
    new InMemoryStore(), gateway, allTables, 'standalone-pseudonym-key-with-32-bytes', 'test', 50,
    () => new Date(fixedNow)
  )
  assert.deepEqual(await service.validateSchema(), {
    state: 'VALID', checkedAt: fixedNow.toISOString(), errorCode: null
  })
})

test('Profile schema requires sensitive columns only when the explicit profile flag is enabled', async () => {
  const gateway = new CapturingGateway() as CapturingGateway & Required<Pick<FeishuBitableGateway, 'listFields'>>
  gateway.listFields = async (tableId) => {
    const entityType = Object.entries(allTables).find(([, value]) => value === tableId)?.[0] as FeishuEntityType
    const contract = FEISHU_TABLE_CONTRACTS[entityType]
    const fieldNames = entityType === 'family_profile' || entityType === 'student_profile'
      ? CUSTOMER_PROFILE_FEISHU_CORE_FIELDS[entityType]
      : Object.keys(contract.fields)
    return fieldNames.map((name) => {
      const kind = contract.fields[name]
      return {
        name, type: kind === 'number' ? 2 : 1, uiType: kind === 'number' ? 'Number' : 'Text',
        isPrimary: name === contract.primaryField
      }
    })
  }
  const defaultService = new FeishuSyncService(
    new InMemoryStore(), gateway, allTables, 'standalone-pseudonym-key-with-32-bytes', 'test', 50,
    () => new Date(fixedNow)
  )
  assert.equal((await defaultService.validateSchema()).state, 'VALID')

  const sensitiveService = new FeishuSyncService(
    new InMemoryStore(), gateway, allTables, 'standalone-pseudonym-key-with-32-bytes', 'test', 50,
    () => new Date(fixedNow), undefined, true
  )
  await assert.rejects(sensitiveService.validateSchema(), (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'FEISHU_SCHEMA_FIELD_MISSING')
    return true
  })
})

test('Feishu schema drift fails closed for the mirror without touching Phoenix data', async () => {
  const store = new InMemoryStore({
    families: [{
      id: 'fam_schema', userId: 'usr_schema', familyName: 'private', parentName: 'private', phone: '13900000000',
      location: '', goal: '', createdAt: fixedNow.toISOString(), updatedAt: fixedNow.toISOString()
    }]
  })
  let writes = 0
  const gateway: FeishuBitableGateway = {
    async listFields() { return [{ name: 'wrong_primary', type: 1, uiType: 'Text', isPrimary: true }] },
    async upsertRecord() { writes += 1; return { recordId: 'never', created: true } }
  }
  const service = new FeishuSyncService(
    store, gateway, allTables, 'standalone-pseudonym-key-with-32-bytes', 'test', 50,
    () => new Date(fixedNow)
  )
  await assert.rejects(service.reconcile(), (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'FEISHU_SCHEMA_FIELD_MISSING')
    return true
  })
  assert.equal(writes, 0)
  assert.equal((await store.read((tx) => tx.findMany('families'))).length, 1)
  assert.equal(((await service.status()).schema as { state: string }).state, 'INVALID')
})

test('Feishu reconciliation records a retryable failure and respects its next-attempt delay', async () => {
  const store = new InMemoryStore({
    families: [{
      id: 'fam_failed', userId: 'usr_failed', familyName: 'private', parentName: 'private', phone: '13900000000',
      location: '', goal: '', createdAt: '2026-08-20T01:00:00.000Z', updatedAt: '2026-08-20T02:00:00.000Z'
    }]
  })
  let gatewayCalls = 0
  const gateway: FeishuBitableGateway = {
    async upsertRecord(): Promise<{ recordId: string; created: boolean }> {
      gatewayCalls += 1
      if (gatewayCalls === 1) throw new FeishuApiError('FEISHU_API_1255001', 503, true)
      return { recordId: 'rec_recovered', created: true }
    }
  }
  const tables: Record<FeishuEntityType, string> = {
    family_profile: 'tblFamily', student_profile: '', assessment_session: '', report_job: '',
    order_payment: '', feedback: '', advisor_request: ''
  }
  let now = new Date(fixedNow)
  const service = new FeishuSyncService(
    store, gateway, tables, 'standalone-pseudonym-key-with-32-bytes', 'test', 10,
    () => new Date(now), (prefix) => `${prefix}_failed`
  )

  const first = await service.reconcile()
  assert.deepEqual(first, { enabled: true, discovered: 1, attempted: 1, succeeded: 0, failed: 1, skipped: 0 })
  const link = await store.read((tx) => tx.findOne('integrationLinks', { entityId: 'fam_failed' }))
  assert.ok(link)
  assert.equal(link.status, 'FAILED')
  assert.equal(link.attempts, 1)
  assert.equal(link.lastErrorCode, 'FEISHU_API_1255001')
  assert.ok(link.nextAttemptAt)
  assert.ok(Date.parse(link.nextAttemptAt) >= Date.parse('2026-08-21T08:00:30.000Z'))
  assert.ok(Date.parse(link.nextAttemptAt) < Date.parse('2026-08-21T08:00:35.000Z'))

  const second = await service.reconcile()
  assert.deepEqual(second, { enabled: true, discovered: 1, attempted: 0, succeeded: 0, failed: 0, skipped: 1 })
  assert.equal(gatewayCalls, 1)

  now = new Date('2026-08-21T08:00:36.000Z')
  const third = await service.reconcile()
  assert.deepEqual(third, { enabled: true, discovered: 1, attempted: 1, succeeded: 1, failed: 0, skipped: 0 })
  assert.equal(gatewayCalls, 2)
  const recovered = await store.read((tx) => tx.findOne('integrationLinks', { entityId: 'fam_failed' }))
  assert.equal(recovered?.status, 'SYNCED')
  assert.equal(recovered?.attempts, 0)
  assert.equal(recovered?.externalRecordId, 'rec_recovered')
})

test('Feishu unknown-result retry reuses its persisted UUID and frozen request bytes', async () => {
  const store = new InMemoryStore({
    families: [{
      id: 'fam_unknown', userId: 'usr_unknown', familyName: 'private', parentName: 'private', phone: '13900000000',
      location: '', goal: '', createdAt: '2026-08-20T01:00:00.000Z', updatedAt: '2026-08-20T02:00:00.000Z'
    }]
  })
  const calls: GatewayInput[] = []
  const gateway: FeishuBitableGateway = {
    async upsertRecord(input): Promise<{ recordId: string; created: boolean }> {
      calls.push(structuredClone(input))
      if (calls.length === 1) throw new FeishuApiError('FEISHU_TIMEOUT', 504, true)
      return { recordId: 'rec_unknown', created: calls.length === 2 }
    }
  }
  const tables: Record<FeishuEntityType, string> = {
    family_profile: 'tblFamily', student_profile: '', assessment_session: '', report_job: '',
    order_payment: '', feedback: '', advisor_request: ''
  }
  let now = new Date(fixedNow)
  const service = new FeishuSyncService(
    store, gateway, tables, 'standalone-pseudonym-key-with-32-bytes', 'test', 10, () => new Date(now)
  )

  assert.equal((await service.reconcile()).failed, 1)
  await store.transaction(async (tx) => {
    const family = await tx.findById('families', 'fam_unknown')
    assert.ok(family)
    await tx.update('families', family.id, { updatedAt: '2026-08-21T08:00:15.000Z', goal: 'still-private' })
  })
  now = new Date('2026-08-21T08:00:36.000Z')
  assert.equal((await service.reconcile()).succeeded, 1)
  assert.equal(calls[1]?.clientToken, calls[0]?.clientToken)
  assert.equal(calls[1]?.requestBody, calls[0]?.requestBody)

  assert.equal((await service.reconcile()).succeeded, 1, 'new source state is sent only after the frozen operation settles')
  assert.notEqual(calls[2]?.clientToken, calls[1]?.clientToken)
  assert.notEqual(calls[2]?.requestBody, calls[1]?.requestBody)
  assert.equal(calls[2]?.knownRecordId, 'rec_unknown')
})

async function jsonRequest(
  base: string,
  path: string,
  options: RequestInit = {}
): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  })
  const body = response.status === 204 ? null : await response.json()
  return { response, body }
}

test('Authenticated customer profile APIs persist to the Phoenix store contract then feed the optional Feishu mirror', async () => {
  const store = new InMemoryStore()
  await seedProducts(store, fixedNow.toISOString())
  const auth = new AuthService(store, new MockWechatAuthProvider(), sessionSecret)
  const profiles = new ProfileService(store, () => new Date(fixedNow))
  const assessments = new AssessmentService(store, PLACEHOLDER_SOURCE_CATALOG)
  const payment = new MockPaymentProvider(sessionSecret)
  const orders = new OrderService(store, payment, PLACEHOLDER_SOURCE_CATALOG, false)
  const reports = new ReportService(store)
  const education = new EducationCompassService(store, false, () => new Date(fixedNow))
  const gateway = new CapturingGateway()
  const profileTables: Record<FeishuEntityType, string> = {
    family_profile: 'tblFamily', student_profile: 'tblStudent', assessment_session: '', report_job: '',
    order_payment: '', feedback: '', advisor_request: ''
  }
  const feishu = new FeishuSyncService(
    store, gateway, profileTables, 'standalone-pseudonym-key-with-32-bytes', 'test', 10,
    () => new Date(fixedNow), undefined, true
  )
  const server = createAppServer({ auth, profiles, assessments, orders, reports, education, feishu })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const base = `http://127.0.0.1:${address.port}`

  try {
    const login = await auth.createWechatSession('feishu-profile-api-user')
    const headers = { Authorization: `Bearer ${login.accessToken}` }
    const family = await jsonRequest(base, '/v1/me/family', {
      method: 'PUT', headers,
      body: JSON.stringify({
        familyName: '林氏家庭', parentName: '林女士', phone: '+852 9123 4567',
        location: '香港', goal: '规划升学方向'
      })
    })
    assert.equal(family.response.status, 200)
    const student = await jsonRequest(base, '/v1/me/students', {
      method: 'POST', headers,
      body: JSON.stringify({
        name: '小林', age: 15, gender: '女', school: '示例中学', educationSystem: 'DSE',
        grade: '中五', interest: '工程', goal: '探索大学专业'
      })
    })
    assert.equal(student.response.status, 201)

    const beforeConsent = await feishu.reconcile()
    assert.deepEqual(beforeConsent, { enabled: true, discovered: 0, attempted: 0, succeeded: 0, failed: 0, skipped: 0 })
    assert.equal(gateway.calls.length, 0)
    const consent = await jsonRequest(base, '/v1/me/integration-consents/feishu-profile', {
      method: 'PUT', headers,
      body: JSON.stringify({
        studentId: student.body.student.id,
        enabled: true,
        copyVersion: 'feishu_profile_mirror_opt_in_v1.0.0-rc1',
        locale: 'zh-CN',
        guardianAuthorityConfirmed: true
      })
    })
    assert.equal(consent.response.status, 200)
    const result = await feishu.reconcile()
    assert.deepEqual(result, { enabled: true, discovered: 2, attempted: 2, succeeded: 2, failed: 0, skipped: 0 })
    const familyMirror = gateway.calls.find((call) => call.tableId === 'tblFamily')
    const studentMirror = gateway.calls.find((call) => call.tableId === 'tblStudent')
    assert.ok(familyMirror)
    assert.ok(studentMirror)
    assert.deepEqual(Object.keys(familyMirror.fields).sort(), [...V05_CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.family_profile].sort())
    assert.deepEqual(Object.keys(studentMirror.fields).sort(), [...V05_CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.student_profile].sort())
    assert.equal(familyMirror.fields.family_display_name, '林氏家庭')
    assert.equal(familyMirror.fields.guardian_display_name, '林女士')
    assert.equal(familyMirror.fields.guardian_phone, '+852 9123 4567')
    assert.equal(studentMirror.fields.student_display_name, '小林')
    assert.equal(studentMirror.fields.education_system, 'DSE')
    assert.equal(studentMirror.fields.grade_stage, '中五')
    for (const forbidden of ['goal', 'age', 'gender', 'school', 'interest']) {
      assert.equal(Object.hasOwn(familyMirror.fields, forbidden), false)
      assert.equal(Object.hasOwn(studentMirror.fields, forbidden), false)
    }
    assert.match(familyMirror.uniqueValue, /^PHX-[0-9a-f]{24}$/)
    assert.match(studentMirror.uniqueValue, /^PHX-[0-9a-f]{24}$/)
    assert.doesNotMatch(JSON.stringify(gateway.calls), new RegExp(String(family.body.family.id)))
    assert.doesNotMatch(JSON.stringify(gateway.calls), new RegExp(String(student.body.student.id)))

    const sourceFamily = await store.read((tx) => tx.findById('families', String(family.body.family.id)))
    const sourceStudent = await store.read((tx) => tx.findById('students', String(student.body.student.id)))
    assert.equal(sourceFamily?.phone, '+852 9123 4567')
    assert.equal(sourceStudent?.name, '小林')
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('Feishu management endpoints require admin role and expose no credentials', async () => {
  const store = new InMemoryStore()
  await seedProducts(store, fixedNow.toISOString())
  const auth = new AuthService(store, new MockWechatAuthProvider(), sessionSecret)
  const profiles = new ProfileService(store)
  const assessments = new AssessmentService(store, PLACEHOLDER_SOURCE_CATALOG)
  const payment = new MockPaymentProvider(sessionSecret)
  const orders = new OrderService(store, payment, PLACEHOLDER_SOURCE_CATALOG, false)
  const reports = new ReportService(store)
  const disabledTables = Object.fromEntries(Object.keys(allTables).map((key) => [key, ''])) as Record<FeishuEntityType, string>
  const feishu = new FeishuSyncService(store, null, disabledTables, '', 'test')
  const server = createAppServer({ auth, profiles, assessments, orders, reports, feishu })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const base = `http://127.0.0.1:${address.port}`

  try {
    const familyLogin = await auth.createWechatSession('feishu-family-user')
    const adminCode = 'feishu-admin-user'
    const adminOpenid = `mock_${createHash('sha256').update(adminCode).digest('hex').slice(0, 24)}`
    await store.transaction(async (tx) => {
      await tx.insert('users', { id: 'usr_feishu_admin', role: 'admin', createdAt: fixedNow.toISOString() })
      await tx.insert('wechatIdentities', {
        id: 'wxi_feishu_admin', userId: 'usr_feishu_admin', openid: adminOpenid,
        unionid: null, createdAt: fixedNow.toISOString()
      })
    })
    const adminLogin = await auth.createWechatSession(adminCode)
    assert.equal(adminLogin.user.role, 'admin')

    const unauthenticated = await jsonRequest(base, '/v1/admin/integrations/feishu/status')
    assert.equal(unauthenticated.response.status, 401)
    assert.equal(unauthenticated.body.error.code, 'AUTH_REQUIRED')

    const familyHeaders = { Authorization: `Bearer ${familyLogin.accessToken}` }
    const forbiddenStatus = await jsonRequest(base, '/v1/admin/integrations/feishu/status', { headers: familyHeaders })
    assert.equal(forbiddenStatus.response.status, 403)
    assert.equal(forbiddenStatus.body.error.code, 'ADMIN_REQUIRED')
    const forbiddenReconcile = await jsonRequest(base, '/v1/admin/integrations/feishu/reconcile', {
      method: 'POST', headers: familyHeaders, body: JSON.stringify({ limit: 10 })
    })
    assert.equal(forbiddenReconcile.response.status, 403)
    assert.equal(forbiddenReconcile.body.error.code, 'ADMIN_REQUIRED')

    const adminHeaders = { Authorization: `Bearer ${adminLogin.accessToken}` }
    const status = await jsonRequest(base, '/v1/admin/integrations/feishu/status', { headers: adminHeaders })
    assert.equal(status.response.status, 200)
    assert.equal(status.body.enabled, false)
    assert.equal(status.body.customerProfileFieldsEnabled, false)
    assert.deepEqual(status.body.counts, { PENDING: 0, PROCESSING: 0, SYNCED: 0, FAILED: 0, BLOCKED: 0 })
    assert.doesNotMatch(JSON.stringify(status.body), /secret|token|app[_-]?id|table[_-]?id/i)

    const reconcile = await jsonRequest(base, '/v1/admin/integrations/feishu/reconcile', {
      method: 'POST', headers: adminHeaders, body: JSON.stringify({ limit: 10 })
    })
    assert.equal(reconcile.response.status, 202)
    assert.deepEqual(reconcile.body, { enabled: false, discovered: 0, attempted: 0, succeeded: 0, failed: 0, skipped: 0 })
    const audits = await store.read((tx) => tx.findMany('auditLogs', { actorUserId: 'usr_feishu_admin' }))
    assert.equal(audits.at(-1)?.action, 'FEISHU_RECONCILE_REQUESTED')
    assert.deepEqual(audits.at(-1)?.metadata, { limit: 10, requeuedBlocked: 0 })
    const schema = await jsonRequest(base, '/v1/admin/integrations/feishu/validate-schema', {
      method: 'POST', headers: adminHeaders, body: '{}'
    })
    assert.equal(schema.response.status, 200)
    assert.equal(schema.body.state, 'DISABLED')
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
