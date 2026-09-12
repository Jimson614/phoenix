'use strict'

const { createHash } = require('node:crypto')
const { readdir, readFile } = require('node:fs/promises')
const path = require('node:path')
const { Pool } = require('pg')

const databaseUrl = process.env.DATABASE_URL || ''
if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
  throw new Error('DATABASE_URL must be a PostgreSQL connection URL')
}

const migrationsDirectory = path.resolve(__dirname, '..', 'migrations')
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  statement_timeout: 60_000,
  application_name: 'phoenix-family-os-migrator'
})

function migrationBody(raw) {
  return raw
    .replace(/^\s*BEGIN\s*;\s*/i, '')
    .replace(/\s*COMMIT\s*;\s*$/i, '')
}

async function main() {
  const client = await pool.connect()
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('phoenix_family_os_migrations'))")
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    const names = (await readdir(migrationsDirectory))
      .filter((name) => /^\d+_[A-Za-z0-9_-]+\.sql$/.test(name))
      .sort()
    if (!names.length) throw new Error('No database migrations were found')

    for (const name of names) {
      const raw = await readFile(path.join(migrationsDirectory, name), 'utf8')
      const checksum = createHash('sha256').update(raw).digest('hex')
      const applied = await client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name])
      if (applied.rowCount) {
        if (applied.rows[0].checksum !== checksum) throw new Error(`Applied migration checksum changed: ${name}`)
        process.stdout.write(`Already applied: ${name}\n`)
        continue
      }
      await client.query('BEGIN')
      try {
        await client.query(migrationBody(raw))
        await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [name, checksum])
        await client.query('COMMIT')
        process.stdout.write(`Applied: ${name}\n`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('phoenix_family_os_migrations'))").catch(() => undefined)
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`)
  process.exitCode = 1
})

