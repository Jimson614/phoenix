const assert = require('node:assert/strict')

const memory = new Map()
const requests = []
let sessionNumber = 0
let rejectNextSubmission = false
let malformedNextSubmission = false

global.wx = {
  getStorageSync: (key) => memory.get(key),
  setStorageSync: (key, value) => memory.set(key, value),
  removeStorageSync: (key) => memory.delete(key),
  request(options) {
    requests.push(options)
    if (options.url.endsWith('/v1/demo/sessions')) {
      sessionNumber += 1
      options.success({
        statusCode: 201,
        data: {
          token: `synthetic-session-${sessionNumber}`,
          expiresAt: '2099-01-01T00:00:00.000Z',
          authMode: 'local_demo'
        }
      })
      return
    }
    if (rejectNextSubmission) {
      rejectNextSubmission = false
      options.success({ statusCode: 401, data: { error: { code: 'unauthorized' } } })
      return
    }
    if (malformedNextSubmission) {
      malformedNextSubmission = false
      options.success({ statusCode: 200, data: {} })
      return
    }
    options.success({
      statusCode: 201,
      data: {
        status: 'synced',
        submissionId: 'qsub_synthetic',
        receivedAt: '2026-08-17T08:00:00.000Z'
      }
    })
  }
}

const {
  clearSession,
  LOCAL_DEMO_API_BASE_URL,
  SESSION_KEY,
  submitQuestionnaire
} = require('../services/backend-api')

async function run() {
  const payload = { clientSubmissionId: 'asm_api_fixture_001', answers: { fixture: true } }
  const firstResult = await submitQuestionnaire(payload)
  assert.equal(firstResult.status, 'synced')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].url, `${LOCAL_DEMO_API_BASE_URL}/v1/demo/sessions`)
  assert.equal(requests[1].url, `${LOCAL_DEMO_API_BASE_URL}/v1/questionnaire-submissions`)
  assert.equal(requests[1].header.Authorization, 'Bearer synthetic-session-1')
  assert.equal(requests[1].timeout, 5000)

  await submitQuestionnaire({ ...payload, clientSubmissionId: 'asm_api_fixture_002' })
  assert.equal(requests.length, 3, 'a valid cached session should be reused')

  rejectNextSubmission = true
  await submitQuestionnaire({ ...payload, clientSubmissionId: 'asm_api_fixture_003' })
  assert.equal(sessionNumber, 2, 'a 401 should replace the Local Demo session once')
  assert.equal(memory.get(SESSION_KEY).token, 'synthetic-session-2')
  assert.equal(requests.at(-1).header.Authorization, 'Bearer synthetic-session-2')

  malformedNextSubmission = true
  await assert.rejects(
    submitQuestionnaire({ ...payload, clientSubmissionId: 'asm_api_fixture_004' }),
    (error) => error.code === 'invalid_response'
  )

  assert(requests.every((request) => request.url.startsWith('http://127.0.0.1:8787/')))
  clearSession()
  assert.equal(memory.has(SESSION_KEY), false)
  console.log('✓ backend API client: fixed loopback, session reuse, timeout, 401 refresh, and receipt validation work')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
