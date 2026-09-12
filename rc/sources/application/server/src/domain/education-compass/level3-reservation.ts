import { invariant } from '../errors'

export const LEVEL_3_RESERVATION_VERSION = 'deep_assessment_entry_v1.0.0-rc1' as const

export type Level3ReservationState = 'AVAILABLE' | 'CONSIDER' | 'NOT_RECOMMENDED' | 'DEFERRED'

export type Level3TriggerCode =
  | 'USER_REQUESTED_DEEP_ASSESSMENT'
  | 'COMPLEX_MULTI_FACTOR_NEEDS_REVIEW'
  | 'FAMILY_STUDENT_GOAL_MISALIGNMENT'
  | 'MULTI_EDUCATION_SYSTEM_COMPARISON_REQUESTED'
  | 'MULTI_PATHWAY_COMPARISON_REQUESTED'

export type Level3ExclusionCode =
  | 'STUDENT_DECLINED'
  | 'ONLY_STRESS_OR_EMOTIONAL_SIGNAL'
  | 'INSUFFICIENT_EVIDENCE'
  | 'NO_LEVEL_3_TRIGGER'

export interface Level3ReservationInput {
  sourceAssessmentId: string
  sourceReportId: string
  triggerCodes?: readonly Level3TriggerCode[]
  studentDeclined?: boolean
  onlyStressOrEmotionalSignal?: boolean
  insufficientEvidence?: boolean
}

export interface Level3ReservationV1 {
  contract_version: typeof LEVEL_3_RESERVATION_VERSION
  entry_only: true
  state: Level3ReservationState
  reason_codes: readonly (Level3TriggerCode | Level3ExclusionCode)[]
  advisor_intent: 'DEEP_ASSESSMENT' | null
  cta_mode: 'ADVISOR_INFORMATION_OR_APPOINTMENT_ONLY' | 'NONE'
  source_assessment_id: string
  source_report_id: string
  question_ids: readonly []
  payment_enabled: false
}

const TRIGGER_CODES = new Set<Level3TriggerCode>([
  'USER_REQUESTED_DEEP_ASSESSMENT',
  'COMPLEX_MULTI_FACTOR_NEEDS_REVIEW',
  'FAMILY_STUDENT_GOAL_MISALIGNMENT',
  'MULTI_EDUCATION_SYSTEM_COMPARISON_REQUESTED',
  'MULTI_PATHWAY_COMPARISON_REQUESTED'
])

function sourceId(value: unknown, field: string): string {
  invariant(typeof value === 'string' && /^[A-Za-z0-9._:-]{3,128}$/.test(value), 400,
    'LEVEL_3_SOURCE_INVALID', `${field} 无效`)
  return value
}

/**
 * Pure entry reservation only. It creates no SKU, order, questionnaire,
 * report, route, network request or automatic advisor appointment.
 */
export function buildLevel3ReservationV1(input: Level3ReservationInput): Level3ReservationV1 {
  const sourceAssessmentId = sourceId(input.sourceAssessmentId, 'sourceAssessmentId')
  const sourceReportId = sourceId(input.sourceReportId, 'sourceReportId')
  const triggers = [...new Set(input.triggerCodes ?? [])]
  invariant(triggers.every((code) => TRIGGER_CODES.has(code)), 400,
    'LEVEL_3_TRIGGER_INVALID', 'Level 3 触发原因无效')

  let state: Level3ReservationState
  let reasons: Array<Level3TriggerCode | Level3ExclusionCode>
  if (input.studentDeclined) {
    state = 'NOT_RECOMMENDED'
    reasons = ['STUDENT_DECLINED']
  } else if (triggers.includes('USER_REQUESTED_DEEP_ASSESSMENT')) {
    state = 'AVAILABLE'
    reasons = triggers
  } else if (triggers.length > 0) {
    state = 'CONSIDER'
    reasons = triggers
  } else if (input.onlyStressOrEmotionalSignal) {
    state = 'DEFERRED'
    reasons = ['ONLY_STRESS_OR_EMOTIONAL_SIGNAL']
  } else if (input.insufficientEvidence) {
    state = 'DEFERRED'
    reasons = ['INSUFFICIENT_EVIDENCE']
  } else {
    state = 'DEFERRED'
    reasons = ['NO_LEVEL_3_TRIGGER']
  }

  const advisorAvailable = state === 'AVAILABLE' || state === 'CONSIDER'
  return Object.freeze({
    contract_version: LEVEL_3_RESERVATION_VERSION,
    entry_only: true,
    state,
    reason_codes: Object.freeze(reasons),
    advisor_intent: advisorAvailable ? 'DEEP_ASSESSMENT' : null,
    cta_mode: advisorAvailable ? 'ADVISOR_INFORMATION_OR_APPOINTMENT_ONLY' : 'NONE',
    source_assessment_id: sourceAssessmentId,
    source_report_id: sourceReportId,
    question_ids: Object.freeze([]) as readonly [],
    payment_enabled: false
  })
}
