const assert = require('assert')

const storage = new Map()
const uploadCalls = []
const requestCalls = []
const navigationCalls = []

function mergePath(target, path, value) {
  const parts = path.split('.')
  let cursor = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]
    if (cursor[part] === undefined) cursor[part] = {}
    cursor = cursor[part]
  }
  cursor[parts[parts.length - 1]] = value
}

function installWx() {
  global.wx = {
    getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key), getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getRandomValues: (bytes) => bytes.fill(7), getFileInfo: ({ success }) => success({ size: 128, digest: 'hash-docx-1' }),
    uploadFile: (options) => {
      uploadCalls.push(options)
      if (global.__beforeUploadResponse) global.__beforeUploadResponse(options)
      if (global.__uploadResult) options.success(global.__uploadResult)
      else options.success({ statusCode: 201, data: JSON.stringify({ document: { id: `doc_${uploadCalls.length}`, type: options.formData.type, fileName: options.formData.originalName, size: 128, uploadStatus: 'UPLOADED', parseStatus: 'PENDING', contentHash: 'hash-docx-1' } }) })
    },
    request: (options) => options.success({ statusCode: 200, data: {} }),
    requirePrivacyAuthorize: ({ success }) => success(),
    chooseMessageFile: ({ success }) => success({ tempFiles: [{ tempFilePath: '/tmp/fake.pdf', name: '成绩单.pdf', size: 128, type: 'file' }] }),
    chooseMedia: ({ success }) => success({ tempFiles: [{ tempFilePath: '/tmp/fake.png', name: '证明.png', size: 128, fileType: 'image' }] }),
    chooseImage: ({ success }) => success({ tempFiles: [{ tempFilePath: '/tmp/fake.png', name: '证明.png', size: 128, type: 'image' }] }),
    downloadFile: (options) => {
      if (global.__beforeDownloadResponse) global.__beforeDownloadResponse(options)
      options.success({ statusCode: 200, tempFilePath: '/tmp/authorized-file' })
    },
    previewImage: ({ success }) => success(), openDocument: ({ success }) => success(),
    showToast: () => undefined, showModal: ({ success }) => success && success({ confirm: true }),
    navigateTo: (options) => navigationCalls.push({ type: 'navigateTo', ...options }),
    redirectTo: (options) => navigationCalls.push({ type: 'redirectTo', ...options }),
    navigateBack: (options) => navigationCalls.push({ type: 'navigateBack', ...options }),
    switchTab: (options) => navigationCalls.push({ type: 'switchTab', ...options }),
    reLaunch: (options) => navigationCalls.push({ type: 'reLaunch', ...options })
  }
}

function loadPage(relative) {
  let definition
  const previous = global.Page
  global.Page = (value) => { definition = value }
  delete require.cache[require.resolve(relative)]
  require(relative)
  if (previous) global.Page = previous
  else delete global.Page
  assert(definition, `${relative} did not register a page`)
  definition.data = JSON.parse(JSON.stringify(definition.data || {}))
  definition.setData = function setData(patch) {
    Object.entries(patch || {}).forEach(([key, value]) => {
      if (key.includes('.')) mergePath(this.data, key, value)
      else this.data[key] = value
    })
  }
  return definition
}

