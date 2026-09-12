import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '../src/domain/errors'
import {
  CanonicalQuestionAnswer,
  EducationSystem,
  FREE_PARENT_QUESTIONNAIRE_VERSION,
  FrozenQuestion,
  GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION,
  LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION,
  LEGACY_GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION,
  ResultSignalStatus,
  StudentGrowthDiscoveryReportV1
} from '../src/domain/education-compass/contracts'
import {
  ALL_EDUCATION_SYSTEMS,
  FORMAL_EDUCATION_SYSTEMS,
  getEducationCompassQuestionnaireBank,
  getEducationCompassRegistryIntegrity,
  loadEducationCompassRegistry
} from '../src/domain/education-compass/registry'
import {
  switchEducationSystemAnswers,
  validateQuestionnaireAnswers
} from '../src/domain/education-compass/validator'
import {
  buildFamilyEducationSnapshotV1,
  buildStudentGrowthDiscoveryReportV1
} from '../src/domain/education-compass/result-builder'
import { buildLevel3ReservationV1 } from '../src/domain/education-compass/level3-reservation'
import {
  buildLevel3ReservationFromFrozenEvidence,
  buildNextSupportCapabilityV1
} from '../src/domain/education-compass/next-support'
import {
  ASKWISE_HANDOFF_CONTRACT_VERSION,
  ASKWISE_HANDOFF_RUNTIME_STATUS,
  askwiseHandoffNaturalKey,
  buildReservedAskwiseHandoffV1,
  validateAskwiseHandoffRequestV1
} from '../src/integrations/askwise/handoff-contract'

const CURRENT_YEAR = 2026
const IDENTITY = Object.freeze({
  familyId: 'family_contract_001',
  studentId: 'student_contract_001',
  assessmentId: 'assessment_contract_001'
})

const LEVEL_1_IDS = Object.freeze([
  'FP01', 'FP02', 'FP03', 'FP04', 'FP05', 'FP06', 'FP07', 'FP08'
])

const LEVEL_2_COMMON_IDS = Object.freeze([
  'EGD01', 'EGD02', 'EGD03', 'EGD04', 'EGD05', 'EGD06', 'EGD07', 'EGD08', 'EGD09',
  'EGD10', 'EGD11', 'EGD12', 'EGD13', 'EGD14', 'EGD15', 'EGD16', 'EGD17', 'EGD18', 'EGD19'
])

const SYSTEM_BANK_SNAPSHOTS: Readonly<Record<EducationSystem, {
  systemQuestionIds: readonly string[]
  digest: string
  marker: 'FULL_SYSTEM_BANK' | 'SYSTEM_BANK_PENDING'
}>> = Object.freeze({
  GAOKAO: {
    systemQuestionIds: Object.freeze(['GK01', 'GK02', 'GK03', 'GK04', 'GK05']),
    digest: '5e5511458d5e5e96b2a464144b096a96437c8f3b6f057cd3c210dc3b22ee8504',
    marker: 'FULL_SYSTEM_BANK'
  },
  DSE: {
    systemQuestionIds: Object.freeze(['DSE01', 'DSE02', 'DSE03', 'DSE04']),
    digest: 'a5a80b0a188e9ab781dbb30a4e418df6f8256049ad2e81748ae139e21fdc138b',
    marker: 'FULL_SYSTEM_BANK'
  },
  IGCSE: {
    systemQuestionIds: Object.freeze(['IG01', 'IG02', 'IG03']),
    digest: 'f90f667d51d61f3731fc37f145b0b91607aeea0b50e5fac8102bd861875712c5',
    marker: 'FULL_SYSTEM_BANK'
  },
  A_LEVEL: {
    systemQuestionIds: Object.freeze(['AL01', 'AL02', 'AL03', 'AL04']),
    digest: '19967a131ad3be69b303a319476c4d0fdf08b002471a5f611d5900033b0a34e1',
    marker: 'FULL_SYSTEM_BANK'
  },
  AP_US: {
    systemQuestionIds: Object.freeze(['AP01', 'AP02', 'AP03', 'AP04', 'AP05']),
    digest: '5d7af2bbf79d50011339562420241adb7a19738eaefd96967b47f741fcbd7d70',
    marker: 'FULL_SYSTEM_BANK'
  },
  IB: {
    systemQuestionIds: Object.freeze([]),
    digest: '5371c11018f0500138568ec3a1bcd5debf6df0c796be5092f9c0513f79ca5b69',
    marker: 'SYSTEM_BANK_PENDING'
  },
  OTHER: {
    systemQuestionIds: Object.freeze([]),
    digest: 'a8b248bd88534e6f4f1e5b8ac99d7a322a9c26c20525f930233e31e474e5e864',
    marker: 'SYSTEM_BANK_PENDING'
  }
})

