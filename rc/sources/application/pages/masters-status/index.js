const auth = require('../../services/auth')
const config = require('../../config/masters')
const masters = require('../../services/masters')
const model = require('../../models/masters-intake')
const session = require('../../services/session')

const STATUS_COPY = {
  DRAFT: '资料草稿', SUBMITTED: '已提交，等待分配顾问', NEEDS_INFO: '需要补充资料', IN_REVIEW: '顾问审核中', CLOSED: '已关闭', WITHDRAWN: '已撤回'
}
const VERIFICATION_COPY = {
  INCOMPLETE: '资料待补', NEEDS_REVIEW: '待人工核验', NEEDS_CONFIRMATION: '待你确认',
  VERIFIED: '已核验', SUCCEEDED: '识别完成', FAILED: '识别失败，待人工核验'
}
const DOCUMENT_COPY = {
  RESUME: '个人简历', TRANSCRIPT: '本科成绩单', LANGUAGE: '语言成绩', ENROLLMENT: '在读证明',
  GRADUATION: '毕业证书', DEGREE: '学位证书', SUPPLEMENTAL: '补充证明'
}
const FIELD_COPY = {
  name: '姓名／称呼', adultConfirmed: '成年确认', contact: '联系方式', institution: '本科院校', major: '本科专业',
  degree: '学位名称', graduationYear: '毕业年份', graduationDate: '毕业年月', averageScore: '百分制均分',
  academicScore: '学业成绩', gpa: 'GPA', gpaScale: 'GPA 满分制', classRank: '专业排名', language: '语言成绩',
  languageType: '语言考试类型', languageScores: '语言分数', targetYear: '入学年份', targetMajors: '意向专业',
  targetInstitutions: '意向院校', targetPreference: '目标偏好', experiences: '相关经历'
}
function errorText(error) { return error && error.message || '状态暂时无法读取，请稍后重试' }
function sessionUserId() {
  const user = session.currentUser()
  return String(user && (user.id || user.userId) || '')
}
function copyFor(value, dictionary, fallback) {
  const code = String(value || '').toUpperCase()
  return dictionary[code] || fallback
}
function missingFieldLabel(value) {
  const code = String(value || '')
  return FIELD_COPY[code] || FIELD_COPY[code.toLowerCase()] || (/[一-鿿]/.test(code) ? code : '待补资料')
}
function missingDocumentLabel(value) {
  const code = String(value || '').toUpperCase()
  return DOCUMENT_COPY[code] || (/[一-鿿]/.test(String(value || '')) ? String(value) : '待补材料')
}
function documentPresentation(document) {
  const value = model.normalizeDocument(document)
  return {
    ...value,
    uploadStatusLabel: copyFor(value.uploadStatus, { UPLOADED: '已上传', UPLOADING: '上传中', FAILED: '上传失败', REMOVED: '已撤除' }, '上传状态待核验'),
    parseStatusLabel: copyFor(value.parseStatus, { PENDING: '待识别', PROCESSING: '识别中', RUNNING: '识别中', SUCCEEDED: '已识别', NEEDS_CONFIRMATION: '待你确认', MANUAL_REVIEW: '待人工核验', NEEDS_REVIEW: '待人工核验', FAILED: '识别失败，待人工核验' }, '识别状态待核验')
  }
}
function requestTypes(value) {
  return Array.isArray(value) ? value.map(missingDocumentLabel).filter(Boolean) : []
}

