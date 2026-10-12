const auth = require('../../services/auth')
const config = require('../config/masters')
const masters = require('../services/masters')
const session = require('../../services/session')

// 工作人员入口. Active staff get a one-time code for signing in to the web workbench; anyone else
// gets an enrolment code to hand to a founder, who grants the role in the workbench. Codes are
// only kept on this page while it is open.
const ROLE_LABELS = { founder: 'Founder', advisor: '顾问', assignment_manager: '分配负责人' }

function sessionUserId() {
  const user = session.currentUser()
  return String(user && (user.id || user.userId) || '')
}

function timeLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

Page({
  data: {
    enabled: config.isEnabled(), loggedIn: false, loginBusy: false, loading: true, issuing: false,
    isStaff: false, roleLabel: '', suspended: false, code: '', expiresLabel: '', error: ''
  },

  onLoad() { this.setData({ enabled: config.isEnabled() }) },

  onShow() {
    if (!config.isEnabled()) { this.setData({ enabled: false, loading: false }); return }
    const userId = sessionUserId()
    if (!userId) { this.setData({ loggedIn: false, loading: false, code: '', expiresLabel: '' }); this.loadedUserId = ''; return }
    if (this.loadedUserId && this.loadedUserId !== userId) this.setData({ code: '', expiresLabel: '' })
    this.loadedUserId = userId
    this.setData({ loggedIn: true })
    this.load()
  },

  async login() {
    if (this.data.loginBusy) return
    this.setData({ loginBusy: true, error: '' })
    try { await auth.loginFamilyUser(); this.loadedUserId = sessionUserId(); this.setData({ loggedIn: true }); await this.load() }
    catch (error) { this.setData({ error: error.message || '登录未完成' }); wx.showToast({ title: error.message || '登录未完成', icon: 'none' }) }
    finally { this.setData({ loginBusy: false }) }
  },

  async load() {
    this.setData({ loading: true, error: '', code: '', expiresLabel: '' })
    try {
      const { staff } = await masters.workbenchStatus()
      const active = Boolean(staff && staff.status === 'ACTIVE')
      this.setData({ loading: false, isStaff: active, suspended: Boolean(staff && !active), roleLabel: staff ? (ROLE_LABELS[staff.role] || staff.role) : '' })
    } catch (error) { this.setData({ loading: false, error: error.message || '工作台身份暂时无法读取' }) }
  },

  async issue() {
    if (this.data.issuing) return
    this.setData({ issuing: true, error: '' })
    try {
      const result = await masters.issueWorkbenchCode(this.data.isStaff ? 'login' : 'enroll')
      this.setData({ code: result.code, expiresLabel: timeLabel(result.expiresAt) })
    } catch (error) {
      this.setData({ error: error.message || '生成未完成，请稍后重试' })
      wx.showModal({ title: '生成未完成', content: error.message || '请稍后重试', showCancel: false })
    } finally { this.setData({ issuing: false }) }
  },

  copy() {
    if (!this.data.code) return
    wx.setClipboardData({ data: this.data.code, success: () => wx.showToast({ title: '已复制', icon: 'success' }) })
  },

  back() { wx.navigateBack({ delta: 1 }) },
  retry() { return this.load() }
})

module.exports = { ROLE_LABELS, timeLabel }
