// Mini Program virtual payment (小程序虚拟支付). WeChat routes wx.requestVirtualPayment to
// Apple payment on iOS and to WeChat Pay elsewhere. The sheet's callback only says what the
// buyer saw; whether a payment happened is always read from the server order.
const MODE = 'short_series_goods'

// errCode values from wx.requestVirtualPayment that a family can act on.
const MESSAGES = {
  '-4': '本次支付被微信风控拦截，请稍后再试',
  '-15002': '订单号已使用，请重新点击支付',
  '-15007': '微信登录状态已过期，请重新点击支付',
  '-15012': '支付下单未完成，请重新点击支付',
  '-15017': '商户收款暂时受限，请稍后再试',
  '-15019': '商户收款暂时受限，请稍后再试',
  '-15020': '操作过快，请稍候再试',
  '-15021': '支付请求过于频繁，请稍候再试'
}

function supported() {
  return typeof wx !== 'undefined' && typeof wx.requestVirtualPayment === 'function'
}

/** A fresh login code: the server signs the attempt with the session_key it yields. */
function loginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (result) => (result && result.code ? resolve(result.code) : reject(new Error('微信登录失败，请重试'))),
      fail: () => reject(new Error('微信登录失败，请重试'))
    })
  })
}

function validParams(params) {
  const value = params || {}
  return ['signData', 'paySig', 'signature'].every((key) => typeof value[key] === 'string' && value[key].length > 0) &&
    value.mode === MODE
}

function request(params) {
  return new Promise((resolve) => {
    wx.requestVirtualPayment({
      signData: params.signData,
      paySig: params.paySig,
      signature: params.signature,
      mode: params.mode,
      success: () => resolve({ clientOutcome: 'accepted' }),
      fail: (error) => {
        const errCode = error && error.errCode
        resolve({
          clientOutcome: errCode === -2 ? 'cancelled' : 'failed',
          errCode,
          clientMessage: MESSAGES[String(errCode)] || (error && error.errMsg) || ''
        })
      }
    })
  })
}

module.exports = { MODE, loginCode, request, supported, validParams }
