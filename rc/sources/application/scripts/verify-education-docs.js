'use strict'

const assert = require('node:assert/strict')
const { readFile, readdir } = require('node:fs/promises')
const path = require('node:path')

const { validateQuestionnaireAnswers } = require('../server/dist/src/domain/education-compass/validator.js')

const root = path.resolve(__dirname, '..')
const examplesDirectory = path.join(root, 'docs', 'examples')
const expectedValid = new Map([
  ['free-parent-valid.json', { level: 'LEVEL_1', educationSystem: null }],
  ['free-parent-v1.1-valid.json', { level: 'LEVEL_1', educationSystem: null }],
  ['level2-gaokao-valid.json', { level: 'LEVEL_2', educationSystem: 'GAOKAO' }],
  ['level2-gaokao-v1.1-valid.json', { level: 'LEVEL_2', educationSystem: 'GAOKAO' }],
  ['level2-dse-valid.json', { level: 'LEVEL_2', educationSystem: 'DSE' }],
  ['level2-igcse-valid.json', { level: 'LEVEL_2', educationSystem: 'IGCSE' }],
  ['level2-a-level-valid.json', { level: 'LEVEL_2', educationSystem: 'A_LEVEL' }],
  ['level2-ap-us-valid.json', { level: 'LEVEL_2', educationSystem: 'AP_US' }],
  ['level2-ib-valid.json', { level: 'LEVEL_2', educationSystem: 'IB' }],
  ['level2-other-valid.json', { level: 'LEVEL_2', educationSystem: 'OTHER' }]
])
const expectedInvalid = new Set([
  'invalid-free-create-unknown-field.json',
  'invalid-level2-parent-respondent.json',
  'invalid-draft-stale-revision.json',
  'invalid-level2-system-route-mismatch.json'
])

