import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Pool, type PoolConfig } from 'pg'

/**
 * The HTTP fixture deliberately keeps backup/restore in a separate module.
 * This is a test-only proof and is never used by the running service.  The
 * source server is stopped by the caller before this module takes its
 * snapshot, so the database and private-file tree describe one coherent
 * point in time.
 */

export type MastersBackupCheckpoint = 'RELEASED' | 'WITHDRAWN'

export interface MastersBackupRestoreConfig {
  migrationUrl: string
  releasedRestoreUrl: string
  withdrawnRestoreUrl: string
  applicationUrl: string
  postgresContainer: string
}

export interface MastersRestoredHttpApp {
  close(): Promise<void>
}

export interface MastersBackupRestoreVerificationContext {
  checkpoint: MastersBackupCheckpoint
  applicationUrl: string
  filesRoot: string
  schemaName: string
  databaseName: string
  encryptedArchiveSha256: string
  tlsVerified: true
}

export interface MastersIsolatedBackupRestoreOptions {
  backupRestore: MastersBackupRestoreConfig
  /** The application pool config; its options must name the UUID schema. */
  poolConfig: PoolConfig
  checkpoint: MastersBackupCheckpoint
  privateRoot: string
  /** A source HTTP server/store is stopped before snapshot and restarted after proof. */
  stopSource(): Promise<void>
  restartSource(): Promise<void>
  startRestoredApp(connection: PoolConfig, filesRoot: string): Promise<MastersRestoredHttpApp>
  verifyRestored(app: MastersRestoredHttpApp, context: MastersBackupRestoreVerificationContext): Promise<Record<string, unknown> | void>
}

export interface MastersIsolatedBackupRestoreResult {
  status: 'PASS'
  checkpoint: MastersBackupCheckpoint
  encryptedArchiveSha256: string
  encryptedBackup: 'AES-256-GCM'
  tamperRejected: true
  pgDump: 'PASS'
  pgRestore: 'PASS'
  restoredDatabase: string
  restoredSchema: string
  restoredFileCount: number
  restoredFileBytes: number
  restoredHttp: 'PASS'
  tlsVerifyFull: true
  applicationRole: 'DML_ONLY'
  restoredEvidence?: Record<string, unknown>
}

const ARCHIVE_FORMAT = 'phoenix-masters-isolated-backup-v1'
const ARCHIVE_AAD = Buffer.from('phoenix-masters-isolated-backup-v1', 'utf8')
const UUID_SCHEMA = /^masters_test_[0-9a-f]{32}$/
const DATABASE_SENTINEL = /(^|[-_])(test|testing|ci|sandbox)([-_]|$)/i
const SAFE_ROLE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/
const SAFE_CONTAINER = /^[A-Za-z0-9_.-]{1,128}$/
const SAFE_RELATIVE = /^(?![.]{1,2}(?:[\\/]|$))(?!.*(?:^|[\\/])[.]{1,2}(?:[\\/]|$))[^\u0000]+$/
const TEMP_FILE_SUFFIX = '.masters-isolated-backup'

interface ConnectionDetails {
  url: URL
  database: string
  username: string
  password: string
  host: string
  port: string
  sslRootCert: string
}

interface PrivateFileEntry {
  relativePath: string
  sizeBytes: number
  sha256: string
  bytesBase64: string
}

interface ArchivePayload {
  format: typeof ARCHIVE_FORMAT
  checkpoint: MastersBackupCheckpoint
  schemaName: string
  pgDumpBase64: string
  files: PrivateFileEntry[]
}

interface EncryptedArchive {
  format: typeof ARCHIVE_FORMAT
  checkpoint: MastersBackupCheckpoint
  ivBase64: string
  authTagBase64: string
  ciphertextBase64: string
}

interface DockerResult {
  code: number
  stdout: Buffer
  stderr: string
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function sanitizedError(value: unknown, secrets: readonly string[] = []): string {
  let message = value instanceof Error ? value.message : String(value)
  for (const secret of secrets) if (secret) message = message.split(secret).join('[REDACTED]')
  // Do not allow a failed pg client to echo an entire connection string.
  message = message.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, 'postgres://[REDACTED]')
  return message.slice(0, 1200)
}

