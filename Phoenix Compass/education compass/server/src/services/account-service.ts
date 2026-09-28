import { AppError, invariant } from '../domain/errors'
import { TableName } from '../domain/model'
import { Store, StoreTransaction } from '../store/store'
import { Clock, IdFactory, iso, randomId, systemClock } from '../utils/runtime'

/**
 * 账号注销。
 *
 * 个人数据硬删除，财务记录保留最小集——会计与税务法规要求留存交易凭证，
 * 而个人信息保护要求删除个人数据，这两者只能靠"让财务记录与个人数据脱钩"来同时满足：
 * orders / entitlements 的行留下，但 familyId、studentId、assessmentId、reportId 置空
 * （schema 侧的配合见 migrations/007_account_deletion.sql）。
 *
 * 置空在这里显式执行，不依赖数据库的 ON DELETE SET NULL：内存库没有外键，
 * 依赖数据库行为会让两种 Store 的结果不一致，测试也就证明不了线上行为。
 *
 * users 行本身保留（只剩 id/role/createdAt/deletedAt）。它不含个人信息——
 * 与真人的关联在 wechatIdentities 里，那张表会被删除。保留它是为了让财务记录有归属。
 *
 * 用户随后用同一个微信再次登录会得到一个全新账号：openid 映射已经删除，
 * 注销意味着从头开始，这是预期行为。
 */
export interface AccountDeletionReceipt {
  deletedAt: string
  /** 删除的个人数据行数，按表统计。用于审计与回归断言。 */
  deletedRows: Readonly<Record<string, number>>
  /** 保留下来的财务记录条数。 */
  retainedOrders: number
}

/**
 * 把测评排成可以逐条删除的顺序：被别的测评引用的排在后面。
 * 引用链可能不止两级，所以一轮一轮剥：每轮取出当前没有被剩余测评引用的。
 */
export function dependencyOrder<T extends { id: string; sourceAssessmentId?: string | null }>(items: T[]): T[] {
  const remaining = [...items]
  const ordered: T[] = []
  while (remaining.length) {
    const referenced = new Set(remaining.map((item) => item.sourceAssessmentId).filter(Boolean))
    const leaves = remaining.filter((item) => !referenced.has(item.id))
    // 有环（数据本身不该出现）时不死循环：剩下的原样追加，让数据库的约束报出真实错误。
    if (!leaves.length) return ordered.concat(remaining)
    ordered.push(...leaves)
    for (const leaf of leaves) remaining.splice(remaining.indexOf(leaf), 1)
  }
  return ordered
}

export class AccountService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdFactory = randomId
  ) {}

  async deleteAccount(userId: string): Promise<AccountDeletionReceipt> {
    return this.store.transaction(async (tx) => {
      const user = await tx.findById('users', userId, { forUpdate: true })
      invariant(Boolean(user), 404, 'USER_NOT_FOUND', '账号不存在')
      invariant(!user?.deletedAt, 409, 'ACCOUNT_ALREADY_DELETED', '账号已注销')

      const now = iso(this.clock)
      const counts: Record<string, number> = {}
      const removeAll = async <K extends TableName>(
        table: K, rows: Array<{ id: string }>
      ): Promise<void> => {
        for (const row of rows) await tx.delete(table, row.id)
        if (rows.length) counts[table] = (counts[table] ?? 0) + rows.length
      }

      const families = await tx.findMany('families', { userId })
      const students = (await Promise.all(
        families.map((family) => tx.findMany('students', { familyId: family.id }))
      )).flat()
      const assessments = await tx.findMany('assessments', { userId })
      const reports = await tx.findMany('reports', { userId })
      const orders = await tx.findMany('orders', { userId })
      const entitlements = await tx.findMany('entitlements', { userId })

      // 1. 先让财务记录与个人数据脱钩，否则下面的删除会撞上 ON DELETE RESTRICT。
      for (const order of orders) {
        await tx.update('orders', order.id, {
          familyId: null, studentId: null, assessmentId: null, reportId: null
        })
      }
      for (const entitlement of entitlements) {
        await tx.update('entitlements', entitlement.id, { reportId: null })
      }

      // 2. AI 对话：消息 → 运行记录 → 会话 → 授权。
      const conversations = await tx.findMany('agentConversations', { userId })
      for (const conversation of conversations) {
        await removeAll('agentMessages', await tx.findMany('agentMessages', { conversationId: conversation.id }))
        await removeAll('agentRuns', await tx.findMany('agentRuns', { conversationId: conversation.id }))
      }
      await removeAll('agentConversations', conversations)
      await removeAll('agentConsents', await tx.findMany('agentConsents', { userId }))

      // 3. 报告的生成任务：reportJobs.reportId 是 NOT NULL RESTRICT，必须先删。
      for (const report of reports) {
        await removeAll('reportJobs', await tx.findMany('reportJobs', { reportId: report.id }))
      }

      // 4. 第三方镜像链接：按被删实体逐个清理，订单的链接跟着订单保留。
      for (const entity of [...families, ...students, ...assessments, ...reports]) {
        await removeAll('integrationLinks', await tx.findMany('integrationLinks', { entityId: entity.id }))
      }

      await removeAll('feedback', await tx.findMany('feedback', { userId }))
      await removeAll('advisorRequests', await tx.findMany('advisorRequests', { userId }))
      await removeAll('timelineEvents', await tx.findMany('timelineEvents', { userId }))

      await removeAll('reports', reports)

      // 5. 测评之间可能互相引用（第二级的 sourceAssessmentId 指向第一级，RESTRICT）。
      //    必须按依赖顺序删：先删引用别人的，再删被引用的。
      //
      //    不能先把引用置空再删——assessments 上的 v005 触发器在 UPDATE OF
      //    source_assessment_id 时会重新校验来源测评与同意链接，置空必然失败
      //    （同意已撤回时同样失败），整个注销事务回滚。所以这里只做 DELETE，不做 UPDATE。
      await removeAll('assessments', dependencyOrder(assessments))
      // 同意记录要排在测评之后：assessments 通过 RESTRICT 指向 consentGrants。
      await removeAll('consents', await tx.findMany('consents', { userId }))
      await removeAll('consentGrants', await tx.findMany('consentGrants', { userId }))
      await removeAll('students', students)
      await removeAll('families', families)

      // 6. 断开与真人的关联，并注销全部会话。
      await removeAll('wechatIdentities', await tx.findMany('wechatIdentities', { userId }))
      await removeAll('sessions', await tx.findMany('sessions', { userId }))
      // 幂等记录只在重试窗口内有用；它存着请求输入的摘要和已删除资源的 ID，
      // 账号注销后既无用途，对个人数据取的摘要也仍属个人信息。
      await removeAll('idempotencyRecords', await tx.findMany('idempotencyRecords', { userId }))

      await tx.update('users', userId, { deletedAt: now })

      await tx.insert('auditLogs', {
        id: this.ids('aud'),
        actorUserId: null,
        action: 'ACCOUNT_DELETED',
        entityType: 'users',
        entityId: userId,
        // 审计记录本身不得再保存个人信息，只记数量。
        metadata: { deletedRows: counts, retainedOrders: orders.length },
        createdAt: now
      })

      return { deletedAt: now, deletedRows: counts, retainedOrders: orders.length }
    })
  }

  /** 注销后的 users 行不得再通过微信登录复活，登录路径据此拒绝。 */
  async isDeleted(userId: string): Promise<boolean> {
    const user = await this.store.read((tx: StoreTransaction) => tx.findById('users', userId))
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', '账号不存在')
    return Boolean(user.deletedAt)
  }
}
