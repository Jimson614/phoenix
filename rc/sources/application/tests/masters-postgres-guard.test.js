'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { testDatabaseUrl, applicationDatabaseUrl, verifyConnection } = require('../scripts/ci/postgres-guard')

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'masters-guard-test-'))
  try {
    const ca = path.join(directory, 'synthetic-ca.crt')
    fs.writeFileSync(ca, 'synthetic path-policy fixture, never used for a connection')
    const url = new URL('postgresql://test_migrate:test-password@localhost:5432/masters_ci_test')
    url.searchParams.set('sslmode', 'verify-full'); url.searchParams.set('sslrootcert', ca)
    const good = testDatabaseUrl(url.href)
    for (const mode of ['disable', 'require', 'verify-ca', 'no-verify']) {
      const invalid = new URL(good); invalid.searchParams.set('sslmode', mode)
      assert.throws(() => testDatabaseUrl(invalid.href), /verify-full/)
    }
    for (const name of ['production', 'contest', 'test/other']) {
      const invalid = new URL(good); invalid.pathname = '/' + name
      assert.throws(() => testDatabaseUrl(invalid.href), /sentinel/)
    }
    for (const key of ['host', 'user', 'options', 'ssl', 'uselibpqcompat']) {
      const invalid = new URL(good); invalid.searchParams.set(key, 'override')
      assert.throws(() => testDatabaseUrl(invalid.href), /override/)
    }
    const app = new URL(good); app.username = 'test_app'
    assert.equal(applicationDatabaseUrl(good, app.href).username, 'test_app')
    assert.throws(() => applicationDatabaseUrl(good, good.href), /distinct/)
    app.pathname = '/another_ci_test'
    assert.throws(() => applicationDatabaseUrl(good, app.href), /same isolated/)
    const safe = { database: 'masters_ci_test', ssl: true, tls_version: 'TLSv1.3', rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false, rolreplication: false, database_create: false, database_temp: false }
    const pool = row => ({ query: async () => ({ rows: [row] }) })
    assert.equal((await verifyConnection(pool(safe), { application: true })).tlsVerifyFull, 'PASS')
    for (const flag of ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolbypassrls', 'rolreplication', 'database_create', 'database_temp']) {
      await assert.rejects(() => verifyConnection(pool({ ...safe, [flag]: true }), { application: true }))
    }
    await assert.rejects(() => verifyConnection(pool({ ...safe, ssl: false })), /TLS/)
    await assert.rejects(() => verifyConnection(pool({ ...safe, tls_version: 'TLSv1.1' })), /TLS/)
    console.log('✓ PostgreSQL policy: verified TLS, disposable names, no URL overrides, distinct roles, administrative and DDL privileges rejected (unit policy checks only)')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
