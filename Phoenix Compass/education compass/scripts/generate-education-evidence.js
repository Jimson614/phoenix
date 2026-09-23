'use strict'

const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const {
  mkdir, readFile, readdir, stat, writeFile
} = require('node:fs/promises')
const path = require('node:path')
const { serverDist } = require('./server-dist-path')

const root = path.resolve(__dirname, '..')
const verificationRoot = path.join(root, 'artifacts', 'verification')
const freezeRelativePath = 'docs/product/EDUCATION_COMPASS_PRODUCT_FREEZE_V1.md'
const expectedFreezeSha256 = '9884503DA89A61F1DFC78FF97F429FDE210D240B30764D099105DD7C8A100B2D'
const historicalMigrationHashes = Object.freeze({
  '001_initial_schema.sql': '502AB6BED513978922FAD8FD424D1C11281B07771E37CE056CF001A2674B35C9',
  '002_feishu_bitable_integration.sql': '5A9FC3092BDF46025834A1211E8458CBFF9D3B1DD39ECBF3C2BD02A72CA2D34D',
  '003_openai_agent.sql': '1E8B64E1FE38D48BEFD11AD3D69AF73423D77AF17A294ECF8E809A83C3D197E6',
  '004_dual_agent_analysis.sql': '62F9B9213B768C2C2C694632AC30C791E5CAE77F75F0760CE0FB95C308D3E097',
  '005_education_compass_levels.sql': '1B398D9FFA3B85947A0814EEDDF512C139AF03E0560B385285C7F652AFD40289',
  '006_deepseek_agent_provider.sql': 'CBBE0B69759611252ED78A17F202466989A0A83C32ED564111FEDC6851BA744A',
  '007_account_deletion.sql': '4FFBD38BCADC9413832EDC4F2D1624A1BDBAC714E26EAA14F59F099923EFF6F6',
  '008_refund_window.sql': 'F634A740DBF6C854B47D10DDB352F472C489B6D72DA19010FBFE11331332C20F'
})

const ignoredDirectories = new Set([
  '.git', '.npm-cache', 'artifacts', 'coverage', 'dist', 'node_modules', 'outputs'
])
const sourceExtensions = new Set([
  '.js', '.json', '.md', '.sql', '.ts', '.wxml', '.wxss', '.yaml', '.yml'
])
const credentialKeys = [
  'AI_CONTENT_ENCRYPTION_KEY', 'AI_CONTENT_KEYRING_JSON', 'DATABASE_URL', 'EDUCATION_TEST_DATABASE_URL',
  'EDUCATION_TEST_DATABASE_ALLOW_MUTATION', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET',
  'FEISHU_BITABLE_APP_TOKEN', 'FEISHU_PSEUDONYM_KEY', 'OPENAI_API_KEY', 'OPENAI_SAFETY_HMAC_KEY',
  'SESSION_SECRET', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'WECHAT_MCH_CERT_SERIAL_NO',
  'WECHAT_MCH_ID', 'WECHAT_MCH_PRIVATE_KEY_PATH', 'WECHATPAY_API_V3_KEY',
  'WECHATPAY_PUBLIC_KEY_ID', 'WECHATPAY_PUBLIC_KEY_PATH', 'WECHAT_PAY_API_V3_KEY',
  'WECHAT_PAY_MCH_ID', 'WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_SERIAL_NO'
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex').toUpperCase()
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function relative(absolute) {
  return path.relative(root, absolute).replaceAll('\\', '/')
}

function utcDirectoryName(date = new Date()) {
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').replace('.', '-')
}

function canonicalWritePath(target) {
  const missing = []
  let existing = target
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    missing.unshift(path.basename(existing))
    existing = parent
  }
  return path.resolve(fs.realpathSync(existing), ...missing)
}

function isStrictDescendant(target, parent) {
  const relation = path.relative(parent, target)
  return Boolean(relation) && relation !== '..' && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation)
}

