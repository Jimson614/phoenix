import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { AddressInfo } from 'node:net'
import path from 'node:path'
import test from 'node:test'
import { MockWechatAuthProvider } from '../src/auth/wechat-auth-provider'
import {
  FREE_PARENT_QUESTIONNAIRE_VERSION,
  GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION,
  LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION,
  LEGACY_GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION
} from '../src/domain/education-compass/contracts'
import { GROWTH_DISCOVERY_PRODUCT_CODE } from '../src/domain/products'
import { validateSourceCatalog } from '../src/domain/source-catalog'
import { createAppServer } from '../src/http/app'
import { MockPaymentProvider } from '../src/payments/mock-payment-provider'
import { AssessmentService } from '../src/services/assessment-service'
import { AuthService } from '../src/services/auth-service'
import { EducationCompassService } from '../src/services/education-compass-service'
import { OrderService, seedProducts } from '../src/services/order-service'
import { ProfileService } from '../src/services/profile-service'
import { ReportService } from '../src/services/report-service'
import { InMemoryStore } from '../src/store/memory-store'

const secret = 'education-http-test-session-and-payment-secret'
const catalog = validateSourceCatalog({
  version: 'EDUCATION-HTTP-TEST-CATALOG-V1',
  dataAsOf: '2026-08-25',
  reviewedAt: '2026-08-25T00:00:00.000Z',
  reviewedBy: 'Education HTTP synthetic test',
  entries: [{
    sourceId: 'EDUCATION-HTTP-SOURCE-1',
    title: 'Synthetic reviewed source',
    applicableYear: '2026',
    verifiedAt: '2026-08-25T00:00:00.000Z'
  }]
})

async function listen() {
  const store = new InMemoryStore()
  await seedProducts(store, new Date().toISOString())
  const auth = new AuthService(store, new MockWechatAuthProvider(), secret)
  const profiles = new ProfileService(store)
  const assessments = new AssessmentService(store, catalog)
  const mockPay = new MockPaymentProvider(secret)
  const education = new EducationCompassService(store, true)
  const orders = new OrderService(store, mockPay, catalog, true, undefined, undefined, true)
  const reports = new ReportService(store)
  const server = createAppServer({ auth, profiles, assessments, education, orders, reports })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    store,
    auth,
    mockPay,
    server,
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

async function jsonRequest(
  base: string,
  path: string,
  options: RequestInit = {}
): Promise<{ response: Response; body: any }> {
  const headers = new Headers(options.headers)
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${base}${path}`, { ...options, headers })
  const body = response.status === 204 ? null : await response.json()
  return { response, body }
}

async function postMockWebhook(
  base: string,
  notification: ReturnType<MockPaymentProvider['makeTransactionNotification']>
): Promise<Response> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const [name, value] of Object.entries(notification.headers)) {
    if (value !== undefined) headers.set(name, value)
  }
  return fetch(`${base}/v1/webhooks/wechat-pay/transactions`, {
    method: 'POST',
    headers,
    body: notification.rawBody.toString('utf8')
  })
}

async function postMockRefundWebhook(
  base: string,
  notification: ReturnType<MockPaymentProvider['makeRefundNotification']>
): Promise<Response> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const [name, value] of Object.entries(notification.headers)) {
    if (value !== undefined) headers.set(name, value)
  }
  return fetch(`${base}/v1/webhooks/wechat-pay/refunds`, {
    method: 'POST',
    headers,
    body: notification.rawBody.toString('utf8')
  })
}

async function createProfile(app: Awaited<ReturnType<typeof listen>>, code: string, suffix: string) {
  const login = await jsonRequest(app.base, '/v1/auth/wechat/session', {
    method: 'POST',
    body: JSON.stringify({ code })
  })
  assert.equal(login.response.status, 200)
  const headers = { Authorization: `Bearer ${login.body.accessToken}` }
  const family = await jsonRequest(app.base, '/v1/me/family', {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      familyName: `合成家庭${suffix}`,
      parentName: `合成家长${suffix}`,
      phone: `1390000000${suffix}`,
      location: '测试地区',
      goal: '仅用于本地 HTTP 自动化'
    })
  })
  assert.equal(family.response.status, 200)
  const student = await jsonRequest(app.base, '/v1/me/students', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: `合成学生${suffix}`,
      age: 16,
      educationSystem: 'GAOKAO',
      grade: 'UPPER_SECONDARY'
    })
  })
  assert.equal(student.response.status, 201)
  return {
    headers,
    userId: login.body.user.id as string,
    familyId: family.body.family.id as string,
    studentId: student.body.student.id as string
  }
}

function requiredAnswers(questionnaire: any, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const answers: Record<string, unknown> = {}
  for (const questionId of questionnaire.requiredQuestionIds as string[]) {
    const question = (questionnaire.questions as any[]).find((item) => item.id === questionId)
    assert.ok(question, `required question ${questionId} must be present in the HTTP bank`)
    if (question.type === 'YEAR_SELECT') {
      answers[questionId] = String(new Date().getUTCFullYear() + 1)
      continue
    }
    if (question.type === 'MULTI_CHOICE' || question.type === 'MULTI_CHOICE_DYNAMIC') {
      assert.ok(question.options[0]?.code, `${questionId} must expose at least one canonical option`)
      answers[questionId] = [question.options[0].code]
      continue
    }
    if (question.type === 'SUBJECT_RANGE_MATRIX') {
      assert.ok(question.matrixSubjectOptions[0]?.code && question.matrixRangeOptions[0]?.code,
        `${questionId} must expose canonical matrix options`)
      answers[questionId] = [{
        subject_code: question.matrixSubjectOptions[0].code,
        range_code: question.matrixRangeOptions[0].code
      }]
      continue
    }
    assert.ok(question.options[0]?.code, `${questionId} must expose at least one canonical option`)
    answers[questionId] = question.options[0].code
  }
  return { ...answers, ...overrides }
}

function freeCreateBody(studentId: string) {
  return {
    studentId,
    sourceEntry: 'MINIPROGRAM_HOME',
    consent: {
      scope: 'CORE_ASSESSMENT',
      copyVersion: 'guardian_core_assessment_v1.0.0-rc1',
      locale: 'zh-CN',
      guardianAuthorityConfirmed: true
    }
  }
}

function growthCreateBody(sourceAssessmentId: string, educationSystem: string) {
  return {
    assessmentKind: 'STUDENT_GROWTH_DISCOVERY',
    sourceAssessmentId,
    sourceEntry: 'LEVEL_1_RESULT',
    educationSystem,
    respondent: 'STUDENT',
    assent: {
      scope: 'STUDENT_ASSESSMENT_ASSENT',
      copyVersion: 'student_assent_growth_discovery_v1.0.0-rc1',
      locale: 'zh-CN',
      studentConfirmed: true
    }
  }
}

function advisorConsent() {
  return {
    scope: 'ADVISOR_CONTACT',
    copyVersion: 'advisor_contact_opt_in_v1.0.0-rc1',
    locale: 'zh-CN',
    guardianAuthorityConfirmed: true
  }
}

async function completeLevelOne(
  app: Awaited<ReturnType<typeof listen>>,
  profile: Awaited<ReturnType<typeof createProfile>>,
  educationSystem: string,
  keySuffix: string,
  answerOverrides: Record<string, unknown> = {}
) {
  const bankResponse = await jsonRequest(
    app.base,
    `/v1/education-compass/questionnaires/${FREE_PARENT_QUESTIONNAIRE_VERSION}`,
    { headers: profile.headers }
  )
  assert.equal(bankResponse.response.status, 200)
  const created = await jsonRequest(app.base, '/v1/education-compass/free-parent-assessments', {
    method: 'POST',
    headers: { ...profile.headers, 'Idempotency-Key': `free-create-${keySuffix}` },
    body: JSON.stringify(freeCreateBody(profile.studentId))
  })
  assert.equal(created.response.status, 201)
  const answers = requiredAnswers(bankResponse.body.questionnaire, {
    FP01: 'UPPER_SECONDARY',
    FP02: educationSystem,
    FP06: 'WILLING',
    FP08: 'STUDENT_ASSESSMENT',
    ...answerOverrides
  })
  const saved = await jsonRequest(app.base, `/v1/assessments/${created.body.assessmentId}/draft`, {
    method: 'PUT',
    headers: profile.headers,
    body: JSON.stringify({ revision: created.body.revision, answers, clientSaveToken: `save-free-${keySuffix}` })
  })
  assert.equal(saved.response.status, 200)
  assert.equal(saved.body.canSubmit, true)
  const submitted = await jsonRequest(app.base, `/v1/assessments/${created.body.assessmentId}/submit`, {
    method: 'POST',
    headers: { ...profile.headers, 'Idempotency-Key': `free-submit-${keySuffix}` },
    body: JSON.stringify({ revision: saved.body.revision })
  })
  assert.equal(submitted.response.status, 200)
  assert.equal(submitted.body.resultState, 'READY')
  return {
    assessmentId: created.body.assessmentId as string,
    reportId: submitted.body.reportId as string,
    result: submitted.body.result
  }
}

async function completeLevelTwo(
  app: Awaited<ReturnType<typeof listen>>,
  profile: Awaited<ReturnType<typeof createProfile>>,
  sourceAssessmentId: string,
  educationSystem: string,
  keySuffix: string,
  answerOverrides: Record<string, unknown> = {}
) {
  const created = await jsonRequest(app.base, `/v1/students/${profile.studentId}/education-assessments`, {
    method: 'POST',
    headers: { ...profile.headers, 'Idempotency-Key': `growth-create-${keySuffix}` },
    body: JSON.stringify(growthCreateBody(sourceAssessmentId, educationSystem))
  })
  assert.equal(created.response.status, 201, JSON.stringify(created.body))
  const bank = await jsonRequest(app.base, `/v1/assessments/${created.body.assessmentId}/questionnaire`, {
    headers: profile.headers
  })
  assert.equal(bank.response.status, 200, JSON.stringify(bank.body))
  const answers = requiredAnswers(bank.body.questionnaire, {
    EGD01: 'CONFIRM_STUDENT_SELF',
    EGD02: 'UPPER_SECONDARY',
    EGD03: educationSystem,
    ...answerOverrides
  })
  const saved = await jsonRequest(app.base, `/v1/assessments/${created.body.assessmentId}/draft`, {
    method: 'PUT',
    headers: profile.headers,
    body: JSON.stringify({
      revision: created.body.revision,
      educationSystem,
      answers,
      clientSaveToken: `growth-save-${keySuffix}`
    })
  })
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body))
  assert.equal(saved.body.canSubmit, true)
  const submitted = await jsonRequest(app.base, `/v1/assessments/${created.body.assessmentId}/submit`, {
    method: 'POST',
    headers: { ...profile.headers, 'Idempotency-Key': `growth-submit-${keySuffix}` },
    body: JSON.stringify({ revision: saved.body.revision })
  })
  assert.equal(submitted.response.status, 200, JSON.stringify(submitted.body))
  assert.equal(submitted.body.resultState, 'LOCKED')
  return {
    assessmentId: created.body.assessmentId as string,
    reportId: submitted.body.reportId as string,
    result: submitted.body
  }
}

test('V0.5 profiles support honest provisional nulls and the frozen Level 2 readiness status', async () => {
  const app = await listen()
  try {
    const login = await jsonRequest(app.base, '/v1/auth/wechat/session', {
      method: 'POST',
      body: JSON.stringify({ code: 'education-http-provisional-owner' })
    })
    assert.equal(login.response.status, 200)
    const headers = { Authorization: `Bearer ${login.body.accessToken}` }

    const family = await jsonRequest(app.base, '/v1/me/family', {
      method: 'PUT', headers, body: JSON.stringify({})
    })
    assert.equal(family.response.status, 200, JSON.stringify(family.body))
    assert.equal(family.body.family.profileStatus, 'PROVISIONAL')
    assert.equal(family.body.family.familyName, null)
    assert.equal(family.body.family.parentName, null)
    assert.equal(family.body.family.phone, null)

    const student = await jsonRequest(app.base, '/v1/me/students', {
      method: 'POST', headers, body: JSON.stringify({})
    })
    assert.equal(student.response.status, 201, JSON.stringify(student.body))
    assert.equal(student.body.student.profileStatus, 'PROVISIONAL')
    assert.equal(student.body.student.name, null)
    assert.equal(student.body.student.educationSystem, null)
    assert.equal(student.body.student.grade, null)

    const ready = await jsonRequest(app.base, `/v1/me/students/${student.body.student.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ educationSystem: 'GAOKAO', grade: 'UPPER_SECONDARY' })
    })
    assert.equal(ready.response.status, 200, JSON.stringify(ready.body))
    assert.equal(ready.body.student.profileStatus, 'COMPLETE_FOR_LEVEL_2')
    assert.equal(ready.body.student.name, null)
    assert.equal(ready.body.student.educationSystem, 'GAOKAO')
    assert.equal(ready.body.student.grade, 'UPPER_SECONDARY')
    assert.equal(JSON.stringify({ family: family.body, student: ready.body }).includes('待补充'), false)
  } finally {
    await app.close()
  }
})

