class NavigationContractError extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'NavigationContractError'
    this.code = 'EDUCATION_COMPASS_NEXT_ACTION_INVALID'
    this.details = details || null
  }
}

function actionFrom(state) {
  const raw = state && (state.nextAction || state.next_action)
  if (typeof raw === 'string') return { code: raw }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  throw new NavigationContractError('服务端没有返回 Education Compass nextAction')
}

function firstValue(objects, names) {
  for (const object of objects) {
    if (!object || typeof object !== 'object') continue
    for (const name of names) {
      if (object[name] !== undefined && object[name] !== null && String(object[name]).trim()) return String(object[name]).trim()
    }
  }
  return ''
}

function query(parameters) {
  const values = Object.keys(parameters).filter((key) => parameters[key] !== undefined && parameters[key] !== null && String(parameters[key]) !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(parameters[key]))}`)
  return values.length ? `?${values.join('&')}` : ''
}

function requireTarget(value, field, code) {
  if (!value) throw new NavigationContractError(`nextAction ${code} 缺少 ${field}`, { code, field })
  return value
}

const ACTION_ALIASES = Object.freeze({
  START_FREE_PARENT_COMPASS: 'START_LEVEL_1',
  START_FREE_PARENT_ASSESSMENT: 'START_LEVEL_1',
  CONTINUE_FREE_PARENT_COMPASS: 'CONTINUE_LEVEL_1',
  CONTINUE_FREE_PARENT_ASSESSMENT: 'CONTINUE_LEVEL_1',
  VIEW_FAMILY_EDUCATION_SNAPSHOT: 'VIEW_FAMILY_SNAPSHOT',
  START_STUDENT_GROWTH_DISCOVERY: 'START_LEVEL_2',
  CONTINUE_STUDENT_GROWTH_DISCOVERY: 'CONTINUE_LEVEL_2',
  VIEW_STUDENT_GROWTH_LOCKED_RESULT: 'VIEW_LOCKED_RESULT',
  PURCHASE_TO_UNLOCK_REPORT: 'VIEW_LOCKED_RESULT',
  CHECK_ORDER_STATUS: 'CHECK_PAYMENT_STATUS',
  VIEW_FULL_REPORT: 'VIEW_REPORT',
  COMPLETE_LEVEL_2_PROFILE: 'COMPLETE_STUDENT_PROFILE',
  CREATE_PROFILE: 'CREATE_STUDENT_PROFILE'
})

function selectStudentState(state, requestedStudentId) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new NavigationContractError('服务端没有返回 Education Compass 状态')
  }
  const requested = requestedStudentId === undefined || requestedStudentId === null
    ? ''
    : String(requestedStudentId).trim()
  const students = Array.isArray(state.students) ? state.students : []
  const rootStudentId = firstValue([state], ['studentId', 'student_id'])

  if (requested) {
    const selected = students.find((item) => firstValue([item], ['studentId', 'student_id']) === requested)
    if (selected) return { ...state, ...selected, students, studentId: requested }
    if (rootStudentId === requested) return { ...state, students, studentId: requested }
    throw new NavigationContractError('服务端状态中没有当前 Student ID', { studentId: requested })
  }

  if (rootStudentId) return { ...state, students, studentId: rootStudentId }
  if (students.length) {
    const studentId = firstValue([students[0]], ['studentId', 'student_id'])
    return { ...state, ...students[0], students, studentId }
  }
  return { ...state, students }
}

function linkedStateValue(state, matchNames, matchValue, valueNames) {
  const expected = String(matchValue || '').trim()
  if (!state || typeof state !== 'object' || Array.isArray(state) || !expected) return ''
  const action = state.nextAction || state.next_action
  const candidates = []
  if (action && typeof action === 'object' && !Array.isArray(action)) {
    if (action.target && typeof action.target === 'object' && !Array.isArray(action.target)) candidates.push(action.target)
    candidates.push(action)
  }
  if (Array.isArray(state.students)) candidates.push(...state.students)
  candidates.push(state)
  for (const candidate of candidates) {
    if (firstValue([candidate], matchNames) !== expected) continue
    const value = firstValue([candidate], valueNames)
    if (value) return value
  }
  return ''
}

function assessmentIdForReport(state, reportId) {
  return linkedStateValue(state, ['reportId', 'report_id'], reportId, ['assessmentId', 'assessment_id'])
}

function reportIdForAssessment(state, assessmentId) {
  return linkedStateValue(state, ['assessmentId', 'assessment_id'], assessmentId, ['reportId', 'report_id'])
}

function studentIdForAssessment(state, assessmentId) {
  return linkedStateValue(state, ['assessmentId', 'assessment_id'], assessmentId, ['studentId', 'student_id'])
}

function resolveCompassEntry(state, requestedLevel) {
  const level = Number(requestedLevel) === 2 ? 2 : 1
  const destination = resolveDestination(state)
  const requiredCode = level === 2 ? 'START_LEVEL_2' : 'START_LEVEL_1'
  return {
    level,
    authorized: destination.code === requiredCode,
    requiredCode,
    destination
  }
}

function resolveDestination(state) {
  const action = actionFrom(state)
  const target = action.target && typeof action.target === 'object' ? action.target : {}
  const objects = [target, action, state || {}]
  const rawCode = String(action.code || action.action || action.type || '').toUpperCase()
  const code = ACTION_ALIASES[rawCode] || rawCode
  if (!code) throw new NavigationContractError('服务端 nextAction 缺少 code')

  const studentId = firstValue(objects, ['studentId', 'student_id'])
  const assessmentId = firstValue(objects, ['assessmentId', 'assessment_id'])
  const sourceAssessmentId = firstValue(objects, ['sourceAssessmentId', 'source_assessment_id'])
  const reportId = firstValue(objects, ['reportId', 'report_id'])
  const orderId = firstValue(objects, ['orderId', 'order_id'])

  if (['HOME', 'NO_ACTION', 'DEFERRED', 'NOT_RECOMMENDED'].includes(code)) {
    return { code, method: 'switchTab', url: '/pages/home/index' }
  }
  if (code === 'CREATE_FAMILY_PROFILE') return { code, method: 'navigateTo', url: '/pages/family-edit/index' }
  if (code === 'CREATE_STUDENT_PROFILE') return { code, method: 'navigateTo', url: '/pages/student-edit/index' }
  if (code === 'COMPLETE_STUDENT_PROFILE') {
    return {
      code,
      method: 'navigateTo',
      url: `/pages/student-edit/index${query({ id: requireTarget(studentId, 'studentId', code), next: 'level2', sourceAssessmentId })}`
    }
  }
  if (code === 'START_LEVEL_1') {
    return {
      code,
      method: 'navigateTo',
      url: `/pages/compass/index${query({ level: 1, studentId: requireTarget(studentId, 'studentId', code) })}`
    }
  }
  if (code === 'CONTINUE_LEVEL_1') {
    return {
      code,
      method: 'navigateTo',
      url: `/pages/compass-questionnaire/index${query({
        level: 1,
        studentId: requireTarget(studentId, 'studentId', code),
        assessmentId: requireTarget(assessmentId, 'assessmentId', code)
      })}`
    }
  }
  if (code === 'VIEW_FAMILY_SNAPSHOT') {
    return {
      code,
      method: 'navigateTo',
      url: `/pages/compass-preview/index${query({
        mode: 'family-snapshot', assessmentId: requireTarget(assessmentId, 'assessmentId', code)
      })}`
    }
  }
  if (code === 'START_LEVEL_2') {
    return {
      code,
      method: 'navigateTo',
      url: `/pages/compass/index${query({
        level: 2,
        studentId: requireTarget(studentId, 'studentId', code),
        sourceAssessmentId: requireTarget(sourceAssessmentId || assessmentId, 'sourceAssessmentId', code)
      })}`
    }
  }
  if (code === 'CONTINUE_LEVEL_2') {
    return {
      code,
      method: 'navigateTo',
      url: `/pages/compass-questionnaire/index${query({
        level: 2,
        studentId: requireTarget(studentId, 'studentId', code),
        assessmentId: requireTarget(assessmentId, 'assessmentId', code)
      })}`
    }
  }
  if (code === 'VIEW_LOCKED_RESULT') {
    return {
      code,
      method: 'navigateTo',
      url: `/pages/compass-preview/index${query({
        mode: 'growth-locked', assessmentId: requireTarget(assessmentId, 'assessmentId', code)
      })}`
    }
  }
  if (code === 'CHECK_PAYMENT_STATUS') {
    return {
      code,
      method: 'navigateTo',
      url: `/pages/payment-result/index${query({ orderId: requireTarget(orderId, 'orderId', code), reportId })}`
    }
  }
  if (code === 'VIEW_REPORT') {
    return {
      code,
      method: 'navigateTo',
      url: `/pages/report/index${query({ id: requireTarget(reportId, 'reportId', code) })}`
    }
  }
  throw new NavigationContractError(`不支持的 Education Compass nextAction：${code}`, { code })
}

function resolveReportDestination(report, state = {}) {
  if (!report || typeof report !== 'object') {
    throw new NavigationContractError('报告卡片缺少服务端报告元数据')
  }
  const reportId = firstValue([report], ['id', 'reportId', 'report_id'])
  const assessmentId = firstValue([report, state], ['assessmentId', 'assessment_id'])
  const reportKind = firstValue([report, state], ['reportKind', 'report_kind', 'resultKind', 'result_kind']).toUpperCase()
  const productCode = firstValue([report], ['productCode', 'product_code'])
  const currentReportId = firstValue([state], ['reportId', 'report_id'])
  const sameCurrentReport = !currentReportId || !reportId || currentReportId === reportId
  const orderId = sameCurrentReport ? firstValue([state], ['orderId', 'order_id']) : ''
  const entitled = report.entitled === true

  if (reportKind === 'FAMILY_EDUCATION_SNAPSHOT') {
    return {
      code: 'VIEW_FAMILY_SNAPSHOT', method: 'navigateTo',
      url: `/pages/compass-preview/index${query({ mode: 'family-snapshot', assessmentId: requireTarget(assessmentId, 'assessmentId', 'VIEW_FAMILY_SNAPSHOT') })}`
    }
  }
  if (reportKind === 'STUDENT_GROWTH_DISCOVERY') {
    if (entitled) {
      return {
        code: 'VIEW_REPORT', method: 'navigateTo',
        url: `/pages/report/index${query({ id: requireTarget(reportId, 'reportId', 'VIEW_REPORT') })}`
      }
    }
    if (orderId) {
      return {
        code: 'CHECK_PAYMENT_STATUS', method: 'navigateTo',
        url: `/pages/payment-result/index${query({ orderId, reportId })}`
      }
    }
    return {
      code: 'VIEW_LOCKED_RESULT', method: 'navigateTo',
      url: `/pages/compass-preview/index${query({ mode: 'growth-locked', assessmentId: requireTarget(assessmentId, 'assessmentId', 'VIEW_LOCKED_RESULT') })}`
    }
  }

  // Legacy reports retain their historical entitlement/preview behavior.
  if (entitled || !productCode) {
    return {
      code: 'VIEW_REPORT', method: 'navigateTo',
      url: `/pages/report/index${query({ id: requireTarget(reportId, 'reportId', 'VIEW_REPORT') })}`
    }
  }
  return {
    code: 'VIEW_LEGACY_PREVIEW', method: 'navigateTo',
    url: `/pages/compass-preview/index${query({ assessmentId: requireTarget(assessmentId, 'assessmentId', 'VIEW_LEGACY_PREVIEW') })}`
  }
}

function navigateFromState(state, wxApi) {
  const destination = resolveDestination(state)
  const client = wxApi || (typeof wx !== 'undefined' ? wx : null)
  if (!client || typeof client[destination.method] !== 'function') {
    throw new NavigationContractError(`当前环境不支持 ${destination.method}`, { method: destination.method })
  }
  client[destination.method]({ url: destination.url })
  return destination
}

module.exports = {
  ACTION_ALIASES,
  NavigationContractError,
  assessmentIdForReport,
  navigateFromState,
  reportIdForAssessment,
  resolveCompassEntry,
  resolveDestination,
  resolveReportDestination,
  selectStudentState,
  studentIdForAssessment
}