function validateEvidenceRoot(evidenceRoot = verificationRoot, sourceRoot = root) {
  if (fs.lstatSync(sourceRoot).isSymbolicLink()) throw new Error('Evidence source root must not be a symbolic link')
  const canonicalSourceRoot = fs.realpathSync(sourceRoot)
  if (fs.existsSync(evidenceRoot) && fs.lstatSync(evidenceRoot).isSymbolicLink()) {
    throw new Error('Evidence output root must not be a symbolic link')
  }
  const canonicalEvidenceRoot = canonicalWritePath(evidenceRoot)
  if (!isStrictDescendant(canonicalEvidenceRoot, canonicalSourceRoot)) {
    throw new Error('Evidence output root must stay inside the project root')
  }
}

async function unusedEvidenceDirectory() {
  validateEvidenceRoot()
  await mkdir(verificationRoot, { recursive: true })
  const base = utcDirectoryName()
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const name = suffix === 0 ? base : `${base}-${String(suffix).padStart(2, '0')}`
    const candidate = path.join(verificationRoot, name)
    try {
      await mkdir(candidate)
      return candidate
    } catch (error) {
      if (error && error.code === 'EEXIST') continue
      throw error
    }
  }
  throw new Error('Unable to allocate a unique verification evidence directory')
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      if (ignoredDirectories.has(entry.name)) continue
      throw new Error(`Source manifest input must not be a symbolic link: ${path.join(directory, entry.name)}`)
    }
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) result.push(...await filesUnder(absolute))
      continue
    }
    if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name).toLowerCase())) continue
    result.push(absolute)
  }
  return result
}

async function fileHash(absolute) {
  return sha256(await readFile(absolute))
}

async function sourceManifest(capturedAt) {
  const files = []
  for (const absolute of (await filesUnder(root)).sort((a, b) => relative(a).localeCompare(relative(b), 'en'))) {
    const metadata = await stat(absolute)
    files.push({ path: relative(absolute), bytes: metadata.size, sha256: await fileHash(absolute) })
  }
  return {
    schemaVersion: 'phoenix_source_manifest_v1',
    capturedAt,
    excluded: ['artifacts', 'coverage', 'dist', 'node_modules', 'outputs', 'binary files'],
    fileCount: files.length,
    aggregateSha256: sha256(stableJson(files.map(({ path: filePath, bytes, sha256: digest }) => ({
      path: filePath, bytes, sha256: digest
    })))),
    files
  }
}

async function migrationManifest(capturedAt, sourceAggregateSha256) {
  const migrationDirectory = path.join(root, 'server', 'migrations')
  const migrationNames = (await readdir(migrationDirectory)).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort()
  const migrations = []
  for (const name of migrationNames) {
    const absolute = path.join(migrationDirectory, name)
    const metadata = await stat(absolute)
    const digest = await fileHash(absolute)
    migrations.push({
      path: `server/migrations/${name}`,
      bytes: metadata.size,
      sha256: digest,
      historicalBaselineSha256: historicalMigrationHashes[name] || null,
      historicalBaselineMatch: historicalMigrationHashes[name] ? historicalMigrationHashes[name] === digest : null
    })
  }
  const freezeSha256 = await fileHash(path.join(root, ...freezeRelativePath.split('/')))
  const historical = migrations.filter((item) => item.historicalBaselineSha256)
  return {
    schemaVersion: 'phoenix_migration_hash_manifest_v1',
    capturedAt,
    bindings: { freezePath: freezeRelativePath, freezeSha256, sourceAggregateSha256 },
    freezeBaselineSha256: expectedFreezeSha256,
    freezeBaselineMatch: freezeSha256 === expectedFreezeSha256,
    historicalMigrationsUnchanged: historical.length === Object.keys(historicalMigrationHashes).length &&
      historical.every((item) => item.historicalBaselineMatch),
    aggregateSha256: sha256(stableJson(migrations.map(({ path: filePath, sha256: digest }) => ({ path: filePath, sha256: digest })))),
    migrations
  }
}

