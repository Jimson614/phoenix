const assert = require('assert')

const memory = new Map()
global.wx = {
  getStorageSync: (key) => memory.get(key),
  setStorageSync: (key, value) => memory.set(key, value),
  removeStorageSync: (key) => memory.delete(key)
}

const repository = require('../services/repository')
const aiProvider = require('../services/ai-provider')
const analytics = require('../services/analytics')
const { isoNow } = require('../utils/date')

repository.initialize()
assert(repository.getById('users', 'usr_phoenix_advisor'), 'admin seed should exist')
assert.deepStrictEqual(repository.all('partners'), [], 'partner placeholder must remain empty')
assert.deepStrictEqual(repository.all('permissions'), [], 'permission placeholder must remain empty')

const user = repository.insert('users', {
  wechat_id: 'test_openid', name: '王女士', phone: '13800000000', role: 'family_user', created_at: isoNow()
})
const family = repository.upsertFamily(user.id, {
  family_name: '王女士家庭', parent_name: '王女士', phone: '13800000000', location: '深圳 / 香港',
  goal: '帮助孩子找到适合的方向'
})
assert.strictEqual(repository.familyForUser(user.id).id, family.id)

const student = repository.upsertStudent(family.id, {
  name: '小明', age: '16', gender: '男', school: '示例学校', education_system: 'A-Level', grade: 'Year 11',
  interest: '机器人与音乐', goal: '探索工程方向'
})
assert.strictEqual(repository.studentsForFamily(family.id).length, 1)

const answers = {
  school_stage: '高中', learning_feeling: '有些迷茫', strengths: ['逻辑力', '创造力'], interests: '机器人与音乐',
  challenges: ['目标不清晰'], parent_observation: '选科时容易摇摆', parent_expectation: '独立选择',
  future_goal: '工程方向', support_need: ['方向梳理', '项目体验'], available_time: '每周一次'
}
const assessment = repository.insert('assessments', {
  student_id: student.id, type: 'education', answers, status: 'completed', created_at: isoNow()
})
const generated = aiProvider.generateGrowthInsight(student, answers)
assert.strictEqual(generated.currentStage, '升学选择与专业探索期')
assert(generated.suggestedDirection.includes('机器人与音乐'))

const report = repository.insert('reports', {
  assessment_id: assessment.id,
  summary: { currentStage: generated.currentStage, strength: generated.strength, potentialChallenge: generated.potentialChallenge, narrative: generated.narrative },
  recommendation: { suggestedDirection: generated.suggestedDirection, nextAction: generated.nextAction, engine: generated.engine },
  created_at: isoNow()
})
repository.addTimeline(family.id, 'compass_completed', '已完成 Education Compass')
repository.addTimeline(family.id, 'report_generated', '已生成成长洞察报告')

const overview = repository.familyOverview(family.id)
assert.strictEqual(overview.reports[0].id, report.id)
assert(overview.events.length >= 4, 'family relationship history should contain profile and compass events')
assert.strictEqual(overview.reports[0].assessment.type, 'education')

repository.insert('advisorNotes', {
  family_id: family.id, advisor_id: 'usr_phoenix_advisor', note: '建议先安排一次项目体验',
  follow_up_status: '跟进中', created_at: isoNow()
})
assert.strictEqual(repository.familyOverview(family.id).notes[0].follow_up_status, '跟进中')

analytics.track('family_profile_completed', { userId: user.id, familyId: family.id })
analytics.trackSession(user.id)
assert(repository.where('analyticsEvents', (event) => event.user_id === user.id).length >= 2)

wx.getWindowInfo = () => ({ statusBarHeight: 47, windowWidth: 430, platform: 'ios' })
wx.getMenuButtonBoundingClientRect = () => ({ top: 53, left: 335, width: 87, height: 32 })
const { getNavigationMetrics } = require('../utils/navigation')
assert.deepStrictEqual(getNavigationMetrics(), {
  statusBarHeight: 47,
  navigationBarHeight: 44,
  menuButtonSafeWidth: 103,
  compactHeader: false
})

wx.getWindowInfo = () => ({ safeArea: { top: 54 }, windowWidth: 320, platform: 'android' })
wx.getMenuButtonBoundingClientRect = () => ({ top: 58, left: 225, width: 87, height: 32 })
assert.deepStrictEqual(getNavigationMetrics(), {
  statusBarHeight: 54,
  navigationBarHeight: 48,
  menuButtonSafeWidth: 103,
  compactHeader: true
})

wx.getWindowInfo = () => ({ statusBarHeight: 24, windowWidth: 375, platform: 'android' })
wx.getMenuButtonBoundingClientRect = () => ({ top: 28, width: 87, height: 32 })
assert.deepStrictEqual(getNavigationMetrics(), {
  statusBarHeight: 24,
  navigationBarHeight: 48,
  menuButtonSafeWidth: 16,
  compactHeader: false
})

console.log('✓ domain flow: family → student → compass → report → timeline → advisor')
console.log('✓ future models: Partner and Permission remain architecture-only')
console.log('✓ success metrics: activation, compass, relationship and return-session events')
console.log('✓ custom navigation: status bar and WeChat capsule safe areas calculated')
