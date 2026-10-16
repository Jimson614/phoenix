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

  constructor(private readonly tx: StoreTransaction, readonly now: string) {}

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
 * 删除孩子的规则（2026-10-14 定）：只保留已买过的报告、它们依据的问卷和这个孩子的同意记录，其余全部删除；
 * 一份购买都不剩时连孩子一起删除。孩子删除时执行一次；之后它的某份购买退款成功，那份就不再算"已买过"，
 * 再执行一次。支付或退款还在进行的订单，它的报告先保留，等结果出来再算。
 * 返回 HARD 时孩子这一行已经删除；返回 RETAINED_PURCHASES 时由调用方把孩子标记为已删除。
 */
export async function removeUnpurchasedStudentData(
  tx: StoreTransaction, removal: PersonalDataRemoval, userId: string, studentId: string
): Promise<{ mode: 'HARD' | 'RETAINED_PURCHASES'; retainedReports: number }> {
  const orders = await tx.findMany('orders', { userId, studentId })
  const held = orders.filter((order) => order.status === 'PAID' || order.status === 'PENDING' || order.status === 'REFUNDING')
  const heldReportIds = new Set(held.map((order) => order.reportId).filter(Boolean))
  const assessments = await tx.findMany('assessments', { userId, studentId })
  const byId = new Map(assessments.map((item) => [item.id, item]))
  // 已购报告依据的问卷，以及它的来源问卷（第二级通过 sourceAssessmentId RESTRICT 指向第一级）。
  const retained = new Set<string>()
  for (const assessment of assessments) {
    if (!assessment.reportId || !heldReportIds.has(assessment.reportId)) continue
    let current: Assessment | undefined = assessment
    while (current && !retained.has(current.id)) {
      retained.add(current.id)
      current = current.sourceAssessmentId ? byId.get(current.sourceAssessmentId) : undefined
    }
  }
  const doomed = assessments.filter((item) => !retained.has(item.id))
  const doomedIds = new Set(doomed.map((item) => item.id))
  // 只要还有已付款或在途的订单就不整行删除：哪怕找不到它对应的问卷，也不能连带删掉已购报告。
  const hard = retained.size === 0 && held.length === 0

  await removal.detachOrders(
    orders.filter((order) => !held.includes(order) && (!order.assessmentId || doomedIds.has(order.assessmentId))),
    { student: hard }
  )
  await removal.removeReports((await tx.findMany('reports', { userId, studentId })).filter((report) => doomedIds.has(report.assessmentId)))
  await removal.removeAssessments(doomed)
  if (hard) {
    const conversations = await tx.findMany('agentConversations', { studentId })
    for (const conversation of conversations) {
      await removal.removeAll('agentMessages', await tx.findMany('agentMessages', { conversationId: conversation.id }))
      await removal.removeAll('agentRuns', await tx.findMany('agentRuns', { conversationId: conversation.id }))
    }
    await removal.removeAll('agentConversations', conversations)
    await removal.removeAll('agentConsents', await tx.findMany('agentConsents', { studentId }))
    for (const request of await tx.findMany('advisorRequests', { studentId })) {
      await tx.update('advisorRequests', request.id, { studentId: null, updatedAt: removal.now })
    }
    await removal.removeAll('integrationLinks', await tx.findMany('integrationLinks', { entityId: studentId }))
    // 同意记录排在测评之后：assessments 通过 RESTRICT 指向它们。
    await removal.removeAll('consents', await tx.findMany('consents', { studentId }))
    await removal.removeAll('consentGrants', await tx.findMany('consentGrants', { studentId }))
    await removal.removeAll('students', [{ id: studentId }])
  }
  return { mode: hard ? 'HARD' : 'RETAINED_PURCHASES', retainedReports: heldReportIds.size }
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
