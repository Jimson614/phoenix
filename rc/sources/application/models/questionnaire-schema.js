const { QUESTIONNAIRE_VERSION, COMPLETENESS_THRESHOLD } = require('../config/compass')

function question(key, label, type, weight, options, config = {}) {
  return {
    key, label, type, weight,
    required: !!config.required,
    placeholder: config.placeholder || '',
    options: options || []
  }
}

const STEPS = [
  {
    key: 'identity', title: '身份与阶段', hint: '先确认适用的升学规则与规划时间。',
    questions: [
      question('identity_type', '孩子目前的身份类型', 'single', 6, ['香港永久居民', '香港非永久居民 / 受养人', '内地学生', '其他'], { required: true }),
      question('school_stage', '孩子目前处于哪个学习阶段？', 'single', 4, ['小学', '初中', '高中', '大学', '其他'], { required: true }),
      question('education_system', '目前课程体系', 'single', 4, ['内地课程', 'DSE', 'IB', 'A-Level', 'AP / 美式课程', '其他'], { required: true }),
      question('target_enrollment_year', '预计进入下一教育阶段的时间', 'single', 6, ['1 年内', '2—3 年', '4 年以上', '尚未确定'])
    ]
  },
  {
    key: 'academics', title: '学术基础', hint: '真实基线用于资格校验，不用于给孩子贴标签。',
    questions: [
      question('academic_summary', '最近成绩或学术表现概况', 'text', 12, null, { required: true, placeholder: '可填写主要科目、预测分、排名区间或最近一次成绩' }),
      question('language_level', '当前语言能力或考试情况', 'text', 5, null, { placeholder: '例如：雅思、托福、英语校内成绩，尚未考试也可说明' }),
      question('strongest_subjects', '相对擅长或更有把握的科目', 'text', 5, null, { placeholder: '请列出 1—3 门，并尽量说明依据' }),
      question('learning_feeling', '最近的学习状态更接近？', 'single', 3, ['主动投入', '基本稳定', '有些迷茫', '压力较大'])
    ]
  },
  {
    key: 'strengths', title: '兴趣与优势', hint: '选择真实观察到的特点，并补充可以验证的例子。',
    questions: [
      question('strengths', '孩子目前较明显的优势（可多选）', 'multi', 6, ['好奇心', '表达力', '逻辑力', '创造力', '专注力', '同理心']),
      question('interests', '最近愿意主动投入时间的事情', 'text', 6, null, { placeholder: '课程、运动、音乐、阅读、游戏或任何真实兴趣' }),
      question('strength_evidence', '一个能体现优势或兴趣的具体例子', 'text', 3, null, { placeholder: '例如：主动完成过什么项目、作品或长期练习' })
    ]
  },
  {
    key: 'goals', title: '目标与挑战', hint: '把期待和现实问题放在一起，避免只看单一分数。',
    questions: [
      question('challenges', '家庭目前最想解决的问题（可多选）', 'multi', 4, ['目标不清晰', '学习动力不足', '时间管理', '亲子沟通', '升学选择', '压力焦虑']),
      question('parent_observation', '最近一件让你担心或困惑的事', 'text', 3, null, { placeholder: '请用一件具体的小事来描述' }),
      question('parent_expectation', '家长最看重的成长结果', 'single', 3, ['身心健康', '保持热爱', '学术成长', '独立选择', '综合发展']),
      question('future_goal', '孩子或家庭正在考虑的未来方向', 'text', 5, null, { placeholder: '例如：工程、艺术、国际升学，或仍在探索' })
    ]
  },
  {
    key: 'routes', title: '目标与路线', hint: '目标可以暂时不唯一，但需要明确比较范围。',
    questions: [
      question('target_region', '优先考虑的升学地区（可多选）', 'multi', 5, ['香港', '中国内地', '英国', '美国', '加拿大', '澳大利亚', '其他 / 未确定'], { required: true }),
      question('target_major', '感兴趣的专业方向', 'text', 5, null, { placeholder: '可填写 1—3 个方向，未确定请写“探索中”' }),
      question('route_preference', '当前更倾向的路线', 'single', 3, ['学术升学', '应用 / 职业方向', '艺术 / 体育方向', '跨学科探索', '尚未确定']),
      question('backup_route_acceptance', '是否愿意同时规划备选路线？', 'single', 2, ['愿意', '需要了解后决定', '暂不考虑'])
    ]
  },
  {
    key: 'constraints', title: '家庭约束与行动', hint: '把预算和时间写进方案，建议才真正可执行。',
    questions: [
      question('annual_budget', '家庭可接受的年度教育预算', 'single', 4, ['10 万元以内', '10—25 万元', '25—50 万元', '50 万元以上', '暂不确定'], { required: true }),
      question('available_time', '家庭愿意投入的行动节奏', 'single', 2, ['每周一次', '每两周一次', '每月一次', '先获得建议再决定']),
      question('support_need', '未来 30 天最需要的支持（可多选）', 'multi', 3, ['方向梳理', '选科建议', '项目体验', '学习计划', '亲子沟通', '顾问解读']),
      question('location_preference', '城市、通勤或住宿方面的限制（选填）', 'text', 1, null, { placeholder: '例如：优先大湾区、暂不考虑寄宿等' })
    ]
  }
]

// WeChat Mini Program's CommonJS loader only loads JavaScript modules. Requiring
// questionnaire-contract.json works in Node.js, but is resolved as a missing
// `questionnaire-contract.json.js` module in the Mini Program runtime. Derive
// the client contract from the same question definitions and keep the JSON file
// only as the cross-layer contract checked by tests and the server.
const SCHEMA_CONTRACT = {
  version: QUESTIONNAIRE_VERSION,
  completenessThreshold: COMPLETENESS_THRESHOLD,
  fields: STEPS.reduce((fields, step) => fields.concat(step.questions.map((item) => ({
    key: item.key,
    type: item.type,
    weight: item.weight
  }))), [])
}

function isAnswered(value) {
  if (Array.isArray(value)) return value.length > 0
  return value !== undefined && value !== null && String(value).trim().length > 0
}

function allQuestions() { return STEPS.reduce((result, step) => result.concat(step.questions), []) }

function completeness(answers = {}) {
  const questions = allQuestions()
  const earned = questions.reduce((sum, item) => sum + (isAnswered(answers[item.key]) ? item.weight : 0), 0)
  const total = questions.reduce((sum, item) => sum + item.weight, 0)
  const score = Math.round((earned / total) * 100)
  const missing = questions.filter((item) => !isAnswered(answers[item.key])).sort((a, b) => b.weight - a.weight)
  return {
    score,
    threshold: COMPLETENESS_THRESHOLD,
    eligible: score >= COMPLETENESS_THRESHOLD,
    missingFields: missing.map((item) => item.key),
    missingLabels: missing.map((item) => item.label)
  }
}

function stepIsValid(step, answers = {}) {
  return step.questions.filter((item) => item.required).every((item) => isAnswered(answers[item.key]))
}

function viewSteps(answers = {}) {
  return STEPS.map((step) => ({
    ...step,
    questions: step.questions.map((item) => ({
      ...item,
      value: item.type === 'multi' ? (Array.isArray(answers[item.key]) ? answers[item.key] : []) : (answers[item.key] || ''),
      options: (item.options || []).map((text) => ({
        text,
        selected: item.type === 'multi' ? (answers[item.key] || []).includes(text) : answers[item.key] === text
      }))
    }))
  }))
}

module.exports = { QUESTIONNAIRE_VERSION, SCHEMA_CONTRACT, STEPS, allQuestions, completeness, isAnswered, stepIsValid, viewSteps }