function quoteIdentifier(value: string, kind: string): string {
  assert.match(value, kind === 'schema' ? UUID_SCHEMA : SAFE_ROLE, `Unexpected ${kind} identifier`)
  return `"${value.replaceAll('"', '""')}"`
}

function connectionDetails(raw: string, label: string): ConnectionDetails {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error(`${label}: invalid PostgreSQL URL`) }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), `${label}: PostgreSQL URL required`)
  assert.ok(url.hostname, `${label}: hostname required`)
  assert.ok(url.username && url.password, `${label}: explicit test role credentials required`)
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  assert.match(database, /^[A-Za-z0-9_-]+$/, `${label}: database name contains unsafe characters`)
  assert.match(database, DATABASE_SENTINEL, `${label}: database must carry a test/ci sentinel`)
  assert.equal(url.searchParams.get('sslmode'), 'verify-full', `${label}: sslmode=verify-full required`)
  const sslRootCert = url.searchParams.get('sslrootcert') || ''
  assert.ok(sslRootCert, `${label}: sslrootcert required`)
  assert.equal(url.searchParams.getAll('sslmode').length, 1, `${label}: duplicate sslmode is not allowed`)
  assert.equal(url.searchParams.getAll('sslrootcert').length, 1, `${label}: duplicate sslrootcert is not allowed`)
  for (const key of url.searchParams.keys()) assert.ok(key === 'sslmode' || key === 'sslrootcert', `${label}: unexpected connection override`)
  assert.ok(isAbsolute(sslRootCert), `${label}: sslrootcert must be an absolute path`)
  return {
    url,
    database,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.hostname.toLowerCase(),
    port: url.port || '5432',
    sslRootCert
  }
}

function schemaFromPoolConfig(poolConfig: PoolConfig): string {
  assert.equal(typeof poolConfig.options, 'string', 'application pool must set a single UUID schema search_path')
  const match = /^-c search_path=(masters_test_[0-9a-f]{32})$/.exec(poolConfig.options as string)
  assert.ok(match, 'application pool options must exactly be -c search_path=masters_test_<uuid>')
  return match[1]!
}

function validateConfiguration(options: MastersIsolatedBackupRestoreOptions, schemaName: string): {
  migration: ConnectionDetails
  application: ConnectionDetails
  restore: ConnectionDetails
} {
  const config = options.backupRestore
  assert.match(config.postgresContainer, SAFE_CONTAINER, 'PostgreSQL container name contains unsafe characters')
  const migration = connectionDetails(config.migrationUrl, 'migration URL')
  const application = connectionDetails(config.applicationUrl, 'application URL')
  const released = connectionDetails(config.releasedRestoreUrl, 'released restore URL')
  const withdrawn = connectionDetails(config.withdrawnRestoreUrl, 'withdrawn restore URL')
  const all = [migration, application, released, withdrawn]
  for (const current of all) {
    assert.equal(current.host, migration.host, 'all disposable PostgreSQL URLs must use the same host')
    assert.equal(current.port, migration.port, 'all disposable PostgreSQL URLs must use the same port')
    assert.equal(current.sslRootCert, migration.sslRootCert, 'all disposable PostgreSQL URLs must use the same verified CA')
  }
  assert.equal(application.database, migration.database, 'HTTP application must use the migration database')
  assert.notEqual(application.username, migration.username, 'migration and HTTP application roles must be distinct')
  assert.equal(released.username, migration.username, 'released restore URL must use the migration role')
  assert.equal(withdrawn.username, migration.username, 'withdrawn restore URL must use the migration role')
  assert.notEqual(released.database, migration.database, 'released restore database must be separate from source')
  assert.notEqual(withdrawn.database, migration.database, 'withdrawn restore database must be separate from source')
  assert.notEqual(released.database, withdrawn.database, 'released and withdrawn restore databases must be distinct')
  assert.equal(schemaName.match(UUID_SCHEMA)?.[0], schemaName, 'restore schema must be the source UUID schema')
  return { migration, application, restore: options.checkpoint === 'RELEASED' ? released : withdrawn }
}

