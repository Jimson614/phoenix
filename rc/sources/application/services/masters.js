const api = require('./api')
const runtime = require('../config/runtime')
const config = require('../config/masters')
const model = require('../models/masters-intake')
const profilePayload = require('../models/masters-profile-payload')

const SERVICE_CONSENT_VERSION = config.SERVICE_CONSENT_VERSION
const DRAFT_ID_KEY = 'PFS_MASTERS_DRAFT_ID_V1'
const ACCEPTED_EXTENSIONS = Object.freeze(['.pdf', '.docx', '.jpg', '.jpeg', '.png'])
const MIME_BY_EXTENSION = Object.freeze({
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
})

function unwrap(value) {
  let payload = value && value.data !== undefined ? value.data : value
  if (payload && payload.data !== undefined && !payload.consultation && !payload.document && !payload.documents) payload = payload.data
  return payload || {}
}

function randomPart() {
  try {
    if (typeof wx !== 'undefined' && wx.getRandomValues) {
      const bytes = new Uint8Array(12)
      wx.getRandomValues(bytes)
      return Array.prototype.map.call(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
    }
  } catch (error) {}
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`
}

function createIdempotencyKey(purpose = 'request') {
  const safePurpose = String(purpose).replace(/[^a-z0-9_-]/gi, '').slice(0, 28) || 'request'
  return `pfs_masters_${safePurpose}_${randomPart()}`.slice(0, 120)
}

function idempotencyHeaders(value, purpose) {
  const key = String(value || createIdempotencyKey(purpose)).trim()
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new api.ApiError('缺少有效的幂等键', { code: 'IDEMPOTENCY_KEY_REQUIRED' })
  }
  return { 'Idempotency-Key': key }
}

function requiredId(value, field) {
  const id = String(value || '').trim()
  if (!id) throw new api.ApiError(`${field} 不能为空`, { code: 'MASTERS_ID_REQUIRED', details: { field } })
  return id
}

function assertFeatureEnabled() {
  if (!config.isEnabled()) {
    throw new api.ApiError('香港硕士免费咨询暂未开放', { code: 'MASTERS_CONSULTATION_DISABLED', statusCode: 503 })
  }
}

function tokenChanged(expectedToken) {
  return String(expectedToken || '') !== String(api.accessToken() || '')
}

function authContextChangedError() {
  return new api.ApiError('登录状态已变化，本次响应未应用，请重新读取。', {
    code: 'AUTH_CONTEXT_CHANGED', statusCode: 401
  })
}

function requestWithToken(path, options = {}) {
  const tokenAtStart = api.accessToken() || ''
  return Promise.resolve(api.request(path, options)).then((result) => {
    if (tokenChanged(tokenAtStart)) throw authContextChangedError()
    return result
  })
}

function assertVersion(value) {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) {
    throw new api.ApiError('资料版本无效', { code: 'MASTERS_VERSION_INVALID' })
  }
  return version
}

function consentPayload(value) {
  const input = value || {}
  const accepted = input.service === true || input.accepted === true
  if (!accepted) throw new api.ApiError('请先同意免费咨询资料处理说明', { code: 'MASTERS_SERVICE_CONSENT_REQUIRED' })
  return {
    accepted: true,
    copyVersion: String(input.copyVersion || SERVICE_CONSENT_VERSION),
    ...(input.locale ? { locale: String(input.locale) } : {})
  }
}

function consultationPayload(result) { return model.normalizeConsultation(result) }

function normalizeExtraction(result) {
  const payload = unwrap(result)
  const rawFields = payload.fields
  const fields = Array.isArray(rawFields)
    ? rawFields
    : Object.keys(rawFields && typeof rawFields === 'object' ? rawFields : {}).map((field) => ({ field, value: rawFields[field] }))
  return {
    ...payload,
    documents: Array.isArray(payload.documents) ? payload.documents.map(model.normalizeDocument) : [],
    fields,
    conflicts: Array.isArray(payload.conflicts) ? payload.conflicts : [],
    status: String(payload.status || payload.extractionStatus || 'PENDING').toUpperCase()
  }
}

function normalizeReport(result) {
  const payload = unwrap(result)
  const report = payload.report || payload
  const body = report.payload || report
  return {
    ...report,
    id: String(report.id || report.reportId || report.report_id || ''),
    reportId: String(report.reportId || report.report_id || report.id || ''),
    consultationId: String(report.consultationId || report.consultation_id || ''),
    version: report.version === undefined ? '' : String(report.version),
    status: String(report.status || 'NOT_STARTED').toUpperCase(),
    payload: {
      ...body,
      backgroundSummary: String(body.backgroundSummary || body.background_summary || ''),
      strengthsAndGaps: body.strengthsAndGaps || body.strengths_and_gaps || { strengths: [], gaps: [] },
      suggestedDirections: Array.isArray(body.suggestedDirections || body.suggested_directions)
        ? (body.suggestedDirections || body.suggested_directions) : [],
      candidatePrograms: Array.isArray(body.candidatePrograms || body.candidate_programs)
        ? (body.candidatePrograms || body.candidate_programs) : [],
      preparationPlan: Array.isArray(body.preparationPlan || body.preparation_plan)
        ? (body.preparationPlan || body.preparation_plan) : [],
      nextStepsAndLimitations: Array.isArray(body.nextStepsAndLimitations || body.next_steps_and_limitations)
        ? (body.nextStepsAndLimitations || body.next_steps_and_limitations) : [],
      missingFields: Array.isArray(body.missingFields || body.missing_fields) ? (body.missingFields || body.missing_fields) : [],
      missingDocuments: Array.isArray(body.missingDocuments || body.missing_documents) ? (body.missingDocuments || body.missing_documents) : [],
      verificationStatus: String(body.verificationStatus || body.verification_status || 'NEEDS_REVIEW').toUpperCase()
    }
  }
}

function consultPath(id) { return `${config.API_PREFIX}/${encodeURIComponent(requiredId(id, 'consultationId'))}` }

async function createConsultation(input = {}, idempotencyKey) {
  assertFeatureEnabled()
  const path = config.path(input.path)
  const channel = config.channel(input.channel)
  const targetYear = String(input.targetYear || model.TARGET_YEAR_UNDECIDED)
  const consent = consentPayload(input.consent || input.serviceConsent)
  const result = await requestWithToken(config.API_PREFIX, {
    method: 'POST', headers: idempotencyHeaders(idempotencyKey, 'create'),
    data: { targetYear, channel, path, serviceConsent: consent }
  })
  const consultation = consultationPayload(result)
  if (!consultation.id) throw new api.ApiError('创建咨询响应缺少咨询编号', { code: 'MASTERS_RESPONSE_INVALID' })
  rememberDraftId(consultation.id)
  return consultation
}

async function listConsultations() {
  assertFeatureEnabled()
  return model.normalizeList(await requestWithToken(config.API_PREFIX))
}

async function getConsultation(consultationId) {
  assertFeatureEnabled()
  return consultationPayload(await requestWithToken(consultPath(consultationId)))
}

async function saveProfile(consultationId, version, profile, path) {
  assertFeatureEnabled()
  const currentVersion = assertVersion(version)
  const normalized = profilePayload(profile)
  const result = await requestWithToken(consultPath(consultationId), {
    method: 'PATCH', data: { version: currentVersion, profile: normalized, ...(path === undefined ? {} : { path }) }
  })
  return consultationPayload(result)
}

async function getExtraction(consultationId) {
  assertFeatureEnabled()
  return normalizeExtraction(await requestWithToken(`${consultPath(consultationId)}/extraction`))
}

async function resolveExtraction(consultationId, input = {}, idempotencyKey) {
  assertFeatureEnabled()
  const currentVersion = assertVersion(input.version)
  const documentId = requiredId(input.documentId, 'documentId')
  const field = requiredId(input.field, 'field')
  if (input.accepted !== true && input.accepted !== false) {
    throw new api.ApiError('请选择接受或拒绝该识别结果', { code: 'MASTERS_EXTRACTION_DECISION_REQUIRED' })
  }
  const result = await requestWithToken(`${consultPath(consultationId)}/extraction/resolve`, {
    method: 'POST', headers: idempotencyHeaders(idempotencyKey, 'extraction'),
    data: { version: currentVersion, documentId, field, value: input.value === undefined ? null : input.value, accepted: input.accepted }
  })
  return consultationPayload(result)
}

async function retryDocumentExtraction(consultationId, documentId, version, idempotencyKey) {
  assertFeatureEnabled()
  const currentVersion = assertVersion(version)
  const id = requiredId(documentId, 'documentId')
  const result = await requestWithToken(`${consultPath(consultationId)}/documents/${encodeURIComponent(id)}/retry`, {
    method: 'POST', headers: idempotencyHeaders(idempotencyKey, 'extraction-retry'),
    data: { version: currentVersion }
  })
  const payload = unwrap(result)
  return {
    ...payload,
    document: payload.document ? model.normalizeDocument(payload.document) : null,
    consultation: payload.consultation ? consultationPayload(payload) : null
  }
}

async function confirmConsultation(consultationId, version, input = {}, idempotencyKey) {
  assertFeatureEnabled()
  const currentVersion = assertVersion(version)
  const consent = consentPayload(input.consent || input.serviceConsent || { service: true })
  if (input.accuracyConfirmed !== true) {
    throw new api.ApiError('请确认资料准确后继续', { code: 'MASTERS_ACCURACY_CONFIRMATION_REQUIRED' })
  }
  const result = await requestWithToken(`${consultPath(consultationId)}/confirm`, {
    method: 'POST', headers: idempotencyHeaders(idempotencyKey, 'confirm'),
    data: { version: currentVersion, accuracyConfirmed: true, consent }
  })
  return consultationPayload(result)
}

async function submitConsultation(consultationId, version, idempotencyKey) {
  assertFeatureEnabled()
  const currentVersion = assertVersion(version)
  return consultationPayload(await requestWithToken(`${consultPath(consultationId)}/submit`, {
    method: 'POST', headers: idempotencyHeaders(idempotencyKey, 'submit'), data: { version: currentVersion }
  }))
}

function fileExtension(filePath, name) {
  const value = String(name || filePath || '').split('?')[0].toLowerCase()
  const match = value.match(/\.[a-z0-9]+$/)
  return match ? match[0] : ''
}

function validateFile(file, existingDocuments = [], options = {}) {
  const value = typeof file === 'string' ? { filePath: file, path: file, name: file } : (file || {})
  const name = String(value.name || value.fileName || value.originalName || value.path || '').trim()
  const filePath = String(value.filePath || value.path || '').trim()
  const extension = fileExtension(filePath, name)
  if (!filePath) throw new api.ApiError('未取得文件路径', { code: 'FILE_PATH_REQUIRED' })
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    throw new api.ApiError('仅支持 PDF、DOCX、JPG/JPEG、PNG；不支持旧 DOC', { code: 'FILE_TYPE_UNSUPPORTED' })
  }
  const size = Number(value.size || value.sizeBytes || 0)
  if (size <= 0 && !options.allowUnknown) throw new api.ApiError('文件大小无法确认，请重新选择', { code: 'FILE_SIZE_UNKNOWN' })
  if (size > model.MAX_DOCUMENT_SIZE) {
    throw new api.ApiError('单个文件不能超过 10 MB', { code: 'FILE_TOO_LARGE' })
  }
  if (existingDocuments.length >= model.MAX_DOCUMENTS) {
    throw new api.ApiError('每份咨询最多保存 20 份材料', { code: 'DOCUMENT_LIMIT_REACHED' })
  }
  const total = existingDocuments.reduce((sum, document) => sum + Number(document.size || document.sizeBytes || 0), 0)
  if (total + size > model.MAX_DOCUMENTS * model.MAX_DOCUMENT_SIZE) {
    throw new api.ApiError('材料总量超过服务端上限，请先撤除不需要的文件', { code: 'DOCUMENT_TOTAL_LIMIT_REACHED' })
  }
  const mimeType = String(value.mimeType || value.type || '').toLowerCase()
  const expected = MIME_BY_EXTENSION[extension]
  if (mimeType && mimeType.includes('/') && mimeType !== expected && mimeType !== 'application/octet-stream') {
    throw new api.ApiError('文件声明类型与扩展名不一致', { code: 'FILE_MIME_MISMATCH' })
  }
  return { filePath, name: name || filePath.split(/[\\/]/).pop(), extension, size, mimeType: expected }
}

function fileInfo(filePath) {
  if (typeof wx === 'undefined' || typeof wx.getFileInfo !== 'function') return Promise.resolve(null)
  return new Promise((resolve) => wx.getFileInfo({
    filePath,
    success: (result) => resolve(result || null),
    fail: () => resolve(null)
  }))
}

function parseUploadResponse(response, statusCode) {
  let payload = response
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch (error) { payload = null }
  }
  if (!payload || typeof payload !== 'object') {
    throw new api.ApiError('上传响应无法识别，文件状态未确认', { code: 'UPLOAD_RESPONSE_INVALID', statusCode })
  }
  const document = model.normalizeDocument(payload.document || (payload.data && payload.data.document) || payload)
  if (!document.id) throw new api.ApiError('服务端未返回附件编号，文件状态未确认', { code: 'UPLOAD_RESPONSE_INVALID', statusCode })
  return { ...payload, document, consultation: payload.consultation ? model.normalizeConsultation(payload) : undefined }
}

async function uploadDocument(consultationId, file, options = {}) {
  assertFeatureEnabled()
  const currentVersion = assertVersion(options.version)
  const type = config.documentType(options.type)
  if (!model.isSupportedDocumentType(type)) throw new api.ApiError('材料类别无效', { code: 'DOCUMENT_TYPE_INVALID' })
  const retainedDocuments = (options.existingDocuments || []).filter((document) => String(document.id || document.documentId || '') !== String(options.replaceDocumentId || ''))
  const selected = validateFile(file, retainedDocuments, { allowUnknown: true })
  const info = await fileInfo(selected.filePath)
  const actualSize = Number(info && info.size) || selected.size
  if (actualSize <= 0) throw new api.ApiError('文件大小无法确认，请重新选择', { code: 'FILE_SIZE_UNKNOWN' })
  if (actualSize > model.MAX_DOCUMENT_SIZE) throw new api.ApiError('单个文件不能超过 10 MB', { code: 'FILE_TOO_LARGE' })
  const contentHash = String((info && (info.digest || info.md5 || info.sha256)) || '').trim()
  const existing = retainedDocuments.map(model.normalizeDocument)
  const duplicate = existing.find((document) => document.type === type && document.name === selected.name &&
    contentHash && document.contentHash && document.contentHash === contentHash)
  if (duplicate) throw new api.ApiError('同名且内容相同的材料已上传，可查看或替换现有文件', { code: 'DOCUMENT_DUPLICATE' })
  let baseUrl = ''
  try { baseUrl = runtime.apiBaseUrl() } catch (error) { if (!runtime.isDemo()) throw error }
  const token = api.accessToken()
  const path = `${consultPath(consultationId)}/documents`
  if (typeof wx === 'undefined' || typeof wx.uploadFile !== 'function') {
    throw new api.ApiError('当前环境不支持真实文件上传', { code: 'UPLOAD_UNAVAILABLE', statusCode: 503 })
  }
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${baseUrl}${path}`,
      filePath: selected.filePath,
      name: 'file',
      formData: {
        version: String(currentVersion), type, originalName: selected.name,
        ...(options.description ? { description: String(options.description) } : {}),
        ...(options.replaceDocumentId ? { replaceDocumentId: String(options.replaceDocumentId) } : {})
      },
      header: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...idempotencyHeaders(options.idempotencyKey, 'document')
      },
      timeout: options.timeout || 30000,
      success(response) {
        if (tokenChanged(token)) { reject(authContextChangedError()); return }
        const statusCode = Number(response && response.statusCode || 0)
        if (statusCode < 200 || statusCode >= 300) {
          let body = {}
          try { body = typeof response.data === 'string' ? JSON.parse(response.data) : (response.data || {}) } catch (error) {}
          const errorBody = body.error || body
          reject(new api.ApiError(errorBody.message || `上传失败（${statusCode}）`, {
            code: errorBody.code || 'UPLOAD_FAILED', statusCode, details: errorBody.details
          }))
          return
        }
        try {
          const payload = parseUploadResponse(response.data, statusCode)
          payload.document.name = payload.document.name || selected.name
          payload.document.size = payload.document.size || actualSize
          payload.document.sizeLabel = model.formatSize(payload.document.size)
          payload.document.contentHash = payload.document.contentHash || contentHash
          resolve(payload)
        } catch (error) { reject(error) }
      },
      fail(error) {
        if (tokenChanged(token)) { reject(authContextChangedError()); return }
        reject(new api.ApiError(error && error.errMsg || '上传失败，请检查网络后重试', { code: 'UPLOAD_FAILED' }))
      }
    })
  })
}

