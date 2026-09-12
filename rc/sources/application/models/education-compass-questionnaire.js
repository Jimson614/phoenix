const QUESTION_TYPES = Object.freeze({
  SINGLE_CHOICE: 'SINGLE_CHOICE',
  MULTI_CHOICE: 'MULTI_CHOICE',
  YEAR_SELECT: 'YEAR_SELECT',
  MULTI_CHOICE_DYNAMIC: 'MULTI_CHOICE_DYNAMIC',
  PROVINCE_REGION_SELECT: 'PROVINCE_REGION_SELECT',
  SUBJECT_RANGE_MATRIX: 'SUBJECT_RANGE_MATRIX'
})

const ALLOWED_TYPES = new Set(Object.values(QUESTION_TYPES))
const MULTI_TYPES = new Set([QUESTION_TYPES.MULTI_CHOICE, QUESTION_TYPES.MULTI_CHOICE_DYNAMIC])
const SINGLE_TYPES = new Set([QUESTION_TYPES.SINGLE_CHOICE, QUESTION_TYPES.YEAR_SELECT, QUESTION_TYPES.PROVINCE_REGION_SELECT])
const FALLBACK_SYSTEMS = new Set(['IB', 'OTHER'])
const EXPERIENCE_COPY_FALLBACKS = Object.freeze({
  FREE_PARENT: Object.freeze({
    experienceEyebrow: 'FREE PARENT EDUCATION COMPASS',
    experienceTitle: '3—5 分钟，形成一份家庭教育快照',
    experienceSummary: '由家长／监护人根据近期观察填写，帮助整理家庭教育关注点、孩子当前阶段与下一步支持方向。',
    respondentHint: '请由家长／监护人根据最近的真实观察作答；这不是对孩子能力的评分。',
    completionOutcome: '提交后可查看完整 Family Education Snapshot，并判断是否适合邀请学生本人继续。',
    primaryActionHint: '完成免费问卷，查看家庭教育快照'
  }),
  STUDENT_GROWTH: Object.freeze({
    experienceEyebrow: '¥39.90 STUDENT GROWTH DISCOVERY',
    experienceTitle: '15—20 分钟，完成学生成长发现',
    experienceSummary: '仅由学生本人作答；先完成并提交问卷，再由学生自主决定是否付款解锁完整六项报告。',
    respondentHint: '本问卷仅限学生本人填写；家长可协助操作或解释题意，但不能代选答案。',
    completionOutcome: '提交后可查看付款解锁入口；未付款前不会展示结论、信号、证据或完整报告。',
    primaryActionHint: '由学生本人完成成长发现'
  })
})

class QuestionnaireContractError extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'QuestionnaireContractError'
    this.code = 'QUESTIONNAIRE_CONTRACT_INVALID'
    this.details = details || null
  }
}

function contractError(message, details) {
  throw new QuestionnaireContractError(message, details)
}

function unwrap(result) {
  const payload = result && result.data !== undefined ? result.data : result
  return payload && (payload.questionnaire || payload.bank) ? (payload.questionnaire || payload.bank) : payload
}

function pathValue(root, path) {
  return String(path || '').split('.').reduce((value, key) => (value && value[key] !== undefined ? value[key] : undefined), root)
}

function registryValues(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value.values)) return value.values
  if (Array.isArray(value.options)) return value.options
  if (Array.isArray(value.items)) return value.items
  return null
}

function resolutionRoot(raw) {
  const optionCatalogs = raw.optionCatalogs || raw.option_catalogs || {}
  const registries = raw.registries || raw.registry || {}
  return {
    ...raw,
    optionCatalogs,
    option_catalogs: optionCatalogs,
    taxonomy: raw.taxonomy || {},
    registries
  }
}

function resolveReference(root, reference) {
  if (!reference) return null
  const parts = String(reference).split(/\s+\+\s+/).filter(Boolean)
  const resolved = parts.map((part) => {
    const direct = pathValue(root, part)
    const registry = direct === undefined ? root.registries[part] : direct
    return registryValues(registry)
  })
  if (resolved.some((value) => !value)) return null
  return resolved.length === 1 ? resolved[0] : resolved
}

