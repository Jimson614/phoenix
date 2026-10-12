import { WechatMessageCodec } from '../payments/wechat-message'
import { parseXpayPush } from '../payments/xpay-events'
import { OrderService } from './order-service'

export type PushReply =
  | { contentType: 'text/plain'; body: 'success' }
  | { contentType: 'application/json'; body: string }

const SUCCESS: PushReply = { contentType: 'text/plain', body: 'success' }

/**
 * The Mini Program has one message push URL, so sandbox and production virtual payment events
 * both arrive here. Events for the other environment, and events that are not about payments,
 * are acknowledged without effect. A thrown error makes WeChat retry the push.
 */
export class PaymentPushService {
  constructor(private readonly codec: WechatMessageCodec, private readonly orders: OrderService) {}

  verifyServerUrl(query: URLSearchParams): string {
    return this.codec.verifyServerUrl(query)
  }

  async handle(query: URLSearchParams, rawBody: Buffer): Promise<PushReply> {
    const event = this.codec.openPush(query, rawBody)
    const push = parseXpayPush(event)
    switch (push.kind) {
      case 'DELIVER':
        if (push.transaction.env !== this.orders.providerEnv) {
          await this.orders.recordPaymentNotice('PAYMENT_PUSH_OTHER_ENV_IGNORED', push.transaction.outTradeNo, { env: push.transaction.env })
          return SUCCESS
        }
        await this.orders.handleDelivery(push.transaction)
        return SUCCESS
      case 'REFUND':
        await this.orders.handleRefundPush(push.refund)
        return SUCCESS
      case 'IOS_REFUND_QUERY': {
        const decision = await this.orders.iosRefundQueryDecision(push.payOrderId)
        return { contentType: 'application/json', body: JSON.stringify(this.codec.sealReply(JSON.stringify(decision), query.get('nonce') ?? '')) }
      }
      case 'COMPLAINT':
        await this.orders.recordPaymentNotice('PAYMENT_COMPLAINT_RECEIVED', push.outTradeNo, { complaintId: push.complaintId })
        return SUCCESS
      case 'RISK':
        await this.orders.recordPaymentNotice('PAYMENT_RISK_EVENT_RECEIVED', push.businessCode, { eventType: push.eventType, businessState: push.businessState })
        return SUCCESS
      default:
        return SUCCESS
    }
  }
}
