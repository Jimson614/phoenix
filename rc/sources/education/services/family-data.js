const api = require('./api')
const runtime = require('../config/runtime')
const { repository } = require('./demo-runtime')

const PROFILE_MAP_KEY = 'PFS_REMOTE_PROFILE_MAP_V1'

const EDUCATION_SYSTEM_OPTIONS = Object.freeze([
  Object.freeze({ label: '请选择', value: '' }),
  Object.freeze({ label: '内地课程', value: 'GAOKAO' }),
  Object.freeze({ label: 'DSE', value: 'DSE' }),
  Object.freeze({ label: 'IGCSE', value: 'IGCSE' }),
  Object.freeze({ label: 'IB', value: 'IB' }),
  Object.freeze({ label: 'A-Level', value: 'A_LEVEL' }),
  Object.freeze({ label: 'AP / 美式课程', value: 'AP_US' }),
  Object.freeze({ label: '其他', value: 'OTHER' })
])

const EDUCATION_SYSTEM_ALIASES = Object.freeze({
  GAOKAO: 'GAOKAO',
  '内地课程': 'GAOKAO',
  '内地课程／高考': 'GAOKAO',
  '内地课程/高考': 'GAOKAO',
  '高考': 'GAOKAO',
  DSE: 'DSE',
  IGCSE: 'IGCSE',
  IB: 'IB',
  A_LEVEL: 'A_LEVEL',
  'A-LEVEL': 'A_LEVEL',
  'A LEVEL': 'A_LEVEL',
  AP_US: 'AP_US',
  AP: 'AP_US',
  'AP / 美式课程': 'AP_US',
  'AP／美式课程': 'AP_US',
  '美式课程': 'AP_US',
  OTHER: 'OTHER',
  '其他': 'OTHER',
  '其他体系': 'OTHER'
})

const STUDENT_TEXT_LIMITS = Object.freeze({
  name: 80,
  gender: 30,
  school: 160,
  educationSystem: 80,
  grade: 80,
  interest: 500,
  goal: 500
})

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function idMap(value) {
  return Object.keys(record(value)).reduce((result, key) => {
    const id = record(value)[key]
    if (typeof id === 'string' && id.trim()) result[key] = id
    return result
  }, {})
}

function profileMap() {
  const stored = record(wx.getStorageSync(PROFILE_MAP_KEY))
  return { families: idMap(stored.families), students: idMap(stored.students) }
}
function rememberMapping(type, localId, remoteId) {
  if (!localId || !remoteId || localId === remoteId) return
  const map = profileMap()
  const bucket = type === 'family' ? 'families' : 'students'
  map[bucket][localId] = remoteId
  wx.setStorageSync(PROFILE_MAP_KEY, map)
}
function mappedId(type, localId) {
  const map = profileMap()
  return ((type === 'family' ? map.families : map.students) || {})[localId] || ''
}

function normalizeFamily(family, source) {
  if (!family) return null
  if (source === 'demo') return { ...family, _source: 'demo', _syncStatus: 'local_demo' }
  return {
    id: family.id,
    family_name: family.familyName || '', parent_name: family.parentName || '',
    phone: family.phone || '', location: family.location || '', goal: family.goal || '',
    created_at: family.createdAt || '', updated_at: family.updatedAt || '', _source: 'remote', _syncStatus: 'synced'
  }
}

function normalizeStudent(student, source) {
  if (!student) return null
  if (source === 'demo') return { ...student, student_version: student.updated_at || 'student_profile_v0.1', _source: 'demo', _syncStatus: 'local_demo' }
  return {
    id: student.id, family_id: student.familyId,
    name: student.name || '', age: student.age || '', gender: student.gender || '', school: student.school || '',
    education_system: student.educationSystem || '', grade: student.grade || '', interest: student.interest || '', goal: student.goal || '',
    student_version: student.studentVersion || student.updatedAt || '',
    created_at: student.createdAt || '', updated_at: student.updatedAt || '', _source: 'remote', _syncStatus: 'synced'
  }
}

function familyPayload(form) {
  return {
    familyName: form.family_name || '', parentName: form.parent_name || '', phone: form.phone || '',
    location: form.location || '', goal: form.goal || ''
  }
}

function normalizedStudentText(value, field, label) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') {
    throw new api.ApiError(`${label}格式无效`, { code: 'STUDENT_FIELD_INVALID', statusCode: 400 })
  }
  const normalized = value.trim()
  if (normalized.length > STUDENT_TEXT_LIMITS[field]) {
    throw new api.ApiError(`${label}不能超过${STUDENT_TEXT_LIMITS[field]}个字符`, {
      code: 'STUDENT_FIELD_TOO_LONG', statusCode: 400
    })
  }
  return normalized
}