test('V1.1 defaults new assessments while V1.0 endpoints and pinned drafts retain their historical bank', async () => {
  const app = await listen()
  try {
    const owner = await createProfile(app, 'education-http-question-version-owner', '8')
    const legacyPublic = await jsonRequest(
      app.base,
      `/v1/education-compass/questionnaires/${LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION}`,
      { headers: owner.headers }
    )
    assert.equal(legacyPublic.response.status, 200)
    assert.equal(legacyPublic.body.questionnaire.questionnaireVersion, LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION)
    assert.equal(legacyPublic.body.questionnaire.questions.find((question: { id: string }) => question.id === 'FP03')?.label,
      '你目前最关注哪些问题？')

    const currentPublic = await jsonRequest(
      app.base,
      `/v1/education-compass/questionnaires/${FREE_PARENT_QUESTIONNAIRE_VERSION}`,
      { headers: owner.headers }
    )
    assert.equal(currentPublic.response.status, 200)
    assert.equal(currentPublic.body.questionnaire.questionnaireVersion, FREE_PARENT_QUESTIONNAIRE_VERSION)
    assert.equal(currentPublic.body.questionnaire.questions.find((question: { id: string }) => question.id === 'FP03')?.label,
      '作为家长，你目前最希望先看清哪些教育问题？（最多 3 项）')

    const defaultCreated = await jsonRequest(app.base, '/v1/education-compass/free-parent-assessments', {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'question-version-default-v11-create' },
      body: JSON.stringify(freeCreateBody(owner.studentId))
    })
    assert.equal(defaultCreated.response.status, 201)
    assert.equal(defaultCreated.body.questionnaireVersion, FREE_PARENT_QUESTIONNAIRE_VERSION)
    assert.equal(defaultCreated.body.schemaDigest, currentPublic.body.questionnaire.schemaDigest)

    const historicalCreated = await jsonRequest(app.base, '/v1/education-compass/free-parent-assessments', {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'question-version-historical-v10-create' },
      body: JSON.stringify(freeCreateBody(owner.studentId))
    })
    assert.equal(historicalCreated.response.status, 201)
    await app.store.transaction(async (tx) => {
      await tx.update('assessments', historicalCreated.body.assessmentId, {
        questionnaireVersion: LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION,
        commonBankVersion: LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION,
        systemBankVersion: null,
        bankVersions: { common: LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION },
        schemaDigest: legacyPublic.body.questionnaire.schemaDigest,
        missingFields: [...legacyPublic.body.questionnaire.requiredQuestionIds],
        answers: {},
        completenessScore: 0
      })
    })

    const pinned = await jsonRequest(
      app.base,
      `/v1/assessments/${historicalCreated.body.assessmentId}/questionnaire`,
      { headers: owner.headers }
    )
    assert.equal(pinned.response.status, 200)
    assert.equal(pinned.body.questionnaire.questionnaireVersion, LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION)
    assert.equal(pinned.body.questionnaire.schemaDigest, legacyPublic.body.questionnaire.schemaDigest)
    assert.equal(pinned.body.questionnaire.questions.find((question: { id: string }) => question.id === 'FP03')?.label,
      '你目前最关注哪些问题？')

    const legacyAnswers = requiredAnswers(pinned.body.questionnaire, {
      FP01: 'UPPER_SECONDARY', FP02: 'GAOKAO', FP06: 'WILLING', FP08: 'STUDENT_ASSESSMENT'
    })
    const saved = await jsonRequest(app.base, `/v1/assessments/${historicalCreated.body.assessmentId}/draft`, {
      method: 'PUT',
      headers: owner.headers,
      body: JSON.stringify({
        revision: historicalCreated.body.revision,
        answers: legacyAnswers,
        clientSaveToken: 'question-version-historical-v10-save'
      })
    })
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body))
    assert.equal(saved.body.canSubmit, true)
    const submitted = await jsonRequest(app.base, `/v1/assessments/${historicalCreated.body.assessmentId}/submit`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'question-version-historical-v10-submit' },
      body: JSON.stringify({ revision: saved.body.revision })
    })
    assert.equal(submitted.response.status, 200, JSON.stringify(submitted.body))
    assert.equal(submitted.body.result.questionnaire_version, LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION)

    const legacyGrowth = await jsonRequest(
      app.base,
      `/v1/education-compass/questionnaires/${LEGACY_GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION}?educationSystem=IB`,
      { headers: owner.headers }
    )
    assert.equal(legacyGrowth.response.status, 200)
    assert.equal(legacyGrowth.body.questionnaire.questionnaireVersion, LEGACY_GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION)
    assert.equal(legacyGrowth.body.questionnaire.systemResultMarker, 'SYSTEM_BANK_PENDING')
    assert.equal(legacyGrowth.body.questionnaire.questions.find((question: { id: string }) => question.id === 'EGD01')?.label,
      '本测评需要由学生本人作答。请确认当前由学生本人阅读并选择答案。')

    const currentGrowth = await jsonRequest(
      app.base,
      `/v1/education-compass/questionnaires/${GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION}?educationSystem=IB`,
      { headers: owner.headers }
    )
    assert.equal(currentGrowth.response.status, 200)
    assert.equal(currentGrowth.body.questionnaire.questionnaireVersion, GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION)
    assert.equal(currentGrowth.body.questionnaire.systemResultMarker, 'SYSTEM_BANK_PENDING')
    assert.equal(currentGrowth.body.questionnaire.questions.find((question: { id: string }) => question.id === 'EGD01')?.label,
      '这份成长发现测评须由学生本人完成。请确认你正由学生本人阅读并选择答案。')
  } finally {
    await app.close()
  }
})

