const labels = require('./masters-labels')

const DOCUMENT_TYPES = Object.freeze([
  'RESUME',
  'TRANSCRIPT',
  'LANGUAGE',
  'ENROLLMENT',
  'GRADUATION',
  'DEGREE',
  'SUPPLEMENTAL'
])

const PATHS = Object.freeze(['RESUME', 'GUIDED'])
const EDUCATION_STATUSES = Object.freeze(['ENROLLED', 'GRADUATED'])
const LANGUAGE_STATUSES = Object.freeze(['NONE', 'AVAILABLE'])
const LANGUAGE_TYPES = Object.freeze(['IELTS', 'TOEFL', 'OTHER', 'NONE'])
const CONTACT_TYPES = Object.freeze(['email', 'phone', 'wechat'])
const TARGET_YEAR_UNDECIDED = 'UNDECIDED'
const TARGET_YEAR_UNDECIDED_LABEL = '尚未确定，希望顾问建议'
const TARGET_YEAR_OPTIONS = Object.freeze([
  { value: '2026', label: '2026' },
  { value: '2027', label: '2027' },
  { value: '2028', label: '2028' },
  { value: '2029', label: '2029' },
  { value: '2030', label: '2030' },
  { value: '2031', label: '2031' },
  { value: TARGET_YEAR_UNDECIDED, label: TARGET_YEAR_UNDECIDED_LABEL }
])
const EDUCATION_STATUS_OPTIONS = Object.freeze([
  { value: 'ENROLLED', label: '本科在读' },
  { value: 'GRADUATED', label: '已毕业' }
])
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024
const MAX_DOCUMENTS = 20

const DOCUMENT_META = Object.freeze({
  RESUME: {
    title: '个人简历', button: '点击上传简历', description: '优先上传现有简历；识别后只核对和补充缺失内容。', condition: 'ALL', optional: true
  },
  TRANSCRIPT: {
    title: '本科成绩单', button: '点击上传成绩单', description: '支持在读阶段、多个学期或中英文版本，可后补。', condition: 'ALL', optional: true
  },
  LANGUAGE: {
    title: '语言成绩', button: '点击上传语言成绩', description: '已有雅思、托福或其他语言成绩可上传；暂无成绩无需伪造。', condition: 'ALL', optional: true
  },
  ENROLLMENT: {
    title: '在读证明', button: '点击上传在读证明', description: '本科在读时显示；尚未开具可后补。', condition: 'ENROLLED', optional: true
  },
  GRADUATION: {
    title: '毕业证书', button: '点击上传毕业证', description: '已毕业时单独上传；没有电子版可标记待补。', condition: 'GRADUATED', optional: true
  },
  DEGREE: {
    title: '学位证书', button: '点击上传学位证', description: '与毕业证分开保存；未取得或待补不会阻止咨询。', condition: 'GRADUATED', optional: true
  },
  SUPPLEMENTAL: {
    title: '补充证明', button: '点击上传补充材料', description: '实习、科研、竞赛或学生工作等可选证明。', condition: 'ALL', optional: true
  }
})

const EXPERIENCE_TYPES = Object.freeze([
  { value: 'INTERNSHIP', label: '实习' },
  { value: 'RESEARCH', label: '科研' },
  { value: 'COMPETITION', label: '竞赛' },
  { value: 'STUDENT_WORK', label: '学生工作' },
  { value: 'OTHER', label: '其他经历' }
])

const DOCUMENT_TYPE_LABELS = Object.freeze({
  RESUME: '个人简历', TRANSCRIPT: '本科成绩单', LANGUAGE: '语言成绩',
  ENROLLMENT: '在读证明', GRADUATION: '毕业证书', DEGREE: '学位证书', SUPPLEMENTAL: '补充证明'
})
const UPLOAD_STATUS_LABELS = Object.freeze({ UPLOADED: '已上传', FAILED: '上传失败', REMOVED: '已撤除', UPLOADING: '上传中' })
const PARSE_STATUS_LABELS = Object.freeze({
  PENDING: '待识别', PROCESSING: '识别中', RUNNING: '识别中', SUCCEEDED: '已识别',
  NEEDS_CONFIRMATION: '待你确认', NEEDS_REVIEW: '待人工核验', MANUAL_REVIEW: '待人工核验', FAILED: '识别失败，待人工核验'
})

