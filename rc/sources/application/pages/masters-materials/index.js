const auth = require('../../services/auth')
const config = require('../../config/masters')
const masters = require('../../services/masters')
const model = require('../../models/masters-intake')
const labels = require('../../models/masters-labels')
const session = require('../../services/session')
const api = require('../../services/api')

const CONTACT_OPTIONS = [
  { value: 'phone', label: '手机' }, { value: 'wechat', label: '微信' }, { value: 'email', label: '邮箱' }
]
const LANGUAGE_OPTIONS = [
  { value: 'NONE', label: '暂无语言成绩' }, { value: 'IELTS', label: '雅思 IELTS' },
  { value: 'TOEFL', label: '托福 TOEFL' }, { value: 'OTHER', label: '其他语言考试' }
]
const EXPERIENCE_OPTIONS = model.EXPERIENCE_TYPES
const EXPERIENCE_LABELS = Object.freeze(EXPERIENCE_OPTIONS.reduce((result, item) => ({ ...result, [item.value]: item.label }), {}))
const GUIDED_STEPS = [
  { value: 'education', label: '教育背景' },
  { value: 'academics', label: '成绩与语言' },
  { value: 'target', label: '申请意向' },
  { value: 'experience', label: '相关经历' }
]
function errorMessage(error, fallback = '操作未完成，请稍后重试') { return (error && error.message) || fallback }
function isCancel(error) { return /cancel|取消/i.test(String(error && (error.errMsg || error.message || error.code) || '')) }
function fileKey(file, index) { return String(file.id || file.documentId || file.localId || `${Date.now()}_${index}`) }
function safeNumber(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback }
function targetYearOptionsFor(value) {
  const candidate = String(value || '')
  if (!candidate || candidate === model.TARGET_YEAR_UNDECIDED || model.TARGET_YEAR_OPTIONS.some((item) => item.value === candidate)) return model.TARGET_YEAR_OPTIONS
  return [{ value: candidate, label: candidate }].concat(model.TARGET_YEAR_OPTIONS)
}
function targetYearIndex(value, options = model.TARGET_YEAR_OPTIONS) {
  const index = options.findIndex((item) => item.value === String(value || ''))
  return index >= 0 ? index : options.length - 1
}
function sessionUserId() {
  const user = session.currentUser()
  return String(user && (user.id || user.userId) || '')
}

const EXTRACTABLE_PROFILE_FIELDS = new Set([
  'name', 'institution', 'degree', 'major', 'graduationYear', 'graduationDate',
  'averageScore', 'gpa', 'gpaScale', 'classRank', 'languageType', 'languageStatus',
  'languageScores.total', 'languageScores.examDate', 'languageScores.raw',
  'languageScores.subscores.listening', 'languageScores.subscores.reading',
  'languageScores.subscores.writing', 'languageScores.subscores.speaking',
  'targetYear', 'targetMajors', 'targetInstitutions', 'targetPreference', 'contact.value'
])
const RESUME_FACT_EDITABLE_FIELDS = new Set([
  'name', 'institution', 'degree', 'major', 'graduationYear', 'graduationDate',
  'averageScore', 'gpa', 'gpaScale', 'classRank', 'targetYear', 'targetMajors',
  'targetInstitutions', 'targetPreference', 'contact.value'
])

function extractionFieldName(field) {
  const name = String(field || '').replace(/^profile\./, '')
  return EXTRACTABLE_PROFILE_FIELDS.has(name) ? name : ''
}

function getProfileFact(profile, field) {
  const normalized = extractionFieldName(field)
  if (!normalized) return undefined
  return normalized.split('.').reduce((cursor, key) => cursor && cursor[key], profile)
}

function hasProfileFact(value) {
  if (Array.isArray(value)) return value.length > 0
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function profileFactDisplayValue(profile, field) {
  const value = getProfileFact(profile, field)
  return Array.isArray(value) ? value.join('、') : String(value === undefined || value === null ? '' : value)
}

function profileFactsEqual(existing, value, field) {
  if (Array.isArray(existing)) {
    const candidate = model.normalizeProfile({ [field]: value })[field]
    return Array.isArray(candidate) && existing.join('、') === candidate.join('、')
  }
  return String(existing === undefined || existing === null ? '' : existing).trim() === String(value === undefined || value === null ? '' : value).trim()
}

function setProfileFact(profile, field, value) {
  const normalized = extractionFieldName(field)
  if (!normalized) return { profile, changed: false }
  const current = getProfileFact(profile, normalized)
  if (hasProfileFact(current)) return { profile, changed: false }
  const next = model.normalizeProfile(profile)
  const parts = normalized.split('.')
  let cursor = next
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      if (part === 'targetMajors' || part === 'targetInstitutions') cursor[part] = model.normalizeProfile({ [part]: value })[part]
      else cursor[part] = String(value === undefined || value === null ? '' : value)
    } else {
      cursor[part] = { ...cursor[part] }
      cursor = cursor[part]
    }
  })
  return { profile: next, changed: true }
}

function preserveProfile(existing, fallback) {
  const current = model.normalizeProfile(existing)
  const next = model.normalizeProfile(fallback)
  const scalarFields = [
    'name', 'institution', 'degree', 'major', 'graduationYear', 'graduationDate',
    'averageScore', 'gpa', 'gpaScale', 'classRank', 'languageType', 'languageStatus',
    'targetYear', 'targetPreference'
  ]
  scalarFields.forEach((field) => { if (hasProfileFact(current[field])) next[field] = current[field] })
  if (current.contact.value.trim()) next.contact = { ...next.contact, ...current.contact }
  if (current.targetMajors.length) next.targetMajors = current.targetMajors.slice()
  if (current.targetInstitutions.length) next.targetInstitutions = current.targetInstitutions.slice()
  if (current.experiences.length) next.experiences = current.experiences.slice()
  if (current.adultConfirmed) next.adultConfirmed = true
  if (current.accuracyConfirmed) next.accuracyConfirmed = true
  const scoreFields = ['total', 'examDate', 'raw']
  scoreFields.forEach((field) => { if (current.languageScores[field].trim()) next.languageScores[field] = current.languageScores[field] })
  Object.keys(current.languageScores.subscores).forEach((field) => {
    if (current.languageScores.subscores[field].trim()) next.languageScores.subscores[field] = current.languageScores.subscores[field]
  })
  return next
}

