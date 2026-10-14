import { Assessment, Order, Report, TableName } from '../domain/model'
import { StoreTransaction } from '../store/store'

/**
 * 删除单个孩子或单份问卷时共用的清理步骤（整号注销仍走 AccountService.deleteAccount）。
 *
 * 订单和权益是财务记录，不删，只和被删的问卷、报告脱钩；时间线和顾问申请只是提到了报告，
 * 也只置空引用。内存库没有外键，这里显式置空，两种 Store 的结果才一致。
 * 只记各表删除的行数，审计日志里不能再出现个人信息。
 */
export class PersonalDataRemoval {
  readonly counts: Record<string, number> = {}

  constructor(private readonly tx: StoreTransaction, private readonly now: string) {}

  async removeAll<K extends TableName>(table: K, rows: Array<{ id: string }>): Promise<void> {
    for (const row of rows) await this.tx.delete(table, row.id)
    if (rows.length) this.counts[table] = (this.counts[table] ?? 0) + rows.length
  }

  /**
   * Detaches orders from deleted questionnaires. Callers have already refused anything paid or in
   * flight; an order still CREATED had no payment signed, so it is closed rather than left open.
   */
  async detachOrders(orders: Order[], options: { student: boolean }): Promise<void> {
    for (const order of orders) {
      await this.tx.update('orders', order.id, {
        assessmentId: null, reportId: null,
        ...(options.student ? { studentId: null } : {}),
        ...(order.status === 'CREATED' ? { status: 'CANCELLED' as const, updatedAt: this.now } : {})
      })
    }
  }

  /** Removes reports and what hangs off them. Run before removeAssessments, as account deletion does. */
  async removeReports(reports: Report[]): Promise<void> {
    const tx = this.tx
    for (const report of reports) {
      for (const conversation of await tx.findMany('agentConversations', { reportId: report.id })) {
        await this.removeAll('agentMessages', await tx.findMany('agentMessages', { conversationId: conversation.id }))
        await this.removeAll('agentRuns', await tx.findMany('agentRuns', { conversationId: conversation.id }))
        await this.removeAll('agentConversations', [conversation])
      }
      await this.removeAll('agentConsents', await tx.findMany('agentConsents', { reportId: report.id }))
      await this.removeAll('reportJobs', await tx.findMany('reportJobs', { reportId: report.id }))
      await this.removeAll('feedback', await tx.findMany('feedback', { reportId: report.id }))
      await this.removeAll('integrationLinks', await tx.findMany('integrationLinks', { entityId: report.id }))
      for (const entitlement of await tx.findMany('entitlements', { reportId: report.id })) {
        await tx.update('entitlements', entitlement.id, { reportId: null })
      }
      for (const event of await tx.findMany('timelineEvents', { reportId: report.id })) {
        await tx.update('timelineEvents', event.id, { reportId: null })
      }
      for (const request of await tx.findMany('advisorRequests', { reportId: report.id })) {
        await tx.update('advisorRequests', request.id, { reportId: null, updatedAt: this.now })
      }
    }
    await this.removeAll('reports', reports)
  }

  /** Removes questionnaires, those that point at another one first (sourceAssessmentId is RESTRICT). */
  async removeAssessments(assessments: Assessment[]): Promise<void> {
    const tx = this.tx
    for (const assessment of assessments) {
      await this.removeAll('integrationLinks', await tx.findMany('integrationLinks', { entityId: assessment.id }))
      // 幂等记录存着请求输入的摘要和资源 ID，资源删了就没有用处，摘要本身也算个人信息。
      await this.removeAll('idempotencyRecords', await tx.findMany('idempotencyRecords', { resourceId: assessment.id }))
      for (const request of await tx.findMany('advisorRequests', { assessmentId: assessment.id })) {
        await tx.update('advisorRequests', request.id, { assessmentId: null, updatedAt: this.now })
      }
    }
    await this.removeAll('assessments', dependencyOrder(assessments))
  }
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
