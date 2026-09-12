'use strict'

// Candidate-bound evidence runner.
//
// The default invocation is deliberately local-only: it records all results,
// but cannot clear the target-host or real-WeChat gates. GitHub's isolated
// PostgreSQL wrapper invokes this file with --automation-only. That mode has
// a separate, strict automation gate and never turns a skipped or unavailable
// external check into a pass.

const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '..')
const REQUEST_HEAD_SHA = '1eb1e019be997adfa2ccb2d6d454416e91c130e8'
const AUTOMATION_MODE = '--automation-only'
const REQUIRED_AUTOMATION_SUITES = [
  'all-regression',
  'workbench-browser',
  'release-contract',
  'secret-scan',
  'education-postgres',
  'masters-postgres',
  'release-build'
]

function jsonLines(text) {
  return String(text || '').split(/\r?\n/).flatMap(line => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
}

function isPass(value) {
  return value === 'PASS' || value === true
}

function hasFailureOutput(output) {
  return /(?:^|\n)(?:ℹ |# )?fail\s+[1-9]\d*/i.test(output) ||
    /(?:^|\n)(?:not ok|FAIL(?:URE)?\b)/i.test(output)
}

function hasSkipOutput(output) {
  return /(?:^|\n)(?:ℹ |# )?skipped?\s+[1-9]\d*/i.test(output) ||
    /#\s+SKIP\b/i.test(output)
}

function mastersPostgresProof(entries) {
  return entries.find(item => item && item.suite === 'masters-postgres' &&
    item.status === 'PASS' &&
    item.databaseConnectionAttempted === true &&
    item.httpFlow === 'PASS' &&
    isPass(item.tlsVerifyFull) &&
    isPass(item.applicationRoleIsolation) &&
    isPass(item.isolatedBackupRestore)) || null
}

function educationPostgresProof(entries) {
  const schema = entries.find(item => item && item.suite === 'education-postgres-schema' && item.status === 'PASS')
  if (!schema) return null

  // The schema verifier is intentionally a read-only legacy verifier. TLS
  // and role evidence is emitted by the wrapper/provisioner, so require both
  // records before treating Education PostgreSQL as a real automation pass.
  const tls = isPass(schema.tlsVerifyFull) || entries.some(item => item &&
    ['education-postgres-security', 'education-postgres', 'isolated-postgres-provision'].includes(item.suite) &&
    item.status === 'PASS' && isPass(item.tlsVerifyFull))
  return tls ? schema : null
}

function browserProof(entries) {
  return entries.find(item => item && item.suite === 'masters-workbench-browser' &&
    item.status === 'PASS' &&
    item.realHttp === true &&
    Array.isArray(item.cases) &&
    item.cases.includes('assisted-plan-classification')) || null
}

function reportAssistedStatus(results) {
  const all = results.find(item => item.suite === 'all-regression')
  if (all && all.reportAssisted === 'PASS') return 'PASS'
  const browser = results.find(item => item.suite === 'workbench-browser')
  if (browser && browser.reportAssisted === 'PASS') return 'PASS'
  return 'BLOCKED_EXTERNAL'
}

/**
 * Classify one command without trusting its exit code alone.
 *
 * In particular, the two PostgreSQL wrappers intentionally return exit 0 for
 * a missing external database. That state remains BLOCKED_EXTERNAL here.
 */
function classifyResult(name, exitCode, output) {
  const text = String(output || '')
  const entries = jsonLines(text)
  const skipped = hasSkipOutput(text)
  const blocked = entries.some(item => item && item.status === 'BLOCKED_EXTERNAL') || /BLOCKED_EXTERNAL/.test(text)

  // The environment preflight is a read-only external configuration report;
  // it can use a non-zero exit to signal an expected blocked handoff. Keep
  // that distinct from a failing automated test.
  if (name === 'environment' && blocked) return 'BLOCKED_EXTERNAL'
  if (exitCode !== 0 || hasFailureOutput(text)) return 'FAIL'
  if (blocked || skipped) return 'BLOCKED_EXTERNAL'

  if (name === 'masters-postgres') {
    return mastersPostgresProof(entries) ? 'PASS' : 'BLOCKED_EXTERNAL'
  }
  if (name === 'education-postgres') {
    return educationPostgresProof(entries) ? 'PASS' : 'BLOCKED_EXTERNAL'
  }
  if (name === 'workbench-browser') {
    return browserProof(entries) ? 'PASS' : 'BLOCKED_EXTERNAL'
  }
  if (name === 'release-build') return /OFFLINE_TEST_ONLY/.test(text) ? 'OFFLINE_TEST_ONLY' : 'FAIL'
  if (name === 'environment') return 'CONFIGURATION_CHECK_ONLY'
  return 'PASS'
}

function reportAssistedMarker(output) {
  const text = String(output || '')
  const entries = jsonLines(text)
  if (entries.some(item => item && (item.reportAssisted === 'PASS' || item.sourcedAssistedPlan === 'PASS'))) return 'PASS'
  // This is the existing, named regression case. Keep the marker narrow so
  // an unrelated successful test cannot satisfy the report evidence.
  return /(?:^|\n)(?:[✔✓]|ok\s+\d+\s+-).*sourced assisted plan binds/i.test(text)
    ? 'PASS'
    : 'NOT_VERIFIED'
}

function sanitizeSensitiveUri(text) {
  return text.replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, '[REDACTED_POSTGRES_URL]')
}

function sanitized(text, env = process.env) {
  let result = String(text || '')
  const sensitive = Object.entries(env || {})
    .filter(([key, value]) => typeof value === 'string' && value.length >= 6 &&
      /(?:SECRET|TOKEN|PASSWORD|DATABASE_URL|PRIVATE_STORAGE_DIR|(?:^|_)KEY$|_FONT_PATH$|APP_SECRET)/i.test(key))
    .flatMap(([key, value]) => {
      const values = [value]
      if (/DATABASE_URL/i.test(key)) {
        try {
          const parsed = new URL(value)
          for (const candidate of [parsed.username, parsed.password]) {
            if (candidate) values.push(decodeURIComponent(candidate))
          }
        } catch { /* the regular URI redactor handles malformed values */ }
      }
      return values.filter(candidate => candidate.length >= 6)
    })
    .sort((a, b) => b.length - a.length)
  for (const value of sensitive) result = result.split(value).join('[REDACTED]')

  result = sanitizeSensitiveUri(result)
  result = result.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[REDACTED_AUTHORIZATION]')
  result = result.replace(/((?:password|passwd|secret|token|authorization|session[_-]?secret)\s*[=:]\s*)(?!\[)[^\s,;}\]]+/gi, '$1[REDACTED]')
  // Do not let a connection-string query parameter leak if a tool has split
  // the URI across punctuation before it reaches the URI redactor.
  result = result.replace(/([?&](?:password|passfile|sslkey|sslcert|sslrootcert|token)=)[^&\s]+/gi, '$1[REDACTED]')
  return result
}

function npmCommand(args) {
  if (process.platform !== 'win32') return { executable: 'npm', args }
  return {
    executable: process.execPath,
    args: [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args]
  }
}

function ciMetadata(env = process.env) {
  const runId = typeof env.GITHUB_RUN_ID === 'string' && /^\d+$/.test(env.GITHUB_RUN_ID)
    ? env.GITHUB_RUN_ID
    : null
  const server = typeof env.GITHUB_SERVER_URL === 'string' && /^https:\/\/[^\s/]+$/.test(env.GITHUB_SERVER_URL)
    ? env.GITHUB_SERVER_URL
    : null
  const repository = typeof env.GITHUB_REPOSITORY === 'string' && /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY)
    ? env.GITHUB_REPOSITORY
    : null
  return {
    status: env.GITHUB_ACTIONS === 'true' ? 'RUNNING_OR_COMPLETED' : 'NOT_RUN',
    runID: runId,
    runURL: server && repository && runId ? `${server}/${repository}/actions/runs/${runId}` : null,
    event: typeof env.GITHUB_EVENT_NAME === 'string' ? env.GITHUB_EVENT_NAME : null,
    runAttempt: typeof env.GITHUB_RUN_ATTEMPT === 'string' && /^\d+$/.test(env.GITHUB_RUN_ATTEMPT)
      ? env.GITHUB_RUN_ATTEMPT
      : null,
    actions: env.GITHUB_ACTIONS === 'true'
  }
}

