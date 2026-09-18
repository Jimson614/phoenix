'use strict'

const { spawnSync } = require('node:child_process')
const path = require('node:path')

function blocked(reason) {
  process.stdout.write(`${JSON.stringify({ status: 'BLOCKED_EXTERNAL', suite: 'education-postgres', reason })}\n`)
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function validateDedicatedDatabaseUrl(databaseUrl) {
  let parsed
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error('EDUCATION_TEST_DATABASE_URL is not a valid URL')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('EDUCATION_TEST_DATABASE_URL must use postgres:// or postgresql://')
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  const sentinel = /(?:^|[._-])(?:test|testing|ci|sandbox)(?:[._-]|$)|^phoenix_v05_verification$/i
  if (!sentinel.test(databaseName)) {
    throw new Error('Refusing mutation: dedicated database name must contain a standalone test, testing, ci, or sandbox marker, or equal phoenix_v05_verification')
  }
  return parsed
}

function npmInvocation() {
  if (process.platform !== 'win32') return { command: 'npm', argsPrefix: [] }
  return {
    command: process.execPath,
    argsPrefix: [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  }
}

function main() {
  const databaseUrl = process.env.EDUCATION_TEST_DATABASE_URL || ''
  const mutationApproved = process.env.EDUCATION_TEST_DATABASE_ALLOW_MUTATION === 'YES'
  if (!databaseUrl) {
    blocked('EDUCATION_TEST_DATABASE_URL is not configured; no database connection was attempted')
    return
  }
  if (!mutationApproved) {
    blocked('EDUCATION_TEST_DATABASE_ALLOW_MUTATION=YES is required because migrations modify the dedicated test database')
    return
  }
  try {
    validateDedicatedDatabaseUrl(databaseUrl)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
    return
  }

  const npm = npmInvocation()
  run(npm.command, [...npm.argsPrefix, '--prefix', 'server', 'run', 'build'])
  run(npm.command, [...npm.argsPrefix, '--prefix', 'server', 'run', 'db:migrate'], {
    ...process.env, DATABASE_URL: databaseUrl
  })
  run(process.execPath, ['scripts/verify-education-postgres-schema.js'], {
    ...process.env,
    DATABASE_URL: databaseUrl
  })
}

if (require.main === module) main()

module.exports = { main, npmInvocation, validateDedicatedDatabaseUrl }