const LEGACY_SYSTEM_BANK_SNAPSHOTS: Readonly<Record<EducationSystem, {
  systemQuestionIds: readonly string[]
  digest: string
  marker: 'FULL_SYSTEM_BANK' | 'SYSTEM_BANK_PENDING'
}>> = Object.freeze({
  GAOKAO: {
    systemQuestionIds: Object.freeze(['GK01', 'GK02', 'GK03', 'GK04', 'GK05']),
    digest: '19b059a06037c1b2ab07b6f1ed4423966b6c41e46e70a4391c395523a65de7dc',
    marker: 'FULL_SYSTEM_BANK'
  },
  DSE: {
    systemQuestionIds: Object.freeze(['DSE01', 'DSE02', 'DSE03', 'DSE04']),
    digest: 'cbb729bfd5233b5d3c90f31f0ee3e090f7c4b958f3a9f2e82892ac1ae3da8337',
    marker: 'FULL_SYSTEM_BANK'
  },
  IGCSE: {
    systemQuestionIds: Object.freeze(['IG01', 'IG02', 'IG03']),
    digest: 'edc77d890e355ed0df90ec2ffcf2d81df4d544690bdc34ed8bcebbf315db3b95',
    marker: 'FULL_SYSTEM_BANK'
  },
  A_LEVEL: {
    systemQuestionIds: Object.freeze(['AL01', 'AL02', 'AL03', 'AL04']),
    digest: '65f1c9372ad6adb2074e8aa32dfd3a57f7be581d91e51f4a4e69bcdc80851e24',
    marker: 'FULL_SYSTEM_BANK'
  },
  AP_US: {
    systemQuestionIds: Object.freeze(['AP01', 'AP02', 'AP03', 'AP04', 'AP05']),
    digest: '1ce6112090f32ded93987ee6c833037a705f01ba576f97a0716ba36b49154d28',
    marker: 'FULL_SYSTEM_BANK'
  },
  IB: {
    systemQuestionIds: Object.freeze([]),
    digest: '9606cbdbe1b7a475fc1f432c2e1bbbae83dc8eb9043169562d9985d47fd71f9c',
    marker: 'SYSTEM_BANK_PENDING'
  },
  OTHER: {
    systemQuestionIds: Object.freeze([]),
    digest: '3967e78005362cd1582ee00799ca85b48b731a0a9b424c2a49c28560c2d73b13',
    marker: 'SYSTEM_BANK_PENDING'
  }
})

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof AppError && error.code === code)
}

function canonicalAnswer(question: FrozenQuestion): CanonicalQuestionAnswer {
  switch (question.type) {
    case 'SINGLE_CHOICE':
    case 'PROVINCE_REGION_SELECT': {
      const allowedSubmitValue = question.validation.allowedSubmitValues?.[0]
      const option = question.options[0]?.code
      assert(allowedSubmitValue ?? option, `${question.id} must expose an allowed option`)
      return allowedSubmitValue ?? option as string
    }
    case 'MULTI_CHOICE':
    case 'MULTI_CHOICE_DYNAMIC': {
      const exclusive = new Set(question.validation.exclusiveOptions ?? [])
      const option = question.options.find(({ code }) => !exclusive.has(code))?.code ?? question.options[0]?.code
      assert(option, `${question.id} must expose an allowed option`)
      return Object.freeze([option])
    }
    case 'YEAR_SELECT':
      return String(CURRENT_YEAR)
    case 'SUBJECT_RANGE_MATRIX': {
      if (question.validation.allowEmpty) return Object.freeze([])
      const subject = question.matrixSubjectOptions?.[0]?.code
      const range = question.matrixRangeOptions?.[0]?.code
      assert(subject && range, `${question.id} must expose matrix options`)
      return Object.freeze([Object.freeze({ subject_code: subject, range_code: range })])
    }
  }
}

function validLevel2Answers(
  educationSystem: EducationSystem,
  overrides: Readonly<Record<string, CanonicalQuestionAnswer>> = {},
  questionnaireVersion?: string
): Record<string, CanonicalQuestionAnswer> {
  const bank = getEducationCompassQuestionnaireBank('LEVEL_2', educationSystem, questionnaireVersion)
  const answers: Record<string, CanonicalQuestionAnswer> = {}
  for (const questionId of bank.requiredQuestionIds) {
    const question = bank.questions.find(({ id }) => id === questionId)
    assert(question, `required question ${questionId} must exist`)
    answers[questionId] = canonicalAnswer(question)
  }
  answers.EGD03 = educationSystem
  return { ...answers, ...overrides }
}

