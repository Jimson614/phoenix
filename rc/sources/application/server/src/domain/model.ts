import type {
  MastersAssignment,
  MastersAuditLog,
  MastersConsent,
  MastersConsultation,
  MastersDocument,
  MastersIdempotencyRecord,
  MastersReport,
  MastersReportJob,
  MastersSnapshot,
  MastersStaff
} from './masters/contracts'

export type UserRole = 'family_user' | 'admin'
export type AssessmentStatus = 'DRAFT' | 'SUBMITTED' | 'PREVIEW_READY'
export type EducationAssessmentKind =
  | 'LEGACY_EDUCATION_COMPASS'
  | 'FREE_PARENT_COMPASS'
  | 'STUDENT_GROWTH_DISCOVERY'
export type EducationRespondentRole = 'LEGACY_UNSPECIFIED' | 'PARENT_GUARDIAN' | 'STUDENT'
export type EducationSystem = 'GAOKAO' | 'DSE' | 'IGCSE' | 'A_LEVEL' | 'AP_US' | 'IB' | 'OTHER'
export type EducationSourceEntry =
  | 'MINIPROGRAM_HOME'
  | 'LEVEL_1_RESULT'
  | 'DIRECT_LEVEL_2'
  | 'XIAOHONGSHU_CONTENT'
  | 'ADVISOR_REFERRAL'
  | 'INTERNAL_UAT'
export type EducationResultKind = 'LEGACY_EDUCATION_COMPASS_REPORT' | 'FAMILY_EDUCATION_SNAPSHOT' | 'STUDENT_GROWTH_DISCOVERY'
export type EducationReportKind = 'LEGACY_EDUCATION_COMPASS_REPORT' | 'FAMILY_EDUCATION_SNAPSHOT' | 'STUDENT_GROWTH_DISCOVERY'
export type Confidence = 'low' | 'medium' | 'high'
export type ReportStatus = 'LOCKED' | 'GENERATING' | 'READY' | 'FAILED'
export type OrderStatus = 'CREATED' | 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDING' | 'REFUNDED'
export type EntitlementStatus = 'ACTIVE' | 'REVOKED'
export type RefundStatus = 'PROCESSING' | 'SUCCESS' | 'CLOSED' | 'ABNORMAL'
export type FeishuEntityType =
  | 'family_profile'
  | 'student_profile'
  | 'assessment_session'
  | 'report_job'
  | 'order_payment'
  | 'feedback'
  | 'advisor_request'
export type IntegrationSyncStatus = 'PENDING' | 'PROCESSING' | 'SYNCED' | 'FAILED' | 'BLOCKED'
export type AgentConversationStatus = 'ACTIVE' | 'CLOSED' | 'EXPIRED'
export type AgentConversationPurpose = 'REPORT_FOLLOWUP' | 'ASSESSMENT_ANALYSIS' | 'REPORT_ANALYSIS'
export type AgentMessageRole = 'USER' | 'ASSISTANT'
export type AgentMessageSafetyState = 'ALLOWED' | 'BLOCKED' | 'ESCALATE'
export type AgentRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CANCELLED'

export interface AgentEncryptedEnvelope {
  schemaVersion: 1
  algorithm: 'A256GCM'
  keyVersion: string
  iv: string
  ciphertext: string
  authenticationTag: string
  aadDigest: string
}

export interface User {
  id: string
  role: UserRole
  createdAt: string
}

export interface WechatIdentity {
  id: string
  userId: string
  openid: string
  unionid?: string | null
  createdAt: string
}

export interface Session {
  id: string
  userId: string
  tokenHash: string
  expiresAt: string
  revokedAt?: string | null
  createdAt: string
}

export interface Family {
  id: string
  userId: string
  familyName: string | null
  parentName: string | null
  phone: string | null
  location: string | null
  goal: string | null
  profileStatus?: 'PROVISIONAL' | 'COMPLETE' | 'LEGACY_COMPLETE'
  profileSchemaVersion?: string
  createdAt: string
  updatedAt: string
}

export interface Student {
  id: string
  familyId: string
  name: string | null
  age?: number | null
  gender?: string | null
  school?: string | null
  educationSystem?: string | null
  grade?: string | null
  interest?: string | null
  goal?: string | null
  studentVersion: string
  profileStatus?: 'PROVISIONAL' | 'COMPLETE_FOR_LEVEL_2' | 'COMPLETE' | 'LEGACY_COMPLETE'
  profileSchemaVersion?: string
  gradeStage?: string | null
  createdAt: string
  updatedAt: string
}

export interface GuardianConsent {
  id: string
  userId: string
  familyId: string
  studentId: string
  consentVersion: string
  scope: 'education_compass_report'
  guardianConfirmed: boolean
  agreedAt: string
  revokedAt?: string | null
}

