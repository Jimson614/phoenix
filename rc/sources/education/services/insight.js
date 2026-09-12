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

function allAnswers(answers, key, fallback) {
  const value = answers[key]
  if (Array.isArray(value)) return value.length ? value : [fallback]
  return value ? [value] : [fallback]
}

function generateCompassReport(student, answers, completenessScore) {
  const growth = generate(student, answers)
  const strengths = allAnswers(answers, 'strengths', '好奇心').map((key) => STRENGTH_LABELS[key] || key)
  const challenges = allAnswers(answers, 'challenges', '目标不清晰')
  const interest = firstAnswer(answers, 'interests', student.interest || '多元兴趣')
  const targetMajor = firstAnswer(answers, 'target_major', firstAnswer(answers, 'future_goal', '继续探索'))
  const targetRegions = allAnswers(answers, 'target_region', '尚未确定').join('、')
  const budget = firstAnswer(answers, 'annual_budget', '暂不确定')
  const dataAsOf = new Date().toISOString().slice(0, 10)
  const modules = [
    {
      key: 'student_profile', title: '学生成长画像', summary: growth.narrative,
      items: [`当前阶段：${growth.currentStage}`, `课程体系：${answers.education_system || student.education_system || '待补充'}`, `学术基线：${answers.academic_summary || '待补充'}`]
    },
    {
      key: 'strengths', title: '优势能力分析', summary: strengths.join('；'),
      items: strengths.concat(challenges.map((item) => `需要关注：${item}`))
    },
    {
      key: 'major_directions', title: '推荐专业方向', summary: `围绕“${targetMajor}”与“${interest}”形成可验证的方向组合。`,
      items: [`方向一：${targetMajor}`, `方向二：${interest}相关的跨学科方向`, '方向三：通过项目体验保留相邻方向的转换空间']
    },
    {
      key: 'university_match', title: '大学匹配', summary: '按冲刺、适配、稳健三层组织；演示模式不提供虚构院校结论。',
      items: [`目标地区：${targetRegions}`, '冲刺层：需结合最新官方招生数据校验', '适配层：需结合课程与成绩基线校验', '稳健层：需先完成资格与预算硬规则校验']
    },
    {
      key: 'routes', title: '主路线与备选路线', summary: '以当前目标为主路线，同时保留可观察、可切换的备选方案。',
      items: [`主路线：${targetRegions} · ${targetMajor}`, `备选意愿：${answers.backup_route_acceptance || '待确认'}`, `预算约束：${budget}`, '转换条件：根据成绩、语言、体验反馈与家庭约束复核']
    },
    {
      key: 'action_plan', title: '未来 6—24 个月行动规划', summary: growth.nextAction,
      items: ['最近 30 天：补齐关键资料并完成一次方向验证', '未来 6 个月：形成学术与活动证据清单', '未来 12 个月：复核目标与备选路线', '未来 24 个月：按官方时间节点完成申请准备']
    }
  ]
  const preview = {
    profileSummary: growth.narrative,
    oneStrength: strengths[0],
    oneRisk: challenges[0],
    routeOverview: `优先比较 ${targetRegions} 的“${targetMajor}”相关路线，并保留备选方案。`,
    tableOfContents: modules.map((item) => item.title),
    dataAsOf,
    disclaimer: '本报告用于支持家庭教育规划，不构成录取承诺，也不替代学校、心理或医疗专业意见。',
    completenessScore,
    confidence: completenessScore >= 90 ? 'high' : completenessScore >= 80 ? 'medium' : 'low'
  }
  return {
    preview,
    full: {
      modules,
      sources: [{ name: '家庭提交资料', dataAsOf }, { name: 'Phoenix 演示规则库（不含实时院校数据）', dataAsOf }],
      dataAsOf,
      versions: { questionnaire: 'education_compass_v1', engine: 'phoenix_rule_engine_v0.2_demo' },
      confidence: preview.confidence,
      disclaimer: preview.disclaimer
    }
  }
}

module.exports = { generate, generateCompassReport }
