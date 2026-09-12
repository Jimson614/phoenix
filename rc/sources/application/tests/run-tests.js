const assert = require('assert')

const memory = new Map()
global.wx = {
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  getStorageSync: (key) => memory.get(key),
  setStorageSync: (key, value) => memory.set(key, value),
  removeStorageSync: (key) => memory.delete(key)
}

const repository = require('../services/repository')
const aiProvider = require('../services/ai-provider')
const analytics = require('../services/analytics')
const { isoNow } = require('../utils/date')
const questionnaire = require('../models/questionnaire-schema')
const store = require('../services/store')

repository.initialize()
assert(repository.getById('users', 'usr_phoenix_advisor'), 'admin seed should exist')
assert.deepStrictEqual(repository.all('partners'), [], 'partner placeholder must remain empty')
assert.deepStrictEqual(repository.all('permissions'), [], 'permission placeholder must remain empty')

const user = repository.insert('users', {
  wechat_id: 'test_openid', name: '王女士', phone: '13800000000', role: 'family_user', created_at: isoNow()
})
const family = repository.upsertFamily(user.id, {
  family_name: '王女士家庭', parent_name: '王女士', phone: '13800000000', location: '深圳 / 香港',
  goal: '帮助孩子找到适合的方向'
})
assert.strictEqual(repository.familyForUser(user.id).id, family.id)

const student = repository.upsertStudent(family.id, {
  name: '小明', age: '16', gender: '男', school: '示例学校', education_system: 'A-Level', grade: 'Year 11',
  interest: '机器人与音乐', goal: '探索工程方向'
})
assert.strictEqual(repository.studentsForFamily(family.id).length, 1)

const answers = {
  school_stage: '高中', learning_feeling: '有些迷茫', strengths: ['逻辑力', '创造力'], interests: '机器人与音乐',
  challenges: ['目标不清晰'], parent_observation: '选科时容易摇摆', parent_expectation: '独立选择',
  future_goal: '工程方向', support_need: ['方向梳理', '项目体验'], available_time: '每周一次'
}
const assessment = repository.insert('assessments', {
  student_id: student.id, type: 'education', answers, status: 'completed', created_at: isoNow()
})
const generated = aiProvider.generateGrowthInsight(student, answers)
assert.strictEqual(generated.currentStage, '升学选择与专业探索期')
assert(generated.suggestedDirection.includes('机器人与音乐'))

const totalQuestionWeight = questionnaire.allQuestions().reduce((sum, item) => sum + item.weight, 0)
assert.strictEqual(totalQuestionWeight, 100, 'questionnaire completeness weights must total 100')
assert.strictEqual(questionnaire.SCHEMA_CONTRACT.fields.length, 23, 'shared questionnaire contract must expose all 23 fields')
assert.deepStrictEqual(
  questionnaire.SCHEMA_CONTRACT.fields,
  questionnaire.allQuestions().map((item) => ({ key: item.key, type: item.type, weight: item.weight })),
  'rendered questionnaire and shared contract must not drift'
)
const thresholdAnswers = {}
let thresholdWeight = 0
for (const item of questionnaire.allQuestions()) {
  if (thresholdWeight >= 70) break
  thresholdAnswers[item.key] = item.type === 'multi' ? [item.options[0]] : (item.options && item.options[0]) || '已填写'
  thresholdWeight += item.weight
}
assert.strictEqual(questionnaire.completeness(thresholdAnswers).score, 70)
assert.strictEqual(questionnaire.completeness(thresholdAnswers).eligible, true)
delete thresholdAnswers.parent_expectation
assert.strictEqual(questionnaire.completeness(thresholdAnswers).eligible, false)

const demoCompass = aiProvider.generateDemoCompassReport(student, { ...answers, ...thresholdAnswers }, 100)
assert.deepStrictEqual(demoCompass.full.modules.map((item) => item.key), [
  'student_profile', 'strengths', 'major_directions', 'university_match', 'routes', 'action_plan'
])
assert(!JSON.stringify(demoCompass.preview).includes('完整院校清单'), 'preview must not contain paid report details')

