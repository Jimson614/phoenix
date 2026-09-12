'use strict'

const fs = require('node:fs')

// Test-only connection policy, shared by the wrappers and compiled PG suite.
// Never include a supplied URL or parser error in diagnostics.
function testDatabaseUrl(value, label = 'test database') {
  let url
  try { url = new URL(value) } catch { throw new Error(`${label}: invalid PostgreSQL URL`) }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password) throw new Error(`${label}: explicit PostgreSQL host and test credentials required`)
  let name
  try { name = decodeURIComponent(url.pathname.slice(1)) } catch { throw new Error(`${label}: invalid database name`) }
  if (!/^[a-zA-Z0-9_-]+$/.test(name) || !/(^|[-_])(test|testing|ci|sandbox)([-_]|$)/i.test(name)) throw new Error(`${label}: delimited test/ci database sentinel required`)
  if (url.searchParams.get('sslmode') !== 'verify-full' || !url.searchParams.get('sslrootcert')) throw new Error(`${label}: sslmode=verify-full and sslrootcert required`)
  if ([...url.searchParams.keys()].some(key => !['sslmode', 'sslrootcert'].includes(key)) || [...url.searchParams.keys()].length !== 2) throw new Error(`${label}: connection override parameters are not permitted`)
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error(`${label}: global TLS verification bypass is forbidden`)
  if (!fs.statSync(url.searchParams.get('sslrootcert'), { throwIfNoEntry: false })?.isFile()) throw new Error(`${label}: test CA file unavailable`)
  return url
}

function applicationDatabaseUrl(migration, value) {
  const app = testDatabaseUrl(value, 'HTTP application database')
  if (app.hostname !== migration.hostname || app.port !== migration.port || app.pathname !== migration.pathname || app.search !== migration.search) throw new Error('HTTP application must use the same isolated database and verified TLS trust')
  if (app.username === migration.username) throw new Error('Migration and HTTP application roles must be distinct')
  return app
}

async function verifyConnection(pool, { application = false } = {}) {
  const result = await pool.query(`SELECT current_database() AS database,
    r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolbypassrls, r.rolreplication,
    s.ssl, s.version AS tls_version,
    has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
    has_database_privilege(current_user, current_database(), 'TEMP') AS database_temp
    FROM pg_roles r JOIN pg_stat_ssl s ON s.pid = pg_backend_pid() WHERE r.rolname = current_user`)
  const row = result.rows[0]
  if (!row || !row.ssl || !['TLSv1.2', 'TLSv1.3'].includes(row.tls_version)) throw new Error('Verified TLS connection was not established')
  if (['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolbypassrls', 'rolreplication'].some(flag => row[flag])) throw new Error('Test role has forbidden administrative privileges')
  if (application && (row.database_create || row.database_temp)) throw new Error('HTTP application role must not create schemas or temporary objects')
  return { status: 'PASS', tlsVerifyFull: 'PASS', negotiatedTls: row.tls_version, database: row.database, administrativePrivileges: false, ...(application ? { applicationDdl: false } : {}) }
}

module.exports = { testDatabaseUrl, applicationDatabaseUrl, verifyConnection }
