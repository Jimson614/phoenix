import { Order, Refund } from '../domain/model'

export type HeaderBag = Record<string, string | undefined>

export interface MiniProgramPaymentParams {
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'RSA'
  paySign: string
}

export interface PrepayResult {
  providerPrepayId: string
  paymentParams: MiniProgramPaymentParams
}

export interface TransactionResult {
  eventId: string
  appId: string
  mchId: string
  outTradeNo: string
  transactionId: string
  tradeType: string
  tradeState: 'SUCCESS' | 'REFUND' | 'NOTPAY' | 'CLOSED' | 'REVOKED' | 'USERPAYING' | 'PAYERROR'
  // WeChat may omit amount and payer while a queried transaction is not yet
  // successful. SUCCESS results are still required to contain all three fields.
  totalFen?: number
  currency?: string
  payerOpenid?: string
  successTime?: string
}

export interface RefundResult {
  eventId: string
  mchId: string
  outTradeNo: string
  outRefundNo: string
  providerRefundId: string
  refundStatus: 'SUCCESS' | 'CLOSED' | 'PROCESSING' | 'ABNORMAL'
  refundFen: number
  totalFen: number
  currency: string
  successTime?: string
}

export interface PaymentProvider {
  readonly name: 'mock' | 'wechat'
  readonly appId: string
  readonly mchId: string
  createPrepay(order: Order, payerOpenid: string): Promise<PrepayResult>
  queryOrder(outTradeNo: string): Promise<TransactionResult>
  closeOrder(outTradeNo: string): Promise<void>
  requestRefund(order: Order, refund: Refund): Promise<{ providerRefundId: string; status: RefundResult['refundStatus'] }>
  queryRefund(outRefundNo: string): Promise<RefundResult>
  parseTransactionNotification(headers: HeaderBag, rawBody: Buffer): Promise<TransactionResult>
  parseRefundNotification(headers: HeaderBag, rawBody: Buffer): Promise<RefundResult>
}
