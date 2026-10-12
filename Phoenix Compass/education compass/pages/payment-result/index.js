const session = require('../../services/session')
const payment = require('../../services/payment')

const COPY = {
  CREATED: { tone: 'pending', mark: '…', title: '订单待支付', message: '本次尚未完成支付，可返回预览重新发起。' },
  PENDING: { tone: 'pending', mark: '…', title: '正在确认支付结果', message: '请勿重复支付。最终状态以微信平台通知和服务端查单为准。' },
  PAYING: { tone: 'pending', mark: '…', title: '正在确认支付结果', message: '请勿重复支付。最终状态以微信平台通知和服务端查单为准。' },
  PAID: { tone: 'success', mark: '✓', title: '支付已确认', message: '完整六模块报告已解锁；如果仍在生成，请稍后刷新。' },
  FAILED: { tone: 'error', mark: '!', title: '支付未完成', message: '未产生有效支付，可返回预览重新尝试。' },
  CANCELLED: { tone: 'muted', mark: '×', title: '已取消支付', message: '免费预览会继续保留，之后仍可解锁。' },
  EXPIRED: { tone: 'muted', mark: '×', title: '订单已过期', message: '免费预览会继续保留，请重新创建订单。' },
  REFUNDING: { tone: 'pending', mark: '…', title: '退款处理中', message: '请等待退款处理完成。' },
  REFUNDED: { tone: 'muted', mark: '↩', title: '订单已退款', message: '该订单已完成退款，报告访问状态以服务端权益为准。' }
}

// The order stays pending on the server after the buyer closes the payment sheet, so the sheet's
// own answer decides what a still-pending order means here.
const SHEET_COPY = {
  cancelled: { tone: 'muted', mark: '×', title: '已取消本次支付', message: '免费预览会继续保留，可以返回重新支付。如果实际已经扣款，确认后报告会自动解锁。' },
  failed: { tone: 'error', mark: '!', title: '支付未完成', message: '可以返回预览重新支付。如果实际已经扣款，确认后报告会自动解锁。' }
}

function viewFor(order, clientOutcome) {
  if (order.status === 'PENDING' && SHEET_COPY[clientOutcome]) return SHEET_COPY[clientOutcome]
  return COPY[order.status] || COPY.PAYING
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
      // A closed sheet will not turn into a payment by waiting, so it is checked once instead of polled.
      const sheetClosed = Boolean(SHEET_COPY[this.data.clientOutcome])
      const order = withPolling && !sheetClosed ? await payment.pollOrder(this.data.orderId) : await payment.getOrder(this.data.orderId)
      const view = viewFor(order, this.data.clientOutcome)
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
