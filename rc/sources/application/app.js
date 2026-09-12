const { repository } = require('./services/demo-runtime')
const analytics = require('./services/analytics')
const runtime = require('./config/runtime')

App({
  globalData: {
    currentUserId: '',
    currentUser: null,
    appName: 'Phoenix Family OS™',
    runtimeMode: runtime.mode()
  },

  onLaunch() {
    if (runtime.isDemo()) {
      repository.initialize()
      this.globalData.currentUserId = wx.getStorageSync('PFS_CURRENT_USER_ID') || ''
    }
  },

  onShow() {
    const user = this.getCurrentUser()
    analytics.trackSession(user && user.id)
  },

  setCurrentUser(userOrId) {
    if (runtime.isDemo()) {
      const userId = typeof userOrId === 'string' ? userOrId : (userOrId && userOrId.id) || ''
      this.globalData.currentUserId = userId
      this.globalData.currentUser = null
      wx.setStorageSync('PFS_CURRENT_USER_ID', userId)
      return
    }
    this.globalData.currentUser = userOrId && typeof userOrId === 'object'
      ? { id: userOrId.id, role: userOrId.role }
      : null
    this.globalData.currentUserId = ''
  },

  getCurrentUser() {
    if (runtime.isDemo()) return repository.getById('users', this.globalData.currentUserId)
    return this.globalData.currentUser
  }
})
