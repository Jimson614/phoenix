import { invariant } from '../../domain/errors'
import {
  EducationSystem,
  EvidenceSignal,
  GROWTH_DISCOVERY_REPORT_VERSION,
  ResultSignalStatus,
  StudentGrowthDiscoveryReportV1
} from '../../domain/education-compass/contracts'

export const ASKWISE_HANDOFF_RUNTIME_STATUS = 'RESERVED' as const
export const ASKWISE_HANDOFF_CONTRACT_VERSION = 'education_support_handoff_v1.0.0-rc1' as const

export type AskwiseSourceEntry =
  | 'MINIPROGRAM_HOME'
  | 'LEVEL_1_RESULT'
  | 'DIRECT_LEVEL_2'
  | 'XIAOHONGSHU_CONTENT'
  | 'ADVISOR_REFERRAL'
  | 'INTERNAL_UAT'

export interface AskwiseSubjectFocusV1 {
  subject_code: string
  status: Extract<ResultSignalStatus, 'SUPPORTED' | 'NEEDS_VALIDATION'>
  reason_codes: readonly string[]
  evidence_refs: readonly string[]
}

export interface AskwiseLearningBottleneckV1 {
  code: string
  status: 'SUPPORTED'
  evidence_refs: readonly string[]
}

export interface AskwiseLearningSignalV1 {
  code: string
  dimension: EvidenceSignal['dimension']
  status: ResultSignalStatus
  evidence_refs: readonly string[]
}

export interface AskwiseInterestSignalV1 {
  code: string
  status: Extract<ResultSignalStatus, 'SUPPORTED' | 'NEEDS_VALIDATION'>
  evidence_refs: readonly string[]
}

export interface AskwiseHandoffRequestV1 {
  contract_version: typeof ASKWISE_HANDOFF_CONTRACT_VERSION
  handoff_type: 'ASKWISE_LEARNING_SUPPORT'
  family_id: string
  student_id: string
  assessment_id: string
  report_id: string
  assessment_level: 'LEVEL_2'
  education_system: EducationSystem
  grade_stage: string
  system_result_marker: 'FULL_SYSTEM_BANK' | 'SYSTEM_BANK_PENDING'
  subject_focus: readonly AskwiseSubjectFocusV1[]
  learning_bottleneck: readonly AskwiseLearningBottleneckV1[]
  learning_signals: readonly AskwiseLearningSignalV1[]
  recommended_focus: readonly string[]
  interest_signals: readonly AskwiseInterestSignalV1[]
  report_version: typeof GROWTH_DISCOVERY_REPORT_VERSION
  consent_bundle_id: string
  source_entry: AskwiseSourceEntry
  idempotency_key: string
}

export interface ReservedAskwiseHandoffV1 {
  status: typeof ASKWISE_HANDOFF_RUNTIME_STATUS
  network_enabled: false
  contract_version: typeof ASKWISE_HANDOFF_CONTRACT_VERSION
  request: AskwiseHandoffRequestV1
}

export interface AskwiseHandoffIdentity {
  familyId: string
  studentId: string
  assessmentId: string
  reportId: string
  consentBundleId: string
  sourceEntry: AskwiseSourceEntry
  idempotencyKey: string
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,99}$/
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/
const EVIDENCE_PATTERN = /^(?:FP|EGD|GK|DSE|IG|AL|AP)\d{2}$/
const ALLOWED_SOURCE_ENTRIES: readonly AskwiseSourceEntry[] = Object.freeze([
  'MINIPROGRAM_HOME', 'LEVEL_1_RESULT', 'DIRECT_LEVEL_2', 'XIAOHONGSHU_CONTENT',
  'ADVISOR_REFERRAL', 'INTERNAL_UAT'
])
const ALLOWED_SYSTEMS: readonly EducationSystem[] = Object.freeze([
  'GAOKAO', 'DSE', 'IGCSE', 'A_LEVEL', 'AP_US', 'IB', 'OTHER'
])
const ALLOWED_DIMENSIONS: readonly AskwiseLearningSignalV1['dimension'][] = Object.freeze([
  'ACADEMIC_PERFORMANCE', 'LEARNING_PROCESS', 'THINKING_LEARNING_STYLE', 'INTEREST_DIRECTION'
])
const ALLOWED_STATUSES: readonly ResultSignalStatus[] = Object.freeze(['SUPPORTED', 'NEEDS_VALIDATION', 'UNKNOWN'])

