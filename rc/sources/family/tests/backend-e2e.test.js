const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createBackend } = require('../backend/server')

const memory = new Map()
let runtimeBaseUrl = ''

global.wx = {
  getStorageSync: (key) => memory.get(key),
  setStorageSync: (key, value) => memory.set(key, value),
  removeStorageSync: (key) => memory.delete(key),
  request(options) {
    const requestedPath = new URL(options.url).pathname
    fetch(`${runtimeBaseUrl}${requestedPath}`, {
      method: options.method,
      headers: options.header,
      body: options.data === undefined ? undefined : JSON.stringify(options.data)
    }).then(async (response) => {
      options.success({ statusCode: response.status, data: await response.json() })
    }).catch((error) => options.fail({ errMsg: error.message }))
  }
}

const { submitQuestionnaire } = require('../services/backend-api')

async function run() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pfs-backend-e2e-'))
  const backend = createBackend({
    databasePath: path.join(temporaryDirectory, 'e2e.sqlite'),
    host: '127.0.0.1',
    port: 0,
    enableDemoAuth: true
  })

  try {
    const address = await backend.listen()
    runtimeBaseUrl = `http://127.0.0.1:${address.port}`
    const result = await submitQuestionnaire({
      clientSubmissionId: 'asm_e2e_synthetic_001',
      familyId: 'fam_e2e_synthetic_001',
      studentId: 'stu_e2e_synthetic_001',
      questionnaireType: 'education',
      answers: {
        school_stage: '小学',
        learning_feeling: '基本稳定',
        strengths: ['好奇心'],
        interests: 'synthetic-e2e-interest',
        challenges: ['时间管理'],
        parent_observation: 'synthetic-e2e-observation',
        parent_expectation: '身心健康',
        future_goal: 'synthetic-e2e-goal',
        support_need: ['学习计划'],
        available_time: '每周一次'
      },
      submittedAt: '2026-08-17T08:00:00.000Z'
    })

    assert.equal(result.status, 'synced')
    const stored = backend.database.prepare(`
      SELECT client_submission_id AS clientSubmissionId
      FROM questionnaire_submissions
    `).get()
    assert.equal(stored.clientSubmissionId, 'asm_e2e_synthetic_001')
    console.log('✓ backend E2E: mini API adapter → HTTP proxy → file-backed SQLite works with synthetic data')
  } finally {
    await backend.close()
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