function extractionView(item, profile) {
  const field = String(item && item.field || '')
  const existing = getProfileFact(profile, field)
  const rawValue = item && item.value
  const valueLabel = rawValue === undefined || rawValue === null || (typeof rawValue === 'string' && !rawValue.trim())
    ? '待补'
    : field === 'targetYear'
      ? labels.targetYearLabel(rawValue)
      : field === 'languageType' && String(rawValue).toUpperCase() === 'OTHER' ? '其他语言考试'
        : Array.isArray(rawValue) ? rawValue.map((value) => labels.studentValue(value)).join('、') : labels.studentValue(rawValue)
  return {
    ...item,
    field,
    label: labels.fieldLabel(field),
    valueLabel,
    sourceLabel: item && (item.sourceName || item.source) || '上传材料',
    locationLabel: item && (item.location || item.snippet) || '位置待核验',
    decisionLabel: item && item.accepted === true ? '已接受' : item && item.accepted === false ? '已拒绝' : '待你确认',
    existing: hasProfileFact(existing),
    existingLabel: hasProfileFact(existing) ? (Array.isArray(existing) ? existing.join('、') : labels.studentValue(existing)) : ''
  }
}

Page({
  data: {
    enabled: config.isEnabled(), loggedIn: false, loginBusy: false, loading: true, saving: false,
    consultationId: '', path: 'GUIDED', channel: 'organic', version: 1,
    profile: model.emptyProfile(), documents: [], cards: [], hiddenDocuments: [],
    supplementalExpanded: false, supplementalDescription: '', serviceConsent: false, contactOptions: CONTACT_OPTIONS,
    contactTypeIndex: 0, languageOptions: LANGUAGE_OPTIONS, languageTypeIndex: 0,
    experienceOptions: EXPERIENCE_OPTIONS, experienceLabels: EXPERIENCE_LABELS, error: '', fieldErrors: {}, extraction: null,
    extractionFields: [], extractionError: '', applyingExtractionField: '', retentionDays: config.retentionDays(),
    uploadConfigReady: false, uploadConfigError: '', serviceConsentText: '',
    pendingUploads: 0, retryingDocumentId: '', lastSavedAt: '',
    guidedSteps: GUIDED_STEPS, guidedStep: 0, guidedStepLabel: GUIDED_STEPS[0].label,
    showFullProfile: false, showMissingProfile: false, missingEditFields: [], missingEditName: false, missingEditAdult: false, missingEditContact: false, missingEditInstitution: false, missingEditMajor: false, resumeEditingField: '', resumeEditingLabel: '', resumeEditingValue: '',
    targetYearOptions: model.TARGET_YEAR_OPTIONS, targetYearIndex: targetYearIndex(model.TARGET_YEAR_UNDECIDED),
    resumeReview: model.buildResumeReview(model.emptyProfile(), [], [])
  },

  onLoad(options = {}) {
    this.options = options
    this.routeConsultationId = String(options.id || '')
    const path = config.path(options.path)
    this.setData({
      path, channel: config.channel(options.channel), consultationId: this.routeConsultationId,
      enabled: config.isEnabled(), guidedStep: 0, guidedStepLabel: GUIDED_STEPS[0].label,
      showFullProfile: false, showMissingProfile: false, missingEditFields: [], missingEditName: false, missingEditAdult: false, missingEditContact: false, missingEditInstitution: false, missingEditMajor: false, resumeEditingField: '', resumeEditingLabel: '', resumeEditingValue: '',
      targetYearOptions: model.TARGET_YEAR_OPTIONS, targetYearIndex: targetYearIndex(model.TARGET_YEAR_UNDECIDED)
    })
  },

  onShow() {
    if (!config.isEnabled()) { this.setData({ enabled: false, loading: false }); return }
    const user = session.currentUser()
    const userId = String(user && (user.id || user.userId) || '')
    if (!userId) {
      const hadUser = Boolean(this.loadedUserId)
      this.clearSensitiveState(hadUser)
      this.loadedUserId = ''
      this.loadedForUser = false
      this.setData({ loggedIn: false, loading: false })
      return
    }
    if (this.loadedUserId && this.loadedUserId !== userId) this.clearSensitiveState(true)
    this.setData({ loggedIn: true })
    if (this.loadedForUser && this.loadedUserId === userId) return
    this.loadedUserId = userId
    this.loadedForUser = true
    if (!this.data.consultationId && this.routeConsultationId) this.setData({ consultationId: this.routeConsultationId })
    this.loadConsultation()
  },

  clearSensitiveState(clearRoute = false) {
    if (clearRoute) this.routeConsultationId = ''
    this.guidedOverride = false
    this.setData({ consultationId: '', version: 1, profile: model.emptyProfile(), documents: [], cards: [], hiddenDocuments: [],
      extraction: null, extractionFields: [], extractionError: '', serviceConsent: false, fieldErrors: {}, error: '',
      pendingUploads: 0, retryingDocumentId: '', applyingExtractionField: '', supplementalDescription: '', uploadConfigReady: false, uploadConfigError: '',
      showFullProfile: false, showMissingProfile: false, missingEditFields: [], missingEditName: false, missingEditAdult: false, missingEditContact: false, missingEditInstitution: false, missingEditMajor: false, resumeEditingField: '', resumeEditingLabel: '', resumeEditingValue: '', guidedStep: 0, guidedStepLabel: GUIDED_STEPS[0].label,
      targetYearOptions: model.TARGET_YEAR_OPTIONS, targetYearIndex: targetYearIndex(model.TARGET_YEAR_UNDECIDED), resumeReview: model.buildResumeReview(model.emptyProfile(), [], []) })
  },

  async login() {
    if (this.data.loginBusy) return
    this.setData({ loginBusy: true, error: '' })
    try {
      await auth.loginFamilyUser()
      this.loadedUserId = sessionUserId()
      this.setData({ loggedIn: true, consultationId: this.routeConsultationId || this.data.consultationId })
      this.loadedForUser = false
      await this.loadConsultation()
    } catch (error) {
      this.setData({ error: errorMessage(error, '登录未完成') })
      wx.showToast({ title: errorMessage(error, '登录未完成'), icon: 'none' })
    } finally { this.setData({ loginBusy: false }) }
  },

  async loadConsultation() {
    if (!this.data.loggedIn) return
    const requestUserId = sessionUserId()
    this.setData({ loading: true, error: '' })
    try {
      await this.loadUploadConfiguration()
      if (!requestUserId || requestUserId !== sessionUserId()) return
      const id = this.data.consultationId || masters.draftId()
      if (!id) {
        const profile = model.emptyProfile()
        this.setData({ loading: false, profile, documents: [], ...this.presentation([], profile.educationStatus), extraction: null, extractionFields: [], extractionError: '' })
        return
      }
      const consultation = await masters.getConsultation(id)
      if (!requestUserId || requestUserId !== sessionUserId()) return
      this.applyConsultation(consultation)
      this.loadExtraction()
    } catch (error) {
      // A stale opaque draft id must not prevent a new consultation; no local
      // profile is stored, so clearing this pointer cannot erase user data.
      if (error && Number(error.statusCode) === 404) {
        masters.clearDraftId(this.data.consultationId)
        this.setData({ consultationId: '', loading: false })
      } else {
        this.setData({ loading: false, error: errorMessage(error, '咨询草稿暂时无法读取') })
      }
    }
  },

  async loadUploadConfiguration() {
    const requestUserId = sessionUserId()
    try {
      const value = await api.request('/v1/masters/capabilities')
      if (!requestUserId || requestUserId !== sessionUserId()) return false
      if (value.contractVersion !== 'masters-intake-v1.1' || value.consentVersion !== config.SERVICE_CONSENT_VERSION || typeof value.serviceConsentText !== 'string' || !value.serviceConsentText.trim() || value.maxFileBytes !== model.MAX_DOCUMENT_SIZE || value.maxDocuments !== model.MAX_DOCUMENTS ||
        !Number.isInteger(value.retentionDays) || value.retentionDays < 1 || value.retentionDays > 90) throw new Error('上传规则版本不匹配，请更新后重试')
      this.setData({ uploadConfigReady: true, uploadConfigError: '', retentionDays: value.retentionDays, serviceConsentText: value.serviceConsentText })
      return true
    } catch (error) {
      if (requestUserId === sessionUserId()) this.setData({ uploadConfigReady: false, uploadConfigError: errorMessage(error, '上传规则暂时无法读取') })
      return false
    }
  },

  applyConsultation(consultation) {
    const profile = model.normalizeProfile(consultation.profile)
    const documents = (consultation.documents || []).map(model.normalizeDocument)
    const version = safeNumber(consultation.version || consultation.profileVersion, 1)
    // Public consultation details may intentionally omit the consent record.
    // Keep the current-page checkbox in that case instead of silently clearing
    // an accepted consent after a create/save/upload response.
    const consentKnown = consultation.consent !== null && consultation.consent !== undefined
    const consent = consentKnown
      ? Boolean(consultation.consent && (consultation.consent.accepted || consultation.consent.service || !consultation.consent.withdrawnAt))
      : Boolean(this.data.serviceConsent)
    this.setData({
      consultationId: consultation.id || consultation.consultationId,
      path: this.guidedOverride ? 'GUIDED' : config.path(consultation.path || this.data.path), channel: config.channel(consultation.channel || this.data.channel),
      version, profile, documents, serviceConsent: consent,
      targetMajorsText: profile.targetMajors.join('、'), targetInstitutionsText: profile.targetInstitutions.join('、'),
      contactTypeIndex: Math.max(0, CONTACT_OPTIONS.findIndex((item) => item.value === profile.contact.type)),
      languageTypeIndex: Math.max(0, LANGUAGE_OPTIONS.findIndex((item) => item.value === profile.languageType)),
      targetYearOptions: targetYearOptionsFor(profile.targetYear), targetYearIndex: targetYearIndex(profile.targetYear, targetYearOptionsFor(profile.targetYear)),
      loading: false, error: '',
      ...this.presentation(documents, profile.educationStatus),
      resumeReview: model.buildResumeReview(profile, documents, this.data.extractionFields)
    })
    if (consultation.id || consultation.consultationId) masters.rememberDraftId(consultation.id || consultation.consultationId)
  },

  async loadExtraction() {
    if (!this.data.consultationId) return
    const requestUserId = sessionUserId()
    try {
      const extraction = await masters.getExtraction(this.data.consultationId)
      if (!requestUserId || requestUserId !== sessionUserId()) return
      const extractionFields = (extraction.fields || []).map((item) => extractionView(item, this.data.profile))
      this.setData({ extraction, extractionError: '', extractionFields, resumeReview: model.buildResumeReview(this.data.profile, this.data.documents, extractionFields) })
    } catch (error) {
      if (!requestUserId || requestUserId !== sessionUserId()) return
      this.setData({ extraction: null, extractionFields: [], extractionError: errorMessage(error, '识别结果暂时无法读取'), resumeReview: model.buildResumeReview(this.data.profile, this.data.documents, []) })
    }
  },

  retryExtractionLoad() { return this.loadExtraction() },

  async adoptExtraction({ currentTarget }) {
    const index = safeNumber(currentTarget && currentTarget.dataset && currentTarget.dataset.index)
    const item = this.data.extractionFields[index]
    if (!item || !item.documentId || !extractionFieldName(item.field)) return wx.showToast({ title: '识别字段或来源不完整，需人工核验', icon: 'none' })
    if (this.data.applyingExtractionField) return
    const localProfile = model.normalizeProfile(this.data.profile)
    const existing = getProfileFact(localProfile, item.field)
    if (hasProfileFact(existing) && !profileFactsEqual(existing, item.value, extractionFieldName(item.field))) {
      return wx.showToast({ title: '已有填写未被覆盖，请在核对页确认是否替换', icon: 'none' })
    }
    const requestUserId = sessionUserId()
    this.setData({ applyingExtractionField: item.field, error: '' })
    try {
      const resolved = await masters.resolveExtraction(this.data.consultationId, {
        version: this.data.version, documentId: item.documentId, field: item.field, value: item.value, accepted: true
      }, masters.createIdempotencyKey('extraction'))
      if (!requestUserId || requestUserId !== sessionUserId()) return
      if (resolved && resolved.id) {
        resolved.profile = preserveProfile(localProfile, resolved.profile)
        this.applyConsultation(resolved)
      }
      await this.loadExtraction()
      wx.showToast({ title: '已采用识别结果并保留其他填写', icon: 'success' })
    } catch (error) {
      this.setData({ error: errorMessage(error, '采用识别结果失败') })
      wx.showToast({ title: errorMessage(error, '采用识别结果失败'), icon: 'none' })
    } finally { this.setData({ applyingExtractionField: '' }) }
  },

  async rejectExtraction({ currentTarget }) {
    const index = safeNumber(currentTarget && currentTarget.dataset && currentTarget.dataset.index)
    const item = this.data.extractionFields[index]
    if (!item || !item.documentId) return wx.showToast({ title: '识别来源不完整，需人工核验', icon: 'none' })
    if (this.data.applyingExtractionField) return
    const requestUserId = sessionUserId()
    this.setData({ applyingExtractionField: item.field, error: '' })
    try {
      const localProfile = model.normalizeProfile(this.data.profile)
      const resolved = await masters.resolveExtraction(this.data.consultationId, {
        version: this.data.version, documentId: item.documentId, field: item.field, value: item.value, accepted: false
      }, masters.createIdempotencyKey('extraction'))
      if (!requestUserId || requestUserId !== sessionUserId()) return
      if (resolved && resolved.id) {
        resolved.profile = preserveProfile(localProfile, resolved.profile)
        this.applyConsultation(resolved)
      }
      await this.loadExtraction()
      wx.showToast({ title: '已拒绝该识别结果', icon: 'none' })
    } catch (error) {
      this.setData({ error: errorMessage(error, '拒绝识别结果失败') })
      wx.showToast({ title: errorMessage(error, '拒绝识别结果失败'), icon: 'none' })
    } finally { this.setData({ applyingExtractionField: '' }) }
  },

  presentation(documents = this.data.documents, status = this.data.profile.educationStatus) {
    const result = model.buildMaterialCards(documents, status, this.data.supplementalExpanded)
    return { cards: result.cards, hiddenDocuments: result.hiddenDocuments, totalDocumentCount: result.totalCount, totalDocumentSizeLabel: result.totalSizeLabel }
  },

  refreshResumeReview(profile = this.data.profile, documents = this.data.documents, extractionFields = this.data.extractionFields) {
    this.setData({ resumeReview: model.buildResumeReview(profile, documents, extractionFields) })
  },

  ensureLoggedIn() {
    if (session.currentUser()) return true
    this.setData({ loggedIn: false })
    wx.showToast({ title: '请先登录，登录后会回到当前页', icon: 'none' })
    return false
  },

  async ensureConsultation() {
    if (this.data.consultationId) return this.data.consultationId
    if (!this.data.serviceConsent) {
      wx.showToast({ title: '上传或保存前请先同意资料处理说明', icon: 'none' })
      return ''
    }
    const localProfile = model.normalizeProfile(this.data.profile)
    const consultation = await masters.createConsultation({
      targetYear: this.data.profile.targetYear || model.TARGET_YEAR_UNDECIDED,
      channel: this.data.channel, path: this.data.path,
      serviceConsent: { accepted: true, copyVersion: config.SERVICE_CONSENT_VERSION }
    }, masters.createIdempotencyKey('create'))
    this.applyConsultation(consultation)
    // Creation commonly returns an empty profile. Keep unsaved edits in
    // memory until the explicit save PATCH; never put those fields in storage.
    this.setData({ profile: localProfile, targetMajorsText: localProfile.targetMajors.join('、'), targetInstitutionsText: localProfile.targetInstitutions.join('、') })
    this.refreshResumeReview(localProfile, this.data.documents, this.data.extractionFields)
    return consultation.id
  },

  onServiceConsentChange({ detail }) {
    const accepted = Array.isArray(detail && detail.value) && detail.value.includes('service')
    this.setData({ serviceConsent: accepted })
    if (!accepted || !this.ensureLoggedIn()) return
    this.ensureConsultation().catch((error) => {
      this.setData({ error: errorMessage(error, '咨询草稿创建失败') })
    })
  },

  onFieldInput({ currentTarget, detail }) {
    const field = String(currentTarget && currentTarget.dataset && currentTarget.dataset.field || '')
    const value = detail && detail.value !== undefined ? detail.value : ''
    if (!field) return
    if (field === 'contact.value') this.setData({ 'profile.contact.value': String(value) })
    else if (field === 'targetMajors') this.setData({ targetMajorsText: String(value), 'profile.targetMajors': model.normalizeProfile({ targetMajors: value }).targetMajors })
    else if (field === 'targetInstitutions') this.setData({ targetInstitutionsText: String(value), 'profile.targetInstitutions': model.normalizeProfile({ targetInstitutions: value }).targetInstitutions })
    else if (field.indexOf('languageScores.subscores.') === 0) this.setData({ [`profile.${field}`]: String(value) })
    else this.setData({ [`profile.${field}`]: String(value) })
    this.refreshResumeReview()
  },

  adultChange({ detail }) {
    const values = Array.isArray(detail && detail.value) ? detail.value : []
    this.setData({ 'profile.adultConfirmed': values.includes('true') || values.includes('adult') || detail.value === true })
    this.refreshResumeReview()
  },

  selectContactType({ detail }) {
    const index = safeNumber(detail && detail.value)
    const option = CONTACT_OPTIONS[index] || CONTACT_OPTIONS[0]
    this.setData({ contactTypeIndex: index, 'profile.contact.type': option.value })
    this.refreshResumeReview()
  },

  educationStatusChange({ detail }) {
    const status = model.EDUCATION_STATUSES.includes(detail && detail.value) ? detail.value : 'ENROLLED'
    this.setData({ 'profile.educationStatus': status, ...this.presentation(this.data.documents, status) })
    this.refreshResumeReview()
  },

  targetYearChange({ detail }) {
    const options = Array.isArray(this.data.targetYearOptions) && this.data.targetYearOptions.length ? this.data.targetYearOptions : model.TARGET_YEAR_OPTIONS
    const index = Math.max(0, Math.min(options.length - 1, safeNumber(detail && detail.value)))
    const option = options[index] || options[options.length - 1]
    this.setData({ targetYearIndex: index, 'profile.targetYear': option.value })
    this.refreshResumeReview()
  },

  languageTypeChange({ detail }) {
    const index = safeNumber(detail && detail.value)
    const option = LANGUAGE_OPTIONS[index] || LANGUAGE_OPTIONS[0]
    this.setData({ languageTypeIndex: index, 'profile.languageType': option.value, 'profile.languageStatus': option.value === 'NONE' ? 'NONE' : 'AVAILABLE' })
    this.refreshResumeReview()
  },

  addExperience() {
    if (this.data.profile.experiences.length >= 20) return wx.showToast({ title: '经历条目最多 20 条', icon: 'none' })
    const experiences = this.data.profile.experiences.concat([{ type: 'INTERNSHIP', title: '', organization: '', description: '', startDate: '', endDate: '' }])
    this.setData({ 'profile.experiences': experiences })
  },

  removeExperience({ currentTarget }) {
    const index = safeNumber(currentTarget && currentTarget.dataset && currentTarget.dataset.index)
    const experiences = this.data.profile.experiences.slice()
    experiences.splice(index, 1)
    this.setData({ 'profile.experiences': experiences })
  },

  experienceTypeChange({ currentTarget, detail }) {
    const index = safeNumber(currentTarget && currentTarget.dataset && currentTarget.dataset.index)
    const value = EXPERIENCE_OPTIONS[safeNumber(detail && detail.value)] || EXPERIENCE_OPTIONS[0]
    this.setData({ [`profile.experiences[${index}].type`]: value.value })
  },

  onExperienceInput({ currentTarget, detail }) {
    const index = safeNumber(currentTarget && currentTarget.dataset && currentTarget.dataset.index)
    const field = String(currentTarget && currentTarget.dataset && currentTarget.dataset.field || 'description')
    this.setData({ [`profile.experiences[${index}].${field}`]: String(detail && detail.value || '') })
  },

  toggleSupplemental() {
    const expanded = !this.data.supplementalExpanded
    const result = model.buildMaterialCards(this.data.documents, this.data.profile.educationStatus, expanded)
    this.setData({ supplementalExpanded: expanded, cards: result.cards, hiddenDocuments: result.hiddenDocuments, totalDocumentCount: result.totalCount, totalDocumentSizeLabel: result.totalSizeLabel })
  },

  supplementalDescriptionChange({ detail }) {
    this.setData({ supplementalDescription: String(detail && detail.value || '').slice(0, 500) })
  },

  async switchToGuided() {
    const previousPath = this.data.path
    if (previousPath !== 'GUIDED' && this.data.consultationId) {
      this.guidedOverride = true
      const saved = await this.saveProfile('GUIDED')
      if (!saved) {
        this.guidedOverride = false
        this.setData({ path: previousPath })
        return false
      }
    } else this.guidedOverride = true
    this.setData({ path: 'GUIDED', guidedStep: 0, guidedStepLabel: GUIDED_STEPS[0].label, showFullProfile: false, showMissingProfile: false, missingEditFields: [], missingEditName: false, missingEditAdult: false, missingEditContact: false, missingEditInstitution: false, missingEditMajor: false, resumeEditingField: '', resumeEditingLabel: '', resumeEditingValue: '' })
    return true
  },

  toggleMissingProfile() {
    if (!this.data.resumeReview.missingFacts.length) return
    const opening = !this.data.showMissingProfile
    const fields = opening ? this.data.resumeReview.missingFacts.map((item) => item.field) : []
    this.setData({ showMissingProfile: opening, missingEditFields: fields, missingEditName: fields.includes('name'), missingEditAdult: fields.includes('adultConfirmed'), missingEditContact: fields.includes('contact'), missingEditInstitution: fields.includes('institution'), missingEditMajor: fields.includes('major'), showFullProfile: false, resumeEditingField: '', resumeEditingLabel: '', resumeEditingValue: '' })
  },

  closeMissingProfile() {
    this.setData({ showMissingProfile: false, missingEditFields: [], missingEditName: false, missingEditAdult: false, missingEditContact: false, missingEditInstitution: false, missingEditMajor: false })
  },

  editResumeFact({ currentTarget }) {
    const field = extractionFieldName(currentTarget && currentTarget.dataset && currentTarget.dataset.field)
    if (!field || !RESUME_FACT_EDITABLE_FIELDS.has(field)) {
      this.setData({ showFullProfile: true, showMissingProfile: false, missingEditFields: [], missingEditName: false, missingEditAdult: false, missingEditContact: false, missingEditInstitution: false, missingEditMajor: false, resumeEditingField: '', resumeEditingLabel: '', resumeEditingValue: '' })
      return
    }
    this.setData({ resumeEditingField: field, resumeEditingLabel: labels.fieldLabel(field), resumeEditingValue: profileFactDisplayValue(this.data.profile, field), showMissingProfile: false, missingEditFields: [], missingEditName: false, missingEditAdult: false, missingEditContact: false, missingEditInstitution: false, missingEditMajor: false, showFullProfile: false })
  },

  onResumeFactInput({ detail }) {
    const field = this.data.resumeEditingField
    if (!field || !RESUME_FACT_EDITABLE_FIELDS.has(field) || field === 'targetYear') return
    const value = String(detail && detail.value !== undefined ? detail.value : '')
    if (field === 'contact.value') this.setData({ 'profile.contact.value': value, resumeEditingValue: value })
    else if (field === 'targetMajors') this.setData({ targetMajorsText: value, 'profile.targetMajors': model.normalizeProfile({ targetMajors: value }).targetMajors, resumeEditingValue: value })
    else if (field === 'targetInstitutions') this.setData({ targetInstitutionsText: value, 'profile.targetInstitutions': model.normalizeProfile({ targetInstitutions: value }).targetInstitutions, resumeEditingValue: value })
    else this.setData({ [`profile.${field}`]: value, resumeEditingValue: value })
    this.refreshResumeReview()
  },

  closeResumeFactEditor() {
    this.setData({ resumeEditingField: '', resumeEditingLabel: '', resumeEditingValue: '' })
  },

  toggleFullProfile() {
    this.setData({ showFullProfile: !this.data.showFullProfile, showMissingProfile: false, missingEditFields: [], missingEditName: false, missingEditAdult: false, missingEditContact: false, missingEditInstitution: false, missingEditMajor: false, resumeEditingField: '', resumeEditingLabel: '', resumeEditingValue: '' })
  },

  setGuidedStepIndex(value) {
    const step = Math.max(0, Math.min(GUIDED_STEPS.length - 1, safeNumber(value)))
    this.setData({ guidedStep: step, guidedStepLabel: GUIDED_STEPS[step].label })
  },

  async setGuidedStep(value) {
    const dataset = value && value.currentTarget && value.currentTarget.dataset
    const raw = dataset && dataset.index !== undefined ? dataset.index : value
    const step = Math.max(0, Math.min(GUIDED_STEPS.length - 1, safeNumber(raw)))
    if (step === this.data.guidedStep) return true
    if (!(await this.saveProfile())) return false
    this.setGuidedStepIndex(step)
    return true
  },

  async previousGuidedStep() {
    if (this.data.guidedStep > 0) return this.setGuidedStep(this.data.guidedStep - 1)
    return false
  },

  async nextGuidedStep() {
    if (this.data.guidedStep < GUIDED_STEPS.length - 1) return this.setGuidedStep(this.data.guidedStep + 1)
    const saved = await this.saveProfile()
    if (saved) wx.showToast({ title: '四步资料已保存，可继续核对或提交', icon: 'success' })
    return saved
  },

  async selectUpload({ currentTarget }) {
    if (this.data.pendingUploads) return wx.showToast({ title: '已有材料上传中，请等待完成', icon: 'none' })
    if (!this.ensureLoggedIn()) return
    if (!this.data.uploadConfigReady && !(await this.loadUploadConfiguration())) return wx.showToast({ title: '请先重新读取上传规则', icon: 'none' })
    const type = config.documentType(currentTarget && currentTarget.dataset && currentTarget.dataset.type)
    const source = String(currentTarget && currentTarget.dataset && currentTarget.dataset.source || 'file')
    try {
      if (!this.data.serviceConsent) {
        wx.showToast({ title: '上传前请先勾选服务同意', icon: 'none' }); return
      }
      await this.ensureConsultation()
      if (!this.data.consultationId) return
      const replaceId = String(currentTarget && currentTarget.dataset && currentTarget.dataset.replaceId || '')
      const existingCount = this.data.documents.filter((item) => item.id && item.id !== replaceId && item.uploadStatus !== 'REMOVED').length
      if (existingCount >= model.MAX_DOCUMENTS && !replaceId) {
        wx.showToast({ title: '每份咨询最多保存 20 份材料', icon: 'none' }); return
      }
      const remaining = replaceId ? 1 : Math.max(1, model.MAX_DOCUMENTS - existingCount)
      const files = source === 'image' ? await masters.chooseImages(remaining) : await masters.chooseMessageFiles(remaining)
      if (!files.length) return
      await this.uploadFiles(
        type,
        files,
        replaceId,
        '',
        type === 'SUPPLEMENTAL' ? this.data.supplementalDescription.trim() : currentTarget && currentTarget.dataset && currentTarget.dataset.description
      )
    } catch (error) {
      if (!isCancel(error)) {
        this.setData({ error: errorMessage(error, '材料选择或上传失败') })
        wx.showToast({ title: errorMessage(error, '上传失败'), icon: 'none' })
      }
    }
  },

  async uploadFiles(type, files, replaceId = '', retryLocalId = '', description = '') {
    const selectedFiles = Array.isArray(files) ? files : []
    const requestUserId = sessionUserId()
    const draftProfile = model.normalizeProfile(this.data.profile)
    let documents = this.data.documents.slice()
    for (let index = 0; index < selectedFiles.length; index += 1) {
      const selected = selectedFiles[index] || {}
      const path = selected.tempFilePath || selected.path || selected.filePath || ''
      const name = selected.name || selected.fileName || path.split(/[\\/]/).pop()
      const localId = `local_${Date.now()}_${index}`
        const placeholder = model.normalizeDocument({ localId, name, fileName: name, size: selected.size, mimeType: selected.type, type, description: description || selected.description || '', uploadStatus: 'UPLOADING', parseStatus: 'PENDING' })
      placeholder.localPath = path
      placeholder.uploadError = ''
      documents = retryLocalId
        ? documents.map((item) => item.localId === retryLocalId ? placeholder : item)
        : documents.concat([placeholder])
      this.setData({ documents, pendingUploads: this.data.pendingUploads + 1, ...this.presentation(documents, this.data.profile.educationStatus) })
      try {
        const result = await masters.uploadDocument(this.data.consultationId, { filePath: path, name, size: selected.size, mimeType: selected.type }, {
          version: this.data.version, type, existingDocuments: documents.filter((item) => item.id && item.id !== replaceId && item.uploadStatus !== 'REMOVED'), idempotencyKey: masters.createIdempotencyKey('document'),
          replaceDocumentId: replaceId || undefined, description: description || selected.description || undefined
        })
        if (!requestUserId || requestUserId !== sessionUserId()) return
        const uploaded = model.normalizeDocument(result.document)
        uploaded.localPath = path
        uploaded.uploadError = ''
        documents = documents.map((item) => item.localId === localId ? uploaded : item)
        if (result.consultation && result.consultation.id) {
          const consultation = model.normalizeConsultation(result.consultation)
          if (!consultation.documents.some((item) => item.id === uploaded.id)) consultation.documents.push(uploaded)
          this.applyConsultation(consultation)
          // Upload responses may include a refreshed consultation snapshot.
          // Keep edits made before file selection until the user explicitly
          // saves the profile, so an upload cannot discard an in-memory draft.
          this.setData({ profile: draftProfile, targetMajorsText: draftProfile.targetMajors.join('、'), targetInstitutionsText: draftProfile.targetInstitutions.join('、') })
          this.refreshResumeReview(draftProfile, this.data.documents, this.data.extractionFields)
        }
        else this.setData({ documents, ...this.presentation(documents, this.data.profile.educationStatus), resumeReview: model.buildResumeReview(this.data.profile, documents, this.data.extractionFields) })
        this.loadExtraction()
      } catch (error) {
        if (!requestUserId || requestUserId !== sessionUserId()) return
        documents = documents.map((item) => item.localId === localId ? { ...item, uploadStatus: 'FAILED', uploadError: errorMessage(error, '上传失败') } : item)
        this.setData({ documents, error: errorMessage(error, '上传失败'), ...this.presentation(documents, this.data.profile.educationStatus), resumeReview: model.buildResumeReview(this.data.profile, documents, this.data.extractionFields) })
      } finally {
        if (requestUserId && requestUserId === sessionUserId()) this.setData({ pendingUploads: Math.max(0, this.data.pendingUploads - 1) })
      }
    }
  },

  retryUpload({ currentTarget }) {
    const id = String(currentTarget && currentTarget.dataset && currentTarget.dataset.id || '')
    const document = this.data.documents.find((item) => (item.localId || item.id) === id)
    if (!document || !document.localPath) return wx.showToast({ title: '请重新选择文件后重试', icon: 'none' })
    this.uploadFiles(document.type, [{ tempFilePath: document.localPath, name: document.name, size: document.size, type: document.mimeType, description: document.description }], '', document.localId, document.description)
  },

  async retryExtraction({ currentTarget }) {
    const id = String(currentTarget && currentTarget.dataset && currentTarget.dataset.id || '')
    const document = this.data.documents.find((item) => item.id === id)
    if (!document || !document.id) return wx.showToast({ title: '附件编号尚未确认，暂不能重试识别', icon: 'none' })
    if (this.data.retryingDocumentId) return
    const requestUserId = sessionUserId()
    this.setData({ retryingDocumentId: id, error: '' })
    try {
      const result = await masters.retryDocumentExtraction(this.data.consultationId, id, this.data.version, masters.createIdempotencyKey('extraction-retry'))
      if (!requestUserId || requestUserId !== sessionUserId()) return
      const retried = result && result.document ? model.normalizeDocument(result.document) : null
      if (result && result.consultation && result.consultation.id) {
        const consultation = model.normalizeConsultation(result.consultation)
        if (retried && !consultation.documents.some((item) => item.id === retried.id)) consultation.documents.push(retried)
        this.applyConsultation(consultation)
      } else if (retried) {
        const documents = this.data.documents.map((item) => item.id === retried.id ? { ...item, ...retried } : item)
        this.setData({ documents, ...this.presentation(documents, this.data.profile.educationStatus) })
      } else {
        throw new Error('服务端未返回识别状态')
      }
      await this.loadExtraction()
      wx.showToast({ title: '已重新提交识别', icon: 'success' })
    } catch (error) {
      this.setData({ error: errorMessage(error, '识别重试失败') })
      wx.showToast({ title: errorMessage(error, '识别重试失败'), icon: 'none' })
    } finally { this.setData({ retryingDocumentId: '' }) }
  },

  keepForManualReview({ currentTarget }) {
    const id = String(currentTarget && currentTarget.dataset && currentTarget.dataset.id || '')
    if (!id) return
    const documents = this.data.documents.map((item) => item.id === id ? { ...item, manualReviewAcknowledged: true } : item)
    this.setData({ documents, ...this.presentation(documents, this.data.profile.educationStatus) })
    wx.showToast({ title: '已保留原件，等待人工核验', icon: 'none' })
  },

  replaceUpload({ currentTarget }) {
    const type = String(currentTarget && currentTarget.dataset && currentTarget.dataset.type || '')
    const replaceId = String(currentTarget && currentTarget.dataset && currentTarget.dataset.id || '')
    this.selectUpload({ currentTarget: { dataset: { type, replaceId, source: 'file' } } })
  },

  async removeDocumentById(documentId, options = {}) {
    const id = String(documentId || '')
    if (!id) return
    const local = this.data.documents.find((item) => String(item.localId || '') === id && !item.id)
    if (local) {
      const documents = this.data.documents.filter((item) => String(item.localId || '') !== id)
      this.setData({ documents, pendingUploads: Math.max(0, this.data.pendingUploads - (local.uploadStatus === 'UPLOADING' ? 1 : 0)), ...this.presentation(documents, this.data.profile.educationStatus) })
      return
    }
    if (!options.silent) this.setData({ saving: true })
    const requestUserId = sessionUserId()
    try {
      const result = await masters.removeDocument(this.data.consultationId, id, this.data.version)
      if (!requestUserId || requestUserId !== sessionUserId()) return
      if (result && result.id) this.applyConsultation(result)
      else {
        const documents = this.data.documents.filter((item) => item.id !== id)
        this.setData({ documents, ...this.presentation(documents, this.data.profile.educationStatus) })
      }
    } catch (error) {
      if (!options.silent) {
        this.setData({ error: errorMessage(error, '撤除材料失败') })
        wx.showToast({ title: errorMessage(error, '撤除失败'), icon: 'none' })
      }
    } finally { if (!options.silent) this.setData({ saving: false }) }
  },

  removeDocument({ currentTarget }) { this.removeDocumentById(currentTarget && currentTarget.dataset && currentTarget.dataset.id) },

  viewDocument({ currentTarget }) {
    const id = String(currentTarget && currentTarget.dataset && currentTarget.dataset.id || '')
    if (!id) return wx.showToast({ title: '文件尚未由服务端确认', icon: 'none' })
    const document = this.data.documents.find((item) => item.id === id)
    const extension = String((document && (document.name || document.fileName) || '').split('.').pop() || '').toLowerCase()
    masters.downloadDocument(this.data.consultationId, id)
      .then((filePath) => new Promise((resolve, reject) => {
        if (['jpg', 'jpeg', 'png'].includes(extension) && wx.previewImage) {
          wx.previewImage({ urls: [filePath], current: filePath, success: resolve, fail: reject }); return
        }
        wx.openDocument({ filePath, fileType: extension === 'pdf' ? 'pdf' : extension === 'docx' ? 'docx' : undefined, showMenu: true, success: resolve, fail: reject })
      }))
      .catch((error) => wx.showToast({ title: errorMessage(error, '材料查看失败'), icon: 'none' }))
  },

  async saveProfile(pathOverride = '') {
    if (!this.ensureLoggedIn()) return false
    if (!this.data.serviceConsent) { wx.showToast({ title: '保存前请先同意资料处理说明', icon: 'none' }); return false }
    this.setData({ saving: true, error: '' })
    const requestUserId = sessionUserId()
    try {
      await this.ensureConsultation()
      if (!this.data.consultationId) return false
      const consultation = await masters.saveProfile(this.data.consultationId, this.data.version, this.data.profile, pathOverride || this.data.path)
      if (!requestUserId || requestUserId !== sessionUserId()) return false
      this.applyConsultation(consultation)
      this.setData({ lastSavedAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) })
      wx.showToast({ title: '已保存到服务端', icon: 'success' })
      return true
    } catch (error) {
      this.setData({ error: errorMessage(error, '保存失败，请重新核对当前版本') })
      wx.showToast({ title: errorMessage(error, '保存失败'), icon: 'none' })
      return false
    } finally { this.setData({ saving: false }) }
  },

  async goConfirm() {
    if (this.data.pendingUploads) {
      wx.showModal({ title: '还有材料正在上传', content: '请等待上传完成，或撤下待上传项后再继续。', showCancel: false }); return
    }
    if (!(await this.saveProfile())) return
    wx.navigateTo({ url: `/pages/masters-confirm/index?id=${encodeURIComponent(this.data.consultationId)}` })
  },

  saveLater() { return this.saveProfile() },

  onHide() {
    if (this.data.pendingUploads) wx.showModal({ title: '文件仍在上传', content: '上传尚未完成，请回到当前页等待完成或撤下失败项。', showCancel: false })
  },

  onShareAppMessage() {
    return { title: '香港硕士免费咨询', path: `/pages/masters-intake/index?channel=${encodeURIComponent(config.channel(this.data.channel))}` }
  },

  back() {
    if (this.data.pendingUploads) return this.onHide()
    wx.navigateBack({ delta: 1 })
  }
})

module.exports = { CONTACT_OPTIONS, EXPERIENCE_OPTIONS, LANGUAGE_OPTIONS, errorMessage, isCancel }