test('V0.5 real HTTP flow preserves revisions, payment authority, owner isolation and one entitlement', async () => {
  const app = await listen()
  try {
    const owner = await createProfile(app, 'education-http-owner-a', '1')
    const other = await createProfile(app, 'education-http-owner-b', '2')

    const state = await jsonRequest(app.base, '/v1/me/education-compass/state', { headers: owner.headers })
    assert.equal(state.response.status, 200)
    assert.equal(state.body.familyId, owner.familyId)
    assert.equal(state.body.students[0].nextAction, 'START_FREE_PARENT_COMPASS')

    const freeBank = await jsonRequest(
      app.base,
      `/v1/education-compass/questionnaires/${FREE_PARENT_QUESTIONNAIRE_VERSION}`,
      { headers: owner.headers }
    )
    assert.equal(freeBank.response.status, 200)
    assert.deepEqual(freeBank.body.questionnaire.requiredQuestionIds,
      ['FP01', 'FP02', 'FP03', 'FP04', 'FP05', 'FP06', 'FP07', 'FP08'])
    assert.deepEqual(freeBank.body.questionnaire.presentation, {
      version: 'education_compass_presentation_v1', estimatedMinutesMin: 3, estimatedMinutesMax: 5,
      totalQuestions: 8, requiredQuestions: 8, progressMode: 'QUESTION_COUNT', scoringMode: 'NONE',
      experienceTitle: '免费家长教育罗盘',
      experienceEyebrow: 'FREE · 3—5 分钟',
      experienceSummary: '帮助家长看清孩子当前最值得关注的教育信号。',
      respondentHint: '由家长／监护人填写；答案用于形成家庭教育成长快照。',
      completionOutcome: '完成后可查看 Family Education Snapshot，并决定是否邀请学生本人参加下一步测评。',
      primaryActionHint: '先完成免费成长快照'
    })
    const growthVersionBank = await jsonRequest(
      app.base,
      `/v1/education-compass/questionnaires/${GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION}?educationSystem=DSE`,
      { headers: owner.headers }
    )
    assert.equal(growthVersionBank.response.status, 200)
    assert.equal(growthVersionBank.body.questionnaire.educationSystem, 'DSE')
    assert.equal(growthVersionBank.body.questionnaire.presentation.totalQuestions,
      growthVersionBank.body.questionnaire.questions.length)
    assert.equal(growthVersionBank.body.questionnaire.presentation.requiredQuestions,
      growthVersionBank.body.questionnaire.requiredQuestionIds.length)

    const unknownField = await jsonRequest(app.base, '/v1/education-compass/free-parent-assessments', {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'free-create-unknown-field' },
      body: JSON.stringify({ ...freeCreateBody(owner.studentId), unexpected: true })
    })
    assert.equal(unknownField.response.status, 400)
    assert.equal(unknownField.body.error.code, 'UNKNOWN_REQUEST_FIELDS')

    const createKey = 'free-create-main-owner'
    const freeCreate = await jsonRequest(app.base, '/v1/education-compass/free-parent-assessments', {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': createKey },
      body: JSON.stringify(freeCreateBody(owner.studentId))
    })
    assert.equal(freeCreate.response.status, 201)
    assert.equal(freeCreate.body.revision, 1)

    const createReplay = await jsonRequest(app.base, '/v1/education-compass/free-parent-assessments', {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': createKey },
      body: JSON.stringify(freeCreateBody(owner.studentId))
    })
    assert.equal(createReplay.response.status, 201)
    assert.equal(createReplay.body.assessmentId, freeCreate.body.assessmentId)

    const differentInput = await jsonRequest(app.base, '/v1/education-compass/free-parent-assessments', {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': createKey },
      body: JSON.stringify({ ...freeCreateBody(owner.studentId), sourceEntry: 'XIAOHONGSHU_CONTENT' })
    })
    assert.equal(differentInput.response.status, 409)
    assert.equal(differentInput.body.error.code, 'IDEMPOTENCY_KEY_REUSED')

    const freeAnswers = requiredAnswers(freeBank.body.questionnaire, {
      FP01: 'UPPER_SECONDARY',
      FP02: 'GAOKAO',
      FP06: 'WILLING',
      FP08: 'STUDENT_ASSESSMENT'
    })
    const freeSave = await jsonRequest(app.base, `/v1/assessments/${freeCreate.body.assessmentId}/draft`, {
      method: 'PUT',
      headers: owner.headers,
      body: JSON.stringify({ revision: 1, answers: freeAnswers, clientSaveToken: 'free-save-main-001' })
    })
    assert.equal(freeSave.response.status, 200)
    assert.equal(freeSave.body.revision, 2)
    assert.equal(freeSave.body.canSubmit, true)

    const staleSave = await jsonRequest(app.base, `/v1/assessments/${freeCreate.body.assessmentId}/draft`, {
      method: 'PUT',
      headers: owner.headers,
      body: JSON.stringify({ revision: 1, answers: freeAnswers, clientSaveToken: 'free-save-stale-001' })
    })
    assert.equal(staleSave.response.status, 409)
    assert.equal(staleSave.body.error.code, 'DRAFT_REVISION_STALE')

    const freeRestored = await jsonRequest(app.base, `/v1/assessments/${freeCreate.body.assessmentId}/draft`, {
      headers: owner.headers
    })
    assert.equal(freeRestored.response.status, 200)
    assert.equal(freeRestored.body.revision, 2)
    assert.deepEqual(freeRestored.body.answers, freeAnswers)

    const freeSubmit = await jsonRequest(app.base, `/v1/assessments/${freeCreate.body.assessmentId}/submit`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'free-submit-main-001' },
      body: JSON.stringify({ revision: 2 })
    })
    assert.equal(freeSubmit.response.status, 200)
    assert.equal(freeSubmit.body.resultState, 'READY')
    assert.equal(freeSubmit.body.result.result_kind, 'FAMILY_EDUCATION_SNAPSHOT')
    assert.equal(freeSubmit.body.result.next_step_status, 'AVAILABLE')

    const stateAfterFree = await jsonRequest(app.base, '/v1/me/education-compass/state', { headers: owner.headers })
    assert.equal(stateAfterFree.response.status, 200)
    assert.equal(stateAfterFree.body.students[0].nextAction, 'START_LEVEL_2')

    const growthCreate = await jsonRequest(app.base, `/v1/students/${owner.studentId}/education-assessments`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'growth-create-main-001' },
      body: JSON.stringify(growthCreateBody(freeCreate.body.assessmentId, 'GAOKAO'))
    })
    assert.equal(growthCreate.response.status, 201)
    assert.equal(growthCreate.body.assessmentKind, 'STUDENT_GROWTH_DISCOVERY')

    const growthBank = await jsonRequest(app.base, `/v1/assessments/${growthCreate.body.assessmentId}/questionnaire`, {
      headers: owner.headers
    })
    assert.equal(growthBank.response.status, 200)
    assert.equal(growthBank.body.questionnaire.educationSystem, 'GAOKAO')
    assert.deepEqual(growthBank.body.questionnaire.systemQuestionIds, ['GK01', 'GK02', 'GK03', 'GK04', 'GK05'])
    assert.deepEqual(growthBank.body.questionnaire.presentation, {
      version: 'education_compass_presentation_v1', estimatedMinutesMin: 15, estimatedMinutesMax: 20,
      totalQuestions: growthBank.body.questionnaire.questions.length,
      requiredQuestions: growthBank.body.questionnaire.requiredQuestionIds.length,
      progressMode: 'QUESTION_COUNT', scoringMode: 'NONE',
      experienceTitle: '¥39.90 学生成长发现',
      experienceEyebrow: 'STUDENT · 15—20 分钟',
      experienceSummary: '从学习表现、学习过程、思维方式与兴趣方向发现当前成长关键点。',
      respondentHint: '仅限学生本人作答；家长可协助操作或解释，但不得代选答案。',
      completionOutcome: '先完成并提交测评；付款后解锁 Student Snapshot、Strength Signals、Learning Bottlenecks、Subject Focus、Growth Direction 与 30-Day Action Plan。',
      primaryActionHint: '先完成学生本人测评，再决定是否解锁完整报告'
    })

    const growthAnswers = requiredAnswers(growthBank.body.questionnaire, {
      EGD01: 'CONFIRM_STUDENT_SELF',
      EGD02: 'UPPER_SECONDARY',
      EGD03: 'GAOKAO'
    })
    const growthSave = await jsonRequest(app.base, `/v1/assessments/${growthCreate.body.assessmentId}/draft`, {
      method: 'PUT',
      headers: owner.headers,
      body: JSON.stringify({
        revision: growthCreate.body.revision,
        educationSystem: 'GAOKAO',
        answers: growthAnswers,
        clientSaveToken: 'growth-save-main-001'
      })
    })
    assert.equal(growthSave.response.status, 200)
    assert.equal(growthSave.body.canSubmit, true)

    const growthRestored = await jsonRequest(app.base, `/v1/assessments/${growthCreate.body.assessmentId}/draft`, {
      headers: owner.headers
    })
    assert.equal(growthRestored.response.status, 200)
    assert.equal(growthRestored.body.revision, growthSave.body.revision)
    assert.deepEqual(growthRestored.body.answers, growthAnswers)

    const growthSubmit = await jsonRequest(app.base, `/v1/assessments/${growthCreate.body.assessmentId}/submit`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'growth-submit-main-001' },
      body: JSON.stringify({ revision: growthSave.body.revision })
    })
    assert.equal(growthSubmit.response.status, 200, JSON.stringify(growthSubmit.body))
    assert.equal(growthSubmit.body.resultState, 'LOCKED')
    assert.equal(growthSubmit.body.resultKind, 'STUDENT_GROWTH_DISCOVERY')
    assert.equal(growthSubmit.body.resultVersion, 'student_growth_discovery_report_v1.0.0')
    assert.equal(growthSubmit.body.systemResultMarker, 'FULL_SYSTEM_BANK')
    const lockedJson = JSON.stringify(growthSubmit.body)
    for (const forbidden of [
      'student_snapshot', 'strength_signals', 'learning_bottlenecks',
      'subject_focus', 'growth_direction', 'action_plan_30d', 'evidence_refs'
    ]) assert.equal(lockedJson.includes(forbidden), false, `locked response leaked ${forbidden}`)

    const lockedResult = await jsonRequest(app.base, `/v1/assessments/${growthCreate.body.assessmentId}/result`, {
      headers: owner.headers
    })
    assert.equal(lockedResult.response.status, 200)
    assert.equal(lockedResult.body.resultState, 'LOCKED')
    assert.equal(lockedResult.body.resultKind, 'STUDENT_GROWTH_DISCOVERY')
    assert.equal(JSON.stringify(lockedResult.body).includes('strength_signals'), false)
    const lockedReport = await jsonRequest(app.base, `/v1/reports/${growthSubmit.body.reportId}`, {
      headers: owner.headers
    })
    assert.equal(lockedReport.response.status, 200)
    assert.equal(lockedReport.body.access, 'preview')
    assert.equal('full' in lockedReport.body, false)
    assert.equal(lockedReport.body.capabilities.nextSupport.askwise.status, 'RESERVED')
    assert.equal(lockedReport.body.capabilities.nextSupport.askwise.enabled, false)
    assert.equal(lockedReport.body.capabilities.nextSupport.deepAssessment.state, 'DEFERRED')
    assert.equal(lockedReport.body.capabilities.nextSupport.advisor.available, false)

    const product = await jsonRequest(app.base, '/v1/education-compass/products/growth-discovery', {
      headers: owner.headers
    })
    assert.equal(product.response.status, 200)
    assert.equal(product.body.product.productCode, GROWTH_DISCOVERY_PRODUCT_CODE)
    assert.equal(product.body.product.amountFen, 3990)
    assert.equal(product.body.product.paymentTiming, 'AFTER_SUBMIT_BEFORE_REPORT')
    assert.equal(product.body.product.paymentEnabled, true)

    const forgedAmount = await jsonRequest(app.base, `/v1/assessments/${growthCreate.body.assessmentId}/orders`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'growth-forged-amount-001' },
      body: JSON.stringify({ productCode: GROWTH_DISCOVERY_PRODUCT_CODE, amountFen: 1 })
    })
    assert.equal(forgedAmount.response.status, 400)
    assert.equal(forgedAmount.body.error.code, 'UNKNOWN_REQUEST_FIELDS')
    const membershipSku = await jsonRequest(app.base, `/v1/assessments/${growthCreate.body.assessmentId}/orders`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'growth-membership-sku-001' },
      body: JSON.stringify({ productCode: 'PHOENIX_MEMBER_199' })
    })
    assert.equal(membershipSku.response.status, 400)
    assert.equal(membershipSku.body.error.code, 'PRODUCT_NOT_SUPPORTED')
    assert.equal((await app.store.read((tx) => tx.findMany('orders', {
      userId: owner.userId,
      assessmentId: growthCreate.body.assessmentId
    }))).length, 0)

    const orderKey = 'growth-order-main-001'
    const order = await jsonRequest(app.base, `/v1/assessments/${growthCreate.body.assessmentId}/orders`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': orderKey },
      body: JSON.stringify({ productCode: GROWTH_DISCOVERY_PRODUCT_CODE })
    })
    assert.equal(order.response.status, 201)
    assert.equal(order.body.status, 'CREATED')
    assert.equal(order.body.amountFen, 3990)
    const storedOrder = await app.store.read(async (tx) => tx.findById('orders', order.body.orderId))
    assert.ok(storedOrder)
    assert.notEqual(storedOrder.idempotencyKey, orderKey)
    assert.equal(storedOrder.idempotencyKey, `v05_order_${createHash('sha256').update(orderKey).digest('hex')}`)
    const storedOrderIdempotency = await app.store.read(async (tx) => tx.findOne('idempotencyRecords', {
      userId: owner.userId,
      domain: 'ORDER_CREATE',
      keyDigest: createHash('sha256').update(orderKey).digest('hex')
    }))
    assert.equal(storedOrderIdempotency?.resourceId, order.body.orderId)

    const orderReplay = await jsonRequest(app.base, `/v1/assessments/${growthCreate.body.assessmentId}/orders`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': orderKey },
      body: JSON.stringify({ productCode: GROWTH_DISCOVERY_PRODUCT_CODE })
    })
    assert.equal(orderReplay.response.status, 201)
    assert.equal(orderReplay.body.orderId, order.body.orderId)

    const prepay = await jsonRequest(app.base, `/v1/orders/${order.body.orderId}/wechat-prepay`, {
      method: 'POST',
      headers: owner.headers,
      body: JSON.stringify({})
    })
    assert.equal(prepay.response.status, 200)
    assert.equal(prepay.body.status, 'PENDING')
    assert.equal(typeof prepay.body.paymentParams.paySign, 'string')

    // A client-side requestPayment success signal is not trusted. Without a
    // verified provider notification there is no entitlement and no report.
    const stillLocked = await jsonRequest(app.base, `/v1/assessments/${growthCreate.body.assessmentId}/result`, {
      headers: owner.headers
    })
    assert.equal(stillLocked.body.resultState, 'LOCKED')
    const entitlementCountBefore = await app.store.read(async (tx) =>
      (await tx.findMany('entitlements', { userId: owner.userId })).length)
    assert.equal(entitlementCountBefore, 0)

    for (const path of [
      `/v1/assessments/${growthCreate.body.assessmentId}/result`,
      `/v1/reports/${growthSubmit.body.reportId}`,
      `/v1/orders/${order.body.orderId}`
    ]) {
      const forbidden = await jsonRequest(app.base, path, { headers: other.headers })
      assert.equal(forbidden.response.status, 403, `cross-owner request should fail: ${path}`)
    }

    app.mockPay.setOrderState(order.body.outTradeNo, 'SUCCESS')
    const transaction = await app.mockPay.queryOrder(order.body.outTradeNo)
    const notification = app.mockPay.makeTransactionNotification(transaction)
    const firstNotification = await postMockWebhook(app.base, notification)
    assert.equal(firstNotification.status, 204)
    const repeatedNotification = await postMockWebhook(app.base, notification)
    assert.equal(repeatedNotification.status, 204)

    const paymentCounts = await app.store.read(async (tx) => ({
      entitlements: (await tx.findMany('entitlements', { userId: owner.userId })).length,
      transactionEvents: (await tx.findMany('paymentEvents', { eventKind: 'TRANSACTION' })).length
    }))
    assert.deepEqual(paymentCounts, { entitlements: 1, transactionEvents: 1 })

    const paidOrder = await jsonRequest(app.base, `/v1/orders/${order.body.orderId}`, { headers: owner.headers })
    assert.equal(paidOrder.response.status, 200)
    assert.equal(paidOrder.body.status, 'PAID')

    const fullResult = await jsonRequest(app.base, `/v1/assessments/${growthCreate.body.assessmentId}/result`, {
      headers: owner.headers
    })
    assert.equal(fullResult.response.status, 200)
    assert.equal(fullResult.body.resultState, 'READY')
    assert.equal(fullResult.body.result.result_kind, 'STUDENT_GROWTH_DISCOVERY')
    for (const section of [
      'student_snapshot', 'strength_signals', 'learning_bottlenecks',
      'subject_focus', 'growth_direction', 'action_plan_30d'
    ]) assert.ok(section in fullResult.body.result, `full result must contain ${section}`)

    const report = await jsonRequest(app.base, `/v1/reports/${growthSubmit.body.reportId}`, {
      headers: owner.headers
    })
    assert.equal(report.response.status, 200)
    assert.equal(report.body.access, 'full')
    assert.equal(report.body.reportKind, 'STUDENT_GROWTH_DISCOVERY')
    assert.equal(report.body.full.modules.length, 6)
    assert.equal(report.body.full.result.result_kind, 'STUDENT_GROWTH_DISCOVERY')
    assert.deepEqual(report.body.capabilities.nextSupport.askwise, {
      status: 'RESERVED', enabled: false, reasonCode: 'ASKWISE_CAPABILITY_UNAVAILABLE', requiresExplicitConsent: true
    })
    assert.equal(report.body.capabilities.nextSupport.deepAssessment.state, 'DEFERRED')
    assert.equal(report.body.capabilities.nextSupport.deepAssessment.displayPrice, null)
    assert.equal(report.body.capabilities.nextSupport.advisor.available, false)
  } finally {
    await app.close()
  }
})

