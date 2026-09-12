const assert = require('assert')

const memory = new Map()
const navigationCalls = []
global.wx = {
  getStorageSync: (key) => memory.get(key),
  setStorageSync: (key, value) => memory.set(key, value),
  removeStorageSync: (key) => memory.delete(key),
  reLaunch: (options) => navigationCalls.push({ method: 'reLaunch', ...options }),
  switchTab: (options) => navigationCalls.push({ method: 'switchTab', ...options }),
  navigateBack: (options = {}) => navigationCalls.push({ method: 'navigateBack', ...options }),
  showToast: () => {}
}

const store = require('../services/store')
const repository = require('../services/repository')
const { isoNow } = require('../utils/date')

memory.set(store.STORAGE_KEY, {
  schemaVersion: '0.0.9',
  users: [{ id: 'usr_legacy', wechat_id: 'legacy', name: '旧用户', phone: '', role: 'family_user', created_at: isoNow() }],
  families: [{ id: 'fam_legacy', user_id: 'usr_legacy', family_name: '原有家庭', created_at: isoNow() }],
  futureField: { preserved: true }
})
repository.initialize()

const normalized = memory.get(store.STORAGE_KEY)
assert.strictEqual(normalized.schemaVersion, '0.1.0', 'older local data should be normalized to the current schema')
assert.strictEqual(normalized.families[0].family_name, '原有家庭', 'schema normalization must preserve family records')
assert.deepStrictEqual(normalized.futureField, { preserved: true }, 'unknown fields must remain recoverable')
assert(Array.isArray(normalized.reports), 'missing current tables should be added without deleting existing records')

let currentUserId = 'usr_legacy'
global.getApp = () => ({ getCurrentUser: () => repository.getById('users', currentUserId) })

let pageDefinition = null
global.Page = (definition) => { pageDefinition = definition }
require('../pages/report/index')

function createPage() {
  const page = {
    ...pageDefinition,
    data: JSON.parse(JSON.stringify(pageDefinition.data)),
    setData(changes) { Object.assign(this.data, changes) }
  }
  return page
}

const missingPage = createPage()
assert.doesNotThrow(() => missingPage.onLoad({ id: 'rpt_missing' }))
assert(missingPage.data.errorMessage.includes('不存在'), 'missing report should render a recoverable error state')

const brokenReport = repository.insert('reports', {
  assessment_id: 'asm_missing', summary: {}, recommendation: {}, created_at: isoNow()
})
const brokenPage = createPage()
assert.doesNotThrow(() => brokenPage.onLoad({ id: brokenReport.id }))
assert(brokenPage.data.errorMessage.includes('数据关联不完整'), 'broken report relationship should not throw')

const student = repository.insert('students', { family_id: 'fam_legacy', name: '孩子' })
const assessment = repository.insert('assessments', {
  student_id: student.id, type: 'education', answers: {}, status: 'completed', created_at: isoNow()
})
const validReport = repository.insert('reports', {
  assessment_id: assessment.id,
  summary: { narrative: '稳定洞察', currentStage: '探索期', strength: '好奇心', potentialChallenge: '目标不清晰' },
  recommendation: { suggestedDirection: '继续观察', nextAction: '完成一次小项目', engine: 'phoenix_rule_engine_v0.1' },
  created_at: isoNow()
})
const validPage = createPage()
validPage.onLoad({ id: validReport.id })
assert.strictEqual(validPage.data.report.id, validReport.id, 'valid report should continue to load')
assert.strictEqual(validPage.data.errorMessage, '')

const otherUser = repository.insert('users', {
  wechat_id: 'other', name: '其他用户', phone: '', role: 'family_user', created_at: isoNow()
})
const otherFamily = repository.insert('families', {
  user_id: otherUser.id, family_name: '其他家庭', created_at: isoNow()
})
const otherStudent = repository.insert('students', { family_id: otherFamily.id, name: '其他孩子' })
const otherAssessment = repository.insert('assessments', {
  student_id: otherStudent.id, type: 'education', answers: {}, status: 'completed', created_at: isoNow()
})
const otherReport = repository.insert('reports', {
  assessment_id: otherAssessment.id,
  summary: { narrative: '不可见', currentStage: '', strength: '', potentialChallenge: '' },
  recommendation: { suggestedDirection: '', nextAction: '', engine: 'phoenix_rule_engine_v0.1' },
  created_at: isoNow()
})
navigationCalls.length = 0
const unauthorizedPage = createPage()
unauthorizedPage.onLoad({ id: otherReport.id })
assert(navigationCalls.some((call) => call.method === 'reLaunch' && call.url === '/pages/home/index'), 'cross-family report access must return home')
assert.strictEqual(unauthorizedPage.data.report, null)

console.log('✓ Sprint 1 data safety: legacy records preserved during schema normalization')
console.log('✓ Sprint 1 report loading: missing relationships fail safely and ownership is enforced')
