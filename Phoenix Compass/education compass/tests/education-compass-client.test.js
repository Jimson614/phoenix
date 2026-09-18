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

  const inconsistentDurationFixture = questionnaireFixture()
  inconsistentDurationFixture.presentation = { estimatedMinutesMin: 30 }
  const durationBank = model.normalizeQuestionBank(inconsistentDurationFixture, { currentYear: 2026 })
  assert.strictEqual(durationBank.presentation.estimatedMinutesMin, 30)
  assert.strictEqual(durationBank.presentation.estimatedMinutesMax, 30,
    'a missing maximum must never produce a descending duration range')

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

function testStudentProfileNormalization() {
  const familyData = require('../services/family-data')

  assert.deepStrictEqual(familyData.EDUCATION_SYSTEM_OPTIONS, [
    { label: '请选择', value: '' },
    { label: '内地课程', value: 'GAOKAO' },
    { label: 'DSE', value: 'DSE' },
    { label: 'IGCSE', value: 'IGCSE' },
    { label: 'IB', value: 'IB' },
    { label: 'A-Level', value: 'A_LEVEL' },
    { label: 'AP / 美式课程', value: 'AP_US' },
    { label: '其他', value: 'OTHER' }
  ])

  const educationSystemAliases = [
    [' 内地课程 ', 'GAOKAO'],
    ['内地课程／高考', 'GAOKAO'],
    ['DSE', 'DSE'],
    [' IGCSE ', 'IGCSE'],
    ['IB', 'IB'],
    ['A-Level', 'A_LEVEL'],
    ['AP / 美式课程', 'AP_US'],
    ['AP／美式课程', 'AP_US'],
    ['美式课程', 'AP_US'],
    ['其他', 'OTHER']
  ]
  educationSystemAliases.forEach(([value, expected]) => {
    assert.strictEqual(familyData.normalizeEducationSystem(value), expected)
  })
  assert.strictEqual(familyData.normalizeEducationSystem(''), '')
  assert.strictEqual(familyData.normalizeEducationSystem('未列出的课程'), 'OTHER')

  assert.strictEqual(familyData.normalizeStudentAge(' 16 '), 16)
  assert.strictEqual(familyData.normalizeStudentAge(3), 3)
  assert.strictEqual(familyData.normalizeStudentAge('100'), 100)
  ;[undefined, null, '', '   '].forEach((value) => {
    assert.strictEqual(familyData.normalizeStudentAge(value), null)
  })
  ;[2, 101, 16.5, 'abc', '１６', '1e2', '0x10', '+16', [], true].forEach((value) => {
    assert.throws(
      () => familyData.normalizeStudentAge(value),
      (error) => error.code === 'STUDENT_AGE_INVALID' && error.statusCode === 400
    )
  })

  const form = {
    name: ' 小明 ', age: '16', gender: ' 男 ', school: ' 示例学校 ',
    education_system: ' AP / 美式课程 ', grade: ' Year 11 ',
    interest: ' 机器人与音乐 ', goal: ' 探索工程方向 '
  }
  const expectedPayload = {
    name: '小明', age: 16, gender: '男', school: '示例学校', educationSystem: 'AP_US',
    grade: 'Year 11', interest: '机器人与音乐', goal: '探索工程方向'
  }
  assert.deepStrictEqual(familyData.studentPayload(form), expectedPayload)
  assert.deepStrictEqual(familyData.validateStudentForm(form), expectedPayload)
  assert.strictEqual(familyData.studentPayload({ educationSystem: 'IGCSE' }).educationSystem, 'IGCSE')
  assert.deepStrictEqual(familyData.studentPayload(), {
    name: '', age: null, gender: '', school: '', educationSystem: '', grade: '', interest: '', goal: ''
  })

  ;[
    ['name', 'name', 80],
    ['gender', 'gender', 30],
    ['school', 'school', 160],
    ['education_system', 'educationSystem', 80],
    ['grade', 'grade', 80],
    ['interest', 'interest', 500],
    ['goal', 'goal', 500]
  ].forEach(([inputField, payloadField, limit]) => {
    const atLimit = familyData.studentPayload({ ...form, [inputField]: '字'.repeat(limit) })
    if (payloadField !== 'educationSystem') assert.strictEqual(atLimit[payloadField].length, limit)
    assert.throws(
      () => familyData.studentPayload({ ...form, [inputField]: '字'.repeat(limit + 1) }),
      (error) => error.code === 'STUDENT_FIELD_TOO_LONG' && error.statusCode === 400
    )
  })

  ;[
    ['name', '   '],
    ['age', ''],
    ['school', '   '],
    ['grade', null]
  ].forEach(([field, value]) => {
    assert.throws(
      () => familyData.validateStudentForm({ ...form, [field]: value }),
      (error) => error.code === 'STUDENT_REQUIRED_FIELDS_MISSING' && error.statusCode === 400
    )
  })
}

