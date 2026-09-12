const assert = require('node:assert/strict')
const {
  automationGate,
  browserProof,
  classifyResult,
  educationPostgresProof,
  mastersPostgresProof,
  reportAssistedMarker,
  sanitized
} = require('../scripts/verify-masters-candidate')

const mastersPass = JSON.stringify({
  status: 'PASS',
  suite: 'masters-postgres',
  databaseConnectionAttempted: true,
  httpFlow: 'PASS',
  tlsVerifyFull: 'PASS',
  applicationRoleIsolation: 'PASS',
  isolatedBackupRestore: 'PASS'
})
const educationPass = [
  JSON.stringify({ status: 'PASS', suite: 'education-postgres-schema', externalSideEffects: 'migration-only' }),
  JSON.stringify({ status: 'PASS', suite: 'education-postgres-security', tlsVerifyFull: 'PASS' })
].join('\n')
const browserPass = JSON.stringify({
  status: 'PASS',
  suite: 'masters-workbench-browser',
  realHttp: true,
  cases: ['seven-categories', 'assisted-plan-classification']
})

// PostgreSQL requires all semantic proof fields. Exit 0 by itself is not
// evidence and the old, weaker shape must remain blocked.
assert.equal(classifyResult('masters-postgres', 0, '{"status":"BLOCKED_EXTERNAL"}'), 'BLOCKED_EXTERNAL')
assert.equal(classifyResult('masters-postgres', 0, 'ℹ skipped 1'), 'BLOCKED_EXTERNAL')
assert.equal(classifyResult('masters-postgres', 0, '{"status":"PASS","suite":"masters-postgres","databaseConnectionAttempted":true,"httpFlow":"PASS"}'), 'BLOCKED_EXTERNAL')
assert.equal(classifyResult('masters-postgres', 0, mastersPass), 'PASS')
assert.equal(classifyResult('masters-postgres', 1, mastersPass), 'FAIL')
assert.deepEqual(mastersPostgresProof(JSON.parse(`[${mastersPass}]`)), JSON.parse(mastersPass))

// Education's legacy schema result needs a separate TLS wrapper proof.
assert.equal(classifyResult('education-postgres', 0, JSON.stringify({ status: 'PASS', suite: 'education-postgres-schema' })), 'BLOCKED_EXTERNAL')
assert.equal(classifyResult('education-postgres', 0, educationPass), 'PASS')
assert.ok(educationPostgresProof(educationPass.split('\n').map(line => JSON.parse(line))))

// Browser evidence must describe the real HTTP workbench and the known
// assisted-plan case; an arbitrary successful JSON line is insufficient.
assert.equal(classifyResult('workbench-browser', 0, JSON.stringify({ status: 'PASS', suite: 'masters-workbench-browser' })), 'BLOCKED_EXTERNAL')
assert.equal(classifyResult('workbench-browser', 0, browserPass), 'PASS')
assert.ok(browserProof([JSON.parse(browserPass)]))

assert.equal(classifyResult('all-regression', 0, 'ℹ skipped 0\nℹ fail 0'), 'PASS')
assert.equal(classifyResult('all-regression', 0, 'ℹ skipped 2'), 'BLOCKED_EXTERNAL')
assert.equal(classifyResult('environment', 2, '{"status":"BLOCKED_EXTERNAL","suite":"masters-test-environment-preflight"}'), 'BLOCKED_EXTERNAL')
assert.equal(classifyResult('release-build', 0, 'OFFLINE_TEST_ONLY'), 'OFFLINE_TEST_ONLY')
assert.equal(reportAssistedMarker('ok 12 - sourced assisted plan binds cited program'), 'PASS')
assert.equal(reportAssistedMarker('ok 12 - unrelated regression'), 'NOT_VERIFIED')

const passingResults = [
  { suite: 'all-regression', status: 'PASS', reportAssisted: 'PASS' },
  { suite: 'workbench-browser', status: 'PASS' },
  { suite: 'release-contract', status: 'PASS' },
  { suite: 'secret-scan', status: 'PASS' },
  { suite: 'education-postgres', status: 'PASS' },
  { suite: 'masters-postgres', status: 'PASS' },
  { suite: 'release-build', status: 'OFFLINE_TEST_ONLY' },
  { suite: 'environment', status: 'CONFIGURATION_CHECK_ONLY' }
]
assert.equal(automationGate(passingResults).status, 'PASS')
assert.equal(automationGate(passingResults.filter(item => item.suite !== 'masters-postgres')).status, 'BLOCKED_EXTERNAL')
assert.equal(automationGate(passingResults.map(item => item.suite === 'secret-scan' ? { ...item, status: 'FAIL' } : item)).status, 'FAIL')

assert.equal(sanitized('synthetic-database-value', { MASTERS_TEST_DATABASE_URL: 'synthetic-database-value' }), '[REDACTED]')
assert.equal(sanitized('postgresql://app:secret@localhost/masters_ci_test?sslmode=verify-full', {}), '[REDACTED_POSTGRES_URL]')
assert.equal(sanitized('password=decoded-secret', { MASTERS_TEST_DATABASE_URL: 'postgresql://app:decoded%2Dsecret@localhost/masters_ci_test' }), 'password=[REDACTED]')
assert.equal(sanitized('Authorization: Bearer abc.def.ghi', {}), 'Authorization: [REDACTED_AUTHORIZATION]')

console.log('✓ candidate evidence: strict PostgreSQL/TLS/role/restore and real-browser proofs are required; automation gate rejects missing or blocked evidence')
