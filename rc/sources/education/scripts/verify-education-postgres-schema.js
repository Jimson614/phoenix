'use strict'

const assert = require('node:assert/strict')
const { Pool } = require('../server/node_modules/pg')

const databaseUrl = process.env.DATABASE_URL || ''
if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new Error('DATABASE_URL must be a PostgreSQL URL')

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  statement_timeout: 30_000,
  application_name: 'phoenix-education-v05-schema-verifier'
})

async function main() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN READ ONLY')
    const migrations = await client.query(`
      SELECT name
      FROM schema_migrations
      WHERE name = '005_education_compass_levels.sql'
    `)
    assert.equal(migrations.rowCount, 1, 'migration 005 is not recorded')

    const columns = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          table_name IN ('consent_grants', 'idempotency_records', 'product_deliverables')
          OR (table_name = 'assessments' AND column_name IN (
            'assessment_kind', 'assessment_level', 'draft_revision', 'schema_digest', 'result_kind'
          ))
          OR (table_name = 'reports' AND column_name IN (
            'report_kind', 'result_version', 'result_payload', 'disclaimer_version'
          ))
        )
    `)
    const actual = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`))
    for (const expected of [
      'consent_grants.id',
      'idempotency_records.id',
      'product_deliverables.id',
      'assessments.assessment_kind',
      'assessments.assessment_level',
      'assessments.draft_revision',
      'assessments.schema_digest',
      'assessments.result_kind',
      'reports.report_kind',
      'reports.result_version',
      'reports.result_payload',
      'reports.disclaimer_version'
    ]) assert.ok(actual.has(expected), `missing ${expected}`)

    const product = await client.query(`
      SELECT code, amount_fen, currency, active
      FROM products
      WHERE code = 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1'
    `)
    assert.equal(product.rowCount, 1, 'V0.5 product is missing')
    assert.deepEqual(product.rows[0], {
      code: 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1',
      amount_fen: 3990,
      currency: 'CNY',
      active: true
    })

    const deliverable = await client.query(`
      SELECT assessment_kind, report_kind, deliverable_kind, active
      FROM product_deliverables
      WHERE product_code = 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1'
    `)
    assert.equal(deliverable.rowCount, 1, 'V0.5 product/deliverable mapping is missing')
    assert.deepEqual(deliverable.rows[0], {
      assessment_kind: 'STUDENT_GROWTH_DISCOVERY',
      report_kind: 'STUDENT_GROWTH_DISCOVERY',
      deliverable_kind: 'STUDENT_GROWTH_DISCOVERY_REPORT_V1',
      active: true
    })
    await client.query('ROLLBACK')
    process.stdout.write(`${JSON.stringify({ status: 'PASS', suite: 'education-postgres-schema', externalSideEffects: 'migration-only' })}\n`)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(async (error) => {
  await pool.end().catch(() => undefined)
  process.stderr.write(`PostgreSQL Education Compass verification failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
