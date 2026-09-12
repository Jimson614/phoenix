'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const {
  buildArtifactAtomically, buildRelease, copyTree, DIST_ROOT, validateApiBaseUrl,
  validateMiniProgramArtifactBoundary, validateReleaseOutput
} = require('../scripts/build-release')
const { looksLikePlaceholder, sensitiveEnvKeys } = require('../scripts/scan-release-secrets')
const { npmInvocation, validateDedicatedDatabaseUrl } = require('../scripts/test-education-postgres')
const {
  cleanEnvironment, filesUnder: evidenceFilesUnder, migrationManifest, validateEvidenceRoot
} = require('../scripts/generate-education-evidence')
const { main: migrate, migrationBody } = require('../server/scripts/migrate')
const {
  filesUnder: recursiveFilesUnder, runServerTests, temporaryCompilerConfig
} = require('../scripts/run-server-tests')
const { runAllTests } = require('../scripts/run-all-tests')
const {
  buildDevelopment, validateDevelopmentApiBaseUrl
} = require('../scripts/build-development')

test('release API URL validation rejects credential-bearing and structurally unsafe URLs', () => {
  assert.equal(validateApiBaseUrl('https://api.example.invalid/base').hostname, 'api.example.invalid')
  for (const value of [
    'http://api.example.invalid',
    'https://release-user:release-password@api.example.invalid',
    'https://api.example.invalid?destination=other',
    'https://api.example.invalid#fragment',
    ' https://api.example.invalid'
  ]) assert.throws(() => validateApiBaseUrl(value), /PHOENIX_API_BASE_URL/)
})

test('development build URL validation accepts only an explicit IPv4 loopback origin', () => {
  assert.equal(validateDevelopmentApiBaseUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000')
  for (const value of [
    'https://127.0.0.1:3000',
    'http://localhost:3000',
    'http://1.12.77.180:3000',
    'http://127.0.0.1',
    'http://127.0.0.1:3000/api',
    'http://user@127.0.0.1:3000',
    'http://127.0.0.1:3000?target=other'
  ]) assert.throws(() => validateDevelopmentApiBaseUrl(value), /PHOENIX_DEVELOPMENT_API_BASE_URL/)
})

test('development build is remote-only, loopback-only and cannot run as trial or release', () => {
  fs.mkdirSync(DIST_ROOT, { recursive: true })
  const output = fs.mkdtempSync(path.join(DIST_ROOT, '.development-build-test-'))
  const originalWx = global.wx
  const sourceProjectConfigPath = path.join(root, 'project.config.json')
  const sourceProjectConfig = fs.readFileSync(sourceProjectConfigPath)
  try {
    buildDevelopment({ outputDirectory: output })
    assert.deepEqual(fs.readFileSync(sourceProjectConfigPath), sourceProjectConfig,
      'development build must not rewrite the repository project config')
    const project = JSON.parse(fs.readFileSync(path.join(output, 'project.config.json'), 'utf8'))
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'DEVELOPMENT_BUILD.json'), 'utf8'))
    assert.equal(project.setting.urlCheck, false)
    assert.equal(Object.hasOwn(project, 'miniprogramRoot'), false)
    assert.equal(Object.hasOwn(project, 'srcMiniprogramRoot'), false)
    assert.equal(Object.hasOwn(project, 'watchOptions'), false)
    assert.equal(manifest.artifactClass, 'LOCAL_DEVTOOLS_LOOPBACK_ONLY')
    assert.equal(manifest.uploadAuthorized, false)
    assert.equal(manifest.apiOrigin, 'http://127.0.0.1:3000')
    assert.equal(fs.existsSync(path.join(output, 'server')), false)
    assert.equal(fs.existsSync(path.join(output, 'pages', 'admin-families')), false)
    assert.equal(fs.existsSync(path.join(output, 'models', 'schema.js')), false)

    const runtimePath = path.join(output, 'config', 'runtime.js')
    global.wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }) }
    delete require.cache[require.resolve(runtimePath)]
    const runtime = require(runtimePath)
    assert.equal(runtime.apiBaseUrl(), 'http://127.0.0.1:3000')
    assert.equal(runtime.allowsDevelopmentLoopbackHttp(runtime.API_BASE_URL), true)
    global.wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'trial' } })
    assert.throws(() => runtime.apiBaseUrl(), (error) => error.code === 'DEVELOPMENT_BUILD_ENVIRONMENT_REQUIRED')
    assert.equal(runtime.allowsDevelopmentLoopbackHttp(runtime.API_BASE_URL), false)
  } finally {
    global.wx = originalWx
    fs.rmSync(output, { recursive: true, force: true })
  }
})

