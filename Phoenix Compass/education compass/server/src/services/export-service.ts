import { invariant } from '../domain/errors'
import { Store, StoreTransaction } from '../store/store'
import { Clock, iso, systemClock } from '../utils/runtime'

/**
 * 个人信息导出（可携带权）。
 *
 * 输出一份结构化、机器可读的 JSON，覆盖该用户在本系统内的全部个人数据。
 * 与账号注销（account-service）是同一类法定义务的两面：一个是带走，一个是删除。
 *
 * 刻意排除两类字段，并在导出文件里写明原因，而不是悄悄省略：
 *
 * - **openid / unionid**：docs/API.md 明确规定绝不把 OpenID 返回客户端。它是微信侧的
 *   账号标识，泄露后可被用于跨系统关联；导出文件会经微信转发、落到聊天记录里，
 *   把它放进去等于绕开那条规定。用户身份由本系统的 userId 代表已经足够。
 * - **会话凭据哈希**：那是认证材料，不是用户资料，导出它只会增加被盗用的面。
 *
 * 不含其他用户的任何数据：所有查询都以 userId 为界。
 */

/** 导出里排除的字段及原因，跟着文件一起给用户，便于核对完整性。 */
const EXCLUSIONS = Object.freeze([
  { field: 'openid / unionid', reason: '微信账号标识，按接口安全约定不返回客户端；本系统内由 userId 代表你的身份' },
  { field: 'sessions.tokenHash', reason: '登录凭据的哈希，属于认证材料而非个人资料' }
])

export interface AgentExportSource {
  /** 返回该用户的 AI 对话与消息正文（需要密钥环解密，所以由 AgentService 自己导出）。 */
  exportForUser(userId: string): Promise<unknown>
}

export class ExportService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock = systemClock,
    private readonly agent?: AgentExportSource
  ) {}

  async exportForUser(userId: string): Promise<Record<string, unknown>> {
    const core = await this.store.read(async (tx: StoreTransaction) => {
      const user = await tx.findById('users', userId)
      invariant(user, 404, 'USER_NOT_FOUND', '账号不存在')
      invariant(!user.deletedAt, 410, 'ACCOUNT_DELETED', '账号已注销，数据已删除')

      const families = await tx.findMany('families', { userId })
      const students = (await Promise.all(
        families.map((family) => tx.findMany('students', { familyId: family.id }))
      )).flat()

      return {
        account: { userId: user.id, role: user.role, createdAt: user.createdAt },
        families,
        students,
        guardianConsents: await tx.findMany('consents', { userId }),
        consentGrants: await tx.findMany('consentGrants', { userId }),
        assessments: await tx.findMany('assessments', { userId }),
        reports: await tx.findMany('reports', { userId }),
        orders: await tx.findMany('orders', { userId }),
        entitlements: await tx.findMany('entitlements', { userId }),
        timeline: await tx.findMany('timelineEvents', { userId }),
        reportFeedback: await tx.findMany('feedback', { userId }),
        advisorRequests: await tx.findMany('advisorRequests', { userId }),
        aiAnalysisConsents: await tx.findMany('agentConsents', { userId })
      }
    })

    // AI 对话正文是加密存储的，只有 AgentService 持有密钥环；Agent 未启用时
    // 如实写明"未导出"，而不是假装这部分不存在。
    let aiConversations: unknown
    if (this.agent) {
      aiConversations = await this.agent.exportForUser(userId)
    } else {
      aiConversations = { exported: false, reason: 'AI 功能当前未启用，本账号没有 AI 对话内容' }
    }

    return {
      schema: 'phoenix_education_compass_personal_data_export_v1',
      exportedAt: iso(this.clock),
      notice: '这是你在 Phoenix Education Compass 内的个人数据副本。其中包含未成年人信息，请妥善保管。',
      excludedFields: EXCLUSIONS,
      data: { ...core, aiConversations }
    }
  }
}