async function testStudentEditRejectsInvalidAgeBeforeRequest() {
  const familyData = require('../services/family-data')
  const originalPage = global.Page
  const originalShowToast = wx.showToast
  const originalSaveStudent = familyData.saveStudent
  let definition
  let saveCalls = 0
  const toasts = []

  try {
    global.Page = (value) => { definition = value }
    wx.showToast = (value) => { toasts.push(value) }
    familyData.saveStudent = async () => {
      saveCalls += 1
      return { id: 'must_not_be_created' }
    }
    delete require.cache[require.resolve('../pages/student-edit/index')]
    require('../pages/student-edit/index')
    const instance = {
      ...definition,
      data: {
        ...definition.data,
        form: {
          name: '匿名学生', age: '16.5', gender: '', school: '匿名学校',
          education_system: '', grade: 'Year 10', interest: '', goal: ''
        }
      }
    }
    instance.setData = function setData(update) {
      Object.entries(update).forEach(([key, value]) => {
        const path = key.split('.')
        if (path.length === 1) this.data[key] = value
        else this.data[path[0]][path[1]] = value
      })
    }

    const igcseIndex = instance.data.systemValues.indexOf('IGCSE')
    definition.pickSystem.call(instance, { detail: { value: String(igcseIndex) } })
    assert.strictEqual(instance.data.form.education_system, 'IGCSE')
    assert.strictEqual(instance.data.systemLabel, 'IGCSE')

    await definition.save.call(instance)
    assert.strictEqual(saveCalls, 0, 'an invalid age must be rejected before the network adapter is called')
    assert.strictEqual(instance.data.saving, false)
    assert(toasts.some((item) => item.title === '年龄需填写3至100之间的整数'))
  } finally {
    familyData.saveStudent = originalSaveStudent
    if (originalShowToast === undefined) delete wx.showToast
    else wx.showToast = originalShowToast
    if (originalPage === undefined) delete global.Page
    else global.Page = originalPage
  }
}