function normalizeOption(option, questionId) {
  if (!option || typeof option !== 'object' || Array.isArray(option)) {
    contractError(`题目 ${questionId} 的选项必须包含 code 与 label`, { questionId })
  }
  const code = String(option.code || '').trim()
  const label = String(option.label || '').trim()
  if (!code || !label) contractError(`题目 ${questionId} 存在空选项 code/label`, { questionId })
  return { ...option, code, label }
}

function normalizeOptions(options, questionId) {
  const values = Array.isArray(options) ? options.map((option) => normalizeOption(option, questionId)) : []
  const seen = new Set()
  values.forEach((option) => {
    if (seen.has(option.code)) contractError(`题目 ${questionId} 存在重复选项 ${option.code}`, { questionId, code: option.code })
    seen.add(option.code)
  })
  return values
}

function yearOptions(question, raw, context) {
  if (Array.isArray(question.options) && question.options.length) return question.options
  const validation = question.validation || {}
  const currentYear = Number(context.currentYear || raw.currentYear || raw.current_year || new Date().getFullYear())
  const min = validation.min === 'CURRENT_YEAR' ? currentYear : Number(validation.min || currentYear)
  const max = validation.max === 'CURRENT_YEAR_PLUS_8' ? currentYear + 8 : Number(validation.max || currentYear + 8)
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max || max - min > 20) {
    contractError(`题目 ${question.id} 的年份范围无效`, { questionId: question.id })
  }
  const options = []
  for (let year = min; year <= max; year += 1) options.push({ code: String(year), label: `${year} 年` })
  const sentinelLabels = { UNSURE: '尚未确定', NOT_APPLICABLE: '不适用' }
  ;(validation.sentinelValues || []).forEach((code) => options.push({ code, label: sentinelLabels[code] || code }))
  return options
}

function questionOptions(question, type, root, raw, context) {
  if (type === QUESTION_TYPES.SUBJECT_RANGE_MATRIX) {
    const subjects = question.matrixSubjectOptions || question.matrix_subject_options
    const ranges = question.matrixRangeOptions || question.matrix_range_options
    if (Array.isArray(subjects) && Array.isArray(ranges)) return [subjects, ranges]
  }
  if (Array.isArray(question.options) && question.options.length) return question.options
  if (type === QUESTION_TYPES.YEAR_SELECT) return yearOptions(question, raw, context)
  const reference = question.optionsRef || question.options_ref
  if (reference) return resolveReference(root, reference)
  if (type === QUESTION_TYPES.MULTI_CHOICE_DYNAMIC) {
    const system = context.educationSystem || raw.educationSystem || raw.education_system || ''
    return root.option_catalogs[`subject_${system}`] || root.option_catalogs.subject_generic || null
  }
  return null
}

function normalizeQuestion(question, scope, root, raw, context) {
  const id = String(question.id || question.questionId || question.question_id || '').trim()
  const fieldKey = String(question.key || question.answerKey || question.answer_key || '').trim()
  const label = String(question.label || '').trim()
  const type = String(question.type || '').toUpperCase()
  if (!id || !fieldKey || !label || !ALLOWED_TYPES.has(type)) {
    contractError('服务端题目缺少 id/key/label 或使用了不支持的题型', { id, key: fieldKey, type })
  }
  if (question.scored === true) contractError(`题目 ${id} 不得启用评分`, { questionId: id })

  const referenced = questionOptions(question, type, root, raw, context)
  let options = []
  let matrix = null
  if (type === QUESTION_TYPES.SUBJECT_RANGE_MATRIX) {
    if (!Array.isArray(referenced) || referenced.length !== 2 || !Array.isArray(referenced[0]) || !Array.isArray(referenced[1])) {
      contractError(`题目 ${id} 缺少科目与区间 registry`, { questionId: id })
    }
    matrix = {
      subjects: normalizeOptions(referenced[0], id),
      ranges: normalizeOptions(referenced[1], id)
    }
  } else {
    if (!Array.isArray(referenced) || !referenced.length) contractError(`题目 ${id} 没有可用的 canonical 选项`, { questionId: id })
    options = normalizeOptions(referenced, id)
  }

  return {
    id,
    key: fieldKey,
    answerKey: id,
    fieldKey,
    label,
    type,
    required: question.required === true,
    validation: { ...(question.validation || {}) },
    dimensions: question.dimensions || (question.dimension ? [question.dimension] : []),
    signalCodes: question.signalCodes || question.signal_codes || [],
    systemApplicability: question.systemApplicability || question.system_applicability || [],
    scored: false,
    scope: String(question.scope || scope || 'COMMON').toUpperCase(),
    options,
    matrix
  }
}

