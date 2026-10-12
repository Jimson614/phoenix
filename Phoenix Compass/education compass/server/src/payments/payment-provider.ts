import { Order, Refund } from '../domain/model'
import { VirtualPaymentRequest } from './wechat-virtual-payment'

export interface PayerSession {
  openid: string
  sessionKey: string
}

/**
 * One payment attempt as the platform reports it. outTradeNo names the attempt: a virtual
 * payment order number can be used only once, so each attempt of an order gets its own.
 */
export interface TransactionResult {
  eventId: string
  outTradeNo: string
  /** Our order ID, echoed back as attach; absent when settled by query. */
  orderId?: string
  transactionId: string
  tradeState: 'SUCCESS' | 'NOTPAY' | 'CLOSED' | 'REFUND'
  env: 0 | 1
  totalFen?: number
  productId?: string
  payerOpenid?: string
  successTime?: string
}

export interface RefundResult {
  eventId: string
  outTradeNo: string
  /** Empty when Apple refunded an iOS order on its own. */
  outRefundNo: string
  providerRefundId: string
  refundStatus: 'SUCCESS' | 'CLOSED' | 'PROCESSING' | 'ABNORMAL'
  refundFen: number
  /** The refund push carries no environment; it is matched to an order of this database instead. */
  env?: 0 | 1
  successTime?: string
}

export interface PaymentProvider {
  readonly name: 'mock' | 'wechat'
  /** 0 现网 or 1 沙箱: pushes and queries from the other environment are never applied. */
  readonly env: 0 | 1
  /** The item each product is sold as; throws for a product without one. */
  productIdFor(productCode: string): string
  createPayment(order: Order, payer: PayerSession): VirtualPaymentRequest
  queryAttempt(outTradeNo: string, payerOpenid: string): Promise<TransactionResult>
  /** Marks delivery done when a payment was settled by query instead of the delivery push. */
  confirmDelivery(outTradeNo: string): Promise<void>
  requestRefund(order: Order, refund: Refund, payerOpenid: string): Promise<{ providerRefundId: string; status: RefundResult['refundStatus'] }>
  queryRefund(order: Order, refund: Refund, payerOpenid: string): Promise<RefundResult>
}
