'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createRehearsal, signedFixture, resultHash, consentRef, ContractError, canonical, hash } = require('./adapter.cjs')
const { DOMAINS, FAMILIES, USERS, STUDENTS, NOW, EXPIRES, fixture } = require('./fixtures.cjs')
const make = () => createRehearsal({ mode: 'SYNTHETIC_ONLY' })
const rejected = (fn, code) => assert.throws(fn, e => e instanceof ContractError && e.code === code)
const followup = h => ({ handoff_id: h.handoff_id, consent_id: consentRef(h.compass_type, 'ADVISOR_FOLLOW_UP', h.primary_family_id === FAMILIES.A ? 'A' : 'B') })
const count = r => {
  const s = r.inspectSyntheticState()
  return [Object.keys(s.receipts).length, s.timeline.length, s.journeys.length, s.requests.length, s.cases.length, s.notes.length]
}
const reverseKeys = value => {
  if (Array.isArray(value)) return value.map(reverseKeys)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).reverse().map(k => [k, reverseKeys(value[k])]))
  return value
}

test('requires explicit synthetic mode; production/default modes denied', () => {
  for (const mode of [undefined, null, 'production', 'PRODUCTION', 'demo']) rejected(() => createRehearsal({ mode }), 'SYNTHETIC_MODE_REQUIRED')
  rejected(() => createRehearsal(), 'SYNTHETIC_MODE_REQUIRED')
})
test('fixture constructors reject unknown domains and families', () => {
  assert.throws(() => fixture('HEALTH'))
  assert.throws(() => fixture('EDUCATION', 'C'))
})
for (const domain of DOMAINS) {
  test(`${domain}: accepted synthetic handoff, stable replay, scoped read`, () => {
    const r = make(), h = signedFixture(domain)
    const a = r.ingest(h), b = r.ingest(reverseKeys(h))
    assert.equal(a.status, 'ACCEPTED'); assert.equal(a.simulation, true)
    assert.deepEqual(b, { ...a, status: 'DUPLICATE' })
    assert.deepEqual(count(r), [1, 2, domain === 'IDENTITY' ? 1 : 0, 0, 0, 0])
    assert.equal(r.readTimeline(FAMILIES.A).length, 2)
    assert.equal(r.readTimeline(FAMILIES.B).length, 0)
    const audit = r.inspectSyntheticState().audit[0]
    assert.equal(audit.request_id, h.request_id); assert.equal(audit.primary_family_id, h.primary_family_id)
    assert.equal(audit.actor_user_id, USERS.parent)
    assert.equal(r.inspectSyntheticState().journeys[0]?.seed.recommended_path ?? null, null)
  })
  test(`${domain}: explicit follow-up → assigned advisor → protected note`, () => {
    const r = make(), h = signedFixture(domain)
    r.ingest(h)
    const req = r.requestFollowUp(followup(h))
    assert.deepEqual(r.requestFollowUp(followup(h)), req)
    assert.equal(r.inspectSyntheticState().cases.length, 0)
    const c = r.openCase(req.advisor_request_id)
    assert.deepEqual(r.openCase(req.advisor_request_id), c)
    const note = { advisor_case_id: c.advisor_case_id, content_ref: 'note_content_synthetic_001' }
    assert.deepEqual(r.addNote(note), r.addNote(note))
    assert.deepEqual(count(r), [1, 3, domain === 'IDENTITY' ? 1 : 0, 1, 1, 1])
    const state = r.inspectSyntheticState()
    assert.equal(state.audit.at(-1).actor_user_id, USERS.advisor)
    assert.ok(!JSON.stringify(state.timeline).includes('note_content'))
    assert.ok(!JSON.stringify(state.audit).includes('note_content'))
  })
}
const invalid = [
  ['FC-02 omitted family', h => { delete h.primary_family_id }, 'FAMILY_CONTEXT_AMBIGUOUS'],
  ['unknown family', h => { h.primary_family_id = 'fam_unknown' }, 'FAMILY_NOT_RESOLVED'],
  ['FC-03 wrong student family', h => { h.subject_id = STUDENTS.B }, 'SUBJECT_RELATIONSHIP_UNVERIFIED'],
  ['forged actor', h => { h.actor_user_id = USERS.advisor }, 'ACTOR_NOT_AUTHORISED'],
  ['unrecognised subject', h => { h.subject_id = 'stu_real_person' }, 'SUBJECT_RELATIONSHIP_UNVERIFIED'],
  ['FAMILY is not a Core consent subject', h => { h.subject_type = 'FAMILY' }, 'SUBJECT_RELATIONSHIP_UNVERIFIED'],
  ['FC-05 missing guardian', h => { h.guardian_id = null }, 'GUARDIAN_AUTHORITY_REQUIRED'],
  ['CH-03 rule not loaded', h => { h.rule_version = 'RULES_NOT_LOADED' }, 'SOURCE_VERSION_UNKNOWN'],
  ['CH-03 unknown question bank', h => { h.question_bank_version = '' }, 'SOURCE_VERSION_UNKNOWN'],
  ['CH-03 wrong result schema', h => { h.result_schema_version = 'REAL_RESULT' }, 'SOURCE_VERSION_UNKNOWN'],
  ['CH-03 wrong source version', h => { h.source_version = 'production' }, 'SOURCE_VERSION_UNKNOWN'],
  ['mismatched source service', h => { h.source_service = 'IDENTITY_COMPASS' }, 'SOURCE_VERSION_UNKNOWN'],
  ['unknown contract', h => { h.contract_version = 'v2' }, 'CONTRACT_VERSION_UNKNOWN'],
  ['missing synthetic marker', h => { h.rehearsal_profile = 'REAL' }, 'CONTRACT_VERSION_UNKNOWN'],
  ['CH-04 reserved Health', h => { h.compass_type = 'HEALTH' }, 'UNSUPPORTED_COMPASS_TYPE'],
  ['unreserved arbitrary domain', h => { h.compass_type = 'CULTURE' }, 'UNSUPPORTED_COMPASS_TYPE'],
  ['missing consent', h => { h.consent_refs = null }, 'CONSENT_REQUIRED'],
  ['mismatched primary consent', h => { h.consent_id = 'consent_unknown' }, 'CONSENT_REQUIRED'],
  ['assessment purpose substituted for longitudinal purpose', h => { h.consent_refs.LONGITUDINAL_GROWTH_RECORD = h.consent_id }, 'CONSENT_REQUIRED'],
  ['consent from other family', h => { h.consent_refs.LONGITUDINAL_GROWTH_RECORD = consentRef('EDUCATION', 'LONGITUDINAL_GROWTH_RECORD', 'B') }, 'FAMILY_CONTEXT_MISMATCH'],
  ['unknown entitlement', h => { h.entitlement_id = null }, 'ENTITLEMENT_REQUIRED'],
  ['entitlement from other family', h => { h.entitlement_id = 'entitlement_synthetic_B_EDUCATION' }, 'ENTITLEMENT_REQUIRED'],
  ['invalid hash', h => { h.result_payload_hash = '0'.repeat(64) }, 'RESULT_HASH_MISMATCH'],
  ['partial assessment', h => { h.assessment_status = 'PARTIAL' }, 'ASSESSMENT_NOT_COMPLETED'],
  ['calendar overflow', h => { h.completed_at = '2026-02-30T12:00:00.000Z' }, 'INVALID_TIMESTAMP'],
  ['client future time', h => { h.completed_at = EXPIRES }, 'INVALID_TIMESTAMP'],
  ['time reversed', h => { h.assessment_created_at = EXPIRES }, 'INVALID_TIMESTAMP'],
  ['unknown source assessment', h => { h.assessment_id = 'assessment_unknown' }, 'SYNTHETIC_FIXTURE_REQUIRED'],
  ['privilege claim smuggled in envelope', h => { h.role = 'SUPER_ADMIN' }, 'HANDOFF_PAYLOAD_TOO_BROAD'],
  ['CH-05 raw answers', h => { h.answers = { private: 'DO_NOT_LOG' } }, 'HANDOFF_PAYLOAD_TOO_BROAD'],
  ['CH-05 raw document nested', h => { h.result_summary.document = 'DO_NOT_LOG' }, 'HANDOFF_PAYLOAD_TOO_BROAD'],
  ['private content in allowed field', h => { h.result_summary.headline = 'DO_NOT_LOG' }, 'HANDOFF_PAYLOAD_TOO_BROAD'],
  ['public report URL', h => { h.result_summary.report_locator = 'https://example.invalid/private' }, 'HANDOFF_PAYLOAD_TOO_BROAD'],
  ['unknown timeline event', h => { h.timeline_candidates = ['HEALTH_REPORT'] }, 'HANDOFF_PAYLOAD_TOO_BROAD'],
  ['forged audit actor', h => { h.audit_context.actor_user_id = 'DO_NOT_LOG' }, 'HANDOFF_PAYLOAD_TOO_BROAD']
]
for (const [label, mutate, code] of invalid) test(label, () => {
  const r = make(), h = signedFixture(); mutate(h)
  rejected(() => r.ingest(h), code)
  assert.deepEqual(count(r), [0, 0, 0, 0, 0, 0])
  assert.equal(r.inspectSyntheticState().audit.at(-1).reason_code, code)
  assert.ok(!JSON.stringify(r.inspectSyntheticState()).includes('DO_NOT_LOG'))
})

