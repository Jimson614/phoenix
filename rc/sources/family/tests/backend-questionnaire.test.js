const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createBackend } = require('../backend/server')

const ANSWERS = {
  school_stage: '小学',
  learning_feeling: '基本稳定',
  strengths: ['好奇心', '创造力'],
  interests: 'synthetic-fixture-interest',
  challenges: ['时间管理'],
  parent_observation: 'synthetic-fixture-observation',
  parent_expectation: '身心健康',
  future_goal: 'synthetic-fixture-goal',
  support_need: ['学习计划'],
  available_time: '每周一次'
}

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  return { status: response.status, body: await response.json() }
}

async function run() {
  assert.throws(() => createBackend({
    databasePath: ':memory:', host: '0.0.0.0', port: 0, enableDemoAuth: true
  }), /loopback/)
  assert.throws(() => createBackend({
    databasePath: ':memory:', host: '127.0.0.1', port: 0, enableDemoAuth: false
  }), /External authentication is not implemented/)

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pfs-questionnaire-backend-'))
  const databasePath = path.join(temporaryDirectory, 'questionnaire-test.sqlite')
  const backend = createBackend({
    databasePath,
    host: '127.0.0.1',
    port: 0,
    enableDemoAuth: true
  })

  try {
    const address = await backend.listen()
    const baseUrl = `http://127.0.0.1:${address.port}`
    const submission = {
      clientSubmissionId: 'asm_synthetic_001',
      familyId: 'fam_synthetic_001',
      studentId: 'stu_synthetic_001',
      questionnaireType: 'education',
      answers: ANSWERS,
      submittedAt: '2026-08-17T08:00:00.000Z'
    }

    const health = await jsonRequest(baseUrl, '/health')
    assert.equal(health.status, 200)
    assert.equal(health.body.database, 'connected')

    const unauthenticated = await jsonRequest(baseUrl, '/v1/questionnaire-submissions', {
      method: 'POST', body: submission
    })
    assert.equal(unauthenticated.status, 401)

    const firstSession = await jsonRequest(baseUrl, '/v1/demo/sessions', {
      method: 'POST', body: { installationId: 'install_synthetic_a_001' }
    })
    assert.equal(firstSession.status, 201)
    assert.equal(firstSession.body.authMode, 'local_demo')
    assert.ok(firstSession.body.token)
    const storedToken = backend.database.prepare('SELECT token_hash AS tokenHash FROM demo_sessions').get()
    assert.notEqual(storedToken.tokenHash, firstSession.body.token)
    assert.match(storedToken.tokenHash, /^[a-f0-9]{64}$/)

    const created = await jsonRequest(baseUrl, '/v1/questionnaire-submissions', {
      method: 'POST', token: firstSession.body.token, body: submission
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.status, 'synced')
    assert.equal(created.body.duplicate, false)

    const stored = backend.database.prepare(`
      SELECT client_submission_id AS clientSubmissionId, answers_json AS answersJson
      FROM questionnaire_submissions
    `).get()
    assert.equal(stored.clientSubmissionId, submission.clientSubmissionId)
    assert.deepEqual(JSON.parse(stored.answersJson), ANSWERS)
    assert.equal(fs.existsSync(databasePath), true)

    const auditRows = backend.database.prepare('SELECT metadata_json AS metadataJson FROM audit_log').all()
    assert(auditRows.every((row) => !row.metadataJson.includes('synthetic-fixture-interest')))
    assert(auditRows.every((row) => !Object.hasOwn(JSON.parse(row.metadataJson), 'answers')))

    const duplicate = await jsonRequest(baseUrl, '/v1/questionnaire-submissions', {
      method: 'POST', token: firstSession.body.token, body: submission
    })
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.body.duplicate, true)
    assert.equal(backend.database.prepare('SELECT COUNT(*) AS count FROM questionnaire_submissions').get().count, 1)

    const conflicting = await jsonRequest(baseUrl, '/v1/questionnaire-submissions', {
      method: 'POST',
      token: firstSession.body.token,
      body: { ...submission, answers: { ...ANSWERS, interests: 'different-fixture-content' } }
    })
    assert.equal(conflicting.status, 409)

    const secondSession = await jsonRequest(baseUrl, '/v1/demo/sessions', {
      method: 'POST', body: { installationId: 'install_synthetic_b_001' }
    })
    const crossFamily = await jsonRequest(baseUrl, '/v1/questionnaire-submissions', {
      method: 'POST',
      token: secondSession.body.token,
      body: { ...submission, clientSubmissionId: 'asm_synthetic_002' }
    })
    assert.equal(crossFamily.status, 403)

    const invalidAnswers = await jsonRequest(baseUrl, '/v1/questionnaire-submissions', {
      method: 'POST',
      token: firstSession.body.token,
      body: {
        ...submission,
        clientSubmissionId: 'asm_synthetic_003',
        answers: { ...ANSWERS, unsupported_field: 'rejected' }
      }
    })
    assert.equal(invalidAnswers.status, 400)

    const invalidOption = await jsonRequest(baseUrl, '/v1/questionnaire-submissions', {
      method: 'POST',
      token: firstSession.body.token,
      body: {
        ...submission,
        clientSubmissionId: 'asm_synthetic_004',
        answers: { ...ANSWERS, school_stage: 'unsupported-stage' }
      }
    })
    assert.equal(invalidOption.status, 400)

    const forgedIdentity = await jsonRequest(baseUrl, '/v1/questionnaire-submissions', {
      method: 'POST',
      token: firstSession.body.token,
      body: { ...submission, clientSubmissionId: 'asm_synthetic_005', userId: 'forged_user' }
    })
    assert.equal(forgedIdentity.status, 400)

    backend.database.exec(`
      CREATE TRIGGER fail_submission_audit_for_test
      BEFORE INSERT ON audit_log
      WHEN NEW.action = 'questionnaire_submission_created'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic audit failure');
      END;
    `)
    const capturedErrors = []
    const originalConsoleError = console.error
    console.error = (...values) => capturedErrors.push(values)
    let rolledBack
    try {
      rolledBack = await jsonRequest(baseUrl, '/v1/questionnaire-submissions', {
        method: 'POST',
        token: firstSession.body.token,
        body: {
          ...submission,
          clientSubmissionId: 'asm_synthetic_006',
          familyId: 'fam_synthetic_rollback',
          studentId: 'stu_synthetic_rollback'
        }
      })
    } finally {
      console.error = originalConsoleError
      backend.database.exec('DROP TRIGGER fail_submission_audit_for_test;')
    }
    assert.equal(rolledBack.status, 500)
    assert.equal(backend.database.prepare("SELECT COUNT(*) AS count FROM families WHERE id = 'fam_synthetic_rollback'").get().count, 0)
    assert.equal(backend.database.prepare("SELECT COUNT(*) AS count FROM students WHERE id = 'stu_synthetic_rollback'").get().count, 0)
    assert.equal(backend.database.prepare("SELECT COUNT(*) AS count FROM questionnaire_submissions WHERE client_submission_id = 'asm_synthetic_006'").get().count, 0)
    const safeLog = JSON.stringify(capturedErrors)
    assert.equal(safeLog.includes(firstSession.body.token), false)
    assert.equal(safeLog.includes(ANSWERS.interests), false)
    assert.equal(backend.database.prepare('SELECT COUNT(*) AS count FROM questionnaire_submissions').get().count, 1)

    console.log('✓ backend: authenticated questionnaire submissions are persisted in SQLite')
    console.log('✓ backend: idempotency, ownership, validation, transaction rollback, and redacted audit metadata are enforced')
  } finally {
    await backend.close()
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