export interface Assessment {
  id: string
  userId: string
  familyId: string
  studentId: string
  consentId: string
  questionnaireVersion: string
  studentVersion: string
  answers: Record<string, unknown>
  status: AssessmentStatus
  completenessScore: number
  missingFields: string[]
  reportId?: string | null
  createdAt: string
  updatedAt: string
  submittedAt?: string | null
  assessmentKind?: EducationAssessmentKind
  respondentRole?: EducationRespondentRole
  sourceAssessmentId?: string | null
  educationSystem?: EducationSystem | null
  sourceEntry?: EducationSourceEntry | 'LEGACY_V0_4_1'
  bankVersions?: Record<string, string>
  schemaDigest?: string | null
  assessmentLevel?: 'LEGACY' | 'LEVEL_1' | 'LEVEL_2'
  gradeStage?: string | null
  commonBankVersion?: string | null
  systemBankVersion?: string | null
  respondentConfirmation?: 'LEGACY_UNSPECIFIED' | 'PARENT_GUARDIAN_CONFIRMED' | 'CONFIRM_STUDENT_SELF' | 'EXIT_NOT_STUDENT'
  coreConsentGrantId?: string | null
  studentAssentGrantId?: string | null
  resultKind?: EducationResultKind | null
  draftRevision?: number
  submittedInputDigest?: string | null
}

export interface ReportPreview {
  reportId: string
  assessmentId: string
  completenessScore: number
  confidence: Confidence
  profileSummary: string
  oneStrength: string
  oneRisk: string
  routeOverview: string
  tableOfContents: string[]
  dataAsOf: string
  disclaimer: string
  canPurchase: boolean
}

export type ReportModuleKey =
  | 'student_profile'
  | 'strengths'
  | 'major_directions'
  | 'university_match'
  | 'routes'
  | 'action_plan'
  | 'student_snapshot'
  | 'strength_signals'
  | 'learning_bottlenecks'
  | 'subject_focus'
  | 'growth_direction'
  | 'action_plan_30d'

export interface ReportModule {
  key: ReportModuleKey
  title: string
  summary: string
  items?: string[]
}

export interface SourceReference {
  sourceId: string
  applicableYear: string
  verifiedAt: string
  dataVersion: string
}

export interface ReportVersions {
  studentVersion: string
  ruleVersion: string
  dataVersion: string
  promptVersion: string
  templateVersion: string
}

export interface Report {
  id: string
  userId: string
  familyId: string
  studentId: string
  assessmentId: string
  status: ReportStatus
  deliveryStatus: 'LOCKED' | 'DELIVERED'
  preview: ReportPreview
  modules?: ReportModule[] | null
  sources: SourceReference[]
  dataAsOf: string
  disclaimer: string
  confidence: Confidence
  versions: ReportVersions
  qaPassed: boolean
  sourceCatalogVerified: boolean
  sourceCatalogVersion: string
  createdAt: string
  updatedAt: string
  reportKind?: EducationReportKind
  resultVersion?: string | null
  resultPayload?: Record<string, unknown> | null
  ruleVersion?: string | null
  disclaimerVersion?: string | null
  disclaimerTextHash?: string | null
}

export interface Product {
  id: string
  code: 'COMPASS_REPORT_SINGLE_39_9' | 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1' | 'PHOENIX_MEMBER_199'
  name: string
  amountFen: number
  currency: 'CNY'
  scope: 'SINGLE_REPORT' | 'MEMBERSHIP'
  active: boolean
  createdAt: string
}

export interface Order {
  id: string
  outTradeNo: string
  userId: string
  familyId: string
  studentId: string
  assessmentId: string
  reportId: string
  productCode: Product['code']
  amountFen: number
  currency: 'CNY'
  status: OrderStatus
  idempotencyKey: string
  provider: 'mock' | 'wechat'
  providerPrepayId?: string | null
  paymentParams?: {
    timeStamp: string
    nonceStr: string
    package: string
    signType: 'RSA'
    paySign: string
  } | null
  providerTransactionId?: string | null
  lastProviderQueryAt?: string | null
  createdAt: string
  updatedAt: string
  expiresAt: string
  paidAt?: string | null
  refundedAt?: string | null
}

export interface Entitlement {
  id: string
  userId: string
  orderId: string
  reportId: string
  productCode: Product['code']
  status: EntitlementStatus
  grantedAt: string
  revokedAt?: string | null
}

export interface PaymentEvent {
  id: string
  providerEventId: string
  eventKind: 'TRANSACTION' | 'REFUND' | 'QUERY_RECONCILIATION'
  outTradeNo: string
  bodyDigest: string
  verified: boolean
  processedAt: string
}