function cleanEnvironment(source = process.env) {
  const env = { ...source, NODE_ENV: 'test' }
  for (const key of credentialKeys) delete env[key]
  env.PAYMENT_PROVIDER = 'mock'
  env.OPENAI_AGENT_ENABLED = 'false'
  env.AGENT_PROVIDER = 'mock'
  env.AI_WORKER_ENABLED = 'false'
  env.FEISHU_BITABLE_ENABLED = 'false'
  env.FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED = 'false'
  env.FEISHU_SYNC_ENABLED = 'false'
  env.EDUCATION_TEST_DATABASE_URL = ''
  env.EDUCATION_TEST_DATABASE_ALLOW_MUTATION = ''
  return env
}

function parseLastJsonLine(output) {
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index])
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // TAP and npm output are intentionally ignored.
    }
  }
  return null
}

function redactTitle(value) {
  return String(value || '')
    .replaceAll(root, '<PROJECT_ROOT>')
    .replace(/\b1[3-9]\d{9}\b/g, '<PHONE>')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<EMAIL>')
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+)\b/gi, '<TOKEN>')
    .slice(0, 300)
}

function parseTap(output) {
  const text = String(output || '').replace(/\u001b\[[0-9;]*m/g, '')
  const number = (label) => {
    const matches = [...text.matchAll(new RegExp(`^(?:#|ℹ) ${label} (\\d+)\\s*$`, 'gm'))]
    return matches.length ? Number(matches[matches.length - 1][1]) : null
  }
  const durationMatches = [...text.matchAll(/^(?:#|ℹ) duration_ms ([0-9.]+)\s*$/gm)]
  const cases = []
  for (const line of text.split(/\r?\n/)) {
    const tapMatch = line.match(/^(not )?ok\s+\d+\s+-\s+(.+?)(?:\s+#.*)?$/)
    if (tapMatch) {
      cases.push({ status: tapMatch[1] ? 'FAIL' : 'PASS', name: redactTitle(tapMatch[2]) })
      continue
    }
    const specMatch = line.match(/^([✔✖])\s+(.+?)\s+\([0-9.]+ms\)\s*$/)
    if (specMatch) cases.push({ status: specMatch[1] === '✔' ? 'PASS' : 'FAIL', name: redactTitle(specMatch[2]) })
  }
  return {
    tests: number('tests'), pass: number('pass'), fail: number('fail'),
    cancelled: number('cancelled'), skipped: number('skipped'), todo: number('todo'),
    durationMs: durationMatches.length ? Number(durationMatches[durationMatches.length - 1][1]) : null,
    cases
  }
}

function safeStructuredResult(value) {
  if (!value || typeof value !== 'object') return null
  const allowed = ['status', 'suite', 'mode', 'externalCalls', 'checkpoints', 'openapiOperations',
    'validExamples', 'invalidExamples', 'findings', 'reason']
  const result = {}
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) continue
    if (key === 'reason') result.reason = redactTitle(value.reason)
    else if (key === 'findings') result.findings = Array.isArray(value.findings) ? value.findings.length : value.findings
    else result[key] = value[key]
  }
  return result
}

function commandStatus(exitCode, structured) {
  if (structured?.status === 'BLOCKED_EXTERNAL') return 'BLOCKED_EXTERNAL'
  if (structured?.status === 'FAIL') return 'FAIL'
  return exitCode === 0 ? 'PASS' : 'FAIL'
}

function npmInvocation() {
  if (process.platform !== 'win32') return { command: 'npm', argsPrefix: [] }
  // Node's Windows spawnSync rejects .cmd files with EINVAL when shell=false. Invoking npm's
  // JavaScript entry point avoids PowerShell execution-policy and command-shell ambiguity.
  return {
    command: process.execPath,
    argsPrefix: [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  }
}

function runCommand(definition, env) {
  const startedAt = new Date()
  const result = spawnSync(definition.command, definition.args, {
    cwd: root,
    env,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 24 * 1024 * 1024,
    windowsHide: true
  })
  const finishedAt = new Date()
  const stdout = result.stdout || ''
  const stderr = result.stderr || ''
  const exitCode = Number.isInteger(result.status) ? result.status : 1
  const structured = parseLastJsonLine(stdout) || parseLastJsonLine(stderr)
  const tap = parseTap(`${stdout}\n${stderr}`)
  const status = result.error ? 'FAIL' : commandStatus(exitCode, structured)
  return {
    id: definition.id,
    category: definition.category,
    command: definition.displayCommand || [path.basename(definition.command), ...definition.args],
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    exitCode,
    signal: result.signal || null,
    status,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    structuredResult: safeStructuredResult(structured),
    tap,
    processErrorCode: result.error?.code || null
  }
}

function findCase(command, fragment) {
  const normalized = fragment.toLowerCase()
  return command?.tap?.cases.find((item) => item.name.toLowerCase().includes(normalized)) || null
}

async function writeJson(directory, name, value) {
  await writeFile(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function openApiEvidence(command, bindings) {
  const openapiPath = path.join(root, 'docs', 'openapi', 'education-compass-v0.5.0.openapi.yaml')
  const openapi = await readFile(openapiPath, 'utf8')
  const operationIds = [...openapi.matchAll(/^\s+operationId:\s+(\S+)\s*$/gm)].map((match) => match[1])
  const exampleDirectory = path.join(root, 'docs', 'examples')
  const examples = []
  for (const name of (await readdir(exampleDirectory)).filter((item) => item.endsWith('.json')).sort()) {
    const absolute = path.join(exampleDirectory, name)
    examples.push({ path: `docs/examples/${name}`, sha256: await fileHash(absolute) })
  }
  return {
    schemaVersion: 'phoenix_openapi_conformance_evidence_v1',
    generatedAt: new Date().toISOString(),
    status: command.status,
    verificationCommandId: command.id,
    exitCode: command.exitCode,
    openapi: {
      path: 'docs/openapi/education-compass-v0.5.0.openapi.yaml',
      sha256: await fileHash(openapiPath),
      operationCount: operationIds.length,
      uniqueOperationIds: new Set(operationIds).size === operationIds.length,
      operationIds
    },
    examples,
    structuredResult: command.structuredResult,
    bindings
  }
}

async function integrationDiffEvidence(command, bindings) {
  const agentCase = findCase(command, 'Agent serializers emit no PII')
  const feishuCase = findCase(command, 'Feishu mirror requires both gates')
  let allowlists = null
  try {
    const contract = require(serverDist('integrations', 'feishu', 'schema-contract.js'))
    allowlists = contract.CUSTOMER_PROFILE_FEISHU_ALLOWLISTS
  } catch {
    allowlists = null
  }
  const agent = {
    schemaVersion: 'phoenix_agent_egress_key_diff_v1',
    generatedAt: new Date().toISOString(),
    status: agentCase?.status === 'PASS' ? 'PASS' : 'FAIL',
    verificationCommandId: command.id,
    verifiedTestCase: agentCase,
    sourceHashes: {
      'server/src/ai/context/assessment-context.ts': await fileHash(path.join(root, 'server', 'src', 'ai', 'context', 'assessment-context.ts')),
      'server/src/services/agent-service.ts': await fileHash(path.join(root, 'server', 'src', 'services', 'agent-service.ts')),
      'server/tests/education-integrations.test.ts': await fileHash(path.join(root, 'server', 'tests', 'education-integrations.test.ts'))
    },
    inboundKeyClasses: {
      identity: ['userId', 'familyId', 'studentId', 'assessmentId', 'reportId'],
      rawResponseContainers: ['answers', 'answer_payload'],
      directIdentifiers: ['name', 'phone', 'email', 'school', 'address']
    },
    providerEgressContract: {
      topLevelKeys: ['dataAsOf', 'confidence', 'disclaimer', 'modules', 'sources'],
      level1ModuleKeys: ['family_concerns', 'parent_observation_signals', 'next_step'],
      level2ModuleKeys: ['student_snapshot', 'strength_signals', 'learning_bottlenecks', 'subject_focus', 'growth_direction', 'action_plan_30d']
    },
    removedBeforeEgress: ['identity', 'raw questionnaire answers', 'internal IDs', 'legacy report module free text'],
    externalCallPerformed: false,
    bindings
  }
  const forbiddenFeishuFields = [
    'session_id', 'assessment_id', 'report_id', 'order_id', 'answers', 'answer_payload',
    'result_payload', 'family_concerns', 'strength_signals', 'learning_bottlenecks',
    'amount_fen', 'product_code', 'out_trade_no', 'provider_transaction_id', 'payment_params'
  ]
  const feishu = {
    schemaVersion: 'phoenix_feishu_field_diff_v1',
    generatedAt: new Date().toISOString(),
    status: feishuCase?.status === 'PASS' && allowlists ? 'PASS' : 'FAIL',
    verificationCommandId: command.id,
    verifiedTestCase: feishuCase,
    requiredGates: ['FEISHU_SYNC_ENABLED deployment flag', 'active FEISHU_PROFILE_MIRROR per-child consent'],
    allowedFields: allowlists,
    removedOperationalAndSensitiveFields: forbiddenFeishuFields,
    withdrawalFence: {
      status: 'BLOCKED',
      errorCode: 'FEISHU_CONSENT_WITHDRAWN',
      clearedRetryMaterial: ['leaseToken', 'operationToken', 'operationDigest', 'operationBody', 'nextAttemptAt']
    },
    sourceHashes: {
      'server/src/integrations/feishu/schema-contract.ts': await fileHash(path.join(root, 'server', 'src', 'integrations', 'feishu', 'schema-contract.ts')),
      'server/src/integrations/feishu/sync-service.ts': await fileHash(path.join(root, 'server', 'src', 'integrations', 'feishu', 'sync-service.ts')),
      'server/tests/education-integrations.test.ts': await fileHash(path.join(root, 'server', 'tests', 'education-integrations.test.ts'))
    },
    externalCallPerformed: false,
    bindings
  }
  return { agent, feishu }
}

function markdownEscape(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\r', ' ').replaceAll('\n', ' ')
}

function reportMarkdown({ generatedAt, localStatus, commands, bindings, sourceChanged, postgres }) {
  const rows = commands.map((command) =>
    `| ${markdownEscape(command.id)} | ${command.status} | ${command.exitCode} | ${command.durationMs} |`
  ).join('\n')
  return `# Phoenix Education Compass V0.5.0 — Local Verification Evidence\n\n` +
    `- Generated at (UTC): \`${generatedAt}\`\n` +
    `- Verification status: \`${localStatus}\`\n` +
    `- Scope: Level 1 and Level 2 local implementation only\n` +
    `- Mode: local process + in-memory HTTP mock; no external service calls\n` +
    `- Release candidate: \`NO\`\n\n` +
    `## Integrity bindings\n\n` +
    `- Freeze SHA-256: \`${bindings.freezeSha256}\`\n` +
    `- Migration aggregate SHA-256: \`${bindings.migrationAggregateSha256}\`\n` +
    `- Source before SHA-256: \`${bindings.sourceBeforeSha256}\`\n` +
    `- Source after SHA-256: \`${bindings.sourceAfterSha256}\`\n` +
    `- Source changed during verification: \`${sourceChanged}\`\n\n` +
    `## Executed commands\n\n` +
    `| Command ID | Result | Exit code | Duration (ms) |\n|---|---:|---:|---:|\n${rows}\n\n` +
    `## Verified local path\n\n` +
    `The HTTP smoke test covers health, profile creation, Level 1 create/save/submit/result, ` +
    `Level 2 create/save/submit/locked zero-leak result, mock payment authority, and unlocked ` +
    `Level 2 result. A \`PASS\` here is evidence only for this isolated local run.\n\n` +
    `## Explicitly not verified\n\n` +
    `- PostgreSQL migration/schema: \`${postgres.status}\` — ${markdownEscape(postgres.reason || 'dedicated test database was not configured')}\n` +
    `- Real WeChat Pay: \`BLOCKED_EXTERNAL\`\n` +
    `- Real OpenAI Agent request: \`BLOCKED_EXTERNAL\`\n` +
    `- Real Feishu Bitable write: \`BLOCKED_EXTERNAL\`\n` +
    `- WeChat DevTools manual UX check: \`BLOCKED_MANUAL\`\n` +
    `- Production deployment or release approval: \`NOT_REQUESTED\`\n\n` +
    `This directory is a redacted local evidence package, not a deployable or verified/candidate ZIP.\n`
}

async function shaSums(directory, names) {
  const lines = []
  for (const name of [...names].sort()) {
    lines.push(`${await fileHash(path.join(directory, name))}  ${name}`)
  }
  await writeFile(path.join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8')
  for (const line of lines) {
    const [expected, ...nameParts] = line.split('  ')
    const name = nameParts.join('  ')
    if (await fileHash(path.join(directory, name)) !== expected) throw new Error(`Evidence checksum self-check failed: ${name}`)
  }
}

async function main() {
  const evidenceDirectory = await unusedEvidenceDirectory()
  const generatedAt = new Date().toISOString()
  const sourceBefore = await sourceManifest(generatedAt)
  const migrationsBefore = await migrationManifest(generatedAt, sourceBefore.aggregateSha256)
  await writeJson(evidenceDirectory, 'source-manifest.before.json', sourceBefore)
  await writeJson(evidenceDirectory, 'migration-hashes.before.json', migrationsBefore)

  const npm = npmInvocation()
  const definitions = [
    { id: 'release-secret-scan', category: 'security', command: process.execPath, args: ['scripts/scan-release-secrets.js'], displayCommand: ['node', 'scripts/scan-release-secrets.js'] },
    { id: 'server-build', category: 'build', command: npm.command, args: [...npm.argsPrefix, '--prefix', 'server', 'run', 'build'], displayCommand: ['npm', '--prefix', 'server', 'run', 'build'] },
    { id: 'server-typecheck', category: 'build', command: npm.command, args: [...npm.argsPrefix, '--prefix', 'server', 'run', 'typecheck'], displayCommand: ['npm', '--prefix', 'server', 'run', 'typecheck'] },
    { id: 'client-tests', category: 'test', command: npm.command, args: [...npm.argsPrefix, 'run', 'test:client'], displayCommand: ['npm', 'run', 'test:client'] },
    { id: 'server-tests', category: 'test', command: process.execPath, args: ['scripts/run-server-tests.js'], displayCommand: ['node', 'scripts/run-server-tests.js'] },
    { id: 'openapi-and-examples', category: 'contract', command: process.execPath, args: ['scripts/verify-education-docs.js'], displayCommand: ['node', 'scripts/verify-education-docs.js'] },
    { id: 'education-http-smoke', category: 'smoke', command: process.execPath, args: ['scripts/smoke-education-compass-mock.js'], displayCommand: ['node', 'scripts/smoke-education-compass-mock.js'] },
    { id: 'education-postgres', category: 'external', command: process.execPath, args: ['scripts/test-education-postgres.js'], displayCommand: ['node', 'scripts/test-education-postgres.js'] }
  ]
  const env = cleanEnvironment()
  const commands = definitions.map((definition) => runCommand(definition, env))

  const afterCapturedAt = new Date().toISOString()
  const sourceAfter = await sourceManifest(afterCapturedAt)
  const migrationsAfter = await migrationManifest(afterCapturedAt, sourceAfter.aggregateSha256)
  await writeJson(evidenceDirectory, 'source-manifest.after.json', sourceAfter)
  await writeJson(evidenceDirectory, 'migration-hashes.after.json', migrationsAfter)

  const sourceChanged = sourceBefore.aggregateSha256 !== sourceAfter.aggregateSha256
  const migrationChanged = migrationsBefore.aggregateSha256 !== migrationsAfter.aggregateSha256
  const bindings = {
    freezeSha256: migrationsAfter.bindings.freezeSha256,
    migrationAggregateSha256: migrationsAfter.aggregateSha256,
    sourceBeforeSha256: sourceBefore.aggregateSha256,
    sourceAfterSha256: sourceAfter.aggregateSha256
  }

  const commandLines = commands.map((command) => JSON.stringify(command)).join('\n')
  await writeFile(path.join(evidenceDirectory, 'commands.ndjson'), `${commandLines}\n`, 'utf8')

  const localRequiredIds = new Set([
    'release-secret-scan', 'server-build', 'server-typecheck', 'client-tests', 'server-tests',
    'openapi-and-examples', 'education-http-smoke'
  ])
  const localCommands = commands.filter((command) => localRequiredIds.has(command.id))
  const localPass = localCommands.every((command) => command.status === 'PASS')
  const smoke = commands.find((command) => command.id === 'education-http-smoke')
  const smokeResult = {
    schemaVersion: 'phoenix_http_smoke_redacted_v1',
    generatedAt,
    status: smoke.status,
    mode: smoke.structuredResult?.mode || 'LOCAL_HTTP_MOCK',
    externalCalls: smoke.structuredResult?.externalCalls ?? null,
    checkpoints: smoke.structuredResult?.checkpoints || [],
    commandId: smoke.id,
    exitCode: smoke.exitCode,
    stdoutSha256: smoke.stdoutSha256,
    stderrSha256: smoke.stderrSha256,
    bindings
  }
  await writeJson(evidenceDirectory, 'http-smoke.redacted.json', smokeResult)

  const postgresCommand = commands.find((command) => command.id === 'education-postgres')
  const postgres = {
    status: postgresCommand.status,
    reason: postgresCommand.structuredResult?.reason || 'Dedicated PostgreSQL test database was intentionally not configured'
  }
  const tests = {
    schemaVersion: 'phoenix_local_test_evidence_v1',
    generatedAt,
    status: localPass && !sourceChanged && !migrationChanged ? 'PASS' : 'FAIL',
    scope: 'Education Compass V0.5.0 Level 1 and Level 2 local verification',
    suites: commands.filter((command) => ['test', 'contract', 'smoke', 'security', 'build'].includes(command.category)).map((command) => ({
      commandId: command.id,
      category: command.category,
      status: command.status,
      exitCode: command.exitCode,
      durationMs: command.durationMs,
      tap: command.tap,
      structuredResult: command.structuredResult
    })),
    externalValidation: [
      { id: 'postgresql-schema', status: postgres.status, reason: postgres.reason },
      { id: 'wechat-pay-live', status: 'BLOCKED_EXTERNAL' },
      { id: 'openai-agent-live', status: 'BLOCKED_EXTERNAL' },
      { id: 'feishu-bitable-live', status: 'BLOCKED_EXTERNAL' },
      { id: 'wechat-devtools-manual', status: 'BLOCKED_MANUAL' }
    ],
    sourceChangedDuringRun: sourceChanged,
    migrationChangedDuringRun: migrationChanged,
    bindings
  }
  await writeJson(evidenceDirectory, 'tests.json', tests)

  const openapiCommand = commands.find((command) => command.id === 'openapi-and-examples')
  await writeJson(evidenceDirectory, 'openapi-conformance.json', await openApiEvidence(openapiCommand, bindings))

  const serverTests = commands.find((command) => command.id === 'server-tests')
  const integration = await integrationDiffEvidence(serverTests, bindings)
  await writeJson(evidenceDirectory, 'agent-egress-key-diff.json', integration.agent)
  await writeJson(evidenceDirectory, 'feishu-field-diff.json', integration.feishu)

  const freezeValid = migrationsAfter.freezeBaselineMatch
  const historicalMigrationsValid = migrationsAfter.historicalMigrationsUnchanged
  const integrationValid = integration.agent.status === 'PASS' && integration.feishu.status === 'PASS'
  const smokeValid = smokeResult.status === 'PASS' && smokeResult.mode === 'LOCAL_HTTP_MOCK' && smokeResult.externalCalls === 0
  let localStatus = 'LOCAL_LEVEL1_LEVEL2_VERIFICATION_FAILED'
  if (sourceChanged || migrationChanged) localStatus = 'LOCAL_LEVEL1_LEVEL2_VERIFICATION_INVALIDATED_SOURCE_CHANGED'
  else if (localPass && freezeValid && historicalMigrationsValid && integrationValid && smokeValid) {
    localStatus = 'LOCAL_LEVEL1_LEVEL2_HTTP_MOCK_VERIFIED'
  }

  const report = reportMarkdown({
    generatedAt, localStatus, commands, bindings, sourceChanged, postgres
  })
  await writeFile(path.join(evidenceDirectory, 'TEST_REPORT.md'), report, 'utf8')

  const releaseManifest = {
    schemaVersion: 'phoenix_local_verification_release_manifest_v1',
    generatedAt,
    artifactKind: 'LOCAL_VERIFICATION_EVIDENCE',
    productVersion: '0.5.0',
    verificationStatus: localStatus,
    releaseStatus: 'NOT_A_RELEASE_CANDIDATE',
    deployableArtifactIncluded: false,
    verifiedCandidateZipIncluded: false,
    verifiedScope: localStatus === 'LOCAL_LEVEL1_LEVEL2_HTTP_MOCK_VERIFIED'
      ? ['Level 1 local flow', 'Level 2 local locked/unlocked flow', 'local mock payment authority', 'local privacy boundary tests']
      : [],
    blockedScope: tests.externalValidation,
    integrity: {
      ...bindings,
      freezeBaselineMatch: freezeValid,
      historicalMigrationsUnchanged: historicalMigrationsValid,
      sourceChangedDuringRun: sourceChanged,
      migrationChangedDuringRun: migrationChanged
    },
    externalCallsPerformed: 0,
    notes: 'This manifest describes redacted local evidence only. It does not authorize deployment or production use.'
  }
  await writeJson(evidenceDirectory, 'release-manifest.json', releaseManifest)

  const evidenceFiles = [
    'commands.ndjson', 'tests.json', 'http-smoke.redacted.json',
    'migration-hashes.before.json', 'migration-hashes.after.json',
    'openapi-conformance.json', 'agent-egress-key-diff.json', 'feishu-field-diff.json',
    'source-manifest.before.json', 'source-manifest.after.json',
    'TEST_REPORT.md', 'release-manifest.json'
  ]
  await shaSums(evidenceDirectory, evidenceFiles)

  process.stdout.write(`${JSON.stringify({
    status: localStatus,
    evidenceDirectory: relative(evidenceDirectory),
    files: evidenceFiles.length + 1,
    externalCalls: 0,
    postgres: postgres.status
  })}\n`)
  if (localStatus === 'LOCAL_LEVEL1_LEVEL2_VERIFICATION_FAILED') process.exitCode = 1
  if (localStatus === 'LOCAL_LEVEL1_LEVEL2_VERIFICATION_INVALIDATED_SOURCE_CHANGED') process.exitCode = 2
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      status: 'LOCAL_EVIDENCE_GENERATION_FAILED',
      errorClass: error instanceof Error ? error.name : 'UnknownError',
      errorDigest: sha256(error instanceof Error ? `${error.name}:${error.message}` : String(error))
    })}\n`)
    process.exitCode = 1
  })
}

module.exports = {
  cleanEnvironment, filesUnder, integrationDiffEvidence, main, migrationManifest, validateEvidenceRoot
}
