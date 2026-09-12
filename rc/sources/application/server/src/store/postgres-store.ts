import { Pool, PoolClient, PoolConfig, QueryResultRow } from 'pg'
import { AppError } from '../domain/errors'
import { EntityMap, TableName } from '../domain/model'
import { Filter, Store, StoreTransaction } from './store'

const TABLES: Record<TableName, string> = {
  users: 'users',
  wechatIdentities: 'wechat_identities',
  sessions: 'sessions',
  families: 'families',
  students: 'students',
  consents: 'guardian_consents',
  assessments: 'assessments',
  reports: 'reports',
  products: 'products',
  orders: 'orders',
  entitlements: 'entitlements',
  paymentEvents: 'payment_events',
  refunds: 'refunds',
  reportJobs: 'report_jobs',
  feedback: 'report_feedback',
  auditLogs: 'audit_logs',
  timelineEvents: 'timeline_events',
  advisorRequests: 'advisor_requests',
  integrationLinks: 'integration_links',
  agentConsents: 'agent_consents',
  agentConversations: 'agent_conversations',
  agentMessages: 'agent_messages',
  agentRuns: 'agent_runs',
  agentWorkerHeartbeats: 'agent_worker_heartbeats',
  consentGrants: 'consent_grants',
  idempotencyRecords: 'idempotency_records',
  productDeliverables: 'product_deliverables',
  mastersConsultations: 'masters_consultations',
  mastersDocuments: 'masters_consultation_documents',
  mastersConsents: 'masters_consultation_consents',
  mastersSnapshots: 'masters_consultation_snapshots',
  mastersStaff: 'masters_staff',
  mastersAssignments: 'masters_consultation_assignments',
  mastersReports: 'masters_reports',
  mastersReportJobs: 'masters_report_jobs',
  mastersAuditLogs: 'masters_audit_logs',
  mastersIdempotencyRecords: 'masters_idempotency_records'
}

const JSON_FIELDS = new Set([
  'assessments.answers',
  'assessments.missingFields',
  'assessments.bankVersions',
  'reports.preview',
  'reports.modules',
  'reports.sources',
  'reports.versions',
  'orders.paymentParams',
  'report_feedback.tags',
  'audit_logs.metadata',
  'agent_messages.contentEnvelope',
  'agent_runs.requestEnvelope',
  'reports.resultPayload',
  'masters_consultations.profile',
  'masters_consultation_documents.extraction',
  'masters_consultation_snapshots.profile',
  'masters_consultation_snapshots.documentIds',
  'masters_reports.payload',
  'masters_audit_logs.metadata'
])

function snake(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)
}