test('next-support capabilities and advisor intent remain server-authoritative', async () => {
  const app = await listen()
  try {
    const owner = await createProfile(app, 'education-http-next-support-owner', '6')
    const other = await createProfile(app, 'education-http-next-support-other', '7')
    const free = await completeLevelOne(app, owner, 'GAOKAO', 'next-support-free', {
      FP08: 'DEEP_ASSESSMENT_INFO'
    })
    const growth = await completeLevelTwo(
      app, owner, free.assessmentId, 'GAOKAO', 'next-support-growth'
    )
    const deepBody = {
      preferredTime: '工作日晚间',
      topic: '了解深度教育成长评估',
      reportId: growth.reportId,
      studentId: owner.studentId,
      intent: 'DEEP_ASSESSMENT',
      consent: advisorConsent()
    }

    const beforePayment = await jsonRequest(app.base, '/v1/advisor-requests', {
      method: 'POST', headers: owner.headers, body: JSON.stringify(deepBody)
    })
    assert.equal(beforePayment.response.status, 409)
    assert.equal(beforePayment.body.error.code, 'DEEP_ASSESSMENT_REPORT_NOT_READY')

    for (const intent of ['ASKWISE_LEARNING_SUPPORT', 'UNKNOWN']) {
      const invalid = await jsonRequest(app.base, '/v1/advisor-requests', {
        method: 'POST', headers: owner.headers, body: JSON.stringify({ ...deepBody, intent })
      })
      assert.equal(invalid.response.status, 400)
      assert.equal(invalid.body.error.code, 'ADVISOR_INTENT_INVALID')
    }
    const unknownField = await jsonRequest(app.base, '/v1/advisor-requests', {
      method: 'POST', headers: owner.headers,
      body: JSON.stringify({ ...deepBody, unexpected: true })
    })
    assert.equal(unknownField.response.status, 400)
    assert.equal(unknownField.body.error.code, 'UNKNOWN_REQUEST_FIELDS')

    const generic = await jsonRequest(app.base, '/v1/advisor-requests', {
      method: 'POST', headers: owner.headers,
      body: JSON.stringify({ preferredTime: '周末', topic: '一般咨询', consent: advisorConsent() })
    })
    assert.equal(generic.response.status, 201, JSON.stringify(generic.body))
    assert.equal(generic.body.request.intent, 'GENERAL_ADVISOR')

    const order = await jsonRequest(app.base, `/v1/assessments/${growth.assessmentId}/orders`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'next-support-order-001' },
      body: JSON.stringify({ productCode: GROWTH_DISCOVERY_PRODUCT_CODE })
    })
    assert.equal(order.response.status, 201, JSON.stringify(order.body))
    const prepay = await jsonRequest(app.base, `/v1/orders/${order.body.orderId}/wechat-prepay`, {
      method: 'POST', headers: owner.headers, body: JSON.stringify({})
    })
    assert.equal(prepay.response.status, 200, JSON.stringify(prepay.body))
    app.mockPay.setOrderState(order.body.outTradeNo, 'SUCCESS')
    const transaction = await app.mockPay.queryOrder(order.body.outTradeNo)
    assert.equal((await postMockWebhook(app.base, app.mockPay.makeTransactionNotification(transaction))).status, 204)

    const report = await jsonRequest(app.base, `/v1/reports/${growth.reportId}`, { headers: owner.headers })
    assert.equal(report.response.status, 200)
    assert.equal(report.body.access, 'full')
    assert.equal(report.body.capabilities.nextSupport.askwise.status, 'RESERVED')
    assert.equal(report.body.capabilities.nextSupport.askwise.enabled, false)
    assert.equal(report.body.capabilities.nextSupport.deepAssessment.state, 'AVAILABLE')
    assert.deepEqual(report.body.capabilities.nextSupport.deepAssessment.reasonCodes,
      ['USER_REQUESTED_DEEP_ASSESSMENT'])
    assert.equal(report.body.capabilities.nextSupport.deepAssessment.ctaMode,
      'ADVISOR_INFORMATION_OR_APPOINTMENT_ONLY')
    assert.equal(report.body.capabilities.nextSupport.deepAssessment.advisorIntent, 'DEEP_ASSESSMENT')
    assert.equal(report.body.capabilities.nextSupport.deepAssessment.displayPrice, null)
    assert.equal(report.body.capabilities.nextSupport.advisor.available, true)

    const secondStudent = await jsonRequest(app.base, '/v1/me/students', {
      method: 'POST', headers: owner.headers,
      body: JSON.stringify({ name: '另一位合成学生', age: 15, educationSystem: 'DSE', grade: 'UPPER_SECONDARY' })
    })
    assert.equal(secondStudent.response.status, 201)
    const mismatch = await jsonRequest(app.base, '/v1/advisor-requests', {
      method: 'POST', headers: owner.headers,
      body: JSON.stringify({ ...deepBody, studentId: secondStudent.body.student.id })
    })
    assert.equal(mismatch.response.status, 409)
    assert.equal(mismatch.body.error.code, 'ADVISOR_CONTEXT_MISMATCH')

    const crossOwner = await jsonRequest(app.base, '/v1/advisor-requests', {
      method: 'POST', headers: other.headers, body: JSON.stringify(deepBody)
    })
    assert.equal(crossOwner.response.status, 403)
    assert.equal(crossOwner.body.error.code, 'ADVISOR_STUDENT_FORBIDDEN')

    const deep = await jsonRequest(app.base, '/v1/advisor-requests', {
      method: 'POST', headers: owner.headers, body: JSON.stringify(deepBody)
    })
    assert.equal(deep.response.status, 201, JSON.stringify(deep.body))
    assert.equal(deep.body.request.intent, 'DEEP_ASSESSMENT')
    assert.equal(deep.body.request.assessmentId, growth.assessmentId)
    assert.equal(deep.body.request.reportId, growth.reportId)

    const linkedConsents = await app.store.read(async (tx) => {
      const assessment = await tx.findById('assessments', growth.assessmentId)
      assert.ok(assessment?.coreConsentGrantId)
      assert.ok(assessment.studentAssentGrantId)
      const core = await tx.findById('consentGrants', assessment.coreConsentGrantId)
      const assent = await tx.findById('consentGrants', assessment.studentAssentGrantId)
      assert.ok(core)
      assert.ok(assent)
      return { core, assent }
    })
    const alteredConsentCases = [
      {
        grant: linkedConsents.core,
        expectedCode: 'CORE_ASSESSMENT_CONSENT_REQUIRED',
        mutations: [
          ['copy hash', { copyTextHash: '0'.repeat(64) }],
          ['locale', { locale: 'en-US' }],
          ['subject type', { subjectType: 'FAMILY' as const }],
          ['subject id', { subjectId: 'different-subject' }],
          ['guardian authority', { guardianAuthorityStatus: 'UNKNOWN' as const }]
        ] as const
      },
      {
        grant: linkedConsents.assent,
        expectedCode: 'STUDENT_ASSESSMENT_ASSENT_REQUIRED',
        mutations: [
          ['copy hash', { copyTextHash: 'f'.repeat(64) }],
          ['locale', { locale: 'en-US' }],
          ['subject type', { subjectType: 'FAMILY' as const }],
          ['subject id', { subjectId: 'different-subject' }],
          ['guardian authority', { guardianAuthorityStatus: 'CONFIRMED' as const }]
        ] as const
      }
    ]
    for (const consentCase of alteredConsentCases) {
      for (const [label, mutation] of consentCase.mutations) {
        await app.store.transaction(async (tx) => {
          await tx.update('consentGrants', consentCase.grant.id, mutation)
        })
        const denied = await jsonRequest(app.base, '/v1/advisor-requests', {
          method: 'POST', headers: owner.headers, body: JSON.stringify(deepBody)
        })
        assert.equal(denied.response.status, 403, `${label}: ${JSON.stringify(denied.body)}`)
        assert.equal(denied.body.error.code, consentCase.expectedCode, label)
        await app.store.transaction(async (tx) => {
          await tx.update('consentGrants', consentCase.grant.id, consentCase.grant)
        })
      }
    }
  } finally {
    await app.close()
  }
})