function validLevel1Answers(readiness = 'WILLING'): Record<string, CanonicalQuestionAnswer> {
  return {
    FP01: 'UPPER_SECONDARY',
    FP02: 'GAOKAO',
    FP03: Object.freeze(['ACADEMIC_SUBJECTS']),
    FP04: Object.freeze(['LOGICAL_ANALYSIS']),
    FP05: Object.freeze(['METHOD_GAP']),
    FP06: readiness,
    FP07: Object.freeze(['LEARNING_CAPABILITY']),
    FP08: 'STUDENT_ASSESSMENT'
  }
}

function reportSignals(report: StudentGrowthDiscoveryReportV1) {
  return [
    ...report.strength_signals,
    ...report.learning_bottlenecks,
    ...report.subject_focus,
    ...report.growth_direction,
    ...report.learning_signals,
    ...report.interest_signals
  ]
}

function questionById(
  bank: { questions: readonly FrozenQuestion[] },
  questionId: string
): FrozenQuestion {
  const question = bank.questions.find(({ id }) => id === questionId)
  if (!question) throw new Error(`question ${questionId} must exist`)
  return question
}

function questionDataContract(question: FrozenQuestion) {
  return {
    id: question.id,
    key: question.key,
    type: question.type,
    required: question.required,
    scored: question.scored,
    optionCodes: question.options.map(({ code }) => code),
    matrixSubjectCodes: question.matrixSubjectOptions?.map(({ code }) => code) ?? [],
    matrixRangeCodes: question.matrixRangeOptions?.map(({ code }) => code) ?? [],
    validation: question.validation,
    dimensions: question.dimensions,
    signalCodes: question.signalCodes,
    systemApplicability: question.systemApplicability,
    exitRule: question.exitRule ?? null,
    privacyNote: question.privacyNote ?? null
  }
}

test('V1.0 base, V1.1 question-copy overlay, and taxonomy match their approved SHA-256 manifests', () => {
  const registry = loadEducationCompassRegistry()
  const integrity = getEducationCompassRegistryIntegrity()
  assert.equal(registry.candidateVersion, 'education_compass_question_banks_v1.1.0')
  assert.equal(registry.taxonomyVersion, 'education_compass_taxonomy_v1.0.0-rc1')
  assert.deepEqual({
    expected: integrity.questionBanks.expectedSha256,
    actual: integrity.questionBanks.actualSha256,
    verified: integrity.questionBanks.verified
  }, {
    expected: 'EFAE34EE595FC5E4A2FE8B6C5B89B1F182625BF15518620AC475320E4FD978F9',
    actual: 'EFAE34EE595FC5E4A2FE8B6C5B89B1F182625BF15518620AC475320E4FD978F9',
    verified: true
  })
  assert(integrity.questionUpdate, 'V1.1 overlay integrity must be exposed at runtime')
  assert.deepEqual({
    expected: integrity.questionUpdate.expectedSha256,
    actual: integrity.questionUpdate.actualSha256,
    verified: integrity.questionUpdate.verified
  }, {
    expected: '1E92841D2BACDD3ADC4086A68AD2749997ADBD07CC78FC810A02321765D17271',
    actual: '1E92841D2BACDD3ADC4086A68AD2749997ADBD07CC78FC810A02321765D17271',
    verified: true
  })
  assert.deepEqual({
    expected: integrity.taxonomy.expectedSha256,
    actual: integrity.taxonomy.actualSha256,
    verified: integrity.taxonomy.verified
  }, {
    expected: '53691402AA191489317E013CFC5BBE121339301EECFD43F7C6430415B11E2231',
    actual: '53691402AA191489317E013CFC5BBE121339301EECFD43F7C6430415B11E2231',
    verified: true
  })
})

