const assert = require('assert')

function questionnaireFixture() {
  return {
    version: 'education_growth_discovery_v1.0.0-rc1',
    schemaDigest: 'sha256:test-bank',
    assessmentKind: 'STUDENT_GROWTH_DISCOVERY',
    respondentRole: 'STUDENT',
    educationSystem: 'GAOKAO',
    presentation: {
      version: 'education_compass_presentation_v1',
      estimatedMinutesMin: 15,
      estimatedMinutesMax: 20,
      totalQuestions: 999,
      requiredQuestions: 999,
      progressMode: 'QUESTION_COUNT',
      scoringMode: 'NONE',
      experienceEyebrow: 'STUDENT GROWTH DISCOVERY',
      experienceTitle: '后端体验标题',
      experienceSummary: '后端体验摘要',
      respondentHint: '后端作答人提示',
      completionOutcome: '后端完成结果',
      primaryActionHint: '后端首要行动提示'
    },
    option_catalogs: {
      subject_GAOKAO: [
        { code: 'CHINESE', label: '语文' },
        { code: 'MATHEMATICS', label: '数学' },
        { code: 'UNSURE', label: '暂不确定' }
      ]
    },
    registries: {
      CN_PROVINCES: [{ code: 'CN_GD', label: '广东' }, { code: 'UNSURE', label: '暂不确定' }],
      ACHIEVEMENT_BANDS: [{ code: 'BAND_70_79', label: '70%—79%' }, { code: 'NOT_PROVIDED', label: '不提供' }]
    },
    questions: [
      {
        id: 'EGD03', key: 'education_system', label: '课程体系', type: 'SINGLE_CHOICE', required: true, scored: false,
        options: [{ code: 'GAOKAO', label: '内地课程／高考' }, { code: 'DSE', label: 'DSE' }],
        validation: { minSelections: 1, maxSelections: 1 }, scope: 'COMMON'
      },
      {
        id: 'EGD06', key: 'goals', label: '改善目标', type: 'MULTI_CHOICE', required: true, scored: false,
        options: [{ code: 'PROCESS', label: '学习过程' }, { code: 'DIRECTION', label: '兴趣方向' }, { code: 'UNSURE', label: '暂不确定' }],
        validation: { minSelections: 1, maxSelections: 2, exclusiveOptions: ['UNSURE'] }, scope: 'COMMON'
      },
      {
        id: 'EGD04', key: 'major_exam_year', label: '主要考试年份', type: 'YEAR_SELECT', required: true, scored: false,
        validation: { min: 'CURRENT_YEAR', max: 'CURRENT_YEAR_PLUS_8', sentinelValues: ['UNSURE'] }, scope: 'COMMON'
      },
      {
        id: 'EGD08', key: 'strength_subjects', label: '相对有把握的学科', type: 'MULTI_CHOICE_DYNAMIC', required: true, scored: false,
        validation: { minSelections: 1, maxSelections: 2, exclusiveOptions: ['UNSURE'] }, scope: 'COMMON'
      },
      {
        id: 'GK01', key: 'province_region', label: '省份', type: 'PROVINCE_REGION_SELECT', required: true, scored: false,
        options_ref: 'CN_PROVINCES', validation: { minSelections: 1, maxSelections: 1 }, scope: 'SYSTEM'
      },
      {
        id: 'GK05', key: 'subject_achievement_bands', label: '成绩区间', type: 'SUBJECT_RANGE_MATRIX', required: false, scored: false,
        options_ref: 'option_catalogs.subject_GAOKAO + ACHIEVEMENT_BANDS', validation: { maxRows: 3, allowEmpty: true }, scope: 'SYSTEM'
      }
    ]
  }
}

