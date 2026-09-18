const api = require('./api')
const runtime = require('../config/runtime')

const ASSESSMENT_KINDS = Object.freeze({
  FREE_PARENT: 'FREE_PARENT_COMPASS',
  STUDENT_GROWTH: 'STUDENT_GROWTH_DISCOVERY'
})
const RESPONDENT_ROLES = Object.freeze({ PARENT: 'PARENT_GUARDIAN', STUDENT: 'STUDENT' })
const GROWTH_PRODUCT_CODE = 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1'
const GROWTH_PRODUCT_AMOUNT_FEN = 3990
const GROWTH_PRODUCT_CURRENCY = 'CNY'
const GROWTH_PRODUCT_PAYMENT_TIMING = 'AFTER_SUBMIT_BEFORE_REPORT'

function unwrap(result, keys = []) {
  let value = result && result.data !== undefined ? result.data : result
  for (const key of keys) {
    if (value && value[key] !== undefined) return value[key]
  }
  return value
}

function compact(value) {
  return Object.keys(value || {}).reduce((result, key) => {
    if (value[key] !== undefined) result[key] = value[key]
    return result
  }, {})
}

function requireId(value, field) {
  const id = String(value || '').trim()
  if (!id) throw new api.ApiError(`${field} 不能为空`, { code: 'EDUCATION_COMPASS_ID_REQUIRED', details: { field } })
  return id
}

