const repository = require('../../services/repository')
const session = require('../../services/session')
const { getNavigationMetrics } = require('../../utils/navigation')
const { getPartnerExperience } = require('../../data/partner-experiences')

Page({
  data: {
    user: null, family: null, students: [], latestReport: null,
    primaryStudent: null, stage: '', nextStep: null, progress: 0,
    navigation: getNavigationMetrics(),
    partnerExperience: getPartnerExperience('yuanchao')
  },

  onShow() {
    const user = session.guard(['family_user'])
    if (!user) return
    const family = repository.familyForUser(user.id)
    const students = family ? repository.studentsForFamily(family.id) : []
    const reports = family ? repository.reportsForFamily(family.id) : []
    const primaryStudent = students[0] || null
    const latestReport = reports[0] || null
    const progress = !family ? 0 : !primaryStudent ? 34 : !latestReport ? 67 : 100
    let nextStep = { title: '建立家庭档案', note: '用 2 分钟告诉我们家庭最关心的成长目标', url: '/pages/family-edit/index' }
    if (family && !primaryStudent) nextStep = { title: '添加孩子档案', note: '记录孩子当前阶段、兴趣与未来想法', url: '/pages/student-edit/index' }
    if (primaryStudent && !latestReport) nextStep = { title: '完成 Education Compass', note: '从兴趣、挑战与家庭期待中找到下一步', url: `/pages/compass/index?studentId=${primaryStudent.id}` }
    if (latestReport) nextStep = { title: latestReport.recommendation.nextAction, note: '来自最近一次家庭成长洞察', url: `/pages/report/index?id=${latestReport.id}` }
    this.setData({
      user, family, students, primaryStudent, latestReport, progress, nextStep,
      studentInitial: primaryStudent ? primaryStudent.name.charAt(0) : '+',
      stage: latestReport ? latestReport.summary.currentStage : (primaryStudent ? `${primaryStudent.grade || '当前'}成长规划期` : '')
    })
  },

  goNext() { if (this.data.nextStep) wx.navigateTo({ url: this.data.nextStep.url }) },
  goFamily() { wx.navigateTo({ url: '/pages/family-edit/index' }) },
  goStudent() {
    const id = this.data.primaryStudent ? `?id=${this.data.primaryStudent.id}` : ''
    wx.navigateTo({ url: `/pages/student-edit/index${id}` })
  },
  goCompass() {
    if (!this.data.family) return this.goFamily()
    if (!this.data.primaryStudent) return this.goStudent()
    wx.navigateTo({ url: `/pages/compass/index?studentId=${this.data.primaryStudent.id}` })
  },
  goReport() {
    if (!this.data.latestReport) return this.goCompass()
    wx.navigateTo({ url: `/pages/report/index?id=${this.data.latestReport.id}` })
  },
  goAdvisor() {
    if (!this.data.family) return this.goFamily()
    wx.navigateTo({ url: '/pages/advisor-request/index' })
  },
  goPartnerExperience() {
    wx.navigateTo({ url: '/pages/partner/yuanchao/index' })
  }
})
