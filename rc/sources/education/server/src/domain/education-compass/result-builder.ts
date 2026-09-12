import { invariant } from '../errors'
import {
  CanonicalAnswerMap,
  EDUCATION_COMPASS_DISCLAIMER,
  EDUCATION_COMPASS_DISCLAIMER_VERSION,
  EDUCATION_COMPASS_TAXONOMY_VERSION,
  EducationSystem,
  EvidenceSignal,
  FAMILY_SNAPSHOT_VERSION,
  FamilyEducationSnapshotV1,
  GROWTH_DISCOVERY_REPORT_VERSION,
  ResultBuildIdentity,
  ResultSignalStatus,
  StudentGrowthDiscoveryReportV1,
  SubjectRangeAnswerRow,
  FREE_PARENT_QUESTIONNAIRE_VERSION
} from './contracts'
import { getEducationCompassQuestionnaireBank } from './registry'
import { validateQuestionnaireAnswers } from './validator'

function requiredString(answers: CanonicalAnswerMap, questionId: string): string {
  const value = answers[questionId]
  invariant(typeof value === 'string', 500, 'EDUCATION_COMPASS_RESULT_INPUT_INVALID', '结果生成缺少已校验单选答案', { questionId })
  return value
}

function stringList(answers: CanonicalAnswerMap, questionId: string): readonly string[] {
  const value = answers[questionId]
  invariant(Array.isArray(value) && value.every((item) => typeof item === 'string'), 500,
    'EDUCATION_COMPASS_RESULT_INPUT_INVALID', '结果生成缺少已校验多选答案', { questionId })
  return value as readonly string[]
}

function optionalStringList(answers: CanonicalAnswerMap, questionId: string): readonly string[] {
  const value = answers[questionId]
  if (value === undefined) return Object.freeze([])
  invariant(Array.isArray(value) && value.every((item) => typeof item === 'string'), 500,
    'EDUCATION_COMPASS_RESULT_INPUT_INVALID', '结果生成的选答多选答案无效', { questionId })
  return value as readonly string[]
}

function matrixRows(answers: CanonicalAnswerMap, questionId: string): readonly SubjectRangeAnswerRow[] {
  const value = answers[questionId]
  if (value === undefined) return Object.freeze([])
  invariant(Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object' &&
    typeof (item as SubjectRangeAnswerRow).subject_code === 'string' &&
    typeof (item as SubjectRangeAnswerRow).range_code === 'string'), 500,
  'EDUCATION_COMPASS_RESULT_INPUT_INVALID', '结果生成的学科区间答案无效', { questionId })
  return value as readonly SubjectRangeAnswerRow[]
}

function evidenceSignal(
  code: string,
  dimension: EvidenceSignal['dimension'],
  status: ResultSignalStatus,
  evidenceRefs: readonly string[],
  source: EvidenceSignal['source'] = 'STUDENT_SELF_REPORT'
): EvidenceSignal {
  invariant(evidenceRefs.length > 0 && new Set(evidenceRefs).size === evidenceRefs.length, 500,
    'EDUCATION_COMPASS_EVIDENCE_INVALID', '结果信号必须使用不重复的冻结题号证据')
  return Object.freeze({ code, dimension, status, evidence_refs: Object.freeze([...evidenceRefs]), source })
}

function has(answers: CanonicalAnswerMap, questionId: string, code: string): boolean {
  const answer = answers[questionId]
  return answer === code || (Array.isArray(answer) && answer.includes(code as never))
}

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function statusRank(status: ResultSignalStatus): number {
  return status === 'SUPPORTED' ? 3 : status === 'NEEDS_VALIDATION' ? 2 : 1
}

function mergeSignals(signals: readonly EvidenceSignal[]): EvidenceSignal[] {
  const byCode = new Map<string, EvidenceSignal>()
  for (const signal of signals) {
    const prior = byCode.get(signal.code)
    if (!prior) {
      byCode.set(signal.code, signal)
      continue
    }
    const selected = statusRank(signal.status) > statusRank(prior.status) ? signal : prior
    byCode.set(signal.code, evidenceSignal(
      selected.code,
      selected.dimension,
      selected.status,
      distinct([...prior.evidence_refs, ...signal.evidence_refs]),
      selected.source
    ))
  }
  return [...byCode.values()]
}