export interface Refund {
  id: string
  outRefundNo: string
  orderId: string
  requestedBy: string
  idempotencyKey: string
  reason: string
  amountFen: number
  currency: 'CNY'
  status: RefundStatus
  providerRefundId?: string | null
  createdAt: string
  updatedAt: string
  succeededAt?: string | null
}

export interface ReportJob {
  id: string
  orderId?: string | null
  reportId: string
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  attempts: number
  lastError?: string | null
  createdAt: string
  updatedAt: string
}

export interface Feedback {
  id: string
  userId: string
  reportId: string
  rating: 1 | 2 | 3 | 4 | 5
  tags: string[]
  comment: string
  advisorContactRequested: boolean
  createdAt: string
}

export interface AuditLog {
  id: string
  actorUserId?: string | null
  action: string
  entityType: string
  entityId: string
  metadata: Record<string, unknown>
  createdAt: string
}

export interface TimelineEvent {
  id: string
  userId: string
  familyId: string
  eventType: string
  description: string
  reportId?: string | null
  orderId?: string | null
  occurredAt: string
}

export interface AdvisorRequest {
  id: string
  userId: string
  familyId: string
  preferredTime: string
  topic: string
  note?: string | null
  reportId?: string | null
  studentId?: string | null
  status: 'PENDING' | 'CONTACTED' | 'CLOSED' | 'CANCELLED_BY_CONSENT_WITHDRAWAL'
  createdAt: string
  updatedAt: string
  assessmentId?: string | null
  intent?: 'GENERAL_ADVISOR' | 'ASKWISE_LEARNING_SUPPORT' | 'DEEP_ASSESSMENT'
}

export type ConsentGrantScope =
  | 'CORE_ASSESSMENT'
  | 'STUDENT_ASSESSMENT_ASSENT'
  | 'AI_ANALYSIS'
  | 'FEISHU_PROFILE_MIRROR'
  | 'ADVISOR_CONTACT'
  | 'MARKETING_CONTACT'
  | 'ASKWISE_HANDOFF'

