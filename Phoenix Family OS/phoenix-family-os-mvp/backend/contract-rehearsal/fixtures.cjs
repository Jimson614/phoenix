'use strict'

// Test-only constants, not Core-issued identities or approved business rules.
const FAMILIES = Object.freeze({ A: 'fam_00000000000040008000000000000001', B: 'fam_00000000000040008000000000000002' })
const USERS = Object.freeze({ parent: 'usr_00000000000040008000000000000001', advisor: 'usr_00000000000040008000000000000002' })
const STUDENTS = Object.freeze({ A: 'stu_00000000000040008000000000000001', B: 'stu_00000000000040008000000000000002' })
const GUARDIAN = 'gdn_00000000000040008000000000000001'
const NOW = '2026-09-06T12:00:00.000Z'
const EXPIRES = '2026-09-07T12:00:00.000Z'
const DOMAINS = Object.freeze(['EDUCATION', 'IDENTITY', 'WEALTH'])
const PURPOSES = Object.freeze(['ASSESSMENT_SCORING', 'LONGITUDINAL_GROWTH_RECORD', 'ADVISOR_FOLLOW_UP'])
const SUBJECTS = Object.freeze({
  EDUCATION: 'STUDENT', IDENTITY: 'USER', WEALTH: 'GUARDIAN'
})

function subjectId(domain, family = 'A') {
  return domain === 'EDUCATION' ? STUDENTS[family] : domain === 'IDENTITY' ? USERS.parent : GUARDIAN
}

function consentRef(domain, purpose, family = 'A') {
  return `consent_synthetic_${family}_${domain}_${purpose}`
}

function fixture(domain = 'EDUCATION', family = 'A') {
  if (!DOMAINS.includes(domain) || !Object.hasOwn(FAMILIES, family)) throw new Error('Unknown synthetic fixture')
  const suffix = `${family}_${domain}`
  return {
    contract_version: 'COMPASS_FAMILY_OS_HANDOFF_V1',
    rehearsal_profile: 'SYNTHETIC_ONLY_V1',
    handoff_id: `handoff_synthetic_${suffix}`,
    idempotency_key: `key_synthetic_${suffix}`,
    request_id: `request_synthetic_${suffix}`,
    source_service: `${domain}_COMPASS`, source_version: 'SYNTHETIC_SOURCE_V1',
    compass_type: domain, assessment_id: `assessment_synthetic_${suffix}`,
    assessment_status: 'COMPLETED', assessment_created_at: NOW, completed_at: NOW,
    question_bank_version: 'SYNTHETIC_QUESTIONS_V1', rule_version: 'SYNTHETIC_RULES_V1',
    result_schema_version: 'SYNTHETIC_RESULT_V1',
    evidence_registry_version: domain === 'IDENTITY' ? 'SYNTHETIC_EVIDENCE_V1' : null,
    primary_family_id: FAMILIES[family], actor_user_id: USERS.parent,
    subject_type: SUBJECTS[domain], subject_id: subjectId(domain, family),
    guardian_id: domain === 'EDUCATION' ? GUARDIAN : null,
    consent_id: consentRef(domain, 'ASSESSMENT_SCORING', family),
    consent_refs: {
      ASSESSMENT_SCORING: consentRef(domain, 'ASSESSMENT_SCORING', family),
      LONGITUDINAL_GROWTH_RECORD: consentRef(domain, 'LONGITUDINAL_GROWTH_RECORD', family)
    },
    entitlement_id: `entitlement_synthetic_${suffix}`,
    result_payload_hash: '',
    result_summary: {
      headline: 'SYNTHETIC_SUMMARY', readiness: 'SYNTHETIC_REVIEW', themes: [], gaps: [], risk_flags: [],
      next_actions: ['SYNTHETIC_DOCUMENT_REVIEW'], report_locator: `report_synthetic_${suffix}`,
      explanation_disclaimer: 'SYNTHETIC_ONLY_NOT_ADVICE'
    },
    journey_seed: domain === 'IDENTITY' ? {
      journey_type: 'IDENTITY', current_scheme: null, current_status: 'SYNTHETIC_REVIEW',
      recommended_path: null, alternative_paths: [], limit_of_stay_expiry: null, important_dates: [],
      required_evidence: [], risk_flags: [], next_actions: ['SYNTHETIC_DOCUMENT_REVIEW'],
      source_assessment_id: `assessment_synthetic_${suffix}`
    } : null,
    timeline_candidates: ['COMPASS_ASSESSMENT_COMPLETED', 'COMPASS_REPORT_AVAILABLE'],
    human_review: { required: true, reason_codes: ['SYNTHETIC_REVIEW'], review_scope: [], blocking_unknowns: [] },
    audit_context: { request_id: `request_synthetic_${suffix}` }
  }
}

function coreFixture() {
  const consents = {}
  const entitlements = {}
  for (const family of ['A', 'B']) {
    for (const domain of DOMAINS) {
      const h = fixture(domain, family)
      for (const purpose of PURPOSES) {
        const id = consentRef(domain, purpose, family)
        consents[id] = {
          family_id: h.primary_family_id, subject_id: h.subject_id, subject_type: h.subject_type,
          purpose, policy_version: 'SYNTHETIC_POLICY_V1', status: 'GRANTED',
          effective_from: NOW, expires_at: EXPIRES, actor_user_id: USERS.parent,
          guardian_id: h.guardian_id
        }
      }
      entitlements[h.entitlement_id] = {
        family_id: h.primary_family_id, subject_id: h.subject_id,
        service: h.source_service, active: true, expires_at: EXPIRES
      }
    }
  }
  return {
    // Session names are fixed test labels, never production credentials.
    sessions: { parent: USERS.parent, advisor: USERS.advisor },
    memberships: { [USERS.parent]: [FAMILIES.A, FAMILIES.B] },
    subjects: { [FAMILIES.A]: [USERS.parent, GUARDIAN, STUDENTS.A], [FAMILIES.B]: [USERS.parent, GUARDIAN, STUDENTS.B] },
    guardian: { id: GUARDIAN, actor: USERS.parent, active: true, students: [STUDENTS.A, STUDENTS.B] },
    assignments: { [USERS.advisor]: { family_id: FAMILIES.A, active: true, expires_at: EXPIRES } },
    mapping_status: 'ACTIVE', consents, entitlements
  }
}

module.exports = { FAMILIES, USERS, STUDENTS, GUARDIAN, NOW, EXPIRES, DOMAINS, PURPOSES, SUBJECTS, consentRef, fixture, coreFixture }
