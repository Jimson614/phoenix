import { invariant } from '../errors'
import {
  AssessmentLevel,
  CanonicalAnswerMap,
  CanonicalQuestionAnswer,
  EducationSystem,
  EducationSystemSwitchResult,
  FrozenQuestion,
  QuestionnaireValidationResult,
  SubjectRangeAnswerRow
} from './contracts'
import {
  getEducationCompassQuestionnaireBank,
  isEducationSystem
} from './registry'

export type QuestionnaireValidationMode = 'DRAFT' | 'SUBMIT'

export interface ValidateQuestionnaireAnswersInput {
  level: AssessmentLevel
  educationSystem: EducationSystem | null
  /** Existing assessments validate against their pinned immutable questionnaire version. */
  questionnaireVersion?: string
  answers: unknown
  mode?: QuestionnaireValidationMode
  currentYear?: number
}

const PII_PATTERNS: ReadonlyArray<{ code: string; pattern: RegExp }> = Object.freeze([
  { code: 'EMAIL', pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { code: 'PHONE', pattern: /(?:^|\D)1[3-9]\d{9}(?:\D|$)/ },
  { code: 'IDENTITY_NUMBER', pattern: /(?:^|\D)(?:\d{17}[0-9Xx]|\d{15})(?:\D|$)/ },
  { code: 'WECHAT_OPENID', pattern: /\b(?:openid|unionid)[_:= -]?[A-Za-z0-9_-]{8,}\b/i },
  { code: 'URL', pattern: /https?:\/\//i }
])

function answerObject(value: unknown): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 400,
    'EDUCATION_COMPASS_ANSWERS_INVALID', 'answers 必须是以冻结题号为 key 的对象')
  return value as Record<string, unknown>
}

function assertNoPii(value: unknown, questionId: string): void {
  if (typeof value === 'string') {
    invariant(!/[\u0000-\u001f\u007f]/.test(value), 400, 'EDUCATION_COMPASS_CONTROL_CHARACTER', '问卷答案包含非法控制字符', { questionId })
    const match = PII_PATTERNS.find(({ pattern }) => pattern.test(value))
    invariant(!match, 400, 'EDUCATION_COMPASS_PII_FORBIDDEN', '本问卷不接受可识别个人信息或外部链接', {
      questionId,
      category: match?.code
    })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoPii(item, questionId))
    return
  }
  if (value !== null && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((item) => assertNoPii(item, questionId))
  }
}

function allowedCodes(question: FrozenQuestion): ReadonlySet<string> {
  return new Set(question.options.map((option) => option.code))
}

function singleChoice(question: FrozenQuestion, raw: unknown, mode: QuestionnaireValidationMode): string {
  invariant(typeof raw === 'string' && raw.length > 0, 400, 'EDUCATION_COMPASS_ANSWER_TYPE_INVALID', '单选题必须使用非空 canonical code', {
    questionId: question.id
  })
  invariant(allowedCodes(question).has(raw), 400, 'EDUCATION_COMPASS_OPTION_INVALID', '答案不在冻结选项中', {
    questionId: question.id,
    optionCode: raw
  })
  if (mode === 'SUBMIT' && question.validation.allowedSubmitValues) {
    invariant(question.validation.allowedSubmitValues.includes(raw), 422, 'STUDENT_SELF_CONFIRMATION_REQUIRED', '只有学生本人确认后才能提交', {
      questionId: question.id
    })
  }
  return raw
}

function multiChoice(question: FrozenQuestion, raw: unknown): readonly string[] {
  invariant(Array.isArray(raw) && raw.every((item) => typeof item === 'string'), 400,
    'EDUCATION_COMPASS_ANSWER_TYPE_INVALID', '多选题必须使用 canonical code 数组', { questionId: question.id })
  const values = raw as string[]
  invariant(new Set(values).size === values.length, 400, 'EDUCATION_COMPASS_DUPLICATE_OPTION', '多选答案不得重复', {
    questionId: question.id
  })
  const min = question.validation.minSelections ?? (question.required ? 1 : 0)
  const max = question.validation.maxSelections ?? question.options.length
  invariant(values.length >= min && values.length <= max, 400, 'EDUCATION_COMPASS_SELECTION_COUNT_INVALID', '多选数量超出冻结限制', {
    questionId: question.id,
    min,
    max
  })
  const codes = allowedCodes(question)
  invariant(values.every((value) => codes.has(value)), 400, 'EDUCATION_COMPASS_OPTION_INVALID', '答案包含未冻结选项', {
    questionId: question.id
  })
  const exclusive = question.validation.exclusiveOptions ?? []
  invariant(!(values.length > 1 && values.some((value) => exclusive.includes(value))), 400,
    'EDUCATION_COMPASS_EXCLUSIVE_OPTION_CONFLICT', '互斥选项不得与其他选项同时选择', { questionId: question.id })
  return Object.freeze([...values])
}