export function buildFamilyEducationSnapshotV1(
  identity: ResultBuildIdentity,
  answersInput: unknown,
  options: { questionnaireVersion?: string } = {}
): FamilyEducationSnapshotV1 {
  const validated = validateQuestionnaireAnswers({
    level: 'LEVEL_1',
    educationSystem: null,
    ...(options.questionnaireVersion !== undefined ? { questionnaireVersion: options.questionnaireVersion } : {}),
    answers: answersInput,
    mode: 'SUBMIT'
  })
  const answers = validated.answers
  const readiness = requiredString(answers, 'FP06')
  const route: Record<string, Pick<FamilyEducationSnapshotV1, 'next_step_status' | 'next_step_reason_codes'>> = {
    WILLING: { next_step_status: 'AVAILABLE', next_step_reason_codes: Object.freeze(['STUDENT_READY_FOR_SELF_ASSESSMENT']) },
    MAYBE_NEEDS_EXPLANATION: { next_step_status: 'CONSIDER', next_step_reason_codes: Object.freeze(['STUDENT_NEEDS_EXPLANATION']) },
    NOT_WILLING: { next_step_status: 'NOT_RECOMMENDED', next_step_reason_codes: Object.freeze(['STUDENT_DECLINED']) },
    UNSURE: { next_step_status: 'DEFERRED', next_step_reason_codes: Object.freeze(['STUDENT_READINESS_UNKNOWN']) }
  }
  const nextStep = route[readiness]
  invariant(nextStep, 500, 'EDUCATION_COMPASS_RESULT_ROUTE_INVALID', '学生本人测评意愿路由无效')
  return Object.freeze({
    result_kind: 'FAMILY_EDUCATION_SNAPSHOT',
    result_version: FAMILY_SNAPSHOT_VERSION,
    family_id: identity.familyId,
    student_id: identity.studentId,
    assessment_id: identity.assessmentId,
    education_system: requiredString(answers, 'FP02') as EducationSystem,
    grade_stage: requiredString(answers, 'FP01'),
    family_concerns: Object.freeze([...stringList(answers, 'FP03')]),
    observed_strength_signals: Object.freeze([...stringList(answers, 'FP04')]),
    observed_difficulty_signals: Object.freeze([...stringList(answers, 'FP05')]),
    student_readiness: readiness,
    family_priorities: Object.freeze([...stringList(answers, 'FP07')]),
    preferred_next_support: requiredString(answers, 'FP08'),
    next_step_status: nextStep.next_step_status,
    next_step_reason_codes: nextStep.next_step_reason_codes,
    questionnaire_version: (options.questionnaireVersion ?? FREE_PARENT_QUESTIONNAIRE_VERSION) as FamilyEducationSnapshotV1['questionnaire_version'],
    disclaimer_version: EDUCATION_COMPASS_DISCLAIMER_VERSION,
    disclaimer: EDUCATION_COMPASS_DISCLAIMER
  })
}

function achievementEvidenceBySubject(
  answers: CanonicalAnswerMap,
  systemQuestionIds: readonly string[]
): Map<string, string> {
  const result = new Map<string, string>()
  for (const questionId of systemQuestionIds) {
    const raw = answers[questionId]
    if (!Array.isArray(raw) || !raw.every((item) => item !== null && typeof item === 'object' &&
      typeof (item as SubjectRangeAnswerRow).subject_code === 'string' &&
      typeof (item as SubjectRangeAnswerRow).range_code === 'string')) continue
    for (const row of matrixRows(answers, questionId)) {
      if (row.range_code !== 'UNSURE' && row.range_code !== 'NOT_PROVIDED') result.set(row.subject_code, questionId)
    }
  }
  return result
}