function testHomeActionCopy() {
  const previousPage = global.Page
  try {
    global.Page = () => undefined
    delete require.cache[require.resolve('../pages/home/index')]
    const home = require('../pages/home/index')
    assert.strictEqual(home.actionCopy({ nextAction: 'CREATE_FAMILY_PROFILE' }).title, '建立家庭档案')
    assert.strictEqual(home.actionCopy({ nextAction: 'CREATE_STUDENT_PROFILE' }).title, '添加学生档案')
    assert.strictEqual(home.actionCopy({ nextAction: 'CONTINUE_FREE_PARENT_COMPASS' }).title, '继续免费家长教育罗盘')
    assert.strictEqual(home.actionCopy({ nextAction: 'CONTINUE_STUDENT_GROWTH_DISCOVERY' }).title, '继续学生成长发现')
    assert.strictEqual(home.actionCopy({ nextAction: 'VIEW_STUDENT_GROWTH_LOCKED_RESULT' }).title, '查看提交状态并解锁报告')
    assert.strictEqual(home.actionCopy({ nextAction: 'CHECK_ORDER_STATUS' }).title, '查询支付状态')
    assert.strictEqual(home.actionCopy({ nextAction: 'VIEW_FULL_REPORT' }).title, '查看学生成长发现报告')
    assert.strictEqual(home.stageCopy({ gradeStage: 'UPPER_SECONDARY' }, { grade: '旧阶段' }), '高中／Upper Secondary')
  } finally {
    if (previousPage === undefined) delete global.Page
    else global.Page = previousPage
  }
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
    result_kind: 'STUDENT_GROWTH_DISCOVERY', result_state: 'LOCKED', assessment_id: 'asm_growth', report_id: 'rpt_growth',
    product_code: 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1', amount_fen: 3990, currency: 'CNY',
    next_action: 'PURCHASE_TO_UNLOCK_REPORT', system_result_marker: 'FULL_SYSTEM_BANK',
    student_snapshot: { leaked: true }, strength_signals: [{ leaked: true }], evidence_refs: ['EGD08']
  })
  assert.strictEqual(locked.resultState, 'LOCKED')
  assert.strictEqual(locked.reportId, 'rpt_growth')
  assert.deepStrictEqual(locked.sections, [])
  assert(!JSON.stringify(locked).includes('leaked'))
  assert(!JSON.stringify(locked).includes('EGD08'))

  // Exact camelCase envelope returned by GET /v1/assessments/:id/result for an unpaid growth report.
  const serverLocked = reports.renderResult({
    assessmentId: 'asm_growth', reportId: 'rpt_growth', resultState: 'LOCKED',
    resultKind: 'STUDENT_GROWTH_DISCOVERY', resultVersion: 'student_growth_discovery_report_v1.0.0',
    productCode: 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1', amountFen: 3990, currency: 'CNY',
    nextAction: 'PURCHASE_TO_UNLOCK_REPORT', systemResultMarker: 'FULL_SYSTEM_BANK'
  })
  assert.strictEqual(serverLocked.rendererKey, reports.RENDERER_KEYS.STUDENT_GROWTH)
  assert.strictEqual(serverLocked.resultState, 'LOCKED')
  assert.strictEqual(serverLocked.amountFen, 3990)
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

  const multiReportState = {
    studentId: 'stu_primary', assessmentId: 'asm_primary', reportId: 'rpt_primary',
    students: [
      { studentId: 'stu_primary', assessmentId: 'asm_primary', reportId: 'rpt_primary' },
      { studentId: 'stu_second', assessment_id: 'asm_second', report_id: 'rpt_second' }
    ]
  }
  assert.strictEqual(navigation.assessmentIdForReport(multiReportState, 'rpt_second'), 'asm_second')
  assert.strictEqual(navigation.reportIdForAssessment(multiReportState, 'asm_second'), 'rpt_second')
  assert.strictEqual(navigation.studentIdForAssessment(multiReportState, 'asm_second'), 'stu_second')
  assert.strictEqual(navigation.assessmentIdForReport(multiReportState, 'rpt_unknown'), '',
    'a report fallback must not reuse another student\'s current assessment')

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
  let reports = []
  let productCalls = 0
  const redirects = []

  try {
    wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } })
    wx.redirectTo = ({ url }) => { redirects.push(url) }
    wx.switchTab = ({ url }) => { redirects.push(url) }
    familyData.getFamily = async () => ({ id: 'fam_1', parent_name: '测试监护人' })
    familyData.getStudents = async () => [{ id: 'stu_1', name: '测试学生', grade: '高中', education_system: 'GAOKAO' }]
    familyData.getReports = async () => reports
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
    reports = [
      { id: 'rpt_1', student_id: 'stu_1', assessment_id: 'asm_1', entitled: true, created_at: '2026-09-01T00:00:00.000Z' },
      { id: 'rpt_other', student_id: 'stu_other', assessment_id: 'asm_other', entitled: true, created_at: '2026-09-02T00:00:00.000Z' }
    ]
    const allowed = page({ level: '2', studentId: 'stu_1', sourceAssessmentId: 'asm_untrusted' })
    await definition.loadV05.call(allowed, { id: 'usr_1' })
    assert.strictEqual(productCalls, 1)
    assert.strictEqual(allowed.data.level2EntryAuthorized, true)
    assert.strictEqual(allowed.data.product.displayPrice, '¥39.90')
    assert.strictEqual(allowed.sourceAssessmentId, 'asm_free', 'Level 2 must use the server-owned Level 1 source ID')
    assert.deepStrictEqual(allowed.data.reports.map((report) => report.id), ['rpt_1'],
      'a student Compass page must not mix in another student\'s reports')
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

