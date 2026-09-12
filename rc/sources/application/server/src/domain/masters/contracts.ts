import { invariant } from '../errors'

/**
 * Application Compass is deliberately a separate bounded context from the
 * legacy Education Compass assessment tables.  The version is returned by the
 * service so clients can pin the shape they rendered.
 */
export const MASTERS_CONTRACT_VERSION = 'masters-intake-v1.1' as const
export const MASTERS_SERVICE_CONSENT_VERSION = 'masters_service_consent_v1.1' as const
export function mastersConsentCopy(retentionDays: number): string {
  return `资料仅用于建立香港硕士咨询档案、顾问核验和生成申请方案，由服务端私有保存与本地解析。自最近一次资料更新起保留 ${retentionDays} 天，逾期由清理任务删除；撤回后立即停止未完成处理并删除原件。咨询、外部 AI、营销授权分别处理；当前不向外部模型发送材料，未勾选营销不影响咨询。`
}
export const MASTERS_REPORT_TEMPLATE_VERSION = 'masters_application_report_v1.1' as const

export type MastersConsultationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'NEEDS_INFO'
  | 'IN_REVIEW'
  | 'CLOSED'
  | 'WITHDRAWN'

export type MastersReportStatus =
  | 'NOT_STARTED'
  | 'QUEUED'
  | 'RUNNING'
  | 'NEEDS_REVIEW'
  | 'APPROVED'
  | 'RELEASED'
  | 'FAILED'
  | 'STALE'

export type MastersJobStatus = Exclude<MastersReportStatus, 'NOT_STARTED' | 'RELEASED' | 'APPROVED'>

export type MastersStaffRole = 'founder' | 'advisor' | 'assignment_manager'
export type MastersStaffStatus = 'ACTIVE' | 'SUSPENDED'
export type MastersAssignmentStatus = 'ACTIVE' | 'ENDED'
export type MastersUploadStatus = 'UPLOADED' | 'FAILED' | 'REMOVED'
export type MastersExtractionStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'NEEDS_CONFIRMATION'
  | 'MANUAL_REVIEW'
  | 'FAILED'

/** The seven persisted categories.  Display aliases are normalized in validation.ts. */
export type MastersDocumentType =
  | 'RESUME'
  | 'TRANSCRIPT'
  | 'LANGUAGE'
  | 'ENROLLMENT'
  | 'GRADUATION'
  | 'DEGREE'
  | 'SUPPLEMENTAL'

export type MastersDocumentTypeAlias =
  | MastersDocumentType
  | 'CV'
  | 'LANGUAGE_SCORE'
  | 'ENROLMENT_CERTIFICATE'
  | 'GRADUATION_CERTIFICATE'
  | 'DEGREE_CERTIFICATE'
  | 'SUPPORTING_DOCUMENT'

export type MastersEducationStatus = 'ENROLLED' | 'GRADUATED'
export type MastersLanguageStatus = 'NONE' | 'AVAILABLE'
export type MastersLanguageType = 'IELTS' | 'TOEFL' | 'OTHER' | 'NONE'
export type MastersContactType = 'email' | 'phone' | 'wechat'
export type MastersExperienceType = 'INTERNSHIP' | 'RESEARCH' | 'COMPETITION' | 'STUDENT_WORK' | 'OTHER'

export interface MastersContact {
  type: MastersContactType
  value: string
}

export interface MastersLanguageScores {
  /** Keep the value exactly as supplied; no GPA or score conversion is done. */
  total?: string | null
  subscores?: Record<string, string | null> | null
  examDate?: string | null
  raw?: string | null
}

export interface MastersExperience {
  type: MastersExperienceType
  title?: string | null
  organization?: string | null
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  facts?: string | null
  evidenceDocumentId?: string | null
}

/**
 * All fields are optional while a draft is empty.  Submission validation in
 * validation.ts enforces the smaller set of required fields and never fills a
 * missing value with a fabricated default.
 */
export interface MastersProfile {
  name?: string | null
  adultConfirmed?: boolean
  contact?: MastersContact | null
  educationStatus?: MastersEducationStatus | null
  institution?: string | null
  degree?: string | null
  major?: string | null
  graduationYear?: string | null
  /** V1.1 accepts an exact YYYY-MM or YYYY-MM-DD value in addition to year. */
  graduationDate?: string | null
  averageScore?: string | null
  gpa?: string | null
  gpaScale?: string | null
  classRank?: string | null
  languageStatus?: MastersLanguageStatus | null
  languageType?: MastersLanguageType | null
  languageScores?: string | MastersLanguageScores | null
  targetYear?: string | null | 'UNDECIDED'
  targetMajors?: string | string[] | null
  targetInstitutions?: string | string[] | null
  targetPreference?: string | null
  experiences?: MastersExperience[] | null
  /** Accuracy confirmation is independent from service consent. */
  accuracyConfirmed?: boolean
}