function exactObject(value: unknown, allowedKeys: readonly string[], code = 'ASKWISE_HANDOFF_FORMAT_INVALID'): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 422, code, 'ASKWISE handoff 对象格式无效')
  const result = value as Record<string, unknown>
  const unknown = Object.keys(result).filter((key) => !allowedKeys.includes(key))
  invariant(unknown.length === 0, 422, code, 'ASKWISE handoff 包含未冻结字段', { fields: unknown })
  return result
}

function stringField(value: unknown, field: string, pattern: RegExp, maxLength = 128): string {
  invariant(typeof value === 'string' && value.length > 0 && value.length <= maxLength && pattern.test(value), 422,
    'ASKWISE_HANDOFF_FORMAT_INVALID', `ASKWISE handoff ${field} 无效`)
  return value
}

function evidenceRefs(value: unknown, field: string): readonly string[] {
  invariant(Array.isArray(value) && value.length > 0 && value.length <= 16 &&
    value.every((item) => typeof item === 'string' && EVIDENCE_PATTERN.test(item)) &&
    new Set(value).size === value.length, 422, 'ASKWISE_HANDOFF_FORMAT_INVALID', `ASKWISE handoff ${field} 证据题号无效`)
  return Object.freeze([...(value as string[])])
}

function codeArray(value: unknown, field: string, max: number, allowEmpty = true): readonly string[] {
  invariant(Array.isArray(value) && (allowEmpty || value.length > 0) && value.length <= max &&
    value.every((item) => typeof item === 'string' && CODE_PATTERN.test(item)) &&
    new Set(value).size === value.length, 422, 'ASKWISE_HANDOFF_FORMAT_INVALID', `ASKWISE handoff ${field} 无效`)
  return Object.freeze([...(value as string[])])
}

function validateSubjectFocus(value: unknown): readonly AskwiseSubjectFocusV1[] {
  invariant(Array.isArray(value) && value.length <= 3, 422, 'ASKWISE_HANDOFF_FORMAT_INVALID', 'ASKWISE subject_focus 最多 3 项')
  return Object.freeze(value.map((entry) => {
    const raw = exactObject(entry, ['subject_code', 'status', 'reason_codes', 'evidence_refs'])
    invariant(raw.status === 'SUPPORTED' || raw.status === 'NEEDS_VALIDATION', 422,
      'ASKWISE_HANDOFF_FORMAT_INVALID', 'ASKWISE subject_focus status 无效')
    return Object.freeze({
      subject_code: stringField(raw.subject_code, 'subject_code', CODE_PATTERN, 100),
      status: raw.status,
      reason_codes: codeArray(raw.reason_codes, 'reason_codes', 10, false),
      evidence_refs: evidenceRefs(raw.evidence_refs, 'subject_focus.evidence_refs')
    })
  }))
}

function validateBottlenecks(value: unknown): readonly AskwiseLearningBottleneckV1[] {
  invariant(Array.isArray(value) && value.length <= 3, 422, 'ASKWISE_HANDOFF_FORMAT_INVALID', 'ASKWISE learning_bottleneck 最多 3 项')
  return Object.freeze(value.map((entry) => {
    const raw = exactObject(entry, ['code', 'status', 'evidence_refs'])
    invariant(raw.status === 'SUPPORTED', 422, 'ASKWISE_HANDOFF_FORMAT_INVALID', 'ASKWISE 只允许发送 SUPPORTED bottleneck')
    return Object.freeze({
      code: stringField(raw.code, 'learning_bottleneck.code', CODE_PATTERN, 100),
      status: 'SUPPORTED' as const,
      evidence_refs: evidenceRefs(raw.evidence_refs, 'learning_bottleneck.evidence_refs')
    })
  }))
}