function buildStrengthSignals(
  answers: CanonicalAnswerMap,
  achievementEvidence: ReadonlyMap<string, string>
): EvidenceSignal[] {
  const signals: EvidenceSignal[] = []
  const performanceSupport = ['CONSISTENT_STRONG', 'GOOD_BUT_UNSTABLE'].includes(requiredString(answers, 'EGD07'))
  for (const subject of stringList(answers, 'EGD08')) {
    if (subject === 'UNSURE') continue
    const rangeRef = achievementEvidence.get(subject)
    if (rangeRef) {
      signals.push(evidenceSignal(`SUBJECT_STRENGTH_${subject}`, 'ACADEMIC_PERFORMANCE', 'SUPPORTED', ['EGD08', rangeRef], 'OPTIONAL_RANGE_CONTEXT'))
    } else if (performanceSupport) {
      signals.push(evidenceSignal(`SUBJECT_STRENGTH_${subject}`, 'ACADEMIC_PERFORMANCE', 'SUPPORTED', ['EGD07', 'EGD08']))
    }
  }
  if (has(answers, 'EGD16', 'SUSTAINED_OUTPUT') && !has(answers, 'EGD15', 'UNSURE')) {
    signals.push(evidenceSignal('SUSTAINED_ENGAGEMENT', 'INTEREST_DIRECTION', 'SUPPORTED', ['EGD15', 'EGD16']))
  }
  if (has(answers, 'EGD12', 'PLAN_AND_REVIEW') && has(answers, 'EGD18', 'LEARNING_METHOD_PRACTICE')) {
    signals.push(evidenceSignal('PLANNING_AND_REVIEW', 'LEARNING_PROCESS', 'SUPPORTED', ['EGD12', 'EGD18']))
  }
  if (has(answers, 'EGD13', 'ATTRIBUTE_AND_RETRY') && has(answers, 'EGD18', 'LEARNING_METHOD_PRACTICE')) {
    signals.push(evidenceSignal('ERROR_REVIEW_PATTERN', 'LEARNING_PROCESS', 'SUPPORTED', ['EGD13', 'EGD18']))
  }
  return signals
}

function buildBottlenecks(answers: CanonicalAnswerMap): EvidenceSignal[] {
  const signals: EvidenceSignal[] = []
  const add = (
    code: string,
    dimension: EvidenceSignal['dimension'],
    firstQuestion: string,
    firstCode: string,
    secondQuestion: string,
    secondCodes: readonly string[]
  ): void => {
    if (has(answers, firstQuestion, firstCode) && secondCodes.some((value) => has(answers, secondQuestion, value))) {
      signals.push(evidenceSignal(code, dimension, 'SUPPORTED', [firstQuestion, secondQuestion]))
    }
  }
  add('FOUNDATION_GAP', 'ACADEMIC_PERFORMANCE', 'EGD06', 'FOUNDATION', 'EGD17', ['FOUNDATION_GAP'])
  add('KNOWLEDGE_TRANSFER_GAP', 'LEARNING_PROCESS', 'EGD06', 'KNOWLEDGE_TRANSFER', 'EGD11', ['OFTEN', 'ALMOST_ALWAYS'])
  add('FIRST_STEP_GAP', 'THINKING_LEARNING_STYLE', 'EGD06', 'PROBLEM_SOLVING', 'EGD10', ['TRY_THEN_STUCK', 'NO_FIRST_STEP'])
  add('ERROR_REVIEW_GAP', 'LEARNING_PROCESS', 'EGD06', 'ERROR_REVIEW', 'EGD13', ['READ_ANSWER_LITTLE_REVIEW', 'CORRECT_RESULT_ONLY', 'USUALLY_SKIP'])
  add('PLANNING_GAP', 'LEARNING_PROCESS', 'EGD06', 'PLANNING', 'EGD12', ['PLAN_CHANGES_OFTEN', 'FOLLOW_TEACHER', 'LAST_MINUTE'])
  add('DIRECTION_CLARITY_GAP', 'INTEREST_DIRECTION', 'EGD06', 'INTEREST_EXPLORATION', 'EGD17', ['DIRECTION_UNCLEAR'])
  add('FAMILY_GOAL_ALIGNMENT_GAP', 'LEARNING_PROCESS', 'EGD06', 'FAMILY_GOAL_ALIGNMENT', 'EGD17', ['FAMILY_GOAL_DIFFERENCE'])
  return signals
}

function buildSubjectFocus(
  answers: CanonicalAnswerMap,
  achievementEvidence: ReadonlyMap<string, string>
): EvidenceSignal[] {
  const actionSupports = has(answers, 'EGD18', 'SUBJECT_DIAGNOSIS')
  return stringList(answers, 'EGD09')
    .filter((subject) => subject !== 'UNSURE')
    .slice(0, 3)
    .map((subject) => {
      const rangeRef = achievementEvidence.get(subject)
      if (rangeRef) return evidenceSignal(subject, 'ACADEMIC_PERFORMANCE', 'SUPPORTED', ['EGD09', rangeRef], 'OPTIONAL_RANGE_CONTEXT')
      if (actionSupports) return evidenceSignal(subject, 'ACADEMIC_PERFORMANCE', 'SUPPORTED', ['EGD09', 'EGD18'])
      return evidenceSignal(subject, 'ACADEMIC_PERFORMANCE', 'NEEDS_VALIDATION', ['EGD09'])
    })
}

