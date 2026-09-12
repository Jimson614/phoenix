'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { AskWiseAuthorizationAdapter } = require('./askwise-authorization-adapter.cjs')

test('preserves authorizeStudentAccess(memberId, studentId, action, requiredScope)', async () => {
  let captured
  const adapter = new AskWiseAuthorizationAdapter(async (sql, params) => {
    captured = { sql, params }
    return {
      rows: [{
        decision: 'ALLOW',
        reason_code: 'ALLOW',
        relationship_id: '13000000-0000-4000-8000-000000000001',
        consent_id: '15000000-0000-4000-8000-000000000003',
      }],
    }
  })

  const decision = await adapter.authorizeStudentAccess(
    '10000000-0000-4000-8000-000000000001',
    'stu_00000000000040008000000000000001',
    'ASKWISE_ENROLL',
    'ASKWISE_HANDOFF',
  )

  assert.match(captured.sql, /core\.authorize_student_access/)
  assert.deepEqual(captured.params, [
    '10000000-0000-4000-8000-000000000001',
    'stu_00000000000040008000000000000001',
    'ASKWISE_ENROLL',
    'ASKWISE_HANDOFF',
  ])
  assert.deepEqual(decision, {
    decision: 'ALLOW',
    reasonCode: 'ALLOW',
    memberId: '10000000-0000-4000-8000-000000000001',
    studentId: 'stu_00000000000040008000000000000001',
    relationshipId: '13000000-0000-4000-8000-000000000001',
    consentGrantId: '15000000-0000-4000-8000-000000000003',
    retryable: false,
  })
})

test('fails closed when Core is unavailable', async () => {
  const adapter = new AskWiseAuthorizationAdapter(async () => {
    throw new Error('synthetic unavailable')
  })
  const decision = await adapter.authorizeStudentAccess(
    '10000000-0000-4000-8000-000000000001',
    'stu_00000000000040008000000000000001',
    'ASKWISE_ENROLL',
    'ASKWISE_HANDOFF',
  )
  assert.equal(decision.decision, 'DENY')
  assert.equal(decision.reasonCode, 'TEMPORARILY_UNAVAILABLE')
  assert.equal(decision.retryable, true)
})