function selectedSystemBank(raw, system) {
  const banks = raw.systemBanks || raw.system_banks || {}
  const bank = banks[system]
  if (!bank) return []
  return bank.questions || bank.systemQuestions || bank.system_questions || []
}

function presentationMeta(raw, questions, assessmentKind) {
  const source = raw.presentationMeta || raw.presentation_meta || raw.presentation || {}
  const respondentRole = raw.respondentRole || raw.respondent_role || ''
  const isFreeParent = assessmentKind === 'FREE_PARENT_COMPASS' || respondentRole === 'PARENT_GUARDIAN'
  const copyFallbacks = isFreeParent ? EXPERIENCE_COPY_FALLBACKS.FREE_PARENT : EXPERIENCE_COPY_FALLBACKS.STUDENT_GROWTH
  const defaultMin = isFreeParent ? 3 : 15
  const defaultMax = isFreeParent ? 5 : 20
  const providedMin = Number(source.estimatedMinutesMin === undefined ? source.estimated_minutes_min : source.estimatedMinutesMin)
  const providedMax = Number(source.estimatedMinutesMax === undefined ? source.estimated_minutes_max : source.estimatedMinutesMax)
  const estimatedMinutesMin = Number.isFinite(providedMin) && providedMin > 0 ? providedMin : defaultMin
  const estimatedMinutesMax = Number.isFinite(providedMax) && providedMax >= estimatedMinutesMin ? providedMax : defaultMax
  const copyValue = (camelKey, snakeKey) => {
    const candidate = source[camelKey] === undefined ? source[snakeKey] : source[camelKey]
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : copyFallbacks[camelKey]
  }
  return {
    version: source.version || 'education_compass_presentation_v1',
    estimatedMinutesMin,
    estimatedMinutesMax,
    totalQuestions: questions.length,
    requiredQuestions: questions.filter((question) => question.required).length,
    progressMode: 'QUESTION_COUNT',
    scoringMode: 'NONE',
    experienceEyebrow: copyValue('experienceEyebrow', 'experience_eyebrow'),
    experienceTitle: copyValue('experienceTitle', 'experience_title'),
    experienceSummary: copyValue('experienceSummary', 'experience_summary'),
    respondentHint: copyValue('respondentHint', 'respondent_hint'),
    completionOutcome: copyValue('completionOutcome', 'completion_outcome'),
    primaryActionHint: copyValue('primaryActionHint', 'primary_action_hint')
  }
}

function normalizeQuestionBank(result, context = {}) {
  const raw = unwrap(result)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) contractError('服务端未返回有效题库')
  const root = resolutionRoot(raw)
  const educationSystem = context.educationSystem || raw.educationSystem || raw.education_system || ''
  let entries = []

  if (Array.isArray(raw.questions)) {
    entries = raw.questions.map((question) => ({ question, scope: question.scope || 'COMMON' }))
  } else {
    const common = raw.commonQuestions || raw.common_questions || []
    const explicitSystem = raw.systemQuestions || raw.system_questions || []
    const branch = explicitSystem.length ? explicitSystem : selectedSystemBank(raw, educationSystem)
    entries = common.map((question) => ({ question, scope: 'COMMON' }))
      .concat(branch.map((question) => ({ question, scope: 'SYSTEM' })))
  }

  if (!entries.length) contractError('服务端题库没有题目')
  const questions = entries.map((entry) => normalizeQuestion(entry.question, entry.scope, root, raw, { ...context, educationSystem }))
  const ids = new Set()
  const keys = new Set()
  questions.forEach((question) => {
    if (ids.has(question.id) || keys.has(question.key)) {
      contractError(`题库存在重复题号或 answer key：${question.id}`, { questionId: question.id, key: question.key })
    }
    ids.add(question.id)
    keys.add(question.key)
  })

  const version = raw.version || raw.questionnaireVersion || raw.questionnaire_version || raw.bankVersion || raw.bank_version || ''
  const schemaDigest = raw.schemaDigest || raw.schema_digest || ''
  if (!version || !schemaDigest) contractError('服务端题库缺少 version 或 schemaDigest')
  const assessmentKind = raw.assessmentKind || raw.assessment_kind || context.assessmentKind || ''
  return {
    version,
    schemaDigest,
    assessmentKind,
    respondentRole: raw.respondentRole || raw.respondent_role || '',
    educationSystem,
    systemFallback: FALLBACK_SYSTEMS.has(educationSystem),
    presentation: presentationMeta(raw, questions, assessmentKind),
    questions,
    questionByKey: questions.reduce((map, question) => { map[question.key] = question; return map }, {})
  }
}

