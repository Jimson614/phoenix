import { createHmac } from 'node:crypto'
import { AppError, invariant } from '../domain/errors'
import { Clock, systemClock } from '../utils/runtime'

// Mini Program virtual payment (小程序虚拟支付), item direct purchase. The client calls
// wx.requestVirtualPayment with a signData string signed twice: paySig with the AppKey of the
// configured environment and signature with the buyer's current session_key.
// https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html
export const XPAY_MODE = 'short_series_goods' as const
const API_ORIGIN = 'https://api.weixin.qq.com'
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000
const ACCESS_TOKEN_INVALID = new Set([40001, 42001])
// query_order answers an order number it has never seen with 268490002 数据不存在 (probed in the
// sandbox). 268490002 also means a malformed request, so the message is what tells them apart.
const ORDER_ABSENT_CODE = 268490002
const ORDER_ABSENT_MESSAGE = '数据不存在'
const ORDER_NO = /^(?!_)[0-9A-Za-z_\-|*@]{8,32}$/
const REFUND_ORDER_NO = /^[0-9A-Za-z_-]{8,32}$/

export function xpayPaySig(appKey: string, uri: string, body: string): string {
  return createHmac('sha256', appKey).update(`${uri}&${body}`, 'utf8').digest('hex')
}

export function xpayUserSignature(sessionKey: string, body: string): string {
  return createHmac('sha256', sessionKey).update(body, 'utf8').digest('hex')
}

/** True when query_order said the platform holds no order with that number. */
export function isXpayOrderAbsent(error: unknown): boolean {
  if (!(error instanceof AppError) || error.code !== 'VIRTUAL_PAYMENT_API_ERROR') return false
  const details = error.details as { providerCode?: number; providerMessage?: string } | undefined
  return details?.providerCode === ORDER_ABSENT_CODE && (details.providerMessage ?? '').includes(ORDER_ABSENT_MESSAGE)
}

export interface VirtualPaymentProduct {
  /** 道具ID in 虚拟支付 → 道具管理, at most 20 characters. */
  productId: string
  priceFen: number
}

export interface WechatVirtualPaymentConfig {
  appId: string
  appSecret: string
  offerId: string
  /** The AppKey that belongs to env: 现网 AppKey for 0, 沙箱 AppKey for 1. */
  appKey: string
  env: 0 | 1
  /** Our product code → the item sold for it. A product without an item cannot be bought. */
  products: Record<string, VirtualPaymentProduct>
}

export interface VirtualPaymentRequest {
  signData: string
  paySig: string
  signature: string
  mode: typeof XPAY_MODE
}

/** query_order's order, numbers defaulting to 0 when the platform leaves them out. */
export interface XpayOrder {
  orderId: string
  wxOrderId: string
  status: number
  orderType: number
  orderFee: number
  paidFee: number
  refundFee: number
  leftFee: number
  paidTime: number
  envType: number
  wxpayOrderId: string
}

export interface XpayRefundInput {
  openid: string
  orderId: string
  refundOrderId: string
  leftFee: number
  refundFee: number
  /** refund_reason: 0 暂无描述 1 产品问题 2 售后问题 3 用户主动退款 4 价格问题 5 其他原因 */
  reason: '0' | '1' | '2' | '3' | '4' | '5'
  bizMeta: string
}

export class WechatVirtualPayment {
  private token: { value: string; expiresAt: number } | null = null
  private pendingToken: Promise<string> | null = null

  constructor(
    readonly config: WechatVirtualPaymentConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly clock: Clock = systemClock
  ) {
    for (const key of ['appId', 'appSecret', 'offerId', 'appKey'] as const) {
      invariant(typeof config[key] === 'string' && config[key].length > 0, 500, 'VIRTUAL_PAYMENT_CONFIG_INVALID', `虚拟支付配置 ${key} 缺失`)
    }
    invariant(config.env === 0 || config.env === 1, 500, 'VIRTUAL_PAYMENT_CONFIG_INVALID', '虚拟支付环境只能是0（现网）或1（沙箱）')
    invariant(Object.keys(config.products).length > 0, 500, 'VIRTUAL_PAYMENT_CONFIG_INVALID', '虚拟支付没有配置任何道具')
    for (const product of Object.values(config.products)) {
      invariant(product.productId.length > 0 && product.productId.length <= 20 && Number.isInteger(product.priceFen) && product.priceFen > 0,
        500, 'VIRTUAL_PAYMENT_CONFIG_INVALID', '虚拟支付道具配置无效')
    }
  }

  get env(): 0 | 1 { return this.config.env }

  productFor(productCode: string): VirtualPaymentProduct {
    const product = this.config.products[productCode]
    invariant(product, 409, 'VIRTUAL_PAYMENT_PRODUCT_NOT_CONFIGURED', '该商品尚未配置虚拟支付道具，暂不能购买')
    return product
  }

  buildPaymentRequest(
    order: { id: string; outTradeNo: string; productCode: string; amountFen: number },
    sessionKey: string
  ): VirtualPaymentRequest {
    const product = this.productFor(order.productCode)
    invariant(order.amountFen === product.priceFen, 500, 'VIRTUAL_PAYMENT_PRICE_MISMATCH', '订单金额与虚拟支付道具价格不一致')
    invariant(ORDER_NO.test(order.outTradeNo), 500, 'VIRTUAL_PAYMENT_ORDER_NO_INVALID', '订单号不符合虚拟支付要求')
    invariant(sessionKey.length > 0, 500, 'VIRTUAL_PAYMENT_SESSION_KEY_MISSING', '缺少用户登录态')
    const signData = JSON.stringify({
      offerId: this.config.offerId,
      buyQuantity: 1,
      env: this.config.env,
      currencyType: 'CNY',
      productId: product.productId,
      goodsPrice: product.priceFen,
      outTradeNo: order.outTradeNo,
      attach: order.id
    })
    return {
      signData,
      paySig: xpayPaySig(this.config.appKey, 'requestVirtualPayment', signData),
      signature: xpayUserSignature(sessionKey, signData),
      mode: XPAY_MODE
    }
  }

