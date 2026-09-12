const labels = require('../../models/masters-labels')
const auth = require('../../services/auth')
const config = require('../../config/masters')
const masters = require('../../services/masters')
const session = require('../../services/session')

const STATUS_COPY = {
  DRAFT: '资料草稿', SUBMITTED: '已提交，等待分配', NEEDS_INFO: '待补资料', IN_REVIEW: '顾问复核中', CLOSED: '已关闭', WITHDRAWN: '已撤回'
}
function sessionUserId() {
  const user = session.currentUser()
  return String(user && (user.id || user.userId) || '')
}
function normalize(item) {
  const status = String(item.status || 'DRAFT').toUpperCase()
  return { ...item, id: item.id || item.consultationId, status, statusLabel: STATUS_COPY[status] || '处理中', targetYear: labels.targetYearLabel(item.targetYear || item.profile && item.profile.targetYear), updatedAt: item.updatedAt || item.updated_at || '' }
}

Page({
  data: { enabled: config.isEnabled(), loggedIn: false, loginBusy: false, loading: true, consultations: [], error: '' },

  onLoad() { this.setData({ enabled: config.isEnabled() }) },
  onShow() {
    if (!config.isEnabled()) { this.setData({ enabled: false, loading: false }); return }
    const user = session.currentUser()
    const userId = String(user && (user.id || user.userId) || '')
    if (!userId) {
      this.setData({ loggedIn: false, loading: false, consultations: [], error: '' })
      this.loadedUserId = ''
      return
    }
    if (this.loadedUserId && this.loadedUserId !== userId) this.setData({ consultations: [], loading: true, error: '' })
    this.loadedUserId = userId
    this.setData({ loggedIn: true }); this.load()
  },
  async login() {
    if (this.data.loginBusy) return
    this.setData({ loginBusy: true, error: '' })
    try { await auth.loginFamilyUser(); this.loadedUserId = sessionUserId(); this.setData({ loggedIn: true }); await this.load() }
    catch (error) { this.setData({ error: error.message || '登录未完成' }); wx.showToast({ title: error.message || '登录未完成', icon: 'none' }) }
    finally { this.setData({ loginBusy: false }) }
  },
  async load() {
    const requestUserId = sessionUserId()
    this.setData({ loading: true, error: '' })
    try {
      const consultations = (await masters.listConsultations()).map(normalize)
      if (!requestUserId || requestUserId !== sessionUserId()) return
      this.setData({ consultations, loading: false })
    }
    catch (error) { this.setData({ loading: false, error: error.message || '咨询列表暂时无法读取' }) }
  },
  open({ currentTarget }) {
    const id = String(currentTarget && currentTarget.dataset && currentTarget.dataset.id || '')
    if (id) wx.navigateTo({ url: `/pages/masters-status/index?id=${encodeURIComponent(id)}` })
  },
  newConsultation() { wx.navigateTo({ url: '/pages/masters-materials/index?path=GUIDED&channel=organic' }) },
  back() { wx.navigateBack({ delta: 1 }) },
  retry() { return this.load() }
})

module.exports = { STATUS_COPY, normalize }