function testQuestionnaireModel() {
  const model = require('../models/education-compass-questionnaire')
  assert.deepStrictEqual(Object.keys(model.QUESTION_TYPES).sort(), [
    'MULTI_CHOICE', 'MULTI_CHOICE_DYNAMIC', 'PROVINCE_REGION_SELECT',
    'SINGLE_CHOICE', 'SUBJECT_RANGE_MATRIX', 'YEAR_SELECT'
  ])
  const bank = model.normalizeQuestionBank(questionnaireFixture(), { currentYear: 2026 })
  assert.strictEqual(bank.questions.length, 6)
  assert.strictEqual(bank.schemaDigest, 'sha256:test-bank')
  assert.deepStrictEqual(bank.presentation, {
    version: 'education_compass_presentation_v1',
    estimatedMinutesMin: 15,
    estimatedMinutesMax: 20,
    totalQuestions: 6,
    requiredQuestions: 5,
    progressMode: 'QUESTION_COUNT',
    scoringMode: 'NONE',
    experienceEyebrow: 'STUDENT GROWTH DISCOVERY',
    experienceTitle: '后端体验标题',
    experienceSummary: '后端体验摘要',
    respondentHint: '后端作答人提示',
    completionOutcome: '后端完成结果',
    primaryActionHint: '后端首要行动提示'
  })
  assert.strictEqual(bank.questionByKey.strength_subjects.options[0].code, 'CHINESE')
  assert.strictEqual(bank.questionByKey.subject_achievement_bands.matrix.ranges[0].code, 'BAND_70_79')

  const answers = {
    education_system: 'GAOKAO',
    goals: ['PROCESS'],
    major_exam_year: '2027',
    strength_subjects: ['MATHEMATICS'],
    province_region: 'CN_GD',
    subject_achievement_bands: [{ subjectCode: 'MATHEMATICS', rangeCode: 'BAND_70_79' }]
  }
  const valid = model.validateAnswers(bank, answers)
  assert.strictEqual(valid.valid, true)
  assert.strictEqual(valid.coverage, 100)
  const view = model.buildViewModel(bank, answers)
  assert.deepStrictEqual(view.presentation, bank.presentation)
  assert.strictEqual(view.questions.find((question) => question.key === 'strength_subjects').options[1].selected, true)

  const freeFixture = questionnaireFixture()
  freeFixture.assessmentKind = 'FREE_PARENT_COMPASS'
  freeFixture.respondentRole = 'PARENT_GUARDIAN'
  freeFixture.presentation = { version: 'education_compass_presentation_v1', estimatedMinutesMin: 3, estimatedMinutesMax: 5 }
  const freeBank = model.normalizeQuestionBank(freeFixture, { currentYear: 2026 })
  assert.strictEqual(freeBank.presentation.experienceEyebrow, 'FREE PARENT EDUCATION COMPASS')
  assert.strictEqual(freeBank.presentation.estimatedMinutesMin, 3)
  assert.strictEqual(freeBank.presentation.primaryActionHint, '完成免费问卷，查看家庭教育快照')

  const invalid = model.validateAnswers(bank, { ...answers, goals: ['UNSURE', 'PROCESS'], injected_label: '中文值' })
  assert(invalid.errors.some((error) => error.code === 'EXCLUSIVE_OPTION_CONFLICT'))
  assert(invalid.errors.some((error) => error.code === 'UNKNOWN_ANSWER_FIELD'))

  const switched = model.switchEducationSystem(bank, answers, 'DSE')
  assert.strictEqual(switched.answers.education_system, 'DSE')
  assert.strictEqual(switched.answers.goals[0], 'PROCESS')
  assert.strictEqual(switched.answers.province_region, undefined)
  assert.deepStrictEqual(switched.droppedFields.sort(), ['province_region', 'subject_achievement_bands'])
  assert.strictEqual(switched.auditEvent.eventType, 'SYSTEM_ROUTE_CHANGED')
}