function automationGate(results) {
  const bySuite = new Map(results.map(item => [item.suite, item]))
  const failures = []
  const blocked = []
  for (const suite of REQUIRED_AUTOMATION_SUITES) {
    const result = bySuite.get(suite)
    if (!result) {
      blocked.push(`${suite}:missing`)
      continue
    }
    const accepted = suite === 'release-build'
      ? ['PASS', 'OFFLINE_TEST_ONLY'].includes(result.status)
      : result.status === 'PASS'
    if (result.status === 'FAIL') failures.push(`${suite}:FAIL`)
    else if (!accepted) blocked.push(`${suite}:${result.status}`)
  }
  if (reportAssistedStatus(results) !== 'PASS') blocked.push('REPORT_ASSISTED:NOT_VERIFIED')
  if (failures.length) return { status: 'FAIL', failures, blocked }
  if (blocked.length) return { status: 'BLOCKED_EXTERNAL', failures, blocked }
  return { status: 'PASS', failures, blocked }
}

function publicStatus(status) {
  if (status === 'PASS') return 'PASS'
  if (status === 'FAIL' || status === 'NEEDS_FIX') return 'FAIL'
  if (status === 'NOT_IMPLEMENTED') return 'NOT_IMPLEMENTED'
  return 'BLOCKED'
}