function dockerEnvironment(details: ConnectionDetails): NodeJS.ProcessEnv {
  // `docker exec -e NAME` copies these values from this short-lived child
  // environment.  No password or URL is present in the argument vector or in
  // the captured evidence/logs.
  return {
    PATH: process.env.PATH || process.env.Path || '',
    HOME: process.env.HOME,
    DOCKER_HOST: process.env.DOCKER_HOST,
    PGHOST: 'localhost',
    PGPORT: '5432',
    PGDATABASE: details.database,
    PGUSER: details.username,
    PGPASSWORD: details.password,
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: '/certs/ca.crt'
  }
}

function dockerArgs(container: string, details: ConnectionDetails, command: string[]): string[] {
  // The value is deliberately omitted after every -e flag. Docker resolves
  // each name from the process environment supplied by dockerEnvironment().
  return [
    'exec', '-i', '-e', 'PGHOST', '-e', 'PGPORT', '-e', 'PGDATABASE', '-e', 'PGUSER',
    '-e', 'PGPASSWORD', '-e', 'PGSSLMODE', '-e', 'PGSSLROOTCERT', container,
    ...command
  ]
}

async function runDocker(container: string, details: ConnectionDetails, command: string[], input?: Buffer): Promise<DockerResult> {
  const child = spawn('docker', dockerArgs(container, details, command), {
    env: dockerEnvironment(details),
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => stdout.push(Buffer.from(chunk)))
  child.stderr.on('data', (chunk: Buffer) => stderr.push(Buffer.from(chunk)))
  if (input) child.stdin.end(input)
  else child.stdin.end()
  const code = await new Promise<number>((resolveCode, reject) => {
    child.once('error', reject)
    child.once('close', (exitCode) => resolveCode(exitCode ?? 1))
  })
  return { code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8') }
}

async function runDump(config: MastersBackupRestoreConfig, source: ConnectionDetails, schemaName: string): Promise<Buffer> {
  const result = await runDocker(config.postgresContainer, source, [
    'pg_dump', `--format=custom`, `--schema=${schemaName}`, '--no-owner', '--no-privileges'
  ])
  if (result.code !== 0 || result.stdout.length === 0) {
    throw new Error(`pg_dump failed (exit ${result.code}): ${sanitizedError(result.stderr, [source.password])}`)
  }
  return result.stdout
}

async function runRestore(config: MastersBackupRestoreConfig, target: ConnectionDetails, archive: Buffer): Promise<void> {
  const result = await runDocker(config.postgresContainer, target, [
    'pg_restore', '--exit-on-error', '--no-owner', '--no-privileges', '--dbname', target.database
  ], archive)
  if (result.code !== 0) {
    throw new Error(`pg_restore failed (exit ${result.code}): ${sanitizedError(result.stderr, [target.password])}`)
  }
}

async function capturePrivateFiles(root: string): Promise<PrivateFileEntry[]> {
  const resolvedRoot = resolve(root)
  const rootStats = await lstat(resolvedRoot)
  assert.ok(rootStats.isDirectory(), 'private storage root must be a directory')
  assert.equal(rootStats.mode & 0o077, 0, 'private storage root must be owner-only during backup')
  const entries: PrivateFileEntry[] = []
  const walk = async (directory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true })
    for (const child of children) {
      const absolute = join(directory, child.name)
      const relativePath = relative(resolvedRoot, absolute)
      assert.ok(SAFE_RELATIVE.test(relativePath) && !isAbsolute(relativePath), 'private backup path must be relative')
      const info = await lstat(absolute)
      assert.equal(info.isSymbolicLink(), false, `private backup refuses symlink: ${relativePath}`)
      if (info.isDirectory()) {
        await walk(absolute)
        continue
      }
      assert.ok(info.isFile(), `private backup refuses special file: ${relativePath}`)
      const bytes = await readFile(absolute)
      entries.push({ relativePath, sizeBytes: bytes.length, sha256: sha256(bytes), bytesBase64: bytes.toString('base64') })
    }
  }
  await walk(resolvedRoot)
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  return entries
}

