const { getPartnerExperience } = require('../../../data/partner-experiences')
const { getNavigationMetrics } = require('../../../utils/navigation')
const repository = require('../../../services/repository')
const analytics = require('../../../services/analytics')

Page({
  data: {
    experience: getPartnerExperience('yuanchao'),
    navigation: getNavigationMetrics()
  },

  onLoad() {
    const app = getApp()
    const user = app && app.getCurrentUser ? app.getCurrentUser() : null
    const family = user ? repository.familyForUser(user.id) : null
    analytics.track('partner_experience_viewed', {
      userId: user ? user.id : '', familyId: family ? family.id : '', properties: { slug: 'yuanchao' }
    })
  },

  back() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/index' }) }) },
  startExploration() { wx.navigateTo({ url: '/pages/partner/music-exploration/index?partner=yuanchao' }) },
  learnJourney() { wx.pageScrollTo({ selector: '#journey', duration: 350 }) },
  apply() { wx.navigateTo({ url: '/pages/partner/apply/index?partner=yuanchao' }) },
  savePlan() {
    const app = getApp()
    const user = app && app.getCurrentUser ? app.getCurrentUser() : null
    const family = user ? repository.familyForUser(user.id) : null
    if (!family) {
      wx.showModal({
        title: '先建立家庭档案',
        content: '建立家庭档案后，才能把联合成长计划保存到家庭时间线。',
        confirmText: '去建立',
        success: ({ confirm }) => { if (confirm) wx.navigateTo({ url: '/pages/family-edit/index' }) }
      })
      return
    }
    const existing = repository.where('timelineEvents', (event) => event.family_id === family.id && event.event_type === 'partner_plan_saved')
    if (!existing.length) repository.addTimeline(family.id, 'partner_plan_saved', '已将“凤城少年启航™”保存至家庭成长计划')
    wx.showToast({ title: existing.length ? '已在家庭计划中' : '已保存至家庭计划', icon: 'success' })
  }
})
