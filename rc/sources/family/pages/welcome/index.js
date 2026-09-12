const auth = require('../../services/auth')
const analytics = require('../../services/analytics')
const { getNavigationMetrics } = require('../../utils/navigation')

Page({
  data: {
    loading: false,
    navigation: getNavigationMetrics()
  },

  async start() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const user = await auth.loginFamilyUser()
      analytics.trackSession(user.id)
      wx.reLaunch({ url: '/pages/home/index' })
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({ title: '登录未完成，请稍后重试', icon: 'none' })
    }
  },

  advisorLogin() {
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
