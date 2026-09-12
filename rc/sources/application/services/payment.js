const api = require('./api')
const runtime = require('../config/runtime')
const { repository } = require('./demo-runtime')
const { PRODUCT } = require('../config/compass')
const { isoNow } = require('../utils/date')

const ORDER_CACHE_KEY = 'PFS_COMPASS_ORDER_CACHE_V1'
const FINAL_STATUSES = ['PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED']
const CACHE_FIELDS = [
  'orderId', 'outTradeNo', 'status', 'productCode', 'amountFen', 'currency',
  'reportId', 'assessmentId', 'paidAt', 'refundedAt', 'idempotencyKey', 'cachedAt'
]

function safeCacheValue(order) {
  return CACHE_FIELDS.reduce((result, key) => {
    if (order && order[key] !== undefined) result[key] = order[key]
    return result
  }, {})
}

function orderCache() {
  const stored = wx.getStorageSync(ORDER_CACHE_KEY) || {}
  const safe = Object.keys(stored).reduce((result, key) => {
    result[key] = safeCacheValue(stored[key])
    return result
  }, {})
  if (JSON.stringify(safe) !== JSON.stringify(stored)) wx.setStorageSync(ORDER_CACHE_KEY, safe)
  return safe
}

function unwrap(result, keys) {
  if (!result) return result
  let value = result.data || result
  for (const key of keys) {
    if (value && value[key]) { value = value[key]; break }
  }
  return value
}

function normalizeOrder(result) {
  const order = unwrap(result, ['order']) || {}
  return {
    ...order,
    orderId: order.orderId || order.id,
    outTradeNo: order.outTradeNo || order.out_trade_no,
    productCode: order.productCode || order.product_code,
    amountFen: order.amountFen === undefined ? order.amount_fen : order.amountFen,
    reportId: order.reportId || order.report_id,
    paidAt: order.paidAt || order.paid_at,
    refundedAt: order.refundedAt || order.refunded_at
  }
}

function normalizePrepay(result) {
  const prepay = unwrap(result, ['payment', 'prepay']) || {}
  const rawParams = prepay.paymentParams || prepay.payment_params
  const paymentParams = rawParams ? {
    ...rawParams,
    timeStamp: rawParams.timeStamp || rawParams.time_stamp,
    nonceStr: rawParams.nonceStr || rawParams.nonce_str,
    package: rawParams.package,
    signType: rawParams.signType || rawParams.sign_type,
    paySign: rawParams.paySign || rawParams.pay_sign
  } : null
  return {
    ...prepay,
    orderId: prepay.orderId || prepay.order_id,
    paymentParams
  }
}
function cacheOrder(order) {
  if (!order || !order.orderId) return order
  const cache = orderCache()
  cache[order.orderId] = safeCacheValue({ ...(cache[order.orderId] || {}), ...order, cachedAt: isoNow() })
  wx.setStorageSync(ORDER_CACHE_KEY, cache)
  return cache[order.orderId]
}
function listCachedOrders() { return Object.values(orderCache()).sort((a, b) => (b.cachedAt || '').localeCompare(a.cachedAt || '')) }

async function refreshCachedOrders() {
  const cached = listCachedOrders()
  const refreshed = []
  for (const order of cached) {
    try { refreshed.push(await getOrder(order.orderId)) }
    catch (error) { refreshed.push(order) }
  }
  return refreshed.sort((a, b) => (b.cachedAt || '').localeCompare(a.cachedAt || ''))
}

function toDto(order) {
  return {
    orderId: order.id,
    outTradeNo: order.out_trade_no,
    status: order.status,
    productCode: order.product_code,
    amountFen: order.amount_fen,
    currency: order.currency,
    reportId: order.report_id,
    paidAt: order.paid_at || undefined,
    refundedAt: order.refunded_at || undefined
  }
}

function activeLocalOrder(assessmentId) {
  return repository.where('orders', (order) => order.assessment_id === assessmentId && !['FAILED', 'CANCELLED', 'EXPIRED'].includes(order.status))
    .sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''))[0] || null
}