function stringValue(value, fallback = '') {
  if (value === undefined || value === null) return fallback
  return String(value)
}

function boolValue(value) { return value === true }

function targetYearLabel(value) {
  const candidate = String(value || '')
  const option = TARGET_YEAR_OPTIONS.find((item) => item.value === candidate)
  return option ? option.label : candidate || TARGET_YEAR_UNDECIDED_LABEL
}

function educationStatusLabel(value) {
  const option = EDUCATION_STATUS_OPTIONS.find((item) => item.value === value)
  return option ? option.label : '本科在读'
}

function experienceTypeLabel(value) {
  const option = EXPERIENCE_TYPES.find((item) => item.value === value)
  return option ? option.label : '其他经历'
}

function languageTypeLabel(value) {
  return { IELTS: '雅思 IELTS', TOEFL: '托福 TOEFL', OTHER: '其他语言考试', NONE: '暂无语言成绩' }[String(value || '').toUpperCase()] || '语言考试待补'
}

function documentTypeLabel(value) { return DOCUMENT_TYPE_LABELS[String(value || '').toUpperCase()] || '其他材料' }
function uploadStatusLabel(value) { return UPLOAD_STATUS_LABELS[String(value || '').toUpperCase()] || '状态待确认' }
function parseStatusLabel(value) { return PARSE_STATUS_LABELS[String(value || '').toUpperCase()] || '识别状态待确认' }

function listValue(value) {
  if (Array.isArray(value)) return value.map((item) => stringValue(item).trim()).filter(Boolean)
  if (value === undefined || value === null) return []
  return String(value).split(/[，,\n]/).map((item) => item.trim()).filter(Boolean)
}

function emptyLanguageScores() {
  return { total: '', subscores: { listening: '', reading: '', writing: '', speaking: '' }, examDate: '', raw: '' }
}

function emptyProfile() {
  return {
    name: '',
    adultConfirmed: false,
    contact: { type: 'phone', value: '' },
    educationStatus: 'ENROLLED',
    institution: '', degree: '', major: '', graduationYear: '', graduationDate: '',
    averageScore: '', gpa: '', gpaScale: '', classRank: '',
    languageStatus: 'NONE', languageType: 'NONE', languageScores: emptyLanguageScores(),
    targetYear: TARGET_YEAR_UNDECIDED, targetMajors: [], targetInstitutions: [],
    targetPreference: '', experiences: [], accuracyConfirmed: false
  }
}

function normalizeLanguageScores(value) {
  if (typeof value === 'string') return { ...emptyLanguageScores(), raw: value }
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const subscores = source.subscores && typeof source.subscores === 'object' ? source.subscores : source
  return {
    total: stringValue(source.total !== undefined ? source.total : source.overall),
    subscores: {
      listening: stringValue(subscores.listening), reading: stringValue(subscores.reading),
      writing: stringValue(subscores.writing), speaking: stringValue(subscores.speaking)
    },
    examDate: stringValue(source.examDate || source.exam_date),
    raw: stringValue(source.raw)
  }
}

function normalizeExperience(value) {
  const source = value && typeof value === 'object' ? value : {}
  const type = EXPERIENCE_TYPES.some((item) => item.value === source.type) ? source.type : 'INTERNSHIP'
  return {
    type,
    title: stringValue(source.title || source.name),
    organization: stringValue(source.organization || source.company),
    description: stringValue(source.description || source.details),
    startDate: stringValue(source.startDate || source.start_date),
    endDate: stringValue(source.endDate || source.end_date)
  }
}

