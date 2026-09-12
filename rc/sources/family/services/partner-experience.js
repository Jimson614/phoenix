const repository = require('./repository')
const { isoNow } = require('../utils/date')

function buildExplorationResult(answers) {
  const preferenceMap = {
    '演唱': '声音与演唱表达',
    '节奏': '节奏感与身体表达',
    '乐器': '器乐与旋律探索',
    '自己编故事': '故事、作词与原创表达'
  }
  const likesMusic = answers.likes_music === '经常主动参与' || answers.likes_music === '有时会主动参与'
  const preference = preferenceMap[answers.preference] || '多元音乐体验'

  return {
    title: '孩子的音乐探索起点',
    signal: likesMusic
      ? `目前在“${answers.preference}”相关活动中呈现出可继续观察的兴趣信号。`
      : '目前更适合从轻松、无压力的声音游戏开始，观察孩子自然愿意靠近的表达方式。',
    direction: likesMusic
      ? `建议先体验${preference}，同时保留节奏、旋律与潮州文化声音的开放尝试。`
      : '建议从熟悉的生活声音、潮州童谣或简单节奏开始，不预设学习成果。',
    nextStep: `安排一次短时联合体验，重点观察参与感与表达意愿，并围绕“${answers.parent_hope}”记录家庭感受。`,
    disclaimer: '这是基于家庭回答形成的探索建议，不是能力测评、专业评级或天赋结论。'
  }
}

function saveExploration({ familyId, studentId, partnerExperienceId, answers, result }) {
  const record = repository.insert('partnerExplorations', {
    family_id: familyId || '',
    student_id: studentId || '',
    partner_experience_id: partnerExperienceId,
    answers,
    result,
    status: 'saved',
    created_at: isoNow()
  })
  if (familyId) repository.addTimeline(familyId, 'partner_exploration', '已保存“凤城少年启航™”音乐探索起点')
  return record
}

function submitApplication(value) {
  const application = repository.insert('partnerApplications', {
    ...value,
    status: 'requested',
    created_at: isoNow()
  })
  if (value.family_id) repository.addTimeline(value.family_id, 'partner_application', '已申请“凤城少年启航™”联合体验')
  return application
}

module.exports = { buildExplorationResult, saveExploration, submitApplication }