function testReportRegistry() {
  const reports = require('../models/education-compass-report')
  const legacy = reports.renderResult({
    access: 'full',
    full: { modules: Array.from({ length: 6 }, (_, index) => ({ key: `m${index + 1}`, title: `模块${index + 1}`, summary: '历史内容', items: [] })) }
  })
  assert.strictEqual(legacy.rendererKey, reports.RENDERER_KEYS.LEGACY_SIX_MODULES)
  assert.strictEqual(legacy.sections.length, 6)

  const snapshot = reports.renderResult({
    result_kind: 'FAMILY_EDUCATION_SNAPSHOT', result_version: 'family_education_snapshot_v1.0.0',
    family_id: 'fam_1', student_id: 'stu_1', assessment_id: 'asm_free', education_system: 'GAOKAO', grade_stage: 'UPPER_SECONDARY',
    family_concerns: ['LEARNING_HABITS'], observed_strength_signals: ['LOGICAL_ANALYSIS'],
    observed_difficulty_signals: ['METHOD_GAP'], student_readiness: 'WILLING', family_priorities: ['LEARNING_CAPABILITY'],
    preferred_next_support: 'STUDENT_ASSESSMENT', next_step_status: 'AVAILABLE', next_step_reason_codes: ['STUDENT_READY_FOR_SELF_ASSESSMENT']
  })
  assert.strictEqual(snapshot.rendererKey, reports.RENDERER_KEYS.FAMILY_SNAPSHOT)
  assert(snapshot.sections.every((section) => section.source === 'PARENT_OBSERVATION'))

  const growth = reports.renderResult({
    assessmentId: 'asm_growth', reportId: 'rpt_growth', resultState: 'READY',
    result: {
    result_kind: 'STUDENT_GROWTH_DISCOVERY', result_version: 'student_growth_discovery_report_v1.0.0',
    student_snapshot: { stage: 'UPPER_SECONDARY' },
    strength_signals: [], learning_bottlenecks: [], subject_focus: [], growth_direction: [], action_plan_30d: {},
    learning_signals: [], interest_signals: [], recommended_focus: [], evidence_refs: [], questionnaire_versions: []
    }
  })
  assert.strictEqual(growth.sections.length, 6)
  assert.strictEqual(growth.reportId, 'rpt_growth')
  assert.strictEqual(growth.assessmentId, 'asm_growth')
  assert.deepStrictEqual(growth.sections.map((section) => section.key), [
    'student_snapshot', 'strength_signals', 'learning_bottlenecks', 'subject_focus', 'growth_direction', 'action_plan_30d'
  ])

  const locked = reports.renderResult({
    result_kind: 'STUDENT_GROWTH_DISCOVERY', result_state: 'LOCKED', assessment_id: 'asm_growth',
    product_code: 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1', amount_fen: 3990, currency: 'CNY',
    next_action: 'PURCHASE_TO_UNLOCK_REPORT', system_result_marker: 'FULL_SYSTEM_BANK',
    student_snapshot: { leaked: true }, strength_signals: [{ leaked: true }], evidence_refs: ['EGD08']
  })
  assert.strictEqual(locked.resultState, 'LOCKED')
  assert.deepStrictEqual(locked.sections, [])
  assert(!JSON.stringify(locked).includes('leaked'))
  assert(!JSON.stringify(locked).includes('EGD08'))
}

