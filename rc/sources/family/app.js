const repository = require('./services/repository')
const analytics = require('./services/analytics')
const questionnaireSync = require('./services/questionnaire-sync')

App({
  globalData: {
    currentUserId: '',
    appName: 'Phoenix Family OS™'
  },

  onLaunch() {
    repository.initialize()
    this.globalData.currentUserId = wx.getStorageSync('PFS_CURRENT_USER_ID') || ''
  },

  onShow() {
    analytics.trackSession(this.globalData.currentUserId)
    const currentUser = repository.getById('users', this.globalData.currentUserId)
    if (!currentUser || currentUser.role !== 'family_user') return
    try {
      questionnaireSync.reconcile(repository)
    } catch (_syncError) {}
    questionnaireSync.flush().catch(() => {})
  },

  setCurrentUser(userId) {
    this.globalData.currentUserId = userId
    wx.setStorageSync('PFS_CURRENT_USER_ID', userId)
  },

  getCurrentUser() {
    return repository.getById('users', this.globalData.currentUserId)
  }
})