test('non-student guardian free text is rejected', () => {
  const h = signedFixture('IDENTITY'); h.guardian_id = 'DO_NOT_LOG'
  rejected(() => make().ingest(h), 'HANDOFF_PAYLOAD_TOO_BROAD')
})
test('Identity seed preserves exact upstream field names; arbitrary route cannot be injected', () => {
  const h = signedFixture('IDENTITY')
  assert.ok(Object.hasOwn(h.journey_seed, 'limit_of_stay_expiry'))
  h.journey_seed.recommended_path = 'GUARANTEED_ROUTE'; h.result_payload_hash = resultHash(h)
  rejected(() => make().ingest(h), 'HANDOFF_PAYLOAD_TOO_BROAD')
})
test('unknown Identity evidence version rejected', () => {
  const h = signedFixture('IDENTITY'); h.evidence_registry_version = null
  rejected(() => make().ingest(h), 'SOURCE_VERSION_UNKNOWN')
})
test('withdrawn scoring consent blocks a previously accepted replay', () => {
  const r = make(), h = signedFixture(); r.ingest(h); r.revokeConsent(h.consent_id)
  rejected(() => r.ingest(h), 'CONSENT_NOT_ACTIVE')
  assert.deepEqual(count(r), [1, 2, 0, 0, 0, 0])
})
test('withdrawn longitudinal consent blocks ingestion, replay and timeline presentation', () => {
  const r = make(), h = signedFixture(); r.ingest(h); r.revokeConsent(h.consent_refs.LONGITUDINAL_GROWTH_RECORD)
  rejected(() => r.ingest(h), 'CONSENT_NOT_ACTIVE')
  rejected(() => r.readTimeline(FAMILIES.A), 'CONSENT_NOT_ACTIVE')
  assert.equal(r.inspectSyntheticState().timeline.length, 2) // retained test evidence, not authorised display
})
test('consent exact expiry boundary denied', () => {
  const r = make(); r.advanceClock(EXPIRES)
  rejected(() => r.ingest(signedFixture()), 'CONSENT_NOT_ACTIVE')
})
test('FC-04 mapping conflict denies ingestion', () => {
  const r = make(); r.conflictMapping(); rejected(() => r.ingest(signedFixture()), 'SOURCE_MAPPING_CONFLICT')
})
test('FC-05 revoked guardian denies an accepted replay', () => {
  const r = make(), h = signedFixture(); r.ingest(h); r.revokeGuardian()
  rejected(() => r.ingest(h), 'GUARDIAN_AUTHORITY_REQUIRED')
})
test('revoked family membership denies replay and read; other family remains scoped', () => {
  const r = make(), h = signedFixture(); r.ingest(h); r.revokeMembership(FAMILIES.A)
  rejected(() => r.ingest(h), 'ACTOR_NOT_AUTHORISED')
  rejected(() => r.readTimeline(FAMILIES.A), 'PERMISSION_DENIED')
  assert.equal(r.ingest(signedFixture('EDUCATION', 'B')).status, 'ACCEPTED')
})
test('entitlement revocation denies replay', () => {
  const r = make(), h = signedFixture(); r.ingest(h); r.revokeEntitlement(h.entitlement_id)
  rejected(() => r.ingest(h), 'ENTITLEMENT_REQUIRED')
})
test('unknown session and advisor-as-parent are denied', () => {
  rejected(() => make().ingest(signedFixture(), 'unknown'), 'ACTOR_NOT_AUTHORISED')
  rejected(() => make().ingest(signedFixture(), 'advisor'), 'ACTOR_NOT_AUTHORISED')
})
test('CH-02 altered envelope with same idempotency identity conflicts', () => {
  const r = make(), h = signedFixture(); r.ingest(h)
  h.assessment_created_at = '2026-09-06T11:00:00.000Z'
  rejected(() => r.ingest(h), 'IDEMPOTENCY_CONFLICT')
  assert.deepEqual(count(r), [1, 2, 0, 0, 0, 0])
})
for (const point of ['before_audit', 'before_commit']) {
  test(`${point}: handoff writes roll back atomically; retry commits once`, () => {
    const r = make(), h = signedFixture('IDENTITY'); r.failNextAt(point)
    rejected(() => r.ingest(h), point === 'before_audit' ? 'SIMULATED_AUDIT_FAILURE' : 'SIMULATED_COMMIT_FAILURE')
    assert.deepEqual(count(r), [0, 0, 0, 0, 0, 0])
    assert.equal(r.inspectSyntheticState().audit.length, 1)
    r.failNextAt(null); r.ingest(h); r.ingest(h)
    assert.deepEqual(count(r), [1, 2, 1, 0, 0, 0])
  })
}
test('100 scheduled same-process retries have one handoff and one event pair', async () => {
  const r = make(), h = signedFixture()
  const receipts = await Promise.all(Array.from({ length: 100 }, () => Promise.resolve().then(() => r.ingest(h))))
  assert.equal(receipts.filter(x => x.status === 'ACCEPTED').length, 1)
  assert.equal(receipts.filter(x => x.status === 'DUPLICATE').length, 99)
  assert.deepEqual(count(r), [1, 2, 0, 0, 0, 0])
})
test('AF-02 assessment consent cannot authorise advisor contact', () => {
  const r = make(), h = signedFixture(); r.ingest(h)
  rejected(() => r.requestFollowUp({ handoff_id: h.handoff_id, consent_id: h.consent_id }), 'CONSENT_REQUIRED')
  assert.deepEqual(count(r), [1, 2, 0, 0, 0, 0])
})
test('AF-03 unassigned family and non-advisor cannot open case', () => {
  const r = make(), h = signedFixture('EDUCATION', 'B'); r.ingest(h)
  const req = r.requestFollowUp(followup(h))
  rejected(() => r.openCase(req.advisor_request_id), 'PERMISSION_DENIED')
  rejected(() => r.openCase(req.advisor_request_id, 'parent'), 'PERMISSION_DENIED')
})
test('AF-03 withdrawn advisor consent blocks request replay, case and note', () => {
  const r = make(), h = signedFixture(); r.ingest(h)
  const req = r.requestFollowUp(followup(h)), c = r.openCase(req.advisor_request_id)
  r.revokeConsent(req.consent_id)
  rejected(() => r.requestFollowUp(followup(h)), 'CONSENT_NOT_ACTIVE')
  rejected(() => r.openCase(req.advisor_request_id), 'CONSENT_NOT_ACTIVE')
  rejected(() => r.addNote({ advisor_case_id: c.advisor_case_id, content_ref: 'note_content_synthetic_001' }), 'CONSENT_NOT_ACTIVE')
  rejected(() => r.readTimeline(FAMILIES.A), 'CONSENT_NOT_ACTIVE')
})
test('AF-03 revoked advisor assignment blocks case replay and note', () => {
  const r = make(), h = signedFixture(); r.ingest(h)
  const req = r.requestFollowUp(followup(h)), c = r.openCase(req.advisor_request_id); r.revokeAdvisor()
  rejected(() => r.openCase(req.advisor_request_id), 'PERMISSION_DENIED')
  rejected(() => r.addNote({ advisor_case_id: c.advisor_case_id, content_ref: 'note_content_synthetic_001' }), 'PERMISSION_DENIED')
})
test('AF-04 raw advisor note and arbitrary content reference rejected', () => {
  const r = make(), h = signedFixture(); r.ingest(h)
  const req = r.requestFollowUp(followup(h)), c = r.openCase(req.advisor_request_id)
  rejected(() => r.addNote({ advisor_case_id: c.advisor_case_id, content_ref: 'DO_NOT_LOG' }), 'SYNTHETIC_FIXTURE_REQUIRED')
  rejected(() => r.addNote({ advisor_case_id: c.advisor_case_id, content_ref: 'note_content_synthetic_001', note: 'DO_NOT_LOG' }), 'HANDOFF_PAYLOAD_TOO_BROAD')
  assert.ok(!JSON.stringify(r.inspectSyntheticState()).includes('DO_NOT_LOG'))
})
test('TL-02 and all read/receipt snapshots cannot mutate internal evidence', () => {
  const r = make(), h = signedFixture(), a = r.ingest(h)
  a.timeline_event_ids.length = 0
  h.result_summary.headline = 'MUTATED'
  r.readTimeline(FAMILIES.A)[0].event_type = 'MUTATED'
  const snapshot = r.inspectSyntheticState(); snapshot.audit.length = 0; snapshot.payloads = {}
  assert.equal(r.ingest(signedFixture()).status, 'DUPLICATE')
  assert.ok(!JSON.stringify(r.inspectSyntheticState()).includes('MUTATED'))
})
test('empty fresh adapter has no persistence from earlier instance', () => {
  make().ingest(signedFixture()); assert.deepEqual(count(make()), [0, 0, 0, 0, 0, 0])
})
test('canonical hashing preserves array order and ignores object order', () => {
  assert.equal(hash({ a: 1, b: null }), hash({ b: null, a: 1 }))
  assert.notEqual(hash(['a', 'b']), hash(['b', 'a']))
  assert.equal(canonical(true), 'true')
})
test('safe missing-reference failures', () => {
  const r = make()
  rejected(() => r.requestFollowUp({ handoff_id: 'missing', consent_id: 'missing' }), 'HANDOFF_NOT_FOUND')
  rejected(() => r.openCase('missing'), 'ADVISOR_REQUEST_NOT_FOUND')
  rejected(() => r.addNote({ advisor_case_id: 'missing', content_ref: 'note_content_synthetic_001' }), 'ADVISOR_CASE_NOT_FOUND')
})
test('invalid test control values are rejected', () => {
  const r = make()
  rejected(() => r.advanceClock('yesterday'), 'INVALID_TIMESTAMP')
  rejected(() => r.advanceClock('2026-09-05T12:00:00.000Z'), 'INVALID_TIMESTAMP')
  rejected(() => r.revokeConsent('unknown'), 'CONSENT_REQUIRED')
  rejected(() => r.revokeEntitlement('unknown'), 'ENTITLEMENT_REQUIRED')
  rejected(() => r.failNextAt('network'), 'INVALID_FAILURE_POINT')
  r.advanceClock(NOW)
})
test('non-object/prototype-bearing inputs are rejected without persistence', () => {
  for (const value of [null, undefined, [], 'SYNTHETIC_ONLY']) {
    const r = make(); rejected(() => r.ingest(value), 'UNSUPPORTED_COMPASS_TYPE')
    assert.deepEqual(count(r), [0, 0, 0, 0, 0, 0])
  }
  const h = Object.assign(Object.create({ role: 'ADMIN' }), signedFixture())
  rejected(() => make().ingest(h), 'HANDOFF_PAYLOAD_TOO_BROAD')
})
test('advisor assignment expiration is checked before reusing a case', () => {
  const r = make(), h = signedFixture(); r.ingest(h)
  const req = r.requestFollowUp(followup(h)); r.openCase(req.advisor_request_id)
  r.advanceClock(EXPIRES)
  rejected(() => r.openCase(req.advisor_request_id), 'PERMISSION_DENIED')
})
for (const point of ['before_audit', 'before_commit']) {
  for (const operation of ['FOLLOW_UP', 'CASE_OPEN', 'NOTE_ADD']) {
    test(`${operation} at ${point}: no partial writes; safe retry`, () => {
      const r = make(), h = signedFixture(); r.ingest(h)
      let perform = () => r.requestFollowUp(followup(h))
      if (operation !== 'FOLLOW_UP') {
        const req = r.requestFollowUp(followup(h)); perform = () => r.openCase(req.advisor_request_id)
        if (operation === 'NOTE_ADD') {
          const c = r.openCase(req.advisor_request_id)
          perform = () => r.addNote({ advisor_case_id: c.advisor_case_id, content_ref: 'note_content_synthetic_001' })
        }
      }
      const before = count(r); r.failNextAt(point)
      rejected(perform, point === 'before_audit' ? 'SIMULATED_AUDIT_FAILURE' : 'SIMULATED_COMMIT_FAILURE')
      assert.deepEqual(count(r), before)
      r.failNextAt(null); perform(); const after = count(r); perform(); assert.deepEqual(count(r), after)
    })
  }
}