test('V1.1 L1 and all seven L2 routes expose approved copy, IDs, digests, markers, presentation, and no scoring', () => {
  const level1 = getEducationCompassQuestionnaireBank('LEVEL_1', null)
  assert.equal(level1.questionnaireVersion, FREE_PARENT_QUESTIONNAIRE_VERSION)
  assert.deepEqual(level1.questions.map(({ id }) => id), LEVEL_1_IDS)
  assert.equal(level1.schemaDigest, '6c92bd8c8f47f57a0827a5a7c2d8dde745ebe571b366a3a73a0ef8b8950921b3')
  assert.equal(level1.scoringMode, 'NONE')
  assert.deepEqual(level1.presentation, {
    version: 'education_compass_presentation_v1',
    estimatedMinutesMin: 3,
    estimatedMinutesMax: 5,
    totalQuestions: 8,
    requiredQuestions: 8,
    progressMode: 'QUESTION_COUNT',
    scoringMode: 'NONE',
    experienceTitle: '免费家长教育罗盘',
    experienceEyebrow: 'FREE · 3—5 分钟',
    experienceSummary: '帮助家长看清孩子当前最值得关注的教育信号。',
    respondentHint: '由家长／监护人填写；答案用于形成家庭教育成长快照。',
    completionOutcome: '完成后可查看 Family Education Snapshot，并决定是否邀请学生本人参加下一步测评。',
    primaryActionHint: '先完成免费成长快照'
  })
  assert.equal(questionById(level1, 'FP03').label, '作为家长，你目前最希望先看清哪些教育问题？（最多 3 项）')
  assert.equal(questionById(level1, 'FP03').options.find(({ code }) => code === 'ACADEMIC_SUBJECTS')?.label, '成绩与学科学习')
  assert.equal(questionById(level1, 'FP08').label, '完成免费成长快照后，你希望下一步获得哪类支持？')
  assert.equal(questionById(level1, 'FP08').options.find(({ code }) => code === 'STUDENT_ASSESSMENT')?.label, '让学生本人完成成长发现测评')
  assert(level1.questions.every(({ scored }) => scored === false))

  const observedDigests = new Set<string>()
  for (const educationSystem of ALL_EDUCATION_SYSTEMS) {
    const bank = getEducationCompassQuestionnaireBank('LEVEL_2', educationSystem)
    const snapshot = SYSTEM_BANK_SNAPSHOTS[educationSystem]
    assert.equal(bank.questionnaireVersion, GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION)
    assert.deepEqual(bank.commonQuestionIds, LEVEL_2_COMMON_IDS)
    assert.deepEqual(bank.systemQuestionIds, snapshot.systemQuestionIds)
    assert.deepEqual(bank.questions.map(({ id }) => id), [...LEVEL_2_COMMON_IDS, ...snapshot.systemQuestionIds])
    assert.equal(bank.schemaDigest, snapshot.digest)
    assert.equal(bank.systemResultMarker, snapshot.marker)
    assert.equal(bank.scoringMode, 'NONE')
    assert.deepEqual(bank.presentation, {
      version: 'education_compass_presentation_v1',
      estimatedMinutesMin: 15,
      estimatedMinutesMax: 20,
      totalQuestions: bank.questions.length,
      requiredQuestions: bank.requiredQuestionIds.length,
      progressMode: 'QUESTION_COUNT',
      scoringMode: 'NONE',
      experienceTitle: '¥39.90 学生成长发现',
      experienceEyebrow: 'STUDENT · 15—20 分钟',
      experienceSummary: '从学习表现、学习过程、思维方式与兴趣方向发现当前成长关键点。',
      respondentHint: '仅限学生本人作答；家长可协助操作或解释，但不得代选答案。',
      completionOutcome: '先完成并提交测评；付款后解锁 Student Snapshot、Strength Signals、Learning Bottlenecks、Subject Focus、Growth Direction 与 30-Day Action Plan。',
      primaryActionHint: '先完成学生本人测评，再决定是否解锁完整报告'
    })
    assert(bank.questions.every(({ scored }) => scored === false))
    observedDigests.add(bank.schemaDigest)

    const validated = validateQuestionnaireAnswers({
      level: 'LEVEL_2',
      educationSystem,
      answers: validLevel2Answers(educationSystem),
      mode: 'SUBMIT',
      currentYear: CURRENT_YEAR
    })
    assert.equal(validated.canSubmit, true)
    assert.equal(validated.completenessCoverage, 100)
  }
  assert.deepEqual(FORMAL_EDUCATION_SYSTEMS, ['GAOKAO', 'DSE', 'IGCSE', 'A_LEVEL', 'AP_US'])
  assert.equal(observedDigests.size, ALL_EDUCATION_SYSTEMS.length)
})

