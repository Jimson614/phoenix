import { AppError, invariant } from '../domain/errors'
import { TableName } from '../domain/model'
import { Store, StoreTransaction } from '../store/store'
import { Clock, IdFactory, iso, randomId, systemClock } from '../utils/runtime'
import { dependencyOrder, PersonalDataRemoval, removeUnpurchasedStudentData } from './personal-data-removal'

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

export { dependencyOrder }

/** 删除一个孩子档案的回执，只含数量。 */
export interface StudentDeletionReceipt {
  studentId: string
  deletedAt: string
  /** HARD：孩子和他的资料全部删除；RETAINED_PURCHASES：买过报告，孩子行标记删除，已购报告和订单保留。 */
  mode: 'HARD' | 'RETAINED_PURCHASES'
  retainedReports: number
  deletedRows: Readonly<Record<string, number>>
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
          familyId: null, studentId: null, assessmentId: null, reportId: null,
          // 还没签过支付的订单不可能再收到付款，直接关掉，免得永远停在 CREATED。
          // 已签过支付的（PENDING）可能还有付款在路上，保持原状。
          ...(order.status === 'CREATED' ? { status: 'CANCELLED' as const, updatedAt: now } : {})
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

  /**
   * 删除一个孩子档案（家庭档案本身不能删，只能整号注销）。
   *
   * 规则（2026-10-14 定）：已经买过的报告和订单保留在历史订单里。所以买过报告的孩子只把档案标记
   * 为已删除：已购报告、它所依据的问卷和同意记录原样保留，仍可从订单打开；其余问卷、结果和未购买
   * 的报告删除。没买过报告的孩子连同全部资料直接删除。有支付或退款正在进行时拒绝，等结果出来。
   */
  async deleteStudent(userId: string, studentId: string): Promise<StudentDeletionReceipt> {
    return this.store.transaction(async (tx) => {
      const student = await tx.findById('students', studentId, { forUpdate: true })
      invariant(student && !student.deletedAt, 404, 'STUDENT_NOT_FOUND', '孩子档案不存在')
      const family = await tx.findById('families', student.familyId)
      invariant(family?.userId === userId, 403, 'STUDENT_FORBIDDEN', '无权删除该孩子档案')

      const now = iso(this.clock)
      const orders = await tx.findMany('orders', { userId, studentId })
      invariant(!orders.some((order) => order.status === 'PENDING' || order.status === 'REFUNDING'), 409,
        'STUDENT_PAYMENT_IN_PROGRESS', '这个孩子有正在进行的支付或退款，处理完成后再删除')

      // 飞书运营镜像：按撤回镜像同意的方式停掉——撤回这个孩子的镜像同意、阻断他的同步；
      // 同步不会删除远端已有的记录，所以有远端记录时记一条审计，交给运营走人工最小化流程。
      const assessments = await tx.findMany('assessments', { userId, studentId })
      const studentReports = await tx.findMany('reports', { userId, studentId })
      const remoteRecords = await this.stopFeishuMirror(tx, userId, family.id, studentId,
        [studentId, ...assessments.map((item) => item.id), ...studentReports.map((item) => item.id)], now)
      if (remoteRecords > 0) {
        await tx.insert('auditLogs', {
          id: this.ids('aud'), actorUserId: userId, action: 'FEISHU_REMOTE_MINIMIZATION_REVIEW_REQUIRED',
          entityType: 'student', entityId: studentId,
          metadata: { reason: 'STUDENT_DELETED', remoteRecordCount: remoteRecords, sopStatus: 'BLOCKED_EXTERNAL_PRIVACY_APPROVAL' },
          createdAt: now
        })
      }

      const removal = new PersonalDataRemoval(tx, now)
      const outcome = await removeUnpurchasedStudentData(tx, removal, userId, studentId)
      // 已购报告的访问要检查它的同意记录，所以买过报告的孩子保留全部同意记录，只标记删除。
      if (outcome.mode === 'RETAINED_PURCHASES') await tx.update('students', studentId, { deletedAt: now, updatedAt: now })

      const receipt: StudentDeletionReceipt = {
        studentId, deletedAt: now, mode: outcome.mode, retainedReports: outcome.retainedReports, deletedRows: removal.counts
      }
      await tx.insert('auditLogs', {
        id: this.ids('aud'), actorUserId: userId, action: 'STUDENT_DELETED', entityType: 'students', entityId: studentId,
        metadata: { mode: receipt.mode, retainedReports: receipt.retainedReports, deletedRows: removal.counts }, createdAt: now
      })
      return receipt
    })
  }

  /**
   * 撤回孩子的飞书镜像同意，阻断这个孩子及其问卷、报告的同步关联；家里没有别的孩子还在镜像时，
   * 家庭记录也一起阻断（和撤回同意时一样，家庭镜像依附于孩子的同意）。返回远端已有记录的条数。
   */
  private async stopFeishuMirror(
    tx: StoreTransaction, userId: string, familyId: string, studentId: string, entityIds: string[], now: string
  ): Promise<number> {
    for (const grant of await tx.findMany('consentGrants', { userId, studentId, scope: 'FEISHU_PROFILE_MIRROR', withdrawnAt: null })) {
      await tx.update('consentGrants', grant.id, { withdrawnAt: now, updatedAt: now })
    }
    const familyStillMirrored = Boolean(await tx.findOne('consentGrants', {
      userId, familyId, scope: 'FEISHU_PROFILE_MIRROR', withdrawnAt: null
    }))
    let remoteRecords = 0
    for (const entityId of familyStillMirrored ? entityIds : [...entityIds, familyId]) {
      for (const link of await tx.findMany('integrationLinks', { provider: 'feishu_bitable', entityId })) {
        if (link.externalRecordId) remoteRecords += 1
        await tx.update('integrationLinks', link.id, {
          status: 'BLOCKED', leaseToken: null, operationToken: null, operationDigest: null, operationBody: null,
          lastErrorCode: 'FEISHU_SUBJECT_DELETED', nextAttemptAt: null, updatedAt: now
        })
      }
    }
    return remoteRecords
  }

  /** 注销后的 users 行不得再通过微信登录复活，登录路径据此拒绝。 */
  async isDeleted(userId: string): Promise<boolean> {
    const user = await this.store.read((tx: StoreTransaction) => tx.findById('users', userId))
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', '账号不存在')
    return Boolean(user.deletedAt)
  }
}
