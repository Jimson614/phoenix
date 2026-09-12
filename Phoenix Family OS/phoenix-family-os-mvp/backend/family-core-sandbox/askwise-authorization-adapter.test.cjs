'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { AskWiseAuthorizationAdapter } = require('./askwise-authorization-adapter.cjs')

const memberId = '10000000-0000-4000-8000-000000000001'
const sourceStudentId = '101'
const action = 'ASKWISE_ENROLL'
const requiredScope = 'ASKWISE_HANDOFF'
const requestId = 'askwise-adapter-unit-001'
const auditId = '89000000-0000-4000-8000-000000000101'

test('passes source mapping and audit context to the six-argument Core contract', async () => {
  let captured
  const adapter = new AskWiseAuthorizationAdapter(async (sql, params) => {
    captured = { sql, params }
    return {
      rows: [{
        decision: 'ALLOW',
        reason_code: 'ALLOW',
        relationship_id: '13000000-0000-4000-8000-000000000001',
        consent_id: '15000000-0000-4000-8000-000000000003',
        entitlement_id: '17000000-0000-4000-8000-000000000002',
        mapping_id: '52000000-0000-4000-8000-000000000001',
        student_id: 'stu_00000000000040008000000000000001',
        audit_id: auditId,
      }],
    }
  })

  const decision = await adapter.authorizeStudentAccess(
    memberId,
    sourceStudentId,
    action,
    requiredScope,
    requestId,
    auditId,
  )

  assert.match(captured.sql, /core\.authorize_student_access/)
  assert.match(captured.sql, /entitlement_id, mapping_id, student_id, audit_id/)
  assert.deepEqual(captured.params, [
    memberId,
    sourceStudentId,
    action,
    requiredScope,
    requestId,
    auditId,
  ])
  assert.deepEqual(decision, {
    decision: 'ALLOW',
    reasonCode: 'ALLOW',
    memberId,
    sourceStudentId,
    coreStudentId: 'stu_00000000000040008000000000000001',
    relationshipId: '13000000-0000-4000-8000-000000000001',
    consentGrantId: '15000000-0000-4000-8000-000000000003',
    entitlementId: '17000000-0000-4000-8000-000000000002',
    mappingId: '52000000-0000-4000-8000-000000000001',
    auditId,
    retryable: false,
  })
})

test('preserves an audited Core denial without inferring entitlement', async () => {
  const adapter = new AskWiseAuthorizationAdapter(async () => ({
    rows: [{
      decision: 'DENY',
      reason_code: 'ENTITLEMENT_REQUIRED',
      relationship_id: '13000000-0000-4000-8000-000000000001',
      consent_id: '15000000-0000-4000-8000-000000000003',
      entitlement_id: null,
      mapping_id: '52000000-0000-4000-8000-000000000001',
      student_id: 'stu_00000000000040008000000000000001',
      audit_id: auditId,
    }],
  }))

  const decision = await adapter.authorizeStudentAccess(
    memberId, sourceStudentId, action, requiredScope, requestId, auditId,
  )
  assert.equal(decision.decision, 'DENY')
  assert.equal(decision.reasonCode, 'ENTITLEMENT_REQUIRED')
  assert.equal(decision.auditId, auditId)
  assert.equal(decision.entitlementId, undefined)
})

test('fails closed when Core is unavailable', async () => {
  const adapter = new AskWiseAuthorizationAdapter(async () => {
    throw new Error('synthetic unavailable')
  })
  const decision = await adapter.authorizeStudentAccess(
    memberId, sourceStudentId, action, requiredScope, requestId, auditId,
  )
  assert.equal(decision.decision, 'DENY')
  assert.equal(decision.reasonCode, 'TEMPORARILY_UNAVAILABLE')
  assert.equal(decision.retryable, true)
})

test('fails closed on an incomplete Core allow response', async () => {
  const adapter = new AskWiseAuthorizationAdapter(async () => ({
    rows: [{ decision: 'ALLOW', reason_code: 'ALLOW', audit_id: auditId }],
  }))
  const decision = await adapter.authorizeStudentAccess(
    memberId, sourceStudentId, action, requiredScope, requestId, auditId,
  )
  assert.equal(decision.decision, 'DENY')
  assert.equal(decision.reasonCode, 'INVALID_CORE_DECISION')
})

test('rejects a request without auditable identifiers before querying Core', async () => {
  let queried = false
  const adapter = new AskWiseAuthorizationAdapter(async () => {
    queried = true
    return { rows: [] }
  })
  const decision = await adapter.authorizeStudentAccess(
    memberId, sourceStudentId, action, requiredScope,
  )
  assert.equal(queried, false)
  assert.equal(decision.decision, 'DENY')
  assert.equal(decision.reasonCode, 'AUDIT_CONTEXT_REQUIRED')
})
