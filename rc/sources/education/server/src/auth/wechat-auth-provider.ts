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
    const normalized = code.trim()
    invariant(normalized.length >= 3 && normalized.length <= 512, 400, 'INVALID_WECHAT_CODE', '微信登录 code 无效')
    return { openid: `mock_${createHash('sha256').update(normalized).digest('hex').slice(0, 24)}` }
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
    const normalized = code.trim()
    invariant(normalized.length > 0 && normalized.length <= 512, 400, 'INVALID_WECHAT_CODE', '微信登录 code 不能为空或过长')
    const query = new URLSearchParams({
      appid: this.appId,
      secret: this.appSecret,
      js_code: normalized,
      grant_type: 'authorization_code'
    })
    let response: Response
    try {
      response = await this.fetchImpl(`https://api.weixin.qq.com/sns/jscode2session?${query.toString()}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(8_000)
      })
    } catch {
      throw new AppError(503, 'WECHAT_LOGIN_UNAVAILABLE', '微信登录服务暂时不可用')
    }
    let payload: { openid?: string; unionid?: string; errcode?: number; errmsg?: string }
    try {
      payload = await response.json() as typeof payload
    } catch {
      throw new AppError(502, 'WECHAT_LOGIN_RESPONSE_INVALID', '微信登录服务返回无效响应')
    }
    if (!response.ok || payload.errcode || !payload.openid) {
      throw new AppError(401, 'WECHAT_LOGIN_FAILED', '微信登录验证失败', {
        providerCode: payload.errcode ?? response.status
      })
    }
    invariant(payload.openid.length <= 128 && (!payload.unionid || payload.unionid.length <= 128),
      502, 'WECHAT_LOGIN_RESPONSE_INVALID', '微信登录服务返回无效身份')
    return { openid: payload.openid, ...(payload.unionid ? { unionid: payload.unionid } : {}) }
  }
}
