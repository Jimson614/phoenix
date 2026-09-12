'use strict'

const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')
const { testDatabaseUrl, applicationDatabaseUrl } = require('./ci/postgres-guard')

const projectRoot = path.resolve(__dirname, '..')
const databaseUrl = process.env.MASTERS_TEST_DATABASE_URL || ''
const mutationApproved = process.env.MASTERS_TEST_DATABASE_ALLOW_MUTATION === 'YES'
const applicationUrl = process.env.MASTERS_TEST_APP_DATABASE_URL || ''
const migrationPath = path.join(projectRoot, 'server', 'migrations', '006_masters_intake.sql')

function blocked(reason) {
  process.stdout.write(`${JSON.stringify({
    status: 'BLOCKED_EXTERNAL',
    suite: 'masters-postgres',
    databaseConnectionAttempted: false,
    reason
  })}\n`)
}

function fail(reason) {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', suite: 'masters-postgres', reason })}\n`)
  process.exitCode = 2
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env,
    shell: false,
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function npmInvocation() {
  if (process.platform !== 'win32') return { command: 'npm', prefix: [] }
  // Windows spawnSync does not reliably execute npm.cmd with shell=false.
  return {
    command: process.execPath,
    prefix: [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  }
}

if (!databaseUrl) {
  blocked('MASTERS_TEST_DATABASE_URL is not configured; no database connection was attempted')
  process.exit(0)
}

if (!mutationApproved) {
  blocked('MASTERS_TEST_DATABASE_ALLOW_MUTATION=YES is required because the isolated schema is created and dropped')
  process.exit(0)
}

if (!applicationUrl) {
  blocked('MASTERS_TEST_APP_DATABASE_URL is required for the separate DML-only HTTP application role')
  process.exit(0)
}

try {
  applicationDatabaseUrl(testDatabaseUrl(databaseUrl, 'Masters migration database'), applicationUrl)
} catch (error) {
  fail(error.message)
  process.exit(2)
}

let parsed
try {
  parsed = new URL(databaseUrl)
} catch {
  fail('MASTERS_TEST_DATABASE_URL is not a valid URL')
  process.exit(2)
}

if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
  fail('MASTERS_TEST_DATABASE_URL must use postgres:// or postgresql:// with a hostname')
  process.exit(2)
}

let databaseName
try {
  databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
} catch {
  fail('MASTERS_TEST_DATABASE_URL contains an invalid database path')
  process.exit(2)
}

// A mutation-capable run must be pointed at a clearly disposable database.
// Delimit the sentinel so names such as "contest" cannot pass accidentally.
if (!/(^|[-_])(test|testing|ci|sandbox)([-_]|$)/i.test(databaseName)) {
  fail('Refusing mutation: database name must contain a delimited test, testing, ci, or sandbox sentinel')
  process.exit(2)
}

if (!existsSync(migrationPath)) {
  fail('006_masters_intake.sql is required before the PostgreSQL Masters suite can run')
  process.exit(2)
}

const npm = npmInvocation()
// Do not let an unrelated application DATABASE_URL become a connection input
// to this suite. The test itself only reads MASTERS_TEST_DATABASE_URL.
const childEnv = { ...process.env, DATABASE_URL: '' }
run(npm.command, [...npm.prefix, '--prefix', 'server', 'run', 'build'], childEnv)
run(process.execPath, ['--test', path.join('server', 'dist', 'tests', 'masters-postgres.test.js')], childEnv)
