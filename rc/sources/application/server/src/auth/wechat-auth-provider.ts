import { createHash } from 'node:crypto'
import { AppError, invariant } from '../domain/errors'

export interface WechatCodeSession {
  openid: string
  unionid?: string
}

export interface WechatAuthProvider {
  exchangeCode(code: string): Promise<WechatCodeSession>
}

export class MockWechatAuthProvider implements WechatAuthProvider {
  async exchangeCode(code: string): Promise<WechatCodeSession> {
    invariant(code.trim().length >= 3, 400, 'INVALID_WECHAT_CODE', '微信登录 code 无效')
    return { openid: `mock_${createHash('sha256').update(code).digest('hex').slice(0, 24)}` }
  }
}

export class WechatApiAuthProvider implements WechatAuthProvider {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    invariant(appId.length > 0 && appSecret.length > 0, 500, 'WECHAT_AUTH_CONFIG_INVALID', '微信登录配置不完整')
  }

  async exchangeCode(code: string): Promise<WechatCodeSession> {
    invariant(code.trim().length > 0, 400, 'INVALID_WECHAT_CODE', '微信登录 code 不能为空')
    const query = new URLSearchParams({
      appid: this.appId,
      secret: this.appSecret,
      js_code: code,
      grant_type: 'authorization_code'
    })
    const response = await this.fetchImpl(`https://api.weixin.qq.com/sns/jscode2session?${query.toString()}`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(8_000)
    })
    const payload = await response.json() as { openid?: string; unionid?: string; errcode?: number; errmsg?: string }
    if (!response.ok || !payload.openid) {
      throw new AppError(401, 'WECHAT_LOGIN_FAILED', '微信登录验证失败', {
        providerCode: payload.errcode ?? response.status
      })
    }
    return { openid: payload.openid, ...(payload.unionid ? { unionid: payload.unionid } : {}) }
  }
}