async function main() {
  const openapiPath = path.join(root, 'docs', 'openapi', 'education-compass-v0.5.0.openapi.yaml')
  const openapi = await readFile(openapiPath, 'utf8')
  assert.match(openapi, /^openapi: 3\.1\.0/m)
  assert.match(openapi, /^  version: 0\.5\.0$/m)
  for (const route of [
    '/v1/me/education-compass/state:',
    '/v1/education-compass/free-parent-assessments:',
    '/v1/students/{studentId}/education-assessments:',
    '/v1/assessments/{assessmentId}/draft:',
    '/v1/assessments/{assessmentId}/submit:',
    '/v1/assessments/{assessmentId}/result:',
    '/v1/assessments/{assessmentId}/orders:',
    '/v1/orders/{orderId}/wechat-prepay:',
    '/v1/me/integration-consents/feishu-profile:',
    '/v1/assessments/{assessmentId}/agent-analyses:',
    '/v1/assessments/{assessmentId}/agent-analyses/latest:',
    '/v1/reports/{reportId}/agent-analyses:',
    '/v1/reports/{reportId}/agent-analyses/latest:',
    '/v1/agent-analyses/{runId}:',
    '/v1/reports/{reportId}/agent-conversations:',
    '/v1/me/ai-analysis-consents/{studentId}:',
    '/v1/me/education-compass/consents/{studentId}/{scope}:',
    '/v1/me/integration-consents/advisor-contact:',
    '/v1/advisor-requests:',
    '/v1/me/advisor-requests:'
  ]) assert.ok(openapi.includes(`  ${route}`), `OpenAPI omitted ${route}`)
  assert.ok(openapi.includes('const: EDUCATION_GROWTH_DISCOVERY_SINGLE_V1'))
  assert.ok(openapi.includes('amountFen: { const: 3990 }'))
  assert.ok(openapi.includes('paymentTiming: { const: AFTER_SUBMIT_BEFORE_REPORT }'))
  for (const questionnaireVersion of [
    'free_parent_compass_v1.0.0-rc1',
    'education_growth_discovery_v1.0.0-rc1',
    'free_parent_compass_v1.1.0',
    'education_growth_discovery_v1.1.0'
  ]) assert.ok(openapi.includes(questionnaireVersion), `OpenAPI omitted supported questionnaire version ${questionnaireVersion}`)
  assert.ok(openapi.includes('enum: [free_parent_compass_v1.0.0-rc1, free_parent_compass_v1.1.0]'),
    'OpenAPI must preserve historical and current family snapshot questionnaire versions')
  assert.ok(openapi.includes('required: [consentVersion, scope, guardianConfirmed, studentConfirmed, locale]'),
    'OpenAPI must require the complete V0.5 AI_ANALYSIS consent payload')
  assert.ok(openapi.includes('consentVersion: { const: agent_analysis_opt_in_v1.0.0-rc1 }'))
  assert.ok(openapi.includes('scope: { const: AI_ANALYSIS }'))
  assert.ok(openapi.includes('copyVersion: { const: advisor_contact_opt_in_v1.0.0-rc1 }'))
  assert.ok(openapi.includes('enum: [CORE_ASSESSMENT, STUDENT_ASSESSMENT_ASSENT]'),
    'OpenAPI must restrict assessment consent withdrawal to the two approved scopes')
  assert.ok(openapi.includes('required: [scope, studentId, enabled, withdrawnAt, withdrawnGrantCount]'),
    'OpenAPI must expose the complete assessment consent withdrawal state')
  assert.match(openapi, /Order:\s+type: object\s+required:[\s\S]*?- reportId[\s\S]*?- expiresAt/,
    'Order schema must require reportId and expiresAt')

  const apiExamples = await readFile(path.join(root, 'docs', 'API_EXAMPLES_EDUCATION_COMPASS_V0.5.0.md'), 'utf8')
  for (const requiredExample of [
    'free_parent_compass_v1.1.0',
    'education_growth_discovery_v1.1.0',
    '"expiresAt": "2026-08-25T14:00:00.000Z"',
    '"consentVersion": "agent_analysis_opt_in_v1.0.0-rc1"',
    '"scope": "AI_ANALYSIS"',
    'DELETE /v1/me/ai-analysis-consents/{studentId}',
    'DELETE /v1/me/education-compass/consents/{studentId}/CORE_ASSESSMENT',
    'DELETE /v1/me/education-compass/consents/{studentId}/STUDENT_ASSESSMENT_ASSENT',
    '"withdrawnGrantCount": 1',
    'PUT /v1/me/integration-consents/advisor-contact',
    'POST /v1/advisor-requests',
    '"copyVersion": "advisor_contact_opt_in_v1.0.0-rc1"'
  ]) assert.ok(apiExamples.includes(requiredExample), `API examples omitted ${requiredExample}`)

  const operationIds = [...openapi.matchAll(/^\s+operationId:\s+(\S+)\s*$/gm)].map((match) => match[1])
  assert.ok(operationIds.length >= 30, 'OpenAPI operation coverage is unexpectedly small')
  assert.equal(new Set(operationIds).size, operationIds.length, 'OpenAPI operationId values must be unique')

  const names = (await readdir(examplesDirectory)).filter((name) => name.endsWith('.json'))
  for (const [name, expected] of expectedValid) {
    assert.ok(names.includes(name), `missing ${name}`)
    const fixture = JSON.parse(await readFile(path.join(examplesDirectory, name), 'utf8'))
    assert.ok(fixture.create && fixture.draft && fixture.submit, `${name} must cover create/draft/submit`)
    const result = validateQuestionnaireAnswers({
      level: expected.level,
      educationSystem: expected.educationSystem,
      answers: fixture.draft.body.answers,
      mode: 'SUBMIT',
      currentYear: 2026
    })
    assert.equal(result.canSubmit, true, `${name} is not a valid frozen-bank submission`)
    assert.deepEqual(result.missingRequiredQuestionIds, [], `${name} omitted required answers`)
  }
  for (const name of expectedInvalid) {
    assert.ok(names.includes(name), `missing ${name}`)
    const fixture = JSON.parse(await readFile(path.join(examplesDirectory, name), 'utf8'))
    assert.match(String(fixture.expectedErrorCode || ''), /^[A-Z][A-Z0-9_]+$/)
    assert.ok([400, 409, 422].includes(fixture.expectedStatus))
  }
  assert.equal(names.length, expectedValid.size + expectedInvalid.size, 'unexpected JSON example inventory')

  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    suite: 'education-docs',
    openapiOperations: operationIds.length,
    validExamples: expectedValid.size,
    invalidExamples: expectedInvalid.size
  })}\n`)
}

main().catch((error) => {
  process.stderr.write(`Education documentation verification failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
