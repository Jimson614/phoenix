const repository = require('../../services/repository')
const session = require('../../services/session')
const aiProvider = require('../../services/ai-provider')
const { isoNow } = require('../../utils/date')
const analytics = require('../../services/analytics')
const questionnaireSync = require('../../services/questionnaire-sync')

function question(key, label, type, options, placeholder) {
  return { key, label, type, options: (options || []).map((text) => ({ text, selected: false })), placeholder: placeholder || '', value: type === 'multi' ? [] : '' }
}

const STEPS = [
  {
    title: '现在的阶段', hint: '先从孩子当下的学习状态开始。',
    questions: [
      question('school_stage', '孩子目前处于哪个学习阶段？', 'single', ['小学', '初中', '高中', '大学', '其他']),
      question('learning_feeling', '你觉得孩子最近的学习状态更接近？', 'single', ['主动投入', '基本稳定', '有些迷茫', '压力较大'])
    ]
  },
  {
    title: '看见优势', hint: '选择你真实观察到的特点，不必追求全面。',
    questions: [
      question('strengths', '孩子目前较明显的优势（可多选）', 'multi', ['好奇心', '表达力', '逻辑力', '创造力', '专注力', '同理心']),
      question('interests', '孩子最近愿意主动投入时间的事情', 'text', null, '课程、运动、音乐、阅读、游戏或任何真实兴趣')
    ]
  },
  {
    title: '理解挑战', hint: '挑战不是标签，它只是规划下一步的线索。',
    questions: [
      question('challenges', '家庭目前最想解决的问题（可多选）', 'multi', ['目标不清晰', '学习动力不足', '时间管理', '亲子沟通', '升学选择', '压力焦虑']),
      question('parent_observation', '最近一件让你感到担心或困惑的事', 'text', null, '请用一件具体的小事来描述')
    ]
  },
  {
    title: '连接未来', hint: '这里记录期待，但不要求现在就确定答案。',
    questions: [
      question('parent_expectation', '家长最看重的成长结果', 'single', ['身心健康', '保持热爱', '学术成长', '独立选择', '综合发展']),
      question('future_goal', '孩子或家庭正在考虑的未来方向', 'text', null, '例如：工程、艺术、国际升学，或仍在探索')
    ]
  },
  {
    title: '开始行动', hint: '选择家庭当下真正能够投入的支持。',
    questions: [
      question('support_need', '未来 30 天最需要的支持（可多选）', 'multi', ['方向梳理', '选科建议', '项目体验', '学习计划', '亲子沟通', '顾问解读']),
      question('available_time', '家庭愿意投入的行动节奏', 'single', ['每周一次', '每两周一次', '每月一次', '先获得建议再决定'])
    ]
  }
]

Page({
  data: { student: null, steps: STEPS, stepIndex: 0, current: STEPS[0], progress: 20, submitting: false },

  onLoad(options) {
    const user = session.guard(['family_user'])
    if (!user) return
    const family = repository.familyForUser(user.id)
    const student = repository.getById('students', options.studentId)
    if (!family || !student || student.family_id !== family.id) return wx.reLaunch({ url: '/pages/home/index' })
    const steps = JSON.parse(JSON.stringify(STEPS))
    this.setData({ student, steps, current: steps[0], stepIndex: 0, progress: 20, submitting: false })
  },

  choose({ currentTarget }) {
    const questionIndex = Number(currentTarget.dataset.question)
    const optionIndex = Number(currentTarget.dataset.option)
    const stepIndex = this.data.stepIndex
    const target = this.data.steps[stepIndex].questions[questionIndex]
    const steps = this.data.steps
    if (target.type === 'single') {
      target.options.forEach((option, index) => { option.selected = index === optionIndex })
      target.value = target.options[optionIndex].text
    } else {
      target.options[optionIndex].selected = !target.options[optionIndex].selected
      target.value = target.options.filter((option) => option.selected).map((option) => option.text)
    }
    this.setData({ steps, current: steps[stepIndex] })
  },

  typeAnswer({ currentTarget, detail }) {
    const questionIndex = Number(currentTarget.dataset.question)
    const path = `steps[${this.data.stepIndex}].questions[${questionIndex}].value`
    this.setData({ [path]: detail.value })
    this.setData({ current: this.data.steps[this.data.stepIndex] })
  },

  validCurrent() {
    return this.data.current.questions.every((item) => Array.isArray(item.value) ? item.value.length > 0 : String(item.value).trim().length > 0)
  },

  next() {
    if (!this.validCurrent()) return wx.showToast({ title: '请完成本页问题', icon: 'none' })
    if (this.data.stepIndex === this.data.steps.length - 1) return this.submit()
    const stepIndex = this.data.stepIndex + 1
    this.setData({ stepIndex, current: this.data.steps[stepIndex], progress: ((stepIndex + 1) / this.data.steps.length) * 100 })
    wx.pageScrollTo({ scrollTop: 0, duration: 250 })
  },

  previous() {
    if (!this.data.stepIndex) return wx.navigateBack()
    const stepIndex = this.data.stepIndex - 1
    this.setData({ stepIndex, current: this.data.steps[stepIndex], progress: ((stepIndex + 1) / this.data.steps.length) * 100 })
    wx.pageScrollTo({ scrollTop: 0, duration: 250 })
  },

  submit() {
    if (this.data.submitting) return
    const user = session.guard(['family_user'])
    if (!user) return
    const family = repository.familyForUser(user.id)
    const student = repository.getById('students', this.data.student && this.data.student.id)
    if (!family || !student || student.family_id !== family.id) {
      return wx.reLaunch({ url: '/pages/home/index' })
    }
    this.setData({ submitting: true })
    try {
      const answers = {}
      this.data.steps.forEach((step) => step.questions.forEach((item) => { answers[item.key] = item.value }))
      const submittedAt = isoNow()
      const assessment = repository.insert('assessments', {
        student_id: student.id,
        type: 'education',
        answers,
        status: 'completed',
        sync_requested_at: submittedAt,
        created_at: submittedAt
      })
      const generated = aiProvider.generateGrowthInsight(student, answers)
      const report = repository.insert('reports', {
        assessment_id: assessment.id,
        summary: {
          currentStage: generated.currentStage, strength: generated.strength,
          potentialChallenge: generated.potentialChallenge, narrative: generated.narrative
        },
        recommendation: {
          suggestedDirection: generated.suggestedDirection, nextAction: generated.nextAction, engine: generated.engine
        },
        created_at: isoNow()
      })
      repository.addTimeline(family.id, 'compass_completed', `${student.name} 已完成 Education Compass`)
      repository.addTimeline(family.id, 'report_generated', `已生成 ${student.name} 的成长洞察报告`)
      analytics.track('education_compass_completed', { userId: user.id, familyId: family.id, properties: { student_id: student.id, report_id: report.id } })
      try {
        questionnaireSync.enqueue({
          clientSubmissionId: assessment.id,
          familyId: family.id,
          studentId: student.id,
          questionnaireType: 'education',
          answers,
          submittedAt: assessment.created_at
        })
        questionnaireSync.flush().catch(() => {})
      } catch (_syncError) {
        // The local Demo report remains available; no remote-sync success is shown.
      }
      wx.redirectTo({ url: `/pages/report/index?id=${report.id}&new=1` })
    } catch (error) {
      try {
        questionnaireSync.reconcile(repository)
        questionnaireSync.flush().catch(() => {})
      } catch (_syncError) {}
      this.setData({ submitting: false })
      wx.showToast({ title: '生成失败，请稍后重试', icon: 'none' })
    }
  }
})
