const labels = require('../../models/masters-labels')
const auth = require('../../services/auth')
const config = require('../../config/masters')
const masters = require('../../services/masters')
const model = require('../../models/masters-intake')
const session = require('../../services/session')

function display(value) {
  if (Array.isArray(value)) return value.map(display).join('、') || '未填写'
  if (value && typeof value === 'object') return Object.keys(value).map((key) => `${labels.fieldLabel(key)}：${display(value[key])}`).join('；') || '未填写'
  return value === undefined || value === null || value === '' ? '未填写' : labels.studentValue(value)
}
function errorText(error) {
  if (error && Number(error.statusCode) === 409) return '服务端资料已有新版本，请返回资料页重新核对后再提交。'
  return error && error.message || '确认未完成，请稍后重试'
}
function sessionUserId() {
  const user = session.currentUser()
  return String(user && (user.id || user.userId) || '')
}
function uploadStatusLabel(value) {
  return { UPLOADED: '已上传', UPLOADING: '上传中', FAILED: '上传失败', REMOVED: '已撤除' }[String(value || '').toUpperCase()] || '上传状态待核验'
}
function parseStatusLabel(value) {
  return { PENDING: '待识别', PROCESSING: '识别中', RUNNING: '识别中', SUCCEEDED: '已识别', NEEDS_CONFIRMATION: '待你确认', MANUAL_REVIEW: '待人工核验', NEEDS_REVIEW: '待人工核验', FAILED: '识别失败，待人工核验' }[String(value || '').toUpperCase()] || '识别状态待核验'
}
function confidenceLabel(value) {
  return { HIGH: '高置信', MEDIUM: '中置信', LOW: '低置信', NEEDS_CONFIRMATION: '待你确认' }[String(value || '').toUpperCase()] || '待核验'
}
function decisionLabel(value) {
  return { ACCEPTED: '已接受', REJECTED: '已拒绝', PENDING: '待你选择' }[String(value || '').toUpperCase()] || '待你选择'
}