export interface MastersServiceConsentInput {
  accepted: true
  copyVersion?: string
  version?: string
  locale?: string
}

export interface MastersCreateInput {
  targetYear?: string | 'UNDECIDED'
  channel?: string
  path?: string
  linkedStudentId?: string | null
  serviceConsent?: MastersServiceConsentInput
}

export interface MastersPatchInput {
  version: number
  profile: MastersProfile
  path?: 'RESUME' | 'GUIDED'
}

export interface MastersConfirmInput {
  version: number
  accuracyConfirmed?: true
  /** Accepted for endpoint compatibility; stored separately as a consent row. */
  consent?: MastersServiceConsentInput
}

export interface MastersDocumentExtraction {
  /** Immutable per-file candidate values, kept separate from derived conflicts. */
  candidates?: Record<string, string[]>
  status?: MastersExtractionStatus
  fields?: Record<string, unknown>
  source?: string | null
  evidence?: Array<{
    field: string
    location?: string | null
    excerpt?: string | null
    confidence?: 'LOW' | 'MEDIUM' | 'HIGH' | 'NEEDS_CONFIRMATION' | null
  }>
  conflicts?: Array<{
    field: string
    values: string[]
    resolution?: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  }>
  /** Explicit applicant confirmation provenance for an extracted profile value. */
  confirmations?: Array<{
    field: string
    value: string | null
    documentId: string
    actorUserId: string
    confirmedAt: string
  }>
  errorCode?: string | null
}

export interface MastersAddDocumentInput {
  version: number
  type: MastersDocumentTypeAlias
  storageKey: string
  originalName: string
  description?: string | null
  /** When set, the old row is retained for audit but marked REMOVED atomically. */
  replaceDocumentId?: string
  mimeType: string
  sizeBytes: number
  sha256: string
  extraction?: MastersDocumentExtraction | null
}