async function createOrder(assessmentId) {
  let order
  if (runtime.isDemo()) {
    const assessment = repository.getById('assessments', assessmentId)
    if (!assessment || assessment.status !== 'PREVIEW_READY') throw new api.ApiError('报告预览尚未就绪', { code: 'PREVIEW_NOT_READY', statusCode: 409 })
    const existing = activeLocalOrder(assessmentId)
    if (existing) order = toDto(existing)
    else {
      const student = repository.getById('students', assessment.student_id)
      const family = repository.getById('families', student.family_id)
      const user = repository.getById('users', family.user_id)
      const created = repository.insert('orders', {
        user_id: user.id,
        family_id: family.id,
        assessment_id: assessment.id,
        report_id: assessment.report_id,
        product_code: PRODUCT.code,
        out_trade_no: `DEMO_${Date.now()}_${assessment.id}`,
        amount_fen: PRODUCT.amountFen,
        currency: 'CNY',
        status: 'CREATED',
        created_at: isoNow(),
        updated_at: isoNow()
      })
      order = toDto(created)
    }
  } else {
    const cache = listCachedOrders().find((item) => item.assessmentId === assessmentId && !['FAILED', 'CANCELLED', 'EXPIRED'].includes(item.status))
    const idempotencyKey = cache && cache.idempotencyKey ? cache.idempotencyKey : `cmp_${assessmentId}_${Date.now()}`
    order = normalizeOrder(await api.request(`/v1/assessments/${encodeURIComponent(assessmentId)}/orders`, {
      method: 'POST', data: { productCode: PRODUCT.code, idempotencyKey }
    }))
    order.assessmentId = assessmentId
    order.idempotencyKey = idempotencyKey
  }
  return cacheOrder({ ...order, assessmentId })
}

function invokeRequestPayment(params) {
  return new Promise((resolve) => {
    wx.requestPayment({
      timeStamp: params.timeStamp,
      nonceStr: params.nonceStr,
      package: params.package,
      signType: params.signType,
      paySign: params.paySign,
      success: () => resolve({ clientOutcome: 'accepted' }),
      fail: (error) => resolve({
        clientOutcome: String(error.errMsg || '').toLowerCase().includes('cancel') ? 'cancelled' : 'failed',
        clientMessage: error.errMsg || ''
      })
    })
  })
}

async function requestWeChatPayment(orderId) {
  if (runtime.isDemo()) {
    const order = repository.getById('orders', orderId)
    if (!order) throw new api.ApiError('订单不存在', { code: 'ORDER_NOT_FOUND', statusCode: 404 })
    if (order.status !== 'PAID') {
      repository.update('orders', order.id, { status: 'PENDING', updated_at: isoNow() })
      repository.update('orders', order.id, { status: 'PAID', paid_at: isoNow(), updated_at: isoNow() })
      const report = repository.getById('reports', order.report_id)
      if (report) repository.update('reports', report.id, { access: 'full', updated_at: isoNow() })
      repository.addTimeline(order.family_id, 'order_paid', `已演示解锁 ${PRODUCT.name}`)
      repository.addTimeline(order.family_id, 'report_unlocked', 'Education Compass 完整报告已解锁')
    }
    cacheOrder(toDto(repository.getById('orders', order.id)))
    return { clientOutcome: 'demo_accepted' }
  }

  const prepay = normalizePrepay(await api.request(`/v1/orders/${encodeURIComponent(orderId)}/wechat-prepay`, { method: 'POST', data: {} }))
  if (!prepay.paymentParams) throw new api.ApiError('支付参数缺失，请稍后重试', { code: 'PAYMENT_PARAMS_MISSING' })
  cacheOrder(prepay)
  // The callback only reports what the WeChat client displayed. Payment state is
  // always read from GET /orders/:id after the signed server notification.
  return invokeRequestPayment(prepay.paymentParams)
}

async function getOrder(orderId) {
  let order
  if (runtime.isDemo()) {
    const stored = repository.getById('orders', orderId)
    if (!stored) throw new api.ApiError('订单不存在', { code: 'ORDER_NOT_FOUND', statusCode: 404 })
    order = toDto(stored)
  } else {
    order = normalizeOrder(await api.request(`/v1/orders/${encodeURIComponent(orderId)}`))
  }
  return cacheOrder(order)
}

function wait(delay) { return new Promise((resolve) => setTimeout(resolve, delay)) }

async function pollOrder(orderId, options = {}) {
  const attempts = options.attempts || 12
  const interval = options.interval || 1200
  let last = null
  for (let index = 0; index < attempts; index += 1) {
    last = await getOrder(orderId)
    if (FINAL_STATUSES.includes(last.status)) return last
    if (index < attempts - 1) await wait(interval)
  }
  return last
}

function statusLabel(status) {
  return ({
    CREATED: '待支付', PENDING: '支付确认中', PAYING: '支付确认中', PAID: '已支付', FAILED: '支付失败',
    CANCELLED: '已取消', EXPIRED: '已过期', REFUNDING: '退款处理中', REFUNDED: '已退款'
  })[status] || '状态确认中'
}

module.exports = {
  FINAL_STATUSES, ORDER_CACHE_KEY, cacheOrder, createOrder, getOrder,
  listCachedOrders, normalizeOrder, normalizePrepay, pollOrder, refreshCachedOrders, requestWeChatPayment, statusLabel
}
