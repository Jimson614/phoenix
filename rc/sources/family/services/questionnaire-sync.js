const backendApi = require('./backend-api')

const OUTBOX_KEY = 'PFS_QUESTIONNAIRE_OUTBOX_V01'
const FAILED_KEY = 'PFS_QUESTIONNAIRE_FAILED_V01'
const RECEIPTS_KEY = 'PFS_QUESTIONNAIRE_RECEIPTS_V01'
const ACKED_IDS_KEY = 'PFS_QUESTIONNAIRE_ACKED_IDS_V01'
const MAX_RECEIPTS = 50
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000

function defaultStorage() {
  return {
    get: (key) => wx.getStorageSync(key),
    set: (key, value) => wx.setStorageSync(key, value),
    remove: (key) => wx.removeStorageSync(key)
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function createQuestionnaireSync(options = {}) {
  const storage = options.storage || defaultStorage()
  const transport = options.transport || backendApi.submitQuestionnaire
  const now = options.now || (() => Date.now())
  let activeFlush = null
  let flushRequested = false

  function read(key) {
    return asArray(storage.get(key))
  }

  function write(key, value) {
    storage.set(key, value)
  }

  function enqueue(payload) {
    const queue = read(OUTBOX_KEY)
    if (queue.some((item) => item.payload && item.payload.clientSubmissionId === payload.clientSubmissionId)) {
      return false
    }
    queue.push({
      payload,
      queuedAt: new Date(now()).toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
      lastErrorCode: ''
    })
    write(OUTBOX_KEY, queue)
    return true
  }

  function removePending(clientSubmissionId) {
    write(OUTBOX_KEY, read(OUTBOX_KEY).filter((item) => {
      return !item.payload || item.payload.clientSubmissionId !== clientSubmissionId
    }))
  }

  function recordReceipt(item, result) {
    const receipts = read(RECEIPTS_KEY)
    receipts.unshift({
      clientSubmissionId: item.payload.clientSubmissionId,
      serverSubmissionId: result.submissionId,
      receivedAt: result.receivedAt,
      syncedAt: new Date(now()).toISOString()
    })
    write(RECEIPTS_KEY, receipts.slice(0, MAX_RECEIPTS))
    const acknowledgedIds = read(ACKED_IDS_KEY)
    if (!acknowledgedIds.includes(item.payload.clientSubmissionId)) {
      acknowledgedIds.push(item.payload.clientSubmissionId)
      write(ACKED_IDS_KEY, acknowledgedIds)
    }
  }

  function isPermanent(error) {
    return [400, 403, 409, 413, 415, 422].includes(error && error.statusCode)
  }

  function recordFailure(item, error) {
    const failures = read(FAILED_KEY)
    failures.push({
      clientSubmissionId: item.payload.clientSubmissionId,
      failedAt: new Date(now()).toISOString(),
      lastErrorCode: error && error.code ? error.code : 'request_failed'
    })
    write(FAILED_KEY, failures)
    removePending(item.payload.clientSubmissionId)
  }

  function recordRetry(item, error) {
    const queue = read(OUTBOX_KEY)
    const target = queue.find((candidate) => {
      return candidate.payload && candidate.payload.clientSubmissionId === item.payload.clientSubmissionId
    })
    if (!target) return
    target.attempts = Number(target.attempts || 0) + 1
    target.lastErrorCode = error && error.code ? error.code : 'request_failed'
    target.nextAttemptAt = now() + Math.min(1000 * (2 ** Math.min(target.attempts - 1, 8)), MAX_RETRY_DELAY_MS)
    write(OUTBOX_KEY, queue)
  }

  async function performFlush() {
    const snapshot = read(OUTBOX_KEY)
    const summary = { synced: 0, pending: snapshot.length, failed: 0 }
    for (const item of snapshot) {
      if (!item || !item.payload || item.nextAttemptAt > now()) continue
      try {
        const result = await transport(item.payload)
        recordReceipt(item, result)
        removePending(item.payload.clientSubmissionId)
        summary.synced += 1
      } catch (error) {
        if (isPermanent(error)) {
          recordFailure(item, error)
          summary.failed += 1
        } else {
          recordRetry(item, error)
        }
      }
    }
    summary.pending = read(OUTBOX_KEY).length
    return summary
  }

  function reconcile(repository) {
    const knownIds = new Set(read(ACKED_IDS_KEY))
    read(RECEIPTS_KEY).forEach((item) => knownIds.add(item.clientSubmissionId))
    read(OUTBOX_KEY).forEach((item) => {
      if (item.payload) knownIds.add(item.payload.clientSubmissionId)
    })
    read(FAILED_KEY).forEach((item) => {
      knownIds.add(item.clientSubmissionId || (item.payload && item.payload.clientSubmissionId))
    })

    let recovered = 0
    repository.all('assessments').forEach((assessment) => {
      if (!assessment ||
          assessment.type !== 'education' ||
          assessment.status !== 'completed' ||
          !assessment.sync_requested_at ||
          knownIds.has(assessment.id)) return
      const student = repository.getById('students', assessment.student_id)
      if (!student || !student.family_id) return
      if (enqueue({
        clientSubmissionId: assessment.id,
        familyId: student.family_id,
        studentId: student.id,
        questionnaireType: 'education',
        answers: assessment.answers,
        submittedAt: assessment.created_at
      })) {
        knownIds.add(assessment.id)
        recovered += 1
      }
    })
    return recovered
  }

  function flush() {
    if (activeFlush) {
      flushRequested = true
      return activeFlush
    }
    activeFlush = (async () => {
      let summary
      do {
        flushRequested = false
        summary = await performFlush()
      } while (flushRequested)
      return summary
    })().finally(() => { activeFlush = null })
    return activeFlush
  }

  function clear() {
    const syncKeys = [OUTBOX_KEY, FAILED_KEY, RECEIPTS_KEY, ACKED_IDS_KEY]
    syncKeys.forEach((key) => {
      if (storage.remove) storage.remove(key)
      else write(key, [])
    })
  }

  return {
    clear,
    enqueue,
    flush,
    reconcile,
    pendingCount: () => read(OUTBOX_KEY).length,
    failedCount: () => read(FAILED_KEY).length
  }
}

const questionnaireSync = createQuestionnaireSync()

module.exports = {
  ...questionnaireSync,
  ACKED_IDS_KEY,
  createQuestionnaireSync,
  FAILED_KEY,
  OUTBOX_KEY,
  RECEIPTS_KEY
}