function normalizeEducationSystem(value) {
  const normalized = normalizedStudentText(value, 'educationSystem', '课程体系')
  if (!normalized) return ''
  return EDUCATION_SYSTEM_ALIASES[normalized] || EDUCATION_SYSTEM_ALIASES[normalized.toUpperCase()] || 'OTHER'
}

function educationSystemLabel(value) {
  const normalized = normalizeEducationSystem(value)
  const option = EDUCATION_SYSTEM_OPTIONS.find((item) => item.value === normalized)
  return option ? option.label : '请选择'
}

function normalizeStudentAge(value) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new api.ApiError('年龄需填写3至100之间的整数', {
      code: 'STUDENT_AGE_INVALID', statusCode: 400
    })
  }
  const normalized = typeof value === 'string' ? value.trim() : value
  if (typeof normalized === 'string' && !/^\d+$/.test(normalized)) {
    throw new api.ApiError('年龄需填写3至100之间的整数', {
      code: 'STUDENT_AGE_INVALID', statusCode: 400
    })
  }
  const age = typeof normalized === 'number' ? normalized : Number(normalized)
  if (!Number.isInteger(age) || age < 3 || age > 100) {
    throw new api.ApiError('年龄需填写3至100之间的整数', {
      code: 'STUDENT_AGE_INVALID', statusCode: 400
    })
  }
  return age
}

function studentPayload(form = {}) {
  return {
    name: normalizedStudentText(form.name, 'name', '姓名'),
    age: normalizeStudentAge(form.age),
    gender: normalizedStudentText(form.gender, 'gender', '性别'),
    school: normalizedStudentText(form.school, 'school', '学校'),
    educationSystem: normalizeEducationSystem(form.education_system === undefined ? form.educationSystem : form.education_system),
    grade: normalizedStudentText(form.grade, 'grade', '年级'),
    interest: normalizedStudentText(form.interest, 'interest', '兴趣'),
    goal: normalizedStudentText(form.goal, 'goal', '未来想法')
  }
}

function validateStudentForm(form = {}) {
  const payload = studentPayload(form)
  if (!payload.name || payload.age === null || !payload.school || !payload.grade) {
    throw new api.ApiError('请填写姓名、年龄、学校和年级', {
      code: 'STUDENT_REQUIRED_FIELDS_MISSING', statusCode: 400
    })
  }
  return payload
}

async function getFamily(userId) {
  if (runtime.isDemo()) return normalizeFamily(repository.familyForUser(userId), 'demo')
  const result = await api.request('/v1/me/family')
  return normalizeFamily(result.family, 'remote')
}

async function saveFamily(userId, form, localId) {
  if (runtime.isDemo()) return normalizeFamily(repository.upsertFamily(userId, form), 'demo')
  const result = await api.request('/v1/me/family', { method: 'PUT', data: familyPayload(form) })
  const family = normalizeFamily(result.family, 'remote')
  rememberMapping('family', localId, family.id)
  return family
}

async function getStudents(familyId) {
  if (runtime.isDemo()) return repository.studentsForFamily(familyId).map((student) => normalizeStudent(student, 'demo'))
  const result = await api.request('/v1/me/students')
  return (result.students || []).map((student) => normalizeStudent(student, 'remote'))
}

async function getStudent(familyId, studentId) {
  if (runtime.isDemo()) {
    const student = repository.getById('students', studentId)
    return student && student.family_id === familyId ? normalizeStudent(student, 'demo') : null
  }
  const result = await api.request(`/v1/me/students/${encodeURIComponent(studentId)}`)
  return normalizeStudent(result.student, 'remote')
}

async function saveStudent(familyId, form, studentId, localId) {
  if (runtime.isDemo()) return normalizeStudent(repository.upsertStudent(familyId, form, studentId), 'demo')
  const result = await api.request(studentId ? `/v1/me/students/${encodeURIComponent(studentId)}` : '/v1/me/students', {
    method: studentId ? 'PUT' : 'POST', data: studentPayload(form)
  })
  const student = normalizeStudent(result.student, 'remote')
  rememberMapping('student', localId, student.id)
  return student
}

