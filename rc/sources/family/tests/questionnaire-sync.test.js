const assert = require('node:assert/strict')
const {
  ACKED_IDS_KEY,
  createQuestionnaireSync,
  FAILED_KEY,
  OUTBOX_KEY,
  RECEIPTS_KEY
} = require('../services/questionnaire-sync')

function memoryStorage() {
  const values = new Map()
  return {
    get(key) {
      const value = values.get(key)
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
    },
    set(key, value) {
      values.set(key, JSON.parse(JSON.stringify(value)))
    },
    remove(key) {
      values.delete(key)
    }
  }
}

function payload(id) {
  return { clientSubmissionId: id, answers: { fixture: true } }
}

async function run() {
  let clock = Date.parse('2026-08-17T08:00:00.000Z')
  const successfulStorage = memoryStorage()
  let transportCalls = 0
  const successfulSync = createQuestionnaireSync({
    storage: successfulStorage,
    now: () => clock,
    transport: async (value) => {
      transportCalls += 1
      return {
        submissionId: `server_${value.clientSubmissionId}`,
        receivedAt: new Date(clock).toISOString()
      }
    }
  })

  assert.equal(successfulSync.enqueue(payload('asm_queue_001')), true)
  assert.equal(successfulSync.enqueue(payload('asm_queue_001')), false)
  assert.equal(successfulSync.pendingCount(), 1)
  const success = await successfulSync.flush()
  assert.equal(success.synced, 1)
  assert.equal(successfulSync.pendingCount(), 0)
  assert.equal(transportCalls, 1)
  assert.equal(successfulStorage.get(RECEIPTS_KEY).length, 1)
  assert.deepEqual(successfulStorage.get(ACKED_IDS_KEY), ['asm_queue_001'])
  successfulSync.enqueue(payload('asm_queue_clear'))
  successfulSync.clear()
  assert.equal(successfulSync.pendingCount(), 0)
  assert.equal(successfulStorage.get(RECEIPTS_KEY), undefined)
  assert.equal(successfulStorage.get(ACKED_IDS_KEY), undefined)

  const retryStorage = memoryStorage()
  let unavailable = true
  const retrySync = createQuestionnaireSync({
    storage: retryStorage,
    now: () => clock,
    transport: async () => {
      if (unavailable) throw Object.assign(new Error('offline'), { code: 'network_error' })
      return { submissionId: 'server_retry', receivedAt: new Date(clock).toISOString() }
    }
  })
  retrySync.enqueue(payload('asm_queue_002'))
  const pending = await retrySync.flush()
  assert.equal(pending.pending, 1)
  assert.equal(retryStorage.get(OUTBOX_KEY)[0].attempts, 1)
  unavailable = false
  clock += 2000
  await retrySync.flush()
  assert.equal(retrySync.pendingCount(), 0)

  const failedStorage = memoryStorage()
  const failedSync = createQuestionnaireSync({
    storage: failedStorage,
    now: () => clock,
    transport: async () => {
      throw Object.assign(new Error('invalid'), { code: 'invalid_answers', statusCode: 422 })
    }
  })
  failedSync.enqueue(payload('asm_queue_003'))
  const failed = await failedSync.flush()
  assert.equal(failed.failed, 1)
  assert.equal(failedSync.pendingCount(), 0)
  assert.equal(failedSync.failedCount(), 1)
  assert.equal(failedStorage.get(FAILED_KEY)[0].lastErrorCode, 'invalid_answers')

  const concurrentStorage = memoryStorage()
  let resolveTransport
  let concurrentCalls = 0
  const concurrentSync = createQuestionnaireSync({
    storage: concurrentStorage,
    now: () => clock,
    transport: () => {
      concurrentCalls += 1
      if (concurrentCalls === 1) return new Promise((resolve) => { resolveTransport = resolve })
      return Promise.resolve({ submissionId: 'server_concurrent_2', receivedAt: new Date(clock).toISOString() })
    }
  })
  concurrentSync.enqueue(payload('asm_queue_004'))
  const firstFlush = concurrentSync.flush()
  concurrentSync.enqueue(payload('asm_queue_005'))
  const secondFlush = concurrentSync.flush()
  assert.equal(firstFlush, secondFlush)
  resolveTransport({ submissionId: 'server_concurrent', receivedAt: new Date(clock).toISOString() })
  await firstFlush
  assert.equal(concurrentCalls, 2)
  assert.equal(concurrentSync.pendingCount(), 0)

  const recoveryStorage = memoryStorage()
  const recoverySync = createQuestionnaireSync({ storage: recoveryStorage, now: () => clock })
  const recoverableAssessment = {
    id: 'asm_recoverable_001',
    student_id: 'stu_recoverable_001',
    type: 'education',
    status: 'completed',
    answers: { fixture: true },
    sync_requested_at: '2026-08-17T08:00:00.000Z',
    created_at: '2026-08-17T08:00:00.000Z'
  }
  const legacyAssessment = {
    ...recoverableAssessment,
    id: 'asm_legacy_001',
    sync_requested_at: undefined
  }
  const recoveryRepository = {
    all: () => [recoverableAssessment, legacyAssessment],
    getById: (_table, id) => id === 'stu_recoverable_001'
      ? { id, family_id: 'fam_recoverable_001' }
      : null
  }
  assert.equal(recoverySync.reconcile(recoveryRepository), 1)
  assert.equal(recoverySync.reconcile(recoveryRepository), 0)
  assert.equal(recoverySync.pendingCount(), 1)
  assert.equal(recoveryStorage.get(OUTBOX_KEY)[0].payload.clientSubmissionId, 'asm_recoverable_001')

  console.log('✓ questionnaire sync: deduplication, receipts, retry, permanent failure, and recovery work')
  console.log('✓ questionnaire sync: concurrent/new flush requests do not strand or duplicate submissions')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