test('IB uses the common bank and returns SYSTEM_BANK_PENDING without leaking the locked report', async () => {
  const app = await listen()
  try {
    const owner = await createProfile(app, 'education-http-ib-owner', '3')
    const free = await completeLevelOne(app, owner, 'IB', 'ib-001')
    assert.equal(free.result.education_system, 'IB')

    const growthCreate = await jsonRequest(app.base, `/v1/students/${owner.studentId}/education-assessments`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'growth-create-ib-001' },
      body: JSON.stringify(growthCreateBody(free.assessmentId, 'IB'))
    })
    assert.equal(growthCreate.response.status, 201)

    const questionnaire = await jsonRequest(app.base, `/v1/assessments/${growthCreate.body.assessmentId}/questionnaire`, {
      headers: owner.headers
    })
    assert.equal(questionnaire.response.status, 200)
    assert.equal(questionnaire.body.questionnaire.questionnaireVersion, GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION)
    assert.equal(questionnaire.body.questionnaire.educationSystem, 'IB')
    assert.deepEqual(questionnaire.body.questionnaire.systemQuestionIds, [])
    assert.equal(questionnaire.body.questionnaire.systemResultMarker, 'SYSTEM_BANK_PENDING')
    assert.equal(questionnaire.body.questionnaire.presentation.totalQuestions,
      questionnaire.body.questionnaire.questions.length)
    assert.equal(questionnaire.body.questionnaire.presentation.requiredQuestions,
      questionnaire.body.questionnaire.requiredQuestionIds.length)

    const answers = requiredAnswers(questionnaire.body.questionnaire, {
      EGD01: 'CONFIRM_STUDENT_SELF',
      EGD02: 'UPPER_SECONDARY',
      EGD03: 'IB'
    })
    const saved = await jsonRequest(app.base, `/v1/assessments/${growthCreate.body.assessmentId}/draft`, {
      method: 'PUT',
      headers: owner.headers,
      body: JSON.stringify({
        revision: growthCreate.body.revision,
        educationSystem: 'IB',
        answers,
        clientSaveToken: 'growth-save-ib-001'
      })
    })
    assert.equal(saved.response.status, 200)
    assert.equal(saved.body.canSubmit, true)

    const submitted = await jsonRequest(app.base, `/v1/assessments/${growthCreate.body.assessmentId}/submit`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'growth-submit-ib-001' },
      body: JSON.stringify({ revision: saved.body.revision })
    })
    assert.equal(submitted.response.status, 200, JSON.stringify(submitted.body))
    assert.equal(submitted.body.resultState, 'LOCKED')
    assert.equal(submitted.body.systemResultMarker, 'SYSTEM_BANK_PENDING')
    assert.equal(JSON.stringify(submitted.body).includes('student_snapshot'), false)
  } finally {
    await app.close()
  }
})

