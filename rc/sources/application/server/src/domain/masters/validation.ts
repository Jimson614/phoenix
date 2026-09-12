import { createHash } from 'node:crypto'
import { AppError, invariant } from '../errors'
import {
  MastersAddDocumentInput,
  MastersContact,
  MastersCreateInput,
  MastersDocument,
  MastersDocumentExtraction,
  MastersDocumentType,
  MastersDocumentTypeAlias,
  MastersEducationStatus,
  MastersExperience,
  MastersExperienceType,
  MastersLanguageScores,
  MastersLanguageStatus,
  MastersLanguageType,
  MastersProfile,
  MastersReadiness,
  MastersReportPayload,
  MastersServiceConsentInput,
  MastersStaffRole,
  MASTERS_REPORT_TEMPLATE_VERSION,
  MASTERS_SERVICE_CONSENT_VERSION
} from './contracts'

export const MASTERS_DOCUMENT_TYPES: readonly MastersDocumentType[] = [
  'RESUME', 'TRANSCRIPT', 'LANGUAGE', 'ENROLLMENT', 'GRADUATION', 'DEGREE', 'SUPPLEMENTAL'
] as const

const DOCUMENT_ALIASES: Record<string, MastersDocumentType> = {
  RESUME: 'RESUME',
  TRANSCRIPT: 'TRANSCRIPT',
  LANGUAGE: 'LANGUAGE',
  ENROLLMENT: 'ENROLLMENT',
  GRADUATION: 'GRADUATION',
  DEGREE: 'DEGREE',
  SUPPLEMENTAL: 'SUPPLEMENTAL',
  CV: 'RESUME',
  LANGUAGE_SCORE: 'LANGUAGE',
  ENROLMENT_CERTIFICATE: 'ENROLLMENT',
  GRADUATION_CERTIFICATE: 'GRADUATION',
  DEGREE_CERTIFICATE: 'DEGREE',
  SUPPORTING_DOCUMENT: 'SUPPLEMENTAL'
}

const STAFF_ROLE_ALIASES: Record<string, MastersStaffRole> = {
  founder: 'founder',
  FOUNDER: 'founder',
  advisor: 'advisor',
  ADVISOR: 'advisor',
  assignment_manager: 'assignment_manager',
  ASSIGNMENT_MANAGER: 'assignment_manager',
  dispatcher: 'assignment_manager',
  DISPATCHER: 'assignment_manager'
}

const PROFILE_KEYS = [
  'name', 'adultConfirmed', 'contact', 'educationStatus', 'institution', 'degree', 'major',
  'graduationYear', 'graduationDate', 'averageScore', 'gpa', 'gpaScale', 'classRank',
  'languageStatus', 'languageType', 'languageScores', 'targetYear', 'targetMajors',
  'targetInstitutions', 'targetPreference', 'experiences', 'accuracyConfirmed'
]

const EXTRA_KEYS = [
  'type', 'value', 'total', 'subscores', 'examDate', 'raw', 'title', 'organization',
  'description', 'startDate', 'endDate', 'facts', 'evidenceDocumentId', 'accepted',
  'copyVersion', 'version', 'locale', 'status', 'fields', 'source', 'evidence', 'conflicts',
  'errorCode', 'field', 'location', 'excerpt', 'confidence', 'values', 'resolution',
  'confirmations', 'documentId', 'actorUserId', 'confirmedAt'
]

function object(value: unknown, code: string, message: string): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 400, code, message)
  return value as Record<string, unknown>
}

function exact(value: unknown, allowed: readonly string[], code = 'MASTERS_UNKNOWN_FIELD'): Record<string, unknown> {
  const record = object(value, code, '参数必须是对象')
  for (const key of Object.keys(record)) {
    invariant(allowed.includes(key), 400, code, `不支持字段: ${key}`)
  }
  return record
}

function optionalString(value: unknown, field: string, max = 2000): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  invariant(typeof value === 'string', 400, 'MASTERS_FIELD_INVALID', `${field} 必须是字符串或 null`)
  invariant(value.length <= max, 400, 'MASTERS_FIELD_INVALID', `${field} 超出长度限制`)
  return value
}

function nonEmptyString(value: unknown, field: string, max = 2000): string {
  invariant(typeof value === 'string' && value.trim().length > 0, 400, 'MASTERS_FIELD_REQUIRED', `${field} 不能为空`)
  invariant(value.length <= max, 400, 'MASTERS_FIELD_INVALID', `${field} 超出长度限制`)
  return value
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  invariant(typeof value === 'boolean', 400, 'MASTERS_FIELD_INVALID', `${field} 必须是布尔值`)
  return value
}