const migrated = store.migrate({ schemaVersion: '0.1.0', users: [{ id: 'kept' }], reports: [] })
assert.strictEqual(migrated.users[0].id, 'kept', 'schema migration must preserve existing local records')
assert.deepStrictEqual(migrated.orders, [])

const report = repository.insert('reports', {
  assessment_id: assessment.id,
  summary: { currentStage: generated.currentStage, strength: generated.strength, potentialChallenge: generated.potentialChallenge, narrative: generated.narrative },
  recommendation: { suggestedDirection: generated.suggestedDirection, nextAction: generated.nextAction, engine: generated.engine },
  created_at: isoNow()
})
repository.addTimeline(family.id, 'compass_completed', '已完成 Education Compass')
repository.addTimeline(family.id, 'report_generated', '已生成成长洞察报告')

const overview = repository.familyOverview(family.id)
assert.strictEqual(overview.reports[0].id, report.id)
assert(overview.events.length >= 4, 'family relationship history should contain profile and compass events')
assert.strictEqual(overview.reports[0].assessment.type, 'education')

repository.insert('advisorNotes', {
  family_id: family.id, advisor_id: 'usr_phoenix_advisor', note: '建议先安排一次项目体验',
  follow_up_status: '跟进中', created_at: isoNow()
})
assert.strictEqual(repository.familyOverview(family.id).notes[0].follow_up_status, '跟进中')

analytics.track('family_profile_completed', { userId: user.id, familyId: family.id })
analytics.trackSession(user.id)
assert(repository.where('analyticsEvents', (event) => event.user_id === user.id).length >= 2)

wx.getWindowInfo = () => ({ statusBarHeight: 47, windowWidth: 430, platform: 'ios' })
wx.getMenuButtonBoundingClientRect = () => ({ top: 53, left: 335, width: 87, height: 32 })
const { getNavigationMetrics } = require('../utils/navigation')
assert.deepStrictEqual(getNavigationMetrics(), {
  statusBarHeight: 47,
  navigationBarHeight: 44,
  menuButtonSafeWidth: 103
})

console.log('✓ domain flow: family → student → compass → report → timeline → advisor')
console.log('✓ future models: Partner and Permission remain architecture-only')
console.log('✓ success metrics: activation, compass, relationship and return-session events')
console.log('✓ custom navigation: status bar and WeChat capsule safe areas calculated')
console.log('✓ paid Compass: versioned questionnaire, 70-point gate, six-module contract and non-destructive migration')