test('V0.5 consent grants are reusable while active and withdrawal fences draft, result and submit', async () => {
  const app = await listen()
  try {
    const owner = await createProfile(app, 'education-http-consent-owner', '4')
    const completed = await completeLevelOne(app, owner, 'GAOKAO', 'consent-source-001')
    const source = await app.store.read(async (tx) => tx.findById('assessments', completed.assessmentId))
    assert.ok(source?.coreConsentGrantId)

    const second = await jsonRequest(app.base, '/v1/education-compass/free-parent-assessments', {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'free-create-consent-reuse-002' },
      body: JSON.stringify(freeCreateBody(owner.studentId))
    })
    assert.equal(second.response.status, 201, JSON.stringify(second.body))
    const secondAssessment = await app.store.read(async (tx) => tx.findById('assessments', second.body.assessmentId))
    assert.equal(secondAssessment?.coreConsentGrantId, source.coreConsentGrantId)

    const coreWithdrawal = await jsonRequest(
      app.base,
      `/v1/me/education-compass/consents/${owner.studentId}/CORE_ASSESSMENT`,
      { method: 'DELETE', headers: owner.headers }
    )
    assert.equal(coreWithdrawal.response.status, 200, JSON.stringify(coreWithdrawal.body))
    assert.equal(coreWithdrawal.body.scope, 'CORE_ASSESSMENT')
    assert.equal(coreWithdrawal.body.studentId, owner.studentId)
    assert.equal(coreWithdrawal.body.enabled, false)
    assert.equal(coreWithdrawal.body.withdrawnGrantCount, 1)
    const fencedResult = await jsonRequest(app.base, `/v1/assessments/${completed.assessmentId}/result`, {
      headers: owner.headers
    })
    assert.equal(fencedResult.response.status, 403)
    assert.equal(fencedResult.body.error.code, 'CORE_ASSESSMENT_CONSENT_REQUIRED')
    const fencedDraft = await jsonRequest(app.base, `/v1/assessments/${second.body.assessmentId}/draft`, {
      headers: owner.headers
    })
    assert.equal(fencedDraft.response.status, 403)
    assert.equal(fencedDraft.body.error.code, 'CORE_ASSESSMENT_CONSENT_REQUIRED')
    const stateAfterCoreWithdrawal = await jsonRequest(app.base, '/v1/me/education-compass/state', {
      headers: owner.headers
    })
    assert.equal(stateAfterCoreWithdrawal.response.status, 200)
    assert.equal(stateAfterCoreWithdrawal.body.students[0].nextAction, 'START_FREE_PARENT_COMPASS')
    assert.equal(stateAfterCoreWithdrawal.body.students[0].assessmentId, null)
    const reportsAfterCoreWithdrawal = await jsonRequest(app.base, '/v1/me/reports', { headers: owner.headers })
    assert.equal(reportsAfterCoreWithdrawal.response.status, 200)
    assert.equal(reportsAfterCoreWithdrawal.body.reports.some(
      (report: { id: string }) => report.id === completed.reportId
    ), false)

    const renewed = await completeLevelOne(app, owner, 'GAOKAO', 'consent-renewed-003')
    const renewedSource = await app.store.read(async (tx) => tx.findById('assessments', renewed.assessmentId))
    assert.ok(renewedSource?.coreConsentGrantId)
    assert.notEqual(renewedSource.coreConsentGrantId, source.coreConsentGrantId)

    const growth = await jsonRequest(app.base, `/v1/students/${owner.studentId}/education-assessments`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'growth-create-consent-fence-001' },
      body: JSON.stringify(growthCreateBody(renewed.assessmentId, 'GAOKAO'))
    })
    assert.equal(growth.response.status, 201, JSON.stringify(growth.body))
    const bank = await jsonRequest(app.base, `/v1/assessments/${growth.body.assessmentId}/questionnaire`, {
      headers: owner.headers
    })
    assert.equal(bank.response.status, 200)
    const answers = requiredAnswers(bank.body.questionnaire, {
      EGD01: 'CONFIRM_STUDENT_SELF', EGD02: 'UPPER_SECONDARY', EGD03: 'GAOKAO'
    })
    const saved = await jsonRequest(app.base, `/v1/assessments/${growth.body.assessmentId}/draft`, {
      method: 'PUT', headers: owner.headers,
      body: JSON.stringify({ revision: growth.body.revision, answers, clientSaveToken: 'save-growth-consent-fence-001' })
    })
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body))
    const growthAssessment = await app.store.read(async (tx) => tx.findById('assessments', growth.body.assessmentId))
    assert.ok(growthAssessment?.studentAssentGrantId)
    const assentWithdrawal = await jsonRequest(
      app.base,
      `/v1/me/education-compass/consents/${owner.studentId}/STUDENT_ASSESSMENT_ASSENT`,
      { method: 'DELETE', headers: owner.headers }
    )
    assert.equal(assentWithdrawal.response.status, 200, JSON.stringify(assentWithdrawal.body))
    assert.equal(assentWithdrawal.body.scope, 'STUDENT_ASSESSMENT_ASSENT')
    assert.equal(assentWithdrawal.body.studentId, owner.studentId)
    assert.equal(assentWithdrawal.body.enabled, false)
    assert.equal(assentWithdrawal.body.withdrawnGrantCount, 1)
    const fencedSubmit = await jsonRequest(app.base, `/v1/assessments/${growth.body.assessmentId}/submit`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'growth-submit-consent-fence-001' },
      body: JSON.stringify({ revision: saved.body.revision })
    })
    assert.equal(fencedSubmit.response.status, 403)
    assert.equal(fencedSubmit.body.error.code, 'STUDENT_ASSESSMENT_ASSENT_REQUIRED')
    const stateAfterAssentWithdrawal = await jsonRequest(app.base, '/v1/me/education-compass/state', {
      headers: owner.headers
    })
    assert.equal(stateAfterAssentWithdrawal.response.status, 200)
    assert.equal(stateAfterAssentWithdrawal.body.students[0].assessmentId, renewed.assessmentId)
    assert.equal(stateAfterAssentWithdrawal.body.students[0].sourceAssessmentId, renewed.assessmentId)
    assert.equal(stateAfterAssentWithdrawal.body.students[0].nextAction, 'START_LEVEL_2')
  } finally {
    await app.close()
  }
})

