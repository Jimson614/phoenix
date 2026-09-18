import {
  constants,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  KeyObject,
  randomBytes,
  sign as rsaSign,
  verify as rsaVerify
} from 'node:crypto'
import { AppError, invariant } from '../domain/errors'
import { Order, Refund } from '../domain/model'
import { Clock, systemClock } from '../utils/runtime'
import {
  HeaderBag,
  PaymentProvider,
  PrepayResult,
  RefundResult,
  TransactionResult
} from './payment-provider'

const API_ORIGIN = 'https://api.mch.weixin.qq.com'
const SIGNATURE_TYPE = 'WECHATPAY2-SHA256-RSA2048'
const TRANSACTION_STATES = new Set(['SUCCESS', 'REFUND', 'NOTPAY', 'CLOSED', 'REVOKED', 'USERPAYING', 'PAYERROR'])
const REFUND_STATES = new Set(['SUCCESS', 'CLOSED', 'PROCESSING', 'ABNORMAL'])

export interface WechatPayConfig {
  appId: string
  mchId: string
  merchantCertificateSerialNo: string
  merchantPrivateKeyPem: string
  apiV3Key: string
  wechatPayPublicKeyId: string
  wechatPayPublicKeyPem: string
  transactionNotifyUrl: string
  refundNotifyUrl: string
}

export interface EncryptedResource {
  algorithm: string
  ciphertext: string
  nonce: string
  associated_data?: string
  original_type?: string
}

interface NotificationEnvelope {
  id: string
  event_type: string
  resource_type: string
  resource: EncryptedResource
}

function readHeader(headers: HeaderBag | Headers, name: string): string {
  if (headers instanceof Headers) return headers.get(name) ?? ''
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return entry?.[1] ?? ''
}

function rsaOptions(key: KeyObject): { key: KeyObject; padding: number } {
  return { key, padding: constants.RSA_PKCS1_PADDING }
}

export function canonicalApiRequest(method: string, pathWithQuery: string, timestamp: string, nonce: string, rawBody: string): Buffer {
  return Buffer.from(`${method.toUpperCase()}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${rawBody}\n`, 'utf8')
}