test('Mini Program artifact boundary rejects nested build, private and key material', () => {
  fs.mkdirSync(DIST_ROOT, { recursive: true })
  const output = fs.mkdtempSync(path.join(DIST_ROOT, '.artifact-boundary-test-'))
  try {
    const forbidden = [
      'assets/node_modules/package/index.js',
      'assets/.git/config',
      'assets/.next/static/build/_ssgManifest.js',
      'assets/server/private.js',
      'config/.env',
      'config/.env.local',
      'config/project.private.config.json',
      'assets/certificates/private.pem',
      'assets/certificates/private.key',
      'assets/certificates/id_ed25519',
      'assets/_buildManifest.js',
      'assets/app-build-manifest.json',
      'assets/images-manifest.json',
      'assets/page_client-reference-manifest.js',
      'assets/prerender-manifest.json',
      'assets/routes-manifest.json',
      'assets/server-reference-manifest.json',
      'assets/BUILD_ID'
    ]
    for (const relative of forbidden) {
      buildDevelopment({ outputDirectory: output })
      const target = path.join(output, ...relative.split('/'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, 'test-only artifact boundary sentinel')
      assert.throws(
        () => validateMiniProgramArtifactBoundary(output, 'DEVELOPMENT_BUILD.json'),
        /forbidden directory|private or key file|contains Next\.js output/,
        relative
      )
    }
  } finally {
    fs.rmSync(output, { recursive: true, force: true })
  }
})

test('Mini Program artifact boundary enforces top-level file and directory types', () => {
  fs.mkdirSync(DIST_ROOT, { recursive: true })
  const output = fs.mkdtempSync(path.join(DIST_ROOT, '.artifact-types-test-'))
  try {
    buildDevelopment({ outputDirectory: output })
    fs.rmSync(path.join(output, 'assets'), { recursive: true, force: true })
    fs.writeFileSync(path.join(output, 'assets'), 'not a directory')
    assert.throws(
      () => validateMiniProgramArtifactBoundary(output, 'DEVELOPMENT_BUILD.json'),
      /assets must be a directory/
    )

    buildDevelopment({ outputDirectory: output })
    fs.rmSync(path.join(output, 'app.js'), { force: true })
    fs.mkdirSync(path.join(output, 'app.js'))
    assert.throws(
      () => validateMiniProgramArtifactBoundary(output, 'DEVELOPMENT_BUILD.json'),
      /app\.js must be a file/
    )
  } finally {
    fs.rmSync(output, { recursive: true, force: true })
  }
})

function artifactTransactionEntries(parent, finalName) {
  const prefixes = [`.${finalName}.staging-`, `.${finalName}.backup-`]
  return fs.readdirSync(parent).filter((name) => prefixes.some((prefix) => name.startsWith(prefix)))
}

test('atomic artifact build preserves the previous output and cleans staging on build failure', () => {
  fs.mkdirSync(DIST_ROOT, { recursive: true })
  const holder = fs.mkdtempSync(path.join(DIST_ROOT, '.atomic-build-failure-test-'))
  const output = path.join(holder, 'development')
  fs.mkdirSync(output)
  fs.writeFileSync(path.join(output, 'previous.txt'), 'previous-valid-artifact')
  try {
    assert.throws(() => buildArtifactAtomically(output, (staging) => {
      fs.writeFileSync(path.join(staging, 'partial.txt'), 'incomplete-artifact')
      throw new Error('simulated staging build failure')
    }), /simulated staging build failure/)
    assert.equal(fs.readFileSync(path.join(output, 'previous.txt'), 'utf8'), 'previous-valid-artifact')
    assert.equal(fs.existsSync(path.join(output, 'partial.txt')), false)
    assert.deepEqual(artifactTransactionEntries(holder, 'development'), [])
  } finally {
    fs.rmSync(holder, { recursive: true, force: true })
  }
})

test('atomic artifact build restores the previous output when the publish rename fails', () => {
  fs.mkdirSync(DIST_ROOT, { recursive: true })
  const holder = fs.mkdtempSync(path.join(DIST_ROOT, '.atomic-publish-failure-test-'))
  const output = path.join(holder, 'development')
  fs.mkdirSync(output)
  fs.writeFileSync(path.join(output, 'previous.txt'), 'previous-valid-artifact')
  let publishBlocked = false
  try {
    assert.throws(() => buildArtifactAtomically(output, (staging) => {
      fs.writeFileSync(path.join(staging, 'replacement.txt'), 'replacement-artifact')
    }, {
      renameSync: (source, destination) => {
        if (!publishBlocked && path.basename(source).startsWith('.development.staging-') &&
          path.resolve(destination) === path.resolve(output)) {
          publishBlocked = true
          const error = new Error('simulated publish rename failure')
          error.code = 'EXDEV'
          throw error
        }
        fs.renameSync(source, destination)
      }
    }), /simulated publish rename failure/)
    assert.equal(publishBlocked, true)
    assert.equal(fs.readFileSync(path.join(output, 'previous.txt'), 'utf8'), 'previous-valid-artifact')
    assert.equal(fs.existsSync(path.join(output, 'replacement.txt')), false)
    assert.deepEqual(artifactTransactionEntries(holder, 'development'), [])
  } finally {
    fs.rmSync(holder, { recursive: true, force: true })
  }
})

test('atomic artifact build retries transient Windows rename failures without leaving transaction paths', () => {
  fs.mkdirSync(DIST_ROOT, { recursive: true })
  const holder = fs.mkdtempSync(path.join(DIST_ROOT, '.atomic-publish-retry-test-'))
  const output = path.join(holder, 'development')
  fs.mkdirSync(output)
  fs.writeFileSync(path.join(output, 'previous.txt'), 'previous-valid-artifact')
  let transientFailures = 0
  try {
    buildArtifactAtomically(output, (staging) => {
      fs.writeFileSync(path.join(staging, 'replacement.txt'), 'replacement-artifact')
    }, {
      renameSync: (source, destination) => {
        if (transientFailures < 2 && path.basename(source).startsWith('.development.staging-') &&
          path.resolve(destination) === path.resolve(output)) {
          transientFailures += 1
          const error = new Error('simulated transient Windows rename failure')
          error.code = 'EPERM'
          throw error
        }
        fs.renameSync(source, destination)
      },
      wait: () => {}
    })
    assert.equal(transientFailures, 2)
    assert.equal(fs.readFileSync(path.join(output, 'replacement.txt'), 'utf8'), 'replacement-artifact')
    assert.equal(fs.existsSync(path.join(output, 'previous.txt')), false)
    assert.deepEqual(artifactTransactionEntries(holder, 'development'), [])
  } finally {
    fs.rmSync(holder, { recursive: true, force: true })
  }
})

test('release copy rejects symbolic links instead of following them', (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-release-link-'))
  const target = path.join(temporary, 'target')
  const link = path.join(temporary, 'link')
  const destination = path.join(temporary, 'destination')
  fs.mkdirSync(target)
  fs.writeFileSync(path.join(target, 'outside.txt'), 'must not be copied')
  try {
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true })
    context.skip(`symbolic links are unavailable: ${error.code || error.message}`)
    return
  }
  try {
    assert.throws(() => copyTree(link, destination, 'assets/link'), /must not contain symbolic links/)
    assert.equal(fs.existsSync(destination), false)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test('release output rejects a dist child symlink that resolves outside dist', (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-release-output-'))
  const link = path.join(DIST_ROOT, '.outside-output-link-test')
  fs.mkdirSync(DIST_ROOT, { recursive: true })
  try {
    fs.symlinkSync(temporary, link, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true })
    context.skip(`symbolic links are unavailable: ${error.code || error.message}`)
    return
  }
  try {
    assert.throws(() => buildRelease({
      apiBaseUrl: 'https://api.example.invalid',
      appid: 'wx1234567890abcdef',
      outputDirectory: path.join(link, 'release')
    }), /release output must stay inside dist/)
    assert.deepEqual(fs.readdirSync(temporary), [])
  } finally {
    fs.unlinkSync(link)
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test('release rejects a dist root that is itself a symlink outside the source root', (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-release-dist-root-'))
  const source = path.join(temporary, 'source')
  const outside = path.join(temporary, 'outside')
  const distLink = path.join(source, 'dist')
  fs.mkdirSync(source)
  fs.mkdirSync(outside)
  try {
    fs.symlinkSync(outside, distLink, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true })
    context.skip(`symbolic links are unavailable: ${error.code || error.message}`)
    return
  }
  try {
    assert.throws(
      () => validateReleaseOutput(path.join(distLink, 'release'), distLink, source),
      /dist root must not be a symbolic link/
    )
  } finally {
    fs.unlinkSync(distLink)
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test('secret placeholder detection does not excuse arbitrary values containing placeholder words', () => {
  for (const value of ['', 'replace-with-random-material', '${SECRET_FROM_STORE}', '<secret>', '{}']) {
    assert.equal(looksLikePlaceholder(value), true, value)
  }
  for (const value of ['contest-production-credential', 'my-example-production-credential']) {
    assert.equal(looksLikePlaceholder(value), false, value)
  }
  for (const key of [
    'AI_CONTENT_KEYRING_JSON', 'FEISHU_BITABLE_APP_TOKEN', 'FEISHU_PSEUDONYM_KEY',
    'WECHATPAY_API_V3_KEY'
  ]) assert.equal(sensitiveEnvKeys.has(key), true, key)
})

test('evidence subprocess environment removes active credential names and disables providers', () => {
  const env = cleanEnvironment({
    AI_CONTENT_KEYRING_JSON: 'sensitive-keyring-material',
    FEISHU_BITABLE_APP_TOKEN: 'sensitive-bitable-token',
    WECHATPAY_API_V3_KEY: 'sensitive-payment-key',
    PAYMENT_PROVIDER: 'wechat',
    AGENT_PROVIDER: 'openai',
    FEISHU_BITABLE_ENABLED: 'true'
  })
  for (const key of ['AI_CONTENT_KEYRING_JSON', 'FEISHU_BITABLE_APP_TOKEN', 'WECHATPAY_API_V3_KEY']) {
    assert.equal(Object.hasOwn(env, key), false, key)
  }
  assert.equal(env.PAYMENT_PROVIDER, 'mock')
  assert.equal(env.AGENT_PROVIDER, 'mock')
  assert.equal(env.FEISHU_BITABLE_ENABLED, 'false')
})

test('PostgreSQL mutation guard requires a standalone dedicated-test marker', () => {
  for (const value of [
    'postgres://localhost/education_test',
    'postgresql://localhost/education-ci-01',
    'postgres://localhost/phoenix_v05_verification'
  ]) assert.doesNotThrow(() => validateDedicatedDatabaseUrl(value))
  for (const value of [
    'postgres://localhost/contestprod',
    'postgres://localhost/latest_production',
    'mysql://localhost/education_test'
  ]) assert.throws(() => validateDedicatedDatabaseUrl(value))
})

test('Windows npm invocation uses node instead of spawning npm.cmd directly', () => {
  const invocation = npmInvocation()
  if (process.platform === 'win32') {
    assert.equal(invocation.command, process.execPath)
    assert.match(invocation.argsPrefix[0], /npm-cli\.js$/)
  } else {
    assert.deepEqual(invocation, { command: 'npm', argsPrefix: [] })
  }
})

test('migration pool is closed even when initial connection fails', async () => {
  let ended = 0
  const failure = new Error('simulated connection failure')
  const pool = {
    connect: async () => { throw failure },
    end: async () => { ended += 1 }
  }
  await assert.rejects(() => migrate(pool), failure)
  assert.equal(ended, 1)
})

test('server test runner uses an external temporary compiler configuration and always cleans it', () => {
  let temporaryConfigPath = ''
  const status = runServerTests({
    run: (_command, args) => {
      temporaryConfigPath = args[args.indexOf('-p') + 1]
      return 17
    }
  })
  assert.equal(status, 17)
  assert.match(temporaryConfigPath, new RegExp(`^${path.join(root, 'server').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.equal(fs.existsSync(path.dirname(temporaryConfigPath)), false)
})

test('temporary server compiler config includes source and tests without changing project config', () => {
  const output = path.join(os.tmpdir(), 'phoenix-server-test-output')
  const config = temporaryCompilerConfig(output)
  assert.equal(config.compilerOptions.rootDir, serverRootForTest())
  assert.equal(config.compilerOptions.outDir, slashForTest(output))
  assert(config.files.some((file) => file.endsWith('/server/src/index.ts')))
  assert(config.files.some((file) => file.endsWith('/server/tests/domain.test.ts')))
})

test('portable project test runner stops at the first failed stage', () => {
  const calls = []
  const statuses = [0, 0, 23, 0, 0]
  const status = runAllTests({
    run: (command, args) => {
      calls.push([command, args])
      return statuses.shift()
    }
  })
  assert.equal(status, 23)
  assert.equal(calls.length, 3)
})

test('package scripts use portable server tests and compiled worker paths', () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const serverPackage = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8'))
  assert.equal(rootPackage.scripts['test:all'], 'node scripts/run-all-tests.js')
  assert.equal(rootPackage.scripts['build:development'], 'node scripts/build-development.js')
  assert.match(rootPackage.scripts.dev, /-p 3003$/)
  assert.match(rootPackage.scripts.start, /-p 3003$/)
  assert.equal(serverPackage.scripts.test, 'node ../scripts/run-server-tests.js')
  assert.equal(serverPackage.scripts['start:agent-worker'], 'node dist/services/agent-worker-main.js')
  assert.equal(serverPackage.scripts['agent:worker:once'], 'node dist/services/agent-worker-main.js --once')
})

test('Next route extensions cannot overlap with Mini Program page sources', () => {
  const miniProgramPages = path.join(root, 'pages')
  const conflicting = [
    ...recursiveFilesUnder(miniProgramPages, '.ts'),
    ...recursiveFilesUnder(miniProgramPages, '.tsx')
  ]
  assert.deepEqual(conflicting, [],
    'Mini Program pages must remain JavaScript while Next pageExtensions are ts/tsx')
})

function slashForTest(value) {
  return String(value).split(path.sep).join('/')
}

function serverRootForTest() {
  return slashForTest(path.join(root, 'server'))
}

test('migration transaction wrapper is removed without changing its statements', () => {
  assert.equal(migrationBody('BEGIN;\nSELECT 1;\nCOMMIT;'), 'SELECT 1;')
})

test('evidence integrity baseline covers every immutable existing migration', async () => {
  const manifest = await migrationManifest(new Date(0).toISOString(), 'test-source-digest')
  assert.equal(manifest.migrations.length, 5)
  assert.equal(manifest.historicalMigrationsUnchanged, true)
  assert(manifest.migrations.every((item) => item.historicalBaselineMatch === true))
})

test('education evidence rejects an output root symlink outside the source root', (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-evidence-root-'))
  const source = path.join(temporary, 'source')
  const outside = path.join(temporary, 'outside')
  const evidenceLink = path.join(source, 'verification')
  fs.mkdirSync(source)
  fs.mkdirSync(outside)
  try {
    fs.symlinkSync(outside, evidenceLink, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true })
    context.skip(`symbolic links are unavailable: ${error.code || error.message}`)
    return
  }
  try {
    assert.throws(() => validateEvidenceRoot(evidenceLink, source), /must not be a symbolic link/)
  } finally {
    fs.unlinkSync(evidenceLink)
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test('education source manifest rejects non-excluded symbolic links', async (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-evidence-source-'))
  const target = path.join(temporary, 'target')
  const link = path.join(temporary, 'linked-source')
  fs.mkdirSync(target)
  try {
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true })
    context.skip(`symbolic links are unavailable: ${error.code || error.message}`)
    return
  }
  try {
    await assert.rejects(() => evidenceFilesUnder(temporary), /must not be a symbolic link/)
  } finally {
    fs.unlinkSync(link)
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test('UI evidence rejects empty or project-root output before running commands', () => {
  for (const argument of ['--output=', '--output=.', '--output=pages']) {
    const result = spawnSync(process.execPath, ['scripts/generate-ui-review-evidence.js', argument], {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      windowsHide: true
    })
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /output must|output must be a child directory/i)
  }
})