function optionalStringList(value: unknown, field: string): string | string[] | null | undefined {
  if (value === undefined || value === null || typeof value === 'string') {
    if (typeof value === 'string') invariant(value.length <= 2000, 400, 'MASTERS_FIELD_INVALID', `${field} 超出长度限制`)
    return value as string | null | undefined
  }
  invariant(Array.isArray(value), 400, 'MASTERS_FIELD_INVALID', `${field} 必须是字符串或字符串数组`)
  invariant(value.length <= 50, 400, 'MASTERS_FIELD_INVALID', `${field} 条目过多`)
  const list = value.map((item) => nonEmptyString(item, field, 500))
  return list
}

function validYear(value: unknown, field: string, allowUndecided = false): string | null | undefined {
  if (value === undefined || value === null) return value as null | undefined
  invariant(typeof value === 'string', 400, 'MASTERS_FIELD_INVALID', `${field} 必须是字符串`)
  invariant((allowUndecided && value === 'UNDECIDED') || /^(19|20|21)\d{2}$/.test(value), 400, 'MASTERS_FIELD_INVALID', `${field} 年份无效`)
  return value
}

function validDate(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value as null | undefined
  invariant(typeof value === 'string', 400, 'MASTERS_FIELD_INVALID', `${field} 必须是字符串`)
  invariant(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.test(value), 400, 'MASTERS_FIELD_INVALID', `${field} 日期格式无效`)
  return value
}

function validDateTime(value: unknown, field: string): string {
  invariant(typeof value === 'string' && value.length <= 80 && Number.isFinite(Date.parse(value)), 400, 'MASTERS_FIELD_INVALID', `${field} 时间无效`)
  return new Date(value).toISOString()
}

function parseContact(value: unknown): MastersContact | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const record = exact(value, ['type', 'value'], 'MASTERS_CONTACT_INVALID')
  invariant(record.type === 'email' || record.type === 'phone' || record.type === 'wechat', 400, 'MASTERS_CONTACT_INVALID', '联系方式类型无效')
  const contactValue = nonEmptyString(record.value, 'contact.value', 320).trim()
  if (record.type === 'email') {
    invariant(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactValue), 400, 'MASTERS_CONTACT_INVALID', '邮箱格式无效')
  } else if (record.type === 'phone') {
    invariant(/^\+?[0-9][0-9 ()-]{5,30}$/.test(contactValue), 400, 'MASTERS_CONTACT_INVALID', '手机号格式无效')
  }
  return { type: record.type, value: contactValue }
}

function parseSubscores(value: unknown): Record<string, string | null> | null | undefined {
  if (value === undefined || value === null) return value as null | undefined
  const record = object(value, 'MASTERS_LANGUAGE_SCORES_INVALID', '语言小分必须是对象')
  const result: Record<string, string | null> = {}
  for (const [key, item] of Object.entries(record)) {
    invariant(/^[A-Za-z][A-Za-z0-9 _-]{0,40}$/.test(key), 400, 'MASTERS_LANGUAGE_SCORES_INVALID', '语言小分名称无效')
    invariant(item === null || typeof item === 'string', 400, 'MASTERS_LANGUAGE_SCORES_INVALID', '语言小分必须保留为字符串')
    if (typeof item === 'string') invariant(item.length <= 100, 400, 'MASTERS_LANGUAGE_SCORES_INVALID', '语言小分超出长度限制')
    result[key] = item
  }
  return result
}

function parseLanguageScores(value: unknown): string | MastersLanguageScores | null | undefined {
  if (value === undefined || value === null || typeof value === 'string') {
    if (typeof value === 'string') invariant(value.length <= 1000, 400, 'MASTERS_LANGUAGE_SCORES_INVALID', '语言成绩超出长度限制')
    return value as string | null | undefined
  }
  const record = exact(value, ['total', 'subscores', 'examDate', 'raw'], 'MASTERS_LANGUAGE_SCORES_INVALID')
  const total = optionalString(record.total, 'languageScores.total', 100)
  const examDate = validDate(record.examDate, 'languageScores.examDate')
  const raw = optionalString(record.raw, 'languageScores.raw', 1000)
  const subscores = parseSubscores(record.subscores)
  return {
    ...(total !== undefined ? { total } : {}),
    ...(subscores !== undefined ? { subscores } : {}),
    ...(examDate !== undefined ? { examDate } : {}),
    ...(raw !== undefined ? { raw } : {})
  }
}