function resultFor(results, suite) {
  return results.find(item => item.suite === suite) || null
}

function acceptanceStatuses(results, gate, automationOnly, ci = ciMetadata()) {
  const pg = resultFor(results, 'masters-postgres')
  const pgStatus = pg ? publicStatus(pg.status) : 'BLOCKED'
  const restoreProof = pg && pg.isolatedBackupRestore
    ? pg.isolatedBackupRestore
    : results.find(item => /(?:backup|restore)/i.test(item.suite) && item.status)?.status
  const restore = publicStatus(restoreProof || 'BLOCKED_EXTERNAL')
  const report = reportAssistedStatus(results)
  return {
    POSTGRESQL_HTTP: { status: pgStatus, evidence: pg ? pg.logSha256 : null },
    CI: {
      status: automationOnly ? publicStatus(gate.status) : 'BLOCKED',
      gate: gate.status,
      runURL: ci.runURL
    },
    ISOLATED_BACKUP_RESTORE: { status: restore, evidence: pg ? pg.logSha256 : null },
    TARGET_HOST_SECURITY: { status: 'BLOCKED', reason: 'target host ACL/static encryption/restore evidence remains external' },
    WECHAT_DEVTOOLS: { status: 'BLOCKED', reason: 'real WeChat DevTools evidence remains external' },
    WECHAT_IOS: { status: 'BLOCKED', reason: 'real iOS device evidence remains external' },
    WECHAT_ANDROID: { status: 'BLOCKED', reason: 'real Android device evidence remains external' },
    REPORT_ASSISTED: { status: publicStatus(report), evidence: resultFor(results, 'all-regression')?.logSha256 || null },
    AUTO_SCHOOL_MATCHING: { status: 'NOT_IMPLEMENTED', reason: '人工辅助选校保留；自动选校未实现' }
  }
}

function validateCheckoutHead(git, env = process.env) {
  const headSha = git('rev-parse', 'HEAD')
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error('INVALID_CHECKOUT_HEAD')
  const requested = typeof env.GITHUB_TEST_SHA === 'string' ? env.GITHUB_TEST_SHA.trim() : ''
  if (requested && (!/^[0-9a-f]{40}$/.test(requested) || requested !== headSha)) throw new Error('CHECKOUT_SHA_MISMATCH')
  return headSha
}

function commandList() {
  return [
    ['all-regression', npmCommand(['run', 'test:all'])],
    ['workbench-browser', { executable: process.execPath, args: ['scripts/test-masters-workbench.js'] }],
    ['release-contract', npmCommand(['run', 'test:release'])],
    ['secret-scan', npmCommand(['run', 'scan:release-secrets'])],
    ['education-postgres', npmCommand(['run', 'test:education-postgres'])],
    ['masters-postgres', npmCommand(['run', 'test:masters-postgres'])],
    ['release-build', npmCommand(['run', 'build:release'])],
    ['environment', { executable: process.execPath, args: ['scripts/check-masters-test-environment.js'] }]
  ]
}

function writeSummary(directory, summary) {
  const summaryPath = path.join(directory, 'summary.json')
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 })
  return summaryPath
}

