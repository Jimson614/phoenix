'use strict'

// Isolated reference model: no server, database, environment, network, or product imports.
const { createHash } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { FAMILIES, USERS, GUARDIAN, NOW, DOMAINS, fixture, coreFixture, consentRef } = require('./fixtures.cjs')

class ContractError extends Error {
  constructor(code) { super(code); this.name = 'ContractError'; this.code = code }
}
function requireCheck(condition, code) { if (!condition) throw new ContractError(code) }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}
function hash(value) { return createHash('sha256').update(canonical(value)).digest('hex') }
function resultHash(h) { return hash({ result_summary: h.result_summary, journey_seed: h.journey_seed, human_review: h.human_review }) }
function signedFixture(domain = 'EDUCATION', family = 'A') { const h = fixture(domain, family); h.result_payload_hash = resultHash(h); return h }
function exactKeys(value, expected, code = 'HANDOFF_PAYLOAD_TOO_BROAD') {
  requireCheck(value !== null && typeof value === 'object' && !Array.isArray(value), code)
  requireCheck(Object.getPrototypeOf(value) === Object.prototype, code)
  requireCheck(isDeepStrictEqual(Object.keys(value).sort(), Object.keys(expected).sort()), code)
}
function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
function validateEnvelope(h, now) {
  requireCheck(h && DOMAINS.includes(h.compass_type), 'UNSUPPORTED_COMPASS_TYPE')
  requireCheck(h.primary_family_id, 'FAMILY_CONTEXT_AMBIGUOUS')
  const family = Object.keys(FAMILIES).find(k => FAMILIES[k] === h.primary_family_id)
  requireCheck(family, 'FAMILY_NOT_RESOLVED')
  const sample = fixture(h.compass_type, family)
  exactKeys(h, sample)
  for (const key of ['contract_version', 'rehearsal_profile']) requireCheck(h[key] === sample[key], 'CONTRACT_VERSION_UNKNOWN')
  for (const key of ['source_service', 'source_version', 'question_bank_version', 'rule_version', 'result_schema_version', 'evidence_registry_version']) {
    requireCheck(h[key] === sample[key], 'SOURCE_VERSION_UNKNOWN')
  }
  requireCheck(h.assessment_status === 'COMPLETED', 'ASSESSMENT_NOT_COMPLETED')
  for (const key of ['assessment_created_at', 'completed_at']) requireCheck(timestamp(h[key]), 'INVALID_TIMESTAMP')
  requireCheck(h.assessment_created_at <= h.completed_at && h.completed_at <= now, 'INVALID_TIMESTAMP')
  // A finite fixture vocabulary rejects arbitrary identities and customer payloads.
  for (const key of ['handoff_id', 'idempotency_key', 'request_id', 'assessment_id']) {
    requireCheck(h[key] === sample[key], 'SYNTHETIC_FIXTURE_REQUIRED')
  }
  requireCheck(h.subject_type === sample.subject_type, 'SUBJECT_RELATIONSHIP_UNVERIFIED')
  if (h.subject_type !== 'STUDENT') requireCheck(h.guardian_id === null, 'HANDOFF_PAYLOAD_TOO_BROAD')
  for (const key of ['result_summary', 'journey_seed', 'timeline_candidates', 'human_review', 'audit_context']) {
    requireCheck(isDeepStrictEqual(h[key], sample[key]), 'HANDOFF_PAYLOAD_TOO_BROAD')
  }
  requireCheck(h.result_payload_hash === resultHash(h), 'RESULT_HASH_MISMATCH')
  exactKeys(h.consent_refs, sample.consent_refs, 'CONSENT_REQUIRED')
  requireCheck(h.consent_id === h.consent_refs.ASSESSMENT_SCORING, 'CONSENT_REQUIRED')
  return { family, sample }
}