test('V1.1 is copy-only: V1.0 banks remain pinned and both versions preserve IDs, codes, routing, privacy boundaries, and scoring', () => {
  const currentLevel1 = getEducationCompassQuestionnaireBank('LEVEL_1', null)
  const legacyLevel1 = getEducationCompassQuestionnaireBank(
    'LEVEL_1',
    null,
    LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION
  )
  assert.equal(legacyLevel1.questionnaireVersion, LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION)
  assert.equal(legacyLevel1.schemaDigest, 'a39a36dffdbfc9e8e3a33640000d03aacecd0ea56a2c05e997c886105852c9bb')
  assert.equal(questionById(legacyLevel1, 'FP03').label, '你目前最关注哪些问题？')
  assert.deepEqual(
    currentLevel1.questions.map(questionDataContract),
    legacyLevel1.questions.map(questionDataContract)
  )

  for (const educationSystem of ALL_EDUCATION_SYSTEMS) {
    const current = getEducationCompassQuestionnaireBank('LEVEL_2', educationSystem)
    const legacy = getEducationCompassQuestionnaireBank(
      'LEVEL_2',
      educationSystem,
      LEGACY_GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION
    )
    const snapshot = LEGACY_SYSTEM_BANK_SNAPSHOTS[educationSystem]
    assert.equal(legacy.questionnaireVersion, LEGACY_GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION)
    assert.equal(legacy.schemaDigest, snapshot.digest)
    assert.deepEqual(legacy.systemQuestionIds, snapshot.systemQuestionIds)
    assert.equal(legacy.systemResultMarker, snapshot.marker)
    assert.deepEqual(
      current.questions.map(questionDataContract),
      legacy.questions.map(questionDataContract)
    )
    const legacyValidation = validateQuestionnaireAnswers({
      level: 'LEVEL_2',
      educationSystem,
      questionnaireVersion: LEGACY_GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION,
      answers: validLevel2Answers(educationSystem, {}, LEGACY_GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION),
      mode: 'SUBMIT',
      currentYear: CURRENT_YEAR
    })
    assert.equal(legacyValidation.canSubmit, true)
  }

  const currentGrowth = getEducationCompassQuestionnaireBank('LEVEL_2', 'IB')
  assert.equal(questionById(currentGrowth, 'EGD01').label, '这份成长发现测评须由学生本人完成。请确认你正由学生本人阅读并选择答案。')
  assert.equal(questionById(currentGrowth, 'EGD07').options.find(({ code }) => code === 'MIXED')?.label,
    '整体处于中等，或不同学科／任务差异较大')
  assert.equal(questionById(currentGrowth, 'EGD19').required, false)
  assert.equal(currentGrowth.optionalQuestionIds.includes('EGD19'), true)
  assert.equal(currentGrowth.systemResultMarker, 'SYSTEM_BANK_PENDING')
  assert.equal(questionById(currentGrowth, 'EGD17').options.some(({ code }) => /BUDGET|INCOME|ASSET/.test(code)), false)
  assert.equal(questionById(currentGrowth, 'EGD17').label.includes('预算'), false)
})

test('validator rejects unknown IDs, wrong types, exclusive conflicts, and PII', () => {
  expectCode(() => validateQuestionnaireAnswers({
    level: 'LEVEL_1', educationSystem: null, answers: { ZZ99: 'UNKNOWN' }
  }), 'EDUCATION_COMPASS_UNKNOWN_QUESTION_ID')

  expectCode(() => validateQuestionnaireAnswers({
    level: 'LEVEL_1', educationSystem: null, answers: { FP01: ['PRIMARY'] }
  }), 'EDUCATION_COMPASS_ANSWER_TYPE_INVALID')

  expectCode(() => validateQuestionnaireAnswers({
    level: 'LEVEL_1', educationSystem: null, answers: { FP04: ['NOT_CLEAR', 'MEMORY'] }
  }), 'EDUCATION_COMPASS_EXCLUSIVE_OPTION_CONFLICT')

  expectCode(() => validateQuestionnaireAnswers({
    level: 'LEVEL_1', educationSystem: null, answers: { FP01: '13800000000' }
  }), 'EDUCATION_COMPASS_PII_FORBIDDEN')
})

test('validator enforces the current-year window and exact subject-range matrix schema', () => {
  expectCode(() => validateQuestionnaireAnswers({
    level: 'LEVEL_2', educationSystem: 'GAOKAO', answers: { EGD04: '2035' }, currentYear: CURRENT_YEAR
  }), 'EDUCATION_COMPASS_YEAR_OUT_OF_RANGE')

  const matrix = getEducationCompassQuestionnaireBank('LEVEL_2', 'GAOKAO').questions
    .find(({ type }) => type === 'SUBJECT_RANGE_MATRIX')
  assert(matrix)
  const subject = matrix.matrixSubjectOptions?.[0]?.code
  const range = matrix.matrixRangeOptions?.find(({ code }) => code !== 'UNSURE' && code !== 'NOT_PROVIDED')?.code
  assert(subject && range)
  const accepted = validateQuestionnaireAnswers({
    level: 'LEVEL_2',
    educationSystem: 'GAOKAO',
    answers: { [matrix.id]: [{ subject_code: subject, range_code: range }] }
  })
  assert.deepEqual(accepted.answers[matrix.id], [{ subject_code: subject, range_code: range }])

  expectCode(() => validateQuestionnaireAnswers({
    level: 'LEVEL_2',
    educationSystem: 'GAOKAO',
    answers: { [matrix.id]: [{ subject_code: subject, range_code: range, exact_score: 99 }] }
  }), 'EDUCATION_COMPASS_MATRIX_ROW_UNKNOWN_FIELD')
  expectCode(() => validateQuestionnaireAnswers({
    level: 'LEVEL_2',
    educationSystem: 'GAOKAO',
    answers: { [matrix.id]: [{ subject_code: subject, range_code: 'EXACT_99' }] }
  }), 'EDUCATION_COMPASS_MATRIX_RANGE_INVALID')
})

