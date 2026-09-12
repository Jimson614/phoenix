const store = require('./store.cjs')
const { createId } = require('./id.cjs')
const { isoNow } = require('./date.cjs')

const PREFIX = {
  users: 'usr', families: 'fam', students: 'stu', assessments: 'asm', reports: 'rpt',
  timelineEvents: 'evt', advisorNotes: 'note', advisorRequests: 'req', analyticsEvents: 'ana',
  partners: 'par', permissions: 'perm', partnerExplorations: 'pex', partnerApplications: 'pap'
}

function initialize() {
  const database = store.load()
  if (!database.users.some((user) => user.role === 'admin')) {
    database.users.push({
      id: 'usr_phoenix_advisor', wechat_id: 'demo_advisor', name: 'Phoenix 顾问',
      phone: '', role: 'admin', created_at: isoNow()
    })
  }
  store.save(database)
  return database
}

function all(table) { return store.load()[table] || [] }

function getById(table, id) {
  return all(table).find((item) => item.id === id || item.partner_id === id || item.permission_id === id) || null
}

function where(table, predicate) { return all(table).filter(predicate) }

function insert(table, value) {
  const database = store.load()
  const key = table === 'partners' ? 'partner_id' : table === 'permissions' ? 'permission_id' : 'id'
  const item = { ...value }
  if (!item[key]) item[key] = createId(PREFIX[table] || 'row')
  database[table].push(item)
  store.save(database)
  return item
}

function update(table, id, changes) {
  const database = store.load()
  const key = table === 'partners' ? 'partner_id' : table === 'permissions' ? 'permission_id' : 'id'
  const index = database[table].findIndex((item) => item[key] === id)
  if (index < 0) return null
  database[table][index] = { ...database[table][index], ...changes }
  store.save(database)
  return database[table][index]
}

function upsertFamily(userId, form) {
  const existing = where('families', (family) => family.user_id === userId)[0]
  const value = {
    user_id: userId,
    family_name: form.family_name,
    parent_name: form.parent_name,
    phone: form.phone,
    location: form.location,
    goal: form.goal,
    created_at: existing ? existing.created_at : isoNow()
  }
  const family = existing ? update('families', existing.id, value) : insert('families', value)
  update('users', userId, { name: form.parent_name, phone: form.phone })
  if (!existing) addTimeline(family.id, 'family_created', '已建立家庭成长档案')
  return family
}

function upsertStudent(familyId, form, studentId) {
  const existing = studentId ? getById('students', studentId) : null
  const value = { family_id: familyId, ...form }
  const student = existing ? update('students', existing.id, value) : insert('students', value)
  if (!existing) addTimeline(familyId, 'student_created', `已添加孩子档案：${student.name}`)
  return student
}

function addTimeline(familyId, eventType, description) {
  return insert('timelineEvents', {
    family_id: familyId, event_type: eventType, description, date: isoNow()
  })
}

function familyForUser(userId) { return where('families', (family) => family.user_id === userId)[0] || null }
function studentsForFamily(familyId) { return where('students', (student) => student.family_id === familyId) }
function descendingBy(field) {
  return (a, b) => String(b[field] || '').localeCompare(String(a[field] || ''))
}

function eventsForFamily(familyId) {
  return where('timelineEvents', (event) => event.family_id === familyId).sort(descendingBy('date'))
}

function reportsForFamily(familyId) {
  const studentIds = new Set(studentsForFamily(familyId).map((student) => student.id))
  const assessments = where('assessments', (assessment) => studentIds.has(assessment.student_id))
  const assessmentIds = new Set(assessments.map((assessment) => assessment.id))
  return where('reports', (report) => assessmentIds.has(report.assessment_id))
    .sort(descendingBy('created_at'))
    .map((report) => ({ ...report, assessment: assessments.find((assessment) => assessment.id === report.assessment_id) }))
}

function familyOverview(familyId) {
  const family = getById('families', familyId)
  if (!family) return null
  return {
    family,
    students: studentsForFamily(familyId),
    reports: reportsForFamily(familyId),
    events: eventsForFamily(familyId),
    notes: where('advisorNotes', (note) => note.family_id === familyId).sort(descendingBy('created_at')),
    requests: where('advisorRequests', (request) => request.family_id === familyId).sort(descendingBy('created_at'))
  }
}

function resetDemoData() { store.reset(); initialize() }

module.exports = {
  initialize, all, getById, where, insert, update, upsertFamily, upsertStudent,
  addTimeline, familyForUser, studentsForFamily, eventsForFamily, reportsForFamily,
  familyOverview, resetDemoData
}