function normalizeProfile(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const contact = source.contact && typeof source.contact === 'object' ? source.contact : {}
  const status = EDUCATION_STATUSES.includes(source.educationStatus)
    ? source.educationStatus
    : (EDUCATION_STATUSES.includes(source.education_status) ? source.education_status : 'ENROLLED')
  const languageType = LANGUAGE_TYPES.includes(source.languageType)
    ? source.languageType
    : (LANGUAGE_TYPES.includes(source.language_type) ? source.language_type : 'NONE')
  const languageStatus = LANGUAGE_STATUSES.includes(source.languageStatus)
    ? source.languageStatus
    : (languageType === 'NONE' ? 'NONE' : 'AVAILABLE')
  const contactType = CONTACT_TYPES.includes(contact.type) ? contact.type : 'phone'
  const rawTargetYear = source.targetYear !== undefined ? source.targetYear : source.target_year
  const targetYearText = stringValue(rawTargetYear).trim()
  const normalizedTargetYear = !targetYearText || targetYearText === TARGET_YEAR_UNDECIDED_LABEL
    ? TARGET_YEAR_UNDECIDED : targetYearText
  return {
    ...emptyProfile(),
    name: stringValue(source.name || source.displayName),
    adultConfirmed: boolValue(source.adultConfirmed !== undefined ? source.adultConfirmed : source.adult_confirmed),
    contact: { type: contactType, value: stringValue(contact.value || source.contactValue) },
    educationStatus: status,
    institution: stringValue(source.institution || source.school),
    degree: stringValue(source.degree),
    major: stringValue(source.major),
    graduationYear: stringValue(source.graduationYear !== undefined ? source.graduationYear : source.graduation_year),
    graduationDate: stringValue(source.graduationDate || source.graduation_date),
    averageScore: stringValue(source.averageScore !== undefined ? source.averageScore : source.average_score),
    gpa: stringValue(source.gpa),
    gpaScale: stringValue(source.gpaScale !== undefined ? source.gpaScale : source.gpa_scale),
    classRank: stringValue(source.classRank !== undefined ? source.classRank : source.class_rank),
    languageStatus,
    languageType,
    languageScores: normalizeLanguageScores(source.languageScores || source.language_scores),
    targetYear: normalizedTargetYear,
    targetMajors: listValue(source.targetMajors !== undefined ? source.targetMajors : source.target_majors),
    targetInstitutions: listValue(source.targetInstitutions !== undefined ? source.targetInstitutions : source.target_institutions),
    targetPreference: stringValue(source.targetPreference || source.target_preference),
    experiences: Array.isArray(source.experiences) ? source.experiences.map(normalizeExperience) : [],
    accuracyConfirmed: boolValue(source.accuracyConfirmed !== undefined ? source.accuracyConfirmed : source.accuracy_confirmed)
  }
}