test('system switch preserves compatible common answers and removes old/incompatible branch data', () => {
  const source = {
    EGD02: 'UPPER_SECONDARY',
    EGD03: 'GAOKAO',
    EGD08: ['CHINESE', 'MATHEMATICS'],
    EGD09: ['CHINESE'],
    GK01: 'BEIJING'
  }
  const switched = switchEducationSystemAnswers(source, 'GAOKAO', 'DSE', CURRENT_YEAR)
  assert.equal(switched.previousEducationSystem, 'GAOKAO')
  assert.equal(switched.educationSystem, 'DSE')
  assert.equal(switched.answers.EGD02, 'UPPER_SECONDARY')
  assert.equal(switched.answers.EGD03, 'DSE')
  assert.deepEqual(switched.answers.EGD08, ['MATHEMATICS'])
  assert.equal(switched.answers.EGD09, undefined)
  assert.equal(switched.answers.GK01, undefined)
  assert.deepEqual(switched.removedQuestionIds, ['EGD08', 'EGD09', 'GK01'])
  assert.deepEqual(source, {
    EGD02: 'UPPER_SECONDARY', EGD03: 'GAOKAO', EGD08: ['CHINESE', 'MATHEMATICS'], EGD09: ['CHINESE'], GK01: 'BEIJING'
  })
})

test('L1 readiness produces the four frozen routes', () => {
  const routes = [
    ['WILLING', 'AVAILABLE', 'STUDENT_READY_FOR_SELF_ASSESSMENT'],
    ['MAYBE_NEEDS_EXPLANATION', 'CONSIDER', 'STUDENT_NEEDS_EXPLANATION'],
    ['NOT_WILLING', 'NOT_RECOMMENDED', 'STUDENT_DECLINED'],
    ['UNSURE', 'DEFERRED', 'STUDENT_READINESS_UNKNOWN']
  ] as const
  for (const [readiness, status, reason] of routes) {
    const snapshot = buildFamilyEducationSnapshotV1(IDENTITY, validLevel1Answers(readiness))
    assert.equal(snapshot.student_readiness, readiness)
    assert.equal(snapshot.next_step_status, status)
    assert.deepEqual(snapshot.next_step_reason_codes, [reason])
  }
})

test('L2 builds all six discovery outputs with traceable evidence and no score', () => {
  const report = buildStudentGrowthDiscoveryReportV1(
    IDENTITY,
    'IB',
    validLevel2Answers('IB', {
      EGD06: Object.freeze(['FOUNDATION']),
      EGD07: 'GOOD_BUT_UNSTABLE',
      EGD08: Object.freeze(['MATHEMATICS']),
      EGD09: Object.freeze(['MATHEMATICS']),
      EGD15: Object.freeze(['ENGINEERING_TECH']),
      EGD16: 'SUSTAINED_OUTPUT',
      EGD17: Object.freeze(['FOUNDATION_GAP']),
      EGD18: 'SUBJECT_DIAGNOSIS'
    }),
    { currentYear: CURRENT_YEAR }
  )

  assert.equal(report.student_snapshot.education_system, 'IB')
  assert(report.strength_signals.length > 0)
  assert(report.learning_bottlenecks.length > 0)
  assert(report.subject_focus.length > 0)
  assert(report.growth_direction.length > 0)
  assert.equal(report.action_plan_30d.horizon_days, 30)
  assert(report.action_plan_30d.goals.length >= 1 && report.action_plan_30d.goals.length <= 3)
  assert.equal(report.scoring_mode, 'NONE')
  assert.equal(report.system_result_marker, 'SYSTEM_BANK_PENDING')

  const bankIds = new Set(getEducationCompassQuestionnaireBank('LEVEL_2', 'IB').questions.map(({ id }) => id))
  for (const signal of reportSignals(report)) {
    assert(signal.evidence_refs.length > 0, `${signal.code} must retain evidence`)
    assert(signal.evidence_refs.every((questionId) => bankIds.has(questionId)), `${signal.code} evidence must be a frozen question ID`)
    assert(signal.evidence_refs.every((questionId) => report.evidence_refs.includes(questionId)))
  }
  for (const goal of report.action_plan_30d.goals) assert(goal.evidence_refs.length > 0)
})

