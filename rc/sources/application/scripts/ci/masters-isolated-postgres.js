'use strict'

// GitHub-hosted, disposable test infrastructure. No repository/production
// secrets, external database, public database port, deployment or service install.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const cp = require('node:child_process')
const dns = require('node:dns')
const { randomBytes, createHash } = require('node:crypto')
const { Pool } = require('../../server/node_modules/pg')
const { testDatabaseUrl, verifyConnection } = require('./postgres-guard')
const root = path.resolve(__dirname, '../..')
const image = 'postgres:16.13-bookworm@sha256:472efd9a66f2b2f1a5aeb18b28de74332e6ef88c2b93a1a5d812fb6db67a5f60'
const secrets = []
let directory, container, evidenceDirectory

function run(command, args, options = {}) {
  const result = cp.spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024, ...options })
  if (result.error || result.status !== 0) {
    let diagnostic = String(result.stderr || result.error?.code || '').slice(-4000)
    for (const secret of secrets) diagnostic = diagnostic.split(secret).join('[REDACTED]')
    throw new Error(`${path.basename(command)} ${args[0] || ''} failed (exit ${result.status ?? 'unavailable'}): ${diagnostic}`)
  }
  return result.stdout.trim()
}
function password() {
  const value = randomBytes(32).toString('hex')
  secrets.push(value)
  // Values are masked before any child process exists. Never publish them as outputs.
  process.stdout.write(`::add-mask::${value}\n`)
  return value
}
function url(user, secret, database, port) {
  const value = new URL(`postgresql://localhost:${port}/${database}`)
  value.username = user; value.password = secret
  value.searchParams.set('sslmode', 'verify-full')
  value.searchParams.set('sslrootcert', path.join(directory, 'ca.crt'))
  return value.href
}
async function negativeTlsProof(connectionString) {
  const good = testDatabaseUrl(connectionString)
  const badCa = new URL(good)
  badCa.searchParams.set('sslrootcert', path.join(directory, 'untrusted-ca.crt'))
  const badHost = new URL(good)
  badHost.hostname = 'masters-ci-wrong.invalid'
  // Test-scoped DNS routing reaches the real server under a wrong DNS name.
  // TLS still receives that wrong name and must reject the real certificate.
  // No operating-system DNS/hosts changes or certificate-check bypasses.
  const originalLookup = dns.lookup
  dns.lookup = (hostname, ...args) => originalLookup(hostname === badHost.hostname ? 'localhost' : hostname, ...args)
  try {
    for (const [name, connection] of [['untrusted-ca', badCa.href], ['hostname-mismatch', badHost.href]]) {
      const pool = new Pool({ connectionString: connection, connectionTimeoutMillis: 5000, max: 1 })
      try {
        await assert.rejects(() => pool.query('SELECT 1'), error => name === 'hostname-mismatch'
          ? error.code === 'ERR_TLS_CERT_ALTNAME_INVALID'
          : ['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error.code), `${name} must fail certificate validation`)
      } finally { await pool.end() }
    }
  } finally { dns.lookup = originalLookup }
  // A non-TLS connection is deliberately attempted as a negative server policy
  // probe only. It must be rejected and never runs a migration or HTTP request.
  const denied = new Pool({ host: '127.0.0.1', port: Number(good.port), database: good.pathname.slice(1), user: decodeURIComponent(good.username), password: decodeURIComponent(good.password), ssl: false, max: 1, connectionTimeoutMillis: 5000 })
  try { await assert.rejects(() => denied.query('SELECT 1'), error => error.code === '28000', 'server must reject plaintext connections') }
  finally { await denied.end() }
  return { untrustedCaRejected: true, hostnameMismatchRejected: true, plaintextRejected: true }
}

async function main() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'This provisioner is limited to the authorized ephemeral GitHub runner')
  assert.equal(process.platform, 'linux')
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0', false)
  const head = run('git', ['rev-parse', 'HEAD'])
  assert.match(head, /^[0-9a-f]{40}$/)
  assert.equal(head, process.env.GITHUB_TEST_SHA, 'checkout must equal the requested candidate SHA')
  assert.equal(run('git', ['status', '--porcelain']), '', 'candidate must be committed and clean')
  evidenceDirectory = path.join(root, 'outputs', 'masters-ci', head)
  fs.mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 })
  directory = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'masters-ci-'))
  fs.chmodSync(directory, 0o700)
  container = `masters-ci-${randomBytes(8).toString('hex')}`
  const bootstrapPassword = password(), migratePassword = password(), appPassword = password(), educationPassword = password()
  fs.writeFileSync(path.join(directory, 'postgres.password'), bootstrapPassword, { mode: 0o600 })
  for (const prefix of ['ca', 'untrusted-ca']) run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1', '-subj', `/CN=Masters disposable ${prefix}`, '-keyout', path.join(directory, `${prefix}.key`), '-out', path.join(directory, `${prefix}.crt`)])
  run('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', path.join(directory, 'server.key'), '-out', path.join(directory, 'server.csr')])
  fs.writeFileSync(path.join(directory, 'server.ext'), 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n')
  run('openssl', ['x509', '-req', '-in', path.join(directory, 'server.csr'), '-CA', path.join(directory, 'ca.crt'), '-CAkey', path.join(directory, 'ca.key'), '-CAcreateserial', '-days', '1', '-sha256', '-extfile', path.join(directory, 'server.ext'), '-out', path.join(directory, 'server.crt')])
  fs.writeFileSync(path.join(directory, 'pg_hba.conf'), 'local all all trust\nhostnossl all all 0.0.0.0/0 reject\nhostnossl all all ::/0 reject\nhostssl all all 0.0.0.0/0 scram-sha-256\nhostssl all all ::/0 scram-sha-256\n')
  run('docker', ['pull', image])
  const imageId = run('docker', ['image', 'inspect', '--format', '{{.Id}}', image])
  // Init runs as the image's unprivileged postgres uid; host private directory
  // stays 0700 and its named container alone receives this bind mount.
  run('docker', ['run', '--rm', '--entrypoint', 'sh', '-v', `${directory}:/certs`, image, '-c', 'chown postgres:postgres /certs /certs/server.key /certs/postgres.password && chmod 700 /certs && chmod 600 /certs/server.key /certs/postgres.password'])
  run('docker', ['run', '-d', '--name', container, '--label', 'phoenix.task=masters-pr9-ci', '-p', '127.0.0.1::5432', '-v', `${directory}:/certs:ro`, '-e', 'POSTGRES_PASSWORD_FILE=/certs/postgres.password', '-e', 'POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256', image, '-c', 'ssl=on', '-c', 'ssl_min_protocol_version=TLSv1.2', '-c', 'ssl_cert_file=/certs/server.crt', '-c', 'ssl_key_file=/certs/server.key', '-c', 'hba_file=/certs/pg_hba.conf', '-c', 'log_statement=none'])
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = cp.spawnSync('docker', ['exec', container, 'pg_isready', '-h', 'localhost', '-U', 'postgres'], { encoding: 'utf8' })
    if (result.status === 0) { ready = true; break }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert.ok(ready, 'temporary PostgreSQL did not become ready')
  const portBinding = run('docker', ['port', container, '5432/tcp'])
  assert.match(portBinding, /^127\.0\.0\.1:\d+$/)
  const port = portBinding.split(':')[1]
  const databases = ['masters_ci_test', 'masters_release_restore_ci_test', 'masters_withdrawn_restore_ci_test', 'education_ci_test']
  const sql = [
    `CREATE ROLE masters_ci_migrate LOGIN PASSWORD '${migratePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`,
    `CREATE ROLE masters_ci_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`,
    `CREATE ROLE education_ci_migrate LOGIN PASSWORD '${educationPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`,
    'REVOKE ALL ON DATABASE postgres FROM PUBLIC;',
    ...databases.flatMap(db => [`CREATE DATABASE ${db};`, `REVOKE ALL ON DATABASE ${db} FROM PUBLIC;`, `GRANT CONNECT, CREATE ON DATABASE ${db} TO ${db.startsWith('education') ? 'education_ci_migrate' : 'masters_ci_migrate'};`, ...(db.startsWith('masters') ? [`GRANT CONNECT ON DATABASE ${db} TO masters_ci_app;`] : []), `\\connect ${db}`, 'REVOKE ALL ON SCHEMA public FROM PUBLIC;', ...(db.startsWith('education') ? ['GRANT USAGE, CREATE ON SCHEMA public TO education_ci_migrate;'] : []), '\\connect postgres'])
  ].join('\n')
  run('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql })
  // Return directory ownership to the ephemeral runner after initialization;
  // keep the server key owned by postgres. Public CA certificates stay readable.
  run('docker', ['run', '--rm', '--entrypoint', 'sh', '-v', `${directory}:/certs`, image, '-c', `chown ${process.getuid()}:${process.getgid()} /certs && chmod 755 /certs`])
  const migrationUrl = url('masters_ci_migrate', migratePassword, databases[0], port)
  const applicationUrl = url('masters_ci_app', appPassword, databases[0], port)
  const educationUrl = url('education_ci_migrate', educationPassword, databases[3], port)
  const pool = new Pool({ connectionString: migrationUrl, max: 1, connectionTimeoutMillis: 10000 })
  let connection
  try { connection = await verifyConnection(pool) } finally { await pool.end() }
  const tlsNegativeTests = await negativeTlsProof(migrationUrl)
  const infrastructure = { status: 'PASS', headSha: head, postgresImage: image, imageId, syntheticOnly: true, loopbackOnly: true, databases, ...connection, tlsNegativeTests, caCertificateSha256: createHash('sha256').update(fs.readFileSync(path.join(directory, 'ca.crt'))).digest('hex') }
  fs.writeFileSync(path.join(evidenceDirectory, 'infrastructure.json'), JSON.stringify(infrastructure, null, 2) + '\n')
  process.stdout.write(JSON.stringify({ suite: 'isolated-postgres-provision', status: 'PASS', headSha: head, tlsNegativeTests }) + '\n')
  const childEnv = {
    ...process.env, DATABASE_URL: '',
    MASTERS_TEST_DATABASE_URL: migrationUrl, MASTERS_TEST_APP_DATABASE_URL: applicationUrl,
    MASTERS_TEST_DATABASE_ALLOW_MUTATION: 'YES',
    EDUCATION_TEST_DATABASE_URL: educationUrl, EDUCATION_TEST_DATABASE_ALLOW_MUTATION: 'YES',
    MASTERS_TEST_RELEASED_RESTORE_DATABASE_URL: url('masters_ci_migrate', migratePassword, databases[1], port),
    MASTERS_TEST_WITHDRAWN_RESTORE_DATABASE_URL: url('masters_ci_migrate', migratePassword, databases[2], port),
    MASTERS_TEST_POSTGRES_CONTAINER: container,
    MASTERS_TEST_SESSION_SECRET: password()
  }
  const child = cp.spawnSync(process.execPath, ['scripts/verify-masters-candidate.js', '--automation-only'], { cwd: root, env: childEnv, stdio: 'inherit', timeout: 1200000 })
  process.exitCode = child.status ?? 1
}

main().catch(error => {
  // No raw subprocess stderr, commands containing secrets, SQL or URLs.
  let reason = String(error.message)
  for (const secret of secrets) reason = reason.split(secret).join('[REDACTED]')
  process.stderr.write(JSON.stringify({ suite: 'isolated-postgres-provision', status: 'FAIL', reason }) + '\n')
  process.exitCode = 1
}).finally(() => {
  let cleanupPassed = true
  if (container) {
    const stopped = cp.spawnSync('docker', ['rm', '-f', '-v', container], { encoding: 'utf8' })
    if (stopped.status !== 0) { process.exitCode = 1; cleanupPassed = false }
  }
  if (directory) {
    const parent = path.resolve(process.env.RUNNER_TEMP || os.tmpdir())
    assert.ok(path.resolve(directory).startsWith(parent + path.sep) && path.basename(directory).startsWith('masters-ci-'))
    // Only this task's generated cert/key directory; no global Docker prune.
    try { fs.rmSync(directory, { recursive: true, force: true }) } catch {
      // Initialization may fail while the named mount is still postgres-owned.
      cp.spawnSync('docker', ['run', '--rm', '--entrypoint', 'sh', '-v', `${directory}:/certs`, image, '-c', `chown ${process.getuid()}:${process.getgid()} /certs && chmod 700 /certs`], { encoding: 'utf8' })
      try { fs.rmSync(directory, { recursive: true, force: true }) } catch { process.exitCode = 1; cleanupPassed = false }
    }
  }
  const cleanup = { suite: 'isolated-postgres-cleanup', status: cleanupPassed ? 'PASS' : 'FAIL', namedContainerAndVolumesRemoved: cleanupPassed, temporaryCredentialsRemoved: cleanupPassed }
  if (evidenceDirectory) fs.writeFileSync(path.join(evidenceDirectory, 'cleanup.json'), JSON.stringify(cleanup, null, 2) + '\n')
  process.stdout.write(JSON.stringify(cleanup) + '\n')
})