function parseExperience(value: unknown): MastersExperience[] | null | undefined {
  if (value === undefined || value === null) return value as null | undefined
  invariant(Array.isArray(value), 400, 'MASTERS_EXPERIENCES_INVALID', 'experiences 必须是数组')
  invariant(value.length <= 50, 400, 'MASTERS_EXPERIENCES_INVALID', '经历条目过多')
  return value.map((entry) => {
    const record = exact(entry, ['type', 'title', 'organization', 'description', 'startDate', 'endDate', 'facts', 'evidenceDocumentId'], 'MASTERS_EXPERIENCE_INVALID')
    invariant(record.type === 'INTERNSHIP' || record.type === 'RESEARCH' || record.type === 'COMPETITION' || record.type === 'STUDENT_WORK' || record.type === 'OTHER', 400, 'MASTERS_EXPERIENCE_INVALID', '经历类型无效')
    const result: MastersExperience = { type: record.type as MastersExperienceType }
    for (const field of ['title', 'organization', 'description', 'facts', 'evidenceDocumentId'] as const) {
      const parsed = optionalString(record[field], `experiences.${field}`, 2000)
      if (parsed !== undefined) result[field] = parsed
    }
    for (const field of ['startDate', 'endDate'] as const) {
      const parsed = validDate(record[field], `experiences.${field}`)
      if (parsed !== undefined) result[field] = parsed
    }
    return result
  })
}

export function normalizeDocumentType(value: unknown): MastersDocumentType {
  invariant(typeof value === 'string' && Object.hasOwn(DOCUMENT_ALIASES, value), 400, 'MASTERS_DOCUMENT_TYPE_INVALID', '材料类型无效')
  return DOCUMENT_ALIASES[value] as MastersDocumentType
}

export function normalizeStaffRole(value: unknown): MastersStaffRole {
  invariant(typeof value === 'string' && Object.hasOwn(STAFF_ROLE_ALIASES, value), 400, 'MASTERS_STAFF_ROLE_INVALID', '内部角色无效')
  return STAFF_ROLE_ALIASES[value] as MastersStaffRole
}

export function validateProfileDraft(value: unknown): MastersProfile {
  const record = exact(value, PROFILE_KEYS)
  const result: MastersProfile = {}
  const name = optionalString(record.name, 'name', 200)
  if (name !== undefined) result.name = name
  const adultConfirmed = optionalBoolean(record.adultConfirmed, 'adultConfirmed')
  if (adultConfirmed !== undefined) result.adultConfirmed = adultConfirmed
  const contact = parseContact(record.contact)
  if (contact !== undefined) result.contact = contact
  const educationStatus = record.educationStatus
  if (educationStatus !== undefined && educationStatus !== null) invariant(educationStatus === 'ENROLLED' || educationStatus === 'GRADUATED', 400, 'MASTERS_EDUCATION_STATUS_INVALID', '学籍状态无效')
  if (educationStatus !== undefined) result.educationStatus = educationStatus as MastersEducationStatus | null
  for (const field of ['institution', 'degree', 'major', 'averageScore', 'gpa', 'gpaScale', 'classRank', 'targetPreference'] as const) {
    const parsed = optionalString(record[field], field, 2000)
    if (parsed !== undefined) result[field] = parsed
  }
  const graduationYear = validYear(record.graduationYear, 'graduationYear')
  if (graduationYear !== undefined) result.graduationYear = graduationYear
  const graduationDate = validDate(record.graduationDate, 'graduationDate')
  if (graduationDate !== undefined) result.graduationDate = graduationDate
  const languageStatus = record.languageStatus
  if (languageStatus !== undefined && languageStatus !== null) invariant(languageStatus === 'NONE' || languageStatus === 'AVAILABLE', 400, 'MASTERS_LANGUAGE_STATUS_INVALID', '语言成绩状态无效')
  if (languageStatus !== undefined) result.languageStatus = languageStatus as MastersLanguageStatus | null
  const languageType = record.languageType
  if (languageType !== undefined && languageType !== null) invariant(languageType === 'IELTS' || languageType === 'TOEFL' || languageType === 'OTHER' || languageType === 'NONE', 400, 'MASTERS_LANGUAGE_TYPE_INVALID', '语言考试类型无效')
  if (languageType !== undefined) result.languageType = languageType as MastersLanguageType | null
  const languageScores = parseLanguageScores(record.languageScores)
  if (languageScores !== undefined) result.languageScores = languageScores
  const targetYear = validYear(record.targetYear, 'targetYear', true)
  if (targetYear !== undefined) result.targetYear = targetYear
  for (const field of ['targetMajors', 'targetInstitutions'] as const) {
    const parsed = optionalStringList(record[field], field)
    if (parsed !== undefined) result[field] = parsed
  }
  const experiences = parseExperience(record.experiences)
  if (experiences !== undefined) result.experiences = experiences
  const accuracyConfirmed = optionalBoolean(record.accuracyConfirmed, 'accuracyConfirmed')
  if (accuracyConfirmed !== undefined) result.accuracyConfirmed = accuracyConfirmed
  if (result.languageStatus === 'NONE' || result.languageType === 'NONE') {
    const scores = result.languageScores
    const hasScores = typeof scores === 'string' ? scores.trim().length > 0 : scores !== null && scores !== undefined && Object.keys(scores).length > 0
    invariant(!hasScores, 400, 'MASTERS_LANGUAGE_CONFLICT', '暂无语言成绩时不能同时填写语言分数')
  }
  if (result.languageStatus === 'AVAILABLE' && result.languageType === 'NONE') {
    throw new AppError(400, 'MASTERS_LANGUAGE_CONFLICT', '已有语言成绩时考试类型不能为 NONE')
  }
  return result
}

