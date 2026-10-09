const auth = require('../../services/auth')
const config = require('../../config/masters')
const masters = require('../../services/masters')
const session = require('../../services/session')
const labels = require('../../models/masters-labels')

function errorText(error) {
  if (error && (error.code === 'MASTERS_REPORT_NOT_RELEASED' || Number(error.statusCode) === 403)) return '咨询报告尚未获批并开放，当前不能查看草稿。'
  return error && error.message || '咨询报告暂时无法读取'
}
function sessionUserId() {
  const user = session.currentUser()
  return String(user && (user.id || user.userId) || '')
}

Page({
  data: { enabled: config.isEnabled(), loggedIn: false, loginBusy: false, loading: true, exporting: '', consultationId: '', report: null, payload: null, error: '' },

  onLoad(options = {}) { this.routeConsultationId = String(options.id || ''); this.setData({ consultationId: this.routeConsultationId, enabled: config.isEnabled() }) },
  onShow() {
    if (!config.isEnabled()) { this.setData({ enabled: false, loading: false }); return }
    const user = session.currentUser()
    const userId = String(user && (user.id || user.userId) || '')
    if (!userId) {
      const hadUser = Boolean(this.loadedUserId)
      this.clearSensitiveState(hadUser)
      this.loadedUserId = ''
      this.setData({ loggedIn: false, loading: false })
      return
    }
    if (this.loadedUserId && this.loadedUserId !== userId) this.clearSensitiveState(true)
    this.setData({ loggedIn: true })
    this.loadedUserId = userId
    if (!this.data.consultationId && this.routeConsultationId) this.setData({ consultationId: this.routeConsultationId })
    this.load()
  },
  clearSensitiveState(clearRoute = false) {
    if (clearRoute) this.routeConsultationId = ''
    this.setData({ consultationId: '', report: null, payload: null, exporting: '', error: '' })
  },
  async login() {
    if (this.data.loginBusy) return
    this.setData({ loginBusy: true, error: '' })
    try { await auth.loginFamilyUser(); this.loadedUserId = sessionUserId(); this.setData({ loggedIn: true, consultationId: this.routeConsultationId || this.data.consultationId }); await this.load() }
    catch (error) { this.setData({ error: errorText(error) }); wx.showToast({ title: errorText(error), icon: 'none' }) }
    finally { this.setData({ loginBusy: false }) }
  },
  async load() {
    if (!this.data.consultationId) { this.setData({ loading: false, error: '缺少咨询编号。' }); return }
    const requestUserId = sessionUserId()
    this.setData({ loading: true, error: '' })
    try {
      const report = await masters.getReport(this.data.consultationId)
      if (!requestUserId || requestUserId !== sessionUserId()) return
      const payload = report.payload || {}
      const candidatePrograms = (payload.candidatePrograms || []).map((item) => ({ ...item, sourceStatusLabel: item.sourceStatus === 'VERIFIED' ? '顾问已核验' : '待核验', intakeYearLabel: item.intakeYear === 'UNDECIDED' ? '尚未确定' : item.intakeYear, studentAcceptedLabel: { PENDING: '待你确认', ACCEPTED: '已接受', DECLINED: '未接受' }[item.studentAccepted] || '待你确认', risksLabel: Array.isArray(item.risks) ? item.risks.join('、') : String(item.risks || '') }))
      const assistance = report.assistance || { label: '初评／待补报告', complete: false, explanation: '规则草稿与人工核验辅助；自动选校尚未实现。', limitations: [] }
      const gaps = (payload.strengthsAndGaps && payload.strengthsAndGaps.gaps || []).map(labels.studentValue)
      this.setData({ report: { ...report, assistance }, payload: { ...payload, strengthsAndGaps: { ...payload.strengthsAndGaps, gaps }, candidatePrograms }, loading: false })
    }
    catch (error) { this.setData({ loading: false, error: errorText(error) }) }
  },
  async exportReport({ currentTarget }) {
    const format = String(currentTarget && currentTarget.dataset && currentTarget.dataset.format || '')
    if (!['pdf', 'xlsx'].includes(format) || this.data.exporting) return
    this.setData({ exporting: format, error: '' })
    try {
      const filePath = await masters.downloadReportExport(this.data.consultationId, format)
      await new Promise((resolve, reject) => wx.openDocument({ filePath, fileType: format === 'pdf' ? 'pdf' : 'xlsx', showMenu: true, success: resolve, fail: reject }))
    } catch (error) { this.setData({ error: errorText(error) }); wx.showToast({ title: errorText(error), icon: 'none' }) }
    finally { this.setData({ exporting: '' }) }
  },
  back() { wx.navigateBack({ delta: 1 }) },
  retry() { return this.load() }
})

module.exports = { errorText }