async function run() {
  installWx()
  let currentUserId = 'user_1'
  global.getApp = () => ({ getCurrentUser: () => currentUserId ? ({ id: currentUserId, role: 'family_user' }) : null })
  const config = require('../config/masters')
  config.setEnabledForTests(true)
  const model = require('../models/masters-intake')
  const api = require('../services/api')
  const masters = require('../services/masters')
  const originalRequest = api.request
  const originalUploadResult = global.__uploadResult

  // The Mini Program runtime's wx.getRandomValues is asynchronous: it returns a Promise and leaves a
  // caller-supplied array untouched. Keys must still be unique, otherwise every document after the
  // first one fails with IDEMPOTENCY_KEY_REUSED in devtools and on real devices.
  const syncFillingStub = global.wx.getRandomValues
  global.wx.getRandomValues = () => Promise.resolve({ randomValues: new ArrayBuffer(12) })
  const generatedKeys = new Set()
  for (let index = 0; index < 500; index += 1) generatedKeys.add(masters.createIdempotencyKey('document'))
  assert.strictEqual(generatedKeys.size, 500, 'idempotency keys must be unique per call in the Mini Program runtime')
  assert(![...generatedKeys].some((key) => /_0{24}$/.test(key)), 'idempotency keys must not be the all-zero constant')
  assert([...generatedKeys].every((key) => /^[A-Za-z0-9._:-]{8,128}$/.test(key)), 'keys must still match the server key format')
  global.wx.getRandomValues = syncFillingStub

  api.setAccessToken('trusted-token')
  api.request = async (path, options = {}) => {
    requestCalls.push({ path, options })
    if (path === '/v1/masters/capabilities') return { contractVersion: 'masters-intake-v1.1', consentVersion: config.SERVICE_CONSENT_VERSION, serviceConsentText: '测试服务资料保留 14 天，仅用于咨询。', maxFileBytes: model.MAX_DOCUMENT_SIZE, maxDocuments: model.MAX_DOCUMENTS, retentionDays: 14 }
    if (path === '/v1/masters/consultations' && options.method === 'POST') return { consultation: { id: 'c1', profileVersion: 1, status: 'DRAFT', profile: model.emptyProfile(), documents: [], consent: { accepted: true } } }
    if (path === '/v1/masters/consultations/c1' && options.method === 'PATCH') return { consultation: { id: 'c1', profileVersion: Number(options.data && options.data.version || 1) + 1, path: options.data && options.data.path || 'RESUME', status: 'DRAFT', profile: options.data && options.data.profile || model.emptyProfile(), documents: [], consent: { accepted: true } } }
    if (path === '/v1/masters/consultations/c1') return { consultation: { id: 'c1', profileVersion: 1, path: 'RESUME', status: 'DRAFT', profile: model.emptyProfile(), documents: [], consent: { accepted: true } } }
    if (path.endsWith('/extraction/resolve')) return { document: { id: 'doc_resume', type: 'RESUME', name: 'resume.docx', sizeBytes: 128, sha256: 'hash-docx-1', uploadStatus: 'UPLOADED', parseStatus: 'SUCCEEDED' }, consultation: { id: 'c1', profileVersion: Number(options.data && options.data.version || 1) + 1, status: 'DRAFT', profile: options.data && options.data.accepted ? model.normalizeProfile({ [options.data.field]: options.data.value }) : model.emptyProfile(), documents: [] } }
    if (path.endsWith('/extraction')) return { fields: [], conflicts: [] }
    if (path.endsWith('/confirm')) return { consultation: { id: 'c1', profileVersion: 1, status: 'DRAFT', profile: model.emptyProfile(), documents: [] } }
    if (path.endsWith('/submit')) return { consultation: { id: 'c1', profileVersion: 1, status: 'SUBMITTED', profile: model.emptyProfile(), documents: [] } }
    if (path.includes('/documents/') && options.method === 'DELETE') return { consultation: { id: 'c1', profileVersion: 2, status: 'DRAFT', profile: model.emptyProfile(), documents: [] } }
    if (path.endsWith('/retry')) return { document: { id: 'doc_retry', type: 'TRANSCRIPT', name: '成绩单.pdf', sizeBytes: 128, sha256: 'hash-docx-1', uploadStatus: 'UPLOADED', parseStatus: 'MANUAL_REVIEW' }, consultation: { id: 'c1', profileVersion: 2, status: 'DRAFT', profile: model.emptyProfile(), documents: [] } }
    if (path.endsWith('/withdraw')) return { consultation: { id: 'c1', profileVersion: 1, status: 'WITHDRAWN', profile: model.emptyProfile(), documents: [] } }
    if (path.endsWith('/report')) return { report: { id: 'r1', status: 'RELEASED', version: 1, payload: { candidatePrograms: [] } } }
    throw new Error(`unexpected request ${path}`)
  }

  const profile = model.normalizeProfile({
    name: '虚构学生', contact: { type: 'wechat', value: 'fake-contact' }, languageType: 'IELTS',
    languageScores: { total: '7.0', subscores: { listening: '7.5' }, examDate: '2026-06-01' }, targetYear: 'UNDECIDED'
  })
  assert.strictEqual(profile.contact.type, 'wechat')
  assert.strictEqual(profile.languageScores.subscores.listening, '7.5')
  assert.strictEqual(profile.languageScores.examDate, '2026-06-01')
  assert.strictEqual(Object.prototype.hasOwnProperty.call(profile, 'languageDate'), false)
  assert.strictEqual(model.targetYearLabel(model.TARGET_YEAR_UNDECIDED), '尚未确定，希望顾问建议')
  assert.strictEqual(model.normalizeProfile({ targetYear: '尚未确定，希望顾问建议' }).targetYear, model.TARGET_YEAR_UNDECIDED)
  assert.strictEqual(model.normalizeProfile({ targetYear: '' }).targetYear, model.TARGET_YEAR_UNDECIDED)
  assert(model.EXPERIENCE_TYPES.every((item) => item.label && !item.label.includes(item.value)), 'experience labels must be student-facing Chinese')
  assert.strictEqual(model.normalizeExperience({ type: 'OTHER' }).type, 'OTHER')
  const draft = model.resumeDraft({
    ...profile, degree: '文学学士', averageScore: '86.5', gpa: '3.7', gpaScale: '4.0',
    experiences: [{ type: 'RESEARCH', title: '实验室项目', organization: '虚构实验室', description: '整理公开数据', startDate: '', endDate: '' }, { type: 'INTERNSHIP' }]
  })
  assert.strictEqual(draft.title, '简历草稿（仅据本人提供事实）')
  assert(draft.text.includes('文学学士') && draft.text.includes('均分 86.5') && draft.text.includes('GPA 3.7') && draft.text.includes('分制 4.0'))
  assert(draft.text.includes('IELTS') && draft.text.includes('实验室项目') && !draft.text.includes('undefined'))
  const dtoDocument = model.normalizeDocument({ id: 'dto1', type: 'TRANSCRIPT', sizeBytes: 4096, sha256: 'sha256-dto', originalName: 'transcript.pdf' })
  assert.strictEqual(dtoDocument.size, 4096)
  assert.strictEqual(dtoDocument.contentHash, 'sha256-dto')
  assert.strictEqual(model.normalizeConsultation({ consultation: { id: 'dto-c', profileVersion: 9, profile: model.emptyProfile() } }).version, '9')
  const cards = model.buildMaterialCards([{ id: 'doc_grad', type: 'GRADUATION', name: '毕业证.jpg', size: 100 }], 'ENROLLED')
  assert(cards.hiddenDocuments.some((item) => item.type === 'GRADUATION'), 'hidden status material must remain visible in other categories')
  assert(cards.cards.find((item) => item.type === 'ENROLLMENT').visible)
  const resumeReview = model.buildResumeReview({ name: '虚构学生', institution: '虚构大学', targetYear: 'UNDECIDED' }, [
    { id: 'resume-review', type: 'RESUME', name: '虚构简历.docx', size: 128, parseStatus: 'MANUAL_REVIEW' },
    { id: 'transcript-review', type: 'TRANSCRIPT', name: '虚构成绩单.pdf', size: 128 }
  ], [{ field: 'institution', value: '识别院校', existing: true, existingLabel: '虚构大学' }])
  assert(resumeReview.hasResume && resumeReview.hasTranscript)
  assert(resumeReview.knownFacts.some((item) => item.label === '本科院校'))
  const otherLanguageReview = model.buildResumeReview({ languageType: 'OTHER' }, [], [])
  assert(otherLanguageReview.knownFacts.some((item) => item.label === '语言成绩' && item.value.includes('其他语言考试')))
  assert(resumeReview.missingFacts.some((item) => item.label === '联系方式'))
  assert(!resumeReview.missingFacts.some((item) => item.label === '申请入学年份'), 'UNDECIDED is a valid choice and must not be shown as a missing fact')
  assert(resumeReview.conflicts.some((item) => item.label === '本科院校'))
  assert(resumeReview.manualReviewDocuments.some((item) => item.typeLabel === '个人简历'))

  const created = await masters.createConsultation({ targetYear: 'UNDECIDED', channel: 'partner', path: 'RESUME', serviceConsent: { accepted: true } }, 'create-key-1')
  assert.strictEqual(created.id, 'c1')
  const createCall = requestCalls.find((item) => item.options.method === 'POST' && item.path === '/v1/masters/consultations')
  assert.strictEqual(createCall.options.headers['Idempotency-Key'], 'create-key-1')
  assert.deepStrictEqual(createCall.options.data.serviceConsent, { accepted: true, copyVersion: 'masters_service_consent_v1.1' })
  await masters.confirmConsultation('c1', 1, { accuracyConfirmed: true, consent: { accepted: true } }, 'confirm-key-1')
  await masters.submitConsultation('c1', 1, 'submit-key-1')
  const retried = await masters.retryDocumentExtraction('c1', 'doc1', 1, 'retry-key-1')
  assert.strictEqual(retried.document.id, 'doc_retry')
  const retryCall = requestCalls.find((item) => item.options.method === 'POST' && item.path.endsWith('/documents/doc1/retry'))
  assert.strictEqual(retryCall.options.headers['Idempotency-Key'], 'retry-key-1')
  assert.deepStrictEqual(retryCall.options.data, { version: 1 })

  const uploaded = await masters.uploadDocument('c1', { filePath: '/tmp/resume.docx', name: 'resume.docx', size: 128, mimeType: 'file' }, { version: 1, type: 'RESUME', idempotencyKey: 'upload-key-1' })
  assert.strictEqual(uploaded.document.id, 'doc_1')
  assert.strictEqual(uploadCalls[0].name, 'file')
  assert.strictEqual(uploadCalls[0].formData.version, '1')
  assert.strictEqual(uploadCalls[0].formData.type, 'RESUME')
  assert.strictEqual(uploadCalls[0].formData.originalName, 'resume.docx')
  assert.strictEqual(uploadCalls[0].header.Authorization, 'Bearer trusted-token')
  assert.strictEqual(uploadCalls[0].header['Idempotency-Key'], 'upload-key-1')
  await assert.rejects(() => masters.uploadDocument('c1', { filePath: '/tmp/old.doc', name: 'old.doc', size: 128 }, { version: 1, type: 'RESUME' }), (error) => error.code === 'FILE_TYPE_UNSUPPORTED')
  global.__uploadResult = { statusCode: 503, data: JSON.stringify({ error: { code: 'UPLOAD_FAILED', message: '服务端暂时不可用' } }) }
  await assert.rejects(() => masters.uploadDocument('c1', { filePath: '/tmp/fail.pdf', name: 'fail.pdf', size: 128 }, { version: 1, type: 'TRANSCRIPT' }), (error) => error.code === 'UPLOAD_FAILED')
  global.__uploadResult = originalUploadResult
  assert.strictEqual((await masters.chooseMessageFiles(1))[0].name, '成绩单.pdf')
  assert.strictEqual((await masters.chooseImages(1))[0].name, '证明.png')
  // Without sizeType the Android picker sends a re-encoded JPEG (a real phone stored 757-byte tmp_*.jpg
  // files whose SHA-256 matched neither the PNG nor the JPG the student chose), so ask for the original.
  const chooseMediaStub = global.wx.chooseMedia
  const chooseImageStub = global.wx.chooseImage
  let mediaPickerOptions
  global.wx.chooseMedia = (options) => { mediaPickerOptions = options; options.success({ tempFiles: [{ tempFilePath: '/tmp/original.png', size: 128, fileType: 'image' }] }) }
  await masters.chooseImages(1)
  assert.deepStrictEqual(mediaPickerOptions.sizeType, ['original'], 'image uploads must keep the original bytes')
  let imagePickerOptions
  global.wx.chooseMedia = undefined
  global.wx.chooseImage = (options) => { imagePickerOptions = options; options.success({ tempFiles: [{ tempFilePath: '/tmp/original.png', size: 128 }] }) }
  await masters.chooseImages(1)
  assert.deepStrictEqual(imagePickerOptions.sizeType, ['original'], 'the older image picker must also keep the original bytes')
  global.wx.chooseMedia = chooseMediaStub
  global.wx.chooseImage = chooseImageStub
  const requestForTokenTest = api.request
  api.request = async () => { api.setAccessToken('rotated-token'); return { consultation: { id: 'c1', profileVersion: 1, status: 'DRAFT', profile: model.emptyProfile(), documents: [] } } }
  await assert.rejects(() => masters.getConsultation('c1'), (error) => error.code === 'AUTH_CONTEXT_CHANGED')
  api.request = requestForTokenTest
  api.setAccessToken('trusted-token')
  global.__beforeUploadResponse = () => api.setAccessToken('rotated-token')
  await assert.rejects(() => masters.uploadDocument('c1', { filePath: '/tmp/rotated.pdf', name: 'rotated.pdf', size: 128 }, { version: 1, type: 'TRANSCRIPT' }), (error) => error.code === 'AUTH_CONTEXT_CHANGED')
  delete global.__beforeUploadResponse
  api.setAccessToken('trusted-token')
  global.__beforeDownloadResponse = () => api.setAccessToken('rotated-token')
  await assert.rejects(() => masters.downloadDocument('c1', 'doc_1'), (error) => error.code === 'AUTH_CONTEXT_CHANGED')
  delete global.__beforeDownloadResponse
  api.setAccessToken('trusted-token')

  const fullDocuments = Array.from({ length: 20 }, (_, index) => ({ id: `full_${index}`, type: 'RESUME', name: `resume_${index}.pdf`, size: 128 }))
  await assert.rejects(() => masters.uploadDocument('c1', { filePath: '/tmp/replacement.pdf', name: 'replacement.pdf', size: 128 }, { version: 1, type: 'RESUME', existingDocuments: fullDocuments }), (error) => error.code === 'DOCUMENT_LIMIT_REACHED')
  const replacement = await masters.uploadDocument('c1', { filePath: '/tmp/replacement.pdf', name: 'replacement.pdf', size: 128 }, { version: 1, type: 'RESUME', existingDocuments: fullDocuments, replaceDocumentId: 'full_0' })
  assert(replacement.document.id, 'replacing one document at the limit must still use actual upload')
  assert.strictEqual(uploadCalls[uploadCalls.length - 1].formData.replaceDocumentId, 'full_0')

  const freshPage = loadPage('../masters/materials/index.js')
  masters.clearDraftId()
  freshPage.onLoad({ path: 'RESUME' })
  freshPage.setData({ loggedIn: true })
  await freshPage.loadConsultation()
  assert.strictEqual(freshPage.data.cards.length, 7, 'a new consultation must show its material cards before a server draft exists')
  assert.strictEqual(freshPage.data.retentionDays, 14, 'consent must show the server retention policy')
  assert.strictEqual(freshPage.data.uploadConfigReady, true)
  assert.strictEqual(freshPage.data.showFullProfile, false, 'RESUME path must not open the long profile form by default')
  assert.strictEqual(freshPage.data.guidedStep, 0)
  freshPage.setData({ path: 'GUIDED', consultationId: 'c1', version: 1, serviceConsent: true, profile: model.emptyProfile() })
  freshPage.onFieldInput({ currentTarget: { dataset: { field: 'institution' } }, detail: { value: '四步填写的虚构大学' } })
  await freshPage.nextGuidedStep()
  assert.strictEqual(freshPage.data.guidedStep, 1)
  assert.strictEqual(freshPage.data.profile.institution, '四步填写的虚构大学', 'guided next step must retain prior values')
  await freshPage.setGuidedStep({ currentTarget: { dataset: { index: 2 } } })
  assert.strictEqual(freshPage.data.guidedStep, 2, 'guided tab events must read dataset.index')
  freshPage.targetYearChange({ detail: { value: model.TARGET_YEAR_OPTIONS.length - 1 } })
  assert.strictEqual(freshPage.data.profile.targetYear, model.TARGET_YEAR_UNDECIDED)
  assert.strictEqual(freshPage.data.targetYearOptions[freshPage.data.targetYearIndex].label, '尚未确定，希望顾问建议')
  await freshPage.previousGuidedStep()
  assert.strictEqual(freshPage.data.guidedStep, 1, 'guided steps must support returning to an earlier step')
  const originalStepSaveProfile = masters.saveProfile
  let stepSaveAttempts = 0
  masters.saveProfile = async (id, version, value, path) => {
    stepSaveAttempts += 1
    if (stepSaveAttempts === 1) throw new Error('模拟服务端保存失败')
    return { id: 'c1', profileVersion: Number(version) + 1, path, status: 'DRAFT', profile: value, documents: [], consent: { accepted: true } }
  }
  freshPage.setData({ guidedStep: 0, guidedStepLabel: '教育背景', profile: model.normalizeProfile({ institution: '失败后仍保留的院校' }) })
  assert.strictEqual(await freshPage.nextGuidedStep(), false, 'failed guided save must block navigation')
  assert.strictEqual(freshPage.data.guidedStep, 0)
  assert.strictEqual(freshPage.data.profile.institution, '失败后仍保留的院校')
  assert.strictEqual(await freshPage.nextGuidedStep(), true, 'guided navigation should recover after a transient save failure')
  assert.strictEqual(freshPage.data.guidedStep, 1)
  masters.saveProfile = originalStepSaveProfile

  freshPage.setData({ path: 'RESUME', profile: model.normalizeProfile({ name: '切换失败仍保留', institution: '切换前院校' }), serviceConsent: true, consultationId: 'c1', version: 9 })
  const originalPathSaveProfile = masters.saveProfile
  masters.saveProfile = async () => { throw new Error('模拟路径保存失败') }
  assert.strictEqual(await freshPage.switchToGuided(), false, 'existing RESUME drafts must switch only after a successful path save')
  assert.strictEqual(freshPage.data.path, 'RESUME')
  assert.strictEqual(freshPage.data.profile.institution, '切换前院校')
  masters.saveProfile = originalPathSaveProfile
  assert.strictEqual(await freshPage.switchToGuided(), true)
  assert.strictEqual(freshPage.data.path, 'GUIDED')
  const guidedPathSave = requestCalls.filter((item) => item.options.method === 'PATCH').pop()
  assert.strictEqual(guidedPathSave.options.data.path, 'GUIDED', 'guided preference must be included in the versioned save')
  freshPage.setData({ path: 'GUIDED', guidedStep: 3, guidedStepLabel: '相关经历', serviceConsent: true, consultationId: 'c1' })
  assert.strictEqual(await freshPage.nextGuidedStep(), true, 'the final guided step must also save before completion')
  freshPage.setData({ path: 'RESUME', profile: model.normalizeProfile({ name: '已有简历学生', institution: '虚构大学', targetYear: '2028' }), documents: [{ id: 'resume-top', type: 'RESUME', name: '简历.docx', size: 128, parseStatus: 'SUCCEEDED' }], extractionFields: [] })
  freshPage.refreshResumeReview()
  assert(freshPage.data.resumeReview.hasResume)
  freshPage.setData({ profile: model.emptyProfile() })
  freshPage.refreshResumeReview()
  freshPage.toggleMissingProfile()
  assert(freshPage.data.missingEditFields.includes('institution'))
  freshPage.onFieldInput({ currentTarget: { dataset: { field: 'institution' } }, detail: { value: '连续输入的虚构大学' } })
  assert.strictEqual(freshPage.data.missingEditInstitution, true, 'missing editor controls must stay mounted while a value is being typed')
  freshPage.closeMissingProfile()
  freshPage.setData({ profile: model.normalizeProfile({ name: '已有简历学生', institution: '虚构大学', targetYear: '2028' }) })
  freshPage.refreshResumeReview()
  freshPage.toggleFullProfile()
  assert.strictEqual(freshPage.data.showFullProfile, true, 'resume path must keep a deliberate full-edit escape hatch')
  freshPage.toggleFullProfile()
  assert.strictEqual(freshPage.data.showFullProfile, false)
  const requestForCapabilities = api.request
  api.request = async () => { throw new Error('Rules unavailable') }
  assert.strictEqual(await freshPage.loadUploadConfiguration(), false)
  let choseWithoutRules = false
  const chooseForCapabilities = masters.chooseMessageFiles
  masters.chooseMessageFiles = async () => { choseWithoutRules = true; return [] }
  await freshPage.selectUpload({ currentTarget: { dataset: { type: 'RESUME', source: 'file' } } })
  assert.strictEqual(choseWithoutRules, false, 'file selection must wait for the actual retention and upload policy')
  masters.chooseMessageFiles = chooseForCapabilities
  api.request = requestForCapabilities

  const materialsPage = loadPage('../masters/materials/index.js')
  materialsPage.onLoad({ path: 'GUIDED', channel: 'partner' })
  materialsPage.setData({ loggedIn: true, consultationId: 'c1', version: 1, serviceConsent: true, documents: [], profile: model.emptyProfile() })
  materialsPage.data.profile.adultConfirmed = true
  const originalChoose = masters.chooseMessageFiles
  const originalUpload = masters.uploadDocument
  const pageUploadTypes = []
  let supplementalDescription
  masters.chooseMessageFiles = async () => [{ tempFilePath: '/tmp/fake.pdf', name: 'same.pdf', size: 128, type: 'file' }]
  masters.uploadDocument = async (id, file, options) => {
    pageUploadTypes.push(options.type)
    if (options.type === 'SUPPLEMENTAL') supplementalDescription = options.description
    return { document: { id: `server_${options.type}`, type: options.type, name: file.name, size: file.size, uploadStatus: 'UPLOADED', parseStatus: 'PENDING' } }
  }
  materialsPage.supplementalDescriptionChange({ detail: { value: '科研：虚构课程项目证明' } })
  for (const type of model.DOCUMENT_TYPES) await materialsPage.selectUpload({ currentTarget: { dataset: { type, source: 'file' } } })
  assert.deepStrictEqual(pageUploadTypes, model.DOCUMENT_TYPES, 'each of the seven cards must invoke the typed upload contract')
  assert.strictEqual(supplementalDescription, '科研：虚构课程项目证明')
  const filesBeforeGuided = materialsPage.data.documents.slice()
  await materialsPage.switchToGuided()
  assert.strictEqual(materialsPage.data.path, 'GUIDED')
  assert.deepStrictEqual(materialsPage.data.documents, filesBeforeGuided, 'switching to guided must retain saved materials')
  const uploadWithConsultation = masters.uploadDocument
  const draftBeforeUpload = model.normalizeProfile({ name: '上传前未保存姓名', institution: '上传前未保存院校' })
  materialsPage.setData({ profile: draftBeforeUpload, documents: [], consultationId: 'c1', version: 1 })
  masters.uploadDocument = async (id, file, options) => ({
    document: { id: 'server_resume_with_snapshot', type: options.type, name: file.name, size: file.size, uploadStatus: 'UPLOADED', parseStatus: 'PENDING' },
    consultation: { id: 'c1', profileVersion: 2, path: 'GUIDED', status: 'DRAFT', profile: model.emptyProfile(), documents: [] }
  })
  await materialsPage.uploadFiles('RESUME', [{ tempFilePath: '/tmp/draft-resume.pdf', name: 'draft-resume.pdf', size: 128, type: 'file' }])
  assert.strictEqual(materialsPage.data.profile.name, '上传前未保存姓名', 'upload snapshots must not discard unsaved profile edits')
  assert.strictEqual(materialsPage.data.profile.institution, '上传前未保存院校')
  masters.uploadDocument = uploadWithConsultation
  materialsPage.setData({ documents: [{ id: 'saved-grad', type: 'GRADUATION', name: '毕业证.jpg', size: 128 }] })
  materialsPage.educationStatusChange({ detail: { value: 'ENROLLED' } })
  assert(materialsPage.data.hiddenDocuments.some((item) => item.type === 'GRADUATION'))
  materialsPage.educationStatusChange({ detail: { value: 'GRADUATED' } })
  assert(materialsPage.data.cards.find((item) => item.type === 'DEGREE').visible)
  materialsPage.setData({
    profile: model.normalizeProfile({ institution: '本人已填写院校' }),
    extractionFields: [{ field: 'institution', value: '识别院校', documentId: 'doc1', sourceName: '成绩单.pdf' }]
  })
  let savedProfile
  const originalSaveProfile = masters.saveProfile
  masters.saveProfile = async (id, version, value) => { savedProfile = value; return { id: 'c1', profileVersion: version, status: 'DRAFT', profile: value, documents: [] } }
  await materialsPage.adoptExtraction({ currentTarget: { dataset: { index: 0 } } })
  assert.strictEqual(savedProfile, undefined, 'adopting extraction must preserve an existing profile field without overwriting it')
  materialsPage.setData({ profile: model.emptyProfile(), version: 1, extractionFields: [{ field: 'name', value: '识别学生', documentId: 'doc1', sourceName: '简历.docx' }] })
  await materialsPage.adoptExtraction({ currentTarget: { dataset: { index: 0 } } })
  assert.strictEqual(materialsPage.data.profile.name, '识别学生')
  assert.strictEqual(materialsPage.data.version, 2, 'accepted extraction must apply the returned consultation version')
  materialsPage.setData({ extractionFields: [{ field: 'name', value: '识别学生', documentId: 'doc1', sourceName: '简历.docx' }] })
  await materialsPage.rejectExtraction({ currentTarget: { dataset: { index: 0 } } })
  assert.strictEqual(materialsPage.data.version, 3, 'rejected extraction must apply the returned consultation version')
  masters.saveProfile = originalSaveProfile
  materialsPage.loadedUserId = 'user_1'
  materialsPage.loadedForUser = true
  materialsPage.setData({ consultationId: 'c1', profile: model.normalizeProfile({ name: '前一账号' }), documents: [{ id: 'private-doc', type: 'RESUME', name: 'private.docx' }], extractionFields: [{ field: 'name', value: '前一账号', documentId: 'private-doc' }] })
  currentUserId = 'user_2'
  materialsPage.onShow()
  assert.strictEqual(materialsPage.data.consultationId, '')
  assert.strictEqual(materialsPage.data.profile.name, '')
  assert.strictEqual(materialsPage.data.documents.length, 0)
  assert.strictEqual(materialsPage.data.extractionFields.length, 0)
  const confirmPage = loadPage('../masters/confirm/index.js')
  confirmPage.onLoad({ id: 'c1' })
  confirmPage.loadedUserId = 'user_1'
  confirmPage.loaded = true
  confirmPage.setData({ consultationId: 'c1', profile: model.normalizeProfile({ name: '前一账号' }), documents: [{ id: 'private-doc', type: 'RESUME', name: 'private.docx' }], resumeDraft: model.resumeDraft({ name: '前一账号' }) })
  confirmPage.onShow()
  assert.strictEqual(confirmPage.data.consultationId, '')
  assert.strictEqual(confirmPage.data.profile.name, '')
  assert.strictEqual(confirmPage.data.documents.length, 0)
  currentUserId = 'user_1'
  masters.chooseMessageFiles = originalChoose
  masters.uploadDocument = originalUpload

  const intakePage = loadPage('../masters/intake/index.js')
  intakePage.onLoad({ channel: 'not-allowed' })
  const share = intakePage.onShareAppMessage()
  assert(/channel=organic$/.test(share.path), 'share payload must use a whitelist channel only')
  assert(!/reportId|studentId|price|39\.9/i.test(JSON.stringify(share)))
  const mastersSources = ['../masters/intake/index.wxml', '../masters/materials/index.wxml', '../masters/confirm/index.wxml', '../masters/status/index.wxml', '../masters/report/index.wxml'].map((file) => require('fs').readFileSync(require('path').resolve(__dirname, file), 'utf8')).join('\n')
  assert(!/[¥￥]|39\.9|微信支付|套餐/.test(mastersSources), 'masters entry must stay free and separate from paid Compass')
  const materialsWxml = require('fs').readFileSync(require('path').resolve(__dirname, '../masters/materials/index.wxml'), 'utf8')
  assert(!materialsWxml.includes('UNDECIDED'), 'student-facing materials page must not expose the internal undecided code')
  assert(materialsWxml.includes('targetYearOptions') && materialsWxml.includes('targetYearChange'))
  assert(materialsWxml.includes('path === \'GUIDED\' && guidedStep === 0') && materialsWxml.includes('path === \'GUIDED\' && guidedStep === 3'))
  assert(materialsWxml.includes('experienceLabels[item.type]'), 'experience picker must render Chinese labels instead of internal enum values')
  assert(materialsWxml.includes('toggleMissingProfile') && materialsWxml.includes('missingEditInstitution'), 'RESUME missing-only editor must have its own stable controls')
  assert(materialsWxml.includes('item.uploadStatusLabel') && materialsWxml.includes('item.parseStatusLabel'), 'document status text must come from normalized labels')
  assert(materialsWxml.indexOf('extraction-review') < materialsWxml.indexOf('materials-section'), 'extraction review must stay near the résumé check')
  // Ticking consent creates the draft with the chosen 入学年份. The only picker sat below the consent box
  // (and on the guided path only at step 3), so a student who already had an undecided consultation hit
  // MASTERS_SEASON_CONFLICT and could not start a second one.
  const firstYearPicker = materialsWxml.indexOf('bindchange="targetYearChange"')
  assert(firstYearPicker > -1 && firstYearPicker < materialsWxml.indexOf('onServiceConsentChange'), 'a new consultation must offer 入学年份 before consent creates the draft')

  // The real server answers a withdrawal with { withdrawn: true } and no consultation body. The status
  // page must then show 已撤回 from the server instead of falling back to DRAFT, which also kept the
  // edit and submit buttons on screen for a withdrawn consultation.
  const requestBeforeWithdraw = api.request
  let withdrawnOnServer = false
  api.request = async (path, options = {}) => {
    if (path === '/v1/masters/consultations/c1/withdraw') { withdrawnOnServer = true; return { withdrawn: true } }
    if (path === '/v1/masters/consultations/c1') return { consultation: { id: 'c1', profileVersion: 3, status: withdrawnOnServer ? 'WITHDRAWN' : 'SUBMITTED', profile: model.emptyProfile(), documents: [] } }
    return requestBeforeWithdraw(path, options)
  }
  const statusPage = loadPage('../masters/status/index.js')
  statusPage.onLoad({ id: 'c1' })
  await statusPage.load()
  assert.strictEqual(statusPage.data.status, 'SUBMITTED')
  await new Promise((resolve) => {
    const originalShowModal = global.wx.showModal
    global.wx.showModal = (options) => { global.wx.showModal = originalShowModal; Promise.resolve(options.success({ confirm: true })).then(resolve) }
    statusPage.withdraw()
  })
  assert.strictEqual(statusPage.data.status, 'WITHDRAWN', 'after a withdrawal the page must show the server status, not DRAFT')
  assert.strictEqual(statusPage.data.statusLabel, '已撤回')
  api.request = requestBeforeWithdraw

  // The phone remembers the last draft id. 建立新的免费咨询 reopened it, and so did every later entry
  // after it was submitted, so a real Android phone put three test students into one consultation. The
  // devtools walkthrough cleared storage before each student, which hid this.
  const requestBeforeDraftPointer = api.request
  const fetchedConsultationIds = []
  const pointerStatus = { c_old: 'DRAFT', c_sent: 'DRAFT' }
  api.request = async (path, options = {}) => {
    const found = /^\/v1\/masters\/consultations\/(c_old|c_sent)$/.exec(path)
    if (found && !options.method) {
      fetchedConsultationIds.push(found[1])
      return { consultation: { id: found[1], profileVersion: 4, path: 'RESUME', status: pointerStatus[found[1]], profile: model.normalizeProfile({ name: '已有咨询' }), documents: [], consent: { accepted: true } } }
    }
    if (path === '/v1/masters/consultations/c_sent/submit') {
      pointerStatus.c_sent = 'SUBMITTED'
      return { consultation: { id: 'c_sent', profileVersion: 4, status: 'SUBMITTED', profile: model.emptyProfile(), documents: [] } }
    }
    return requestBeforeDraftPointer(path, options)
  }
  masters.rememberDraftId('c_old')
  const listPage = loadPage('../masters/list/index.js')
  listPage.newConsultation()
  const newConsultationUrl = navigationCalls[navigationCalls.length - 1].url
  const newConsultationOptions = Object.fromEntries(newConsultationUrl.split('?')[1].split('&').map((pair) => pair.split('=').map(decodeURIComponent)))
  const newConsultationPage = loadPage('../masters/materials/index.js')
  newConsultationPage.onLoad(newConsultationOptions)
  newConsultationPage.setData({ loggedIn: true })
  await newConsultationPage.loadConsultation()
  assert.strictEqual(newConsultationPage.data.consultationId, '', '建立新的免费咨询 must open an empty form, not the remembered draft')
  assert.deepStrictEqual(fetchedConsultationIds, [])
  assert.strictEqual(masters.draftId(), 'c_old', 'an unfinished draft stays resumable until a new one exists')
  const resumeDraftPage = loadPage('../masters/materials/index.js')
  resumeDraftPage.onLoad({ path: 'RESUME' })
  resumeDraftPage.setData({ loggedIn: true })
  await resumeDraftPage.loadConsultation()
  assert.strictEqual(resumeDraftPage.data.consultationId, 'c_old', 'the intake entry still resumes an unfinished draft')

  masters.rememberDraftId('c_sent')
  const submitDraftPage = loadPage('../masters/status/index.js')
  submitDraftPage.onLoad({ id: 'c_sent' })
  await submitDraftPage.load()
  await submitDraftPage.submit()
  assert.strictEqual(submitDraftPage.data.status, 'SUBMITTED')
  assert.strictEqual(masters.draftId(), '', 'a submitted consultation is no longer the draft to resume')
  masters.rememberDraftId('c_sent')
  const staleDraftPage = loadPage('../masters/materials/index.js')
  staleDraftPage.onLoad({ path: 'GUIDED' })
  staleDraftPage.setData({ loggedIn: true })
  await staleDraftPage.loadConsultation()
  assert.strictEqual(staleDraftPage.data.consultationId, '', 'a remembered consultation that was already submitted must not reopen as the draft')
  assert.strictEqual(masters.draftId(), '')
  const editSubmittedPage = loadPage('../masters/materials/index.js')
  editSubmittedPage.onLoad({ id: 'c_sent', path: 'GUIDED' })
  editSubmittedPage.setData({ loggedIn: true })
  await editSubmittedPage.loadConsultation()
  assert.strictEqual(editSubmittedPage.data.consultationId, 'c_sent', '补充或修改资料 still opens a submitted consultation by id')
  assert.strictEqual(masters.draftId(), '', 'editing a submitted consultation must not make it the draft again')
  api.request = requestBeforeDraftPointer

  // A failed draft creation (for example MASTERS_SEASON_CONFLICT) must leave consent unticked, so the
  // student can pick another 入学年份 and tick again instead of being stuck with no draft.
  const createBeforeConflict = masters.createConsultation
  masters.createConsultation = async () => { throw new api.ApiError('该申请季已有咨询，请从我的咨询继续原记录', { code: 'MASTERS_SEASON_CONFLICT', statusCode: 409 }) }
  const conflictPage = loadPage('../masters/materials/index.js')
  conflictPage.onLoad({ path: 'GUIDED', new: '1' })
  conflictPage.setData({ loggedIn: true, uploadConfigReady: true })
  await conflictPage.onServiceConsentChange({ detail: { value: ['service'] } })
  assert.strictEqual(conflictPage.data.consultationId, '')
  assert.strictEqual(conflictPage.data.serviceConsent, false, 'consent must be unticked again when the draft could not be created')
  assert(conflictPage.data.error.includes('该申请季已有咨询'))
  masters.createConsultation = createBeforeConflict

  // 提交未完成 said only 请先核对并确认资料 or 请补齐提交所需的基本资料, so the tester tapped submit eight
  // times. The dialog must name the missing fields and offer the page that fixes the problem.
  const requestBeforeSubmitErrors = api.request
  let nextSubmitError
  api.request = async (path, options = {}) => {
    if (path === '/v1/masters/consultations/c_fix/submit') throw nextSubmitError
    if (path === '/v1/masters/consultations/c_fix') return { consultation: { id: 'c_fix', profileVersion: 5, status: 'DRAFT', profile: model.emptyProfile(), documents: [] } }
    return requestBeforeSubmitErrors(path, options)
  }
  const guidancePage = loadPage('../masters/status/index.js')
  guidancePage.onLoad({ id: 'c_fix' })
  await guidancePage.load()
  const submitWith = async (error) => {
    nextSubmitError = error
    const before = navigationCalls.length
    const originalShowModal = global.wx.showModal
    let shown
    global.wx.showModal = (options) => { shown = options; if (options.success) options.success({ confirm: true }) }
    await guidancePage.submit()
    global.wx.showModal = originalShowModal
    return { shown, urls: navigationCalls.slice(before).map((item) => item.url || '') }
  }
  const missingFields = await submitWith(new api.ApiError('请补齐提交所需的基本资料', { code: 'MASTERS_REQUIRED_FIELDS_MISSING', statusCode: 409, details: { fields: ['institution', 'major'] } }))
  assert(missingFields.shown.content.includes('本科院校') && missingFields.shown.content.includes('本科专业'), 'the dialog must name the fields that block submission')
  assert(missingFields.urls.some((url) => url.startsWith('/masters/materials/index?id=c_fix')))
  const unconfirmed = await submitWith(new api.ApiError('请先核对并确认资料', { code: 'MASTERS_CONFIRMATION_REQUIRED', statusCode: 409 }))
  assert(unconfirmed.urls.some((url) => url.startsWith('/masters/confirm/index?id=c_fix')), 'an unconfirmed consultation must lead to the confirmation page')
  const staleConfirmation = await submitWith(new api.ApiError('确认快照已过期，请重新确认', { code: 'MASTERS_CONFIRMATION_STALE', statusCode: 409 }))
  assert(staleConfirmation.urls.some((url) => url.startsWith('/masters/confirm/index?id=c_fix')))
  const adultMissing = await submitWith(new api.ApiError('成人申请人需要明确确认已满18岁；未成年人请走人工路径', { code: 'MASTERS_ADULT_CONFIRMATION_REQUIRED', statusCode: 409 }))
  assert(adultMissing.urls.some((url) => url.startsWith('/masters/materials/index?id=c_fix')))
  api.request = requestBeforeSubmitErrors

  // A rejected upload only set a page-bottom banner without the file name; on a phone the tester could
  // not tell which of the files had been refused.
  const uploadBeforeRejection = masters.uploadDocument
  masters.uploadDocument = async () => { throw new api.ApiError('文件真实类型与扩展名不一致', { code: 'FILE_CONTENT_MISMATCH', statusCode: 415 }) }
  const rejectionPage = loadPage('../masters/materials/index.js')
  rejectionPage.onLoad({ path: 'GUIDED' })
  rejectionPage.setData({ loggedIn: true, consultationId: 'c1', version: 1, serviceConsent: true, documents: [], profile: model.emptyProfile() })
  const showModalBeforeRejection = global.wx.showModal
  let rejectionDialog
  global.wx.showModal = (options) => { rejectionDialog = options }
  await rejectionPage.uploadFiles('DEGREE', [{ tempFilePath: '/tmp/degree.jpg', name: 'synthetic-degree-cert.jpg', size: 128, type: 'file' }])
  global.wx.showModal = showModalBeforeRejection
  masters.uploadDocument = uploadBeforeRejection
  assert(rejectionPage.data.error.includes('synthetic-degree-cert.jpg'), 'the page must say which file was rejected')
  assert(rejectionDialog && rejectionDialog.content.includes('synthetic-degree-cert.jpg') && rejectionDialog.content.includes('文件真实类型与扩展名不一致'), 'a rejected upload must be reported in a dialog that names the file')

  // 核对资料 was refused four times on the phone with MASTERS_EXTRACTION_CONFLICT, yet the page said
  // 资料已有新版本 for every 409. The conflict buttons also offered the other document's value and sent the
  // display label (雅思 for IELTS); the server only accepts a document's own raw value, and every source
  // of a conflicting field needs a decision, but there was no way to decline one.
  const requestBeforeConflicts = api.request
  const conflictResolutions = []
  api.request = async (path, options = {}) => {
    if (path === '/v1/masters/consultations/c_conf' && !options.method) {
      return { consultation: { id: 'c_conf', profileVersion: 6, status: 'DRAFT', path: 'RESUME', profile: model.emptyProfile(), consent: { accepted: true },
        documents: [{ id: 'doc_a', type: 'RESUME', name: 'resume.docx', size: 128, uploadStatus: 'UPLOADED' }, { id: 'doc_b', type: 'LANGUAGE', name: 'score.pdf', size: 128, uploadStatus: 'UPLOADED' }] } }
    }
    if (path === '/v1/masters/consultations/c_conf/extraction') {
      return { profileVersion: 6,
        fields: [{ field: 'languageType', value: 'IELTS', documentId: 'doc_a', sourceName: 'resume.docx' }, { field: 'languageType', value: 'TOEFL', documentId: 'doc_b', sourceName: 'score.pdf' }],
        conflicts: [{ field: 'languageType', values: ['IELTS', 'TOEFL'], resolution: 'PENDING', documentId: 'doc_a' }, { field: 'languageType', values: ['IELTS', 'TOEFL'], resolution: 'PENDING', documentId: 'doc_b' }] }
    }
    if (path === '/v1/masters/consultations/c_conf/extraction/resolve') {
      conflictResolutions.push(options.data)
      return { consultation: { id: 'c_conf', profileVersion: 7, status: 'DRAFT', profile: model.emptyProfile(), documents: [] } }
    }
    return requestBeforeConflicts(path, options)
  }
  const conflictConfirmPage = loadPage('../masters/confirm/index.js')
  const confirmPageModule = require('../masters/confirm/index.js')
  conflictConfirmPage.onLoad({ id: 'c_conf' })
  await conflictConfirmPage.load()
  const [fromResume, fromScore] = conflictConfirmPage.data.conflicts
  assert(Array.isArray(fromResume.choices) && Array.isArray(fromScore.choices), 'each conflicting source must list the values it can adopt')
  assert.deepStrictEqual(fromResume.choices.map((choice) => choice.raw), ['IELTS'], 'a source may only adopt its own value')
  assert.deepStrictEqual(fromScore.choices.map((choice) => choice.raw), ['TOEFL'])
  assert.strictEqual(fromResume.sourceLabel, 'resume.docx')
  assert.notStrictEqual(fromResume.key, fromScore.key, 'each source needs its own list key')
  await conflictConfirmPage.resolveConflict({ currentTarget: { dataset: { index: 0, choice: 0 } } })
  await conflictConfirmPage.resolveConflict({ currentTarget: { dataset: { index: 1, reject: 'true' } } })
  assert.deepStrictEqual(conflictResolutions.map((call) => [call.documentId, call.field, call.value, call.accepted]), [['doc_a', 'languageType', 'IELTS', true], ['doc_b', 'languageType', null, false]], 'adopting sends the raw value and the other source can be declined')
  const conflictMessage = confirmPageModule.errorText(new api.ApiError('提取字段存在待确认冲突，请逐项确认', { code: 'MASTERS_EXTRACTION_CONFLICT', statusCode: 409 }))
  assert(!conflictMessage.includes('新版本') && conflictMessage.includes('冲突'), 'an extraction conflict must not be reported as a newer version')
  assert(confirmPageModule.errorText(new api.ApiError('资料已更新，请刷新后重试', { code: 'MASTERS_VERSION_CONFLICT', statusCode: 409 })).includes('新版本'))
  assert.strictEqual(confirmPageModule.errorText(new api.ApiError('确认值必须来自该附件原始提取结果', { code: 'MASTERS_EXTRACTION_VALUE_INVALID', statusCode: 409 })), '确认值必须来自该附件原始提取结果')
  const confirmWxml = require('fs').readFileSync(require('path').resolve(__dirname, '../masters/confirm/index.wxml'), 'utf8')
  assert(confirmWxml.includes('data-reject="true"') && confirmWxml.includes('item.choices'), 'the conflict panel must offer per-source choices and a decline button')
  // Two documents of one type repeat every extracted field, so keying the review lists by field alone
  // repeated wx:key values (devtools warned "Do not set same key"); key by document and field instead.
  const confirmFieldKeys = conflictConfirmPage.data.extractionFields.map((item) => item.key)
  assert(confirmFieldKeys.every(Boolean) && new Set(confirmFieldKeys).size === confirmFieldKeys.length, 'confirm review rows need a key per document and field')
  const keyedMaterialsPage = loadPage('../masters/materials/index.js')
  keyedMaterialsPage.onLoad({ id: 'c_conf', path: 'RESUME' })
  keyedMaterialsPage.setData({ loggedIn: true, consultationId: 'c_conf', version: 6, profile: model.emptyProfile() })
  await keyedMaterialsPage.loadExtraction()
  const materialsFieldKeys = keyedMaterialsPage.data.extractionFields.map((item) => item.key)
  assert(materialsFieldKeys.length === 2 && materialsFieldKeys.every(Boolean) && new Set(materialsFieldKeys).size === 2, 'materials review rows need a key per document and field')
  assert(!/wx:for="\{\{extractionFields\}\}" wx:key="field"/.test(confirmWxml + require('fs').readFileSync(require('path').resolve(__dirname, '../masters/materials/index.wxml'), 'utf8')), 'extraction review lists must not be keyed by field alone')
  api.request = requestBeforeConflicts

  // Logging out kept PFS_MASTERS_DRAFT_ID_V1, so the next account on the same phone was pointed at the
  // previous account's draft (the server refuses it, but the pointer is that account's data).
  masters.rememberDraftId('c_logout')
  const appBeforeLogout = global.getApp
  global.getApp = () => ({ getCurrentUser: () => null, setCurrentUser: () => undefined })
  await require('../services/auth').logout()
  global.getApp = appBeforeLogout
  assert.strictEqual(masters.draftId(), '', 'logging out must forget the masters draft pointer')

  // Withdrawing a failed local upload left its 「file」reason in the page error.
  const failedItemPage = loadPage('../masters/materials/index.js')
  failedItemPage.onLoad({ path: 'GUIDED' })
  failedItemPage.setData({ loggedIn: true, consultationId: 'c1', version: 1, profile: model.emptyProfile(), pendingUploads: 0,
    documents: [{ localId: 'local_failed', type: 'DEGREE', name: 'synthetic-degree-cert.jpg', size: 128, uploadStatus: 'FAILED', uploadError: '文件真实类型与扩展名不一致' }],
    error: '「synthetic-degree-cert.jpg」文件真实类型与扩展名不一致' })
  await failedItemPage.removeDocument({ currentTarget: { dataset: { id: 'local_failed' } } })
  assert.strictEqual(failedItemPage.data.documents.length, 0)
  assert.strictEqual(failedItemPage.data.error, '', 'the failure message must go with the last failed item')

  masters.clearDraftId('c1')
  config.resetEnabledForTests()
  api.request = originalRequest
  api.setAccessToken('')
  if (originalUploadResult === undefined) delete global.__uploadResult
  else global.__uploadResult = originalUploadResult
  console.log('✓ masters client: fields, consent separation, seven real typed uploads, persistence/error states, status switching, share and paid isolation')
}

if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1 })
module.exports = { run }