export function mergeProfile(current: MastersProfile, patch: MastersProfile): MastersProfile {
  return validateProfileDraft({ ...current, ...patch })
}

export function validateCreateInput(value: unknown): MastersCreateInput {
  const record = exact(value, ['targetYear', 'channel', 'path', 'linkedStudentId', 'serviceConsent'])
  const targetYear = validYear(record.targetYear, 'targetYear', true)
  const channel = record.channel === undefined ? '' : nonEmptyString(record.channel, 'channel', 100)
  const path = record.path === undefined ? '' : nonEmptyString(record.path, 'path', 100)
  invariant(['', 'organic', 'wechat', 'partner', 'campus', 'campaign'].includes(channel), 400, 'MASTERS_CHANNEL_INVALID', '来源渠道无效')
  invariant(['', 'RESUME', 'GUIDED'].includes(path), 400, 'MASTERS_PATH_INVALID', '咨询路径无效')
  let linkedStudentId: string | null | undefined
  if (record.linkedStudentId !== undefined) {
    linkedStudentId = record.linkedStudentId === null ? null : nonEmptyString(record.linkedStudentId, 'linkedStudentId', 200)
  }
  const serviceConsent = parseServiceConsent(record.serviceConsent)
  return {
    targetYear: targetYear ?? 'UNDECIDED',
    channel,
    path,
    ...(linkedStudentId !== undefined ? { linkedStudentId } : {}),
    ...(serviceConsent !== undefined ? { serviceConsent } : {})
  }
}

export function parseServiceConsent(value: unknown): MastersServiceConsentInput | undefined {
  if (value === undefined) return undefined
  if (value === true) return { accepted: true, copyVersion: MASTERS_SERVICE_CONSENT_VERSION, locale: 'zh-CN' }
  const record = exact(value, ['accepted', 'copyVersion', 'version', 'locale'], 'MASTERS_CONSENT_INVALID')
  invariant(record.accepted === true, 400, 'MASTERS_CONSENT_REQUIRED', '必须明确同意咨询资料授权')
  const copyVersion = record.copyVersion ?? record.version
  if (copyVersion !== undefined) nonEmptyString(copyVersion, 'consent.version', 100)
  const locale = record.locale === undefined ? 'zh-CN' : nonEmptyString(record.locale, 'consent.locale', 20)
  invariant(locale === 'zh-CN', 400, 'MASTERS_CONSENT_INVALID', '目前只支持 zh-CN 授权文本')
  invariant(copyVersion === undefined || copyVersion === MASTERS_SERVICE_CONSENT_VERSION, 400, 'MASTERS_CONSENT_INVALID', '咨询授权版本无效')
  return {
    accepted: true,
    ...(copyVersion !== undefined ? { copyVersion: String(copyVersion) } : { copyVersion: MASTERS_SERVICE_CONSENT_VERSION }),
    locale
  }
}

export function validatePatchInput(value: unknown): { version: number; profile: MastersProfile; path?: 'RESUME' | 'GUIDED' } {
  const record = exact(value, ['version', 'profile', 'path'])
  invariant(Number.isInteger(record.version) && Number(record.version) >= 1, 400, 'MASTERS_VERSION_INVALID', '资料版本无效')
  invariant(record.path === undefined || record.path === 'RESUME' || record.path === 'GUIDED', 400, 'MASTERS_PATH_INVALID', '请选择上传简历或分步填写')
  return { version: Number(record.version), profile: validateProfileDraft(record.profile), ...(record.path === undefined ? {} : { path: record.path as 'RESUME' | 'GUIDED' }) }
}

export function validateConfirmInput(value: unknown): { version: number; accuracyConfirmed: true; consent?: MastersServiceConsentInput } {
  const record = exact(value, ['version', 'accuracyConfirmed', 'consent'])
  invariant(Number.isInteger(record.version) && Number(record.version) >= 1, 400, 'MASTERS_VERSION_INVALID', '资料版本无效')
  invariant(record.accuracyConfirmed === true, 400, 'MASTERS_ACCURACY_REQUIRED', '请先确认资料准确')
  const consent = parseServiceConsent(record.consent)
  return { version: Number(record.version), accuracyConfirmed: true, ...(consent ? { consent } : {}) }
}