function encryptPayload(payload: ArchivePayload, key: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(ARCHIVE_AAD)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final()])
  const envelope: EncryptedArchive = {
    format: ARCHIVE_FORMAT,
    checkpoint: payload.checkpoint,
    ivBase64: iv.toString('base64'),
    authTagBase64: cipher.getAuthTag().toString('base64'),
    ciphertextBase64: ciphertext.toString('base64')
  }
  return Buffer.from(JSON.stringify(envelope), 'utf8')
}

function decryptPayload(archive: Buffer, key: Buffer): ArchivePayload {
  const envelope = JSON.parse(archive.toString('utf8')) as Partial<EncryptedArchive>
  assert.equal(envelope.format, ARCHIVE_FORMAT, 'backup envelope format mismatch')
  assert.ok(envelope.checkpoint === 'RELEASED' || envelope.checkpoint === 'WITHDRAWN', 'backup checkpoint invalid')
  assert.equal(typeof envelope.ivBase64, 'string')
  assert.equal(typeof envelope.authTagBase64, 'string')
  assert.equal(typeof envelope.ciphertextBase64, 'string')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.ivBase64!, 'base64'))
  decipher.setAAD(ARCHIVE_AAD)
  decipher.setAuthTag(Buffer.from(envelope.authTagBase64!, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertextBase64!, 'base64')), decipher.final()])
  const payload = JSON.parse(plaintext.toString('utf8')) as ArchivePayload
  assert.equal(payload.format, ARCHIVE_FORMAT)
  assert.equal(payload.checkpoint, envelope.checkpoint)
  assert.match(payload.schemaName, UUID_SCHEMA)
  assert.ok(Array.isArray(payload.files))
  for (const file of payload.files) {
    assert.ok(SAFE_RELATIVE.test(file.relativePath) && !isAbsolute(file.relativePath), 'archive contains unsafe file path')
    const bytes = Buffer.from(file.bytesBase64, 'base64')
    assert.equal(bytes.length, file.sizeBytes, `private backup size mismatch: ${file.relativePath}`)
    assert.equal(sha256(bytes), file.sha256, `private backup digest mismatch: ${file.relativePath}`)
  }
  return payload
}

async function restorePrivateFiles(entries: PrivateFileEntry[], root: string): Promise<{ count: number; bytes: number }> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  await chmod(root, 0o700)
  let bytesTotal = 0
  const seen = new Set<string>()
  for (const entry of entries) {
    assert.ok(!seen.has(entry.relativePath), `duplicate private backup path: ${entry.relativePath}`)
    seen.add(entry.relativePath)
    assert.ok(SAFE_RELATIVE.test(entry.relativePath) && !isAbsolute(entry.relativePath), 'archive path must be relative')
    const destination = resolve(root, entry.relativePath)
    assert.ok(destination === resolve(root) || destination.startsWith(resolve(root) + sep), 'archive path escapes private root')
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    const fileBytes = Buffer.from(entry.bytesBase64, 'base64')
    assert.equal(fileBytes.length, entry.sizeBytes)
    assert.equal(sha256(fileBytes), entry.sha256)
    await writeFile(destination, fileBytes, { mode: 0o600, flag: 'wx' })
    bytesTotal += fileBytes.length
  }
  return { count: entries.length, bytes: bytesTotal }
}

function targetApplicationUrl(sourceApplication: ConnectionDetails, targetDatabase: string): string {
  const target = new URL(sourceApplication.url.href)
  target.pathname = `/${targetDatabase}`
  return target.href
}

function targetPoolConfig(connectionString: string, schemaName: string): PoolConfig {
  return {
    connectionString,
    max: 4,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'phoenix-masters-isolated-restore-http',
    options: `-c search_path=${schemaName}`
  }
}

