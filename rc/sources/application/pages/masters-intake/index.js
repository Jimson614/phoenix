const auth = require('../../services/auth')
const masters = require('../../services/masters')
const config = require('../../config/masters')
const session = require('../../services/session')

function safePath(value) { return config.path(value) }

Page({
  data: {
    enabled: config.isEnabled(), loggedIn: false, loginBusy: false, loading: false,
    pendingPath: 'GUIDED', channel: 'organic', error: ''
  },

  onLoad(options = {}) {
    this.setData({ channel: config.channel(options.channel) })
  },

  onShow() {
    this.setData({ loggedIn: Boolean(session.currentUser()), enabled: config.isEnabled() })
  },

  begin({ currentTarget }) {
    const path = safePath(currentTarget && currentTarget.dataset && currentTarget.dataset.path)
    if (!config.isEnabled()) {
      wx.showModal({ title: '功能暂未开放', content: '香港硕士免费咨询正在准备中，请稍后再试。', showCancel: false })
      return
    }
    this.setData({ pendingPath: path, error: '' })
    if (!session.currentUser()) return this.login()
    this.openMaterials(path)
  },

  openList() {
    if (!config.isEnabled()) {
      wx.showModal({ title: '功能暂未开放', content: '香港硕士免费咨询正在准备中，请稍后再试。', showCancel: false })
      return
    }
    this.setData({ pendingPath: 'LIST', error: '' })
    if (!session.currentUser()) return this.login()
    wx.navigateTo({ url: '/pages/masters-list/index' })
  },

  login() {
    if (this.data.loginBusy) return
    this.setData({ loginBusy: true, error: '' })
    return auth.loginFamilyUser()
      .then(() => {
        this.setData({ loggedIn: true })
        if (this.data.pendingPath === 'LIST') wx.navigateTo({ url: '/pages/masters-list/index' })
        else this.openMaterials(this.data.pendingPath)
      })
      .catch((error) => {
        this.setData({ error: error.message || '登录未完成，请稍后重试' })
        wx.showToast({ title: error.message || '登录未完成', icon: 'none' })
      })
      .finally(() => this.setData({ loginBusy: false }))
  },

  openMaterials(path) {
    const channel = config.channel(this.data.channel)
    wx.navigateTo({ url: `/pages/masters-materials/index?path=${safePath(path)}&channel=${encodeURIComponent(channel)}` })
  },

  shareHint() { wx.showToast({ title: '请使用右上角转发入口', icon: 'none' }) },

  onShareAppMessage() {
    return {
      title: '香港硕士免费咨询',
      path: `/pages/masters-intake/index?channel=${encodeURIComponent(config.channel(this.data.channel))}`
    }
  },

  home() { wx.switchTab({ url: '/pages/home/index' }) }
})

module.exports = { safePath }