test('advisor consent withdrawal is scoped to the selected family or student subject', async () => {
  const app = await listen()
  try {
    const owner = await createProfile(app, 'education-http-advisor-consent-scope', '8')
    const consent = {
      scope: 'ADVISOR_CONTACT', copyVersion: 'advisor_contact_opt_in_v1.0.0-rc1',
      locale: 'zh-CN', guardianAuthorityConfirmed: true
    }
    const familyRequest = await jsonRequest(app.base, '/v1/advisor-requests', {
      method: 'POST', headers: owner.headers,
      body: JSON.stringify({ preferredTime: '周末上午', topic: '家庭支持', consent })
    })
    assert.equal(familyRequest.response.status, 201, JSON.stringify(familyRequest.body))
    const studentRequest = await jsonRequest(app.base, '/v1/advisor-requests', {
      method: 'POST', headers: owner.headers,
      body: JSON.stringify({
        preferredTime: '周末下午', topic: '学生支持', studentId: owner.studentId, consent
      })
    })
    assert.equal(studentRequest.response.status, 201, JSON.stringify(studentRequest.body))

    const withdrawn = await jsonRequest(app.base, '/v1/me/integration-consents/advisor-contact', {
      method: 'PUT', headers: owner.headers,
      body: JSON.stringify({
        enabled: false, copyVersion: consent.copyVersion, locale: consent.locale,
        guardianAuthorityConfirmed: true
      })
    })
    assert.equal(withdrawn.response.status, 200, JSON.stringify(withdrawn.body))
    const listed = await jsonRequest(app.base, '/v1/me/advisor-requests', { headers: owner.headers })
    const byId = new Map<string, { id: string; status: string }>(
      listed.body.requests.map((request: { id: string; status: string }) => [request.id, request])
    )
    assert.equal(byId.get(familyRequest.body.request.id)?.status, 'CANCELLED_BY_CONSENT_WITHDRAWAL')
    assert.equal(byId.get(studentRequest.body.request.id)?.status, 'PENDING')
  } finally {
    await app.close()
  }
})

test('verified payment after Level 2 consent withdrawal stays locked and enters auditable refund review', async () => {
  const app = await listen()
  try {
    const owner = await createProfile(app, 'education-http-payment-consent-race', '5')
    const free = await completeLevelOne(app, owner, 'GAOKAO', 'payment-consent-race-free')
    const growth = await completeLevelTwo(
      app, owner, free.assessmentId, 'GAOKAO', 'payment-consent-race-growth'
    )
    const order = await jsonRequest(app.base, `/v1/assessments/${growth.assessmentId}/orders`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'payment-consent-race-order' },
      body: JSON.stringify({ productCode: GROWTH_DISCOVERY_PRODUCT_CODE })
    })
    assert.equal(order.response.status, 201, JSON.stringify(order.body))
    const prepay = await jsonRequest(app.base, `/v1/orders/${order.body.orderId}/wechat-prepay`, {
      method: 'POST', headers: owner.headers, body: JSON.stringify({})
    })
    assert.equal(prepay.response.status, 200, JSON.stringify(prepay.body))
    assert.equal(prepay.body.status, 'PENDING')

    const withdrawn = await jsonRequest(
      app.base,
      `/v1/me/education-compass/consents/${owner.studentId}/STUDENT_ASSESSMENT_ASSENT`,
      { method: 'DELETE', headers: owner.headers }
    )
    assert.equal(withdrawn.response.status, 200, JSON.stringify(withdrawn.body))
    assert.equal(withdrawn.body.enabled, false)

    app.mockPay.setOrderState(order.body.outTradeNo, 'SUCCESS')
    const transaction = await app.mockPay.queryOrder(order.body.outTradeNo)
    const paymentNotification = app.mockPay.makeTransactionNotification(transaction)
    assert.equal((await postMockWebhook(app.base, paymentNotification)).status, 204)

    const afterCharge = await jsonRequest(app.base, `/v1/orders/${order.body.orderId}`, {
      headers: owner.headers
    })
    assert.equal(afterCharge.response.status, 200)
    assert.equal(afterCharge.body.status, 'REFUNDING')
    const afterChargeState = await app.store.read(async (tx) => ({
      report: await tx.findById('reports', growth.reportId),
      entitlements: await tx.findMany('entitlements', { orderId: order.body.orderId }),
      refunds: await tx.findMany('refunds', { orderId: order.body.orderId })
    }))
    assert.equal(afterChargeState.report?.status, 'LOCKED')
    assert.equal(afterChargeState.report?.deliveryStatus, 'LOCKED')
    assert.equal(afterChargeState.entitlements.length, 0)
    assert.equal(afterChargeState.refunds.length, 1)
    const [autoRefund] = afterChargeState.refunds
    assert.ok(autoRefund)
    assert.equal(autoRefund.status, 'PROCESSING')
    assert.equal(autoRefund.reason, 'CONSENT_WITHDRAWN_BEFORE_DELIVERY')

    const refundNotification = app.mockPay.makeRefundNotification({
      eventId: `mock_refund_abnormal_${autoRefund.id}`,
      mchId: app.mockPay.mchId,
      outTradeNo: order.body.outTradeNo,
      outRefundNo: autoRefund.outRefundNo,
      providerRefundId: `mock_refund_${autoRefund.outRefundNo}`,
      refundStatus: 'ABNORMAL',
      refundFen: 3990,
      totalFen: 3990,
      currency: 'CNY'
    })
    assert.equal((await postMockRefundWebhook(app.base, refundNotification)).status, 204)

    const terminal = await app.store.read(async (tx) => ({
      order: await tx.findById('orders', order.body.orderId),
      report: await tx.findById('reports', growth.reportId),
      entitlements: await tx.findMany('entitlements', { orderId: order.body.orderId }),
      refund: await tx.findOne('refunds', { orderId: order.body.orderId }),
      manualReviews: await tx.findMany('auditLogs', {
        action: 'AUTOMATIC_REFUND_MANUAL_REVIEW_REQUIRED', entityId: order.body.orderId
      })
    }))
    assert.equal(terminal.refund?.status, 'ABNORMAL')
    assert.equal(terminal.order?.status, 'REFUNDING')
    assert.equal(terminal.report?.status, 'LOCKED')
    assert.equal(terminal.report?.deliveryStatus, 'LOCKED')
    assert.equal(terminal.entitlements.length, 0)
    assert.equal(terminal.manualReviews.length, 1)
    const [manualReview] = terminal.manualReviews
    assert.ok(manualReview)
    assert.deepEqual(manualReview.metadata, {
      refundStatus: 'ABNORMAL', reason: 'CONSENT_WITHDRAWN_BEFORE_DELIVERY'
    })
  } finally {
    await app.close()
  }
})

test('assessment and paid report access reject every altered frozen-consent identity field', async () => {
  const app = await listen()
  try {
    const owner = await createProfile(app, 'education-http-consent-metadata-owner', '6')
    const free = await completeLevelOne(app, owner, 'GAOKAO', 'consent-metadata-free')
    const growth = await completeLevelTwo(app, owner, free.assessmentId, 'GAOKAO', 'consent-metadata-growth')
    const order = await jsonRequest(app.base, `/v1/assessments/${growth.assessmentId}/orders`, {
      method: 'POST',
      headers: { ...owner.headers, 'Idempotency-Key': 'consent-metadata-order' },
      body: JSON.stringify({ productCode: GROWTH_DISCOVERY_PRODUCT_CODE })
    })
    assert.equal(order.response.status, 201, JSON.stringify(order.body))
    const prepay = await jsonRequest(app.base, `/v1/orders/${order.body.orderId}/wechat-prepay`, {
      method: 'POST', headers: owner.headers, body: JSON.stringify({})
    })
    assert.equal(prepay.response.status, 200, JSON.stringify(prepay.body))
    app.mockPay.setOrderState(order.body.outTradeNo, 'SUCCESS')
    const transaction = await app.mockPay.queryOrder(order.body.outTradeNo)
    assert.equal((await postMockWebhook(app.base, app.mockPay.makeTransactionNotification(transaction))).status, 204)

    const full = await jsonRequest(app.base, `/v1/reports/${growth.reportId}`, { headers: owner.headers })
    assert.equal(full.response.status, 200, JSON.stringify(full.body))
    assert.equal(full.body.access, 'full')

    const linked = await app.store.read(async (tx) => {
      const assessment = await tx.findById('assessments', growth.assessmentId)
      assert.ok(assessment?.coreConsentGrantId)
      assert.ok(assessment.studentAssentGrantId)
      const core = await tx.findById('consentGrants', assessment.coreConsentGrantId)
      const assent = await tx.findById('consentGrants', assessment.studentAssentGrantId)
      assert.ok(core)
      assert.ok(assent)
      return { core, assent }
    })

    const cases = [
      {
        grant: linked.core,
        expectedCode: 'CORE_ASSESSMENT_CONSENT_REQUIRED',
        mutations: [
          ['copy hash', { copyTextHash: '0'.repeat(64) }],
          ['locale', { locale: 'en-US' }],
          ['subject type', { subjectType: 'FAMILY' as const }],
          ['subject id', { subjectId: 'different-subject' }],
          ['guardian authority', { guardianAuthorityStatus: 'UNKNOWN' as const }]
        ] as const
      },
      {
        grant: linked.assent,
        expectedCode: 'STUDENT_ASSESSMENT_ASSENT_REQUIRED',
        mutations: [
          ['copy hash', { copyTextHash: 'f'.repeat(64) }],
          ['locale', { locale: 'en-US' }],
          ['subject type', { subjectType: 'FAMILY' as const }],
          ['subject id', { subjectId: 'different-subject' }],
          ['guardian authority', { guardianAuthorityStatus: 'CONFIRMED' as const }]
        ] as const
      }
    ]
    for (const consentCase of cases) {
      for (const [label, mutation] of consentCase.mutations) {
        await app.store.transaction(async (tx) => {
          await tx.update('consentGrants', consentCase.grant.id, mutation)
        })
        for (const path of [
          `/v1/assessments/${growth.assessmentId}/result`,
          `/v1/reports/${growth.reportId}`
        ]) {
          const denied = await jsonRequest(app.base, path, { headers: owner.headers })
          assert.equal(denied.response.status, 403, `${label}: ${JSON.stringify(denied.body)}`)
          assert.equal(denied.body.error.code, consentCase.expectedCode, label)
        }
        await app.store.transaction(async (tx) => {
          await tx.update('consentGrants', consentCase.grant.id, consentCase.grant)
        })
      }
    }
  } finally {
    await app.close()
  }
})