function camel(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`)
  return `"${value}"`
}

function mapRow<T>(row: QueryResultRow): T {
  const result: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(row)) {
    result[camel(key)] = raw instanceof Date ? raw.toISOString() : raw
  }
  return result as T
}

function valueFor(table: string, key: string, value: unknown): { value: unknown; cast: string } {
  // A nullable JSONB domain field must remain SQL NULL. JSON.stringify(null)
  // would store the JSON literal `null`, which fails the V0.5 object-or-NULL
  // constraints and changes legacy null semantics.
  if (value === null) return { value: null, cast: '' }
  if (JSON_FIELDS.has(`${table}.${key}`)) return { value: JSON.stringify(value), cast: '::jsonb' }
  return { value, cast: '' }
}

class PostgresTransaction implements StoreTransaction {
  constructor(private readonly client: PoolClient) {}

  async findById<K extends TableName>(table: K, id: string, options?: { forUpdate?: boolean }): Promise<EntityMap[K] | null> {
    return this.findOne(table, { id } as Filter<EntityMap[K]>, options)
  }

  async findOne<K extends TableName>(table: K, filter: Filter<EntityMap[K]>, options?: { forUpdate?: boolean }): Promise<EntityMap[K] | null> {
    const rows = await this.select(table, filter, 1, options?.forUpdate === true)
    return rows[0] ?? null
  }

  async findMany<K extends TableName>(table: K, filter: Filter<EntityMap[K]> = {}): Promise<EntityMap[K][]> {
    return this.select(table, filter)
  }

  async insert<K extends TableName>(table: K, value: EntityMap[K]): Promise<EntityMap[K]> {
    const tableName = TABLES[table]
    const entries = Object.entries(value).filter(([, item]) => item !== undefined)
    const columns = entries.map(([key]) => identifier(snake(key))).join(', ')
    const values: unknown[] = []
    const placeholders = entries.map(([key, item], index) => {
      const encoded = valueFor(tableName, key, item)
      values.push(encoded.value)
      return `$${index + 1}${encoded.cast}`
    }).join(', ')
    try {
      const result = await this.client.query(
        `INSERT INTO ${identifier(tableName)} (${columns}) VALUES (${placeholders}) RETURNING *`,
        values
      )
      const row = result.rows[0]
      if (!row) throw new AppError(500, 'INSERT_FAILED', `Unable to insert ${tableName}`)
      return mapRow<EntityMap[K]>(row)
    } catch (error) {
      this.rethrowDatabaseError(error)
    }
  }

  async update<K extends TableName>(table: K, id: string, changes: Partial<EntityMap[K]>): Promise<EntityMap[K]> {
    const tableName = TABLES[table]
    const entries = Object.entries(changes).filter(([key, item]) => key !== 'id' && item !== undefined)
    if (entries.length === 0) {
      const current = await this.findById(table, id)
      if (!current) throw new AppError(404, 'ENTITY_NOT_FOUND', `${tableName} entity was not found`)
      return current
    }
    const values: unknown[] = []
    const assignments = entries.map(([key, item], index) => {
      const encoded = valueFor(tableName, key, item)
      values.push(encoded.value)
      return `${identifier(snake(key))} = $${index + 1}${encoded.cast}`
    })
    values.push(id)
    try {
      const result = await this.client.query(
        `UPDATE ${identifier(tableName)} SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values
      )
      const row = result.rows[0]
      if (!row) throw new AppError(404, 'ENTITY_NOT_FOUND', `${tableName} entity was not found`)
      return mapRow<EntityMap[K]>(row)
    } catch (error) {
      this.rethrowDatabaseError(error)
    }
  }

  async delete<K extends TableName>(table: K, id: string): Promise<boolean> {
    const tableName = TABLES[table]
    const result = await this.client.query(
      `DELETE FROM ${identifier(tableName)} WHERE id = $1`,
      [id]
    )
    return (result.rowCount ?? 0) > 0
  }

  private async select<K extends TableName>(
    table: K,
    filter: Filter<EntityMap[K]>,
    limit?: number,
    forUpdate = false
  ): Promise<EntityMap[K][]> {
    const tableName = TABLES[table]
    const entries = Object.entries(filter).filter(([, value]) => value !== undefined)
    const values: unknown[] = []
    const predicates = entries.map(([key, value]) => {
      if (value === null) return `${identifier(snake(key))} IS NULL`
      values.push(value)
      return `${identifier(snake(key))} = $${values.length}`
    })
    const where = predicates.length ? ` WHERE ${predicates.join(' AND ')}` : ''
    const limitSql = limit ? ` LIMIT ${limit}` : ''
    const lockSql = forUpdate ? ' FOR UPDATE' : ''
    const result = await this.client.query(
      `SELECT * FROM ${identifier(tableName)}${where}${limitSql}${lockSql}`,
      values
    )
    return result.rows.map((row) => mapRow<EntityMap[K]>(row))
  }

  private rethrowDatabaseError(error: unknown): never {
    const code = (error as { code?: string }).code
    if (code === '23505') throw new AppError(409, 'UNIQUE_CONSTRAINT', 'The resource already exists')
    if (code === '23503') throw new AppError(409, 'RELATION_CONSTRAINT', 'A related resource is missing')
    throw error
  }
}

export class PostgresStore implements Store {
  readonly pool: Pool

  constructor(connection: string | PoolConfig | Pool) {
    this.pool = connection instanceof Pool ? connection : new Pool(
      typeof connection === 'string'
        ? { connectionString: connection, max: 10, statement_timeout: 10_000, application_name: 'phoenix-family-os' }
        : connection
    )
  }

  async read<T>(work: (tx: StoreTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      return await work(new PostgresTransaction(client))
    } finally {
      client.release()
    }
  }

  async transaction<T>(work: (tx: StoreTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const client = await this.pool.connect()
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
        const result = await work(new PostgresTransaction(client))
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        const code = (error as { code?: string }).code
        // SERIALIZABLE protects the read-then-create workflows. PostgreSQL can
        // still surface a concurrent unique-key winner as 23505 (translated by
        // PostgresTransaction) instead of 40001; replay the whole transaction
        // so the callback can observe and return the committed idempotent row.
        if (attempt < 3 && (code === '40001' || code === '40P01' || code === 'UNIQUE_CONSTRAINT')) continue
        throw error
      } finally {
        client.release()
      }
    }
    throw new Error('Unreachable transaction retry state')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
