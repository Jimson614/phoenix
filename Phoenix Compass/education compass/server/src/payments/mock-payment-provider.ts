import { AppError, invariant } from '../domain/errors'
import { Order, Refund } from '../domain/model'
import { COMPASS_PRODUCT_CODE, GROWTH_DISCOVERY_PRODUCT_CODE } from '../domain/products'
import { Clock, systemClock } from '../utils/runtime'
import { PayerSession, PaymentProvider, RefundResult, TransactionResult } from './payment-provider'
import { VirtualPaymentRequest, XPAY_MODE, xpayPaySig, xpayUserSignature } from './wechat-virtual-payment'

interface MockAttempt extends TransactionResult {
  orderId: string
  delivered: boolean
}

/**
 * In-memory stand-in for virtual payment. It signs like the real thing with a local secret, and
 * tests move attempts and refunds between states and build the pushes WeChat would send.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const
  readonly env: 0 | 1
  private readonly attempts = new Map<string, MockAttempt>()
  private readonly refundStates = new Map<string, RefundResult>()
  private readonly clock: Clock
  private readonly products: Record<string, string>

  constructor(
    private readonly secret: string,
    options: { env?: 0 | 1; clock?: Clock; products?: Record<string, string> } = {}
  ) {
    invariant(secret.length >= 16, 500, 'MOCK_PAYMENT_CONFIG_INVALID', 'Mock payment secret is too short')
    this.env = options.env ?? 1
    this.clock = options.clock ?? systemClock
    this.products = options.products ?? {
      [GROWTH_DISCOVERY_PRODUCT_CODE]: GROWTH_DISCOVERY_PRODUCT_CODE,
      [COMPASS_PRODUCT_CODE]: COMPASS_PRODUCT_CODE
    }
  }

  productIdFor(productCode: string): string {
    const productId = this.products[productCode]
    invariant(productId, 409, 'VIRTUAL_PAYMENT_PRODUCT_NOT_CONFIGURED', '该商品尚未配置虚拟支付道具，暂不能购买')
    return productId
  }

  createPayment(order: Order, payer: PayerSession): VirtualPaymentRequest {
    const productId = this.productIdFor(order.productCode)
    if (!this.attempts.has(order.outTradeNo)) {
      this.attempts.set(order.outTradeNo, {
        eventId: `mock_query:${order.outTradeNo}`, outTradeNo: order.outTradeNo, orderId: order.id,
        transactionId: `mock_tx_${order.outTradeNo}`, tradeState: 'NOTPAY', env: this.env,
        totalFen: order.amountFen, productId, payerOpenid: payer.openid, delivered: false
      })
    }
    const signData = JSON.stringify({
      offerId: 'mock_offer', buyQuantity: 1, env: this.env, currencyType: 'CNY', productId,
      goodsPrice: order.amountFen, outTradeNo: order.outTradeNo, attach: order.id
    })
    return {
      signData,
      paySig: xpayPaySig(this.secret, 'requestVirtualPayment', signData),
      signature: xpayUserSignature(payer.sessionKey, signData),
      mode: XPAY_MODE
    }
  }

  async queryAttempt(outTradeNo: string): Promise<TransactionResult> {
    const attempt = this.attempts.get(outTradeNo)
    if (!attempt) throw new AppError(404, 'MOCK_ORDER_NOT_FOUND', 'Mock order was not found')
    const { orderId: _orderId, delivered: _delivered, ...result } = attempt
    return { ...structuredClone(result), eventId: `mock_query:${outTradeNo}:${attempt.tradeState}` }
  }

  async confirmDelivery(outTradeNo: string): Promise<void> {
    const attempt = this.attempts.get(outTradeNo)
    if (attempt) attempt.delivered = true
  }

  isDelivered(outTradeNo: string): boolean {
    return this.attempts.get(outTradeNo)?.delivered === true
  }

  setOrderState(outTradeNo: string, state: TransactionResult['tradeState']): void {
    const current = this.attempts.get(outTradeNo)
    if (!current) throw new Error('Mock order must be pre-created')
    this.attempts.set(outTradeNo, {
      ...current,
      tradeState: state,
      ...(state === 'SUCCESS' ? { successTime: this.clock().toISOString() } : {})
    })
  }

  /** The decrypted xpay_goods_deliver_notify WeChat would push for a paid attempt. */
  deliveryEvent(outTradeNo: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const attempt = this.attempts.get(outTradeNo)
    if (!attempt) throw new Error('Mock order must be pre-created')
    return {
      ToUserName: 'gh_mock', FromUserName: 'mock_official', CreateTime: Math.floor(this.clock().getTime() / 1000),
      MsgType: 'event', Event: 'xpay_goods_deliver_notify', OpenId: attempt.payerOpenid, OutTradeNo: outTradeNo, Env: this.env,
      WeChatPayInfo: { MchOrderNo: `mock_mch_${outTradeNo}`, TransactionId: attempt.transactionId, PaidTime: Math.floor(this.clock().getTime() / 1000) },
      GoodsInfo: { ProductId: attempt.productId, Quantity: 1, OrigPrice: attempt.totalFen, ActualPrice: attempt.totalFen, Attach: attempt.orderId },
      ...overrides
    }
  }

  async requestRefund(order: Order, refund: Refund): Promise<{ providerRefundId: string; status: RefundResult['refundStatus'] }> {
    const providerRefundId = `mock_refund_${refund.outRefundNo}`
    this.refundStates.set(refund.outRefundNo, {
      eventId: `mock_refund_query:${refund.outRefundNo}`, outTradeNo: order.outTradeNo, outRefundNo: refund.outRefundNo,
      providerRefundId, refundStatus: 'PROCESSING', refundFen: refund.amountFen, env: this.env
    })
    return { providerRefundId, status: 'PROCESSING' }
  }

  async queryRefund(_order: Order, refund: Refund): Promise<RefundResult> {
    const result = this.refundStates.get(refund.outRefundNo)
    if (!result) throw new AppError(404, 'MOCK_REFUND_NOT_FOUND', 'Mock refund was not found')
    return { ...structuredClone(result), eventId: `mock_refund_query:${refund.outRefundNo}:${result.refundStatus}` }
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

  /** The decrypted xpay_refund_notify WeChat would push for a requested refund. */
  refundEvent(outRefundNo: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const refund = this.refundStates.get(outRefundNo)
    if (!refund) throw new Error('Mock refund must be requested first')
    return {
      ToUserName: 'gh_mock', FromUserName: 'mock_official', CreateTime: Math.floor(this.clock().getTime() / 1000),
      MsgType: 'event', Event: 'xpay_refund_notify', WxRefundId: refund.providerRefundId, MchRefundId: outRefundNo,
      WxOrderId: `mock_wx_${refund.outTradeNo}`, MchOrderId: refund.outTradeNo, RefundFee: refund.refundFen, RetCode: 0, RetMsg: '',
      RefundStartTimestamp: Math.floor(this.clock().getTime() / 1000), RefundSuccTimestamp: Math.floor(this.clock().getTime() / 1000),
      ...overrides
    }
  }
}
