'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const projectRoot = path.resolve(__dirname, '..')
const scriptPath = path.join(projectRoot, 'scripts', 'check-masters-test-environment.js')
const docsPath = path.join(projectRoot, 'docs', 'MASTERS_JIMSON_TEST_ENV.md')
const { collectChecks } = require(scriptPath)

function mapChecks(result) {
  return new Map(result.checks.map((item) => [item.name, item]))
}

function completeShapeEnvironment(storageDirectory, fontPath) {
  return {
    NODE_ENV: 'test',
    MASTERS_INTAKE_ENABLED: 'true',
    MASTERS_WORKER_ENABLED: 'true',
    MASTERS_AI_ENABLED: 'false',
    MASTERS_TEST_DATABASE_URL: 'postgresql://runner:runner-secret@db.example.invalid:5432/masters_test?sslmode=verify-full',
    MASTERS_TEST_APP_DATABASE_URL: 'postgresql://application:application-secret@db.example.invalid:5432/masters_test?sslmode=verify-full',
    MASTERS_TEST_DATABASE_ALLOW_MUTATION: 'YES',
    DATABASE_URL: 'postgresql://application:application-secret@db.example.invalid:5432/masters_test?sslmode=verify-full',
    EDUCATION_TEST_DATABASE_URL: 'postgresql://legacy:legacy-secret@db.example.invalid:5432/education_test?sslmode=verify-full',
    EDUCATION_TEST_DATABASE_ALLOW_MUTATION: 'YES',
    SESSION_SECRET: 'isolated-session-secret-that-is-long-enough',
    MASTERS_PRIVATE_STORAGE_DIR: storageDirectory,
    MASTERS_RETENTION_DAYS: '30',
    MASTERS_PDF_FONT_PATH: fontPath,
    WECHAT_APP_ID: 'wx1234567890abcdef',
    WECHAT_APP_SECRET: 'wechat-app-secret-never-print',
    PUBLIC_BASE_URL: 'https://masters-test.example.invalid/',
    PHOENIX_API_BASE_URL: 'https://masters-test.example.invalid',
    PHOENIX_MINIPROGRAM_APPID: 'wx1234567890abcdef'
  }
}

test('preflight is fail-closed and reports no external connection or write', () => {
  const result = collectChecks({ NODE_ENV: 'test' }, { projectRoot })
  assert.equal(result.status, 'BLOCKED_EXTERNAL')
  assert.ok(result.blockedExternal > 0)
  assert.equal(result.databaseConnectionAttempted, false)
  assert.equal(result.remoteCallsAttempted, false)
  assert.equal(result.writesAttempted, false)
  for (const item of result.checks) assert.ok(['CONFIG_PRESENT', 'BLOCKED_EXTERNAL'].includes(item.status))
  assert.equal(mapChecks(result).get('MASTERS_AI_ENABLED=false').status, 'CONFIG_PRESENT')
  assert.equal(mapChecks(result).get('MASTERS_TEST_DATABASE_URL').status, 'BLOCKED_EXTERNAL')
})