export interface MastersConsultation {
  id: string
  userId: string
  linkedStudentId: string | null
  applicationSeason: string
  channel: string
  path: string
  status: MastersConsultationStatus
  profile: MastersProfile
  profileVersion: number
  accuracyConfirmed: boolean
  serviceConsentId: string | null
  confirmedSnapshotId: string | null
  submittedAt: string | null
  withdrawnAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MastersDocument {
  id: string
  consultationId: string
  userId: string
  type: MastersDocumentType
  storageKey: string
  originalName: string
  description: string | null
  mimeType: string
  sizeBytes: number
  sha256: string
  profileVersion: number
  uploadStatus: MastersUploadStatus
  extractionStatus: MastersExtractionStatus
  extraction: MastersDocumentExtraction | null
  uploadedAt: string
  updatedAt: string
  removedAt: string | null
}

/** Student-safe attachment projection; private storage and ownership keys are omitted. */
export interface MastersDocumentView {
  id: string
  type: MastersDocumentType
  originalName: string
  description: string | null
  mimeType: string
  sizeBytes: number
  profileVersion: number
  uploadStatus: MastersUploadStatus
  extractionStatus: MastersExtractionStatus
  uploadedAt: string
  updatedAt: string
  removedAt: string | null
}

export interface MastersConsent {
  id: string
  consultationId: string
  userId: string
  copyVersion: string
  copyTextHash: string
  locale: string
  accepted: true
  grantedAt: string
  withdrawnAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MastersSnapshot {
  id: string
  consultationId: string
  userId: string
  profileVersion: number
  profile: MastersProfile
  documentIds: string[]
  accuracyConfirmed: true
  confirmedBy: string
  confirmedAt: string
  createdAt: string
}

export interface MastersStaff {
  id: string
  userId: string
  role: MastersStaffRole
  status: MastersStaffStatus
  grantedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface MastersAssignment {
  id: string
  consultationId: string
  advisorUserId: string
  assignedBy: string
  status: MastersAssignmentStatus
  assignedAt: string
  endedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MastersAssignmentView {
  id: string
  status: MastersAssignmentStatus
  assignedAt: string
  endedAt: string | null
}

export interface MastersConsentView {
  id: string
  copyVersion: string
  locale: string
  accepted: true
  grantedAt: string
  withdrawnAt: string | null
}

export interface MastersReportPayload {
  templateVersion: string
  backgroundSummary: string
  strengthsAndGaps: {
    strengths: string[]
    gaps: string[]
  }
  suggestedDirections: string[]
  candidatePrograms: Array<{
    institution: string
    program: string
    intakeYear: string
    requirements: string
    matchReason: string
    risks: string[]
    officialUrl: string
    verifiedAt: string
    sourceStatus: 'NEEDS_REVIEW' | 'VERIFIED'
    studentAccepted: 'PENDING' | 'ACCEPTED' | 'DECLINED'
  }>
  preparationPlan: string[]
  nextStepsAndLimitations: string[]
  missingFields: string[]
  missingDocuments: MastersDocumentType[]
  verificationStatus: 'NEEDS_REVIEW' | 'READY'
}

export interface MastersReport {
  id: string
  consultationId: string
  snapshotId: string
  sourceProfileVersion: number
  version: number
  status: MastersReportStatus
  templateVersion: string
  payload: MastersReportPayload
  editedBy: string | null
  reviewedBy: string | null
  approvedBy: string | null
  releasedBy: string | null
  reviewedAt: string | null
  approvedAt: string | null
  releasedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MastersReportJob {
  id: string
  consultationId: string
  snapshotId: string
  sourceProfileVersion: number
  reportId: string
  status: MastersJobStatus
  attempts: number
  maxAttempts: number
  leaseToken: string | null
  leaseOwner: string | null
  leaseExpiresAt: string | null
  nextAttemptAt: string
  lastError: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface MastersAuditLog {
  id: string
  consultationId: string | null
  actorUserId: string | null
  action: string
  metadata: Record<string, unknown>
  createdAt: string
}

export type MastersIdempotencyDomain =
  | 'CREATE'
  | 'CONSENT'
  | 'CONFIRM'
  | 'SUBMIT'
  | 'DOCUMENT_ADD'
  | 'ASSIGN'
  | 'ENQUEUE_REPORT'

export interface MastersIdempotencyRecord {
  id: string
  userId: string
  domain: MastersIdempotencyDomain
  keyDigest: string
  inputDigest: string
  status: 'IN_PROGRESS' | 'COMPLETED'
  resourceType: string | null
  resourceId: string | null
  responseStatus: number | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface MastersReadiness {
  missingFields: string[]
  missingDocuments: MastersDocumentType[]
  verificationStatus: 'NEEDS_REVIEW' | 'READY' | 'WITHDRAWN'
}

export interface MastersConsultationDetail extends MastersConsultation, MastersReadiness {
  documentRequest?: { types: MastersDocumentType[]; note: string; requestedAt: string } | null
  /** Runtime student DTO omits private fields; the structural type stays compatible with HTTP mappers. */
  documents: MastersDocument[]
  consent: MastersConsentView | null
  assignments: MastersAssignmentView[]
  /** Non-released values are runtime summaries containing status only. */
  currentReport: MastersReport | null
}

export interface MastersInternalConsultationDetail extends MastersConsultation, MastersReadiness {
  documentRequest?: { types: MastersDocumentType[]; note: string; requestedAt: string } | null
  documents: MastersDocument[]
  consent: MastersConsent | null
  assignments: MastersAssignment[]
  currentReport: MastersReport | null
}

export interface MastersRequestDocumentsInput {
  types?: MastersDocumentTypeAlias[]
  note?: string
}

export interface MastersReportEditInput {
  version: number
  reportId?: string
  payload: Partial<MastersReportPayload>
}

export interface MastersReportReviewInput {
  version: number
  reportId?: string
  note?: string
}

export interface MastersReportDecisionInput {
  version: number
  reportId?: string
  note?: string
}

export interface MastersClaimJobOptions {
  leaseMs?: number
  maxAttempts?: number
}

export interface MastersExtractionResolutionInput {
  version: number
  documentId: string
  field: string
  value: string | null
  accepted?: boolean
}

export interface MastersMissingFieldsResult extends MastersReadiness {
  requiredForSubmit: string[]
}

export function assertMastersVersion(value: unknown, code = 'MASTERS_VERSION_INVALID'): number {
  invariant(Number.isInteger(value) && Number(value) >= 1, 400, code, '资料版本无效')
  return Number(value)
}