async function testQuestionnaireStudentIsolation() {
  const client = require('../services/education-compass')
  const session = require('../services/session')
  const originals = {
    getQuestionnaire: client.getAssessmentQuestionnaire,
    getDraft: client.getDraft,
    getState: client.getState,
    guard: session.guard,
    Page: global.Page
  }
  let definition

  try {
    session.guard = () => ({ id: 'usr_1', role: 'family_user' })
    client.getAssessmentQuestionnaire = async () => questionnaireFixture()
    client.getDraft = async () => ({
      assessmentId: 'asm_second', assessmentKind: client.ASSESSMENT_KINDS.STUDENT_GROWTH,
      educationSystem: 'GAOKAO', revision: 0, answers: {}
    })
    client.getState = async () => ({
      studentId: 'stu_primary', studentDisplayName: '第一位学生', educationSystem: 'DSE',
      students: [
        { studentId: 'stu_primary', assessmentId: 'asm_primary', studentDisplayName: '第一位学生', educationSystem: 'DSE' },
        { studentId: 'stu_second', assessmentId: 'asm_second', studentDisplayName: '第二位学生', educationSystem: 'GAOKAO' }
      ]
    })
    global.Page = (value) => { definition = value }
    delete require.cache[require.resolve('../pages/compass-questionnaire/index')]
    require('../pages/compass-questionnaire/index')
    const instance = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
    instance.setData = function setData(update) { this.data = { ...this.data, ...update } }

    await definition.loadV05.call(instance, { assessmentId: 'asm_second', studentId: 'stu_second' })

    assert.strictEqual(instance.data.error, '')
    assert.deepStrictEqual(instance.data.student, { id: 'stu_second', name: '第二位学生' })
    assert.strictEqual(instance.remoteBank.educationSystem, 'GAOKAO',
      'the selected assessment must not inherit the primary student\'s education system')

    const mismatched = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
    mismatched.setData = instance.setData
    await definition.loadV05.call(mismatched, { assessmentId: 'asm_second', studentId: 'stu_primary' })
    assert(mismatched.data.error.includes('不一致'), 'a stale or forged Student ID must not relabel another assessment')
  } finally {
    client.getAssessmentQuestionnaire = originals.getQuestionnaire
    client.getDraft = originals.getDraft
    client.getState = originals.getState
    session.guard = originals.guard
    if (originals.Page === undefined) delete global.Page
    else global.Page = originals.Page
  }
}

async function testFamilySnapshotAnalysisEntry() {
  const originalPage = global.Page
  const originalAccountInfo = wx.getAccountInfoSync
  const originalNavigateTo = wx.navigateTo
  let definition
  const navigations = []
  try {
    wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } })
    wx.navigateTo = ({ url }) => { navigations.push(url) }
    global.Page = (value) => { definition = value }
    delete require.cache[require.resolve('../pages/compass-preview/index')]
    require('../pages/compass-preview/index')
    const instance = {
      ...definition,
      data: { ...definition.data, assessmentId: 'asm/free 1', viewKind: 'family', preview: null }
    }
    definition.openFreeAnalysis.call(instance)
    assert.deepStrictEqual(navigations, [
      '/pages/assessment-analysis/index?mode=free&assessmentId=asm%2Ffree%201'
    ], 'the production family snapshot must expose its finite free-analysis flow')
  } finally {
    wx.getAccountInfoSync = originalAccountInfo
    if (originalNavigateTo === undefined) delete wx.navigateTo
    else wx.navigateTo = originalNavigateTo
    if (originalPage === undefined) delete global.Page
    else global.Page = originalPage
  }
}