async function main() {
  const automationOnly = process.argv.includes(AUTOMATION_MODE)
  const git = (...args) => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  if (automationOnly && process.env.GITHUB_ACTIONS !== 'true') throw new Error('AUTOMATION_ONLY_REQUIRES_GITHUB_ACTIONS')

  const headSha = validateCheckoutHead(git)
  if (git('status', '--porcelain')) throw new Error('COMMIT_REQUIRED: candidate evidence requires a clean committed worktree')
  const startedAt = new Date().toISOString()
  const packageBytes = fs.readFileSync(path.join(root, 'package.json'))
  const serverPackageBytes = fs.readFileSync(path.join(root, 'server/package.json'))
  const npmVersionCommand = npmCommand(['--version'])
  const npmVersion = cp.execFileSync(npmVersionCommand.executable, npmVersionCommand.args, {
    cwd: root, encoding: 'utf8', windowsHide: true
  }).trim()
  const directory = path.join(root, 'outputs', automationOnly ? 'masters-ci' : 'masters-round2', headSha)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })

  const results = []
  for (const [name, command] of commandList()) {
    process.stdout.write(JSON.stringify({ suite: name, state: 'RUNNING', headSha }) + '\n')
    const run = cp.spawnSync(command.executable, command.args, {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024
    })
    const rawOutput = (run.stdout || '') + (run.stderr || '') + (run.error ? '\nPROCESS_FAILED_OR_TIMED_OUT' : '')
    const output = sanitized(rawOutput, process.env)
    const status = classifyResult(name, run.status ?? 1, output)
    const logPath = path.join(directory, name + '.log')
    fs.writeFileSync(logPath, output, { mode: 0o600 })
    const result = {
      suite: name,
      status,
      exitCode: run.status,
      command: command.args.join(' '),
      headSha,
      logSha256: crypto.createHash('sha256').update(output).digest('hex')
    }
    if (name === 'all-regression') {
      const count = [...output.matchAll(/(?:ℹ |# )?tests\s+(\d+)/g)].at(-1)
      result.serverTests = count ? Number(count[1]) : null
      result.reportAssisted = reportAssistedMarker(output)
      result.sourcedAssistedPlan = result.reportAssisted
    }
    if (name === 'workbench-browser') {
      const proof = browserProof(jsonLines(output))
      result.reportAssisted = proof ? 'PASS' : 'NOT_VERIFIED'
      if (proof) result.browserProof = { realHttp: true, cases: proof.cases }
    }
    if (name === 'masters-postgres') {
      const proof = mastersPostgresProof(jsonLines(output))
      if (proof) {
        for (const key of ['databaseConnectionAttempted', 'httpFlow', 'tlsVerifyFull', 'applicationRoleIsolation', 'isolatedBackupRestore']) result[key] = proof[key]
        result.postgresProof = proof.httpPostgresFlow || proof.postgresHttpFlowProof || proof.proof || null
      }
    }
    results.push(result)
    process.stdout.write(JSON.stringify({ suite: name, status, exitCode: run.status }) + '\n')
  }

  const unchanged = git('rev-parse', 'HEAD') === headSha && !git('status', '--porcelain')
  const gate = automationGate(results)
  const automationStatus = !unchanged ? 'FAIL' : gate.status
  const externalStatus = 'BLOCKED_EXTERNAL'
  const ci = ciMetadata()
  const summary = {
    schemaVersion: 2,
    requestHeadSha: REQUEST_HEAD_SHA,
    headSha,
    treeSha: git('rev-parse', 'HEAD^{tree}'),
    startedAt,
    finishedAt: new Date().toISOString(),
    unchanged,
    mode: automationOnly ? 'automation-only' : 'local-candidate',
    runtime: { node: process.version, npm: npmVersion, platform: process.platform, arch: process.arch },
    packages: {
      client: { version: JSON.parse(packageBytes).version, sha256: crypto.createHash('sha256').update(packageBytes).digest('hex') },
      server: { version: JSON.parse(serverPackageBytes).version, sha256: crypto.createHash('sha256').update(serverPackageBytes).digest('hex') }
    },
    status: !unchanged || results.some(item => item.status === 'FAIL') ? 'NEEDS_FIX' : 'BLOCKED',
    automationStatus,
    externalStatus,
    gate,
    results,
    acceptance: acceptanceStatuses(results, gate, automationOnly, ci),
    externalAcceptance: {
      wechatDeveloperTools: 'BLOCKED_EXTERNAL',
      iosRealWechatSession: 'BLOCKED_EXTERNAL',
      androidRealWechatSession: 'BLOCKED_EXTERNAL',
      deploymentStorageAclEncryptionAndRestore: 'BLOCKED_EXTERNAL',
      note: 'These require individually reviewed target-host and real-device evidence; automated tests cannot mark them PASS.'
    },
    autoSchoolMatching: 'NOT_IMPLEMENTED',
    ci,
    merged: false,
    productionDeployed: false,
    realStudentDataEnabled: false
  }
  const summaryPath = writeSummary(directory, summary)
  process.stdout.write(JSON.stringify({
    status: summary.status,
    automationStatus,
    externalStatus,
    headSha,
    evidence: path.relative(root, summaryPath),
    founderUatReady: false
  }) + '\n')

  // The local runner can never clear external acceptance. Automation-only is
  // useful to Actions: its exit status reflects the strict automated gate,
  // while the summary keeps target host/WeChat blocked.
  if (automationOnly) process.exitCode = automationStatus === 'PASS' ? 0 : 1
  else process.exitCode = 2
}

if (require.main === module) main().catch(error => {
  process.stderr.write(JSON.stringify({ status: 'NEEDS_FIX', reason: sanitized(error.message, process.env) }) + '\n')
  process.exitCode = 1
})

module.exports = {
  REQUEST_HEAD_SHA,
  REQUIRED_AUTOMATION_SUITES,
  automationGate,
  browserProof,
  classifyResult,
  educationPostgresProof,
  mastersPostgresProof,
  reportAssistedMarker,
  reportAssistedStatus,
  sanitized
}