function isEmpty(value) {
  if (Array.isArray(value)) return value.length === 0
  return value === undefined || value === null || String(value).trim() === ''
}

function validationError(question, code, message) {
  return { questionId: question.id, key: question.key, code, message }
}

function validateSingle(question, value) {
  const code = String(value || '')
  if (!question.options.some((option) => option.code === code)) {
    return [validationError(question, 'OPTION_CODE_INVALID', '请选择题库提供的选项')]
  }
  const allowed = question.validation.allowedSubmitValues || []
  if (allowed.length && !allowed.includes(code)) {
    return [validationError(question, 'SUBMIT_VALUE_NOT_ALLOWED', '当前选择不能用于提交')]
  }
  return []
}

function validateMulti(question, value) {
  if (!Array.isArray(value)) return [validationError(question, 'ANSWER_TYPE_INVALID', '答案必须是选项 code 数组')]
  const unique = [...new Set(value)]
  if (unique.length !== value.length) return [validationError(question, 'DUPLICATE_SELECTION', '选项不能重复')]
  if (unique.some((code) => !question.options.some((option) => option.code === code))) {
    return [validationError(question, 'OPTION_CODE_INVALID', '答案包含题库之外的选项')]
  }
  const min = Number(question.validation.minSelections === undefined ? (question.required ? 1 : 0) : question.validation.minSelections)
  const max = Number(question.validation.maxSelections === undefined ? question.options.length : question.validation.maxSelections)
  if (unique.length < min || unique.length > max) return [validationError(question, 'SELECTION_COUNT_INVALID', `请选择 ${min}—${max} 项`)]
  const exclusive = question.validation.exclusiveOptions || []
  if (unique.length > 1 && unique.some((code) => exclusive.includes(code))) {
    return [validationError(question, 'EXCLUSIVE_OPTION_CONFLICT', '互斥选项不能与其他选项同时选择')]
  }
  return []
}

function validateMatrix(question, value) {
  if (!Array.isArray(value)) return [validationError(question, 'ANSWER_TYPE_INVALID', '成绩区间必须是行数组')]
  const maxRows = Number(question.validation.maxRows || question.matrix.subjects.length)
  if (value.length > maxRows) return [validationError(question, 'MATRIX_ROWS_EXCEEDED', `最多填写 ${maxRows} 行`)]
  const subjectCodes = new Set()
  for (const row of value) {
    const subjectCode = row && (row.subjectCode || row.subject_code)
    const rangeCode = row && (row.rangeCode || row.range_code)
    if (!question.matrix.subjects.some((option) => option.code === subjectCode) ||
        !question.matrix.ranges.some((option) => option.code === rangeCode)) {
      return [validationError(question, 'MATRIX_CODE_INVALID', '成绩区间包含无效科目或区间 code')]
    }
    if (subjectCodes.has(subjectCode)) return [validationError(question, 'MATRIX_SUBJECT_DUPLICATE', '同一科目只能填写一次')]
    subjectCodes.add(subjectCode)
  }
  return []
}