test('L2 preserves UNKNOWN and excludes prohibited conclusion language outside the disclaimer', () => {
  const report = buildStudentGrowthDiscoveryReportV1(
    IDENTITY,
    'OTHER',
    validLevel2Answers('OTHER', {
      EGD06: Object.freeze(['UNSURE']),
      EGD09: Object.freeze(['MATHEMATICS']),
      EGD17: Object.freeze(['UNSURE']),
      EGD18: 'SUBJECT_DIAGNOSIS'
    }),
    { currentYear: CURRENT_YEAR }
  )
  const unknown = report.learning_signals.find(({ code }) => code === 'SELF_SELECTED_FOCUS_UNKNOWN')
  assert.equal(unknown?.status, 'UNKNOWN' satisfies ResultSignalStatus)
  assert.deepEqual(unknown?.evidence_refs, ['EGD06'])

  const { disclaimer, ...machineResult } = report
  const machineText = JSON.stringify(machineResult)
  for (const prohibited of ['诊断', '排名', '录取', '提分', '保证', '概率', '院校匹配', 'EMERGING', 'DEVELOPING', 'ESTABLISHED']) {
    assert.equal(machineText.includes(prohibited), false, `machine result must not contain prohibited conclusion: ${prohibited}`)
  }
  for (const legacyField of ['score', 'total_score', 'ranking', 'ability_band', 'admission_probability', 'university_match']) {
    assert.equal(Object.prototype.hasOwnProperty.call(machineResult, legacyField), false)
  }
  assert.match(disclaimer, /不是心理、医疗或学业能力诊断/)
  assert.match(disclaimer, /不构成提分、升学或录取承诺/)
})

test('Askwise handoff remains a validated RESERVED DTO with networking disabled', () => {
  const report = buildStudentGrowthDiscoveryReportV1(
    IDENTITY,
    'IB',
    validLevel2Answers('IB', {
      EGD06: Object.freeze(['FOUNDATION']),
      EGD09: Object.freeze(['MATHEMATICS']),
      EGD17: Object.freeze(['FOUNDATION_GAP']),
      EGD18: 'SUBJECT_DIAGNOSIS'
    }),
    { currentYear: CURRENT_YEAR }
  )
  const handoffIdentity = {
    ...IDENTITY,
    reportId: 'report_contract_001',
    consentBundleId: 'consent_contract_001',
    sourceEntry: 'INTERNAL_UAT' as const,
    idempotencyKey: 'education-contract-idempotency-001'
  }
  const handoff = buildReservedAskwiseHandoffV1(report, handoffIdentity)
  assert.equal(handoff.status, ASKWISE_HANDOFF_RUNTIME_STATUS)
  assert.equal(handoff.status, 'RESERVED')
  assert.equal(handoff.network_enabled, false)
  assert.equal(handoff.contract_version, ASKWISE_HANDOFF_CONTRACT_VERSION)
  assert.deepEqual(validateAskwiseHandoffRequestV1(handoff.request), handoff.request)
  assert.equal(handoff.request.system_result_marker, 'SYSTEM_BANK_PENDING')
  assert(handoff.request.learning_bottleneck.length > 0 || handoff.request.subject_focus.some(({ status }) => status === 'SUPPORTED'))
  assert(handoff.request.recommended_focus.length > 0)
  assert.deepEqual(Object.keys(handoff).sort(), ['contract_version', 'network_enabled', 'request', 'status'])
  assert.equal('education_pathway_context' in handoff.request, false)
  assert.equal('answers' in handoff.request, false)
  assert.equal('student_name' in handoff.request, false)
  assert.equal(askwiseHandoffNaturalKey(handoffIdentity),
    'student_contract_001|assessment_contract_001|student_growth_discovery_report_v1.0.0|education_support_handoff_v1.0.0-rc1|ASKWISE_LEARNING_SUPPORT')
})

