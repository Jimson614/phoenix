import { AppError } from '../domain/errors'
import { emptyState, EntityMap, TableName } from '../domain/model'
import { Filter, Store, StoreTransaction } from './store'

type DatabaseState = ReturnType<typeof emptyState>

function clone<T>(value: T): T {
  return structuredClone(value)
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left instanceof Date && typeof right === 'string') return left.toISOString() === right
  return false
}

class MemoryTransaction implements StoreTransaction {
  constructor(private readonly state: DatabaseState) {}

  async findById<K extends TableName>(table: K, id: string): Promise<EntityMap[K] | null> {
    const found = this.state[table].find((item) => item.id === id) as EntityMap[K] | undefined
    return found ? clone(found) : null
  }

  async findOne<K extends TableName>(table: K, filter: Filter<EntityMap[K]>): Promise<EntityMap[K] | null> {
    const rows = await this.findMany(table, filter)
    return rows[0] ?? null
  }

  async findMany<K extends TableName>(table: K, filter: Filter<EntityMap[K]> = {}): Promise<EntityMap[K][]> {
    const entries = Object.entries(filter) as Array<[keyof EntityMap[K], unknown]>
    return (this.state[table] as EntityMap[K][])
      .filter((item) => entries.every(([key, expected]) => sameValue(item[key], expected)))
      .map(clone)
  }

  async insert<K extends TableName>(table: K, value: EntityMap[K]): Promise<EntityMap[K]> {
    const rows = this.state[table] as EntityMap[K][]
    if (rows.some((item) => item.id === value.id)) {
      throw new AppError(409, 'DUPLICATE_ENTITY', `${table} id already exists`)
    }
    this.assertNaturalUniqueness(table, value)
    rows.push(clone(value))
    return clone(value)
  }

  async update<K extends TableName>(table: K, id: string, changes: Partial<EntityMap[K]>): Promise<EntityMap[K]> {
    const rows = this.state[table] as EntityMap[K][]
    const index = rows.findIndex((item) => item.id === id)
    if (index < 0) throw new AppError(404, 'ENTITY_NOT_FOUND', `${table} entity was not found`)
    const current = rows[index]
    if (!current) throw new AppError(404, 'ENTITY_NOT_FOUND', `${table} entity was not found`)
    const next = { ...current, ...clone(changes) } as EntityMap[K]
    this.assertNaturalUniqueness(table, next, id)
    rows[index] = next
    return clone(next)
  }

  async delete<K extends TableName>(table: K, id: string): Promise<boolean> {
    const rows = this.state[table] as EntityMap[K][]
    const index = rows.findIndex((item) => item.id === id)
    if (index < 0) return false
    rows.splice(index, 1)
    return true
  }