function validateQuestion(question, value, options = {}) {
  if (isEmpty(value)) {
    if (question.required && options.forSubmit !== false) return [validationError(question, 'REQUIRED', '此题为必答题')]
    return []
  }
  if (SINGLE_TYPES.has(question.type)) return validateSingle(question, value)
  if (MULTI_TYPES.has(question.type)) return validateMulti(question, value)
  if (question.type === QUESTION_TYPES.SUBJECT_RANGE_MATRIX) return validateMatrix(question, value)
  return [validationError(question, 'QUESTION_TYPE_UNSUPPORTED', '当前题型不受支持')]
}

function validateAnswers(bank, answers, options = {}) {
  const value = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {}
  const errors = []
  const knownKeys = new Set(bank.questions.flatMap((question) => [question.answerKey || question.id, question.key]))
  Object.keys(value).forEach((key) => {
    if (!knownKeys.has(key)) errors.push({ questionId: '', key, code: 'UNKNOWN_ANSWER_FIELD', message: '答案包含当前题库之外的字段' })
  })
  bank.questions.forEach((question) => {
    const answerKey = question.answerKey || question.id
    errors.push(...validateQuestion(question, value[answerKey] === undefined ? value[question.key] : value[answerKey], options))
  })
  const required = bank.questions.filter((question) => question.required)
  const answeredRequired = required.filter((question) => {
    const answerKey = question.answerKey || question.id
    return !isEmpty(value[answerKey] === undefined ? value[question.key] : value[answerKey])
  })
  return {
    valid: errors.length === 0,
    errors,
    missingQuestionIds: errors.filter((error) => error.code === 'REQUIRED').map((error) => error.questionId),
    coverage: required.length ? Math.round((answeredRequired.length / required.length) * 100) : 100
  }
}

function viewQuestion(question, answer) {
  if (question.type === QUESTION_TYPES.SUBJECT_RANGE_MATRIX) return { ...question, value: Array.isArray(answer) ? answer : [] }
  const selected = MULTI_TYPES.has(question.type) ? (Array.isArray(answer) ? answer : []) : [answer]
  return {
    ...question,
    value: MULTI_TYPES.has(question.type) ? selected : (answer || ''),
    options: question.options.map((option) => ({ ...option, selected: selected.includes(option.code) }))
  }
}

function buildViewModel(bank, answers = {}) {
  const validation = validateAnswers(bank, answers, { forSubmit: false })
  return {
    version: bank.version,
    schemaDigest: bank.schemaDigest,
    educationSystem: bank.educationSystem,
    presentation: bank.presentation,
    coverage: validation.coverage,
    questions: bank.questions.map((question) => {
      const answerKey = question.answerKey || question.id
      return viewQuestion(question, answers[answerKey] === undefined ? answers[question.key] : answers[answerKey])
    })
  }
}

function switchEducationSystem(bank, answers, nextSystem, options = {}) {
  const systemCode = String(nextSystem || '').trim()
  if (!systemCode) contractError('切换教育体系时必须提供 canonical code')
  const current = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {}
  const next = {}
  const droppedFields = []
  bank.questions.forEach((question) => {
    const answerKey = question.answerKey || question.id
    const sourceKey = current[answerKey] === undefined ? question.key : answerKey
    if (current[sourceKey] === undefined) return
    if (question.scope === 'SYSTEM') droppedFields.push(sourceKey)
    else next[sourceKey] = current[sourceKey]
  })
  const educationSystemKey = options.educationSystemKey ||
    (Object.prototype.hasOwnProperty.call(current, 'EGD03') ? 'EGD03' : 'education_system')
  next[educationSystemKey] = systemCode
  return {
    answers: next,
    droppedFields,
    requiresQuestionnaireReload: true,
    auditEvent: {
      eventType: 'SYSTEM_ROUTE_CHANGED',
      from: bank.educationSystem || '',
      to: systemCode
    }
  }
}

module.exports = {
  QUESTION_TYPES,
  QuestionnaireContractError,
  buildViewModel,
  isEmpty,
  normalizeQuestionBank,
  switchEducationSystem,
  validateAnswers,
  validateQuestion
}
