import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
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

function header(headers: HeaderBag, name: string): string {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return entry?.[1] ?? ''
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const
  readonly appId: string
  readonly mchId: string
  private readonly states = new Map<string, TransactionResult>()
  private readonly refundStates = new Map<string, RefundResult>()

  constructor(
    private readonly secret: string,
    options: { appId?: string; mchId?: string; clock?: Clock } = {}
  ) {
    invariant(secret.length >= 16, 500, 'MOCK_PAYMENT_CONFIG_INVALID', 'Mock payment secret is too short')
    this.appId = options.appId ?? 'wx_mock_phoenix'
    this.mchId = options.mchId ?? 'mock_mch_3990'
    this.clock = options.clock ?? systemClock
  }

  private readonly clock: Clock

  async createPrepay(order: Order, payerOpenid: string): Promise<PrepayResult> {
    const prepayId = `mock_prepay_${order.outTradeNo}`
    if (!this.states.has(order.outTradeNo)) {
      this.states.set(order.outTradeNo, {
        eventId: `mock_query_${order.outTradeNo}`,
        appId: this.appId,
        mchId: this.mchId,
        outTradeNo: order.outTradeNo,
        transactionId: `mock_tx_${order.outTradeNo}`,
        tradeType: 'JSAPI',
        tradeState: 'NOTPAY',
        totalFen: order.amountFen,
        currency: order.currency,
        payerOpenid
      })
    }
    const timeStamp = Math.floor(this.clock().getTime() / 1000).toString()
    const nonceStr = randomBytes(16).toString('hex')
    const packageValue = `prepay_id=${prepayId}`
    const paySign = createHmac('sha256', this.secret)
      .update(`${this.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`)
      .digest('base64')
    return {
      providerPrepayId: prepayId,
      paymentParams: { timeStamp, nonceStr, package: packageValue, signType: 'RSA', paySign }
    }
  }

  async queryOrder(outTradeNo: string): Promise<TransactionResult> {
    const result = this.states.get(outTradeNo)
    if (!result) throw new AppError(404, 'MOCK_ORDER_NOT_FOUND', 'Mock order was not found')
    return structuredClone(result)
  }

  async closeOrder(outTradeNo: string): Promise<void> {
    const current = this.states.get(outTradeNo)
    if (!current) throw new AppError(404, 'MOCK_ORDER_NOT_FOUND', 'Mock order was not found')
    if (current.tradeState === 'SUCCESS') throw new AppError(409, 'MOCK_ORDER_ALREADY_PAID', 'Mock order is already paid')
    this.states.set(outTradeNo, { ...current, tradeState: 'CLOSED' })
  }

  setOrderState(outTradeNo: string, state: TransactionResult['tradeState']): void {
    const current = this.states.get(outTradeNo)
    if (!current) throw new Error('Mock order must be pre-created')
    this.states.set(outTradeNo, {
      ...current,
      tradeState: state,
      ...(state === 'SUCCESS' ? { successTime: this.clock().toISOString() } : {})
    })
  }

  async requestRefund(_order: Order, refund: Refund): Promise<{ providerRefundId: string; status: RefundResult['refundStatus'] }> {
    const providerRefundId = `mock_refund_${refund.outRefundNo}`
    this.refundStates.set(refund.outRefundNo, {
      eventId: `mock_refund_query_${refund.outRefundNo}`,
      mchId: this.mchId,
      outTradeNo: _order.outTradeNo,
      outRefundNo: refund.outRefundNo,
      providerRefundId,
      refundStatus: 'PROCESSING',
      refundFen: refund.amountFen,
      totalFen: _order.amountFen,
      currency: refund.currency
    })
    return { providerRefundId, status: 'PROCESSING' }
  }

  async queryRefund(outRefundNo: string): Promise<RefundResult> {
    const result = this.refundStates.get(outRefundNo)
    if (!result) throw new AppError(404, 'MOCK_REFUND_NOT_FOUND', 'Mock refund was not found')
    return structuredClone(result)
  }

  setRefundState(outRefundNo: string, state: RefundResult['refundStatus']): void {
    const current = this.refundStates.get(outRefundNo)
    if (!current) throw new Error('Mock refund must be requested first')
    this.refundStates.set(outRefundNo, {
      ...current,
      refundStatus: state,
      ...(state === 'SUCCESS' ? { successTime: this.clock().toISOString() } : {})
    })
  }

  async parseTransactionNotification(headers: HeaderBag, rawBody: Buffer): Promise<TransactionResult> {
    this.verify(headers, rawBody)
    const parsed = JSON.parse(rawBody.toString('utf8')) as { type?: string; transaction?: TransactionResult }
    invariant(parsed.type === 'TRANSACTION' && parsed.transaction, 400, 'MOCK_NOTIFICATION_INVALID', 'Mock transaction notification is invalid')
    return parsed.transaction
  }

  async parseRefundNotification(headers: HeaderBag, rawBody: Buffer): Promise<RefundResult> {
    this.verify(headers, rawBody)
    const parsed = JSON.parse(rawBody.toString('utf8')) as { type?: string; refund?: RefundResult }
    invariant(parsed.type === 'REFUND' && parsed.refund, 400, 'MOCK_NOTIFICATION_INVALID', 'Mock refund notification is invalid')
    return parsed.refund
  }

  makeTransactionNotification(transaction: TransactionResult): { headers: HeaderBag; rawBody: Buffer } {
    return this.makeNotification({ type: 'TRANSACTION', transaction })
  }

  makeRefundNotification(refund: RefundResult): { headers: HeaderBag; rawBody: Buffer } {
    return this.makeNotification({ type: 'REFUND', refund })
  }

  private makeNotification(payload: Record<string, unknown>): { headers: HeaderBag; rawBody: Buffer } {
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8')
    const timestamp = Math.floor(this.clock().getTime() / 1000).toString()
    const nonce = randomBytes(12).toString('hex')
    const signature = this.sign(timestamp, nonce, rawBody)
    return {
      headers: {
        'wechatpay-timestamp': timestamp,
        'wechatpay-nonce': nonce,
        'wechatpay-serial': 'MOCK_KEY_ID',
        'wechatpay-signature': signature,
        'wechatpay-signature-type': 'WECHATPAY2-SHA256-RSA2048'
      },
      rawBody
    }
  }

  private verify(headers: HeaderBag, rawBody: Buffer): void {
    const timestamp = header(headers, 'wechatpay-timestamp')
    const nonce = header(headers, 'wechatpay-nonce')
    const signature = header(headers, 'wechatpay-signature')
    invariant(timestamp && nonce && signature, 401, 'PAYMENT_SIGNATURE_MISSING', '支付通知签名头缺失')
    const skew = Math.abs(Math.floor(this.clock().getTime() / 1000) - Number(timestamp))
    invariant(Number.isFinite(skew) && skew <= 300, 401, 'PAYMENT_SIGNATURE_EXPIRED', '支付通知时间戳无效')
    const expected = Buffer.from(this.sign(timestamp, nonce, rawBody), 'base64')
    const provided = Buffer.from(signature, 'base64')
    invariant(expected.length === provided.length && timingSafeEqual(expected, provided), 401, 'PAYMENT_SIGNATURE_INVALID', '支付通知签名无效')
  }

  private sign(timestamp: string, nonce: string, rawBody: Buffer): string {
    return createHmac('sha256', this.secret)
      .update(Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), rawBody, Buffer.from('\n')]))
      .digest('base64')
  }
}
