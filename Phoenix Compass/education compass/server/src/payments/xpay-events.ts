import { AppError, invariant } from '../domain/errors'
import { RefundResult, TransactionResult } from './payment-provider'

// Virtual payment events delivered through 消息推送 (2.4 消息推送 in the virtual payment guide).
export type XpayPushEvent =
  | { kind: 'DELIVER'; transaction: TransactionResult }
  | { kind: 'REFUND'; refund: RefundResult }
  | { kind: 'IOS_REFUND_QUERY'; payOrderId: string; productId: string; provideStatus: string }
  | { kind: 'COMPLAINT'; outTradeNo: string; complaintId: string }
  | { kind: 'RISK'; eventType: string; businessState: string; businessCode: string }
  | { kind: 'OTHER'; event: string }

function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isoFromSeconds(value: unknown): string | undefined {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined
}

function env(value: unknown): 0 | 1 {
  const parsed = Number(value)
  invariant(parsed === 0 || parsed === 1, 400, 'XPAY_PUSH_ENV_INVALID', '虚拟支付推送环境无效')
  return parsed
}

export function parseXpayPush(event: Record<string, unknown>): XpayPushEvent {
  const name = text(event.Event)
  if (name === 'xpay_goods_deliver_notify') {
    const goods = record(event.GoodsInfo)
    const wechatPay = record(event.WeChatPayInfo)
    const outTradeNo = text(event.OutTradeNo)
    invariant(outTradeNo, 400, 'XPAY_PUSH_INVALID', '道具发货推送缺少订单号')
    invariant(Number(goods.Quantity) === 1, 400, 'XPAY_PUSH_INVALID', '道具发货推送数量无效')
    const successTime = isoFromSeconds(wechatPay.PaidTime) ?? isoFromSeconds(event.CreateTime)
    return {
      kind: 'DELIVER',
      transaction: {
        eventId: `xpay_deliver:${outTradeNo}`,
        outTradeNo,
        ...(text(goods.Attach) ? { orderId: text(goods.Attach) } : {}),
        // iOS purchases are paid through Apple and carry no WeChat Pay information.
        transactionId: text(wechatPay.TransactionId) || `apple:${outTradeNo}`,
        tradeState: 'SUCCESS',
        env: env(event.Env),
        totalFen: Number(goods.ActualPrice),
        productId: text(goods.ProductId),
        payerOpenid: text(event.OpenId),
        ...(successTime ? { successTime } : {})
      }
    }
  }
  if (name === 'xpay_refund_notify') {
    const outTradeNo = text(event.MchOrderId)
    invariant(outTradeNo, 400, 'XPAY_PUSH_INVALID', '退款推送缺少订单号')
    const success = Number(event.RetCode) === 0
    const successTime = success ? isoFromSeconds(event.RefundSuccTimestamp) : undefined
    return {
      kind: 'REFUND',
      refund: {
        eventId: `xpay_refund:${text(event.WxRefundId) || text(event.MchRefundId) || outTradeNo}:${success ? 'SUCCESS' : 'ABNORMAL'}`,
        outTradeNo,
        outRefundNo: text(event.MchRefundId),
        providerRefundId: text(event.WxRefundId),
        refundStatus: success ? 'SUCCESS' : 'ABNORMAL',
        refundFen: Number(event.RefundFee),
        ...(successTime ? { successTime } : {})
      }
    }
  }
  if (name === 'xpay_subscribe_ios_refund_query_notify') {
    return { kind: 'IOS_REFUND_QUERY', payOrderId: text(event.pay_order_id), productId: text(event.product_id), provideStatus: text(event.provide_status) }
  }
  if (name === 'xpay_complaint_notify') {
    return { kind: 'COMPLAINT', outTradeNo: text(event.MchOrderId), complaintId: text(event.ComplaintId) }
  }
  if (name === 'xpay_wxpay_callback_notify') {
    return { kind: 'RISK', eventType: text(event.EventType), businessState: text(event.BusinessState), businessCode: text(event.BusinessCode) }
  }
  if (!name) throw new AppError(400, 'XPAY_PUSH_INVALID', '消息推送缺少事件类型')
  return { kind: 'OTHER', event: name.slice(0, 64) }
}