function buildInterestSignals(answers: CanonicalAnswerMap): EvidenceSignal[] {
  const sustained = has(answers, 'EGD16', 'SUSTAINED_OUTPUT')
  return stringList(answers, 'EGD15')
    .filter((direction) => direction !== 'UNSURE')
    .slice(0, 2)
    .map((direction) => evidenceSignal(
      direction,
      'INTEREST_DIRECTION',
      sustained ? 'SUPPORTED' : 'NEEDS_VALIDATION',
      sustained ? ['EGD15', 'EGD16'] : ['EGD15']
    ))
}

function buildLearningSignals(answers: CanonicalAnswerMap, bottlenecks: readonly EvidenceSignal[]): EvidenceSignal[] {
  const signals: EvidenceSignal[] = [...bottlenecks]
  const single = (
    code: string,
    dimension: EvidenceSignal['dimension'],
    questionId: string,
    statuses: readonly string[],
    status: ResultSignalStatus = 'NEEDS_VALIDATION'
  ): void => {
    if (statuses.some((value) => has(answers, questionId, value))) signals.push(evidenceSignal(code, dimension, status, [questionId]))
  }
  single('PROBLEM_DECOMPOSITION', 'THINKING_LEARNING_STYLE', 'EGD10', ['DECOMPOSE_CONDITIONS'])
  single('FIRST_STEP_GAP', 'THINKING_LEARNING_STYLE', 'EGD10', ['TRY_THEN_STUCK', 'NO_FIRST_STEP'])
  single('KNOWLEDGE_RETRIEVAL_STABLE', 'LEARNING_PROCESS', 'EGD11', ['RARELY'])
  single('KNOWLEDGE_RETRIEVAL_GAP', 'LEARNING_PROCESS', 'EGD11', ['OFTEN', 'ALMOST_ALWAYS'])
  single('PLANNING_AND_REVIEW', 'LEARNING_PROCESS', 'EGD12', ['PLAN_AND_REVIEW'])
  single('PLANNING_GAP', 'LEARNING_PROCESS', 'EGD12', ['PLAN_CHANGES_OFTEN', 'FOLLOW_TEACHER', 'LAST_MINUTE'])
  single('ERROR_REVIEW_PATTERN', 'LEARNING_PROCESS', 'EGD13', ['ATTRIBUTE_AND_RETRY'])
  single('ERROR_REVIEW_GAP', 'LEARNING_PROCESS', 'EGD13', ['READ_ANSWER_LITTLE_REVIEW', 'CORRECT_RESULT_ONLY', 'USUALLY_SKIP'])
  if (has(answers, 'EGD17', 'STRESS_AFFECTS_LEARNING')) {
    signals.push(evidenceSignal('SUPPORT_CHECK_IN', 'LEARNING_PROCESS', 'NEEDS_VALIDATION', ['EGD17']))
  }
  if (has(answers, 'EGD06', 'UNSURE')) {
    signals.push(evidenceSignal('SELF_SELECTED_FOCUS_UNKNOWN', 'LEARNING_PROCESS', 'UNKNOWN', ['EGD06']))
  }
  return mergeSignals(signals)
}