  private assertNaturalUniqueness<K extends TableName>(table: K, value: EntityMap[K], ignoreId?: string): void {
    const rows = this.state[table] as EntityMap[K][]
    const duplicate = (predicate: (item: EntityMap[K]) => boolean): boolean =>
      rows.some((item) => item.id !== ignoreId && predicate(item))

    if (table === 'wechatIdentities' && duplicate((item) => (item as EntityMap['wechatIdentities']).openid === (value as EntityMap['wechatIdentities']).openid)) {
      throw new AppError(409, 'DUPLICATE_OPENID', 'WeChat identity already exists')
    }
    if (table === 'sessions' && duplicate((item) => (item as EntityMap['sessions']).tokenHash === (value as EntityMap['sessions']).tokenHash)) {
      throw new AppError(409, 'DUPLICATE_SESSION', 'Session already exists')
    }
    if (table === 'orders') {
      const order = value as EntityMap['orders']
      if (duplicate((item) => {
        const other = item as EntityMap['orders']
        const active = ['CREATED', 'PENDING', 'PAID', 'REFUNDING']
        return other.outTradeNo === order.outTradeNo ||
          (other.userId === order.userId && other.idempotencyKey === order.idempotencyKey) ||
          (active.includes(other.status) && active.includes(order.status) && other.userId === order.userId &&
            other.assessmentId === order.assessmentId && other.productCode === order.productCode)
      })) throw new AppError(409, 'DUPLICATE_ORDER', 'An order already exists for this assessment and product')
    }
    if (table === 'orders' && (value as EntityMap['orders']).providerTransactionId) {
      const transactionId = (value as EntityMap['orders']).providerTransactionId
      if (duplicate((item) => (item as EntityMap['orders']).providerTransactionId === transactionId)) {
        throw new AppError(409, 'DUPLICATE_TRANSACTION', 'Provider transaction already belongs to another order')
      }
    }
    if (table === 'paymentEvents' && duplicate((item) => (item as EntityMap['paymentEvents']).providerEventId === (value as EntityMap['paymentEvents']).providerEventId)) {
      throw new AppError(409, 'DUPLICATE_PAYMENT_EVENT', 'Payment event already exists')
    }
    if (table === 'entitlements' && duplicate((item) => (item as EntityMap['entitlements']).orderId === (value as EntityMap['entitlements']).orderId)) {
      throw new AppError(409, 'DUPLICATE_ENTITLEMENT', 'Entitlement already exists')
    }
    if (table === 'reportJobs' && (value as EntityMap['reportJobs']).orderId &&
      duplicate((item) => (item as EntityMap['reportJobs']).orderId === (value as EntityMap['reportJobs']).orderId)) {
      throw new AppError(409, 'DUPLICATE_REPORT_JOB', 'Report job already exists')
    }
    if (table === 'refunds' && duplicate((item) => (item as EntityMap['refunds']).orderId === (value as EntityMap['refunds']).orderId)) {
      throw new AppError(409, 'DUPLICATE_REFUND', 'Refund already exists')
    }
    if (table === 'refunds') {
      const refund = value as EntityMap['refunds']
      if (duplicate((item) => {
        const other = item as EntityMap['refunds']
        return other.outRefundNo === refund.outRefundNo ||
          (other.requestedBy === refund.requestedBy && other.idempotencyKey === refund.idempotencyKey)
      })) throw new AppError(409, 'DUPLICATE_REFUND', 'Refund idempotency key already exists')
    }
    if (table === 'integrationLinks') {
      const link = value as EntityMap['integrationLinks']
      if (duplicate((item) => {
        const other = item as EntityMap['integrationLinks']
        return other.provider === link.provider && other.tableId === link.tableId &&
          other.entityType === link.entityType && other.entityId === link.entityId
      })) throw new AppError(409, 'DUPLICATE_INTEGRATION_LINK', 'Integration entity link already exists')
      if (link.externalRecordId && duplicate((item) => {
        const other = item as EntityMap['integrationLinks']
        return other.provider === link.provider && other.tableId === link.tableId &&
          other.externalRecordId === link.externalRecordId
      })) throw new AppError(409, 'DUPLICATE_EXTERNAL_RECORD', 'External record already belongs to another entity')
    }
    if (table === 'agentConversations') {
      const conversation = value as EntityMap['agentConversations']
      if (duplicate((item) => {
        const other = item as EntityMap['agentConversations']
        return other.consentId === conversation.consentId ||
          (other.userId === conversation.userId && other.reportId === conversation.reportId &&
            other.creationKeyDigest === conversation.creationKeyDigest) ||
          (other.status === 'ACTIVE' && conversation.status === 'ACTIVE' &&
            other.userId === conversation.userId && other.reportId === conversation.reportId &&
            other.purpose === conversation.purpose)
      })) throw new AppError(409, 'DUPLICATE_AGENT_CONVERSATION', 'An Agent conversation already exists')
    }
    if (table === 'agentRuns') {
      const run = value as EntityMap['agentRuns']
      if (duplicate((item) => {
        const other = item as EntityMap['agentRuns']
        const pending = ['QUEUED', 'RUNNING']
        return (other.conversationId === run.conversationId && other.idempotencyKeyDigest === run.idempotencyKeyDigest) ||
          (Boolean(run.userMessageId) && other.userMessageId === run.userMessageId) ||
          (Boolean(run.assistantMessageId) && other.assistantMessageId === run.assistantMessageId) ||
          (pending.includes(other.status) && pending.includes(run.status) && other.conversationId === run.conversationId)
      })) throw new AppError(409, 'DUPLICATE_AGENT_RUN', 'An Agent run already exists')
    }
    if (table === 'idempotencyRecords') {
      const record = value as EntityMap['idempotencyRecords']
      if (duplicate((item) => {
        const other = item as EntityMap['idempotencyRecords']
        return other.userId === record.userId && other.domain === record.domain && other.keyDigest === record.keyDigest
      })) throw new AppError(409, 'DUPLICATE_IDEMPOTENCY_RECORD', 'Idempotency key already exists in this domain')
    }
    if (table === 'consentGrants') {
      const grant = value as EntityMap['consentGrants']
      if (!grant.withdrawnAt && duplicate((item) => {
        const other = item as EntityMap['consentGrants']
        return !other.withdrawnAt && other.userId === grant.userId && other.subjectType === grant.subjectType &&
          other.subjectId === grant.subjectId && other.scope === grant.scope
      })) throw new AppError(409, 'DUPLICATE_ACTIVE_CONSENT', 'An active consent already exists')
    }
    if (table === 'productDeliverables' && duplicate((item) =>
      (item as EntityMap['productDeliverables']).productCode === (value as EntityMap['productDeliverables']).productCode)) {
      throw new AppError(409, 'DUPLICATE_PRODUCT_DELIVERABLE', 'Product deliverable already exists')
    }
  }
}

export class InMemoryStore implements Store {
  private state: DatabaseState
  private tail: Promise<void> = Promise.resolve()

  constructor(initial?: Partial<DatabaseState>) {
    this.state = { ...emptyState(), ...(initial ? clone(initial) : {}) }
  }

  async read<T>(work: (tx: StoreTransaction) => Promise<T>): Promise<T> {
    return this.withLock(async () => work(new MemoryTransaction(clone(this.state))))
  }

  async transaction<T>(work: (tx: StoreTransaction) => Promise<T>): Promise<T> {
    return this.withLock(async () => {
      const draft = clone(this.state)
      const result = await work(new MemoryTransaction(draft))
      this.state = draft
      await this.afterCommit(clone(this.state))
      return clone(result)
    })
  }

  protected async afterCommit(_snapshot: DatabaseState): Promise<void> {}

  protected snapshot(): DatabaseState {
    return clone(this.state)
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release = (): void => {}
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await work()
    } finally {
      release()
    }
  }
}
