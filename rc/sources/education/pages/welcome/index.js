const auth = require('../../services/auth')
const analytics = require('../../services/analytics')
const { getNavigationMetrics } = require('../../utils/navigation')

Page({
  data: {
    loading: false,
    showAdvisorDemo: auth.isDemo(),
    navigation: getNavigationMetrics()
  },

  async start() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const user = await auth.loginFamilyUser()
      if (user.role !== 'family_user') {
        auth.logout()
        throw new Error('生产顾问端尚未在本小程序开放')
      }
      analytics.trackSession(user.id)
      wx.reLaunch({ url: '/pages/home/index' })
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '登录失败，请重试', icon: 'none' })
    }
  },

  advisorLogin() {
    if (!auth.isDemo()) return
    wx.showModal({
      title: '内部顾问演示',
      content: 'V0.1 使用本地演示身份。正式上线前将替换为企业身份验证。',
      confirmText: '进入顾问端',
      success: ({ confirm }) => {
        if (!confirm) return
        auth.loginAdvisorDemo()
        wx.reLaunch({ url: '/pages/admin-families/index' })
      }
    })
  }
})
