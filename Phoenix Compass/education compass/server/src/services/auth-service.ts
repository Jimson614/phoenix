import { invariant } from '../domain/errors'
import { User } from '../domain/model'
import { Store } from '../store/store'
import { addMilliseconds, Clock, IdFactory, iso, randomId, randomToken, systemClock, tokenDigest } from '../utils/runtime'
import { WechatAuthProvider } from '../auth/wechat-auth-provider'

export interface AuthSessionDto {
  accessToken: string
  expiresAt: string
  user: Pick<User, 'id' | 'role'>
}

export class AuthService {
  constructor(
    private readonly store: Store,
    private readonly provider: WechatAuthProvider,
    private readonly sessionSecret: string,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdFactory = randomId,
    private readonly sessionTtlMs = 7 * 24 * 60 * 60 * 1000
  ) {
    invariant(sessionSecret.length >= 32, 500, 'SESSION_SECRET_INVALID', 'SESSION_SECRET 至少需要32个字符')
  }

  async createWechatSession(code: string): Promise<AuthSessionDto> {
    const identityResult = await this.provider.exchangeCode(code)
    const accessToken = randomToken()
    const now = iso(this.clock)
    const expiresAt = addMilliseconds(this.clock(), this.sessionTtlMs)

    const user = await this.store.transaction(async (tx) => {
      let identity = await tx.findOne('wechatIdentities', { openid: identityResult.openid }, { forUpdate: true })
      let currentUser: User
      if (!identity) {
        currentUser = await tx.insert('users', { id: this.ids('usr'), role: 'family_user', createdAt: now })
        identity = await tx.insert('wechatIdentities', {
          id: this.ids('wxi'),
          userId: currentUser.id,
          openid: identityResult.openid,
          unionid: identityResult.unionid ?? null,
          createdAt: now
        })
      } else {
        const existing = await tx.findById('users', identity.userId)
        invariant(existing, 500, 'IDENTITY_USER_MISSING', '微信身份未关联有效用户')
        currentUser = existing
      }
      await tx.insert('sessions', {
        id: this.ids('ses'),
        userId: currentUser.id,
        tokenHash: tokenDigest(accessToken, this.sessionSecret),
        expiresAt,
        revokedAt: null,
        createdAt: now
      })
      return currentUser
    })

    return { accessToken, expiresAt, user: { id: user.id, role: user.role } }
  }

  /**
   * A virtual payment is signed with the buyer's current session_key. The Mini Program sends a
   * fresh wx.login code with each payment, which also rules out an expired session_key, and the
   * code must belong to the WeChat identity of the signed-in user.
   */
  async payerSession(userId: string, code: string): Promise<{ openid: string; sessionKey: string }> {
    const result = await this.provider.exchangeCode(code)
    const identity = await this.store.read((tx) => tx.findOne('wechatIdentities', { userId }))
    invariant(identity, 409, 'WECHAT_IDENTITY_REQUIRED', '当前用户未绑定微信身份')
    invariant(identity.openid === result.openid, 403, 'PAYMENT_PAYER_MISMATCH', '请使用登录本小程序的微信账号支付')
    invariant(result.sessionKey, 502, 'WECHAT_SESSION_KEY_MISSING', '微信登录服务未返回登录态，请重试')
    return { openid: result.openid, sessionKey: result.sessionKey }
  }

  async authenticate(accessToken: string): Promise<User> {
    invariant(accessToken.length >= 20, 401, 'AUTH_REQUIRED', '请先登录')
    const digest = tokenDigest(accessToken, this.sessionSecret)
    return this.store.read(async (tx) => {
      const session = await tx.findOne('sessions', { tokenHash: digest })
      invariant(session && !session.revokedAt, 401, 'SESSION_INVALID', '登录状态无效')
      invariant(new Date(session.expiresAt).getTime() > this.clock().getTime(), 401, 'SESSION_EXPIRED', '登录状态已过期')
      const user = await tx.findById('users', session.userId)
      invariant(user, 401, 'SESSION_USER_MISSING', '登录用户不存在')
      return user
    })
  }

  async revokeSession(accessToken: string): Promise<void> {
    invariant(accessToken.length >= 20, 401, 'AUTH_REQUIRED', '请先登录')
    const digest = tokenDigest(accessToken, this.sessionSecret)
    const now = iso(this.clock)
    await this.store.transaction(async (tx) => {
      const session = await tx.findOne('sessions', { tokenHash: digest }, { forUpdate: true })
      invariant(session, 401, 'SESSION_INVALID', '登录状态无效')
      if (!session.revokedAt) await tx.update('sessions', session.id, { revokedAt: now })
    })
  }
}