function createRehearsal({ mode } = {}) {
  requireCheck(mode === 'SYNTHETIC_ONLY', 'SYNTHETIC_MODE_REQUIRED')
  const core = coreFixture()
  let now = NOW
  let state = { receipts: {}, payloads: {}, timeline: [], journeys: [], requests: [], cases: [], notes: [], audit: [] }
  let failurePoint = null
  const audit = (draft, action, code = null, context = {}) => draft.audit.push({
    audit_id: `audit_synthetic_${draft.audit.length + 1}`,
    action, reason_code: code, occurred_at: now, simulation: true, ...context
  })
  const active = record => record && record.active && timestamp(record.expires_at) && record.expires_at > now
  function actor(session) {
    requireCheck(Object.hasOwn(core.sessions, session), 'ACTOR_NOT_AUTHORISED')
    return core.sessions[session]
  }
  function checkConsent(id, purpose, h) {
    const c = core.consents[id]
    requireCheck(c, 'CONSENT_REQUIRED')
    requireCheck(c.status === 'GRANTED' && timestamp(c.effective_from) && timestamp(c.expires_at) &&
      c.effective_from <= now && c.expires_at > now, 'CONSENT_NOT_ACTIVE')
    requireCheck(c.purpose === purpose && c.policy_version === 'SYNTHETIC_POLICY_V1', 'CONSENT_REQUIRED')
    requireCheck(c.family_id === h.primary_family_id && c.subject_id === h.subject_id && c.subject_type === h.subject_type, 'FAMILY_CONTEXT_MISMATCH')
    requireCheck(c.actor_user_id === h.actor_user_id, 'ACTOR_NOT_AUTHORISED')
    if (h.subject_type === 'STUDENT') requireCheck(c.guardian_id === GUARDIAN && core.guardian.active &&
      core.guardian.actor === h.actor_user_id && core.guardian.students.includes(h.subject_id), 'GUARDIAN_AUTHORITY_REQUIRED')
  }
  function checkContext(h, session) {
    const principal = actor(session)
    requireCheck(principal === h.actor_user_id, 'ACTOR_NOT_AUTHORISED')
    requireCheck(core.memberships[principal]?.includes(h.primary_family_id), 'ACTOR_NOT_AUTHORISED')
    requireCheck(core.mapping_status === 'ACTIVE', 'SOURCE_MAPPING_CONFLICT')
    requireCheck(core.subjects[h.primary_family_id]?.includes(h.subject_id), 'SUBJECT_RELATIONSHIP_UNVERIFIED')
    if (h.subject_type === 'STUDENT') requireCheck(h.guardian_id === GUARDIAN && core.guardian.active &&
      core.guardian.actor === principal && core.guardian.students.includes(h.subject_id), 'GUARDIAN_AUTHORITY_REQUIRED')
    checkConsent(h.consent_id, 'ASSESSMENT_SCORING', h)
    checkConsent(h.consent_refs.LONGITUDINAL_GROWTH_RECORD, 'LONGITUDINAL_GROWTH_RECORD', h)
    const e = core.entitlements[h.entitlement_id]
    requireCheck(active(e) && e.family_id === h.primary_family_id && e.subject_id === h.subject_id && e.service === h.source_service, 'ENTITLEMENT_REQUIRED')
  }
  function transaction(operation, fn) {
    const draft = structuredClone(state)
    let context = {}
    const recordContext = h => { context = {
      request_id: h.request_id, primary_family_id: h.primary_family_id,
      actor_user_id: h.actor_user_id, resource_id: h.handoff_id
    } }
    try {
      const result = fn(draft, recordContext)
      requireCheck(failurePoint !== 'before_audit', 'SIMULATED_AUDIT_FAILURE')
      audit(draft, operation, null, context)
      requireCheck(failurePoint !== 'before_commit', 'SIMULATED_COMMIT_FAILURE')
      state = draft
      return structuredClone(result)
    } catch (error) {
      // Only controlled reason codes enter denial evidence. Never store input values.
      audit(state, `${operation}_DENIED`, error instanceof ContractError ? error.code : 'INTERNAL_ERROR', context)
      throw error
    }
  }
  function ingest(h, session = 'parent') {
    return transaction('HANDOFF', (draft, recordContext) => {
      validateEnvelope(h, now)
      checkContext(h, session) // Re-check BEFORE replay lookup, including withdrawal/expiry.
      recordContext(h)
      const fingerprint = hash(h)
      if (draft.receipts[h.handoff_id]) {
        requireCheck(draft.payloads[h.handoff_id].fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT')
        return { ...draft.receipts[h.handoff_id], status: 'DUPLICATE' }
      }
      const receiptId = `receipt_synthetic_${hash(h.handoff_id).slice(0, 16)}`
      const events = h.timeline_candidates.map(event_type => ({
        event_id: `event_synthetic_${hash([h.handoff_id, event_type]).slice(0, 16)}`,
        event_type, primary_family_id: h.primary_family_id, subject_id: h.subject_id,
        source_record_id: h.assessment_id, source_version: h.source_version,
        visibility: 'FAMILY', recorded_at: now, simulation: true
      }))
      draft.timeline.push(...events)
      const journey_id = h.journey_seed ? `journey_synthetic_${hash(h.handoff_id).slice(0, 16)}` : null
      if (journey_id) draft.journeys.push({ journey_id, primary_family_id: h.primary_family_id, seed: structuredClone(h.journey_seed), simulation: true })
      const receipt = { status: 'ACCEPTED', handoff_id: h.handoff_id, family_os_receipt_id: receiptId,
        accepted_at: now, timeline_event_ids: events.map(e => e.event_id), journey_id, reason_codes: [], simulation: true }
      draft.receipts[h.handoff_id] = receipt
      draft.payloads[h.handoff_id] = { fingerprint, envelope: structuredClone(h) }
      return receipt
    })
  }
  function findHandoff(draft, handoffId) {
    requireCheck(Object.hasOwn(draft.payloads, handoffId), 'HANDOFF_NOT_FOUND')
    return draft.payloads[handoffId].envelope
  }
  function requestFollowUp(input, session = 'parent') {
    return transaction('FOLLOW_UP', (draft, recordContext) => {
      exactKeys(input, { handoff_id: '', consent_id: '' })
      const h = findHandoff(draft, input.handoff_id)
      checkContext(h, session)
      checkConsent(input.consent_id, 'ADVISOR_FOLLOW_UP', h)
      recordContext(h)
      const existing = draft.requests.find(r => r.handoff_id === h.handoff_id)
      if (existing) return existing
      const r = { advisor_request_id: `request_followup_${hash(h.handoff_id).slice(0, 16)}`, handoff_id: h.handoff_id,
        primary_family_id: h.primary_family_id, subject_id: h.subject_id,
        consent_id: input.consent_id, status: 'REQUESTED', simulation: true }
      draft.requests.push(r)
      draft.timeline.push({ event_id: `event_${r.advisor_request_id}`, event_type: 'ADVISOR_FOLLOW_UP_REQUESTED',
        primary_family_id: h.primary_family_id, subject_id: h.subject_id, recorded_at: now, visibility: 'FAMILY', simulation: true })
      return r
    })
  }
  function assignedRequest(draft, requestId, session) {
    const advisor = actor(session)
    const r = draft.requests.find(x => x.advisor_request_id === requestId)
    requireCheck(r, 'ADVISOR_REQUEST_NOT_FOUND')
    const a = core.assignments[advisor]
    requireCheck(active(a) && a.family_id === r.primary_family_id, 'PERMISSION_DENIED')
    const h = findHandoff(draft, r.handoff_id)
    checkContext(h, 'parent') // Fixed mock requesting principal, NOT production authentication.
    checkConsent(r.consent_id, 'ADVISOR_FOLLOW_UP', h)
    return { r, advisor }
  }
  function openCase(requestId, session = 'advisor') {
    return transaction('CASE_OPEN', (draft, recordContext) => {
      const { r, advisor } = assignedRequest(draft, requestId, session)
      recordContext({ ...findHandoff(draft, r.handoff_id), actor_user_id: advisor })
      const existing = draft.cases.find(c => c.advisor_request_id === requestId)
      if (existing) return existing
      const c = { advisor_case_id: `case_${requestId}`, advisor_request_id: requestId,
        primary_family_id: r.primary_family_id, assigned_advisor_user_id: advisor, case_status: 'ASSIGNED', simulation: true }
      draft.cases.push(c)
      return c
    })
  }
  function addNote(input, session = 'advisor') {
    return transaction('NOTE_ADD', (draft, recordContext) => {
      exactKeys(input, { advisor_case_id: '', content_ref: '' })
      requireCheck(input.content_ref === 'note_content_synthetic_001', 'SYNTHETIC_FIXTURE_REQUIRED')
      const c = draft.cases.find(x => x.advisor_case_id === input.advisor_case_id)
      requireCheck(c, 'ADVISOR_CASE_NOT_FOUND')
      const { r, advisor } = assignedRequest(draft, c.advisor_request_id, session)
      recordContext({ ...findHandoff(draft, r.handoff_id), actor_user_id: advisor })
      const existing = draft.notes.find(n => n.advisor_case_id === input.advisor_case_id)
      if (existing) return existing
      const note = { advisor_note_id: `note_${input.advisor_case_id}`, ...input, primary_family_id: c.primary_family_id, simulation: true }
      draft.notes.push(note)
      return note
    })
  }
  function readTimeline(familyId, session = 'parent') {
    const principal = actor(session)
    requireCheck(core.memberships[principal]?.includes(familyId), 'PERMISSION_DENIED')
    // Do not present old events after any required source-purpose check is withdrawn.
    for (const p of Object.values(state.payloads).filter(p => p.envelope.primary_family_id === familyId)) checkContext(p.envelope, session)
    for (const r of state.requests.filter(r => r.primary_family_id === familyId)) {
      checkConsent(r.consent_id, 'ADVISOR_FOLLOW_UP', findHandoff(state, r.handoff_id))
    }
    return structuredClone(state.timeline.filter(e => e.primary_family_id === familyId))
  }
  // Test controls only reduce authority; they cannot authorise arbitrary IDs or payloads.
  function revokeConsent(id) { requireCheck(Object.hasOwn(core.consents, id), 'CONSENT_REQUIRED'); core.consents[id].status = 'WITHDRAWN' }
  function revokeMembership(familyId) { core.memberships[USERS.parent] = core.memberships[USERS.parent].filter(f => f !== familyId) }
  function advanceClock(iso) { requireCheck(timestamp(iso) && iso >= now, 'INVALID_TIMESTAMP'); now = iso }
  function failNextAt(point) { requireCheck([null, 'before_audit', 'before_commit'].includes(point), 'INVALID_FAILURE_POINT'); failurePoint = point }
  return {
    ingest, requestFollowUp, openCase, addNote, readTimeline,
    revokeConsent, revokeMembership, advanceClock, failNextAt,
    revokeGuardian: () => { core.guardian.active = false },
    revokeAdvisor: () => { core.assignments[USERS.advisor].active = false },
    conflictMapping: () => { core.mapping_status = 'CONFLICT' },
    revokeEntitlement: id => { requireCheck(Object.hasOwn(core.entitlements, id), 'ENTITLEMENT_REQUIRED'); core.entitlements[id].active = false },
    inspectSyntheticState: () => structuredClone(state)
  }
}

module.exports = { createRehearsal, ContractError, canonical, hash, resultHash, signedFixture, validateEnvelope, consentRef }
