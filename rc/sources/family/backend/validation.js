class RequestError extends Error {
  constructor(statusCode, code, message) {
    super(message)
    this.name = 'RequestError'
    this.statusCode = statusCode
    this.code = code
  }
}

const ANSWER_RULES = Object.freeze({
  school_stage: { type: 'text', maxLength: 32, allowedValues: ['小学', '初中', '高中', '大学', '其他'] },
  learning_feeling: { type: 'text', maxLength: 32, allowedValues: ['主动投入', '基本稳定', '有些迷茫', '压力较大'] },
  strengths: { type: 'list', maxItems: 6, itemMaxLength: 32, allowedValues: ['好奇心', '表达力', '逻辑力', '创造力', '专注力', '同理心'] },
  interests: { type: 'text', maxLength: 1000 },
  challenges: { type: 'list', maxItems: 6, itemMaxLength: 32, allowedValues: ['目标不清晰', '学习动力不足', '时间管理', '亲子沟通', '升学选择', '压力焦虑'] },
  parent_observation: { type: 'text', maxLength: 2000 },
  parent_expectation: { type: 'text', maxLength: 32, allowedValues: ['身心健康', '保持热爱', '学术成长', '独立选择', '综合发展'] },
  future_goal: { type: 'text', maxLength: 1000 },
  support_need: { type: 'list', maxItems: 6, itemMaxLength: 32, allowedValues: ['方向梳理', '选科建议', '项目体验', '学习计划', '亲子沟通', '顾问解读'] },
  available_time: { type: 'text', maxLength: 32, allowedValues: ['每周一次', '每两周一次', '每月一次', '先获得建议再决定'] }
})

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

function requireIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new RequestError(400, 'invalid_request', `${fieldName} is invalid`)
  }
  return value
}

function validateText(value, key, maxLength, allowedValues) {
  if (typeof value !== 'string') {
    throw new RequestError(400, 'invalid_answers', `${key} must be text`)
  }
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    throw new RequestError(400, 'invalid_answers', `${key} has an invalid length`)
  }
  if (allowedValues && !allowedValues.includes(normalized)) {
    throw new RequestError(400, 'invalid_answers', `${key} contains an unsupported value`)
  }
  return normalized
}

function validateList(value, key, rule) {
  if (!Array.isArray(value) || value.length < 1 || value.length > rule.maxItems) {
    throw new RequestError(400, 'invalid_answers', `${key} must be a non-empty list`)
  }
  const normalized = value.map((item) => validateText(item, key, rule.itemMaxLength, rule.allowedValues))
  if (new Set(normalized).size !== normalized.length) {
    throw new RequestError(400, 'invalid_answers', `${key} contains duplicate values`)
  }
  return normalized
}

function validateAnswers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestError(400, 'invalid_answers', 'answers must be an object')
  }

  const expectedKeys = Object.keys(ANSWER_RULES)
  const suppliedKeys = Object.keys(value)
  const unknownKeys = suppliedKeys.filter((key) => !ANSWER_RULES[key])
  if (unknownKeys.length) {
    throw new RequestError(400, 'invalid_answers', 'answers contains unsupported fields')
  }
  if (suppliedKeys.length !== expectedKeys.length) {
    throw new RequestError(400, 'invalid_answers', 'all questionnaire answers are required')
  }

  const normalized = {}
  expectedKeys.forEach((key) => {
    const rule = ANSWER_RULES[key]
    normalized[key] = rule.type === 'list'
      ? validateList(value[key], key, rule)
      : validateText(value[key], key, rule.maxLength, rule.allowedValues)
  })
  return normalized
}

function validateSubmission(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestError(400, 'invalid_request', 'request body must be an object')
  }
  const allowedFields = ['clientSubmissionId', 'familyId', 'studentId', 'questionnaireType', 'answers', 'submittedAt']
  if (Object.keys(value).some((key) => !allowedFields.includes(key))) {
    throw new RequestError(400, 'invalid_request', 'request body contains unsupported fields')
  }
  const questionnaireType = value.questionnaireType
  if (questionnaireType !== 'education') {
    throw new RequestError(400, 'invalid_request', 'questionnaireType is unsupported')
  }
  if (typeof value.submittedAt !== 'string' || Number.isNaN(Date.parse(value.submittedAt))) {
    throw new RequestError(400, 'invalid_request', 'submittedAt must be an ISO date')
  }

  return {
    clientSubmissionId: requireIdentifier(value.clientSubmissionId, 'clientSubmissionId'),
    familyId: requireIdentifier(value.familyId, 'familyId'),
    studentId: requireIdentifier(value.studentId, 'studentId'),
    questionnaireType,
    answers: validateAnswers(value.answers),
    submittedAt: new Date(value.submittedAt).toISOString()
  }
}

module.exports = { ANSWER_RULES, RequestError, validateSubmission }
