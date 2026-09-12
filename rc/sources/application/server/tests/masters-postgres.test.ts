import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Pool, type PoolConfig } from 'pg'
import test from 'node:test'
import type {
  MastersConsultation,
  MastersDocument,
  MastersProfile,
  MastersReport,
  MastersReportJob,
  MastersReportPayload,
  MastersSnapshot
} from '../src/domain/masters/contracts'
import { PostgresStore } from '../src/store/postgres-store'
import { MastersService } from '../src/services/masters-service'
import { runMastersPostgresHttpFlow, MastersPostgresHttpFlowResult } from './fixtures/masters-postgres-http-flow'

/**
 * This suite is intentionally separate from the in-memory/domain suites. It
 * mutates only a UUID-named schema inside an explicitly disposable database.
 * The script wrapper performs the same guard before invoking the compiled
 * test, while these checks keep direct `node --test` invocation honest.
 */
const databaseUrl = process.env.MASTERS_TEST_DATABASE_URL || ''
const applicationUrl = process.env.MASTERS_TEST_APP_DATABASE_URL || ''
const { testDatabaseUrl, applicationDatabaseUrl, verifyConnection } = require(resolve(__dirname, '../../../scripts/ci/postgres-guard.js')) as {
  testDatabaseUrl(value: string, label?: string): URL
  applicationDatabaseUrl(migration: URL, value: string): URL
  verifyConnection(pool: Pool, options?: { application?: boolean }): Promise<Record<string, unknown>>
}
const mutationApproved = process.env.MASTERS_TEST_DATABASE_ALLOW_MUTATION === 'YES'
const migrationDirectory = resolve(__dirname, '../../migrations')
const masterTables = [
  'masters_consultations',
  'masters_staff',
  'masters_consultation_consents',
  'masters_consultation_documents',
  'masters_consultation_snapshots',
  'masters_consultation_assignments',
  'masters_reports',
  'masters_report_jobs',
  'masters_audit_logs',
  'masters_idempotency_records'
] as const
const legacyTables = [
  'users',
  'integration_links',
  'agent_consents',
  'agent_conversations',
  'agent_messages',
  'agent_runs',
  'agent_worker_heartbeats',
  'consent_grants',
  'product_deliverables',
  'idempotency_records',
  'advisor_requests'
] as const
const NOW = '2026-09-05T00:00:00.000Z'

function databaseSentinelError(): string | null {
  if (!databaseUrl) return 'MASTERS_TEST_DATABASE_URL is not configured; no database connection was attempted'
  if (!mutationApproved) return 'MASTERS_TEST_DATABASE_ALLOW_MUTATION=YES is required; no database connection was attempted'
  if (!applicationUrl) return 'MASTERS_TEST_APP_DATABASE_URL is required for the separate DML-only HTTP application role'
  let parsed: URL
  try {
    parsed = testDatabaseUrl(databaseUrl, 'Masters migration database')
    applicationDatabaseUrl(parsed, applicationUrl)
  } catch (error) {
    return (error as Error).message
  }
  return null
}

const guardError = databaseSentinelError()
if (guardError) {
  process.stdout.write(`${JSON.stringify({
    status: databaseUrl && mutationApproved && applicationUrl ? 'FAIL' : 'BLOCKED_EXTERNAL',
    suite: 'masters-postgres',
    databaseConnectionAttempted: false,
    reason: guardError
  })}\n`)
  if (databaseUrl && mutationApproved && applicationUrl) process.exitCode = 2
}

function quoteIdentifier(value: string): string {
  if (!/^masters_test_[0-9a-f]{32}$/.test(value)) throw new Error('Unexpected isolated schema name')
  return `"${value}"`
}

function migrationBody(raw: string): string {
  return raw
    .replace(/^\s*BEGIN\s*;\s*/i, '')
    .replace(/\s*COMMIT\s*;\s*$/i, '')
}

function poolConfig(schema: string, connectionString = databaseUrl): PoolConfig {
  return {
    connectionString,
    max: 4,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'phoenix-masters-postgres-test',
    // The schema is generated locally and never accepted from the caller.
    options: `-c search_path=${schema}`
  }
}