function validateLearningSignals(value: unknown): readonly AskwiseLearningSignalV1[] {
  invariant(Array.isArray(value) && value.length <= 12, 422, 'ASKWISE_HANDOFF_FORMAT_INVALID', 'ASKWISE learning_signals 最多 12 项')
  return Object.freeze(value.map((entry) => {
    const raw = exactObject(entry, ['code', 'dimension', 'status', 'evidence_refs'])
    invariant((ALLOWED_DIMENSIONS as readonly unknown[]).includes(raw.dimension), 422,
      'ASKWISE_HANDOFF_FORMAT_INVALID', 'ASKWISE learning signal dimension 无效')
    invariant((ALLOWED_STATUSES as readonly unknown[]).includes(raw.status), 422,
      'ASKWISE_HANDOFF_FORMAT_INVALID', 'ASKWISE learning signal status 无效')
    return Object.freeze({
      code: stringField(raw.code, 'learning_signals.code', CODE_PATTERN, 100),
      dimension: raw.dimension as AskwiseLearningSignalV1['dimension'],
      status: raw.status as ResultSignalStatus,
      evidence_refs: evidenceRefs(raw.evidence_refs, 'learning_signals.evidence_refs')
    })
  }))
}

function validateInterestSignals(value: unknown): readonly AskwiseInterestSignalV1[] {
  invariant(Array.isArray(value) && value.length <= 2, 422, 'ASKWISE_HANDOFF_FORMAT_INVALID', 'ASKWISE interest_signals 最多 2 项')
  return Object.freeze(value.map((entry) => {
    const raw = exactObject(entry, ['code', 'status', 'evidence_refs'])
    invariant(raw.status === 'SUPPORTED' || raw.status === 'NEEDS_VALIDATION', 422,
      'ASKWISE_HANDOFF_FORMAT_INVALID', 'ASKWISE interest signal status 无效')
    return Object.freeze({
      code: stringField(raw.code, 'interest_signals.code', CODE_PATTERN, 100),
      status: raw.status,
      evidence_refs: evidenceRefs(raw.evidence_refs, 'interest_signals.evidence_refs')
    })
  }))
}

export function validateAskwiseHandoffRequestV1(value: unknown): AskwiseHandoffRequestV1 {
  const raw = exactObject(value, [
    'contract_version', 'handoff_type', 'family_id', 'student_id', 'assessment_id', 'report_id',
    'assessment_level', 'education_system', 'grade_stage', 'system_result_marker', 'subject_focus',
    'learning_bottleneck', 'learning_signals', 'recommended_focus', 'interest_signals', 'report_version',
    'consent_bundle_id', 'source_entry', 'idempotency_key'
  ])
  invariant(raw.contract_version === ASKWISE_HANDOFF_CONTRACT_VERSION && raw.handoff_type === 'ASKWISE_LEARNING_SUPPORT' &&
    raw.assessment_level === 'LEVEL_2' && raw.report_version === GROWTH_DISCOVERY_REPORT_VERSION, 422,
  'ASKWISE_HANDOFF_FORMAT_INVALID', 'ASKWISE handoff 版本或用途无效')
  invariant((ALLOWED_SYSTEMS as readonly unknown[]).includes(raw.education_system), 422,
    'ASKWISE_HANDOFF_FORMAT_INVALID', 'ASKWISE education_system 无效')
  invariant(raw.system_result_marker === 'FULL_SYSTEM_BANK' || raw.system_result_marker === 'SYSTEM_BANK_PENDING', 422,
    'ASKWISE_HANDOFF_FORMAT_INVALID', 'ASKWISE system_result_marker 无效')
  invariant((raw.education_system === 'IB' || raw.education_system === 'OTHER')
    ? raw.system_result_marker === 'SYSTEM_BANK_PENDING'
    : raw.system_result_marker === 'FULL_SYSTEM_BANK', 422,
  'ASKWISE_HANDOFF_SYSTEM_MARKER_MISMATCH', 'ASKWISE 体系与题库覆盖标记不一致')
  invariant((ALLOWED_SOURCE_ENTRIES as readonly unknown[]).includes(raw.source_entry), 422,
    'ASKWISE_HANDOFF_FORMAT_INVALID', 'ASKWISE source_entry 无效')
  const request: AskwiseHandoffRequestV1 = {
    contract_version: ASKWISE_HANDOFF_CONTRACT_VERSION,
    handoff_type: 'ASKWISE_LEARNING_SUPPORT',
    family_id: stringField(raw.family_id, 'family_id', ID_PATTERN),
    student_id: stringField(raw.student_id, 'student_id', ID_PATTERN),
    assessment_id: stringField(raw.assessment_id, 'assessment_id', ID_PATTERN),
    report_id: stringField(raw.report_id, 'report_id', ID_PATTERN),
    assessment_level: 'LEVEL_2',
    education_system: raw.education_system as EducationSystem,
    grade_stage: stringField(raw.grade_stage, 'grade_stage', CODE_PATTERN, 100),
    system_result_marker: raw.system_result_marker,
    subject_focus: validateSubjectFocus(raw.subject_focus),
    learning_bottleneck: validateBottlenecks(raw.learning_bottleneck),
    learning_signals: validateLearningSignals(raw.learning_signals),
    recommended_focus: codeArray(raw.recommended_focus, 'recommended_focus', 5),
    interest_signals: validateInterestSignals(raw.interest_signals),
    report_version: GROWTH_DISCOVERY_REPORT_VERSION,
    consent_bundle_id: stringField(raw.consent_bundle_id, 'consent_bundle_id', ID_PATTERN),
    source_entry: raw.source_entry as AskwiseSourceEntry,
    idempotency_key: stringField(raw.idempotency_key, 'idempotency_key', /^[A-Za-z0-9._:-]{16,256}$/, 256)
  }
  invariant(request.subject_focus.some((item) => item.status === 'SUPPORTED') || request.learning_bottleneck.length > 0,
    422, 'ASKWISE_HANDOFF_INSUFFICIENT_EVIDENCE', 'ASKWISE handoff 需要至少一项 SUPPORTED 学科重点或学习瓶颈')
  invariant(request.recommended_focus.length > 0, 422, 'ASKWISE_HANDOFF_INSUFFICIENT_EVIDENCE',
    'ASKWISE handoff 缺少可执行 recommended_focus')
  return Object.freeze(request)
}