function yearChoice(question: FrozenQuestion, raw: unknown, currentYear: number): string {
  invariant(typeof raw === 'string', 400, 'EDUCATION_COMPASS_ANSWER_TYPE_INVALID', '年份题必须使用四位年份字符串或冻结 sentinel code', {
    questionId: question.id
  })
  const sentinels = question.validation.sentinelValues ?? []
  if (sentinels.includes(raw)) return raw
  invariant(/^\d{4}$/.test(raw), 400, 'EDUCATION_COMPASS_YEAR_INVALID', '年份格式无效', { questionId: question.id })
  const year = Number(raw)
  const min = question.validation.min === 'CURRENT_YEAR' ? currentYear : (question.validation.min ?? currentYear)
  const max = question.validation.max === 'CURRENT_YEAR_PLUS_8' ? currentYear + 8 : (question.validation.max ?? currentYear + 8)
  invariant(year >= min && year <= max, 400, 'EDUCATION_COMPASS_YEAR_OUT_OF_RANGE', '年份超出冻结范围', {
    questionId: question.id,
    min,
    max
  })
  return raw
}

function matrixChoice(question: FrozenQuestion, raw: unknown): readonly SubjectRangeAnswerRow[] {
  invariant(Array.isArray(raw), 400, 'EDUCATION_COMPASS_ANSWER_TYPE_INVALID', '学科区间题必须使用矩阵数组', {
    questionId: question.id
  })
  const maxRows = question.validation.maxRows ?? 0
  invariant(raw.length <= maxRows && (raw.length > 0 || question.validation.allowEmpty === true), 400,
    'EDUCATION_COMPASS_MATRIX_ROW_COUNT_INVALID', '学科区间行数超出冻结限制', { questionId: question.id, maxRows })
  const subjects = new Set(question.matrixSubjectOptions?.map((option) => option.code) ?? [])
  const ranges = new Set(question.matrixRangeOptions?.map((option) => option.code) ?? [])
  const rows = raw.map((entry) => {
    invariant(entry !== null && typeof entry === 'object' && !Array.isArray(entry), 400,
      'EDUCATION_COMPASS_MATRIX_ROW_INVALID', '学科区间行必须是对象', { questionId: question.id })
    const row = entry as Record<string, unknown>
    const keys = Object.keys(row).sort()
    invariant(keys.length === 2 && keys[0] === 'range_code' && keys[1] === 'subject_code', 400,
      'EDUCATION_COMPASS_MATRIX_ROW_UNKNOWN_FIELD', '学科区间行只允许 subject_code 与 range_code', { questionId: question.id })
    invariant(typeof row.subject_code === 'string' && subjects.has(row.subject_code), 400,
      'EDUCATION_COMPASS_MATRIX_SUBJECT_INVALID', '学科区间行的 subject_code 无效', { questionId: question.id })
    invariant(typeof row.range_code === 'string' && ranges.has(row.range_code), 400,
      'EDUCATION_COMPASS_MATRIX_RANGE_INVALID', '学科区间行的 range_code 无效', { questionId: question.id })
    return Object.freeze({ subject_code: row.subject_code, range_code: row.range_code })
  })
  invariant(new Set(rows.map((row) => row.subject_code)).size === rows.length, 400,
    'EDUCATION_COMPASS_MATRIX_SUBJECT_DUPLICATE', '同一学科不得重复提供区间', { questionId: question.id })
  return Object.freeze(rows)
}

function normalizeAnswer(
  question: FrozenQuestion,
  raw: unknown,
  mode: QuestionnaireValidationMode,
  currentYear: number
): CanonicalQuestionAnswer {
  assertNoPii(raw, question.id)
  switch (question.type) {
    case 'SINGLE_CHOICE':
    case 'PROVINCE_REGION_SELECT':
      return singleChoice(question, raw, mode)
    case 'MULTI_CHOICE':
    case 'MULTI_CHOICE_DYNAMIC':
      return multiChoice(question, raw)
    case 'YEAR_SELECT':
      return yearChoice(question, raw, currentYear)
    case 'SUBJECT_RANGE_MATRIX':
      return matrixChoice(question, raw)
  }
}