function testNavigation() {
  const navigation = require('../utils/education-compass-navigation')
  const firstEntryState = {
    studentId: 'stu_1', nextAction: 'START_FREE_PARENT_COMPASS',
    students: [{ studentId: 'stu_1', nextAction: 'START_FREE_PARENT_COMPASS' }]
  }
  const firstEntry = navigation.resolveCompassEntry(navigation.selectStudentState(firstEntryState, 'stu_1'), 1)
  assert.strictEqual(firstEntry.authorized, true)
  assert.strictEqual(firstEntry.destination.url, '/pages/compass/index?level=1&studentId=stu_1')
  const directPaidBypass = navigation.resolveCompassEntry(navigation.selectStudentState(firstEntryState, 'stu_1'), 2)
  assert.strictEqual(directPaidBypass.authorized, false, 'a direct level=2 URL must not bypass the free parent assessment')
  assert.strictEqual(directPaidBypass.destination.code, 'START_LEVEL_1')

  const snapshotAvailableState = {
    studentId: 'stu_1', sourceAssessmentId: 'asm_free', nextAction: 'START_LEVEL_2',
    students: [{ studentId: 'stu_1', sourceAssessmentId: 'asm_free', nextAction: 'START_LEVEL_2' }]
  }
  const paidEntry = navigation.resolveCompassEntry(navigation.selectStudentState(snapshotAvailableState, 'stu_1'), 2)
  assert.strictEqual(paidEntry.authorized, true)
  assert(paidEntry.destination.url.includes('sourceAssessmentId=asm_free'))
  assert.strictEqual(navigation.resolveCompassEntry(snapshotAvailableState, 1).authorized, false,
    'once Level 1 is complete, the server-owned nextAction must replace a stale Level 1 entry')

  const multiStudentState = {
    studentId: 'stu_primary', nextAction: 'START_LEVEL_2', sourceAssessmentId: 'asm_primary',
    students: [
      { studentId: 'stu_primary', nextAction: 'START_LEVEL_2', sourceAssessmentId: 'asm_primary' },
      { studentId: 'stu_second', nextAction: 'START_FREE_PARENT_COMPASS', sourceAssessmentId: null }
    ]
  }
  const selectedSecond = navigation.selectStudentState(multiStudentState, 'stu_second')
  assert.strictEqual(selectedSecond.studentId, 'stu_second')
  assert.strictEqual(navigation.resolveCompassEntry(selectedSecond, 2).authorized, false,
    'one student\'s completed snapshot must not unlock another student\'s Level 2 entry')
  assert.throws(() => navigation.selectStudentState(multiStudentState, 'stu_unknown'),
    (error) => error.code === 'EDUCATION_COMPASS_NEXT_ACTION_INVALID')

  const continueLevel2 = navigation.resolveDestination({
    studentId: 'stu 1', assessmentId: 'asm/2', nextAction: { code: 'CONTINUE_STUDENT_GROWTH_DISCOVERY' }
  })
  assert.strictEqual(continueLevel2.method, 'navigateTo')
  assert(continueLevel2.url.includes('studentId=stu%201'))
  assert(continueLevel2.url.includes('assessmentId=asm%2F2'))

  const startLevel2 = navigation.resolveDestination({
    next_action: { code: 'START_LEVEL_2', target: { student_id: 'stu_1', source_assessment_id: 'asm_free' } }
  })
  assert(startLevel2.url.includes('sourceAssessmentId=asm_free'))
  const calls = []
  navigation.navigateFromState({ nextAction: 'HOME' }, { switchTab: (options) => calls.push(options) })
  assert.deepStrictEqual(calls, [{ url: '/pages/home/index' }])
  assert.strictEqual(navigation.resolveReportDestination({
    id: 'rpt_free', assessment_id: 'asm_free', report_kind: 'FAMILY_EDUCATION_SNAPSHOT', entitled: false
  }).url, '/pages/compass-preview/index?mode=family-snapshot&assessmentId=asm_free')
  assert.strictEqual(navigation.resolveReportDestination({
    id: 'rpt_growth', assessment_id: 'asm_growth', report_kind: 'STUDENT_GROWTH_DISCOVERY', entitled: false
  }, { reportId: 'rpt_growth', orderId: 'ord_growth' }).url,
  '/pages/payment-result/index?orderId=ord_growth&reportId=rpt_growth')
  assert.strictEqual(navigation.resolveReportDestination({
    id: 'rpt_growth', assessment_id: 'asm_growth', report_kind: 'STUDENT_GROWTH_DISCOVERY', entitled: true
  }).url, '/pages/report/index?id=rpt_growth')
  assert.throws(() => navigation.resolveDestination({ nextAction: { code: 'UNKNOWN_ACTION' } }), (error) => error.code === 'EDUCATION_COMPASS_NEXT_ACTION_INVALID')
}

