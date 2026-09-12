import {
  buildLevel3ReservationV1,
  Level3ReservationV1,
  Level3TriggerCode
} from './level3-reservation'
import { ASKWISE_HANDOFF_RUNTIME_STATUS } from '../../integrations/askwise/handoff-contract'

export interface NextSupportCapabilityV1 {
  askwise: {
    status: typeof ASKWISE_HANDOFF_RUNTIME_STATUS
    enabled: false
    reasonCode: 'ASKWISE_CAPABILITY_UNAVAILABLE'
    requiresExplicitConsent: true
  }
  deepAssessment: {
    state: Level3ReservationV1['state']
    reasonCodes: Level3ReservationV1['reason_codes']
    ctaMode: Level3ReservationV1['cta_mode']
    advisorIntent: Level3ReservationV1['advisor_intent']
    displayPrice: null
  }
  advisor: {
    available: boolean
    requiresExplicitConsent: true
  }
}

export interface FrozenLevel3EvidenceInput {
  sourceAssessmentId: string
  sourceReportId: string
  sourceLevel1Answers?: Readonly<Record<string, unknown>> | null
  growthAnswers?: Readonly<Record<string, unknown>> | null
  reportAccess: 'preview' | 'full'
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([])
  return Object.freeze([...new Set(value.filter((item): item is string => typeof item === 'string'))])
}

/**
 * Maps only the two trigger combinations approved by Product Freeze V1.
 * It intentionally makes no inference from scores, pressure, emotion, grades,
 * signal counts or other report content.
 */
export function buildLevel3ReservationFromFrozenEvidence(input: FrozenLevel3EvidenceInput): Level3ReservationV1 {
  const triggerCodes: Level3TriggerCode[] = []
  if (input.reportAccess === 'full') {
    if (input.sourceLevel1Answers?.FP08 === 'DEEP_ASSESSMENT_INFO') {
      triggerCodes.push('USER_REQUESTED_DEEP_ASSESSMENT')
    }
    const pathwayCodes = stringList(input.growthAnswers?.EGD19)
    if (input.growthAnswers?.EGD18 === 'PATH_CONSULTATION' &&
      !pathwayCodes.includes('UNSURE') && pathwayCodes.length >= 2) {
      triggerCodes.push('MULTI_PATHWAY_COMPARISON_REQUESTED')
    }
  }
  return buildLevel3ReservationV1({
    sourceAssessmentId: input.sourceAssessmentId,
    sourceReportId: input.sourceReportId,
    triggerCodes
  })
}

export function buildNextSupportCapabilityV1(input: FrozenLevel3EvidenceInput): Readonly<NextSupportCapabilityV1> {
  const level3 = buildLevel3ReservationFromFrozenEvidence(input)
  const advisorAvailable = input.reportAccess === 'full' &&
    (level3.state === 'AVAILABLE' || level3.state === 'CONSIDER')
  return Object.freeze({
    askwise: Object.freeze({
      status: ASKWISE_HANDOFF_RUNTIME_STATUS,
      enabled: false,
      reasonCode: 'ASKWISE_CAPABILITY_UNAVAILABLE',
      requiresExplicitConsent: true
    }),
    deepAssessment: Object.freeze({
      state: level3.state,
      reasonCodes: level3.reason_codes,
      ctaMode: level3.cta_mode,
      advisorIntent: level3.advisor_intent,
      displayPrice: null
    }),
    advisor: Object.freeze({
      available: advisorAvailable,
      requiresExplicitConsent: true
    })
  })
}
