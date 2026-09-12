const repository = require('../../../services/repository')
const partnerService = require('../../../services/partner-experience')
const analytics = require('../../../services/analytics')
const { getPartnerExperience } = require('../../../data/partner-experiences')

const QUESTIONS = [
  { key: 'age_stage', label: '孩子目前的年龄阶段', hint: '选择最接近的阶段即可', options: ['4–6 岁', '7–9 岁', '10–12 岁', '13–15 岁', '16–18 岁'] },
  { key: 'likes_music', label: '孩子是否喜欢唱歌或音乐？', hint: '以日常观察到的自然反应为准', options: ['经常主动参与', '有时会主动参与', '愿意听但较少参与', '目前还不确定'] },
  { key: 'preference', label: '孩子更喜欢哪一种表达？', hint: '这不是分类，只是下一次体验的线索', options: ['演唱', '节奏', '乐器', '自己编故事'] },
  { key: 'parent_hope', label: '家长希望孩子获得什么？', hint: '选择家庭当下最看重的一项', options: ['更自信地表达', '保持对音乐的兴趣', '完成一件原创作品', '连接潮州文化', '留下长期成长记录'] }
]

Page({
  data: {
    experience: getPartnerExperience('yuanchao'),
    questions: QUESTIONS,
    stepIndex: 0,
    current: QUESTIONS[0],
    progress: 25,
    answers: {},
    selected: '',
    result: null,
    saved: false
  },

  choose({ currentTarget }) {
    const value = currentTarget.dataset.value
    const key = this.data.current.key
    this.setData({ [`answers.${key}`]: value, selected: value })
  },

  next() {
    if (!this.data.selected) return wx.showToast({ title: '请选择一个最接近的答案', icon: 'none' })
    if (this.data.stepIndex === this.data.questions.length - 1) {
      const result = partnerService.buildExplorationResult(this.data.answers)
      this.setData({ result, progress: 100 })
      const app = getApp()
      const user = app && app.getCurrentUser ? app.getCurrentUser() : null
      const family = user ? repository.familyForUser(user.id) : null
      analytics.track('partner_music_exploration_completed', {
        userId: user ? user.id : '', familyId: family ? family.id : '', properties: { partner: 'yuanchao' }
      })
      wx.pageScrollTo({ scrollTop: 0, duration: 250 })
      return
    }
    const stepIndex = this.data.stepIndex + 1
    const current = this.data.questions[stepIndex]
    this.setData({ stepIndex, current, selected: this.data.answers[current.key] || '', progress: ((stepIndex + 1) / this.data.questions.length) * 100 })
    wx.pageScrollTo({ scrollTop: 0, duration: 220 })
  },

  previous() {
    if (this.data.result) {
      this.setData({ result: null, saved: false })
      return
    }
    if (!this.data.stepIndex) return wx.navigateBack()
    const stepIndex = this.data.stepIndex - 1
    const current = this.data.questions[stepIndex]
    this.setData({ stepIndex, current, selected: this.data.answers[current.key] || '', progress: ((stepIndex + 1) / this.data.questions.length) * 100 })
  },

  save() {
    if (this.data.saved) return wx.showToast({ title: '已保存', icon: 'success' })
    const app = getApp()
    const user = app && app.getCurrentUser ? app.getCurrentUser() : null
    const family = user ? repository.familyForUser(user.id) : null
    if (!family) {
      wx.showModal({ title: '先建立家庭档案', content: '建立家庭档案后，可以把探索起点保存为家庭成长记录。', confirmText: '去建立', success: ({ confirm }) => { if (confirm) wx.navigateTo({ url: '/pages/family-edit/index' }) } })
      return
    }
    const student = repository.studentsForFamily(family.id)[0] || null
    partnerService.saveExploration({
      familyId: family.id,
      studentId: student ? student.id : '',
      partnerExperienceId: this.data.experience.id,
      answers: this.data.answers,
      result: this.data.result
    })
    this.setData({ saved: true })
    wx.showToast({ title: '已保存到家庭档案', icon: 'success' })
  },

  apply() { wx.redirectTo({ url: '/pages/partner/apply/index?partner=yuanchao' }) }
})