function randomPart() {
  try {
    if (typeof wx !== 'undefined' && wx.getRandomValues) {
      const bytes = new Uint8Array(12)
      wx.getRandomValues(bytes)
      return Array.prototype.map.call(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
    }
  } catch (error) {}
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`
}

function createIdempotencyKey(purpose = 'education') {
  const safePurpose = String(purpose).replace(/[^a-z0-9_-]/gi, '').slice(0, 28) || 'education'
  return `pfs_edu_${safePurpose}_${randomPart()}`.slice(0, 120)
}

function createClientSaveToken() {
  return `pfs_edu_save_${randomPart()}`.slice(0, 120)
}

function idempotencyHeaders(idempotencyKey) {
  const value = String(idempotencyKey || '').trim()
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw new api.ApiError('缺少有效的幂等键', { code: 'IDEMPOTENCY_KEY_REQUIRED' })
  }
  return { 'Idempotency-Key': value }
}

function ensureRemote() {
  if (runtime.isDemo()) {
    throw new api.ApiError('Education Compass V0.5 必须连接受信后端，不能降级到本地题库', {
      code: 'EDUCATION_COMPASS_REMOTE_REQUIRED', statusCode: 503
    })
  }
}

const CONSENT_FIELDS = [
  'consentVersion', 'scope', 'textHash', 'locale', 'guardianAuthority', 'childSubjectId',
  'guardianConfirmed', 'studentConfirmed', 'assistanceMode', 'acceptedAt', 'withdrawnAt'
]

function normalizeConsent(value) {
  if (!value) return undefined
  return CONSENT_FIELDS.reduce((result, key) => {
    if (value[key] !== undefined) result[key] = value[key]
    return result
  }, {})
}

function normalizeAssessment(result) {
  const value = unwrap(result, ['assessment', 'draft']) || {}
  return {
    ...value,
    assessmentId: value.assessmentId || value.assessment_id || value.id || '',
    assessmentKind: value.assessmentKind || value.assessment_kind || value.kind || '',
    respondentRole: value.respondentRole || value.respondent_role || '',
    sourceAssessmentId: value.sourceAssessmentId || value.source_assessment_id || '',
    educationSystem: value.educationSystem || value.education_system || '',
    questionnaireVersion: value.questionnaireVersion || value.questionnaire_version || '',
    questionBankVersion: value.questionBankVersion || value.question_bank_version || '',
    schemaDigest: value.schemaDigest || value.schema_digest || '',
    resultKind: value.resultKind || value.result_kind || '',
    revision: Number(value.revision || 0),
    status: String(value.status || '').toUpperCase()
  }
}

function normalizeDraft(result) {
  const value = unwrap(result, ['draft', 'assessment']) || {}
  const assessment = normalizeAssessment(value)
  return {
    ...assessment,
    answers: value.answers && typeof value.answers === 'object' && !Array.isArray(value.answers) ? value.answers : {},
    clientSaveToken: value.clientSaveToken || value.client_save_token || ''
  }
}

function normalizeState(result) {
  const value = unwrap(result, ['state']) || {}
  return {
    ...value,
    familyId: value.familyId || value.family_id || '',
    studentId: value.studentId || value.student_id || '',
    assessmentId: value.assessmentId || value.assessment_id || '',
    sourceAssessmentId: value.sourceAssessmentId || value.source_assessment_id || '',
    reportId: value.reportId || value.report_id || '',
    orderId: value.orderId || value.order_id || '',
    assessmentKind: value.assessmentKind || value.assessment_kind || '',
    resultKind: value.resultKind || value.result_kind || '',
    nextAction: value.nextAction || value.next_action || null
  }
}

function normalizeProduct(result) {
  const value = unwrap(result, ['product']) || {}
  return {
    ...value,
    productCode: value.productCode || value.product_code || '',
    amountFen: Number(value.amountFen === undefined ? value.amount_fen : value.amountFen),
    currency: value.currency || '',
    displayPrice: value.displayPrice || value.display_price || '',
    paymentTiming: value.paymentTiming || value.payment_timing || ''
  }
}

function normalizeOrder(result) {
  const value = unwrap(result, ['order']) || {}
  return {
    ...value,
    orderId: value.orderId || value.order_id || value.id || '',
    assessmentId: value.assessmentId || value.assessment_id || '',
    reportId: value.reportId || value.report_id || '',
    productCode: value.productCode || value.product_code || '',
    amountFen: Number(value.amountFen === undefined ? value.amount_fen : value.amountFen),
    status: String(value.status || '').toUpperCase()
  }
}

async function getState() {
  ensureRemote()
  return normalizeState(await api.request('/v1/me/education-compass/state'))
}

async function getQuestionnaireVersion(version, educationSystem) {
  ensureRemote()
  const query = educationSystem ? `?educationSystem=${encodeURIComponent(educationSystem)}` : ''
  return unwrap(await api.request(`/v1/education-compass/questionnaires/${encodeURIComponent(requireId(version, 'questionnaireVersion'))}${query}`), ['questionnaire'])
}

async function createFreeParentAssessment(input, idempotencyKey) {
  ensureRemote()
  const value = input || {}
  return normalizeAssessment(await api.request('/v1/education-compass/free-parent-assessments', {
    method: 'POST',
    headers: idempotencyHeaders(idempotencyKey),
    data: compact({
      studentId: requireId(value.studentId, 'studentId'),
      sourceEntry: value.sourceEntry,
      consent: {
        scope: 'CORE_ASSESSMENT',
        copyVersion: (value.guardianConsent && (value.guardianConsent.copyVersion || value.guardianConsent.consentVersion)) || 'guardian_core_assessment_v1.0.0-rc1',
        locale: (value.guardianConsent && value.guardianConsent.locale) || 'zh-CN',
        guardianAuthorityConfirmed: Boolean(value.guardianConsent && (value.guardianConsent.guardianAuthorityConfirmed || value.guardianConsent.guardianConfirmed))
      }
    })
  }))
}

async function createStudentGrowthAssessment(studentId, input, idempotencyKey) {
  ensureRemote()
  const value = input || {}
  return normalizeAssessment(await api.request(`/v1/students/${encodeURIComponent(requireId(studentId, 'studentId'))}/education-assessments`, {
    method: 'POST',
    headers: idempotencyHeaders(idempotencyKey),
    data: compact({
      assessmentKind: ASSESSMENT_KINDS.STUDENT_GROWTH,
      sourceAssessmentId: requireId(value.sourceAssessmentId, 'sourceAssessmentId'),
      respondent: RESPONDENT_ROLES.STUDENT,
      educationSystem: value.educationSystem,
      sourceEntry: value.sourceEntry,
      assent: {
        scope: 'STUDENT_ASSESSMENT_ASSENT',
        copyVersion: (value.studentAssent && (value.studentAssent.copyVersion || value.studentAssent.consentVersion)) || 'student_assent_growth_discovery_v1.0.0-rc1',
        locale: (value.studentAssent && value.studentAssent.locale) || 'zh-CN',
        studentConfirmed: Boolean(value.studentAssent && value.studentAssent.studentConfirmed)
      }
    })
  }))
}

async function getAssessmentQuestionnaire(assessmentId) {
  ensureRemote()
  return unwrap(await api.request(`/v1/assessments/${encodeURIComponent(requireId(assessmentId, 'assessmentId'))}/questionnaire`), ['questionnaire'])
}

async function getDraft(assessmentId) {
  ensureRemote()
  return normalizeDraft(await api.request(`/v1/assessments/${encodeURIComponent(requireId(assessmentId, 'assessmentId'))}/draft`))
}

async function saveDraft(assessmentId, input) {
  ensureRemote()
  const value = input || {}
  if (!Number.isInteger(value.revision) || value.revision < 1) {
    throw new api.ApiError('草稿 revision 无效', { code: 'DRAFT_REVISION_REQUIRED' })
  }
  const clientSaveToken = String(value.clientSaveToken || '').trim()
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(clientSaveToken)) {
    throw new api.ApiError('缺少有效的客户端保存令牌', { code: 'CLIENT_SAVE_TOKEN_REQUIRED' })
  }
  const answers = value.answers
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new api.ApiError('问卷答案格式无效', { code: 'ASSESSMENT_ANSWERS_INVALID' })
  }
  return normalizeDraft(await api.request(`/v1/assessments/${encodeURIComponent(requireId(assessmentId, 'assessmentId'))}/draft`, {
    method: 'PUT', data: compact({ answers, revision: value.revision, clientSaveToken, educationSystem: value.educationSystem })
  }))
}

async function submitAssessment(assessmentId, input, idempotencyKey) {
  ensureRemote()
  const value = input || {}
  if (!Number.isInteger(value.revision) || value.revision < 1) {
    throw new api.ApiError('提交 revision 无效', { code: 'DRAFT_REVISION_REQUIRED' })
  }
  return normalizeAssessment(await api.request(`/v1/assessments/${encodeURIComponent(requireId(assessmentId, 'assessmentId'))}/submit`, {
    method: 'POST', headers: idempotencyHeaders(idempotencyKey), data: { revision: value.revision }
  }))
}

async function getResult(assessmentId) {
  ensureRemote()
  // Keep the result envelope. It carries the authoritative reportId,
  // entitlement state and result version; the renderer merges the nested
  // deterministic payload without dropping those server-owned fields.
  return unwrap(await api.request(`/v1/assessments/${encodeURIComponent(requireId(assessmentId, 'assessmentId'))}/result`))
}

async function getGrowthProduct() {
  ensureRemote()
  const product = normalizeProduct(await api.request('/v1/education-compass/products/growth-discovery'))
  if (product.productCode !== GROWTH_PRODUCT_CODE ||
    product.amountFen !== GROWTH_PRODUCT_AMOUNT_FEN ||
    product.currency !== GROWTH_PRODUCT_CURRENCY ||
    product.paymentTiming !== GROWTH_PRODUCT_PAYMENT_TIMING) {
    throw new api.ApiError('服务端返回的商品与 Growth Discovery 不一致', { code: 'PRODUCT_CONTRACT_MISMATCH' })
  }
  return product
}

async function createGrowthOrder(assessmentId, idempotencyKey) {
  ensureRemote()
  return normalizeOrder(await api.request(`/v1/assessments/${encodeURIComponent(requireId(assessmentId, 'assessmentId'))}/orders`, {
    method: 'POST', headers: idempotencyHeaders(idempotencyKey), data: { productCode: GROWTH_PRODUCT_CODE }
  }))
}

async function createWechatPrepay(orderId) {
  ensureRemote()
  return unwrap(await api.request(`/v1/orders/${encodeURIComponent(requireId(orderId, 'orderId'))}/wechat-prepay`, {
    method: 'POST', data: {}
  }), ['payment', 'prepay'])
}

async function getOrder(orderId) {
  ensureRemote()
  return normalizeOrder(await api.request(`/v1/orders/${encodeURIComponent(requireId(orderId, 'orderId'))}`))
}

async function updateFeishuProfileConsent(consent) {
  ensureRemote()
  const value = consent || {}
  const payload = {
    studentId: requireId(value.studentId || value.childSubjectId, 'studentId'),
    enabled: value.enabled !== false,
    copyVersion: value.copyVersion || value.consentVersion || 'feishu_profile_mirror_opt_in_v1.0.0-rc1',
    locale: value.locale || 'zh-CN',
    guardianAuthorityConfirmed: Boolean(value.guardianAuthorityConfirmed || value.guardianConfirmed)
  }
  if (!payload.guardianAuthorityConfirmed) {
    throw new api.ApiError('飞书资料镜像同意合同不完整', { code: 'FEISHU_CONSENT_INVALID' })
  }
  return unwrap(await api.request('/v1/me/integration-consents/feishu-profile', {
    method: 'PUT', data: payload
  }), ['consent'])
}

async function withdrawAssessmentConsent(studentId, scope) {
  ensureRemote()
  const allowed = ['CORE_ASSESSMENT', 'STUDENT_ASSESSMENT_ASSENT']
  if (!allowed.includes(scope)) {
    throw new api.ApiError('不支持的测评同意范围', { code: 'ASSESSMENT_CONSENT_SCOPE_INVALID' })
  }
  return unwrap(await api.request(
    `/v1/me/education-compass/consents/${encodeURIComponent(requireId(studentId, 'studentId'))}/${scope}`,
    { method: 'DELETE' }
  ))
}

module.exports = {
  ASSESSMENT_KINDS,
  GROWTH_PRODUCT_CODE,
  RESPONDENT_ROLES,
  createClientSaveToken,
  createFreeParentAssessment,
  createGrowthOrder,
  createIdempotencyKey,
  createStudentGrowthAssessment,
  createWechatPrepay,
  getAssessmentQuestionnaire,
  getDraft,
  getGrowthProduct,
  getOrder,
  getQuestionnaireVersion,
  getResult,
  getState,
  normalizeAssessment,
  normalizeDraft,
  normalizeOrder,
  normalizeProduct,
  normalizeState,
  saveDraft,
  submitAssessment,
  updateFeishuProfileConsent,
  withdrawAssessmentConsent
}