async function testApiTransportHardening() {
  const api = require('../services/api')
  const runtime = require('../config/runtime')
  const originals = {
    accountEnvironment: runtime.accountEnvironment,
    allowsDevelopmentLoopbackHttp: runtime.allowsDevelopmentLoopbackHttp,
    apiBaseUrl: runtime.apiBaseUrl,
    request: wx.request,
    getStorageSync: wx.getStorageSync,
    setStorageSync: wx.setStorageSync,
    removeStorageSync: wx.removeStorageSync
  }
  const storage = new Map()
  const restoreStorage = () => {
    wx.getStorageSync = (key) => storage.get(key)
    wx.setStorageSync = (key, value) => storage.set(key, value)
    wx.removeStorageSync = (key) => storage.delete(key)
  }

  try {
    runtime.apiBaseUrl = () => 'https://mini-client.test.invalid/api'
    restoreStorage()
    api.setAccessToken('')

    wx.getStorageSync = () => { throw new Error('storage read failed') }
    wx.setStorageSync = () => { throw new Error('storage write failed') }
    wx.removeStorageSync = () => { throw new Error('storage remove failed') }
    api.setAccessToken('volatile-session-token')
    assert.strictEqual(api.accessToken(), 'volatile-session-token',
      'a transient storage failure must not interrupt the active authenticated session')

    restoreStorage()
    api.setAccessToken('')
    storage.set(api.ACCESS_TOKEN_KEY, { corrupted: true })
    assert.strictEqual(api.accessToken(), '')
    assert.strictEqual(storage.has(api.ACCESS_TOKEN_KEY), false, 'malformed persisted credentials must be discarded')
    assert.throws(() => api.setAccessToken('invalid\r\ntoken'), (error) => error.code === 'ACCESS_TOKEN_INVALID')

    api.setAccessToken('current-session-token')
    wx.request = (options) => options.success({
      statusCode: 401,
      data: { error: { code: 'SESSION_INVALID', message: 'session expired' } }
    })
    await assert.rejects(api.request('/v1/me/family'),
      (error) => error.code === 'SESSION_INVALID' && error.statusCode === 401)
    assert.strictEqual(api.accessToken(), '', 'a confirmed 401 must clear the rejected session token')

    let delayedRequest
    api.setAccessToken('old-session-token')
    wx.request = (options) => { delayedRequest = options }
    const oldRequest = api.request('/v1/me/family').catch((error) => error)
    api.setAccessToken('new-session-token')
    delayedRequest.success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID' } } })
    assert.strictEqual((await oldRequest).code, 'SESSION_INVALID')
    assert.strictEqual(api.accessToken(), 'new-session-token',
      'a late 401 from an older request must not erase a newer login')

    let sentHeaders
    wx.request = (options) => {
      sentHeaders = options.header
      options.success({ statusCode: 200, data: { ok: true } })
      options.success({ statusCode: 401, data: { error: { code: 'SESSION_INVALID' } } })
      options.fail({ errMsg: 'late duplicate callback' })
    }
    assert.deepStrictEqual(await api.request('/v1/me/family', {
      headers: { authorization: 'Bearer attacker-controlled', 'Idempotency-Key': 'safe-key-1' }
    }), { ok: true })
    assert.strictEqual(sentHeaders.Authorization, 'Bearer new-session-token')
    assert.strictEqual(sentHeaders.authorization, undefined)
    assert.strictEqual(api.accessToken(), 'new-session-token',
      'late duplicate callbacks must not mutate an already-settled request')

    wx.request = (options) => options.success(null)
    await assert.rejects(api.request('/v1/me/family'), (error) => error.code === 'INVALID_RESPONSE')
    wx.request = (options) => options.success({ statusCode: '200', data: {} })
    await assert.rejects(api.request('/v1/me/family'), (error) => error.code === 'INVALID_RESPONSE')
    wx.request = () => { throw new Error('platform request failed synchronously') }
    await assert.rejects(api.request('/v1/me/family'), (error) => error.code === 'NETWORK_ERROR')

    let requestCalls = 0
    wx.request = () => { requestCalls += 1 }
    for (const invalidPath of ['//untrusted.example/v1', '/v1/../admin', '/v1/%2e%2e/admin', '/v1/%0d%0aheader', '/v1\\family', '/v1/family#fragment']) {
      await assert.rejects(api.request(invalidPath), (error) => error.code === 'REQUEST_PATH_INVALID')
    }
    assert.strictEqual(requestCalls, 0, 'invalid paths must be rejected before entering wx.request')
    await assert.rejects(api.request('/v1/me/family', { headers: { 'X-Test': 'ok\r\ninjected: yes' } }),
      (error) => error.code === 'REQUEST_HEADERS_INVALID')
    await assert.rejects(api.request('/v1/me/family', { contentType: 'application/json\r\ninjected: yes' }),
      (error) => error.code === 'REQUEST_HEADERS_INVALID')
    await assert.rejects(api.request('/v1/me/family', { method: 'GET\r\nINJECTED' }),
      (error) => error.code === 'REQUEST_METHOD_INVALID')

    let loopbackRequestUrl = ''
    runtime.accountEnvironment = () => 'develop'
    runtime.allowsDevelopmentLoopbackHttp = (value) => value === 'http://127.0.0.1:3000'
    runtime.apiBaseUrl = () => 'http://127.0.0.1:3000'
    wx.request = (options) => {
      loopbackRequestUrl = options.url
      options.success({ statusCode: 200, data: { ok: true } })
    }
    assert.deepStrictEqual(await api.request('/health'), { ok: true })
    assert.strictEqual(loopbackRequestUrl, 'http://127.0.0.1:3000/health')

    runtime.accountEnvironment = () => 'trial'
    await assert.rejects(api.request('/health'), (error) => error.code === 'API_BASE_URL_INVALID')
    runtime.accountEnvironment = () => 'develop'
    runtime.allowsDevelopmentLoopbackHttp = () => false
    await assert.rejects(api.request('/health'), (error) => error.code === 'API_BASE_URL_INVALID')

    for (const invalidBase of [
      'http://api.example.test',
      'http://1.12.77.180',
      'http://localhost:3000',
      'https://user@api.example.test',
      'https://api.example.test?target=other',
      'https://api.example.test/%2e%2e/admin',
      'https://api.example.test:99999'
    ]) {
      runtime.apiBaseUrl = () => invalidBase
      await assert.rejects(api.request('/v1/me/family'), (error) => error.code === 'API_BASE_URL_INVALID')
    }
  } finally {
    runtime.accountEnvironment = originals.accountEnvironment
    runtime.allowsDevelopmentLoopbackHttp = originals.allowsDevelopmentLoopbackHttp
    runtime.apiBaseUrl = originals.apiBaseUrl
    wx.request = originals.request
    wx.getStorageSync = originals.getStorageSync
    wx.setStorageSync = originals.setStorageSync
    wx.removeStorageSync = originals.removeStorageSync
    api.setAccessToken('')
  }
}