async function migrationNames(): Promise<string[]> {
  const names = (await readdir(migrationDirectory))
    .filter((name) => /^\d+_[A-Za-z0-9_-]+\.sql$/.test(name))
    .sort()
  assert.ok(names.some((name) => /^006_/.test(name)), '006_masters_intake.sql must be present before this suite runs')
  return names
}

interface IsolatedDatabase {
  readonly schema: string
  readonly bootstrap: Pool
  readonly config: PoolConfig
  getPool(): Pool
  applyAll(): Promise<string[]>
  schemaExists(): Promise<boolean>
  rollbackMastersMigration(migrationName: string): Promise<void>
  cleanup(): Promise<void>
}

async function createIsolatedDatabase(): Promise<IsolatedDatabase> {
  const schema = `masters_test_${randomUUID().replaceAll('-', '')}`
  const bootstrap = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'phoenix-masters-postgres-bootstrap'
  })
  let pool: Pool | undefined
  let schemaCreated = false
  const createSchema = async (): Promise<void> => {
    const client = await bootstrap.connect()
    try {
      await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`)
      schemaCreated = true
    } finally {
      client.release()
    }
  }
  const dropSchema = async (): Promise<void> => {
    const client = await bootstrap.connect()
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`)
      schemaCreated = false
    } finally {
      client.release()
    }
  }

  try {
    await verifyConnection(bootstrap)
    await createSchema()
    pool = new Pool(poolConfig(schema))
    const isolated: IsolatedDatabase = {
      schema,
      bootstrap,
      config: poolConfig(schema),
      getPool: () => {
        if (!pool) throw new Error('Isolated PostgreSQL pool is closed')
        return pool
      },
      applyAll: async () => {
        const names = await migrationNames()
        const activePool = isolated.getPool()
        const client = await activePool.connect()
        try {
          await client.query(`SET search_path TO ${quoteIdentifier(schema)}`)
          await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
              name text PRIMARY KEY,
              checksum char(64) NOT NULL,
              applied_at timestamptz NOT NULL DEFAULT now()
            )
          `)
          for (const name of names) {
            const raw = await readFile(resolve(migrationDirectory, name), 'utf8')
            const checksum = createHash('sha256').update(raw).digest('hex')
            const applied = await client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name])
            if (applied.rowCount) {
              assert.equal(applied.rows[0]?.checksum, checksum, `Applied migration checksum changed: ${name}`)
              continue
            }
            await client.query('BEGIN')
            try {
              await client.query(migrationBody(raw))
              await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [name, checksum])
              await client.query('COMMIT')
            } catch (error) {
              await client.query('ROLLBACK').catch(() => undefined)
              throw error
            }
          }
        } finally {
          client.release()
        }
        return names
      },
      schemaExists: async () => {
        const client = await bootstrap.connect()
        try {
          const result = await client.query('SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists', [schema])
          return result.rows[0]?.exists === true
        } finally {
          client.release()
        }
      },
      rollbackMastersMigration: async (migrationName: string) => {
        assert.match(migrationName, /^006_[A-Za-z0-9_-]+\.sql$/, 'Only migration 006 may be rolled back by this suite')
        const raw = await readFile(resolve(migrationDirectory, 'rollback', '006_masters_intake.down.sql'), 'utf8')
        const activePool = isolated.getPool()
        const client = await activePool.connect()
        try {
          await client.query('BEGIN')
          try {
            await client.query(`SET LOCAL search_path TO ${quoteIdentifier(schema)}`)
            // Execute the checked-in down migration itself. Do not replace
            // this with DROP SCHEMA: legacy migrations 001-005 must survive.
            await client.query(migrationBody(raw))
            await client.query('DELETE FROM schema_migrations WHERE name = $1', [migrationName])
            await client.query('COMMIT')
          } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined)
            throw error
          }
        } finally {
          client.release()
        }
      },
      cleanup: async () => {
        if (pool) {
          await pool.end()
          pool = undefined
        }
        if (schemaCreated) {
          await dropSchema()
          assert.equal(await isolated.schemaExists(), false, 'cleanup must drop only the isolated UUID schema')
        }
        await bootstrap.end()
      }
    }
    return isolated
  } catch (error) {
    if (pool) await pool.end().catch(() => undefined)
    if (schemaCreated) await dropSchema().catch(() => undefined)
    await bootstrap.end().catch(() => undefined)
    throw error
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function profileFor(name: string): MastersProfile {
  return {
    name,
    adultConfirmed: true,
    contact: { type: 'email', value: `${name.toLowerCase().replaceAll(' ', '-')}@example.invalid` },
    educationStatus: 'ENROLLED',
    institution: 'Synthetic University',
    major: 'Computer Science',
    degree: 'Bachelor of Science',
    graduationDate: '2027-06',
    averageScore: '86.5',
    gpa: '3.72',
    gpaScale: '4.0',
    classRank: '12/120',
    languageStatus: 'NONE',
    languageType: 'NONE',
    languageScores: null,
    targetYear: '2028',
    targetMajors: ['Computer Science'],
    targetInstitutions: ['Synthetic University'],
    targetPreference: '等待顾问建议',
    experiences: [],
    accuracyConfirmed: false
  }
}

function consultationFor(id: string, userId: string, applicationSeason: string): MastersConsultation {
  return {
    id,
    userId,
    linkedStudentId: null,
    applicationSeason,
    channel: 'synthetic-test',
    path: 'guided-form',
    status: 'DRAFT',
    profile: profileFor(`Synthetic ${id}`),
    profileVersion: 1,
    accuracyConfirmed: false,
    serviceConsentId: null,
    confirmedSnapshotId: null,
    submittedAt: null,
    withdrawnAt: null,
    createdAt: NOW,
    updatedAt: NOW
  }
}

function documentFor(id: string, consultationId: string, userId: string, page: number): MastersDocument {
  const content = `synthetic-document-${id}`
  return {
    id,
    consultationId,
    userId,
    type: 'TRANSCRIPT',
    storageKey: randomUUID(),
    originalName: `synthetic-transcript-${page}.pdf`,
    description: 'Synthetic page used only by isolated PostgreSQL tests',
    mimeType: 'application/pdf',
    sizeBytes: content.length,
    sha256: digest(content),
    profileVersion: 1,
    uploadStatus: 'UPLOADED',
    extractionStatus: 'NEEDS_CONFIRMATION',
    extraction: {
      status: 'NEEDS_CONFIRMATION',
      fields: { averageScore: '86.5', gpa: '3.72', gpaScale: '4.0' },
      source: 'synthetic-fixture',
      evidence: [{ field: 'gpa', location: `page:${page}`, excerpt: 'GPA: 3.72 / 4.0', confidence: 'HIGH' }],
      conflicts: [],
      errorCode: null
    },
    uploadedAt: NOW,
    updatedAt: NOW,
    removedAt: null
  }
}

function snapshotFor(consultation: MastersConsultation, documentIds: string[]): MastersSnapshot {
  return {
    id: `mss_${consultation.id}`,
    consultationId: consultation.id,
    userId: consultation.userId,
    profileVersion: consultation.profileVersion,
    profile: consultation.profile,
    documentIds,
    accuracyConfirmed: true,
    confirmedBy: consultation.userId,
    confirmedAt: NOW,
    createdAt: NOW
  }
}

function reportPayload(): MastersReportPayload {
  return {
    templateVersion: 'masters_application_report_v1.1',
    backgroundSummary: 'Synthetic applicant record',
    strengthsAndGaps: { strengths: ['structured thinking'], gaps: ['language score pending'] },
    suggestedDirections: [],
    candidatePrograms: [],
    preparationPlan: [],
    nextStepsAndLimitations: ['Synthetic fixture; no admission prediction'],
    missingFields: [],
    missingDocuments: ['LANGUAGE', 'ENROLLMENT'],
    verificationStatus: 'NEEDS_REVIEW'
  }
}

function reportFor(consultation: MastersConsultation, snapshot: MastersSnapshot): MastersReport {
  return {
    id: `mrp_${consultation.id}`,
    consultationId: consultation.id,
    snapshotId: snapshot.id,
    sourceProfileVersion: snapshot.profileVersion,
    version: 1,
    status: 'NOT_STARTED',
    templateVersion: 'masters_application_report_v1.1',
    payload: reportPayload(),
    editedBy: null,
    reviewedBy: null,
    approvedBy: null,
    releasedBy: null,
    reviewedAt: null,
    approvedAt: null,
    releasedAt: null,
    createdAt: NOW,
    updatedAt: NOW
  }
}

function jobFor(consultation: MastersConsultation, snapshot: MastersSnapshot, report: MastersReport): MastersReportJob {
  return {
    id: `mrj_${consultation.id}`,
    consultationId: consultation.id,
    snapshotId: snapshot.id,
    sourceProfileVersion: snapshot.profileVersion,
    reportId: report.id,
    status: 'QUEUED',
    attempts: 0,
    maxAttempts: 3,
    leaseToken: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    nextAttemptAt: NOW,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null
  }
}

if (guardError) {
  test('Masters PostgreSQL integration is blocked without a dedicated mutation database', { skip: guardError }, () => undefined)
} else {
  test('Masters PostgreSQL upgrade, rollback, persistence, ownership, concurrency, and lease invariants', async (t) => {
    const database = await createIsolatedDatabase()
    let store: PostgresStore | undefined
    try {
      const names = await database.applyAll()
      const mastersMigration = names.find((name) => /^006_/.test(name))
      assert.ok(mastersMigration)
      const legacyMigrationNames = names.filter((name) => /^00[1-5]_/.test(name))
      assert.equal(legacyMigrationNames.length, 5)
      await t.test('migration upgrade creates the complete Masters schema', async () => {
        const pool = database.getPool()
        const client = await pool.connect()
        try {
          const applied = await client.query('SELECT name, checksum FROM schema_migrations ORDER BY name')
          assert.equal(applied.rowCount, names.length)
          const raw = await readFile(resolve(migrationDirectory, mastersMigration), 'utf8')
          assert.equal(applied.rows.find((row) => row.name === mastersMigration)?.checksum, digest(raw))
          for (const table of masterTables) {
            const result = await client.query('SELECT to_regclass($1) AS relation', [`${database.schema}.${table}`])
            assert.ok(result.rows[0]?.relation, `missing ${table}`)
          }
        } finally {
          client.release()
        }
      })

      await database.rollbackMastersMigration(mastersMigration)
      await t.test('006 down migration removes only Masters objects and preserves 001-005', async () => {
        assert.equal(await database.schemaExists(), true)
        const pool = database.getPool()
        const applied = await pool.query('SELECT name FROM schema_migrations ORDER BY name')
        assert.deepEqual(applied.rows.map((row) => row.name), legacyMigrationNames)
        for (const table of masterTables) {
          const result = await pool.query('SELECT to_regclass($1) AS relation', [`${database.schema}.${table}`])
          assert.equal(result.rows[0]?.relation, null, `006 down migration left ${table}`)
        }
        for (const table of legacyTables) {
          const result = await pool.query('SELECT to_regclass($1) AS relation', [`${database.schema}.${table}`])
          assert.ok(result.rows[0]?.relation, `006 down migration removed legacy table ${table}`)
        }
      })

      const reupgradedNames = await database.applyAll()
      await t.test('006 re-upgrade restores Masters objects after the real down migration', async () => {
        assert.deepEqual(reupgradedNames, names)
        const pool = database.getPool()
        const applied = await pool.query('SELECT name FROM schema_migrations ORDER BY name')
        assert.deepEqual(applied.rows.map((row) => row.name), names)
        for (const table of masterTables) {
          const result = await pool.query('SELECT to_regclass($1) AS relation', [`${database.schema}.${table}`])
          assert.ok(result.rows[0]?.relation, `006 re-upgrade missing ${table}`)
        }
      })

      const appConfig = poolConfig(database.schema, applicationUrl)
      await t.test('verified TLS and separate HTTP application role enforce DML-only access', async () => {
        const role = decodeURIComponent(new URL(applicationUrl).username)
        assert.match(role, /^[a-z][a-z0-9_]{0,62}$/i)
        await database.getPool().query(`GRANT USAGE ON SCHEMA ${quoteIdentifier(database.schema)} TO "${role}"`)
        for (const table of ['users', 'wechat_identities', 'sessions', ...masterTables]) {
          await database.getPool().query(`GRANT SELECT, INSERT, UPDATE ON "${table}" TO "${role}"`)
        }
        await database.getPool().query(`GRANT SELECT ON schema_migrations TO "${role}"`)
        const application = new Pool(appConfig)
        try {
          await verifyConnection(application, { application: true })
          const permissionDenied = (error: unknown) => (error as { code?: string }).code === '42501'
          await assert.rejects(() => application.query('CREATE TABLE application_must_not_create (id text)'), permissionDenied)
          await assert.rejects(() => application.query(`DROP SCHEMA ${quoteIdentifier(database.schema)}`), permissionDenied)
          await assert.rejects(() => application.query('CREATE SCHEMA application_must_not_create'), permissionDenied)
          await assert.rejects(() => application.query('DELETE FROM schema_migrations'), permissionDenied)
          await assert.rejects(() => application.query('DELETE FROM masters_consultations'), permissionDenied)
          await assert.rejects(() => application.query('SELECT id FROM orders LIMIT 1'), permissionDenied)
          const owners = await application.query('SELECT COUNT(*)::int AS count FROM pg_class WHERE relnamespace = $1::regnamespace AND relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)', [database.schema])
          assert.equal(owners.rows[0]?.count, 0, 'HTTP role must not own application tables')
          const memberships = await application.query('SELECT COUNT(*)::int AS count FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user)')
          assert.equal(memberships.rows[0]?.count, 0, 'HTTP role cannot inherit a more privileged role')
        } finally { await application.end() }
      })

      store = new PostgresStore(appConfig)
      const ownerA = 'usr_masters_pg_owner_a'
      const ownerB = 'usr_masters_pg_owner_b'
      const consultation = consultationFor('mc_pg_primary', ownerA, '2028')
      const otherConsultation = consultationFor('mc_pg_other', ownerB, '2028')
      const pageOne = documentFor('md_pg_page_one', consultation.id, ownerA, 1)
      const pageTwo = documentFor('md_pg_page_two', consultation.id, ownerA, 2)
      const snapshot = snapshotFor(consultation, [pageOne.id, pageTwo.id])
      const report = reportFor(consultation, snapshot)
      const job = jobFor(consultation, snapshot, report)

      await store.transaction(async (tx) => {
        await tx.insert('users', { id: ownerA, role: 'family_user', createdAt: NOW })
        await tx.insert('users', { id: ownerB, role: 'family_user', createdAt: NOW })
        await tx.insert('mastersConsultations', consultation)
        await tx.insert('mastersConsultations', otherConsultation)
        await tx.insert('mastersDocuments', pageOne)
        await tx.insert('mastersDocuments', pageTwo)
        await tx.insert('mastersSnapshots', snapshot)
        await tx.insert('mastersReports', report)
        await tx.insert('mastersReportJobs', job)
      })

      await store.close()
      store = new PostgresStore(appConfig)
      await t.test('ordinary Store rows survive a real PostgreSQL reconnect with JSON and score scales intact', async () => {
        const restored = await store!.read(async (tx) => ({
          consultation: await tx.findById('mastersConsultations', consultation.id),
          documents: await tx.findMany('mastersDocuments', { consultationId: consultation.id }),
          snapshot: await tx.findById('mastersSnapshots', snapshot.id),
          report: await tx.findById('mastersReports', report.id),
          job: await tx.findById('mastersReportJobs', job.id)
        }))
        assert.deepEqual(restored.consultation?.profile, consultation.profile)
        assert.equal(restored.consultation?.profile.gpa, '3.72')
        assert.equal(restored.consultation?.profile.gpaScale, '4.0')
        assert.equal(restored.documents.length, 2)
        assert.deepEqual(restored.documents.map((item) => item.originalName).sort(), [
          'synthetic-transcript-1.pdf', 'synthetic-transcript-2.pdf'
        ])
        assert.equal(restored.documents.every((item) => item.type === 'TRANSCRIPT'), true)
        assert.equal(typeof restored.documents[0]?.sizeBytes, 'number')
        assert.equal(restored.documents[0]?.sizeBytes, pageOne.sizeBytes)
        assert.equal(restored.snapshot?.documentIds.length, 2)
        assert.equal(restored.report?.status, 'NOT_STARTED')
        assert.equal(restored.job?.status, 'QUEUED')
      })

      await t.test('foreign keys reject missing consultation and owner mismatch', async () => {
        const missingConsultation = documentFor('md_pg_missing_consultation', 'mc_does_not_exist', ownerA, 3)
        await assert.rejects(store!.transaction((tx) => tx.insert('mastersDocuments', missingConsultation)))

        const mismatchedOwner = documentFor('md_pg_wrong_owner', consultation.id, ownerB, 4)
        // The consultation/document owner pair must be enforced by the schema;
        // a client cannot attach another user to an existing consultation.
        await assert.rejects(store!.transaction((tx) => tx.insert('mastersDocuments', mismatchedOwner)))
      })

      await t.test('unique consultation season prevents concurrent duplicate creation', async () => {
        const first = consultationFor('mc_pg_duplicate_a', ownerA, '2029')
        const second = consultationFor('mc_pg_duplicate_b', ownerA, '2029')
        const results = await Promise.allSettled([
          store!.transaction((tx) => tx.insert('mastersConsultations', first)),
          store!.transaction((tx) => tx.insert('mastersConsultations', second))
        ])
        assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
        assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
        const persisted = await store!.read((tx) => tx.findMany('mastersConsultations', {
          userId: ownerA, applicationSeason: '2029'
        }))
        assert.equal(persisted.length, 1)
      })

      await t.test('expired worker lease fences a late completion from the old worker', async () => {
        let currentTime = new Date(NOW)
        let idSequence = 0
        const service = new MastersService(
          store!,
          () => new Date(currentTime),
          (prefix) => `${prefix}_pg_${++idSequence}`,
          { leaseMs: 60_000, maxAttempts: 3 }
        )

        const claimedByA = await service.claimJob('worker-a')
        assert.equal(claimedByA?.leaseOwner, 'worker-a')
        assert.equal(claimedByA?.attempts, 1)
        assert.equal(claimedByA?.leaseExpiresAt, '2026-09-05T00:01:00.000Z')
        const leaseTokenA = claimedByA?.leaseToken
        assert.equal(typeof leaseTokenA, 'string')

        // Move the controlled clock past A's lease. The real MastersService
        // must recover the job for B and mint a new lease token.
        currentTime = new Date('2026-09-05T00:01:01.000Z')
        const claimedByB = await service.claimJob('worker-b')
        assert.equal(claimedByB?.leaseOwner, 'worker-b')
        assert.equal(claimedByB?.attempts, 2)
        assert.equal(claimedByB?.leaseExpiresAt, '2026-09-05T00:02:01.000Z')
        const leaseTokenB = claimedByB?.leaseToken
        assert.equal(typeof leaseTokenB, 'string')
        assert.notEqual(leaseTokenA, leaseTokenB)

        const leaseConflict = (error: unknown) => (error as { code?: string })?.code === 'MASTERS_LEASE_CONFLICT'
        await assert.rejects(() => service.completeJob(job.id, leaseTokenA as string), leaseConflict)
        await assert.rejects(() => service.failJob(job.id, leaseTokenA as string, 'late-failure'), leaseConflict)

        const final = await store!.read((tx) => tx.findById('mastersReportJobs', job.id))
        assert.equal(final?.leaseOwner, 'worker-b')
        assert.equal(final?.leaseToken, leaseTokenB)
        assert.equal(final?.status, 'RUNNING')
        assert.equal(final?.lastError, null)
        const runningReport = await store!.read((tx) => tx.findById('mastersReports', report.id))
        assert.equal(runningReport?.status, 'RUNNING')

        // Finish the recovered worker-B lease before the next subtest.  A
        // RUNNING row with the controlled 00:02:01 expiry would otherwise be
        // eligible to the HTTP flow's real-time worker and contaminate its
        // queue assertions.
        const completedByB = await service.completeJob(job.id, leaseTokenB as string)
        assert.equal(completedByB.status, 'NEEDS_REVIEW')
        const cleanedJob = await store!.read((tx) => tx.findById('mastersReportJobs', job.id))
        assert.equal(cleanedJob?.status, 'NEEDS_REVIEW')
      })

      let httpFlow: MastersPostgresHttpFlowResult | undefined
      // Store-only fixtures above intentionally have no filesystem originals.
      // Remove just those generated owners before the joint DB/original backup
      // proof, so every remaining active document comes from real HTTP upload.
      await store.close()
      store = undefined
      const fixtureCleanup = await database.getPool().connect()
      try {
        await fixtureCleanup.query('BEGIN')
        await fixtureCleanup.query('DELETE FROM masters_report_jobs WHERE consultation_id = $1', [consultation.id])
        await fixtureCleanup.query('DELETE FROM masters_reports WHERE consultation_id = $1', [consultation.id])
        await fixtureCleanup.query('DELETE FROM masters_consultation_snapshots WHERE consultation_id = $1', [consultation.id])
        await fixtureCleanup.query('DELETE FROM masters_consultation_documents WHERE user_id = ANY($1::text[])', [[ownerA, ownerB]])
        await fixtureCleanup.query('DELETE FROM masters_consultations WHERE user_id = ANY($1::text[])', [[ownerA, ownerB]])
        await fixtureCleanup.query('DELETE FROM users WHERE id = ANY($1::text[])', [[ownerA, ownerB]])
        const remaining = await fixtureCleanup.query('SELECT COUNT(*)::int AS count FROM masters_consultation_documents')
        assert.equal(remaining.rows[0]?.count, 0, 'no metadata-only original may enter the joint backup proof')
        await fixtureCleanup.query('COMMIT')
      } catch (error) {
        await fixtureCleanup.query('ROLLBACK')
        throw error
      } finally { fixtureCleanup.release() }
      await t.test('real PostgresStore HTTP upload, restart, authorization, worker, review, approval, release, export, and withdrawal flow', async () => {
        const configuredPdfFontPath = process.env.MASTERS_TEST_PDF_FONT_PATH || process.env.MASTERS_PDF_FONT_PATH
        httpFlow = await runMastersPostgresHttpFlow({
          poolConfig: appConfig,
          ...(process.env.MASTERS_TEST_RELEASED_RESTORE_DATABASE_URL && process.env.MASTERS_TEST_WITHDRAWN_RESTORE_DATABASE_URL && process.env.MASTERS_TEST_POSTGRES_CONTAINER ? {
            backupRestore: {
              migrationUrl: databaseUrl,
              applicationUrl,
              releasedRestoreUrl: process.env.MASTERS_TEST_RELEASED_RESTORE_DATABASE_URL,
              withdrawnRestoreUrl: process.env.MASTERS_TEST_WITHDRAWN_RESTORE_DATABASE_URL,
              postgresContainer: process.env.MASTERS_TEST_POSTGRES_CONTAINER
            }
          } : {}),
          ...(configuredPdfFontPath ? { pdfFontPath: configuredPdfFontPath } : {})
        })
        assert.equal(httpFlow.store, 'PostgresStore')
        assert.equal(httpFlow.databaseRows, 'PASS')
        assert.equal(httpFlow.multipartAndPrivateStorage, 'PASS')
        assert.equal(httpFlow.restartRecovery, 'PASS')
        assert.equal(httpFlow.authorizationAndReassignment, 'PASS')
        assert.equal(httpFlow.idempotentSubmitAndWorker, 'PASS')
        assert.equal(httpFlow.reviewApprovalRelease, 'PASS')
        assert.equal(httpFlow.staleAndWithdrawnAccess, 'PASS')
        assert.equal(httpFlow.xlsxExport, 'PASS')
        assert.ok(httpFlow.pdfExport === 'PASS' || httpFlow.pdfExport === 'BLOCKED_EXTERNAL')
        if (httpFlow.pdfExport === 'BLOCKED_EXTERNAL') t.diagnostic(httpFlow.pdfReason ?? 'Chinese PDF font unavailable; PDF export was not counted as passed')
      })
      assert.ok(httpFlow)

      process.stdout.write(`${JSON.stringify({
        status: httpFlow.pdfExport === 'PASS' ? 'PASS' : 'PASS_WITH_EXTERNAL_BLOCK',
        suite: 'masters-postgres',
        databaseConnectionAttempted: true,
        migrationRoundtrip: 'PASS',
        persistenceReconnect: 'PASS',
        foreignKeysAndOwnerIsolation: 'PASS',
        concurrentDuplicateCreation: 'PASS',
        staleLeaseFence: 'PASS',
        tlsVerifyFull: 'PASS',
        applicationRoleIsolation: 'PASS',
        isolatedBackupRestore: httpFlow.isolatedBackupRestore,
        httpFlow: httpFlow.status === 'PASS' ? 'PASS' : 'BLOCKED_EXTERNAL',
        httpPostgresFlow: httpFlow
      })}\n`)
    } finally {
      if (store) await store.close().catch(() => undefined)
      await database.cleanup()
    }
  })
}