export interface ConsentGrant {
  id: string
  userId: string
  familyId: string
  studentId?: string | null
  subjectType: 'USER' | 'FAMILY' | 'STUDENT'
  subjectId: string
  scope: ConsentGrantScope
  subjectRole: 'PARENT_GUARDIAN' | 'STUDENT'
  copyVersion: string
  copyTextHash: string
  locale: string
  guardianAuthorityStatus: 'CONFIRMED' | 'NOT_APPLICABLE' | 'UNKNOWN'
  sourceEntry: EducationSourceEntry | 'LEGACY_V0_4_1'
  auditMetadata: Record<string, unknown>
  grantedAt: string
  withdrawnAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface IdempotencyRecord {
  id: string
  userId: string
  domain: 'ASSESSMENT_CREATE' | 'DRAFT_SAVE' | 'ASSESSMENT_SUBMIT' | 'ORDER_CREATE' | 'AGENT_CREATE'
  keyDigest: string
  inputDigest: string
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  resourceType?: string | null
  resourceId?: string | null
  responseStatus?: number | null
  responseDigest?: string | null
  createdAt: string
  updatedAt: string
  completedAt?: string | null
}

export interface ProductDeliverable {
  id: string
  productCode: Product['code']
  assessmentKind: Extract<EducationAssessmentKind, 'LEGACY_EDUCATION_COMPASS' | 'STUDENT_GROWTH_DISCOVERY'>
  reportKind: EducationReportKind
  deliverableKind: 'LEGACY_COMPASS_REPORT_V1' | 'STUDENT_GROWTH_DISCOVERY_REPORT_V1'
  active: boolean
  createdAt: string
  updatedAt: string
}

/** Application Compass / Hong Kong masters intake entities. */
export type MastersConsultationEntity = MastersConsultation
export type MastersDocumentEntity = MastersDocument
export type MastersConsentEntity = MastersConsent
export type MastersSnapshotEntity = MastersSnapshot
export type MastersStaffEntity = MastersStaff
export type MastersAssignmentEntity = MastersAssignment
export type MastersReportEntity = MastersReport
export type MastersReportJobEntity = MastersReportJob
export type MastersAuditLogEntity = MastersAuditLog
export type MastersIdempotencyEntity = MastersIdempotencyRecord

export interface IntegrationLink {
  id: string
  provider: 'feishu_bitable'
  tableId: string
  entityType: FeishuEntityType
  entityId: string
  externalRecordId?: string | null
  payloadDigest?: string | null
  status: IntegrationSyncStatus
  attempts: number
  leaseToken?: string | null
  operationToken?: string | null
  operationDigest?: string | null
  operationBody?: string | null
  lastErrorCode?: string | null
  nextAttemptAt?: string | null
  lastSyncedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface AgentConsent {
  id: string
  userId: string
  familyId: string
  studentId: string
  reportId: string
  scope: 'ai_education_agent'
  consentVersion: 'ai_agent_guardian_v1'
  guardianConfirmed: true
  actorUserId: string
  actorRole: 'family_user'
  termsVersion: string
  termsSummary: string
  termsDigest: string
  agreedAt: string
  revokedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AgentConversation {
  id: string
  userId: string
  familyId: string
  studentId: string
  reportId: string
  consentId: string
  purpose: AgentConversationPurpose
  status: AgentConversationStatus
  promptVersion: string
  creationKeyDigest: string
  creationInputDigest: string
  createdAt: string
  updatedAt: string
  expiresAt: string
  closedAt: string | null
}

export interface AgentMessage {
  id: string
  conversationId: string
  role: AgentMessageRole
  contentEnvelope: AgentEncryptedEnvelope | null
  safetyState: AgentMessageSafetyState
  createdAt: string
  purgedAt: string | null
}

export interface AgentRun {
  id: string
  conversationId: string
  userId: string
  reportId: string
  userMessageId: string | null
  assistantMessageId: string | null
  status: AgentRunStatus
  idempotencyKeyDigest: string
  inputDigest: string
  requestEnvelope: AgentEncryptedEnvelope | null
  reportVersion: string
  contextDigest: string
  provider: 'openai' | 'mock'
  model: string
  promptVersion: string
  attempts: number
  leaseToken: string | null
  leaseOwner: string | null
  leaseExpiresAt: string | null
  fenceVersion: number
  nextAttemptAt: string
  errorCode: string | null
  inputTokens: number | null
  outputTokens: number | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  purgedAt: string | null
}

export interface AgentWorkerHeartbeat {
  id: string
  buildVersion: string
  status: 'STARTING' | 'HEALTHY' | 'STOPPING' | 'STOPPED' | 'ERROR'
  activeRuns: number
  lastErrorCode: string | null
  startedAt: string
  lastSeenAt: string
  expiresAt: string
}

export interface EntityMap {
  users: User
  wechatIdentities: WechatIdentity
  sessions: Session
  families: Family
  students: Student
  consents: GuardianConsent
  assessments: Assessment
  reports: Report
  products: Product
  orders: Order
  entitlements: Entitlement
  paymentEvents: PaymentEvent
  refunds: Refund
  reportJobs: ReportJob
  feedback: Feedback
  auditLogs: AuditLog
  timelineEvents: TimelineEvent
  advisorRequests: AdvisorRequest
  integrationLinks: IntegrationLink
  agentConsents: AgentConsent
  agentConversations: AgentConversation
  agentMessages: AgentMessage
  agentRuns: AgentRun
  agentWorkerHeartbeats: AgentWorkerHeartbeat
  consentGrants: ConsentGrant
  idempotencyRecords: IdempotencyRecord
  productDeliverables: ProductDeliverable
  mastersConsultations: MastersConsultationEntity
  mastersDocuments: MastersDocumentEntity
  mastersConsents: MastersConsentEntity
  mastersSnapshots: MastersSnapshotEntity
  mastersStaff: MastersStaffEntity
  mastersAssignments: MastersAssignmentEntity
  mastersReports: MastersReportEntity
  mastersReportJobs: MastersReportJobEntity
  mastersAuditLogs: MastersAuditLogEntity
  mastersIdempotencyRecords: MastersIdempotencyEntity
}

export type TableName = keyof EntityMap

export function emptyState(): { [K in TableName]: EntityMap[K][] } {
  return {
    users: [],
    wechatIdentities: [],
    sessions: [],
    families: [],
    students: [],
    consents: [],
    assessments: [],
    reports: [],
    products: [],
    orders: [],
    entitlements: [],
    paymentEvents: [],
    refunds: [],
    reportJobs: [],
    feedback: [],
    auditLogs: [],
    timelineEvents: [],
    advisorRequests: [],
    integrationLinks: [],
    agentConsents: [],
    agentConversations: [],
    agentMessages: [],
    agentRuns: [],
    agentWorkerHeartbeats: [],
    consentGrants: [],
    idempotencyRecords: [],
    productDeliverables: [],
    mastersConsultations: [],
    mastersDocuments: [],
    mastersConsents: [],
    mastersSnapshots: [],
    mastersStaff: [],
    mastersAssignments: [],
    mastersReports: [],
    mastersReportJobs: [],
    mastersAuditLogs: [],
    mastersIdempotencyRecords: []
  }
}