test('configured shape is visible without exposing secrets, URLs, or private paths', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'masters-env-preflight-'))
  const storage = path.join(temporaryRoot, 'private-materials')
  const font = path.join(temporaryRoot, 'synthetic-font.ttf')
  fs.mkdirSync(storage)
  fs.writeFileSync(font, 'synthetic font marker')
  try {
    const env = completeShapeEnvironment(storage, font)
    const result = collectChecks(env, { projectRoot })
    const checks = mapChecks(result)
    for (const name of [
      'NODE_ENV=test',
      'MASTERS_INTAKE_ENABLED=true',
      'MASTERS_WORKER_ENABLED=true',
      'MASTERS_AI_ENABLED=false',
      'MASTERS_TEST_DATABASE_URL',
      'MASTERS_TEST_APP_DATABASE_URL (DML role)',
      'MASTERS_TEST_DATABASE_ALLOW_MUTATION=YES',
      'DATABASE_URL (HTTP runtime)',
      'HTTP/test database isolation',
      'EDUCATION_TEST_DATABASE_URL (legacy baseline)',
      'EDUCATION_TEST_DATABASE_ALLOW_MUTATION=YES',
      'SESSION_SECRET',
      'MASTERS_PRIVATE_STORAGE_DIR',
      'MASTERS_RETENTION_DAYS',
      'MASTERS_PDF_FONT_PATH',
      'MASTERS_DEVELOPMENT_STORE_PATH (FileStore fallback)',
      'WECHAT_APP_ID',
      'WECHAT_APP_SECRET',
      'PUBLIC_BASE_URL',
      'PHOENIX_API_BASE_URL + PHOENIX_MINIPROGRAM_APPID',
      'project.config.json shape'
    ]) assert.equal(checks.get(name).status, 'CONFIG_PRESENT', name)

    const serialized = JSON.stringify(result)
    for (const forbidden of [
      'runner-secret', 'application-secret', 'legacy-secret', 'wechat-app-secret-never-print',
      'db.example.invalid', 'masters_test.example.invalid', temporaryRoot
    ]) assert.equal(serialized.includes(forbidden), false, `preflight leaked ${forbidden}`)
    assert.equal(result.databaseConnectionAttempted, false)
    assert.equal(result.remoteCallsAttempted, false)
    assert.equal(result.writesAttempted, false)
    assert.equal(result.status, 'BLOCKED_EXTERNAL', 'configuration presence must not become end-to-end PASS')
    for (const name of [
      'dedicated database least-privilege evidence',
      'database plus private-file backup/restore evidence',
      'private storage ACL and retention evidence',
      'real code2Session and WeChat session evidence',
      'WeChat DevTools evidence',
      'iOS device evidence',
      'Android device evidence'
    ]) assert.equal(checks.get(name).status, 'BLOCKED_EXTERNAL', name)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('production, insecure database, AI, and in-repository storage remain blocked', () => {
  const result = collectChecks({
    NODE_ENV: 'production',
    MASTERS_INTAKE_ENABLED: 'true',
    MASTERS_AI_ENABLED: 'true',
    MASTERS_TEST_DATABASE_URL: 'postgres://u:p@db.invalid/masters_test',
    MASTERS_TEST_DATABASE_ALLOW_MUTATION: 'YES',
    DATABASE_URL: 'postgres://u:p@db.invalid/masters_test',
    MASTERS_PRIVATE_STORAGE_DIR: path.join(projectRoot, 'server'),
    WECHAT_APP_SECRET: 'secret-value-must-not-appear'
  }, { projectRoot })
  const checks = mapChecks(result)
  for (const name of [
    'NODE_ENV=test',
    'MASTERS_INTAKE_ENABLED=true',
    'MASTERS_AI_ENABLED=false',
    'MASTERS_TEST_DATABASE_URL',
    'DATABASE_URL (HTTP runtime)',
    'MASTERS_PRIVATE_STORAGE_DIR'
  ]) assert.equal(checks.get(name).status, 'BLOCKED_EXTERNAL', name)
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes('secret-value-must-not-appear'), false)
  assert.equal(serialized.includes('db.invalid'), false)
  assert.equal(result.status, 'BLOCKED_EXTERNAL')
})

test('CLI emits machine-readable statuses and no inherited secret values', () => {
  const secret = 'cli-secret-must-never-be-printed'
  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MASTERS_INTAKE_ENABLED: 'true',
      MASTERS_AI_ENABLED: 'true',
      WECHAT_APP_SECRET: secret,
      DATABASE_URL: 'postgresql://user:password@db.invalid/masters_test?sslmode=verify-full'
    }
  })
  assert.equal(child.status, 0)
  assert.equal(child.stderr, '')
  const result = JSON.parse(child.stdout)
  assert.equal(result.status, 'BLOCKED_EXTERNAL')
  assert.equal(result.databaseConnectionAttempted, false)
  assert.equal(result.remoteCallsAttempted, false)
  assert.equal(result.writesAttempted, false)
  assert.equal(child.stdout.includes(secret), false)
  assert.equal(child.stdout.includes('db.invalid'), false)
  for (const item of result.checks) assert.ok(['CONFIG_PRESENT', 'BLOCKED_EXTERNAL'].includes(item.status))
})

test('Jimson handoff document distinguishes config presence, PostgreSQL, WeChat, and report boundaries', () => {
  const source = fs.readFileSync(docsPath, 'utf8')
  for (const phrase of [
    'MASTERS_TEST_DATABASE_URL', 'DATABASE_URL', 'EDUCATION_TEST_DATABASE_URL',
    'WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'PHOENIX_API_BASE_URL', 'PHOENIX_MINIPROGRAM_APPID',
    'MASTERS_PRIVATE_STORAGE_DIR', 'MASTERS_RETENTION_DAYS', 'MASTERS_PDF_FONT_PATH',
    'FileStore 不等于 PostgreSQL', '网页不等于微信', 'code2Session', 'sslmode=verify-full',
    '数据库与附件的加密备份/干净目标恢复', '规则草稿', '顾问核验后的完整方案', 'AUTO_SCHOOL_MATCHING',
    '微信开发者工具', 'iOS 真机', 'Android 真机', 'Founder 和运营人员不需要'
  ]) assert.ok(source.includes(phrase), `handoff doc missing ${phrase}`)
  assert.equal(source.includes('runner-secret'), false)
  assert.equal(source.includes('wechat-app-secret-never-print'), false)
})