test('real HTTP backend and wx.request adapter complete login, profiles, Level 1 and Level 2', async () => {
  const app = await listen()
  const projectRoot = path.resolve(__dirname, '../../..')
  const runtime = require(path.join(projectRoot, 'config/runtime.js')) as {
    apiBaseUrl: () => string
    isDemo: () => boolean
  }
  const api = require(path.join(projectRoot, 'services/api.js')) as {
    accessToken: () => string
    setAccessToken: (token: string) => void
  }
  const authClient = require(path.join(projectRoot, 'services/auth.js')) as {
    loginFamilyUser: () => Promise<{ id: string; role: string }>
  }
  const familyClient = require(path.join(projectRoot, 'services/family-data.js')) as any
  const compassClient = require(path.join(projectRoot, 'services/education-compass.js')) as any
  const originalRuntime = { apiBaseUrl: runtime.apiBaseUrl, isDemo: runtime.isDemo }
  const originalWx = (globalThis as any).wx
  const originalGetApp = (globalThis as any).getApp
  const storage = new Map<string, unknown>()
  const requestedPaths: string[] = []
  let currentUser: { id: string; role: string } | null = null

  try {
    // The production adapter must still see HTTPS. This wx.request shim maps the
    // synthetic HTTPS origin onto the ephemeral loopback server without making
    // any external request.
    runtime.apiBaseUrl = () => 'https://mini-client.test.invalid'
    runtime.isDemo = () => false
    ;(globalThis as any).getApp = () => ({
      getCurrentUser: () => currentUser,
      setCurrentUser: (user: { id: string; role: string } | null) => { currentUser = user }
    })
    ;(globalThis as any).wx = {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      login: ({ success }: { success: (value: { code: string }) => void }) => {
        success({ code: 'miniprogram-real-http-contract' })
      },
      request: (options: any) => {
        void (async () => {
          try {
            const requested = new URL(options.url)
            assert.equal(requested.protocol, 'https:')
            assert.equal(requested.host, 'mini-client.test.invalid')
            requestedPaths.push(`${requested.pathname}${requested.search}`)
            const headers = new Headers(options.header || {})
            const hasBody = options.data !== undefined && !['GET', 'HEAD'].includes(String(options.method || 'GET'))
            const response = await fetch(`${app.base}${requested.pathname}${requested.search}`, {
              method: options.method || 'GET',
              headers,
              ...(hasBody ? { body: JSON.stringify(options.data) } : {})
            })
            const text = await response.text()
            let data: unknown = undefined
            if (text) {
              try { data = JSON.parse(text) } catch (error) { data = text }
            }
            options.success({
              statusCode: response.status,
              data,
              header: Object.fromEntries(response.headers.entries())
            })
          } catch (error) {
            options.fail({ errMsg: 'request:fail loopback adapter error' })
          }
        })()
      }
    }
    api.setAccessToken('')

    const user = await authClient.loginFamilyUser()
    assert.equal(user.role, 'family_user')
    assert.ok(api.accessToken(), 'the real login response must be retained by the wx storage adapter')

    const family = await familyClient.saveFamily(user.id, {
      family_name: '小程序 HTTP 契约家庭',
      parent_name: '小程序契约家长',
      phone: '13900000007',
      location: '本地回环测试',
      goal: '验证真实前后端契约'
    })
    assert.equal(family._source, 'remote')
    assert.equal((await familyClient.getFamily(user.id)).id, family.id)
    const student = await familyClient.saveStudent(family.id, {
      name: '小程序契约学生', age: '16', gender: '', school: '',
      education_system: 'GAOKAO', grade: 'UPPER_SECONDARY', interest: '', goal: ''
    })
    assert.equal(student._source, 'remote')
    assert.deepEqual((await familyClient.getStudents(family.id)).map((item: any) => item.id), [student.id])

    const freeAssessment = await compassClient.createFreeParentAssessment({
      studentId: student.id,
      sourceEntry: 'MINIPROGRAM_HOME',
      guardianConsent: {
        consentVersion: 'guardian_core_assessment_v1.0.0-rc1',
        locale: 'zh-CN',
        guardianConfirmed: true
      }
    }, compassClient.createIdempotencyKey('http_free'))
    assert.equal(freeAssessment.revision, 1)
    const freeBank = await compassClient.getAssessmentQuestionnaire(freeAssessment.assessmentId)
    const freeSaved = await compassClient.saveDraft(freeAssessment.assessmentId, {
      revision: freeAssessment.revision,
      clientSaveToken: compassClient.createClientSaveToken(),
      answers: requiredAnswers(freeBank, {
        FP01: 'UPPER_SECONDARY', FP02: 'GAOKAO', FP06: 'WILLING', FP08: 'STUDENT_ASSESSMENT'
      })
    })
    const freeSubmitted = await compassClient.submitAssessment(freeAssessment.assessmentId, {
      revision: freeSaved.revision
    }, compassClient.createIdempotencyKey('http_free_submit'))
    assert.equal(freeSubmitted.status, 'SUBMITTED')
    const familyResult = await compassClient.getResult(freeAssessment.assessmentId)
    assert.equal(familyResult.resultState, 'READY')
    assert.equal(familyResult.result.result_kind, 'FAMILY_EDUCATION_SNAPSHOT')
    const afterLevelOne = await compassClient.getState()
    assert.equal(
      typeof afterLevelOne.nextAction === 'string' ? afterLevelOne.nextAction : afterLevelOne.nextAction.code,
      'START_LEVEL_2'
    )

    const growthAssessment = await compassClient.createStudentGrowthAssessment(student.id, {
      sourceAssessmentId: freeAssessment.assessmentId,
      sourceEntry: 'LEVEL_1_RESULT',
      educationSystem: 'GAOKAO',
      studentAssent: {
        consentVersion: 'student_assent_growth_discovery_v1.0.0-rc1',
        locale: 'zh-CN',
        studentConfirmed: true
      }
    }, compassClient.createIdempotencyKey('http_growth'))
    assert.equal(growthAssessment.revision, 1)
    const growthBank = await compassClient.getAssessmentQuestionnaire(growthAssessment.assessmentId)
    const growthSaved = await compassClient.saveDraft(growthAssessment.assessmentId, {
      revision: growthAssessment.revision,
      educationSystem: 'GAOKAO',
      clientSaveToken: compassClient.createClientSaveToken(),
      answers: requiredAnswers(growthBank, {
        EGD01: 'CONFIRM_STUDENT_SELF', EGD02: 'UPPER_SECONDARY', EGD03: 'GAOKAO'
      })
    })
    const growthSubmitted = await compassClient.submitAssessment(growthAssessment.assessmentId, {
      revision: growthSaved.revision
    }, compassClient.createIdempotencyKey('http_growth_submit'))
    assert.equal(growthSubmitted.resultState, 'LOCKED')
    const lockedResult = await compassClient.getResult(growthAssessment.assessmentId)
    assert.equal(lockedResult.resultState, 'LOCKED')
    assert.equal(lockedResult.result, undefined, 'the wx client must not receive paid report content before entitlement')
    assert.ok(requestedPaths.includes('/v1/auth/wechat/session'))
    assert.ok(requestedPaths.includes('/v1/me/family'))
    assert.ok(requestedPaths.includes(`/v1/assessments/${freeAssessment.assessmentId}/submit`))
    assert.ok(requestedPaths.includes(`/v1/assessments/${growthAssessment.assessmentId}/submit`))
  } finally {
    try { api.setAccessToken('') } catch (error) {}
    runtime.apiBaseUrl = originalRuntime.apiBaseUrl
    runtime.isDemo = originalRuntime.isDemo
    if (originalWx === undefined) delete (globalThis as any).wx
    else (globalThis as any).wx = originalWx
    if (originalGetApp === undefined) delete (globalThis as any).getApp
    else (globalThis as any).getApp = originalGetApp
    await app.close()
  }
})