async function testCompassEntryPageGate() {
  const client = require('../services/education-compass')
  const familyData = require('../services/family-data')
  const originals = {
    getState: client.getState,
    getGrowthProduct: client.getGrowthProduct,
    getFamily: familyData.getFamily,
    getStudents: familyData.getStudents,
    getReports: familyData.getReports,
    accountInfo: wx.getAccountInfoSync,
    redirectTo: wx.redirectTo,
    switchTab: wx.switchTab,
    Page: global.Page
  }
  let definition
  let state
  let productCalls = 0
  const redirects = []

  try {
    wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } })
    wx.redirectTo = ({ url }) => { redirects.push(url) }
    wx.switchTab = ({ url }) => { redirects.push(url) }
    familyData.getFamily = async () => ({ id: 'fam_1', parent_name: '测试监护人' })
    familyData.getStudents = async () => [{ id: 'stu_1', name: '测试学生', grade: '高中', education_system: 'GAOKAO' }]
    familyData.getReports = async () => []
    client.getState = async () => state
    client.getGrowthProduct = async () => {
      productCalls += 1
      return {
        productCode: client.GROWTH_PRODUCT_CODE, amountFen: 3990, currency: 'CNY',
        displayPrice: '¥39.90', paymentTiming: 'AFTER_SUBMIT_BEFORE_REPORT', paymentEnabled: false
      }
    }
    global.Page = (value) => { definition = value }
    delete require.cache[require.resolve('../pages/compass/index')]
    require('../pages/compass/index')

    function page(options) {
      const instance = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      instance.setData = function setData(update) { this.data = { ...this.data, ...update } }
      definition.onLoad.call(instance, options)
      return instance
    }

    state = {
      studentId: 'stu_1', nextAction: 'START_FREE_PARENT_COMPASS',
      students: [{ studentId: 'stu_1', nextAction: 'START_FREE_PARENT_COMPASS' }]
    }
    const blocked = page({ level: '2', studentId: 'stu_1', sourceAssessmentId: 'asm_untrusted' })
    await definition.loadV05.call(blocked, { id: 'usr_1' })
    assert.strictEqual(productCalls, 0, 'unauthorized Level 2 entry must not fetch or reveal the paid product')
    assert.strictEqual(blocked.data.level2EntryAuthorized, false)
    assert.strictEqual(blocked.data.product, null)
    assert.strictEqual(redirects.pop(), '/pages/compass/index?level=1&studentId=stu_1')

    state = {
      studentId: 'stu_1', sourceAssessmentId: 'asm_free', nextAction: 'START_LEVEL_2',
      students: [{ studentId: 'stu_1', sourceAssessmentId: 'asm_free', nextAction: 'START_LEVEL_2' }]
    }
    const allowed = page({ level: '2', studentId: 'stu_1', sourceAssessmentId: 'asm_untrusted' })
    await definition.loadV05.call(allowed, { id: 'usr_1' })
    assert.strictEqual(productCalls, 1)
    assert.strictEqual(allowed.data.level2EntryAuthorized, true)
    assert.strictEqual(allowed.data.product.displayPrice, '¥39.90')
    assert.strictEqual(allowed.sourceAssessmentId, 'asm_free', 'Level 2 must use the server-owned Level 1 source ID')
    assert.strictEqual(allowed.data.loading, false)
  } finally {
    client.getState = originals.getState
    client.getGrowthProduct = originals.getGrowthProduct
    familyData.getFamily = originals.getFamily
    familyData.getStudents = originals.getStudents
    familyData.getReports = originals.getReports
    wx.getAccountInfoSync = originals.accountInfo
    if (originals.redirectTo === undefined) delete wx.redirectTo
    else wx.redirectTo = originals.redirectTo
    if (originals.switchTab === undefined) delete wx.switchTab
    else wx.switchTab = originals.switchTab
    if (originals.Page === undefined) delete global.Page
    else global.Page = originals.Page
  }
}

