import { invariant } from '../domain/errors'
import { Order, Refund } from '../domain/model'
import { PayerSession, PaymentProvider, RefundResult, TransactionResult } from './payment-provider'
import { isXpayOrderAbsent, VirtualPaymentRequest, WechatVirtualPayment, XpayOrder } from './wechat-virtual-payment'

// query_order status: 0 初始化 1 已创建 2 已支付待发货 3 发货中 4 已发货 5 退款(商户侧扣款完成)
// 6 已关闭 7 退款失败 8 退款(用户侧收款完成) 9 回收广告金 10 分账回退
export function tradeStateFor(status: number): TransactionResult['tradeState'] {
  if (status === 2 || status === 3 || status === 4) return 'SUCCESS'
  if (status === 5 || status === 7 || status === 8) return 'REFUND'
  if (status === 6) return 'CLOSED'
  return 'NOTPAY'
}

// order_type 7 苹果iOS支付: Apple does not let developers start a refund.
const APPLE_PAYMENT = 7

export class WechatVirtualPaymentProvider implements PaymentProvider {
  readonly name = 'wechat' as const

  constructor(private readonly xpay: WechatVirtualPayment) {}

  get env(): 0 | 1 { return this.xpay.env }

  productIdFor(productCode: string): string {
    return this.xpay.productFor(productCode).productId
  }

  createPayment(order: Order, payer: PayerSession): VirtualPaymentRequest {
    return this.xpay.buildPaymentRequest(order, payer.sessionKey)
  }

  async queryAttempt(outTradeNo: string, payerOpenid: string): Promise<TransactionResult> {
    let order: XpayOrder
    try {
      order = await this.xpay.queryOrder(payerOpenid, outTradeNo)
    } catch (error) {
      // The buyer closed the payment sheet before the platform created the order: nothing was paid.
      if (!isXpayOrderAbsent(error)) throw error
      return { eventId: `xpay_query:${outTradeNo}:absent`, outTradeNo, transactionId: '', tradeState: 'NOTPAY', env: this.env }
    }
    const tradeState = tradeStateFor(order.status)
    return {
      eventId: `xpay_query:${outTradeNo}:${order.status}`,
      outTradeNo,
      transactionId: order.wxpayOrderId || order.wxOrderId,
      tradeState,
      env: this.env,
      ...(tradeState === 'SUCCESS' ? { totalFen: order.paidFee || order.orderFee, payerOpenid } : {}),
      ...(order.paidTime > 0 ? { successTime: new Date(order.paidTime * 1000).toISOString() } : {})
    }
  }

  async confirmDelivery(outTradeNo: string): Promise<void> {
    await this.xpay.notifyProvideGoods(outTradeNo)
  }

  async requestRefund(order: Order, refund: Refund, payerOpenid: string): Promise<{ providerRefundId: string; status: RefundResult['refundStatus'] }> {
    const paid: XpayOrder = await this.xpay.queryOrder(payerOpenid, order.outTradeNo)
    invariant(paid.orderType !== APPLE_PAYMENT, 409, 'REFUND_APPLE_UNSUPPORTED', 'iOS 订单由苹果处理退款，只能由用户向苹果申请')
    invariant(tradeStateFor(paid.status) === 'SUCCESS' || tradeStateFor(paid.status) === 'REFUND',
      409, 'ORDER_NOT_REFUNDABLE', '虚拟支付订单当前不可退款')
    const result = await this.xpay.refundOrder({
      openid: payerOpenid,
      orderId: order.outTradeNo,
      refundOrderId: refund.outRefundNo,
      leftFee: paid.leftFee,
      refundFee: refund.amountFen,
      reason: '5',
      bizMeta: refund.id
    })
    return { providerRefundId: result.refundWxOrderId || result.refundOrderId, status: 'PROCESSING' }
  }

  async queryRefund(order: Order, refund: Refund, payerOpenid: string): Promise<RefundResult> {
    const result = await this.xpay.queryOrder(payerOpenid, refund.outRefundNo)
    const refundStatus: RefundResult['refundStatus'] = result.status === 5 || result.status === 8
      ? 'SUCCESS'
      : result.status === 7 ? 'ABNORMAL' : result.status === 6 ? 'CLOSED' : 'PROCESSING'
    return {
      eventId: `xpay_refund_query:${refund.outRefundNo}:${result.status}`,
      outTradeNo: order.outTradeNo,
      outRefundNo: refund.outRefundNo,
      providerRefundId: result.wxOrderId || refund.outRefundNo,
      refundStatus,
      refundFen: result.refundFee || refund.amountFen,
      env: this.env,
      ...(refundStatus === 'SUCCESS' && result.paidTime > 0 ? { successTime: new Date(result.paidTime * 1000).toISOString() } : {})
    }
  }
}
