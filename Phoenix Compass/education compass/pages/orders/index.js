const session = require('../../services/session')
const auth = require('../../services/auth')
const payment = require('../../services/payment')
const date = require('../../utils/date')

// 订单中心（小程序订单中心页）：主 path 直接进入，不拼接参数、不自动跳转。
// 无登录态时在本页给出登录引导，登录成功后停留本页继续展示订单。
const PRODUCT_LABEL = 'Education Compass 完整成长报告'
const CLOSED_STATUSES = ['REFUNDED', 'REFUNDING', 'FAILED', 'CANCELLED', 'EXPIRED']

function statusTone(status) {
  if (status === 'PAID') return 'paid'
  if (CLOSED_STATUSES.includes(status)) return 'closed'
  return 'pending'
}

function toView(order) {
  const student = order.studentName ? `${order.studentName}${order.studentDeleted ? '（档案已删除）' : ''}` : ''
  const when = date.dateTimeLabel(order.paidAt || order.createdAt)
  return {
    orderId: order.orderId,
    reportId: order.reportId || '',
    productLabel: PRODUCT_LABEL,
    statusLabel: payment.statusLabel(order.status),
    statusTone: statusTone(order.status),
    amountLabel: `¥${(order.amountFen / 100).toFixed(2)}`,
    metaLabel: [student, when].filter(Boolean).join(' · ') || '时间待确认'
  }
}

Page({
  data: {
    needLogin: false,
    loading: true,
    loginBusy: false,
    orders: [],
    orderCount: 0
  },

  onShow() {
    const user = session.currentUser()
    if (!user || user.role !== 'family_user') {
      this.setData({ needLogin: true, loading: false, orders: [], orderCount: 0 })
      return
    }
    this.setData({ needLogin: false })
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const orders = (await payment.listOrders()).map(toView)
      this.setData({ orders, orderCount: orders.length, loading: false })
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '订单读取失败，请稍后重试', icon: 'none' })
    }
  },

  async login() {
    if (this.data.loginBusy) return
    this.setData({ loginBusy: true })
    try {
      const user = await auth.loginFamilyUser()
      if (!user || user.role !== 'family_user') {
        auth.logout()
        throw new Error('本页仅面向家庭用户')
      }
      this.setData({ loginBusy: false, needLogin: false })
      await this.load()
    } catch (error) {
      this.setData({ loginBusy: false })
      wx.showToast({ title: error.message || '登录失败，请重试', icon: 'none' })
    }
  },

  openOrder({ currentTarget }) {
    const order = this.data.orders.find((item) => item.orderId === currentTarget.dataset.id)
    if (!order) return
    if (order.status === 'PAID') return wx.navigateTo({ url: `/pages/report/index?id=${order.reportId}` })
    if (!order.reportId) return wx.showToast({ title: `订单${order.statusLabel}，没有可查看的报告`, icon: 'none' })
    wx.navigateTo({ url: `/pages/payment-result/index?orderId=${order.orderId}&reportId=${order.reportId}` })
  },

  goCompass() {
    wx.navigateTo({ url: '/pages/compass/index' })
  }
})