async function assertCleanTarget(target: ConnectionDetails, schemaName: string): Promise<Pool> {
  const pool = new Pool({
    connectionString: target.url.href,
    max: 2,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'phoenix-masters-isolated-restore-bootstrap',
    options: `-c search_path=${schemaName}`
  })
  try {
    const namespace = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists', [schemaName]
    )
    assert.equal(namespace.rows[0]?.exists, false, `restore target already contains schema ${schemaName}`)
    const namespaces = await pool.query<{ nspname: string }>(
      `SELECT nspname
         FROM pg_catalog.pg_namespace
        WHERE nspname <> 'public'
          AND nspname <> 'information_schema'
          AND nspname NOT LIKE 'pg_%'
        ORDER BY nspname`
    )
    assert.deepEqual(namespaces.rows, [], 'restore target contains a non-system schema')
    const publicRelations = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')`
    )
    assert.equal(publicRelations.rows[0]?.count, 0, 'restore target public schema must have no relations')
    return pool
  } catch (error) {
    await pool.end().catch(() => undefined)
    throw error
  }
}

async function grantApplicationRole(pool: Pool, schemaName: string, applicationRole: string): Promise<void> {
  const schema = quoteIdentifier(schemaName, 'schema')
  const role = quoteIdentifier(applicationRole, 'role')
  const allowedTables = new Set([
    'users', 'wechat_identities', 'sessions',
    'masters_consultations', 'masters_staff', 'masters_consultation_consents',
    'masters_consultation_documents', 'masters_consultation_snapshots',
    'masters_consultation_assignments', 'masters_reports', 'masters_report_jobs',
    'masters_audit_logs', 'masters_idempotency_records'
  ])
  const tableRows = await pool.query<{ tablename: string }>(
    'SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1 ORDER BY tablename', [schemaName]
  )
  for (const row of tableRows.rows) {
    const table = quoteIdentifier(row.tablename, 'table')
    if (row.tablename === 'schema_migrations') {
      await pool.query(`GRANT SELECT ON TABLE ${schema}.${table} TO ${role}`)
      continue
    }
    if (allowedTables.has(row.tablename)) await pool.query(`GRANT SELECT, INSERT, UPDATE ON TABLE ${schema}.${table} TO ${role}`)
  }
  const sequenceRows = await pool.query<{ sequencename: string }>(
    'SELECT sequencename FROM pg_catalog.pg_sequences WHERE schemaname = $1 ORDER BY sequencename', [schemaName]
  )
  for (const row of sequenceRows.rows) await pool.query(`GRANT USAGE, SELECT, UPDATE ON SEQUENCE ${schema}.${quoteIdentifier(row.sequencename, 'sequence')} TO ${role}`)
  await pool.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`)
}

async function assertApplicationPrivileges(target: ConnectionDetails, schemaName: string, applicationRole: string): Promise<true> {
  const pool = new Pool({
    connectionString: target.url.href,
    max: 1,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'phoenix-masters-isolated-restore-app-probe',
    options: `-c search_path=${schemaName}`
  })
  try {
    const result = await pool.query<{
      ssl: boolean
      tlsVersion: string
      currentUser: string
      databaseCreate: boolean
      databaseTemp: boolean
      superuser: boolean
      createDb: boolean
      createRole: boolean
      bypassRls: boolean
      replication: boolean
    }>(`SELECT s.ssl, s.version AS "tlsVersion", current_user AS "currentUser",
      has_database_privilege(current_user, current_database(), 'CREATE') AS "databaseCreate",
      has_database_privilege(current_user, current_database(), 'TEMP') AS "databaseTemp",
      r.rolsuper AS "superuser", r.rolcreatedb AS "createDb", r.rolcreaterole AS "createRole",
      r.rolbypassrls AS "bypassRls", r.rolreplication AS replication
      FROM pg_stat_ssl s JOIN pg_roles r ON r.rolname = current_user
      WHERE s.pid = pg_backend_pid()`)
    const row = result.rows[0]
    assert.ok(row?.ssl && ['TLSv1.2', 'TLSv1.3'].includes(row.tlsVersion), 'restored HTTP app did not negotiate verified TLS')
    assert.equal(row.currentUser, applicationRole)
    assert.equal(row.databaseCreate, false)
    assert.equal(row.databaseTemp, false)
    assert.equal(row.superuser, false)
    assert.equal(row.createDb, false)
    assert.equal(row.createRole, false)
    assert.equal(row.bypassRls, false)
    assert.equal(row.replication, false)
    const schemaPrivilege = await pool.query<{ allowed: boolean }>(
      'SELECT has_schema_privilege(current_user, $1, \'USAGE\') AS allowed', [schemaName]
    )
    assert.equal(schemaPrivilege.rows[0]?.allowed, true)
    const migrations = `${schemaName}.schema_migrations`
    const selectPrivilege = await pool.query<{ allowed: boolean }>(
      'SELECT has_table_privilege(current_user, $1, \'SELECT\') AS allowed', [migrations]
    )
    const insertPrivilege = await pool.query<{ allowed: boolean }>(
      'SELECT has_table_privilege(current_user, $1, \'INSERT\') AS allowed', [migrations]
    )
    assert.equal(selectPrivilege.rows[0]?.allowed, true)
    assert.equal(insertPrivilege.rows[0]?.allowed, false)
    return true
  } finally { await pool.end() }
}

async function dropOnlySchema(target: ConnectionDetails, schemaName: string): Promise<void> {
  const pool = new Pool({
    connectionString: target.url.href,
    max: 1,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'phoenix-masters-isolated-restore-cleanup'
  })
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName, 'schema')} CASCADE`)
    const check = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists', [schemaName]
    )
    assert.equal(check.rows[0]?.exists, false, 'restore cleanup left the UUID schema behind')
  } finally { await pool.end() }
}