  async queryOrder(openid: string, orderId: string): Promise<XpayOrder> {
    const payload = await this.call<{ order?: Record<string, unknown> }>('/xpay/query_order', { openid, env: this.config.env, order_id: orderId })
    const order = payload.order
    invariant(order && typeof order === 'object' && Number.isInteger(order.status), 502, 'VIRTUAL_PAYMENT_RESPONSE_INVALID', '虚拟支付查单响应无效')
    const number = (key: string): number => (Number.isFinite(Number(order[key])) ? Number(order[key]) : 0)
    return {
      orderId: String(order.order_id ?? ''),
      wxOrderId: String(order.wx_order_id ?? ''),
      status: number('status'),
      orderType: number('order_type'),
      orderFee: number('order_fee'),
      paidFee: number('paid_fee'),
      refundFee: number('refund_fee'),
      leftFee: number('left_fee'),
      paidTime: number('paid_time'),
      envType: number('env_type'),
      wxpayOrderId: String(order.wxpay_order_id ?? '')
    }
  }

  async refundOrder(input: XpayRefundInput): Promise<{ refundOrderId: string; refundWxOrderId: string }> {
    invariant(REFUND_ORDER_NO.test(input.refundOrderId), 500, 'VIRTUAL_PAYMENT_REFUND_NO_INVALID', '退款单号不符合虚拟支付要求')
    invariant(Number.isInteger(input.refundFee) && input.refundFee > 0 && input.refundFee <= input.leftFee,
      400, 'VIRTUAL_PAYMENT_REFUND_AMOUNT_INVALID', '退款金额无效')
    const payload = await this.call<{ refund_order_id?: string; refund_wx_order_id?: string }>('/xpay/refund_order', {
      openid: input.openid,
      order_id: input.orderId,
      refund_order_id: input.refundOrderId,
      left_fee: input.leftFee,
      refund_fee: input.refundFee,
      biz_meta: input.bizMeta,
      refund_reason: input.reason,
      // 1 = 人工客服退款: only an admin starts a refund here.
      req_from: '1',
      env: this.config.env
    })
    return { refundOrderId: String(payload.refund_order_id ?? input.refundOrderId), refundWxOrderId: String(payload.refund_wx_order_id ?? '') }
  }

  /** Needed only when delivery was settled by query: a delivery push answered with success already counts. */
  async notifyProvideGoods(orderId: string): Promise<void> {
    await this.call('/xpay/notify_provide_goods', { order_id: orderId, env: this.config.env })
  }

  private async call<T>(uri: string, payload: Record<string, unknown>, retried = false): Promise<T> {
    const body = JSON.stringify(payload)
    const token = await this.accessToken()
    const url = `${API_ORIGIN}${uri}?access_token=${encodeURIComponent(token)}&pay_sig=${xpayPaySig(this.config.appKey, uri, body)}`
    const result = await this.requestJson(url, body)
    const errcode = Number(result.errcode ?? 0)
    if (errcode !== 0 && ACCESS_TOKEN_INVALID.has(errcode) && !retried) {
      this.token = null
      return this.call<T>(uri, payload, true)
    }
    if (errcode !== 0) {
      throw new AppError(502, 'VIRTUAL_PAYMENT_API_ERROR', '微信虚拟支付接口返回错误', {
        providerCode: errcode, providerMessage: String(result.errmsg ?? '').slice(0, 200)
      })
    }
    return result as T
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS > this.clock().getTime()) return this.token.value
    if (!this.pendingToken) {
      this.pendingToken = (async () => {
        const result = await this.requestJson(`${API_ORIGIN}/cgi-bin/stable_token`, JSON.stringify({
          grant_type: 'client_credential', appid: this.config.appId, secret: this.config.appSecret, force_refresh: false
        }))
        const value = typeof result.access_token === 'string' ? result.access_token : ''
        const expiresIn = Number(result.expires_in)
        if (!value || !Number.isFinite(expiresIn) || expiresIn <= 0) {
          throw new AppError(502, 'WECHAT_ACCESS_TOKEN_UNAVAILABLE', '无法获取微信接口调用凭证', { providerCode: Number(result.errcode ?? 0) })
        }
        this.token = { value, expiresAt: this.clock().getTime() + expiresIn * 1000 }
        return value
      })().finally(() => { this.pendingToken = null })
    }
    return this.pendingToken
  }

  private async requestJson(url: string, body: string): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000)
      })
    } catch {
      throw new AppError(503, 'VIRTUAL_PAYMENT_UNAVAILABLE', '微信虚拟支付服务暂时不可用')
    }
    let parsed: unknown
    try { parsed = await response.json() } catch { throw new AppError(502, 'VIRTUAL_PAYMENT_RESPONSE_INVALID', '微信虚拟支付响应不是有效 JSON') }
    invariant(response.ok && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed),
      502, 'VIRTUAL_PAYMENT_RESPONSE_INVALID', '微信虚拟支付响应无效')
    return parsed as Record<string, unknown>
  }
}