;(async () => {
  const assessmentService = require('../services/assessment')
  const payment = require('../services/payment')
  const reportService = require('../services/report')
  const familyData = require('../services/family-data')
  const { CONSENT_VERSION } = require('../config/compass')
  const fullAnswers = {}
  questionnaire.allQuestions().forEach((item) => {
    fullAnswers[item.key] = item.type === 'multi' ? [item.options[0]] : (item.options && item.options[0]) || '完整回答'
  })
  const draft = await assessmentService.createForStudent({
    student: { ...student, student_version: 'student_test_v1', _source: 'demo' },
    family: { ...family, _source: 'demo' },
    consent: { consentVersion: CONSENT_VERSION, scope: 'education_compass_report', guardianConfirmed: true }
  })
  const saved = await assessmentService.saveDraft(draft.assessmentId, student.id, fullAnswers)
  assert.strictEqual(saved.completenessScore, 100)
  const submitted = await assessmentService.submit(draft.assessmentId, student.id)
  assert.strictEqual(submitted.status, 'PREVIEW_READY')
  const preview = await assessmentService.preview(draft.assessmentId)
  assert.strictEqual(preview.reportId, submitted.reportId)
  assert.strictEqual(preview.full, undefined, 'preview DTO must never contain paid modules')
  const order = await payment.createOrder(draft.assessmentId)
  await payment.requestWeChatPayment(order.orderId)
  assert.strictEqual((await payment.getOrder(order.orderId)).status, 'PAID')
  const unlocked = await reportService.getReport(submitted.reportId)
  assert.strictEqual(unlocked.access, 'full')
  assert.strictEqual(unlocked.full.modules.length, 6)
  familyData.rememberMapping('student', 'local_student', 'remote_student')
  assert.strictEqual(familyData.mappedId('student', 'local_student'), 'remote_student')
  console.log('✓ demo provider: draft → preview → isolated demo unlock → six-module report')
  console.log('✓ remote profile adapter: explicit local-to-server id mapping')

  const originalAccountInfo = wx.getAccountInfoSync
  const originalSetStorage = wx.setStorageSync
  const remoteWrites = []
  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } })
  wx.setStorageSync = (key, value) => { remoteWrites.push(key); memory.set(key, value) }
  assessmentService.cacheAnswers('remote_privacy_test', { academic_summary: '不得落盘' })
  assert.deepStrictEqual(assessmentService.cachedAnswers('remote_privacy_test'), { academic_summary: '不得落盘' })
  assert(!remoteWrites.some((key) => key.indexOf('PFS_COMPASS_DRAFT_') === 0), 'remote questionnaire answers must stay in memory')
  const analyticsBefore = repository.all('analyticsEvents').length
  analytics.track('remote_privacy_event', { userId: 'remote_user', properties: { private: true } })
  assert.strictEqual(repository.all('analyticsEvents').length, analyticsBefore, 'remote analytics must not persist locally')

  const apiService = require('../services/api')
  const originalApiRequest = apiService.request
  const remoteCalls = []
  let serverDraftAnswers = { academic_summary: '服务端恢复的答案' }
  let dropIdentityField = false
  apiService.request = async (path, options = {}) => {
    remoteCalls.push({ path, options })
    if (path === '/v1/assessments/remote_assessment/draft') {
      if (options.method === 'PUT') {
        serverDraftAnswers = { ...(options.data.answers || {}) }
        if (dropIdentityField) delete serverDraftAnswers.identity_type
        return { assessmentId: 'remote_assessment', status: 'DRAFT', completenessScore: 12, missingFields: [] }
      }
      return { data: { draft: {
        assessmentId: 'remote_assessment', status: 'DRAFT', questionnaireVersion: 'education_compass_v1',
        answers: serverDraftAnswers, completenessScore: 12
      } } }
    }
    if (path === '/v1/advisor-requests') return { request: { id: 'remote_request', status: 'PENDING' } }
    throw new Error(`unexpected remote test path: ${path}`)
  }
  const restoredDraft = await assessmentService.loadDraft('remote_assessment')
  assert.strictEqual(restoredDraft.answers.academic_summary, '服务端恢复的答案')
  assert.strictEqual(assessmentService.cachedAnswers('remote_assessment').academic_summary, '服务端恢复的答案')
  assert(!remoteWrites.some((key) => key === 'PFS_COMPASS_DRAFT_remote_assessment'), 'restored remote answers must not be persisted')
  await assessmentService.saveDraft('remote_assessment', 'remote_student', {
    academic_summary: '更新后的成绩', identity_type: '内地学生'
  }, { verify: true })
  assert.strictEqual(assessmentService.cachedAnswers('remote_assessment').identity_type, '内地学生')
  dropIdentityField = true
  await assert.rejects(
    assessmentService.saveDraft('remote_assessment', 'remote_student', {
      academic_summary: '更新后的成绩', identity_type: '内地学生'
    }, { verify: true }),
    (error) => error.code === 'ANSWER_SCHEMA_MISMATCH' && error.details.droppedFields.includes('identity_type')
  )
  dropIdentityField = false
  await familyData.createAdvisorRequest(
    { id: 'remote_family', _source: 'remote' }, { id: 'remote_user', role: 'family_user' },
    { preferred_time: '工作日下午', topic: '解读报告', note: '请先查看路线模块' },
    { reportId: 'remote_report', studentId: 'remote_student' }
  )
  const advisorCall = remoteCalls.find((call) => call.path === '/v1/advisor-requests')
  assert.deepStrictEqual(advisorCall.options.data, {
    preferredTime: '工作日下午', topic: '解读报告', note: '请先查看路线模块',
    reportId: 'remote_report', studentId: 'remote_student',
    intent: 'GENERAL_ADVISOR',
    consent: {
      scope: 'ADVISOR_CONTACT', copyVersion: 'advisor_contact_opt_in_v1.0.0-rc1',
      locale: 'zh-CN', guardianAuthorityConfirmed: true
    }
  })
  await familyData.createAdvisorRequest(
    { id: 'remote_family', _source: 'remote' }, { id: 'remote_user', role: 'family_user' },
    { preferred_time: '时间均可', topic: '了解深度评估 / 预约顾问', note: '' },
    { reportId: 'remote_report', studentId: 'remote_student', intent: 'DEEP_ASSESSMENT' }
  )
  const advisorCalls = remoteCalls.filter((call) => call.path === '/v1/advisor-requests')
  assert.strictEqual(advisorCalls[advisorCalls.length - 1].options.data.intent, 'DEEP_ASSESSMENT')
  apiService.request = originalApiRequest

  const agentClient = require('../services/agent')
  const agentCalls = []
  const storageWritesBeforeAgent = remoteWrites.length
  apiService.request = async (path, options = {}) => {
    agentCalls.push({ path, options })
    if (path === '/v1/reports/rpt_agent/agent-conversations' && options.method === 'POST') {
      return { conversation: {
        id: 'acv_test', reportId: 'rpt_agent', status: 'ACTIVE', consentStatus: 'ACTIVE', createdAt: '2026-08-22T12:00:00.000Z',
        limits: { maxMessageChars: 2000, maxRepliesPerReport: 3, remainingReplies: 3 }
      } }
    }
    if (path === '/v1/reports/rpt_agent/agent-conversations') {
      return { conversations: [{ id: 'acv_test', status: 'ACTIVE', consentStatus: 'ACTIVE', remainingReplies: 3 }] }
    }
    if (path === '/v1/agent-conversations/acv_test/messages' && options.method === 'POST') {
      return { run: { id: 'arun_test', conversationId: 'acv_test', status: 'QUEUED', retryAfterMs: 400 } }
    }
    if (path === '/v1/agent-runs/arun_test') {
      return { run: { id: 'arun_test', conversationId: 'acv_test', status: 'SUCCEEDED', remainingReplies: 2, reply: {
        answer: '先把报告中的优势转成一个三周行动。', keyPoints: ['从小项目开始'], nextSteps: ['选一个题目'],
        limitations: ['仅解释当前报告'], sourceAliases: ['S1'],
        sources: [{ alias: 'S1', name: '公开招生资料', applicableYear: '2027', verifiedAt: '2026-08-20' }],
        safety: { level: 'STANDARD', requiresGuardianAttention: false }
      } } }
    }
    if (path === '/v1/agent-conversations/acv_test/messages?limit=20') {
      return { messages: [{ id: 'amsg_1', role: 'ASSISTANT', reply: {
        answer: '可信回答', keyPoints: [], nextSteps: [], limitations: ['仅供参考'], sources: [{ alias: 'S1', name: '受信来源' }],
        safety: { level: 'STANDARD', requiresGuardianAttention: false }
      } }] }
    }
    if (path === '/v1/assessments/asm_free/agent-analyses' && options.method === 'POST') {
      return { run: { id: 'aan_free', status: 'QUEUED', retryAfterMs: 500, analysisType: 'ASSESSMENT_ANALYSIS' } }
    }
    if (path === '/v1/reports/rpt_agent/agent-analyses' && options.method === 'POST') {
      return { run: { id: 'aan_paid', status: 'QUEUED', retryAfterMs: 500, analysisType: 'REPORT_ANALYSIS' } }
    }
    if (path === '/v1/agent-analyses/aan_free') {
      return { run: { id: 'aan_free', status: 'SUCCEEDED', analysisType: 'ASSESSMENT_ANALYSIS', reply: {
        answer: '这是一份有限测评概览。', keyPoints: ['兴趣方向初步集中'], nextSteps: ['和孩子核对兴趣变化'],
        limitations: ['不等同于完整报告'], sources: [{ alias: 'A1', name: '本次测评快照' }],
        safety: { level: 'STANDARD', requiresGuardianAttention: false }
      } } }
    }
    if (path === '/v1/assessments/asm_free/agent-analyses/latest') return { analysis: null }
    if (path === '/v1/reports/rpt_agent/agent-analyses/latest') {
      return { analysis: { id: 'aan_paid_latest', status: 'SUCCEEDED', analysisType: 'REPORT_ANALYSIS', reply: {
        answer: '这是最近一次完整报告分析。', keyPoints: [], nextSteps: [], limitations: ['仅供家庭规划参考'], sources: [],
        safety: { level: 'STANDARD', requiresGuardianAttention: false }
      } } }
    }
    if (path === '/v1/agent-conversations/acv_test' && options.method === 'DELETE') return undefined
    if (path === '/v1/agent-conversations/acv_test/consent' && options.method === 'DELETE') return undefined
    throw new Error(`unexpected Agent client path: ${path}`)
  }
  const createKey = agentClient.createIdempotencyKey('conversation')
  assert(/^pfs_conversation_/.test(createKey))
  const conversation = await agentClient.createConversation('rpt_agent', createKey)
  assert.strictEqual(conversation.conversationId, 'acv_test')
  assert.strictEqual(conversation.maxRepliesPerReport, 3)
  const createCall = agentCalls.find((call) => call.options.method === 'POST' && call.path.includes('/reports/'))
  assert.strictEqual(createCall.options.headers['Idempotency-Key'], createKey)
  assert.deepStrictEqual(createCall.options.data, {
    consentVersion: 'agent_analysis_opt_in_v1.0.0-rc1', scope: 'AI_ANALYSIS', locale: 'zh-CN',
    studentConfirmed: true, guardianConfirmed: true
  })
  const messageKey = agentClient.createIdempotencyKey('message')
  const queuedRun = await agentClient.sendMessage('acv_test', '报告里的优势怎样转成行动？', messageKey)
  assert.strictEqual(queuedRun.status, 'QUEUED')
  assert.strictEqual(agentCalls.find((call) => call.path === '/v1/agent-conversations/acv_test/messages' && call.options.method === 'POST').options.headers['Idempotency-Key'], messageKey)
  const completedRun = await agentClient.getRun('arun_test')
  assert.strictEqual(completedRun.reply.sources[0].alias, 'S1')
  assert(completedRun.reply.sources[0].detail.includes('适用 2027'))
  const history = await agentClient.listMessages('acv_test')
  assert.strictEqual(history.messages[0].reply.answer, '可信回答')
  await agentClient.withdrawConsent('acv_test')
  await agentClient.deleteConversation('acv_test')
  const analysisClient = require('../services/agent-analysis')
  const freeAnalysisKey = agentClient.createIdempotencyKey('free_analysis')
  const freeQueued = await analysisClient.createFreeAnalysis('asm_free', freeAnalysisKey)
  assert.strictEqual(freeQueued.analysisType, 'ASSESSMENT_ANALYSIS')
  const freeCreateCall = agentCalls.find((call) => call.path === '/v1/assessments/asm_free/agent-analyses')
  assert.strictEqual(freeCreateCall.options.headers['Idempotency-Key'], freeAnalysisKey)
  assert.deepStrictEqual(freeCreateCall.options.data, {
    consentVersion: 'agent_analysis_opt_in_v1.0.0-rc1', scope: 'AI_ANALYSIS', locale: 'zh-CN',
    studentConfirmed: true, guardianConfirmed: true
  })
  const paidAnalysisKey = agentClient.createIdempotencyKey('paid_analysis')
  const paidQueued = await analysisClient.createPaidAnalysis('rpt_agent', paidAnalysisKey)
  assert.strictEqual(paidQueued.analysisType, 'REPORT_ANALYSIS')
  assert.deepStrictEqual(agentCalls.find((call) => call.path === '/v1/reports/rpt_agent/agent-analyses').options.data,
    freeCreateCall.options.data)
  const freeResult = await analysisClient.getAnalysis('aan_free', 'free')
  assert.strictEqual(freeResult.reply.answer, '这是一份有限测评概览。')
  assert.strictEqual(freeResult.reply.sources[0].alias, 'A1')
  assert.strictEqual(await analysisClient.getLatestFreeAnalysis('asm_free'), null)
  assert.strictEqual((await analysisClient.getLatestPaidAnalysis('rpt_agent')).reply.answer, '这是最近一次完整报告分析。')
  assert.strictEqual(remoteWrites.length, storageWritesBeforeAgent, 'Agent client must not persist ids, messages or replies in wx storage')
  apiService.request = originalApiRequest

  const previousPage = global.Page
  let agentPageDefinition = null
  global.Page = (definition) => { agentPageDefinition = definition }
  delete require.cache[require.resolve('../pages/agent-chat/index')]
  const agentPageHelpers = require('../pages/agent-chat/index')
  if (previousPage === undefined) delete global.Page
  else global.Page = previousPage
  const eligibleReport = {
    access: 'full', status: 'READY', deliveryStatus: 'DELIVERED', qaPassed: true, entitled: true,
    capabilities: { agentFollowup: { available: true } }
  }
  assert.strictEqual(agentPageHelpers.reportIsEligible(eligibleReport, agentPageHelpers.capabilityFrom(eligibleReport)), true)
  assert.strictEqual(agentPageHelpers.reportIsEligible({ ...eligibleReport, entitled: false }, agentPageHelpers.capabilityFrom(eligibleReport)), false)
  assert.strictEqual(agentPageHelpers.MAX_POLL_ATTEMPTS, 60)
  assert.strictEqual(agentPageHelpers.MAX_POLL_DURATION_MS, 120000)
  assert(agentPageDefinition && typeof agentPageDefinition.withdrawConsent === 'function' && typeof agentPageDefinition.deleteConversation === 'function')
  console.log('✓ V0.4.1 Agent client: consent, idempotency, run polling DTO, trusted sources and no local transcript persistence')

  let analysisPageDefinition = null
  global.Page = (definition) => { analysisPageDefinition = definition }
  delete require.cache[require.resolve('../pages/assessment-analysis/index')]
  const analysisPageHelpers = require('../pages/assessment-analysis/index')
  if (previousPage === undefined) delete global.Page
  else global.Page = previousPage
  assert.strictEqual(analysisPageHelpers.MAX_POLL_ATTEMPTS, 60)
  assert.strictEqual(analysisPageHelpers.MAX_POLL_DURATION_MS, 120000)
  assert(analysisPageHelpers.safeStatusMessage({ status: 'BLOCKED', code: 'PII_DETECTED' }, 'free').includes('姓名'))
  assert(analysisPageHelpers.safeStatusMessage({ status: 'FAILED', code: 'AGENT_DISABLED' }, 'paid').includes('暂未开启'))
  assert(analysisPageDefinition && typeof analysisPageDefinition.startAnalysis === 'function' &&
    typeof analysisPageDefinition.resumePolling === 'function' && typeof analysisPageDefinition.onHide === 'function')
  console.log('✓ dual analysis client: free assessment and paid report contracts, independent consent and bounded polling')

  assert.strictEqual(payment.normalizeOrder({ data: { order: { id: 'nested_order', amountFen: 3990, reportId: 'nested_report' } } }).orderId, 'nested_order')
  assert.strictEqual(payment.normalizePrepay({ payment: { orderId: 'nested_order', paymentParams: { time_stamp: '1', nonce_str: 'n', package: 'prepay_id=x', sign_type: 'RSA', pay_sign: 's' } } }).paymentParams.paySign, 's')
  payment.cacheOrder({
    orderId: 'privacy_order', status: 'PENDING', amountFen: 3990,
    paymentParams: { nonceStr: 'must-not-persist', package: 'prepay_id=must-not-persist', paySign: 'must-not-persist' }
  })
  const persistedOrder = memory.get(payment.ORDER_CACHE_KEY).privacy_order
  assert.strictEqual(persistedOrder.paymentParams, undefined, 'prepay parameters must never be persisted')
  assert(!JSON.stringify(persistedOrder).includes('must-not-persist'), 'prepay signing material must not appear in order cache')
  const nestedReport = reportService.normalizeResponse({ data: { report: {
    access: 'full',
    capabilities: {
      agentFollowup: { available: false },
      nextSupport: {
        askwise: { status: 'RESERVED', enabled: false },
        deepAssessment: { state: 'DEFERRED', displayPrice: null },
        advisor: { available: false }
      }
    },
    full: demoCompass.full
  } } })
  assert.strictEqual(nestedReport.full.modules.length, 6)
  assert.strictEqual(nestedReport.capabilities.agentFollowup.available, false)
  assert.strictEqual(nestedReport.capabilities.nextSupport.askwise.status, 'RESERVED')
  assert.strictEqual(nestedReport.capabilities.nextSupport.deepAssessment.displayPrice, null)
  const serverSource = reportService.normalizeResponse({ report: { access: 'full', full: {
    ...demoCompass.full,
    sources: [{ sourceId: 'HKU_ADMISSIONS', applicableYear: '2027', verifiedAt: '2026-08-20', dataVersion: 'v3' }]
  } } })
  assert.deepStrictEqual(serverSource.full.sources[0], {
    sourceId: 'HKU_ADMISSIONS', applicableYear: '2027', verifiedAt: '2026-08-20', dataVersion: 'v3',
    name: 'HKU_ADMISSIONS', dataAsOf: '2026-08-20'
  })
  console.log('✓ remote draft: server restoration without local answer persistence')
  console.log('✓ DTO compatibility: nested order/payment/report and enriched advisor request')

  const originalInitialize = repository.initialize
  let initializedInRelease = false
  repository.initialize = () => { initializedInRelease = true }
  let capturedApp = null
  const originalApp = global.App
  global.App = (definition) => { capturedApp = definition }
  delete require.cache[require.resolve('../app')]
  require('../app')
  capturedApp.onLaunch.call(capturedApp)
  assert.strictEqual(initializedInRelease, false, 'release app launch must not initialize the local database')
  repository.initialize = originalInitialize
  global.App = originalApp
  const runtime = require('../config/runtime')
  wx.getAccountInfoSync = () => { throw new Error('runtime probe failed') }
  assert.strictEqual(runtime.mode(), 'remote', 'runtime probe errors must fail closed to remote')
  wx.getAccountInfoSync = () => ({ miniProgram: {} })
  assert.strictEqual(runtime.mode(), 'remote', 'unknown mini-program environments must fail closed to remote')
  delete wx.getAccountInfoSync
  assert.strictEqual(runtime.mode(), 'remote', 'missing account API in an actual wx runtime must fail closed to remote')
  wx.getAccountInfoSync = originalAccountInfo
  wx.setStorageSync = originalSetStorage
  assessmentService.clearRemoteSessionData()
  console.log('✓ production privacy: fail-closed runtime, no local DB init, questionnaire answer persistence or local analytics')

  await require('./education-compass-client.test').run()
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