async function runCheckpoint(options: MastersIsolatedBackupRestoreOptions): Promise<MastersIsolatedBackupRestoreResult> {
  const schemaName = schemaFromPoolConfig(options.poolConfig)
  const validated = validateConfiguration(options, schemaName)
  const target = validated.restore
  const applicationRole = validated.application.username
  const archiveDirectory = await mkdtemp(join(tmpdir(), `masters-isolated-backup-${options.checkpoint.toLowerCase()}-`))
  await chmod(archiveDirectory, 0o700)
  const restoreRoot = await mkdtemp(join(tmpdir(), `masters-isolated-restore-${options.checkpoint.toLowerCase()}-`))
  await chmod(restoreRoot, 0o700)
  const key = randomBytes(32)
  let targetPool: Pool | undefined
  let sourceStopped = false
  let restoredApp: MastersRestoredHttpApp | undefined
  let targetSchemaOwned = false
  try {
    await options.stopSource()
    sourceStopped = true
    const files = await capturePrivateFiles(options.privateRoot)
    const pgDump = await runDump(options.backupRestore, validated.migration, schemaName)
    const encrypted = encryptPayload({ format: ARCHIVE_FORMAT, checkpoint: options.checkpoint, schemaName, pgDumpBase64: pgDump.toString('base64'), files }, key)
    const encryptedArchiveSha256 = sha256(encrypted)
    const archivePath = join(archiveDirectory, `${options.checkpoint.toLowerCase()}${TEMP_FILE_SUFFIX}`)
    await writeFile(archivePath, encrypted, { mode: 0o600, flag: 'wx' })

    // Flip authenticated bytes in a copy. A successful decrypt here would
    // prove the test accidentally omitted AES-GCM authentication.
    const tampered = JSON.parse(encrypted.toString('utf8')) as EncryptedArchive
    const tag = Buffer.from(tampered.authTagBase64, 'base64')
    tag[0] = (tag[0] ?? 0) ^ 0x01
    tampered.authTagBase64 = tag.toString('base64')
    await assert.rejects(() => Promise.resolve().then(() => decryptPayload(Buffer.from(JSON.stringify(tampered), 'utf8'), key)))

    const payload = decryptPayload(await readFile(archivePath), key)
    assert.equal(payload.checkpoint, options.checkpoint)
    assert.equal(payload.schemaName, schemaName)
    const restoredFiles = await restorePrivateFiles(payload.files, restoreRoot)
    targetPool = await assertCleanTarget(target, schemaName)
    // The clean namespace check completed before this flag is set. A
    // pre-existing namespace can therefore never be removed by finally.
    targetSchemaOwned = true
    await targetPool.end()
    targetPool = undefined
    await runRestore(options.backupRestore, target, Buffer.from(payload.pgDumpBase64, 'base64'))
    targetPool = new Pool({
      connectionString: target.url.href,
      max: 2,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
      application_name: 'phoenix-masters-isolated-restore-grants',
      options: `-c search_path=${schemaName}`
    })
    const schemaExists = await targetPool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists', [schemaName]
    )
    assert.equal(schemaExists.rows[0]?.exists, true, 'pg_restore did not restore the UUID schema')
    await grantApplicationRole(targetPool, schemaName, applicationRole)
    await targetPool.end()
    targetPool = undefined

    const applicationTarget = connectionDetails(targetApplicationUrl(validated.application, target.database), 'restored application URL')
    assert.equal(applicationTarget.username, applicationRole)
    assert.equal(applicationTarget.database, target.database)
    await assertApplicationPrivileges(applicationTarget, schemaName, applicationRole)
    const restoredPoolConfig = targetPoolConfig(applicationTarget.url.href, schemaName)
    restoredApp = await options.startRestoredApp(restoredPoolConfig, restoreRoot)
    const restoredEvidence = await options.verifyRestored(restoredApp, {
      checkpoint: options.checkpoint,
      applicationUrl: applicationTarget.url.href,
      filesRoot: restoreRoot,
      schemaName,
      databaseName: target.database,
      encryptedArchiveSha256,
      tlsVerified: true
    })
    await restoredApp.close()
    restoredApp = undefined
    await dropOnlySchema(target, schemaName)

    return {
      status: 'PASS', checkpoint: options.checkpoint, encryptedArchiveSha256,
      encryptedBackup: 'AES-256-GCM', tamperRejected: true, pgDump: 'PASS', pgRestore: 'PASS',
      restoredDatabase: target.database, restoredSchema: schemaName,
      restoredFileCount: restoredFiles.count, restoredFileBytes: restoredFiles.bytes,
      restoredHttp: 'PASS', tlsVerifyFull: true, applicationRole: 'DML_ONLY',
      ...(restoredEvidence ? { restoredEvidence } : {})
    }
  } finally {
    if (targetPool) await targetPool.end().catch(() => undefined)
    if (restoredApp) await restoredApp.close().catch(() => undefined)
    // Never drop a caller-owned database or any schema except this generated
    // UUID namespace. Target cleanup is best-effort after a failed proof; a
    // subsequent CI container cleanup still removes only the disposable DB.
    if (targetSchemaOwned) await dropOnlySchema(target, schemaName).catch(() => undefined)
    key.fill(0)
    await rm(archiveDirectory, { recursive: true, force: true })
    await rm(restoreRoot, { recursive: true, force: true })
    if (sourceStopped) {
      await options.restartSource()
    }
  }
}

/**
 * Execute one RELEASED or WITHDRAWN backup/restore checkpoint.  The caller
 * invokes this twice from the HTTP flow. Missing configuration is handled by
 * the caller as BLOCKED_EXTERNAL; this function only returns PASS after every
 * dump, authenticated decrypt, restore, least-privilege probe, HTTP callback,
 * and UUID-schema cleanup has succeeded.
 */
export async function runMastersIsolatedBackupRestore(options: MastersIsolatedBackupRestoreOptions): Promise<MastersIsolatedBackupRestoreResult> {
  return runCheckpoint(options)
}