export function validateQuestionnaireAnswers(input: ValidateQuestionnaireAnswersInput): QuestionnaireValidationResult {
  const mode = input.mode ?? 'DRAFT'
  invariant(mode === 'DRAFT' || mode === 'SUBMIT', 500, 'EDUCATION_COMPASS_VALIDATION_MODE_INVALID', '问卷校验模式无效')
  invariant(Number.isInteger(input.currentYear ?? new Date().getUTCFullYear()), 500,
    'EDUCATION_COMPASS_CURRENT_YEAR_INVALID', '问卷校验年份无效')
  const currentYear = input.currentYear ?? new Date().getUTCFullYear()
  const bank = getEducationCompassQuestionnaireBank(input.level, input.educationSystem, input.questionnaireVersion)
  const source = answerObject(input.answers)
  const byId = new Map(bank.questions.map((question) => [question.id, question]))
  const unknownQuestionIds = Object.keys(source).filter((questionId) => !byId.has(questionId))
  invariant(unknownQuestionIds.length === 0, 400, 'EDUCATION_COMPASS_UNKNOWN_QUESTION_ID', '答案包含不属于当前冻结题库的题号', {
    questionIds: unknownQuestionIds
  })
  const normalized: Record<string, CanonicalQuestionAnswer> = {}
  for (const [questionId, raw] of Object.entries(source)) {
    invariant(raw !== undefined && raw !== null, 400, 'EDUCATION_COMPASS_EMPTY_ANSWER_INVALID', '空答案应从 answers 中省略', { questionId })
    const question = byId.get(questionId)
    invariant(question, 400, 'EDUCATION_COMPASS_UNKNOWN_QUESTION_ID', '未知题号', { questionId })
    normalized[questionId] = normalizeAnswer(question, raw, mode, currentYear)
  }
  if (input.level === 'LEVEL_2' && normalized.EGD03 !== undefined) {
    invariant(typeof normalized.EGD03 === 'string' && isEducationSystem(normalized.EGD03), 400,
      'EDUCATION_SYSTEM_INVALID', '教育体系必须使用冻结 code')
    invariant(normalized.EGD03 === input.educationSystem, 409, 'EDUCATION_SYSTEM_ROUTE_MISMATCH', '答案中的教育体系与当前题库分支不一致')
  }
  const missingRequiredQuestionIds = bank.requiredQuestionIds.filter((questionId) => normalized[questionId] === undefined)
  const respondentExitRequested = normalized.EGD01 === 'EXIT_NOT_STUDENT'
  if (mode === 'SUBMIT') {
    invariant(!respondentExitRequested, 422, 'STUDENT_SELF_CONFIRMATION_REQUIRED', '学生未确认本人作答，不生成结果且不允许购买')
    invariant(missingRequiredQuestionIds.length === 0, 422, 'EDUCATION_COMPASS_REQUIRED_ANSWERS_MISSING', '问卷仍有适用的必答题未完成', {
      questionIds: missingRequiredQuestionIds
    })
  }
  const answeredRequiredCount = bank.requiredQuestionIds.length - missingRequiredQuestionIds.length
  const completenessCoverage = bank.requiredQuestionIds.length === 0
    ? 100
    : Math.round(answeredRequiredCount / bank.requiredQuestionIds.length * 100)
  return Object.freeze({
    answers: Object.freeze(normalized),
    missingRequiredQuestionIds: Object.freeze(missingRequiredQuestionIds),
    answeredRequiredCount,
    requiredCount: bank.requiredQuestionIds.length,
    completenessCoverage,
    canSubmit: missingRequiredQuestionIds.length === 0 && !respondentExitRequested,
    respondentExitRequested,
    schemaDigest: bank.schemaDigest
  })
}

export function switchEducationSystemAnswers(
  answersInput: unknown,
  previousEducationSystem: EducationSystem,
  educationSystem: EducationSystem,
  currentYear?: number,
  questionnaireVersion?: string
): EducationSystemSwitchResult {
  const source = answerObject(answersInput)
  const previousBank = getEducationCompassQuestionnaireBank('LEVEL_2', previousEducationSystem, questionnaireVersion)
  const nextBank = getEducationCompassQuestionnaireBank('LEVEL_2', educationSystem, questionnaireVersion)
  const common = new Set(nextBank.commonQuestionIds)
  const nextQuestions = new Map(nextBank.questions.map((question) => [question.id, question]))
  const knownQuestionIds = new Set([
    ...previousBank.questions.map((question) => question.id),
    ...nextBank.questions.map((question) => question.id)
  ])
  const unknownQuestionIds = Object.keys(source).filter((questionId) => !knownQuestionIds.has(questionId))
  invariant(unknownQuestionIds.length === 0, 400, 'EDUCATION_COMPASS_UNKNOWN_QUESTION_ID', '答案包含不属于切换前后冻结题库的题号', {
    questionIds: unknownQuestionIds
  })
  const answers: Record<string, CanonicalQuestionAnswer> = {}
  const removed = new Set<string>()
  for (const [questionId, answer] of Object.entries(source)) {
    if (!common.has(questionId)) {
      removed.add(questionId)
      continue
    }
    if ((questionId === 'EGD08' || questionId === 'EGD09') && Array.isArray(answer)) {
      const allowed = new Set(nextQuestions.get(questionId)?.options.map((option) => option.code) ?? [])
      const retained = (answer as readonly string[]).filter((code) => allowed.has(code))
      if (retained.length !== answer.length) removed.add(questionId)
      if (retained.length > 0) answers[questionId] = Object.freeze(retained)
      continue
    }
    answers[questionId] = answer as CanonicalQuestionAnswer
  }
  answers.EGD03 = educationSystem
  previousBank.systemQuestionIds.forEach((questionId) => {
    if (source[questionId] !== undefined) removed.add(questionId)
  })
  const normalized = validateQuestionnaireAnswers({
    level: 'LEVEL_2',
    educationSystem,
    ...(questionnaireVersion !== undefined ? { questionnaireVersion } : {}),
    answers,
    mode: 'DRAFT',
    ...(currentYear !== undefined ? { currentYear } : {})
  })
  return Object.freeze({
    answers: normalized.answers,
    removedQuestionIds: Object.freeze([...removed].sort()),
    previousEducationSystem,
    educationSystem
  })
}
