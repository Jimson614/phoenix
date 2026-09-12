const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

function openDatabase(databasePath) {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  }

  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA foreign_keys = ON;')
  if (databasePath !== ':memory:') database.exec('PRAGMA journal_mode = WAL;')
  migrate(database)
  return database
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const migrationsDirectory = path.join(__dirname, 'migrations')
  const migrations = fs.readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  const alreadyApplied = database.prepare('SELECT 1 FROM schema_migrations WHERE name = ?')
  const recordMigration = database.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')

  migrations.forEach((name) => {
    if (alreadyApplied.get(name)) return
    const sql = fs.readFileSync(path.join(migrationsDirectory, name), 'utf8')
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(sql)
      recordMigration.run(name, new Date().toISOString())
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  })
}

module.exports = { openDatabase, migrate }