test('Level 3 remains an entry-only reservation with no questionnaire, payment, or pressure trigger', () => {
  const available = buildLevel3ReservationV1({
    sourceAssessmentId: IDENTITY.assessmentId,
    sourceReportId: 'report_contract_001',
    triggerCodes: ['USER_REQUESTED_DEEP_ASSESSMENT', 'FAMILY_STUDENT_GOAL_MISALIGNMENT']
  })
  assert.equal(available.state, 'AVAILABLE')
  assert.equal(available.advisor_intent, 'DEEP_ASSESSMENT')
  assert.equal(available.entry_only, true)
  assert.equal(available.payment_enabled, false)
  assert.deepEqual(available.question_ids, [])
  assert.equal('price' in available, false)
  assert.equal('order' in available, false)

  const pressureOnly = buildLevel3ReservationV1({
    sourceAssessmentId: IDENTITY.assessmentId,
    sourceReportId: 'report_contract_001',
    onlyStressOrEmotionalSignal: true
  })
  assert.equal(pressureOnly.state, 'DEFERRED')
  assert.equal(pressureOnly.advisor_intent, null)
  assert.deepEqual(pressureOnly.reason_codes, ['ONLY_STRESS_OR_EMOTIONAL_SIGNAL'])

  const declined = buildLevel3ReservationV1({
    sourceAssessmentId: IDENTITY.assessmentId,
    sourceReportId: 'report_contract_001',
    triggerCodes: ['COMPLEX_MULTI_FACTOR_NEEDS_REVIEW'],
    studentDeclined: true
  })
  assert.equal(declined.state, 'NOT_RECOMMENDED')
  assert.equal(declined.advisor_intent, null)
  assert.deepEqual(declined.reason_codes, ['STUDENT_DECLINED'])
})

test('next-support projection uses only the two frozen positive mappings and keeps Askwise reserved', () => {
  const sourceAssessmentId = IDENTITY.assessmentId
  const sourceReportId = 'report_contract_001'
  const unavailable = buildNextSupportCapabilityV1({
    sourceAssessmentId,
    sourceReportId,
    sourceLevel1Answers: { FP08: 'STUDENT_ASSESSMENT' },
    growthAnswers: { EGD18: 'SUBJECT_DIAGNOSIS', EGD19: ['OVERSEAS_BACHELOR_FULL_TIME'] },
    reportAccess: 'full'
  })
  assert.deepEqual(unavailable.askwise, {
    status: 'RESERVED', enabled: false, reasonCode: 'ASKWISE_CAPABILITY_UNAVAILABLE', requiresExplicitConsent: true
  })
  assert.equal(unavailable.deepAssessment.state, 'DEFERRED')
  assert.deepEqual(unavailable.deepAssessment.reasonCodes, ['NO_LEVEL_3_TRIGGER'])
  assert.equal(unavailable.deepAssessment.displayPrice, null)
  assert.equal(unavailable.advisor.available, false)

  const available = buildLevel3ReservationFromFrozenEvidence({
    sourceAssessmentId,
    sourceReportId,
    sourceLevel1Answers: { FP08: 'DEEP_ASSESSMENT_INFO' },
    growthAnswers: {},
    reportAccess: 'full'
  })
  assert.equal(available.state, 'AVAILABLE')
  assert.deepEqual(available.reason_codes, ['USER_REQUESTED_DEEP_ASSESSMENT'])

  const consider = buildNextSupportCapabilityV1({
    sourceAssessmentId,
    sourceReportId,
    sourceLevel1Answers: { FP08: 'STUDENT_ASSESSMENT' },
    growthAnswers: {
      EGD18: 'PATH_CONSULTATION',
      EGD19: ['OVERSEAS_BACHELOR_FULL_TIME', 'HONG_KONG_ASSOCIATE_DEGREE']
    },
    reportAccess: 'full'
  })
  assert.equal(consider.deepAssessment.state, 'CONSIDER')
  assert.deepEqual(consider.deepAssessment.reasonCodes, ['MULTI_PATHWAY_COMPARISON_REQUESTED'])
  assert.equal(consider.deepAssessment.advisorIntent, 'DEEP_ASSESSMENT')
  assert.equal(consider.advisor.available, true)

  const preview = buildNextSupportCapabilityV1({
    sourceAssessmentId,
    sourceReportId,
    sourceLevel1Answers: { FP08: 'DEEP_ASSESSMENT_INFO' },
    growthAnswers: {
      EGD18: 'PATH_CONSULTATION',
      EGD19: ['OVERSEAS_BACHELOR_FULL_TIME', 'HONG_KONG_ASSOCIATE_DEGREE']
    },
    reportAccess: 'preview'
  })
  assert.equal(preview.deepAssessment.state, 'DEFERRED')
  assert.equal(preview.advisor.available, false)
})
