const assert = require('assert')

const memory = new Map()
global.wx = {
  getStorageSync: (key) => memory.get(key),
  setStorageSync: (key, value) => memory.set(key, value)
}

const repository = require('../services/repository')
const partnerService = require('../services/partner-experience')
const { experiences, getPartnerExperience } = require('../data/partner-experiences')

repository.initialize()
const experience = getPartnerExperience('yuanchao')
assert(experience, 'Yuanchao Partner Experience configuration must exist')
assert.strictEqual(experiences.length, 1, 'V0.1 should contain one Partner Experience configuration')
assert.strictEqual(experience.theme, 'music')
assert.strictEqual(experience.status, 'preview')
assert.strictEqual(experience.capabilityCards.length, 3)
assert.strictEqual(experience.journeySteps.length, 5)
assert.strictEqual(experience.outcomes.length, 4)

const answers = {
  age_stage: '10–12 岁',
  likes_music: '有时会主动参与',
  preference: '自己编故事',
  parent_hope: '完成一件原创作品'
}
const result = partnerService.buildExplorationResult(answers)
assert(result.signal.includes('可继续观察'), 'result should remain observational')
assert(result.direction.includes('原创表达'))
assert(result.disclaimer.includes('不是能力测评'))
assert(!JSON.stringify(result).includes('评分'), 'result must not invent a score')

const family = repository.insert('families', { user_id: 'usr_test', family_name: '测试家庭' })
const exploration = partnerService.saveExploration({ familyId: family.id, studentId: '', partnerExperienceId: experience.id, answers, result })
assert.strictEqual(exploration.status, 'saved')
assert(repository.eventsForFamily(family.id).some((event) => event.event_type === 'partner_exploration'))

const application = partnerService.submitApplication({
  family_id: family.id, user_id: 'usr_test', partner_experience_id: experience.id,
  child_name: '孩子', age_stage: '10–12 岁', parent_name: '家长', contact: 'demo-contact',
  music_interest: '喜欢编故事', preferred_direction: '故事、作词与原创表达', privacy_consent: true
})
assert.strictEqual(application.status, 'requested')
assert.strictEqual(application.privacy_consent, true)
assert(repository.eventsForFamily(family.id).some((event) => event.event_type === 'partner_application'))

console.log('✓ partner experience: configuration → exploration result → family archive → application')
console.log('✓ exploration language remains observational, without scores or diagnostic conclusions')
