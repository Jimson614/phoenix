'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const sandboxRoot = path.resolve(__dirname, '..')
const projectRoot = path.resolve(sandboxRoot, '..', '..')
const repositoryRoot = path.resolve(projectRoot, '..', '..')
const migrationsDirectory = path.join(sandboxRoot, 'migrations')
const fixturePath = path.join(sandboxRoot, 'fixtures', '001_two_synthetic_families.sql')
const runSuffix = String(process.env.FAMILY_CORE_RUN_SUFFIX || `local_${process.pid}`)
  .toLowerCase()
  .replace(/[^a-z0-9_]/g, '_')
  .slice(0, 24)
const primaryDatabase = `family_core_gate_${runSuffix}`
const restoreDatabase = `family_core_restore_${runSuffix}`
const baseUrl = process.env.FAMILY_CORE_PG_URL || 'postgresql://postgres@127.0.0.1:5432/postgres'
const keepDatabases = process.env.FAMILY_CORE_KEEP_DATABASES === '1'
const startedAt = new Date().toISOString()
const defaultEvidenceDirectory = path.join(
  sandboxRoot,
  'artifacts',
  startedAt.replace(/[:.]/g, '-'),
)
const evidenceDirectory = path.resolve(process.env.FAMILY_CORE_EVIDENCE_DIR || defaultEvidenceDirectory)
const dumpPath = path.join(evidenceDirectory, 'family-core-synthetic.backup')
const results = []

fs.mkdirSync(evidenceDirectory, { recursive: true })

function redact(value) {
  return String(value)
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+):[^@\s/]+@/gi, '$1:[REDACTED]@')
    .replace(/PGPASSWORD=[^\s]+/gi, 'PGPASSWORD=[REDACTED]')
}

function run(command, args, options = {}) {
  const completed = spawnSync(command, args, {
    cwd: options.cwd || repositoryRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    windowsHide: true,
  })
  if (completed.error) throw completed.error
  const stdout = completed.stdout || ''
  const stderr = completed.stderr || ''
  if (!options.allowFailure && completed.status !== 0) {
    throw new Error(redact(`${command} failed (${completed.status})\n${stdout}\n${stderr}`))
  }
  return { status: completed.status, stdout, stderr }
}