async function removeDocument(consultationId, documentId, version) {
  assertFeatureEnabled()
  const currentVersion = assertVersion(version)
  const id = requiredId(documentId, 'documentId')
  return consultationPayload(await requestWithToken(`${consultPath(consultationId)}/documents/${encodeURIComponent(id)}?version=${currentVersion}`, {
    method: 'DELETE'
  }))
}

async function downloadDocument(consultationId, documentId) {
  assertFeatureEnabled()
  const id = requiredId(documentId, 'documentId')
  let baseUrl = ''
  try { baseUrl = runtime.apiBaseUrl() } catch (error) { if (!runtime.isDemo()) throw error }
  const token = api.accessToken()
  if (typeof wx === 'undefined' || typeof wx.downloadFile !== 'function') {
    throw new api.ApiError('当前环境不支持受鉴权的材料查看', { code: 'DOCUMENT_VIEW_UNAVAILABLE', statusCode: 503 })
  }
  return new Promise((resolve, reject) => wx.downloadFile({
    url: `${baseUrl}${consultPath(consultationId)}/documents/${encodeURIComponent(id)}`,
    header: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, timeout: 30000,
    success(response) {
      if (tokenChanged(token)) { reject(authContextChangedError()); return }
      const statusCode = Number(response && response.statusCode || 0)
      if (statusCode >= 200 && statusCode < 300 && response.tempFilePath) { resolve(response.tempFilePath); return }
      reject(new api.ApiError(`材料查看失败（${statusCode}）`, { code: 'DOCUMENT_VIEW_FAILED', statusCode }))
    },
    fail(error) {
      if (tokenChanged(token)) { reject(authContextChangedError()); return }
      reject(new api.ApiError(error && error.errMsg || '材料查看失败，请稍后重试', { code: 'DOCUMENT_VIEW_FAILED' }))
    }
  }))
}

