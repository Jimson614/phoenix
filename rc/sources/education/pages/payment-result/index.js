const session = require('../../services/session')
const payment = require('../../services/payment')

const COPY = {
  CREATED: { tone: 'pending', mark: '…', title: '订单待支付', message: '本次尚未完成支付，可返回预览重新发起。' },
  PENDING: { tone: 'pending', mark: '…', title: '正在确认支付结果', message: '请勿重复支付。最终状态以微信支付服务端通知为准。' },
  PAYING: { tone: 'pending', mark: '…', title: '正在确认支付结果', message: '请勿重复支付。最终状态以微信支付服务端通知为准。' },
  PAID: { tone: 'success', mark: '✓', title: '支付已确认', message: '完整六模块报告已解锁；如果仍在生成，请稍后刷新。' },
  FAILED: { tone: 'error', mark: '!', title: '支付未完成', message: '未产生有效支付，可返回预览重新尝试。' },
  CANCELLED: { tone: 'muted', mark: '×', title: '已取消支付', message: '免费预览会继续保留，之后仍可解锁。' },
  EXPIRED: { tone: 'muted', mark: '×', title: '订单已过期', message: '免费预览会继续保留，请重新创建订单。' },
  REFUNDING: { tone: 'pending', mark: '…', title: '退款处理中', message: '请等待微信支付完成退款处理。' },
  REFUNDED: { tone: 'muted', mark: '↩', title: '订单已退款', message: '该订单已完成退款，报告访问状态以服务端权益为准。' }
}

Page({
  data: { orderId: '', reportId: '', clientOutcome: '', order: null, view: COPY.PAYING, checking: true, error: '' },
  onLoad(options) {
    if (!session.guard(['family_user'])) return
    this.setData({ orderId: options.orderId || '', reportId: options.reportId || '', clientOutcome: options.clientOutcome || '' })
    this.check(true)
  },
  async check(withPolling) {
    if (!this.data.orderId || this.polling) return
    this.polling = true
    this.setData({ checking: true, error: '' })
    try {
      const order = withPolling ? await payment.pollOrder(this.data.orderId) : await payment.getOrder(this.data.orderId)
      const view = COPY[order.status] || COPY.PAYING
      this.setData({ order: { ...order, amountLabel: `${(order.amountFen / 100).toFixed(2)} 元` }, reportId: order.reportId || this.data.reportId, view })
    } catch (error) {
      this.setData({ error: error.message || '订单状态查询失败' })
    } finally {
      this.polling = false
      this.setData({ checking: false })
    }
  },
  refresh() { this.check(false) },
  openReport() { if (this.data.reportId) wx.redirectTo({ url: `/pages/report/index?id=${this.data.reportId}` }) },
  retryPayment() {
    const assessmentId = this.data.order && this.data.order.assessmentId
    if (assessmentId) wx.redirectTo({ url: `/pages/compass-preview/index?assessmentId=${assessmentId}` })
    else wx.switchTab({ url: '/pages/home/index' })
  },
  home() { wx.switchTab({ url: '/pages/home/index' }) }
})