function formatSize(bytes) {
  const value = Number(bytes || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function normalizeDocument(value) {
  const source = value && typeof value === 'object' ? value : {}
  const type = String(source.type || source.documentType || source.document_type || '').toUpperCase()
  const uploadStatus = String(source.uploadStatus || source.upload_status || source.status || 'UPLOADED').toUpperCase()
  const parseStatus = String(source.parseStatus || source.parse_status || source.extractionStatus || source.extraction_status || 'PENDING').toUpperCase()
  return {
    ...source,
    id: stringValue(source.id || source.documentId || source.document_id),
    documentId: stringValue(source.documentId || source.document_id || source.id),
    consultationId: stringValue(source.consultationId || source.consultation_id),
    type,
    name: stringValue(source.name || source.fileName || source.file_name || source.originalName || source.original_name),
    fileName: stringValue(source.fileName || source.file_name || source.name || source.originalName || source.original_name),
    mimeType: stringValue(source.mimeType || source.mime_type || source.contentType || source.content_type),
    size: Number(source.size || source.sizeBytes || source.size_bytes || source.fileSize || source.file_size || 0),
    sizeLabel: formatSize(source.size || source.sizeBytes || source.size_bytes || source.fileSize || source.file_size),
    version: source.version === undefined || source.version === null ? '' : stringValue(source.version),
    uploadStatus,
    uploadStatusLabel: uploadStatusLabel(uploadStatus),
    parseStatus,
    parseStatusLabel: parseStatusLabel(parseStatus),
    typeLabel: documentTypeLabel(type),
    contentHash: stringValue(source.contentHash || source.content_hash || source.sha256 || source.digest || source.md5),
    uploadedAt: stringValue(source.uploadedAt || source.uploaded_at || source.createdAt || source.created_at),
    source: stringValue(source.source || source.sourceDocumentId || source.source_document_id)
  }
}

function unwrapPayload(result) {
  let payload = result && result.data !== undefined ? result.data : result
  if (payload && payload.data !== undefined && !payload.consultation && !payload.document && !payload.documents) payload = payload.data
  return payload || {}
}

function normalizeConsultation(result) {
  const payload = unwrapPayload(result)
  const consultation = payload.consultation || payload.draft || payload
  const documents = Array.isArray(payload.documents)
    ? payload.documents
    : (Array.isArray(consultation.documents) ? consultation.documents : [])
  const versionValue = consultation.version !== undefined
    ? consultation.version
    : consultation.profileVersion !== undefined ? consultation.profileVersion : consultation.revision
  return {
    ...consultation,
    id: stringValue(consultation.id || consultation.consultationId || consultation.consultation_id),
    consultationId: stringValue(consultation.consultationId || consultation.consultation_id || consultation.id),
    version: versionValue === undefined || versionValue === null ? '' : stringValue(versionValue),
    profileVersion: versionValue === undefined || versionValue === null ? '' : stringValue(versionValue),
    path: String(consultation.path || consultation.entryPath || 'GUIDED').toUpperCase(),
    channel: stringValue(consultation.channel),
    status: String(consultation.status || 'DRAFT').toUpperCase(),
    profile: normalizeProfile(consultation.profile),
    documents: documents.map(normalizeDocument),
    missingFields: listValue(payload.missingFields || payload.missing_fields || consultation.missingFields || consultation.missing_fields),
    missingDocuments: listValue(payload.missingDocuments || payload.missing_documents || consultation.missingDocuments || consultation.missing_documents),
    verificationStatus: String(payload.verificationStatus || payload.verification_status || consultation.verificationStatus || 'INCOMPLETE').toUpperCase(),
    extraction: payload.extraction || consultation.extraction || null,
    consent: payload.consent || consultation.consent || null,
    report: payload.report || consultation.report || null,
    raw: payload
  }
}

function normalizeList(result) {
  const payload = unwrapPayload(result)
  const list = payload.consultations || payload.items || payload.data || []
  return Array.isArray(list) ? list.map((item) => normalizeConsultation(item)) : []
}

function documentsForType(documents, type) {
  return (documents || []).map(normalizeDocument).filter((document) => document.type === type)
}

function documentConditionVisible(meta, educationStatus) {
  return meta.condition === 'ALL' || meta.condition === educationStatus
}

function buildMaterialCards(documents, educationStatus, supplementalExpanded = false) {
  const allDocuments = (documents || []).map(normalizeDocument)
  const cards = DOCUMENT_TYPES.map((type) => {
    const meta = DOCUMENT_META[type]
    const files = documentsForType(allDocuments, type)
    return {
      type, ...meta, files,
      visible: type === 'SUPPLEMENTAL' ? supplementalExpanded : documentConditionVisible(meta, educationStatus),
      stored: files.length > 0,
      parsePending: files.some((file) => ['PENDING', 'RUNNING', 'NEEDS_CONFIRMATION', 'NEEDS_REVIEW'].includes(file.parseStatus))
    }
  })
  const visibleTypes = new Set(cards.filter((card) => card.visible).map((card) => card.type))
  return {
    cards,
    hiddenDocuments: allDocuments.filter((document) => !visibleTypes.has(document.type)),
    totalCount: allDocuments.length,
    totalSize: allDocuments.reduce((sum, document) => sum + Number(document.size || 0), 0),
    totalSizeLabel: formatSize(allDocuments.reduce((sum, document) => sum + Number(document.size || 0), 0))
  }
}

function requiredProfileFields(profile) {
  const value = normalizeProfile(profile)
  const missing = []
  if (!value.name.trim()) missing.push('name')
  if (!value.adultConfirmed) missing.push('adultConfirmed')
  if (!value.contact.value.trim()) missing.push('contact')
  if (!value.institution.trim()) missing.push('institution')
  if (!value.major.trim()) missing.push('major')
  if (!value.targetYear.trim()) missing.push('targetYear')
  return missing
}

function buildResumeReview(profile, documents = [], extractionFields = []) {
  const value = normalizeProfile(profile)
  const allDocuments = documents.map(normalizeDocument)
  const resume = allDocuments.find((item) => item.type === 'RESUME' && item.id && item.uploadStatus !== 'REMOVED')
  const transcript = allDocuments.find((item) => item.type === 'TRANSCRIPT' && item.id && item.uploadStatus !== 'REMOVED')
  const facts = [
    ['name', '姓名／称呼', value.name],
    ['adultConfirmed', '成年确认', value.adultConfirmed ? '已确认' : ''],
    ['educationStatus', '学籍状态', educationStatusLabel(value.educationStatus)],
    ['institution', '本科院校', value.institution],
    ['major', '本科专业', value.major],
    ['degree', '学位名称', value.degree],
    ['graduationDate', '毕业时间', value.graduationDate || value.graduationYear],
    ['averageScore', '百分制均分', value.averageScore],
    ['gpa', 'GPA', value.gpa],
    ['gpaScale', 'GPA 满分制', value.gpaScale],
    ['classRank', '专业排名', value.classRank],
    ['contact', '联系方式', value.contact.value ? `${contactLabel(value.contact.type)} ${value.contact.value}` : ''],
    ['language', '语言成绩', `${languageTypeLabel(value.languageType)}${value.languageScores.total ? ` ${value.languageScores.total}` : ''}`],
    ['targetYear', '申请入学年份', targetYearLabel(value.targetYear)],
    ['targetMajors', '意向专业', value.targetMajors.join('、')],
    ['targetInstitutions', '意向院校', value.targetInstitutions.join('、')],
    ['targetPreference', '目标偏好／补充说明', value.targetPreference]
  ]
  const knownFacts = facts.filter(([, , factValue]) => String(factValue || '').trim())
    .map(([field, label, factValue]) => ({ field, label, value: String(factValue) }))
  const missingFacts = [
    ['name', '姓名／称呼', value.name],
    ['adultConfirmed', '成年确认', value.adultConfirmed ? '已确认' : ''],
    ['contact', '联系方式', value.contact.value],
    ['institution', '本科院校', value.institution],
    ['major', '本科专业', value.major]
  ].filter(([, , factValue]) => !String(factValue || '').trim())
    .map(([field, label]) => ({ field, label }))
  const conflicts = extractionFields.filter((item) => item && item.existing && item.value !== undefined && item.value !== null && String(item.existingLabel || '').trim() !== String(item.value).trim())
    .map((item) => ({ field: item.field, label: item.label || labels.fieldLabel(item.field), value: item.field === 'targetYear' ? targetYearLabel(item.value) : item.field === 'languageType' ? languageTypeLabel(item.value) : labels.studentValue(item.value), existingLabel: Array.isArray(item.existingLabel) ? item.existingLabel.join('、') : labels.studentValue(item.existingLabel) }))
  const manualReviewDocuments = allDocuments.filter((item) => ['FAILED', 'MANUAL_REVIEW', 'NEEDS_REVIEW'].includes(item.parseStatus) && item.uploadStatus !== 'REMOVED')
  return {
    hasResume: Boolean(resume),
    resume: resume ? { name: resume.name, statusLabel: `${resume.uploadStatusLabel} · ${resume.parseStatusLabel}` } : null,
    hasTranscript: Boolean(transcript),
    knownFacts,
    missingFacts,
    conflicts,
    manualReviewDocuments: manualReviewDocuments.map((item) => ({ name: item.name, typeLabel: item.typeLabel, statusLabel: item.parseStatusLabel }))
  }
}

function contactLabel(type) {
  return { phone: '手机', wechat: '微信', email: '邮箱' }[type] || '联系方式'
}

function fact(value, fallback = '待补') {
  const text = stringValue(value).trim()
  return text || fallback
}

function hasAnyExperienceFact(experience) {
  return ['title', 'organization', 'description', 'startDate', 'endDate']
    .some((field) => stringValue(experience && experience[field]).trim())
}

/**
 * Build a reviewable guided-entry resume from the current profile facts.
 * This is deliberately a deterministic text draft: it never invents a school,
 * score, date, language result, or experience, and blank experience rows are
 * omitted rather than rendered as empty projects.
 */
function resumeDraft(profile) {
  const value = normalizeProfile(profile)
  const lines = [
    `姓名／称呼：${fact(value.name)}`,
    `联系方式：${value.contact.value.trim() ? `${contactLabel(value.contact.type)} ${value.contact.value.trim()}` : '待补'}`,
    `教育背景：${fact(value.institution)}｜${fact(value.degree)}｜${fact(value.major)}`,
    `毕业时间：${fact(value.graduationDate || value.graduationYear)}`
  ]

  const scoreFacts = [`均分 ${fact(value.averageScore)}`, `GPA ${fact(value.gpa)}`]
  if (value.gpa.trim() || value.gpaScale.trim()) scoreFacts.push(`分制 ${fact(value.gpaScale, '原始分制待补')}`)
  if (value.classRank.trim()) scoreFacts.push(`班级排名 ${value.classRank.trim()}`)
  lines.push(`成绩：${scoreFacts.join('；')}`)

  const language = value.languageScores
  const languageFacts = []
  if (value.languageType !== 'NONE') languageFacts.push(value.languageType)
  if (language.total.trim()) languageFacts.push(`总分 ${language.total.trim()}`)
  const subscores = Object.entries(language.subscores)
    .filter(([, score]) => stringValue(score).trim())
    .map(([name, score]) => `${name} ${stringValue(score).trim()}`)
  if (subscores.length) languageFacts.push(`分项 ${subscores.join('／')}`)
  if (language.examDate.trim()) languageFacts.push(`考试日期 ${language.examDate.trim()}`)
  if (language.raw.trim()) languageFacts.push(language.raw.trim())
  lines.push(`语言成绩：${languageFacts.length ? languageFacts.join('；') : '待补（暂无可用成绩）'}`)

  const targetFacts = []
  if (value.targetYear && value.targetYear !== TARGET_YEAR_UNDECIDED) targetFacts.push(`入学年份 ${value.targetYear}`)
  if (value.targetMajors.length) targetFacts.push(`意向专业 ${value.targetMajors.join('、')}`)
  if (value.targetInstitutions.length) targetFacts.push(`意向院校 ${value.targetInstitutions.join('、')}`)
  if (value.targetPreference.trim()) targetFacts.push(`偏好说明 ${value.targetPreference.trim()}`)
  if (targetFacts.length) lines.push(`申请目标：${targetFacts.join('；')}`)

  const experiences = value.experiences.filter(hasAnyExperienceFact)
  if (experiences.length) {
    experiences.forEach((experience) => {
      const type = EXPERIENCE_TYPES.find((item) => item.value === experience.type)
      const facts = [type ? type.label : experience.type]
      if (experience.title.trim()) facts.push(experience.title.trim())
      if (experience.organization.trim()) facts.push(experience.organization.trim())
      if (experience.description.trim()) facts.push(experience.description.trim())
      const dates = [experience.startDate.trim(), experience.endDate.trim()].filter(Boolean)
      if (dates.length) facts.push(dates.join('—'))
      lines.push(`相关经历：${facts.join('｜')}`)
    })
  } else {
    lines.push('相关经历：待补')
  }

  return {
    title: '简历草稿（仅据本人提供事实）',
    factsOnly: true,
    lines,
    text: lines.join('\n')
  }
}

function isSupportedDocumentType(type) { return DOCUMENT_TYPES.includes(String(type || '').toUpperCase()) }

module.exports = {
  CONTACT_TYPES, DOCUMENT_META, DOCUMENT_TYPES, EDUCATION_STATUSES, EDUCATION_STATUS_OPTIONS, EXPERIENCE_TYPES,
  LANGUAGE_STATUSES, LANGUAGE_TYPES, MAX_DOCUMENTS, MAX_DOCUMENT_SIZE, PATHS,
  TARGET_YEAR_OPTIONS, TARGET_YEAR_UNDECIDED, TARGET_YEAR_UNDECIDED_LABEL,
  buildMaterialCards, buildResumeReview, documentTypeLabel, documentsForType, educationStatusLabel, emptyLanguageScores,
  experienceTypeLabel, parseStatusLabel, targetYearLabel, uploadStatusLabel,
  emptyProfile, formatSize, isSupportedDocumentType, normalizeConsultation,
  normalizeDocument, normalizeExperience, normalizeList, normalizeProfile,
  requiredProfileFields, resumeDraft, stringValue
}