function databaseUrl(databaseName) {
  const parsed = new URL(baseUrl)
  parsed.pathname = `/${databaseName}`
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

function psql(databaseName, sql, options = {}) {
  const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', databaseUrl(databaseName)]
  if (options.file) args.push('-f', options.file)
  else args.push('-c', sql)
  return run('psql', args, { allowFailure: options.allowFailure })
}

function query(databaseName, sql) {
  return psql(databaseName, sql).stdout.trim()
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function record(name, passed, evidence) {
  const item = { name, status: passed ? 'PASS' : 'FAIL', evidence: String(evidence) }
  results.push(item)
  if (!passed) throw new Error(`${name}: ${evidence}`)
}

function assertEqual(name, actual, expected) {
  record(name, String(actual) === String(expected), `actual=${actual}; expected=${expected}`)
}

function expectSqlFailure(databaseName, name, sql, expectedMessage) {
  const completed = psql(databaseName, sql, { allowFailure: true })
  const combined = redact(`${completed.stdout}\n${completed.stderr}`)
  const passed = completed.status !== 0 && combined.includes(expectedMessage)
  record(name, passed, `exit=${completed.status}; expected=${expectedMessage}; matched=${combined.includes(expectedMessage)}`)
}

function contextSql(userId, familyId, sql, syntheticMode = false) {
  return `
    SET ROLE phoenix_core_app;
    SET phoenix.actor_user_id = ${sqlLiteral(userId)};
    SET phoenix.family_id = ${sqlLiteral(familyId)};
    SET phoenix.synthetic_mode = ${sqlLiteral(syntheticMode ? 'on' : 'off')};
    ${sql}
  `
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function migrationFiles(direction) {
  const pattern = direction === 'up'
    ? /^(\d+)_([a-z0-9_]+)\.up\.sql$/
    : /^(\d+)_([a-z0-9_]+)\.down\.sql$/
  return fs.readdirSync(migrationsDirectory)
    .filter((name) => pattern.test(name))
    .sort((left, right) => direction === 'up' ? left.localeCompare(right) : right.localeCompare(left))
    .map((name) => {
      const match = name.match(pattern)
      return {
        version: match[1],
        name: match[2],
        fileName: name,
        filePath: path.join(migrationsDirectory, name),
        checksum: sha256(path.join(migrationsDirectory, name)),
      }
    })
}

function bootstrapLedger(databaseName) {
  psql(databaseName, `
    CREATE TABLE IF NOT EXISTS public.family_core_schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
  `)
}

function applyMigrations(databaseName) {
  bootstrapLedger(databaseName)
  const applied = []
  for (const migration of migrationFiles('up')) {
    const existing = query(databaseName, `
      SELECT checksum FROM public.family_core_schema_migrations
      WHERE version = ${sqlLiteral(migration.version)};
    `)
    if (existing) {
      if (existing !== migration.checksum) {
        throw new Error(`MIGRATION_CHECKSUM_DRIFT:${migration.fileName}`)
      }
      continue
    }
    psql(databaseName, '', { file: migration.filePath })
    psql(databaseName, `
      INSERT INTO public.family_core_schema_migrations (version, name, checksum)
      VALUES (
        ${sqlLiteral(migration.version)},
        ${sqlLiteral(migration.name)},
        ${sqlLiteral(migration.checksum)}
      );
    `)
    applied.push(migration)
  }
  return applied
}

function rollbackMigrations(databaseName) {
  const rolledBack = []
  for (const migration of migrationFiles('down')) {
    const applied = query(databaseName, `
      SELECT count(*) FROM public.family_core_schema_migrations
      WHERE version = ${sqlLiteral(migration.version)};
    `)
    if (applied !== '1') continue
    psql(databaseName, '', { file: migration.filePath })
    psql(databaseName, `
      DELETE FROM public.family_core_schema_migrations
      WHERE version = ${sqlLiteral(migration.version)};
    `)
    rolledBack.push(migration)
  }
  return rolledBack
}

function recreateDatabase(databaseName) {
  run('dropdb', ['--if-exists', '--force', '--maintenance-db', baseUrl, databaseName])
  run('createdb', ['--maintenance-db', baseUrl, databaseName])
}

function dropDatabase(databaseName) {
  run('dropdb', ['--if-exists', '--force', '--maintenance-db', baseUrl, databaseName], { allowFailure: true })
}

const snapshotTables = [
  'public.family_core_schema_migrations',
  'core.members',
  'core.users',
  'core.auth_identities',
  'core.families',
  'core.family_memberships',
  'core.students',
  'core.guardians',
  'core.guardian_student_relationships',
  'core.consents',
  'core.consent_events',
  'core.external_identity_mappings',
  'core.identity_migration_candidates',
  'core.roles',
  'core.permissions',
  'core.role_permissions',
  'core.role_assignments',
  'entitlement.service_entitlements',
  'domain.compass_results',
  'domain.journeys',
  'domain.timeline_events',
  'domain.blueprints',
  'domain.adapter_traces',
  'audit.audit_logs',
]

function snapshot(databaseName) {
  const values = {}
  for (const tableName of snapshotTables) {
    values[tableName] = query(databaseName, `
      SELECT count(*)::text || '|' ||
        md5(COALESCE(string_agg(row_to_json(snapshot_row)::text, '|' ORDER BY row_to_json(snapshot_row)::text), ''))
      FROM ${tableName} snapshot_row;
    `)
  }
  return values
}

const fixtures = {
  familyA: 'fam_00000000000040008000000000000001',
  familyB: 'fam_00000000000040008000000000000002',
  userA: 'usr_00000000000040008000000000000001',
  userB: 'usr_00000000000040008000000000000002',
  scoringConsentA: '15000000-0000-4000-8000-000000000001',
  longitudinalConsentA: '15000000-0000-4000-8000-000000000002',
  scoringConsentB: '25000000-0000-4000-8000-000000000001',
  longitudinalConsentB: '25000000-0000-4000-8000-000000000002',
}

function adapterCall(family, sourceStudent, sourceAssessment, scoringConsent, longitudinalConsent, ids, hash) {
  return `SELECT receipt_status FROM domain.ingest_education_synthetic(
    ${sqlLiteral(family)}, ${sqlLiteral(sourceStudent)}, ${sqlLiteral(sourceAssessment)},
    ${sqlLiteral(scoringConsent)}::uuid, ${sqlLiteral(longitudinalConsent)}::uuid,
    ${sqlLiteral(hash)}, ${sqlLiteral(ids.result)}::uuid, ${sqlLiteral(ids.journey)}::uuid,
    ${sqlLiteral(ids.timeline)}::uuid, ${sqlLiteral(ids.blueprint)}::uuid,
    ${sqlLiteral(ids.trace)}::uuid, ${sqlLiteral(ids.audit)}::uuid
  );`
}

const adapterA = {
  result: '81000000-0000-4000-8000-000000000001',
  journey: '82000000-0000-4000-8000-000000000001',
  timeline: '83000000-0000-4000-8000-000000000001',
  blueprint: '84000000-0000-4000-8000-000000000001',
  trace: '85000000-0000-4000-8000-000000000001',
  audit: '86000000-0000-4000-8000-000000000001',
}
const adapterB = {
  result: '91000000-0000-4000-8000-000000000001',
  journey: '92000000-0000-4000-8000-000000000001',
  timeline: '93000000-0000-4000-8000-000000000001',
  blueprint: '94000000-0000-4000-8000-000000000001',
  trace: '95000000-0000-4000-8000-000000000001',
  audit: '96000000-0000-4000-8000-000000000001',
}
const hashA = '1'.repeat(64)
const hashB = '2'.repeat(64)

function writeEvidence(evidence) {
  const jsonPath = path.join(evidenceDirectory, 'family-core-gate-evidence.json')
  const markdownPath = path.join(evidenceDirectory, 'FAMILY_CORE_SANDBOX_GATE_EVIDENCE.md')
  fs.writeFileSync(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`)
  const testLines = evidence.tests.map((test) => `- ${test.status === 'PASS' ? 'PASS' : 'FAIL'} — ${test.name}: ${test.evidence}`)
  const migrationLines = evidence.migrations.map((migration) => `- ${migration.fileName}: \`${migration.checksum}\``)
  const markdown = [
    '# Family Core PostgreSQL Sandbox Gate Evidence',
    '',
    `Status: \`${evidence.status}\``,
    `Started: ${evidence.startedAt}`,
    `Completed: ${evidence.completedAt}`,
    `Repository SHA: \`${evidence.repository.sha}\``,
    `Branch: \`${evidence.repository.branch}\``,
    `PostgreSQL: \`${evidence.postgresql.serverVersion || 'unavailable'}\``,
    '',
    '## Migration checksums',
    '',
    ...migrationLines,
    '',
    '## Gate tests',
    '',
    ...testLines,
    '',
    '## Backup / restore',
    '',
    `- Dump format: PostgreSQL custom archive`,
    `- Dump SHA-256: \`${evidence.backup.dumpSha256 || 'not-created'}\``,
    `- Reconciliation tables: ${Object.keys(evidence.backup.snapshot || {}).length}`,
    `- Restored snapshot match: ${evidence.backup.restoredSnapshotMatch ? 'PASS' : 'FAIL'}`,
    '',
    'Only deterministic synthetic fixtures are present. No production connection string or credential is recorded.',
    '',
  ].join('\n')
  fs.writeFileSync(markdownPath, markdown)
  return { jsonPath, markdownPath }
}

let evidence = {
  schemaVersion: 1,
  status: 'FAIL',
  startedAt,
  completedAt: null,
  repository: { sha: 'unknown', branch: 'unknown', dirty: true },
  postgresql: { clientVersion: 'unknown', serverVersion: null },
  databases: { primary: primaryDatabase, restore: restoreDatabase, retained: keepDatabases },
  migrations: migrationFiles('up').map(({ version, name, fileName, checksum }) => ({
    version,
    name,
    fileName,
    checksum,
  })),
  fixtures: { path: path.relative(repositoryRoot, fixturePath).replaceAll('\\', '/'), syntheticOnly: true },
  tests: results,
  backup: { path: path.basename(dumpPath), dumpSha256: null, snapshot: {}, restoredSnapshotMatch: false },
  error: null,
}

try {
  evidence.repository.sha = run('git', ['rev-parse', 'HEAD']).stdout.trim()
  evidence.repository.branch = run('git', ['branch', '--show-current']).stdout.trim()
  evidence.repository.dirty = Boolean(run('git', ['status', '--porcelain', '--untracked-files=no']).stdout.trim())
  evidence.postgresql.clientVersion = run('psql', ['--version']).stdout.trim()

  recreateDatabase(primaryDatabase)
  recreateDatabase(restoreDatabase)
  const applied = applyMigrations(primaryDatabase)
  assertEqual('empty database migration count', applied.length, 3)
  assertEqual('migration ledger count', query(primaryDatabase, 'SELECT count(*) FROM public.family_core_schema_migrations;'), 3)
  evidence.postgresql.serverVersion = query(primaryDatabase, 'SHOW server_version;')

  psql(primaryDatabase, '', { file: fixturePath })
  assertEqual('exactly two synthetic families', query(primaryDatabase, 'SELECT count(*) FROM core.families;'), 2)
  assertEqual('two adult and two minor members', query(primaryDatabase, `SELECT count(*) FROM core.members WHERE member_kind = 'ADULT';`), 2)
  assertEqual('two minor members', query(primaryDatabase, `SELECT count(*) FROM core.members WHERE member_kind = 'MINOR';`), 2)
  assertEqual('account principals are adults', query(primaryDatabase, `
    SELECT count(*) FROM core.users u JOIN core.members m USING (member_pk)
    WHERE m.member_kind <> 'ADULT';
  `), 0)
  assertEqual('fixtures contain synthetic labels only', query(primaryDatabase, `
    SELECT count(*) FROM core.families WHERE display_label NOT LIKE 'SYNTHETIC_%';
  `), 0)

  expectSqlFailure(primaryDatabase, 'test account promotion is denied', `
    SELECT core.promote_migration_candidate(
      '61000000-0000-4000-8000-000000000001',
      '${fixtures.userA}', '${fixtures.userA}',
      '71000000-0000-4000-8000-000000000001', 'test-account-exclusion'
    );
  `, 'TEST_ACCOUNT_EXCLUDED')
  expectSqlFailure(primaryDatabase, 'ambiguous contact hint cannot auto-merge', `
    SELECT core.promote_migration_candidate(
      '61000000-0000-4000-8000-000000000002',
      '${fixtures.userA}', '${fixtures.userA}',
      '71000000-0000-4000-8000-000000000002', 'conflict-denial'
    );
  `, 'SOURCE_MAPPING_CONFLICT')
  assertEqual('conflict candidates remain unmapped', query(primaryDatabase, `
    SELECT count(*) FROM core.identity_migration_candidates
    WHERE match_hint_hash = '${'c'.repeat(64)}' AND resolved_core_id IS NOT NULL;
  `), 0)

  query(primaryDatabase, `
    SELECT core.promote_migration_candidate(
      '61000000-0000-4000-8000-000000000004',
      '${fixtures.userA}', '${fixtures.userA}',
      '71000000-0000-4000-8000-000000000004', 'auth-uuid-preservation'
    );
  `)
  assertEqual('Auth UUID preserved through reviewed mapping', query(primaryDatabase, `
    SELECT count(*)
    FROM core.external_identity_mappings m
    JOIN core.auth_identities ai
      ON ai.user_id = m.phoenix_core_id
     AND ai.auth_subject_uuid = m.source_auth_uuid
    WHERE m.mapping_id = '71000000-0000-4000-8000-000000000004';
  `), 1)
  assertEqual('test account has no active mapping', query(primaryDatabase, `
    SELECT count(*) FROM core.external_identity_mappings
    WHERE source_id = 'test_account_synthetic_001';
  `), 0)

  const callA = adapterCall(
    fixtures.familyA, 'edu_student_synthetic_a', 'edu_assessment_synthetic_a',
    fixtures.scoringConsentA, fixtures.longitudinalConsentA, adapterA, hashA,
  )
  const callB = adapterCall(
    fixtures.familyB, 'edu_student_synthetic_b', 'edu_assessment_synthetic_b',
    fixtures.scoringConsentB, fixtures.longitudinalConsentB, adapterB, hashB,
  )
  assertEqual('Education adapter accepts family A', query(primaryDatabase, contextSql(fixtures.userA, fixtures.familyA, callA, true)), 'ACCEPTED')
  assertEqual('Education adapter accepts family B', query(primaryDatabase, contextSql(fixtures.userB, fixtures.familyB, callB, true)), 'ACCEPTED')
  assertEqual('Education adapter exact replay is idempotent', query(primaryDatabase, contextSql(fixtures.userA, fixtures.familyA, callA, true)), 'DUPLICATE')
  expectSqlFailure(primaryDatabase, 'Education adapter changed replay is denied', contextSql(
    fixtures.userA,
    fixtures.familyA,
    adapterCall(
      fixtures.familyA, 'edu_student_synthetic_a', 'edu_assessment_synthetic_a',
      fixtures.scoringConsentA, fixtures.longitudinalConsentA, adapterA, '3'.repeat(64),
    ),
    true,
  ), 'IDEMPOTENCY_CONFLICT')

  assertEqual('adapter trace links student assessment result and journey', query(primaryDatabase, `
    SELECT count(*) FROM domain.adapter_traces at
    JOIN domain.compass_results cr ON cr.result_id = at.result_id
    JOIN domain.journeys j ON j.journey_id = at.journey_id
    JOIN core.external_identity_mappings m ON m.mapping_id = at.mapping_id
    WHERE at.source_system = 'EDUCATION_COMPASS'
      AND m.entity_type = 'STUDENT';
  `), 2)

  assertEqual('family A RLS sees one result', query(primaryDatabase, contextSql(
    fixtures.userA, fixtures.familyA, 'SELECT count(*) FROM domain.compass_results;',
  )), 1)
  assertEqual('family B RLS sees one result', query(primaryDatabase, contextSql(
    fixtures.userB, fixtures.familyB, 'SELECT count(*) FROM domain.compass_results;',
  )), 1)
  assertEqual('family A cannot switch to family B by tampering context', query(primaryDatabase, contextSql(
    fixtures.userA, fixtures.familyB, 'SELECT count(*) FROM domain.compass_results;',
  )), 0)
  expectSqlFailure(primaryDatabase, 'tampered family_id is denied by adapter', contextSql(
    fixtures.userA,
    fixtures.familyA,
    adapterCall(
      fixtures.familyB, 'edu_student_synthetic_b', 'edu_assessment_tamper_family',
      fixtures.scoringConsentB, fixtures.longitudinalConsentB,
      { ...adapterB, result: '91000000-0000-4000-8000-000000000011' }, '4'.repeat(64),
    ),
    true,
  ), 'FAMILY_CONTEXT_MISMATCH')
  expectSqlFailure(primaryDatabase, 'tampered member mapping is denied', contextSql(
    fixtures.userA,
    fixtures.familyA,
    adapterCall(
      fixtures.familyA, 'edu_student_synthetic_b', 'edu_assessment_tamper_member',
      fixtures.scoringConsentA, fixtures.longitudinalConsentA,
      { ...adapterB, result: '91000000-0000-4000-8000-000000000012' }, '5'.repeat(64),
    ),
    true,
  ), 'ENTITLEMENT_REQUIRED')

  expectSqlFailure(primaryDatabase, 'timeline is append-only', `
    UPDATE domain.timeline_events SET summary_code = 'MUTATED'
    WHERE event_id = '${adapterA.timeline}';
  `, 'APPEND_ONLY_RECORD')
  expectSqlFailure(primaryDatabase, 'consent evidence is append-only', `
    DELETE FROM core.consent_events
    WHERE consent_event_id = '16000000-0000-4000-8000-000000000001';
  `, 'APPEND_ONLY_RECORD')

  assertEqual('longitudinal record visible before consent withdrawal', query(primaryDatabase, contextSql(
    fixtures.userA, fixtures.familyA, 'SELECT count(*) FROM domain.journeys;',
  )), 1)
  query(primaryDatabase, `
    SELECT core.withdraw_consent(
      '${fixtures.longitudinalConsentA}', '${fixtures.userA}',
      'SYNTHETIC_WITHDRAWAL_TEST', 'withdraw-consent-test',
      '87000000-0000-4000-8000-000000000001',
      '88000000-0000-4000-8000-000000000001'
    );
  `)
  assertEqual('consent withdrawal immediately removes journey visibility', query(primaryDatabase, contextSql(
    fixtures.userA, fixtures.familyA, 'SELECT count(*) FROM domain.journeys;',
  )), 0)
  expectSqlFailure(primaryDatabase, 'withdrawn consent denies new adapter write', contextSql(
    fixtures.userA,
    fixtures.familyA,
    adapterCall(
      fixtures.familyA, 'edu_student_synthetic_a', 'edu_assessment_after_consent_withdrawal',
      fixtures.scoringConsentA, fixtures.longitudinalConsentA,
      { ...adapterA, result: '81000000-0000-4000-8000-000000000021' }, '6'.repeat(64),
    ),
    true,
  ), 'LONGITUDINAL_AUTHORITY_DENIED')

  assertEqual('minor result visible before guardian withdrawal', query(primaryDatabase, contextSql(
    fixtures.userA, fixtures.familyA, 'SELECT count(*) FROM domain.compass_results;',
  )), 1)
  query(primaryDatabase, `
    SELECT core.withdraw_guardian_authority(
      '13000000-0000-4000-8000-000000000001', '${fixtures.userA}',
      'SYNTHETIC_WITHDRAWAL_TEST', 'withdraw-guardian-test',
      '89000000-0000-4000-8000-000000000001'
    );
  `)
  assertEqual('guardian withdrawal immediately removes minor result visibility', query(primaryDatabase, contextSql(
    fixtures.userA, fixtures.familyA, 'SELECT count(*) FROM domain.compass_results;',
  )), 0)
  assertEqual('family B remains isolated and available', query(primaryDatabase, contextSql(
    fixtures.userB, fixtures.familyB, 'SELECT count(*) FROM domain.compass_results;',
  )), 1)

  evidence.backup.snapshot = snapshot(primaryDatabase)
  run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', dumpPath, databaseUrl(primaryDatabase)])
  evidence.backup.dumpSha256 = sha256(dumpPath)
  run('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', databaseUrl(restoreDatabase), dumpPath])
  const restoredSnapshot = snapshot(restoreDatabase)
  evidence.backup.restoredSnapshotMatch = JSON.stringify(restoredSnapshot) === JSON.stringify(evidence.backup.snapshot)
  record('backup restore row-count and checksum reconciliation', evidence.backup.restoredSnapshotMatch, `${snapshotTables.length} tables compared`)

  const rolledBack = rollbackMigrations(primaryDatabase)
  assertEqual('rollback migration count', rolledBack.length, 3)
  assertEqual('rollback removes Core and domain schemas', query(primaryDatabase, `
    SELECT count(*) FROM information_schema.schemata
    WHERE schema_name IN ('core', 'domain', 'entitlement', 'audit');
  `), 0)
  psql(primaryDatabase, 'DROP TABLE public.family_core_schema_migrations;')

  const reapplied = applyMigrations(primaryDatabase)
  assertEqual('post-rollback empty rebuild migration count', reapplied.length, 3)
  assertEqual('post-rollback migration ledger count', query(primaryDatabase, 'SELECT count(*) FROM public.family_core_schema_migrations;'), 3)

  evidence.status = 'PASS'
} catch (error) {
  evidence.error = redact(error && error.stack ? error.stack : error)
  process.exitCode = 1
} finally {
  evidence.completedAt = new Date().toISOString()
  evidence.tests = results
  const paths = writeEvidence(evidence)
  if (!keepDatabases) {
    dropDatabase(primaryDatabase)
    dropDatabase(restoreDatabase)
  }
  console.log(`FAMILY_CORE_GATE=${evidence.status}`)
  console.log(`EVIDENCE_JSON=${paths.jsonPath}`)
  console.log(`EVIDENCE_MD=${paths.markdownPath}`)
  if (evidence.error) console.error(evidence.error)
}