Page({
  data: {
    enabled: config.isEnabled(), loggedIn: false, loginBusy: false, loading: true, submitting: false, withdrawing: false,
    consultationId: '', version: 1, consultation: null, extraction: null, documents: [], missingFields: [], missingDocuments: [],
    missingFieldCodes: [], missingDocumentCodes: [], documentRequestNote: '', documentRequestTypes: [], documentRequestTypesLabel: '',
    statusLabel: '', status: '', verificationStatus: '资料待补', reportAvailable: false, error: ''
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
    this.setData({ consultationId: '', version: 1, consultation: null, extraction: null, documents: [], missingFields: [], missingDocuments: [],
      missingFieldCodes: [], missingDocumentCodes: [], documentRequestNote: '', documentRequestTypes: [], documentRequestTypesLabel: '',
      statusLabel: '', status: '', verificationStatus: '资料待补', reportAvailable: false, error: '' })
  },

  async login() {
    if (this.data.loginBusy) return
    this.setData({ loginBusy: true, error: '' })
    try { await auth.loginFamilyUser(); this.loadedUserId = sessionUserId(); this.setData({ loggedIn: true, consultationId: this.routeConsultationId || this.data.consultationId }); await this.load() }
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
      let extraction = null
      try { extraction = await masters.getExtraction(this.data.consultationId) } catch (error) { extraction = null }
      if (!requestUserId || requestUserId !== sessionUserId()) return
      const status = String(consultation.status || 'DRAFT').toUpperCase()
      const report = consultation.report || consultation.currentReport || null
      const request = consultation.documentRequest || {}
      const missingFieldCodes = Array.isArray(consultation.missingFields) ? consultation.missingFields : []
      const missingDocumentCodes = Array.isArray(consultation.missingDocuments) ? consultation.missingDocuments : []
      this.setData({
        consultation, version: Number(consultation.version || consultation.profileVersion || 1), status,
        statusLabel: STATUS_COPY[status] || '处理中', verificationStatus: VERIFICATION_COPY[String(consultation.verificationStatus || 'INCOMPLETE').toUpperCase()] || '资料待核验',
        documents: (consultation.documents || []).map(documentPresentation),
        missingFields: missingFieldCodes.map(missingFieldLabel), missingDocuments: missingDocumentCodes.map(missingDocumentLabel), missingFieldCodes, missingDocumentCodes, documentRequestNote: String(request.note || ''), documentRequestTypes: requestTypes(request.types), documentRequestTypesLabel: requestTypes(request.types).join('、'), extraction,
        reportAvailable: Boolean(report && String(report.status || '').toUpperCase() === 'RELEASED'), loading: false
      })
    } catch (error) { this.setData({ loading: false, error: errorText(error) }) }
  },

  async submit() {
    if (this.data.submitting) return
    if (!['DRAFT', 'NEEDS_INFO'].includes(this.data.status)) return wx.showToast({ title: '当前状态不能重复提交', icon: 'none' })
    this.setData({ submitting: true, error: '' })
    try {
      const consultation = await masters.submitConsultation(this.data.consultationId, this.data.version, masters.createIdempotencyKey('submit'))
      const submittedStatus = String(consultation.status || '').toUpperCase()
      const submittedFieldCodes = Array.isArray(consultation.missingFields) ? consultation.missingFields : this.data.missingFieldCodes
      const submittedDocumentCodes = Array.isArray(consultation.missingDocuments) ? consultation.missingDocuments : this.data.missingDocumentCodes
      this.setData({ consultation, status: submittedStatus, statusLabel: STATUS_COPY[submittedStatus] || '处理中', version: Number(consultation.version || consultation.profileVersion || this.data.version), missingFields: submittedFieldCodes.map(missingFieldLabel), missingDocuments: submittedDocumentCodes.map(missingDocumentLabel), missingFieldCodes: submittedFieldCodes, missingDocumentCodes: submittedDocumentCodes })
      wx.showToast({ title: '咨询已提交到服务端', icon: 'success' })
      await this.load()
    } catch (error) { this.setData({ error: errorText(error) }); wx.showModal({ title: '提交未完成', content: errorText(error), showCancel: false }) }
    finally { this.setData({ submitting: false }) }
  },

  openMaterials() { wx.navigateTo({ url: `/pages/masters-materials/index?id=${encodeURIComponent(this.data.consultationId)}&path=GUIDED` }) },
  openReport() { if (this.data.reportAvailable) wx.navigateTo({ url: `/pages/masters-report/index?id=${encodeURIComponent(this.data.consultationId)}` }) },

  withdraw() {
    if (this.data.withdrawing) return
    wx.showModal({ title: '撤回这份咨询？', content: '撤回后会停止未完成的处理；服务端会保留必要审计记录。', confirmText: '确认撤回', success: async ({ confirm }) => {
      if (!confirm) return
      this.setData({ withdrawing: true, error: '' })
      try {
        const consultation = await masters.withdrawConsultation(this.data.consultationId, this.data.version)
        this.setData({ consultation, status: consultation.status, statusLabel: STATUS_COPY[consultation.status] || consultation.status })
        wx.showToast({ title: '已撤回咨询', icon: 'success' })
      } catch (error) { this.setData({ error: errorText(error) }); wx.showToast({ title: errorText(error), icon: 'none' }) }
      finally { this.setData({ withdrawing: false }) }
    } })
  },

  back() { wx.navigateBack({ delta: 1 }) },
  retry() { return this.load() }
})

module.exports = { STATUS_COPY, errorText }