async function testPdfDownloadHardening() {
  const api = require('../services/api')
  const report = require('../services/report')
  const runtime = require('../config/runtime')
  const originals = {
    apiBaseUrl: runtime.apiBaseUrl,
    accountInfo: wx.getAccountInfoSync,
    downloadFile: wx.downloadFile
  }
  try {
    wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } })
    runtime.apiBaseUrl = () => 'https://mini-client.test.invalid'
    api.setAccessToken('pdf-old-session-token')
    let delayedDownload
    wx.downloadFile = (options) => { delayedDownload = options }
    const delayed = report.getPdf('rpt/old').catch((error) => error)
    api.setAccessToken('pdf-new-session-token')
    delayedDownload.success({ statusCode: 401 })
    assert.strictEqual((await delayed).code, 'PDF_DOWNLOAD_UNAUTHORIZED')
    assert.strictEqual(api.accessToken(), 'pdf-new-session-token',
      'a late PDF 401 must not clear a newer authenticated session')

    wx.downloadFile = (options) => options.success({ statusCode: 401 })
    await assert.rejects(report.getPdf('rpt_current'),
      (error) => error.code === 'PDF_DOWNLOAD_UNAUTHORIZED' && error.statusCode === 401)
    assert.strictEqual(api.accessToken(), '', 'the current token must be cleared after an authenticated PDF 401')

    api.setAccessToken('pdf-active-session-token')
    let downloadUrl = ''
    wx.downloadFile = (options) => {
      downloadUrl = options.url
      options.success({ statusCode: 200, tempFilePath: 'wxfile://tmp/report.pdf' })
      options.success({ statusCode: 401 })
      options.fail({ errMsg: 'late duplicate callback' })
    }
    assert.strictEqual(await report.getPdf('rpt /1'), 'wxfile://tmp/report.pdf')
    assert(downloadUrl.endsWith('/v1/reports/rpt%20%2F1/pdf'))
    assert.strictEqual(api.accessToken(), 'pdf-active-session-token',
      'a duplicate callback after a successful PDF download must be ignored')

    wx.downloadFile = (options) => options.success(null)
    await assert.rejects(report.getPdf('rpt_invalid_response'), (error) => error.code === 'PDF_DOWNLOAD_FAILED')
    wx.downloadFile = () => { throw new Error('downloadFile failed synchronously') }
    await assert.rejects(report.getPdf('rpt_sync_failure'), (error) => error.code === 'PDF_DOWNLOAD_FAILED')
    await assert.rejects(report.getPdf('  '), (error) => error.code === 'REPORT_ID_REQUIRED')
  } finally {
    runtime.apiBaseUrl = originals.apiBaseUrl
    wx.getAccountInfoSync = originals.accountInfo
    if (originals.downloadFile === undefined) delete wx.downloadFile
    else wx.downloadFile = originals.downloadFile
    api.setAccessToken('')
  }
}

