'use strict'

const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { testDatabaseUrl, verifyConnection } = require('./ci/postgres-guard')

const databaseUrl = process.env.EDUCATION_TEST_DATABASE_URL || ''
const mutationApproved = process.env.EDUCATION_TEST_DATABASE_ALLOW_MUTATION === 'YES'

function blocked(reason) {
  process.stdout.write(`${JSON.stringify({ status: 'BLOCKED_EXTERNAL', suite: 'education-postgres', reason })}\n`)
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!databaseUrl) {
  blocked('EDUCATION_TEST_DATABASE_URL is not configured; no database connection was attempted')
  process.exit(0)
}
if (!mutationApproved) {
  blocked('EDUCATION_TEST_DATABASE_ALLOW_MUTATION=YES is required because migrations modify the dedicated test database')
  process.exit(0)
}

let parsed
try {
  parsed = new URL(databaseUrl)
} catch {
  process.stderr.write('EDUCATION_TEST_DATABASE_URL is not a valid URL\n')
  process.exit(2)
}
try {
  parsed = testDatabaseUrl(databaseUrl, 'Education migration database')
} catch (error) {
  process.stderr.write(error.message + '\n')
  process.exit(2)
}

async function main() {
  const { Pool } = require('../server/node_modules/pg')
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10000 })
  let security
  try { security = await verifyConnection(pool) } finally { await pool.end() }
  const npmCommand = process.platform === 'win32' ? process.execPath : 'npm'
  const prefix = process.platform === 'win32' ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : []
  run(npmCommand, [...prefix, '--prefix', 'server', 'run', 'build'])
  run(npmCommand, [...prefix, '--prefix', 'server', 'run', 'db:migrate'], { ...process.env, DATABASE_URL: databaseUrl })
  run(process.execPath, ['scripts/verify-education-postgres-schema.js'], { ...process.env, DATABASE_URL: databaseUrl })
  process.stdout.write(JSON.stringify({ ...security, suite: 'education-postgres-security', databaseConnectionAttempted: true }) + '\n')
}
main().catch(error => {
  process.stderr.write(JSON.stringify({ suite: 'education-postgres', status: 'FAIL', reason: 'Verified test database connection or migration failed', code: error.code || 'TEST_FAILURE' }) + '\n')
  process.exitCode = 1
})