async function withdrawConsultation(consultationId, version) {
  assertFeatureEnabled()
  const currentVersion = version === undefined || version === null ? null : assertVersion(version)
  return consultationPayload(await requestWithToken(`${consultPath(consultationId)}/withdraw`, {
    method: 'POST', data: currentVersion ? { version: currentVersion } : {}
  }))
}

async function getReport(consultationId) {
  assertFeatureEnabled()
  const report = normalizeReport(await requestWithToken(`${consultPath(consultationId)}/report`))
  if (report.status !== 'RELEASED') {
    throw new api.ApiError('咨询报告尚未获批或开放', { code: 'MASTERS_REPORT_NOT_RELEASED', statusCode: 403 })
  }
  return report
}

async function downloadReportExport(consultationId, format) {
  assertFeatureEnabled()
  const value = String(format || '').toLowerCase()
  if (!['pdf', 'xlsx'].includes(value)) throw new api.ApiError('导出格式无效', { code: 'REPORT_EXPORT_FORMAT_INVALID' })
  let baseUrl = ''
  try { baseUrl = runtime.apiBaseUrl() } catch (error) { if (!runtime.isDemo()) throw error }
  const token = api.accessToken()
  if (typeof wx === 'undefined' || typeof wx.downloadFile !== 'function') {
    throw new api.ApiError('当前环境不支持真实导出下载', { code: 'EXPORT_UNAVAILABLE', statusCode: 503 })
  }
  return new Promise((resolve, reject) => wx.downloadFile({
    url: `${baseUrl}${consultPath(consultationId)}/report/export?format=${value}`,
    header: { Accept: value === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    timeout: 30000,
    success(response) {
      if (tokenChanged(token)) { reject(authContextChangedError()); return }
      const statusCode = Number(response && response.statusCode || 0)
      if (statusCode >= 200 && statusCode < 300 && response.tempFilePath) { resolve(response.tempFilePath); return }
      reject(new api.ApiError(`导出失败（${statusCode}）`, { code: 'REPORT_EXPORT_FAILED', statusCode }))
    },
    fail(error) {
      if (tokenChanged(token)) { reject(authContextChangedError()); return }
      reject(new api.ApiError(error && error.errMsg || '导出失败，请稍后重试', { code: 'REPORT_EXPORT_FAILED' }))
    }
  }))
}

function draftId() {
  try { return String(wx.getStorageSync(DRAFT_ID_KEY) || '') } catch (error) { return '' }
}

function rememberDraftId(value) {
  if (!value) return
  try { wx.setStorageSync(DRAFT_ID_KEY, String(value)) } catch (error) {}
}

function clearDraftId(value) {
  if (!value || draftId() === String(value)) {
    try { wx.removeStorageSync(DRAFT_ID_KEY) } catch (error) {}
  }
}

function privacyAuthorize() {
  if (typeof wx === 'undefined' || typeof wx.requirePrivacyAuthorize !== 'function') return Promise.resolve()
  return new Promise((resolve, reject) => wx.requirePrivacyAuthorize({ success: resolve, fail: reject }))
}

function chooseMessageFiles(count = 1) {
  return privacyAuthorize().then(() => new Promise((resolve, reject) => {
    if (!wx.chooseMessageFile) { reject(new api.ApiError('当前微信版本不支持文件选择', { code: 'FILE_PICKER_UNAVAILABLE' })); return }
    wx.chooseMessageFile({ count, type: 'file', extension: ['pdf', 'docx', 'jpg', 'jpeg', 'png'],
      success: (result) => resolve((result && result.tempFiles) || []), fail: reject })
  }))
}

function chooseImages(count = 1) {
  return privacyAuthorize().then(() => new Promise((resolve, reject) => {
    if (wx.chooseMedia) {
      wx.chooseMedia({ count, mediaType: ['image'], sourceType: ['album', 'camera'],
        success: (result) => resolve((result && result.tempFiles) || []), fail: reject })
      return
    }
    if (wx.chooseImage) {
      wx.chooseImage({ count, sourceType: ['album', 'camera'], success: (result) => resolve((result && result.tempFiles) || []), fail: reject })
      return
    }
    reject(new api.ApiError('当前微信版本不支持图片选择', { code: 'IMAGE_PICKER_UNAVAILABLE' }))
  }))
}

module.exports = {
  ACCEPTED_EXTENSIONS, DRAFT_ID_KEY, MIME_BY_EXTENSION, SERVICE_CONSENT_VERSION,
  assertFeatureEnabled, chooseImages, chooseMessageFiles, clearDraftId, createConsultation,
  createIdempotencyKey, downloadDocument, downloadReportExport, draftId, fileInfo, getConsultation,
  getExtraction, getReport, listConsultations, normalizeExtraction, normalizeReport,
  privacyAuthorize, rememberDraftId, removeDocument, saveProfile, submitConsultation,
  uploadDocument, validateFile, withdrawConsultation, confirmConsultation, resolveExtraction,
  retryDocumentExtraction,
  updateProfile: saveProfile
}
