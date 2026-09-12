const api = require('./api')
const runtime = require('../config/runtime')
const { repository } = require('./demo-runtime')

const PROFILE_MAP_KEY = 'PFS_REMOTE_PROFILE_MAP_V1'

function profileMap() { return wx.getStorageSync(PROFILE_MAP_KEY) || { families: {}, students: {} } }
function rememberMapping(type, localId, remoteId) {
  if (!localId || !remoteId || localId === remoteId) return
  const map = profileMap()
  const bucket = type === 'family' ? 'families' : 'students'
  map[bucket] = map[bucket] || {}
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

function studentPayload(form) {
  return {
    name: form.name || '', age: form.age || '', gender: form.gender || '', school: form.school || '',
    educationSystem: form.education_system || '', grade: form.grade || '', interest: form.interest || '', goal: form.goal || ''
  }
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
  PROFILE_MAP_KEY, assertRemoteProfiles, createAdvisorRequest, getAdvisorRequests, getFamily,
  getReports, getStudent, getStudents, getTimeline, mappedId, rememberMapping, saveFamily, saveStudent,
  updateAdvisorContactConsent
}