export function buildStudentGrowthDiscoveryReportV1(
  identity: ResultBuildIdentity,
  educationSystem: EducationSystem,
  answersInput: unknown,
  options: { currentYear?: number; questionnaireVersion?: string } = {}
): StudentGrowthDiscoveryReportV1 {
  const validated = validateQuestionnaireAnswers({
    level: 'LEVEL_2',
    educationSystem,
    ...(options.questionnaireVersion !== undefined ? { questionnaireVersion: options.questionnaireVersion } : {}),
    answers: answersInput,
    mode: 'SUBMIT',
    ...(options.currentYear !== undefined ? { currentYear: options.currentYear } : {})
  })
  const answers = validated.answers
  const bank = getEducationCompassQuestionnaireBank('LEVEL_2', educationSystem, options.questionnaireVersion)
  const achievementEvidence = achievementEvidenceBySubject(answers, bank.systemQuestionIds)
  const strengthSignals = buildStrengthSignals(answers, achievementEvidence)
  const bottlenecks = buildBottlenecks(answers)
  const subjectFocus = buildSubjectFocus(answers, achievementEvidence)
  const interestSignals = buildInterestSignals(answers)
  const learningSignals = buildLearningSignals(answers, bottlenecks)
  const selectedAction = requiredString(answers, 'EGD18')
  const recommendedFocus = distinct([
    ...bottlenecks.filter((signal) => signal.status === 'SUPPORTED').map((signal) => signal.code),
    ...subjectFocus.filter((signal) => signal.status === 'SUPPORTED').map((signal) => `SUBJECT_${signal.code}`)
  ]).slice(0, 5)
  const actionGoals = distinct([
    `ACTION_${selectedAction}`,
    ...recommendedFocus.slice(0, 2)
  ]).slice(0, 3).map((code, index) => Object.freeze({
    code,
    status: 'SUPPORTED' as const,
    evidence_refs: Object.freeze(index === 0 ? ['EGD18'] : distinct([
      ...bottlenecks.filter((signal) => signal.code === code).flatMap((signal) => signal.evidence_refs),
      ...subjectFocus.filter((signal) => `SUBJECT_${signal.code}` === code).flatMap((signal) => signal.evidence_refs)
    ]))
  }))
  const pathwayCodes = optionalStringList(answers, 'EGD19')
  const allEvidence = distinct([
    'EGD02', 'EGD03', 'EGD04', 'EGD05', 'EGD07', 'EGD18',
    ...(pathwayCodes.length > 0 ? ['EGD19'] : []),
    ...strengthSignals.flatMap((signal) => signal.evidence_refs),
    ...bottlenecks.flatMap((signal) => signal.evidence_refs),
    ...subjectFocus.flatMap((signal) => signal.evidence_refs),
    ...interestSignals.flatMap((signal) => signal.evidence_refs),
    ...learningSignals.flatMap((signal) => signal.evidence_refs)
  ])
  return Object.freeze({
    result_kind: 'STUDENT_GROWTH_DISCOVERY',
    result_version: GROWTH_DISCOVERY_REPORT_VERSION,
    education_pathway_context: Object.freeze({
      selected_codes: Object.freeze([...pathwayCodes]),
      respondent: 'STUDENT',
      intent: pathwayCodes.length > 0 ? 'CONSIDERING' : 'UNKNOWN',
      status: pathwayCodes.length > 0 ? 'USER_STATED_CONTEXT' : 'UNKNOWN',
      evidence_refs: pathwayCodes.length > 0
        ? Object.freeze(['EGD19'] as const)
        : Object.freeze([] as const),
      taxonomy_version: EDUCATION_COMPASS_TAXONOMY_VERSION
    }),
    student_snapshot: Object.freeze({
      education_system: educationSystem,
      grade_stage: requiredString(answers, 'EGD02'),
      major_exam_year: requiredString(answers, 'EGD04'),
      target_regions: Object.freeze([...stringList(answers, 'EGD05')]),
      performance_self_view: requiredString(answers, 'EGD07'),
      evidence_refs: Object.freeze(['EGD02', 'EGD03', 'EGD04', 'EGD05', 'EGD07'])
    }),
    strength_signals: Object.freeze(strengthSignals),
    learning_bottlenecks: Object.freeze(bottlenecks),
    subject_focus: Object.freeze(subjectFocus),
    growth_direction: Object.freeze([...interestSignals]),
    action_plan_30d: Object.freeze({ horizon_days: 30, selected_action_code: selectedAction, goals: Object.freeze(actionGoals) }),
    learning_signals: Object.freeze(learningSignals),
    interest_signals: Object.freeze(interestSignals),
    recommended_focus: Object.freeze(recommendedFocus),
    system_result_marker: bank.systemResultMarker ?? 'SYSTEM_BANK_PENDING',
    evidence_refs: Object.freeze(allEvidence),
    questionnaire_versions: Object.freeze([
      bank.commonBankVersion,
      ...(bank.systemBankVersion ? [bank.systemBankVersion] : [])
    ]),
    disclaimer_version: EDUCATION_COMPASS_DISCLAIMER_VERSION,
    disclaimer: EDUCATION_COMPASS_DISCLAIMER,
    scoring_mode: 'NONE'
  })
}
