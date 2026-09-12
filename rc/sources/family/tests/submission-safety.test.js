const assert = require('assert')

const memory = new Map()
const navigationCalls = []
const toasts = []
let failWrites = false

global.wx = {
  getStorageSync: (key) => memory.get(key),
  setStorageSync: (key, value) => {
    if (failWrites) throw new Error('storage unavailable')
    memory.set(key, value)
  },
  removeStorageSync: (key) => memory.delete(key),
  reLaunch: (options) => navigationCalls.push({ method: 'reLaunch', ...options }),
  redirectTo: (options) => navigationCalls.push({ method: 'redirectTo', ...options }),
  navigateBack: (options = {}) => navigationCalls.push({ method: 'navigateBack', ...options }),
  showToast: (options) => toasts.push(options),
  pageScrollTo: () => {}
}

const repository = require('../services/repository')
const { isoNow } = require('../utils/date')
repository.initialize()

const familyUser = repository.insert('users', {
  wechat_id: 'submission_test', name: 'Test Parent', phone: '', role: 'family_user', created_at: isoNow()
})
const family = repository.upsertFamily(familyUser.id, {
  family_name: 'Test Family', parent_name: 'Test Parent', phone: '13800000000', location: '', goal: ''
})
const student = repository.upsertStudent(family.id, {
  name: 'Test Child', age: '12', gender: '', school: 'Test School',
  education_system: '', grade: 'Grade 6', interest: '', goal: ''
})

let currentUserId = familyUser.id
global.getApp = () => ({ getCurrentUser: () => repository.getById('users', currentUserId) })

function setByPath(target, path, value) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part]) cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage(modulePath) {
  let definition = null
  global.Page = (value) => { definition = value }
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(changes) {
      Object.entries(changes).forEach(([path, value]) => setByPath(this.data, path, value))
    }
  }
}

const compass = loadPage('../pages/compass-questionnaire/index')
compass.onLoad.call(compass, { studentId: student.id })
failWrites = true
compass.submit.call(compass)
assert.strictEqual(compass.data.submitting, false, 'Compass must reset submitting after a storage failure')
assert(toasts.some((toast) => toast.title === '生成失败，请稍后重试'))
assert(!navigationCalls.some((call) => call.method === 'redirectTo'), 'failed Compass submission must not report success')

failWrites = false
toasts.length = 0
const advisor = loadPage('../pages/advisor-request/index')
advisor.onLoad.call(advisor)
advisor.data.form = { topic: 'Compass review', preferred_time: 'Weekend', note: '' }
failWrites = true
advisor.submit.call(advisor)
assert.strictEqual(advisor.data.submitting, false, 'Advisor Request must reset submitting after a storage failure')
assert.strictEqual(advisor.data.submitted, false, 'failed Advisor Request must not display success')
assert(toasts.some((toast) => toast.title === '提交失败，请稍后重试'))

failWrites = false
toasts.length = 0
currentUserId = 'usr_phoenix_advisor'
const adminFamily = loadPage('../pages/admin-family/index')
adminFamily.onLoad.call(adminFamily, { id: family.id })
adminFamily.data.note = 'Follow-up note'
failWrites = true
adminFamily.addNote.call(adminFamily)
assert.strictEqual(adminFamily.data.saving, false, 'Advisor Note must reset saving after a storage failure')
assert(toasts.some((toast) => toast.title === '保存失败，请稍后重试'))

failWrites = false
navigationCalls.length = 0
currentUserId = ''
compass.submit.call(compass)
assert(navigationCalls.some((call) => call.method === 'reLaunch' && call.url === '/pages/welcome/index'), 'expired Compass session must return to Welcome')

console.log('✓ critical submissions: session and ownership are rechecked before writes')
console.log('✓ critical submissions: storage failures reset loading state and show retryable errors')