async function testApiAdapter() {
  const api = require('../services/api')
  const runtime = require('../config/runtime')
  const client = require('../services/education-compass')
  const originalRequest = api.request
  const originalAccountInfo = wx.getAccountInfoSync
  const originalSetStorage = wx.setStorageSync
  const calls = []
  const storageWrites = []

  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'develop' } })
  await assert.rejects(client.getState(), (error) => error.code === 'EDUCATION_COMPASS_REMOTE_REQUIRED')
  assert.strictEqual(runtime.isDemo(), true)

  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } })
  wx.setStorageSync = (key, value) => { storageWrites.push({ key, value }) }
  api.request = async (path, options = {}) => {
    calls.push({ path, options })
    if (path === '/v1/me/education-compass/state') return { state: { student_id: 'stu_1', next_action: { code: 'START_LEVEL_1' } } }
    if (path === '/v1/education-compass/questionnaires/free_parent_compass_v1.0.0-rc1') return { questionnaire: { version: 'free_parent_compass_v1' } }
    if (path === '/v1/education-compass/free-parent-assessments') return { assessment: { id: 'asm_free', assessment_kind: 'FREE_PARENT_COMPASS', revision: 0, status: 'DRAFT' } }
    if (path === '/v1/students/stu_1/education-assessments') return { assessment: { id: 'asm_growth', assessment_kind: 'STUDENT_GROWTH_DISCOVERY', source_assessment_id: 'asm_free', revision: 0, status: 'DRAFT' } }
    if (path === '/v1/assessments/asm_growth/questionnaire') return { questionnaire: questionnaireFixture() }
    if (path === '/v1/assessments/asm_growth/draft' && options.method === 'PUT') {
      return { draft: { id: 'asm_growth', revision: 2, status: 'DRAFT', answers: options.data.answers, client_save_token: options.data.clientSaveToken } }
    }
    if (path === '/v1/assessments/asm_growth/draft') return { draft: { id: 'asm_growth', revision: 1, status: 'DRAFT', answers: { education_system: 'GAOKAO' } } }
    if (path === '/v1/assessments/asm_growth/submit') return { assessment: { id: 'asm_growth', revision: 2, status: 'SUBMITTED', result_kind: 'STUDENT_GROWTH_DISCOVERY' } }
    if (path === '/v1/assessments/asm_growth/result') return { assessmentId: 'asm_growth', resultState: 'LOCKED' }
    if (path === '/v1/education-compass/products/growth-discovery') return { product: { product_code: 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1', amount_fen: 3990, currency: 'CNY', payment_timing: 'AFTER_SUBMIT_BEFORE_REPORT' } }
    if (path === '/v1/assessments/asm_growth/orders') return { order: { id: 'ord_1', assessment_id: 'asm_growth', product_code: 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1', amount_fen: 3990, status: 'CREATED' } }
    if (path === '/v1/orders/ord_1/wechat-prepay') return { payment: { orderId: 'ord_1', paymentParams: { package: 'prepay_id=test' } } }
    if (path === '/v1/orders/ord_1') return { order: { id: 'ord_1', status: 'PAID', amount_fen: 3990 } }
    if (path === '/v1/me/integration-consents/feishu-profile') return { consent: { status: 'ACTIVE' } }
    if (path === '/v1/me/education-compass/consents/stu_1/STUDENT_ASSESSMENT_ASSENT') {
      return { scope: 'STUDENT_ASSESSMENT_ASSENT', studentId: 'stu_1', enabled: false, withdrawnGrantCount: 1 }
    }
    throw new Error(`unexpected V0.5 client path ${path}`)
  }

  try {
    assert.strictEqual((await client.getState()).studentId, 'stu_1')
    assert.strictEqual((await client.getQuestionnaireVersion('free_parent_compass_v1.0.0-rc1')).version, 'free_parent_compass_v1')
    const freeKey = client.createIdempotencyKey('free_create')
    await client.createFreeParentAssessment({
      studentId: 'stu_1', sourceEntry: 'MINIPROGRAM_HOME',
      guardianConsent: { consentVersion: 'guardian_core_assessment_v1.0.0-rc1', scope: 'CORE_ASSESSMENT', guardianConfirmed: true, rawAnswers: 'must-strip' }
    }, freeKey)
    const growthKey = client.createIdempotencyKey('growth_create')
    await client.createStudentGrowthAssessment('stu_1', {
      sourceAssessmentId: 'asm_free', educationSystem: 'GAOKAO', sourceEntry: 'LEVEL_1_RESULT',
      studentAssent: { consentVersion: 'student_assent_growth_discovery_v1.0.0-rc1', scope: 'STUDENT_ASSESSMENT_ASSENT', studentConfirmed: true }
    }, growthKey)
    assert.strictEqual((await client.getAssessmentQuestionnaire('asm_growth')).schemaDigest, 'sha256:test-bank')
    assert.strictEqual((await client.getDraft('asm_growth')).revision, 1)
    const saveToken = client.createClientSaveToken()
    const saved = await client.saveDraft('asm_growth', { answers: { EGD03: 'GAOKAO' }, revision: 1, clientSaveToken: saveToken })
    assert.strictEqual(saved.revision, 2)
    assert.strictEqual(saved.clientSaveToken, saveToken)
    await assert.rejects(client.saveDraft('asm_growth', { answers: {}, revision: 2 }), (error) => error.code === 'CLIENT_SAVE_TOKEN_REQUIRED')
    const submitKey = client.createIdempotencyKey('submit')
    assert.strictEqual((await client.submitAssessment('asm_growth', { revision: 2 }, submitKey)).status, 'SUBMITTED')
    assert.strictEqual((await client.getResult('asm_growth')).resultState, 'LOCKED')
    assert.strictEqual((await client.getGrowthProduct()).amountFen, 3990)
    const validRequest = api.request
    api.request = async (path, options) => path === '/v1/education-compass/products/growth-discovery'
      ? { product: { product_code: client.GROWTH_PRODUCT_CODE, amount_fen: 4090, currency: 'CNY', payment_timing: 'AFTER_SUBMIT_BEFORE_REPORT' } }
      : validRequest(path, options)
    await assert.rejects(client.getGrowthProduct(), (error) => error.code === 'PRODUCT_CONTRACT_MISMATCH')
    api.request = validRequest
    const orderKey = client.createIdempotencyKey('order')
    assert.strictEqual((await client.createGrowthOrder('asm_growth', orderKey)).productCode, client.GROWTH_PRODUCT_CODE)
    assert.strictEqual((await client.createWechatPrepay('ord_1')).paymentParams.package, 'prepay_id=test')
    assert.strictEqual((await client.getOrder('ord_1')).status, 'PAID')
    assert.strictEqual((await client.updateFeishuProfileConsent({
      studentId: 'stu_1', consentVersion: 'feishu_profile_mirror_opt_in_v1.0.0-rc1',
      scope: 'FEISHU_PROFILE_MIRROR', guardianConfirmed: true
    })).status, 'ACTIVE')
    assert.strictEqual((await client.withdrawAssessmentConsent(
      'stu_1', 'STUDENT_ASSESSMENT_ASSENT'
    )).enabled, false)
    await assert.rejects(
      client.withdrawAssessmentConsent('stu_1', 'AI_ANALYSIS'),
      (error) => error.code === 'ASSESSMENT_CONSENT_SCOPE_INVALID'
    )

    const freeCall = calls.find((call) => call.path === '/v1/education-compass/free-parent-assessments')
    assert.strictEqual(freeCall.options.headers['Idempotency-Key'], freeKey)
    assert.strictEqual(freeCall.options.data.consent.rawAnswers, undefined)
    const growthCall = calls.find((call) => call.path === '/v1/students/stu_1/education-assessments')
    assert.strictEqual(growthCall.options.data.assessmentKind, 'STUDENT_GROWTH_DISCOVERY')
    assert.strictEqual(growthCall.options.headers['Idempotency-Key'], growthKey)
    const saveCall = calls.find((call) => call.path === '/v1/assessments/asm_growth/draft' && call.options.method === 'PUT')
    assert.deepStrictEqual(saveCall.options.data, { answers: { EGD03: 'GAOKAO' }, revision: 1, clientSaveToken: saveToken })
    const orderCall = calls.find((call) => call.path === '/v1/assessments/asm_growth/orders')
    assert.deepStrictEqual(orderCall.options.data, { productCode: 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1' })
    const withdrawalCall = calls.find((call) => call.path === '/v1/me/education-compass/consents/stu_1/STUDENT_ASSESSMENT_ASSENT')
    assert.strictEqual(withdrawalCall.options.method, 'DELETE')
    assert.strictEqual(storageWrites.length, 0, 'V0.5 remote adapter must never persist answers, reports or payment bodies in wx storage')
  } finally {
    api.request = originalRequest
    wx.getAccountInfoSync = originalAccountInfo
    wx.setStorageSync = originalSetStorage
  }
}

async function run() {
  testQuestionnaireModel()
  testReportRegistry()
  testNavigation()
  await testCompassEntryPageGate()
  await testApiAdapter()
  console.log('✓ Education Compass V0.5 client: remote adapter, canonical bank, result registry, revision and server nextAction navigation')
}

module.exports = { run }

if (require.main === module) {
  global.wx = global.wx || {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getStorageSync: () => undefined,
    setStorageSync: () => undefined,
    removeStorageSync: () => undefined
  }
  run().catch((error) => { console.error(error); process.exitCode = 1 })
}