async function getReports(familyId) {
  if (runtime.isDemo()) {
    return repository.reportsForFamily(familyId).map((report) => {
      const order = repository.orderForReport(report.id)
      return {
        ...report,
        student_id: report.assessment.student_id,
        assessment_id: report.assessment_id,
        entitled: !report.product_code || !!(order && order.status === 'PAID'),
        preview: report.preview || null,
        status: report.status || 'READY',
        created_at: report.created_at
      }
    })
  }
  const result = await api.request('/v1/me/reports')
  return (result.reports || []).map((report) => ({
    id: report.id, student_id: report.studentId, assessment_id: report.assessmentId,
    status: report.status, preview: report.preview || null, entitled: !!report.entitled,
    report_kind: report.reportKind || '', result_version: report.resultVersion || '',
    product_code: report.productCode || '', delivery_status: report.deliveryStatus || '',
    qa_passed: report.qaPassed === true, created_at: report.createdAt || ''
  }))
}

async function getTimeline(familyId) {
  if (runtime.isDemo()) return repository.eventsForFamily(familyId)
  const result = await api.request('/v1/me/timeline')
  return (result.events || []).map((event) => ({
    id: event.id, event_type: event.eventType, description: event.description,
    date: event.occurredAt, report_id: event.reportId || '', order_id: event.orderId || ''
  }))
}

async function getAdvisorRequests(familyId) {
  if (runtime.isDemo()) return repository.where('advisorRequests', (request) => request.family_id === familyId)
  const result = await api.request('/v1/me/advisor-requests')
  return result.requests || []
}

async function createAdvisorRequest(family, user, form, context = {}) {
  if (runtime.isDemo()) {
    const request = repository.insert('advisorRequests', {
      family_id: family.id, user_id: user.id, topic: form.topic,
      preferred_time: form.preferred_time, note: form.note || '',
      report_id: context.reportId || '', student_id: context.studentId || '',
      intent: context.intent === 'DEEP_ASSESSMENT' ? 'DEEP_ASSESSMENT' : 'GENERAL_ADVISOR',
      status: 'requested', created_at: new Date().toISOString()
    })
    repository.addTimeline(family.id, 'advisor_contact', `已申请顾问沟通：${form.topic}`)
    return request
  }
  const result = await api.request('/v1/advisor-requests', {
    method: 'POST',
    data: {
      preferredTime: form.preferred_time,
      topic: form.topic,
      ...(form.note ? { note: form.note } : {}),
      ...(context.reportId ? { reportId: context.reportId } : {}),
      ...(context.studentId ? { studentId: context.studentId } : {}),
      intent: context.intent === 'DEEP_ASSESSMENT' ? 'DEEP_ASSESSMENT' : 'GENERAL_ADVISOR',
      consent: {
        scope: 'ADVISOR_CONTACT',
        copyVersion: 'advisor_contact_opt_in_v1.0.0-rc1',
        locale: 'zh-CN',
        guardianAuthorityConfirmed: true
      }
    }
  })
  return result.request
}

async function updateAdvisorContactConsent(studentId, enabled) {
  if (runtime.isDemo()) return { scope: 'ADVISOR_CONTACT', enabled: false }
  return api.request('/v1/me/integration-consents/advisor-contact', {
    method: 'PUT',
    data: {
      ...(studentId ? { studentId } : {}),
      enabled: Boolean(enabled),
      copyVersion: 'advisor_contact_opt_in_v1.0.0-rc1',
      locale: 'zh-CN',
      guardianAuthorityConfirmed: true
    }
  })
}

function assertRemoteProfiles(family, student) {
  if (runtime.isDemo()) return { familyId: family.id, studentId: student.id, studentVersion: student.student_version || student.updated_at || 'student_profile_v0.1' }
  const familyId = family && (family._source === 'remote' ? family.id : mappedId('family', family.id))
  const studentId = student && (student._source === 'remote' ? student.id : mappedId('student', student.id))
  if (!familyId || !studentId || !student.student_version) {
    throw new api.ApiError('家庭或孩子档案尚未同步到服务端，请先重新保存档案', { code: 'PROFILE_SYNC_REQUIRED', statusCode: 409 })
  }
  return { familyId, studentId, studentVersion: student.student_version }
}

module.exports = {
  EDUCATION_SYSTEM_OPTIONS, PROFILE_MAP_KEY, assertRemoteProfiles, createAdvisorRequest, educationSystemLabel,
  getAdvisorRequests, getFamily,
  getReports, getStudent, getStudents, getTimeline, mappedId, rememberMapping, saveFamily, saveStudent,
  normalizeEducationSystem, normalizeStudentAge, studentPayload, updateAdvisorContactConsent, validateStudentForm
}
