const assert = require('assert')

const memory = new Map()
const navigationCalls = []
const toasts = []

global.wx = {
  getStorageSync: (key) => memory.get(key),
  setStorageSync: (key, value) => memory.set(key, value),
  removeStorageSync: (key) => memory.delete(key),
  login: ({ success }) => success({ code: 'demo-code' }),
  reLaunch: (options) => navigationCalls.push({ method: 'reLaunch', ...options }),
  redirectTo: (options) => navigationCalls.push({ method: 'redirectTo', ...options }),
  navigateTo: (options) => navigationCalls.push({ method: 'navigateTo', ...options }),
  navigateBack: (options) => navigationCalls.push({ method: 'navigateBack', ...options }),
  switchTab: (options) => navigationCalls.push({ method: 'switchTab', ...options }),
  showToast: (options) => toasts.push(options),
  getWindowInfo: () => ({ statusBarHeight: 47, windowWidth: 375, platform: 'ios' }),
  getMenuButtonBoundingClientRect: () => ({ top: 53, left: 278, width: 87, height: 32 })
}

let app = null
global.App = (definition) => { app = definition }
require('../app')
app.globalData = { ...app.globalData }
app.onLaunch.call(app)
global.getApp = () => app

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
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(changes) {
      Object.entries(changes).forEach(([path, value]) => setByPath(this.data, path, value))
    }
  }
  return page
}

const originalSetTimeout = global.setTimeout
global.setTimeout = (callback) => { callback(); return 0 }

async function run() {
  const welcome = loadPage('../pages/welcome/index')
  await welcome.start.call(welcome)
  assert(navigationCalls.some((call) => call.method === 'reLaunch' && call.url === '/pages/home/index'), 'login should enter Home')
  const user = app.getCurrentUser.call(app)
  assert(user && user.role === 'family_user', 'login should establish the family user session')

  navigationCalls.length = 0
  const familyPage = loadPage('../pages/family-edit/index')
  familyPage.onLoad.call(familyPage)
  familyPage.data.form = {
    family_name: '测试家庭', parent_name: '测试家长', phone: '13800000000',
    location: '深圳', goal: '形成稳定的成长记录'
  }
  familyPage.save.call(familyPage)
  const familyRoute = navigationCalls.find((call) => call.method === 'redirectTo' && call.url.startsWith('/pages/student-edit/index?familyId='))
  assert(familyRoute, 'new Family Profile should continue to Child Profile')

  const repository = require('../services/repository')
  const family = repository.familyForUser(user.id)
  assert(family && family.family_name === '测试家庭')

  navigationCalls.length = 0
  const studentPage = loadPage('../pages/student-edit/index')
  studentPage.onLoad.call(studentPage, { familyId: family.id })
  studentPage.data.form = {
    name: '测试孩子', age: '12', gender: '', school: '测试学校',
    education_system: '', grade: '六年级', interest: '音乐与搭建', goal: '继续探索'
  }
  studentPage.save.call(studentPage)
  const compassRoute = navigationCalls.find((call) => call.method === 'redirectTo' && call.url.startsWith('/pages/compass/index?studentId='))
  assert(compassRoute, 'new Child Profile should continue to Education Compass')

  const student = repository.studentsForFamily(family.id)[0]
  assert(student && compassRoute.url.endsWith(student.id))

  navigationCalls.length = 0
  const compassPage = loadPage('../pages/compass/index')
  compassPage.onLoad.call(compassPage, { studentId: student.id })
  assert.strictEqual(compassPage.data.student.id, student.id, 'Compass should load the selected child')
  compassPage.start.call(compassPage)
  assert(navigationCalls.some((call) => call.method === 'navigateTo' && call.url === `/pages/compass-questionnaire/index?studentId=${student.id}`), 'Compass entry should open the questionnaire')

  app.globalData.currentUserId = ''
  app.onLaunch.call(app)
  assert.strictEqual(app.globalData.currentUserId, user.id, 'session identity should survive an application restart')
  assert.strictEqual(repository.familyForUser(user.id).id, family.id, 'Family Profile should survive an application restart')

  navigationCalls.length = 0
  const invalidStudentPage = loadPage('../pages/student-edit/index')
  invalidStudentPage.onLoad.call(invalidStudentPage, { id: 'stu_missing' })
  assert(toasts.some((toast) => toast.title === '孩子档案不存在'))
  assert(navigationCalls.some((call) => call.method === 'navigateBack'), 'invalid Child Profile should use safe back navigation')

  console.log('✓ user entry flow: WeChat login → Family Profile → Child Profile → Education Compass')
  console.log('✓ user entry persistence: session and family data survive application restart')
  console.log('✓ user entry guards: invalid Child Profile does not become an unintended new record')
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => { global.setTimeout = originalSetTimeout })
