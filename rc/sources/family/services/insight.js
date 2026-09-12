const STAGE_GUIDANCE = {
  '小学': '兴趣唤醒与学习习惯建立期',
  '初中': '能力分化与方向探索期',
  '高中': '升学选择与专业探索期',
  '大学': '专业深化与生涯连接期',
  '其他': '个性化成长探索期'
}

const STRENGTH_LABELS = {
  '好奇心': '对新事物保持主动探索', '表达力': '善于表达观点与感受', '逻辑力': '能够分析问题与建立关联',
  '创造力': '拥有较强的想象与创意倾向', '专注力': '能够在感兴趣的任务中持续投入', '同理心': '能够感知并理解他人的需要'
}

const CHALLENGE_GUIDANCE = {
  '目标不清晰': '先用低成本体验拓宽认知，再逐步缩小方向范围',
  '学习动力不足': '将长期目标拆成可见的小成果，建立每周正反馈',
  '时间管理': '用固定学习区块替代临时安排，并保留恢复时间',
  '亲子沟通': '先讨论孩子的真实感受，再讨论解决方案与结果',
  '升学选择': '把能力、兴趣和路径成本放在同一张决策图中比较',
  '压力焦虑': '降低一次决定的压力，以阶段性试验代替过早定型'
}

function firstAnswer(answers, key, fallback) {
  const value = answers[key]
  if (Array.isArray(value)) return value[0] || fallback
  return value || fallback
}

function generate(student, answers) {
  const schoolStage = firstAnswer(answers, 'school_stage', '其他')
  const strengthKey = firstAnswer(answers, 'strengths', '好奇心')
  const challengeKey = firstAnswer(answers, 'challenges', '目标不清晰')
  const interest = firstAnswer(answers, 'interests', student.interest || '多元兴趣')
  const futureGoal = firstAnswer(answers, 'future_goal', student.goal || '逐步形成清晰方向')
  const support = Array.isArray(answers.support_need) ? answers.support_need.join('、') : (answers.support_need || '阶段规划')

  return {
    currentStage: STAGE_GUIDANCE[schoolStage] || STAGE_GUIDANCE['其他'],
    strength: STRENGTH_LABELS[strengthKey] || `在${strengthKey}方面表现出积极倾向`,
    potentialChallenge: challengeKey,
    suggestedDirection: `围绕“${interest}”设计 1—2 个可验证的小项目，同时保留与“${futureGoal}”连接的可能性。`,
    nextAction: `${CHALLENGE_GUIDANCE[challengeKey] || CHALLENGE_GUIDANCE['目标不清晰']}。建议未来 30 天优先获得${support}支持。`,
    narrative: `${student.name}目前处于${STAGE_GUIDANCE[schoolStage] || STAGE_GUIDANCE['其他']}。现阶段不必急于给出唯一答案，更重要的是把兴趣转化为可观察的行动，让家庭能够基于真实反馈继续规划。`,
    engine: 'phoenix_rule_engine_v0.1'
  }
}

module.exports = { generate }
