const assert = require('node:assert/strict')

const memory = new Map()
const navigationCalls = []
const networkRequests = []

global.wx = {
  getStorageSync: (key) => memory.get(key),
  setStorageSync: (key, value) => memory.set(key, value),
  removeStorageSync: (key) => memory.delete(key),
  reLaunch: (options) => navigationCalls.push({ method: 'reLaunch', ...options }),
  redirectTo: (options) => navigationCalls.push({ method: 'redirectTo', ...options }),
  navigateBack: (options = {}) => navigationCalls.push({ method: 'navigateBack', ...options }),
  showToast: () => {},
  pageScrollTo: () => {},
  request(options) {
    networkRequests.push(options)
    if (options.url.endsWith('/v1/demo/sessions')) {
      options.success({
        statusCode: 201,
        data: {
          token: 'synthetic-page-session',
          expiresAt: '2099-01-01T00:00:00.000Z',
          authMode: 'local_demo'
        }
      })
      return
    }
    options.success({
      statusCode: 201,
      data: {
        status: 'synced',
        submissionId: 'qsub_page_fixture',
        receivedAt: '2026-08-17T08:00:00.000Z'
      }
    })
  }
}

const repository = require('../services/repository')
const { isoNow } = require('../utils/date')
const { OUTBOX_KEY, RECEIPTS_KEY } = require('../services/questionnaire-sync')

repository.initialize()
const familyUser = repository.insert('users', {
  wechat_id: 'page_sync_fixture',
  name: 'Synthetic Parent',
  phone: '',
  role: 'family_user',
  created_at: isoNow()
})
const family = repository.upsertFamily(familyUser.id, {
  family_name: 'Synthetic Family',
  parent_name: 'Synthetic Parent',
  phone: '00000000000',
  location: 'Fixture City',
  goal: 'Fixture Goal'
})
const student = repository.upsertStudent(family.id, {
  name: 'Synthetic Child',
  age: '12',
  gender: '',
  school: 'Fixture School',
  education_system: '',
  grade: 'Grade 6',
  interest: '',
  goal: ''
})

global.getApp = () => ({ getCurrentUser: () => repository.getById('users', familyUser.id) })

function loadPage(modulePath) {
  let definition = null
  global.Page = (value) => { definition = value }
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(changes) { Object.assign(this.data, changes) }
  }
}

const ANSWERS = {
  school_stage: '小学',
  learning_feeling: '基本稳定',
  strengths: ['好奇心'],
  interests: 'synthetic-page-interest',
  challenges: ['时间管理'],
  parent_observation: 'synthetic-page-observation',
  parent_expectation: '身心健康',
  future_goal: 'synthetic-page-goal',
  support_need: ['学习计划'],
  available_time: '每周一次'
}

async function run() {
  const compass = loadPage('../pages/compass-questionnaire/index')
  compass.onLoad.call(compass, { studentId: student.id })
  compass.data.steps.forEach((step) => {
    step.questions.forEach((question) => { question.value = ANSWERS[question.key] })
  })
  compass.submit.call(compass)

  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert(navigationCalls.some((call) => call.method === 'redirectTo' && call.url.includes('/pages/report/index')))
  const submissionRequest = networkRequests.find((request) => request.url.endsWith('/v1/questionnaire-submissions'))
  assert.ok(submissionRequest)
  assert.equal(submissionRequest.data.familyId, family.id)
  assert.equal(submissionRequest.data.studentId, student.id)
  assert.deepEqual(submissionRequest.data.answers, ANSWERS)
  assert.equal(Object.hasOwn(submissionRequest.data, 'userId'), false)
  assert.equal(Object.hasOwn(submissionRequest.data, 'parentName'), false)
  assert.equal(Object.hasOwn(submissionRequest.data, 'phone'), false)
  assert.equal(Object.hasOwn(submissionRequest.data, 'report'), false)
  const storedAssessment = repository.getById('assessments', submissionRequest.data.clientSubmissionId)
  assert.equal(storedAssessment.sync_requested_at, storedAssessment.created_at)
  assert.equal((memory.get(OUTBOX_KEY) || []).length, 0)
  assert.equal((memory.get(RECEIPTS_KEY) || []).length, 1)

  console.log('✓ questionnaire page sync: local completion queues and sends only the minimized payload')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