export function canonicalWechatMessage(timestamp: string, nonce: string, rawBody: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`, 'utf8'), rawBody, Buffer.from('\n')])
}

export function decryptWechatResource(resource: EncryptedResource, apiV3Key: string): Buffer {
  invariant(resource.algorithm === 'AEAD_AES_256_GCM', 400, 'PAYMENT_RESOURCE_ALGORITHM_INVALID', '支付通知加密算法无效')
  const key = Buffer.from(apiV3Key, 'utf8')
  invariant(key.length === 32, 500, 'WECHATPAY_API_V3_KEY_INVALID', 'WECHATPAY_API_V3_KEY 必须是32字节')
  const combined = Buffer.from(resource.ciphertext, 'base64')
  invariant(combined.length > 16, 400, 'PAYMENT_RESOURCE_INVALID', '支付通知密文无效')
  const ciphertext = combined.subarray(0, combined.length - 16)
  const authenticationTag = combined.subarray(combined.length - 16)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'), { authTagLength: 16 })
    decipher.setAAD(Buffer.from(resource.associated_data ?? '', 'utf8'))
    decipher.setAuthTag(authenticationTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new AppError(401, 'PAYMENT_RESOURCE_DECRYPT_FAILED', '支付通知解密失败')
  }
}

export class WechatPayProvider implements PaymentProvider {
  readonly name = 'wechat' as const
  readonly appId: string
  readonly mchId: string
  private readonly merchantPrivateKey: KeyObject
  private readonly wechatPayPublicKey: KeyObject
  private readonly apiV3Key: string

  constructor(
    private readonly config: WechatPayConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly clock: Clock = systemClock,
    private readonly nonceFactory: () => string = () => randomBytes(16).toString('hex')
  ) {
    this.appId = config.appId
    this.mchId = config.mchId
    for (const [key, value] of Object.entries(config)) {
      invariant(typeof value === 'string' && value.length > 0, 500, 'WECHATPAY_CONFIG_INVALID', `微信支付配置 ${key} 缺失`)
    }
    invariant(Buffer.byteLength(config.apiV3Key, 'utf8') === 32, 500, 'WECHATPAY_API_V3_KEY_INVALID', 'WECHATPAY_API_V3_KEY 必须是32字节')
    invariant(config.transactionNotifyUrl.startsWith('https://') && config.refundNotifyUrl.startsWith('https://'), 500, 'WECHATPAY_NOTIFY_URL_INVALID', '微信支付回调必须使用 HTTPS')
    this.merchantPrivateKey = createPrivateKey(config.merchantPrivateKeyPem)
    this.wechatPayPublicKey = createPublicKey(config.wechatPayPublicKeyPem)
    invariant(this.merchantPrivateKey.asymmetricKeyType === 'rsa', 500, 'WECHATPAY_PRIVATE_KEY_INVALID', '商户私钥必须是 RSA')
    invariant(this.wechatPayPublicKey.asymmetricKeyType === 'rsa', 500, 'WECHATPAY_PUBLIC_KEY_INVALID', '微信支付公钥必须是 RSA')
    const modulusLength = this.merchantPrivateKey.asymmetricKeyDetails?.modulusLength ?? 0
    invariant(modulusLength >= 2048, 500, 'WECHATPAY_PRIVATE_KEY_INVALID', '商户 RSA 私钥至少需要2048位')
    const publicModulusLength = this.wechatPayPublicKey.asymmetricKeyDetails?.modulusLength ?? 0
    invariant(publicModulusLength >= 2048, 500, 'WECHATPAY_PUBLIC_KEY_INVALID', '微信支付 RSA 公钥至少需要2048位')
    this.apiV3Key = config.apiV3Key
  }

  async createPrepay(order: Order, payerOpenid: string): Promise<PrepayResult> {
    invariant(order.amountFen === 3990 && order.currency === 'CNY', 500, 'ORDER_AMOUNT_INVALID', '39.9报告订单金额无效')
    const payload = await this.requestJson<{ prepay_id?: string }>('POST', '/v3/pay/transactions/jsapi', {
      appid: this.appId,
      mchid: this.mchId,
      description: 'Phoenix Education Compass 单次完整报告',
      out_trade_no: order.outTradeNo,
      notify_url: this.config.transactionNotifyUrl,
      time_expire: order.expiresAt,
      amount: { total: 3990, currency: 'CNY' },
      payer: { openid: payerOpenid },
      attach: order.id
    })
    invariant(payload.prepay_id, 502, 'WECHATPAY_PREPAY_INVALID', '微信支付下单未返回 prepay_id')
    const timeStamp = Math.floor(this.clock().getTime() / 1000).toString()
    const nonceStr = this.nonceFactory()
    const packageValue = `prepay_id=${payload.prepay_id}`
    const paymentMessage = Buffer.from(`${this.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`, 'utf8')
    const paySign = rsaSign('RSA-SHA256', paymentMessage, rsaOptions(this.merchantPrivateKey)).toString('base64')
    return {
      providerPrepayId: payload.prepay_id,
      paymentParams: { timeStamp, nonceStr, package: packageValue, signType: 'RSA', paySign }
    }
  }

  async queryOrder(outTradeNo: string): Promise<TransactionResult> {
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(this.mchId)}`
    const payload = await this.requestJson<Record<string, unknown>>('GET', path)
    return this.normalizeTransaction(`query:${String(payload.transaction_id ?? outTradeNo)}`, payload)
  }

  async closeOrder(outTradeNo: string): Promise<void> {
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}/close`
    await this.requestJson<Record<string, never>>('POST', path, { mchid: this.mchId })
  }

  async requestRefund(order: Order, refund: Refund): Promise<{ providerRefundId: string; status: RefundResult['refundStatus'] }> {
    const body: Record<string, unknown> = {
      out_trade_no: order.outTradeNo,
      out_refund_no: refund.outRefundNo,
      reason: refund.reason,
      notify_url: this.config.refundNotifyUrl,
      amount: { refund: refund.amountFen, total: order.amountFen, currency: order.currency }
    }
    if (order.providerTransactionId) {
      delete body.out_trade_no
      body.transaction_id = order.providerTransactionId
    }
    const payload = await this.requestJson<{ refund_id?: string; status?: RefundResult['refundStatus'] }>(
      'POST', '/v3/refund/domestic/refunds', body
    )
    invariant(payload.refund_id && payload.status && REFUND_STATES.has(payload.status),
      502, 'WECHATPAY_REFUND_INVALID', '微信退款响应无效')
    return { providerRefundId: payload.refund_id, status: payload.status }
  }

  async queryRefund(outRefundNo: string): Promise<RefundResult> {
    const path = `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`
    const payload = await this.requestJson<Record<string, unknown>>('GET', path)
    const amount = payload.amount as Record<string, unknown> | undefined
    const refundStatus = String(payload.status ?? '')
    invariant(REFUND_STATES.has(refundStatus), 502, 'WECHATPAY_REFUND_INVALID', '微信退款状态无效')
    const result: RefundResult = {
      eventId: `refund-query:${String(payload.refund_id ?? outRefundNo)}:${String(payload.status ?? '')}`,
      // The domestic refund query response does not include mchid. The
      // authenticated, response-signature-verified request is scoped to this
      // provider instance, so its configured merchant ID is authoritative.
      mchId: String(payload.mchid ?? this.mchId),
      outTradeNo: String(payload.out_trade_no ?? ''),
      outRefundNo: String(payload.out_refund_no ?? ''),
      providerRefundId: String(payload.refund_id ?? ''),
      refundStatus: refundStatus as RefundResult['refundStatus'],
      refundFen: Number(amount?.refund ?? NaN),
      totalFen: Number(amount?.total ?? NaN),
      currency: String(amount?.currency ?? ''),
      ...(payload.success_time ? { successTime: String(payload.success_time) } : {})
    }
    this.validateRefundShape(result)
    return result
  }

  async parseTransactionNotification(headers: HeaderBag, rawBody: Buffer): Promise<TransactionResult> {
    this.verifyWechatMessage(headers, rawBody)
    const envelope = this.parseEnvelope(rawBody)
    invariant(envelope.event_type === 'TRANSACTION.SUCCESS', 400, 'PAYMENT_EVENT_TYPE_INVALID', '仅接受支付成功通知')
    invariant(envelope.resource.original_type === 'transaction', 400, 'PAYMENT_RESOURCE_TYPE_INVALID', '支付通知资源类型无效')
    const plain = this.parseDecryptedObject(envelope.resource, 'PAYMENT_NOTIFICATION_INVALID')
    return this.normalizeTransaction(envelope.id, plain)
  }

  async parseRefundNotification(headers: HeaderBag, rawBody: Buffer): Promise<RefundResult> {
    this.verifyWechatMessage(headers, rawBody)
    const envelope = this.parseEnvelope(rawBody)
    invariant(envelope.event_type.startsWith('REFUND.'), 400, 'REFUND_EVENT_TYPE_INVALID', '退款通知事件类型无效')
    invariant(envelope.resource.original_type === 'refund', 400, 'PAYMENT_RESOURCE_TYPE_INVALID', '退款通知资源类型无效')
    const plain = this.parseDecryptedObject(envelope.resource, 'REFUND_NOTIFICATION_INVALID')
    const amount = plain.amount as Record<string, unknown> | undefined
    const refundStatus = String(plain.refund_status ?? '')
    invariant(REFUND_STATES.has(refundStatus), 400, 'REFUND_STATUS_INVALID', '退款通知状态无效')
    const result: RefundResult = {
      eventId: envelope.id,
      mchId: String(plain.mchid ?? ''),
      outTradeNo: String(plain.out_trade_no ?? ''),
      outRefundNo: String(plain.out_refund_no ?? ''),
      providerRefundId: String(plain.refund_id ?? ''),
      refundStatus: refundStatus as RefundResult['refundStatus'],
      refundFen: Number(amount?.refund ?? NaN),
      totalFen: Number(amount?.total ?? NaN),
      currency: String(amount?.currency ?? ''),
      ...(plain.success_time ? { successTime: String(plain.success_time) } : {})
    }
    this.validateRefundShape(result, 400)
    return result
  }

  signApiRequest(method: string, pathWithQuery: string, timestamp: string, nonce: string, rawBody: string): string {
    return rsaSign(
      'RSA-SHA256',
      canonicalApiRequest(method, pathWithQuery, timestamp, nonce, rawBody),
      rsaOptions(this.merchantPrivateKey)
    ).toString('base64')
  }

  private async requestJson<T>(method: 'GET' | 'POST', pathWithQuery: string, body?: Record<string, unknown>): Promise<T> {
    invariant(pathWithQuery.startsWith('/v3/'), 500, 'WECHATPAY_PATH_INVALID', '微信支付 API 路径无效')
    const rawBody = body === undefined ? '' : JSON.stringify(body)
    const timestamp = Math.floor(this.clock().getTime() / 1000).toString()
    const nonce = this.nonceFactory()
    const signature = this.signApiRequest(method, pathWithQuery, timestamp, nonce, rawBody)
    const authorization = `${SIGNATURE_TYPE} mchid="${this.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${this.config.merchantCertificateSerialNo}"`
    const response = await this.fetchImpl(`${API_ORIGIN}${pathWithQuery}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorization,
        'User-Agent': 'Phoenix-Family-OS/0.1'
      },
      ...(body === undefined ? {} : { body: rawBody }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    })
    const rawResponse = Buffer.from(await response.arrayBuffer())
    this.verifyWechatMessage(response.headers, rawResponse)
    let payload: unknown = {}
    if (rawResponse.length) {
      try { payload = JSON.parse(rawResponse.toString('utf8')) } catch { throw new AppError(502, 'WECHATPAY_RESPONSE_INVALID', '微信支付响应不是有效 JSON') }
    }
    if (!response.ok) {
      const provider = payload as { code?: string }
      throw new AppError(502, 'WECHATPAY_API_ERROR', '微信支付服务返回错误', {
        providerCode: provider.code ?? `HTTP_${response.status}`
      })
    }
    return payload as T
  }

  private verifyWechatMessage(headers: HeaderBag | Headers, rawBody: Buffer): void {
    const timestamp = readHeader(headers, 'Wechatpay-Timestamp')
    const nonce = readHeader(headers, 'Wechatpay-Nonce')
    const serial = readHeader(headers, 'Wechatpay-Serial')
    const signature = readHeader(headers, 'Wechatpay-Signature')
    const signatureType = readHeader(headers, 'Wechatpay-Signature-Type')
    invariant(timestamp && nonce && serial && signature, 401, 'WECHATPAY_SIGNATURE_MISSING', '微信支付签名头缺失')
    invariant(!signatureType || signatureType === SIGNATURE_TYPE, 401, 'WECHATPAY_SIGNATURE_TYPE_INVALID', '微信支付签名类型无效')
    invariant(serial === this.config.wechatPayPublicKeyId, 401, 'WECHATPAY_KEY_ID_UNKNOWN', '未知的微信支付公钥ID')
    const skew = Math.abs(Math.floor(this.clock().getTime() / 1000) - Number(timestamp))
    invariant(Number.isFinite(skew) && skew <= 300, 401, 'WECHATPAY_SIGNATURE_EXPIRED', '微信支付签名时间戳无效')
    const valid = rsaVerify(
      'RSA-SHA256', canonicalWechatMessage(timestamp, nonce, rawBody),
      rsaOptions(this.wechatPayPublicKey), Buffer.from(signature, 'base64')
    )
    invariant(valid, 401, 'WECHATPAY_SIGNATURE_INVALID', '微信支付签名无效')
  }

  private parseEnvelope(rawBody: Buffer): NotificationEnvelope {
    let parsed: unknown
    try { parsed = JSON.parse(rawBody.toString('utf8')) as unknown } catch { throw new AppError(400, 'PAYMENT_NOTIFICATION_INVALID', '支付通知不是有效 JSON') }
    invariant(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed),
      400, 'PAYMENT_NOTIFICATION_INVALID', '支付通知结构无效')
    const envelope = parsed as Partial<NotificationEnvelope>
    invariant(typeof envelope.id === 'string' && envelope.id.length > 0 && envelope.id.length <= 128 &&
      typeof envelope.event_type === 'string' && envelope.resource_type === 'encrypt-resource' &&
      envelope.resource !== null && typeof envelope.resource === 'object' && !Array.isArray(envelope.resource),
      400, 'PAYMENT_NOTIFICATION_INVALID', '支付通知结构无效')
    return envelope as NotificationEnvelope
  }

  private normalizeTransaction(eventId: string, payload: Record<string, unknown>): TransactionResult {
    const amount = payload.amount as Record<string, unknown> | undefined
    const payer = payload.payer as Record<string, unknown> | undefined
    const hasOwn = (value: Record<string, unknown> | undefined, key: string): boolean =>
      Boolean(value && Object.prototype.hasOwnProperty.call(value, key))
    const tradeState = String(payload.trade_state ?? '')
    invariant(TRANSACTION_STATES.has(tradeState), 502, 'WECHATPAY_TRANSACTION_INVALID', '微信支付交易状态无效')
    return {
      eventId,
      appId: String(payload.appid ?? ''),
      mchId: String(payload.mchid ?? ''),
      outTradeNo: String(payload.out_trade_no ?? ''),
      transactionId: String(payload.transaction_id ?? ''),
      tradeType: String(payload.trade_type ?? ''),
      tradeState: tradeState as TransactionResult['tradeState'],
      ...(hasOwn(amount, 'total') ? { totalFen: Number(amount?.total) } : {}),
      ...(hasOwn(amount, 'currency') ? { currency: String(amount?.currency) } : {}),
      ...(hasOwn(payer, 'openid') ? { payerOpenid: String(payer?.openid) } : {}),
      ...(payload.success_time ? { successTime: String(payload.success_time) } : {})
    }
  }

  private parseDecryptedObject(resource: EncryptedResource, code: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(decryptWechatResource(resource, this.apiV3Key).toString('utf8')) as unknown
      invariant(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed),
        400, code, '支付通知解密内容无效')
      return parsed as Record<string, unknown>
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(400, code, '支付通知解密内容无效')
    }
  }

  private validateRefundShape(result: RefundResult, status = 502): void {
    invariant(result.mchId.length > 0 && result.outTradeNo.length > 0 && result.outRefundNo.length > 0 &&
      result.providerRefundId.length > 0 && Number.isInteger(result.refundFen) && result.refundFen > 0 &&
      Number.isInteger(result.totalFen) && result.totalFen > 0 && result.currency.length > 0,
      status, status === 400 ? 'REFUND_NOTIFICATION_INVALID' : 'WECHATPAY_REFUND_INVALID', '微信退款响应结构无效')
  }
}