export function askwiseHandoffNaturalKey(identity: Pick<AskwiseHandoffIdentity,
  'studentId' | 'assessmentId'>): string {
  return [
    identity.studentId,
    identity.assessmentId,
    GROWTH_DISCOVERY_REPORT_VERSION,
    ASKWISE_HANDOFF_CONTRACT_VERSION,
    'ASKWISE_LEARNING_SUPPORT'
  ].join('|')
}

export function buildReservedAskwiseHandoffV1(
  report: StudentGrowthDiscoveryReportV1,
  identity: AskwiseHandoffIdentity
): ReservedAskwiseHandoffV1 {
  invariant(report.result_kind === 'STUDENT_GROWTH_DISCOVERY' && report.result_version === GROWTH_DISCOVERY_REPORT_VERSION,
    422, 'ASKWISE_HANDOFF_REPORT_INVALID', 'ASKWISE handoff 只接受冻结的 Level 2 结果')
  const request = validateAskwiseHandoffRequestV1({
    contract_version: ASKWISE_HANDOFF_CONTRACT_VERSION,
    handoff_type: 'ASKWISE_LEARNING_SUPPORT',
    family_id: identity.familyId,
    student_id: identity.studentId,
    assessment_id: identity.assessmentId,
    report_id: identity.reportId,
    assessment_level: 'LEVEL_2',
    education_system: report.student_snapshot.education_system,
    grade_stage: report.student_snapshot.grade_stage,
    system_result_marker: report.system_result_marker,
    subject_focus: report.subject_focus.map((signal) => ({
      subject_code: signal.code,
      status: signal.status,
      reason_codes: [`${signal.status}_SUBJECT_FOCUS`],
      evidence_refs: signal.evidence_refs
    })),
    learning_bottleneck: report.learning_bottlenecks
      .filter((signal) => signal.status === 'SUPPORTED')
      .slice(0, 3)
      .map((signal) => ({ code: signal.code, status: 'SUPPORTED', evidence_refs: signal.evidence_refs })),
    learning_signals: report.learning_signals.slice(0, 12).map((signal) => ({
      code: signal.code,
      dimension: signal.dimension,
      status: signal.status,
      evidence_refs: signal.evidence_refs
    })),
    recommended_focus: report.recommended_focus.slice(0, 5),
    interest_signals: report.interest_signals.slice(0, 2).map((signal) => ({
      code: signal.code,
      status: signal.status,
      evidence_refs: signal.evidence_refs
    })),
    report_version: report.result_version,
    consent_bundle_id: identity.consentBundleId,
    source_entry: identity.sourceEntry,
    idempotency_key: identity.idempotencyKey
  })
  return Object.freeze({
    status: ASKWISE_HANDOFF_RUNTIME_STATUS,
    network_enabled: false,
    contract_version: ASKWISE_HANDOFF_CONTRACT_VERSION,
    request
  })
}