export function validateAddDocumentInput(value: unknown): MastersAddDocumentInput {
  const record = exact(value, ['version', 'type', 'storageKey', 'originalName', 'description', 'replaceDocumentId', 'mimeType', 'sizeBytes', 'sha256', 'extraction'])
  invariant(Number.isInteger(record.version) && Number(record.version) >= 1, 400, 'MASTERS_VERSION_INVALID', '资料版本无效')
  const type = normalizeDocumentType(record.type)
  const storageKey = nonEmptyString(record.storageKey, 'storageKey', 500)
  invariant(!/^(?:https?:|data:|file:)/i.test(storageKey), 400, 'MASTERS_STORAGE_KEY_INVALID', '附件必须使用私有存储引用')
  const originalName = nonEmptyString(record.originalName, 'originalName', 255)
  const description = optionalString(record.description, 'description', 2000)
  const replaceDocumentId = record.replaceDocumentId === undefined ? undefined : nonEmptyString(record.replaceDocumentId, 'replaceDocumentId', 200)
  const mimeType = nonEmptyString(record.mimeType, 'mimeType', 100).toLowerCase()
  invariant(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'].includes(mimeType), 400, 'MASTERS_MIME_UNSUPPORTED', '仅支持 PDF、DOCX、JPG、PNG')
  invariant(typeof record.sizeBytes === 'number' && Number.isInteger(record.sizeBytes) && record.sizeBytes > 0 && record.sizeBytes <= 10 * 1024 * 1024, 400, 'MASTERS_FILE_SIZE_INVALID', '附件大小必须在 1B 至 10MB 之间')
  invariant(typeof record.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(record.sha256), 400, 'MASTERS_FILE_DIGEST_INVALID', '附件 sha256 无效')
  const extraction = record.extraction === null || record.extraction === undefined ? undefined : validateExtraction(record.extraction)
  return {
    version: Number(record.version), type, storageKey, originalName, mimeType,
    sizeBytes: Number(record.sizeBytes), sha256: String(record.sha256).toLowerCase(),
    ...(description !== undefined ? { description } : {}),
    ...(replaceDocumentId !== undefined ? { replaceDocumentId } : {}),
    ...(extraction !== undefined ? { extraction } : {})
  }
}

export function validateExtraction(value: unknown): MastersDocumentExtraction {
  const record = exact(value, ['status', 'fields', 'source', 'evidence', 'conflicts', 'confirmations', 'candidates', 'errorCode'], 'MASTERS_EXTRACTION_INVALID')
  const result: MastersDocumentExtraction = {}
  if (record.candidates !== undefined) {
    const candidates = object(record.candidates, 'MASTERS_EXTRACTION_INVALID', '候选字段必须是对象')
    invariant(Object.values(candidates).every(values => Array.isArray(values) && values.every(v => typeof v === 'string')), 400, 'MASTERS_EXTRACTION_INVALID', '候选值必须是字符串数组')
    result.candidates = candidates as Record<string, string[]>
  }
  if (record.status !== undefined) {
    invariant(record.status === 'PENDING' || record.status === 'PROCESSING' || record.status === 'SUCCEEDED' || record.status === 'NEEDS_CONFIRMATION' || record.status === 'MANUAL_REVIEW' || record.status === 'FAILED', 400, 'MASTERS_EXTRACTION_INVALID', '解析状态无效')
    result.status = record.status
  }
  if (record.fields !== undefined) {
    object(record.fields, 'MASTERS_EXTRACTION_INVALID', '提取字段必须是对象')
    result.fields = record.fields as Record<string, unknown>
  }
  const source = optionalString(record.source, 'extraction.source', 500)
  if (source !== undefined) result.source = source
  const errorCode = optionalString(record.errorCode, 'extraction.errorCode', 100)
  if (errorCode !== undefined) result.errorCode = errorCode
  if (record.evidence !== undefined) {
    invariant(Array.isArray(record.evidence), 400, 'MASTERS_EXTRACTION_INVALID', '证据必须是数组')
    result.evidence = record.evidence.map((item) => {
      const evidence = exact(item, ['field', 'location', 'excerpt', 'confidence'], 'MASTERS_EXTRACTION_INVALID')
      const field = nonEmptyString(evidence.field, 'evidence.field', 100)
      const location = optionalString(evidence.location, 'evidence.location', 500)
      const excerpt = optionalString(evidence.excerpt, 'evidence.excerpt', 2000)
      const confidence = evidence.confidence === undefined || evidence.confidence === null ? null : evidence.confidence
      invariant(confidence === null || confidence === 'LOW' || confidence === 'MEDIUM' || confidence === 'HIGH' || confidence === 'NEEDS_CONFIRMATION', 400, 'MASTERS_EXTRACTION_INVALID', '证据置信度无效')
      return { field, ...(location !== undefined ? { location } : {}), ...(excerpt !== undefined ? { excerpt } : {}), confidence }
    })
  }
  if (record.conflicts !== undefined) {
    invariant(Array.isArray(record.conflicts), 400, 'MASTERS_EXTRACTION_INVALID', '冲突必须是数组')
    result.conflicts = record.conflicts.map((item) => {
      const conflict = exact(item, ['field', 'values', 'resolution'], 'MASTERS_EXTRACTION_INVALID')
      const field = nonEmptyString(conflict.field, 'conflicts.field', 100)
      invariant(Array.isArray(conflict.values) && conflict.values.every((v) => typeof v === 'string'), 400, 'MASTERS_EXTRACTION_INVALID', '冲突值必须是字符串数组')
      const resolution = conflict.resolution === undefined ? 'PENDING' : conflict.resolution
      invariant(resolution === 'PENDING' || resolution === 'ACCEPTED' || resolution === 'REJECTED', 400, 'MASTERS_EXTRACTION_INVALID', '冲突处理状态无效')
      return { field, values: conflict.values as string[], resolution }
    })
  }
  if (record.confirmations !== undefined) {
    invariant(Array.isArray(record.confirmations), 400, 'MASTERS_EXTRACTION_INVALID', '确认来源必须是数组')
    result.confirmations = record.confirmations.map((item) => {
      const confirmation = exact(item, ['field', 'value', 'documentId', 'actorUserId', 'confirmedAt'], 'MASTERS_EXTRACTION_INVALID')
      const field = nonEmptyString(confirmation.field, 'confirmations.field', 100)
      const value = confirmation.value === null ? null : nonEmptyString(confirmation.value, 'confirmations.value', 2000)
      const documentId = nonEmptyString(confirmation.documentId, 'confirmations.documentId', 200)
      const actorUserId = nonEmptyString(confirmation.actorUserId, 'confirmations.actorUserId', 200)
      const confirmedAt = validDateTime(confirmation.confirmedAt, 'confirmations.confirmedAt')
      return { field, value, documentId, actorUserId, confirmedAt }
    })
  }
  if (result.status === 'FAILED') invariant(result.errorCode !== undefined && result.errorCode !== null, 400, 'MASTERS_EXTRACTION_INVALID', '解析失败必须提供错误码')
  return result
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : false
}

function hasList(value: string | string[] | null | undefined): boolean {
  return Array.isArray(value) ? value.some(hasText) : hasText(value)
}

export function requiredFields(profile: MastersProfile): string[] {
  const missing: string[] = []
  if (!hasText(profile.name)) missing.push('name')
  if (profile.adultConfirmed !== true) missing.push('adultConfirmed')
  if (!profile.contact?.value || !hasText(profile.contact.value)) missing.push('contact')
  if (!profile.educationStatus) missing.push('educationStatus')
  if (!hasText(profile.institution)) missing.push('institution')
  if (!hasText(profile.major)) missing.push('major')
  if (!profile.targetYear || (profile.targetYear !== 'UNDECIDED' && !/^\d{4}$/.test(profile.targetYear))) missing.push('targetYear')
  return missing
}

export function expectedDocuments(profile: MastersProfile): MastersDocumentType[] {
  const expected: MastersDocumentType[] = ['TRANSCRIPT']
  if (profile.languageStatus !== 'NONE') expected.push('LANGUAGE')
  if (profile.educationStatus === 'ENROLLED') expected.push('ENROLLMENT')
  if (profile.educationStatus === 'GRADUATED') expected.push('GRADUATION', 'DEGREE')
  return expected
}

export function calculateReadiness(profile: MastersProfile, documents: MastersDocument[], consentActive: boolean, withdrawn = false): MastersReadiness {
  if (withdrawn) return { missingFields: [], missingDocuments: [], verificationStatus: 'WITHDRAWN' }
  const activeTypes = new Set(documents.filter((document) => document.uploadStatus === 'UPLOADED' && !document.removedAt).map((document) => document.type))
  const missingFields = [...requiredFields(profile), ...informationalMissingFields(profile)]
  if (!consentActive) missingFields.push('serviceConsent')
  const missingDocuments = expectedDocuments(profile).filter((type) => !activeTypes.has(type))
  const hasUnverifiedDocument = documents.some((document) => document.uploadStatus !== 'UPLOADED' || document.removedAt !== null || document.extractionStatus !== 'SUCCEEDED' || Boolean(document.extraction?.conflicts?.some((conflict) => conflict.resolution === 'PENDING')))
  return {
    missingFields,
    missingDocuments,
    verificationStatus: consentActive && missingFields.length === 0 && missingDocuments.length === 0 && !hasUnverifiedDocument ? 'READY' : 'NEEDS_REVIEW'
  }
}

/** Informational gaps are shown to staff and in the report; they do not block submit. */
export function informationalMissingFields(profile: MastersProfile): string[] {
  const missing: string[] = []
  if (!profile.languageStatus || profile.languageStatus === 'NONE') missing.push('languageScores')
  if (!hasText(profile.degree)) missing.push('degree')
  if (!hasText(profile.graduationDate) && !hasText(profile.graduationYear)) missing.push('graduationDate')
  if (!hasText(profile.averageScore) && !hasText(profile.gpa)) missing.push('academicScore')
  if (hasText(profile.gpa) && !hasText(profile.gpaScale)) missing.push('gpaScale')
  if (profile.languageStatus === 'AVAILABLE' && profile.languageScores === undefined) missing.push('languageScores')
  if (profile.languageStatus === 'AVAILABLE' && typeof profile.languageScores === 'object' && profile.languageScores !== null) {
    if (!hasText(profile.languageScores.total) && !hasText(profile.languageScores.raw)) missing.push('languageScores.total')
    if (!profile.languageScores.examDate) missing.push('languageScores.examDate')
  }
  return missing
}

export function reportTemplate(profile: MastersProfile, readiness: MastersReadiness): MastersReportPayload {
  const name = hasText(profile.name) ? String(profile.name) : '申请人资料待补'
  const institution = hasText(profile.institution) ? String(profile.institution) : '院校待核验'
  const major = hasText(profile.major) ? String(profile.major) : '专业待补'
  const targetYear = profile.targetYear === 'UNDECIDED' || !profile.targetYear ? '尚未确定，希望顾问建议' : String(profile.targetYear)
  const summaryParts = [
    `姓名/称呼：${name}`,
    `本科院校：${institution}`,
    `专业：${major}`,
    `目标入学年份：${targetYear}`
  ]
  const language = profile.languageStatus === 'NONE' ? '暂无语言成绩（据实保留）' : '语言成绩待核验'
  return {
    templateVersion: MASTERS_REPORT_TEMPLATE_VERSION,
    backgroundSummary: summaryParts.join('；'),
    strengthsAndGaps: { strengths: [], gaps: [...readiness.missingFields, ...readiness.missingDocuments] },
    suggestedDirections: [],
    candidatePrograms: [],
    preparationPlan: [],
    nextStepsAndLimitations: [
      '候选院校和专业需经顾问核验后补充。',
      `语言情况：${language}。`,
      '本草稿不包含录取概率、保录承诺或未经核验的学校要求。'
    ],
    missingFields: [...readiness.missingFields],
    missingDocuments: [...readiness.missingDocuments],
    verificationStatus: 'NEEDS_REVIEW'
  }
}

export function mergeReportPayload(current: MastersReportPayload, patch: Partial<MastersReportPayload>): MastersReportPayload {
  // The service validates the top-level payload shape before calling this
  // helper.  Keep a defensive clone so callers cannot mutate a persisted row.
  const merged = {
    ...current,
    ...patch,
    strengthsAndGaps: { ...current.strengthsAndGaps, ...(patch.strengthsAndGaps ?? {}) },
    candidatePrograms: patch.candidatePrograms ?? current.candidatePrograms,
    suggestedDirections: patch.suggestedDirections ?? current.suggestedDirections,
    preparationPlan: patch.preparationPlan ?? current.preparationPlan,
    nextStepsAndLimitations: patch.nextStepsAndLimitations ?? current.nextStepsAndLimitations,
    missingFields: patch.missingFields ?? current.missingFields,
    missingDocuments: patch.missingDocuments ?? current.missingDocuments
  }
  return structuredClone(merged)
}

export function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function exactReportPatch(value: unknown): Partial<MastersReportPayload> {
  const record = exact(value, [
    'templateVersion', 'backgroundSummary', 'strengthsAndGaps', 'suggestedDirections',
    'candidatePrograms', 'preparationPlan', 'nextStepsAndLimitations', 'missingFields',
    'missingDocuments', 'verificationStatus'
  ], 'MASTERS_REPORT_PAYLOAD_INVALID')
  const result: Partial<MastersReportPayload> = {}
  if (record.templateVersion !== undefined) result.templateVersion = nonEmptyString(record.templateVersion, 'templateVersion', 100)
  if (record.backgroundSummary !== undefined) result.backgroundSummary = nonEmptyString(record.backgroundSummary, 'backgroundSummary', 10000)
  if (record.strengthsAndGaps !== undefined) {
    const groups = exact(record.strengthsAndGaps, ['strengths', 'gaps'], 'MASTERS_REPORT_PAYLOAD_INVALID')
    invariant(Array.isArray(groups.strengths) && groups.strengths.every((item) => typeof item === 'string'), 400, 'MASTERS_REPORT_PAYLOAD_INVALID', 'strengths 必须是字符串数组')
    invariant(Array.isArray(groups.gaps) && groups.gaps.every((item) => typeof item === 'string'), 400, 'MASTERS_REPORT_PAYLOAD_INVALID', 'gaps 必须是字符串数组')
    result.strengthsAndGaps = { strengths: groups.strengths as string[], gaps: groups.gaps as string[] }
  }
  for (const field of ['suggestedDirections', 'preparationPlan', 'nextStepsAndLimitations', 'missingFields'] as const) {
    if (record[field] !== undefined) {
      invariant(Array.isArray(record[field]) && record[field].every((item) => typeof item === 'string'), 400, 'MASTERS_REPORT_PAYLOAD_INVALID', `${field} 必须是字符串数组`)
      result[field] = record[field] as string[]
    }
  }
  if (record.missingDocuments !== undefined) {
    invariant(Array.isArray(record.missingDocuments), 400, 'MASTERS_REPORT_PAYLOAD_INVALID', 'missingDocuments 必须是数组')
    result.missingDocuments = record.missingDocuments.map(normalizeDocumentType)
  }
  if (record.verificationStatus !== undefined) {
    invariant(record.verificationStatus === 'NEEDS_REVIEW' || record.verificationStatus === 'READY', 400, 'MASTERS_REPORT_PAYLOAD_INVALID', 'verificationStatus 无效')
    result.verificationStatus = record.verificationStatus
  }
  if (record.candidatePrograms !== undefined) {
    invariant(Array.isArray(record.candidatePrograms), 400, 'MASTERS_REPORT_PAYLOAD_INVALID', 'candidatePrograms 必须是数组')
    // Keep candidate validation intentionally strict: a candidate cannot be
    // made public without an official URL and a verification state.
    result.candidatePrograms = record.candidatePrograms.map((item) => {
      const candidate = exact(item, ['institution', 'program', 'intakeYear', 'requirements', 'matchReason', 'risks', 'officialUrl', 'verifiedAt', 'sourceStatus', 'studentAccepted'], 'MASTERS_CANDIDATE_INVALID')
      const institution = nonEmptyString(candidate.institution, 'candidate.institution', 300)
      const program = nonEmptyString(candidate.program, 'candidate.program', 300)
      const intakeYear = nonEmptyString(candidate.intakeYear, 'candidate.intakeYear', 20)
      const requirements = nonEmptyString(candidate.requirements, 'candidate.requirements', 5000)
      const matchReason = nonEmptyString(candidate.matchReason, 'candidate.matchReason', 5000)
      invariant(Array.isArray(candidate.risks) && candidate.risks.every((risk) => typeof risk === 'string'), 400, 'MASTERS_CANDIDATE_INVALID', 'candidate.risks 必须是字符串数组')
      const officialUrl = nonEmptyString(candidate.officialUrl, 'candidate.officialUrl', 1000)
      invariant(/^https:\/\//i.test(officialUrl), 400, 'MASTERS_CANDIDATE_INVALID', '候选项目必须使用 HTTPS 官网地址')
      const verifiedAt = validDate(candidate.verifiedAt, 'candidate.verifiedAt')
      invariant(typeof verifiedAt === 'string', 400, 'MASTERS_CANDIDATE_INVALID', '核验日期无效')
      invariant(candidate.sourceStatus === 'NEEDS_REVIEW' || candidate.sourceStatus === 'VERIFIED', 400, 'MASTERS_CANDIDATE_INVALID', '来源状态无效')
      invariant(candidate.studentAccepted === 'PENDING' || candidate.studentAccepted === 'ACCEPTED' || candidate.studentAccepted === 'DECLINED', 400, 'MASTERS_CANDIDATE_INVALID', '学生接受状态无效')
      return { institution, program, intakeYear, requirements, matchReason, risks: candidate.risks as string[], officialUrl, verifiedAt, sourceStatus: candidate.sourceStatus, studentAccepted: candidate.studentAccepted }
    })
  }
  return result
}

export function assertDocumentBelongsToVersion(document: MastersDocument, version: number): void {
  invariant(document.profileVersion <= version, 409, 'MASTERS_DOCUMENT_VERSION_INVALID', '附件版本不能晚于当前资料版本')
}