Page({
  data: {
    enabled: config.isEnabled(), loggedIn: false, loginBusy: false, loading: true, confirming: false,
    consultationId: '', version: 1, consultation: null, profile: model.emptyProfile(), documents: [], documentGroups: [],
    targetMajorsLabel: '方向待定', targetInstitutionsLabel: '尚未确定', resumeDraft: null, extractionFields: [], conflicts: [],
    contactTypeLabel: '联系方式', targetYearLabel: '尚未确定，希望顾问建议', extractionError: '', serviceConsent: false, accuracyConfirmed: false, error: ''
  },

  onLoad(options = {}) { this.routeConsultationId = String(options.id || ''); this.setData({ consultationId: this.routeConsultationId, enabled: config.isEnabled() }) },

  onShow() {
    if (!config.isEnabled()) { this.setData({ enabled: false, loading: false }); return }
    const user = session.currentUser()
    const userId = String(user && (user.id || user.userId) || '')
    if (!userId) {
      const hadUser = Boolean(this.loadedUserId)
      this.clearSensitiveState(hadUser)
      this.loadedUserId = ''
      this.loaded = false
      this.setData({ loggedIn: false, loading: false })
      return
    }
    if (this.loadedUserId && this.loadedUserId !== userId) this.clearSensitiveState(true)
    this.setData({ loggedIn: true })
    if (this.loaded && this.loadedUserId === userId) return
    this.loadedUserId = userId
    if (!this.data.consultationId && this.routeConsultationId) this.setData({ consultationId: this.routeConsultationId })
    this.loaded = true
    this.load()
  },

  clearSensitiveState(clearRoute = false) {
    if (clearRoute) this.routeConsultationId = ''
    this.setData({ consultationId: '', version: 1, consultation: null, profile: model.emptyProfile(), documents: [], documentGroups: [],
      targetMajorsLabel: '方向待定', targetInstitutionsLabel: '尚未确定', contactTypeLabel: '联系方式', targetYearLabel: '尚未确定，希望顾问建议',
      resumeDraft: null, extractionFields: [], conflicts: [], extractionError: '', serviceConsent: false, accuracyConfirmed: false, error: '' })
  },

  async login() {
    if (this.data.loginBusy) return
    this.setData({ loginBusy: true, error: '' })
      try { await auth.loginFamilyUser(); this.loadedUserId = sessionUserId(); this.setData({ loggedIn: true, consultationId: this.routeConsultationId || this.data.consultationId }); this.loaded = false; await this.load() }
    catch (error) { this.setData({ error: errorText(error) }); wx.showToast({ title: errorText(error), icon: 'none' }) }
    finally { this.setData({ loginBusy: false }) }
  },

  async load() {
    if (!this.data.consultationId) { this.setData({ loading: false, error: '缺少咨询编号，请从我的申请咨询进入。' }); return }
    const requestUserId = sessionUserId()
    this.setData({ loading: true, error: '' })
    try {
      const consultation = await masters.getConsultation(this.data.consultationId)
      if (!requestUserId || requestUserId !== sessionUserId()) return
      let extraction = { fields: [], conflicts: [] }
      let extractionError = ''
      try {
        extraction = await masters.getExtraction(this.data.consultationId)
      } catch (error) {
        extractionError = errorText(error)
      }
      if (!requestUserId || requestUserId !== sessionUserId()) return
      const profile = model.normalizeProfile(consultation.profile)
      const documents = (consultation.documents || []).map(model.normalizeDocument).map((item) => ({ ...item, uploadStatusLabel: uploadStatusLabel(item.uploadStatus), parseStatusLabel: parseStatusLabel(item.parseStatus) }))
      const grouped = model.DOCUMENT_TYPES.map((type) => ({ type, title: model.DOCUMENT_META[type].title, files: documents.filter((item) => item.type === type) })).filter((group) => group.files.length)
      const extractionFields = (extraction.fields || []).map((item) => ({
        ...item, field: String(item.field || ''), fieldLabel: labels.fieldLabel(item.field), valueLabel: display(item.value), sourceLabel: item.sourceName || item.source || '上传材料',
        locationLabel: item.location || item.snippet || '位置待核验', confidenceLabel: confidenceLabel(item.confidence), decisionLabel: item.accepted === true ? '已接受' : item.accepted === false ? '已拒绝' : '待你确认'
      }))
      const conflicts = (extraction.conflicts || []).map((item) => ({ ...item, values: Array.isArray(item.values) ? item.values.map((value) => display(value)) : [], field: String(item.field || ''), fieldLabel: labels.fieldLabel(item.field), decisionLabel: decisionLabel(item.resolution) }))
      this.setData({ contactTypeLabel: labels.contactTypeLabel(profile.contact.type), targetYearLabel: labels.targetYearLabel(profile.targetYear), consultation, version: Number(consultation.version || consultation.profileVersion || 1), profile, documents, documentGroups: grouped, targetMajorsLabel: profile.targetMajors.length ? profile.targetMajors.join('、') : '方向待定', targetInstitutionsLabel: profile.targetInstitutions.length ? profile.targetInstitutions.join('、') : '尚未确定', resumeDraft: consultation.path === 'GUIDED' || !documents.some((item) => item.type === 'RESUME') ? model.resumeDraft(profile) : null, extractionFields, conflicts, extractionError, serviceConsent: Boolean(consultation.consent && (consultation.consent.accepted || consultation.consent.service || !consultation.consent.withdrawnAt)), accuracyConfirmed: Boolean(profile.accuracyConfirmed), loading: false })
    } catch (error) { this.setData({ loading: false, error: errorText(error) }) }
  },

  retryExtractionLoad() {
    if (this.data.loading) return
    this.load()
  },

  accuracyChange({ detail }) {
    const values = Array.isArray(detail && detail.value) ? detail.value : []
    this.setData({ accuracyConfirmed: values.includes('accuracy') })
  },

  serviceConsentChange({ detail }) {
    const values = Array.isArray(detail && detail.value) ? detail.value : []
    this.setData({ serviceConsent: values.includes('service') })
  },

  async resolveExtraction({ currentTarget }) {
    const dataset = currentTarget && currentTarget.dataset || {}
    const index = Number(dataset.index)
    const item = this.data.extractionFields[index]
    if (!item || !item.field || !item.documentId) return wx.showToast({ title: '识别来源不完整，需人工核验', icon: 'none' })
    const accepted = String(dataset.accepted) === 'true'
    try {
      await masters.resolveExtraction(this.data.consultationId, { version: this.data.version, documentId: item.documentId, field: item.field, value: item.value, accepted }, masters.createIdempotencyKey('extraction'))
      wx.showToast({ title: accepted ? '已接受识别结果' : '已拒绝识别结果', icon: 'success' })
      await this.load()
    } catch (error) { this.setData({ error: errorText(error) }); wx.showToast({ title: errorText(error), icon: 'none' }) }
  },

  async resolveConflict({ currentTarget }) {
    const dataset = currentTarget && currentTarget.dataset || {}
    const index = Number(dataset.index)
    const conflict = this.data.conflicts[index]
    if (!conflict || !conflict.documentId || dataset.value === undefined) return wx.showToast({ title: '冲突来源不完整，需人工核验', icon: 'none' })
    try {
      await masters.resolveExtraction(this.data.consultationId, { version: this.data.version, documentId: conflict.documentId, field: conflict.field, value: dataset.value, accepted: true }, masters.createIdempotencyKey('conflict'))
      wx.showToast({ title: '已记录你的选择', icon: 'success' })
      await this.load()
    } catch (error) { this.setData({ error: errorText(error) }); wx.showToast({ title: errorText(error), icon: 'none' }) }
  },

  async confirm() {
    if (!this.data.serviceConsent) return wx.showToast({ title: '请先同意资料处理说明', icon: 'none' })
    if (!this.data.accuracyConfirmed) return wx.showToast({ title: '请确认资料准确', icon: 'none' })
    if (this.data.confirming) return
    this.setData({ confirming: true, error: '' })
    try {
      const consultation = await masters.confirmConsultation(this.data.consultationId, this.data.version, {
        accuracyConfirmed: true, consent: { accepted: true, copyVersion: config.SERVICE_CONSENT_VERSION }
      }, masters.createIdempotencyKey('confirm'))
      wx.redirectTo({ url: `/pages/masters-status/index?id=${encodeURIComponent(consultation.id || this.data.consultationId)}` })
    } catch (error) { this.setData({ error: errorText(error) }); wx.showModal({ title: '确认未完成', content: errorText(error), showCancel: false }) }
    finally { this.setData({ confirming: false }) }
  },

  back() { wx.navigateBack({ delta: 1 }) },
  edit() { wx.navigateBack({ delta: 1 }) },
  valueText: display
})

module.exports = { display, errorText }