async function testPaymentCacheStorageFailure() {
  const api = require('../services/api')
  const auth = require('../services/auth')
  const payment = require('../services/payment')
  const originalRequest = api.request
  const originals = {
    accountInfo: wx.getAccountInfoSync,
    getStorageSync: wx.getStorageSync,
    setStorageSync: wx.setStorageSync,
    removeStorageSync: wx.removeStorageSync,
    getApp: global.getApp,
    Page: global.Page
  }
  let definition
  let currentUser = { id: 'usr_storage_failure', role: 'family_user' }
  try {
    wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } })
    wx.getStorageSync = () => { throw new Error('storage read failed') }
    wx.setStorageSync = () => { throw new Error('storage write failed') }
    wx.removeStorageSync = () => { throw new Error('storage remove failed') }
    global.getApp = () => ({
      getCurrentUser: () => currentUser,
      setCurrentUser: (value) => { currentUser = value }
    })
    api.request = async (path) => {
      assert.strictEqual(path, '/v1/orders/ord_storage_failure')
      return {
        order: {
          id: 'ord_storage_failure', assessment_id: 'asm_storage_failure', report_id: 'rpt_storage_failure',
          product_code: 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1', amount_fen: 3990, currency: 'CNY', status: 'PAID'
        }
      }
    }
    const order = await payment.getOrder('ord_storage_failure')
    assert.strictEqual(order.status, 'PAID')
    assert(payment.listCachedOrders().some((item) => item.orderId === 'ord_storage_failure'),
      'the in-memory order cache must remain usable when wx storage is unavailable')

    global.Page = (value) => { definition = value }
    delete require.cache[require.resolve('../pages/payment-result/index')]
    require('../pages/payment-result/index')
    const instance = {
      ...definition,
      data: { ...definition.data, orderId: 'ord_storage_failure', reportId: '', checking: false }
    }
    instance.setData = function setData(update) { this.data = { ...this.data, ...update } }
    await definition.check.call(instance, false)
    assert.strictEqual(instance.data.error, '')
    assert.strictEqual(instance.data.order.status, 'PAID',
      'payment status rendering must not fail merely because cache persistence failed')
    api.request = async (path) => {
      assert.strictEqual(path, '/v1/auth/session')
      return undefined
    }
    api.setAccessToken('logout-session-token')
    await auth.logout()
    assert.strictEqual(currentUser, null)
    assert.strictEqual(api.accessToken(), '')
    assert.deepStrictEqual(payment.listCachedOrders(), [],
      'logout must clear the volatile order fallback even when every storage operation throws')
  } finally {
    api.request = originalRequest
    wx.getAccountInfoSync = originals.accountInfo
    wx.getStorageSync = originals.getStorageSync
    wx.setStorageSync = originals.setStorageSync
    wx.removeStorageSync = originals.removeStorageSync
    if (originals.getApp === undefined) delete global.getApp
    else global.getApp = originals.getApp
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
    if (path === '/v1/education-compass/free-parent-assessments') return { assessment: { id: 'asm_free', assessment_kind: 'FREE_PARENT_COMPASS', revision: 1, status: 'DRAFT' } }
    if (path === '/v1/students/stu_1/education-assessments') return { assessment: { id: 'asm_growth', assessment_kind: 'STUDENT_GROWTH_DISCOVERY', source_assessment_id: 'asm_free', revision: 1, status: 'DRAFT' } }
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
    await assert.rejects(client.saveDraft('asm_growth', { answers: {}, revision: 0, clientSaveToken: saveToken }),
      (error) => error.code === 'DRAFT_REVISION_REQUIRED')
    const saved = await client.saveDraft('asm_growth', { answers: { EGD03: 'GAOKAO' }, revision: 1, clientSaveToken: saveToken })
    assert.strictEqual(saved.revision, 2)
    assert.strictEqual(saved.clientSaveToken, saveToken)
    await assert.rejects(client.saveDraft('asm_growth', { answers: {}, revision: 2 }), (error) => error.code === 'CLIENT_SAVE_TOKEN_REQUIRED')
    const submitKey = client.createIdempotencyKey('submit')
    await assert.rejects(client.submitAssessment('asm_growth', { revision: 0 }, submitKey),
      (error) => error.code === 'DRAFT_REVISION_REQUIRED')
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
  testStudentProfileNormalization()
  await testStudentEditRejectsInvalidAgeBeforeRequest()
  testReportRegistry()
  testNavigation()
  testHomeActionCopy()
  await testCompassEntryPageGate()
  await testQuestionnaireStudentIsolation()
  await testFamilySnapshotAnalysisEntry()
  await testApiTransportHardening()
  await testPdfDownloadHardening()
  await testPaymentCacheStorageFailure()
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
