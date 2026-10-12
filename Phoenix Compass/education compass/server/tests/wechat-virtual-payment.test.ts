import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '../src/domain/errors'
import {
  decryptMessage,
  encryptMessage,
  messageSignature,
  WechatMessageCodec
} from '../src/payments/wechat-message'
import {
  WechatVirtualPayment,
  xpayPaySig,
  xpayUserSignature
} from '../src/payments/wechat-virtual-payment'

// Every expected value in the first two tests is copied from the official documentation:
// 消息推送 https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push.html
// 虚拟支付签名详解 https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html
const DOC_TOKEN = 'AAAAA'
const DOC_AES_KEY = 'A'.repeat(43)
const DOC_APP_ID = 'wxba5fad812f8e6fb9'
const DOC_ENCRYPT = '+qdx1OKCy+5JPCBFWw70tm0fJGb2Jmeia4FCB7kao+/Q5c/ohsOzQHi8khUOb05JCpj0JB4RvQMkUyus8TPxLKJGQqcvZqzDpVzazhZv6JsXUnnR8XGT740XgXZUXQ7vJVnAG+tE8NUd4yFyjPy7GgiaviNrlCTj+l5kdfMuFUPpRSrfMZuMcp3Fn2Pede2IuQrKEYwKSqFIZoNqJ4M8EajAsjLY2km32IIjdf8YL/P50F7mStwntrA2cPDrM1kb6mOcfBgRtWygb3VIYnSeOBrebufAlr7F9mFUPAJGj04='
const DOC_PLAIN = '{"ToUserName":"gh_97417a04a28d","FromUserName":"o9AgO5Kd5ggOC-bXrbNODIiE3bGY","CreateTime":1714112445,"MsgType":"event","Event":"debug_demo","debug_str":"hello world"}'

test('message push signatures, decryption and reply encryption match the official examples', () => {
  // URL verification (GET) and plaintext-mode pushes sign token, timestamp and nonce.
  assert.equal(messageSignature(DOC_TOKEN, '1714036504', '1514711492'), 'f464b24fc39322e44b38aa78f5edd27bd1441696')
  assert.equal(messageSignature(DOC_TOKEN, '1714037059', '486452656'), '899cf89e464efb63f54ddac96b0a0a235f53aa78')
  // Safe mode signs the ciphertext as well, and the body decrypts to the message plus the AppID.
  assert.equal(messageSignature(DOC_TOKEN, '1714112445', '415670741', DOC_ENCRYPT), '046e02f8204d34f8ba5fa3b1db94908f3df2e9b3')
  assert.equal(decryptMessage(DOC_AES_KEY, DOC_ENCRYPT, DOC_APP_ID), DOC_PLAIN)
  assert.throws(() => decryptMessage(DOC_AES_KEY, DOC_ENCRYPT, 'wx0000000000000000'), (error: unknown) =>
    error instanceof AppError && error.code === 'WECHAT_MESSAGE_APPID_MISMATCH')
  // A reply other than "success" must be encrypted and signed.
  const sealed = encryptMessage(DOC_AES_KEY, '{"demo_resp":"good luck"}', DOC_APP_ID, Buffer.from('707722b803182950', 'utf8'))
  assert.equal(sealed, 'ELGduP2YcVatjqIS+eZbp80MNLoAUWvzzyJxgGzxZO/5sAvd070Bs6qrLARC9nVHm48Y4hyRbtzve1L32tmxSQ==')
  assert.equal(messageSignature(DOC_TOKEN, '1713424427', '415670741', sealed), '1b9339964ed2e271e7c7b6ff2b0ef902fc94dea1')
})

test('virtual payment pay_sig and user signature match the official examples', () => {
  const body = '{"openid": "xxx", "user_ip": "127.0.0.1", "env": 0}'
  assert.equal(xpayPaySig('12345', '/xpay/query_user_balance', body), 'c37809f27c6d7fd1837ad2500a04512b66b34fd793a39a385fade56dca89a4b5')
  assert.equal(xpayUserSignature('9hAb/NEYUlkaMBEsmFgzig==', body), '089d9e8dc5d308977360c4b79ec600a93d736802802a807d634192328032f6c7')
})

test('the push endpoint codec verifies the server URL, opens only signed safe-mode pushes and seals replies', () => {
  const codec = new WechatMessageCodec(
    { token: DOC_TOKEN, encodingAesKey: DOC_AES_KEY, appId: DOC_APP_ID },
    () => new Date(1713424427_000),
    () => Buffer.from('707722b803182950', 'utf8')
  )
  const verify = new URLSearchParams({ signature: 'f464b24fc39322e44b38aa78f5edd27bd1441696', echostr: '4375120948345356249', timestamp: '1714036504', nonce: '1514711492' })
  assert.equal(codec.verifyServerUrl(verify), '4375120948345356249')
  verify.set('signature', '0'.repeat(40))
  assert.throws(() => codec.verifyServerUrl(verify), (error: unknown) => error instanceof AppError && error.status === 401)

  const query = new URLSearchParams({
    signature: '6c5c811b55cc85e0e1b54100749188c20beb3f5d', timestamp: '1714112445', nonce: '415670741',
    openid: 'o9AgO5Kd5ggOC-bXrbNODIiE3bGY', encrypt_type: 'aes', msg_signature: '046e02f8204d34f8ba5fa3b1db94908f3df2e9b3'
  })
  const body = Buffer.from(JSON.stringify({ ToUserName: 'gh_97417a04a28d', Encrypt: DOC_ENCRYPT }))
  assert.deepEqual(codec.openPush(query, body), JSON.parse(DOC_PLAIN))

  // Tampered ciphertext, a missing msg_signature and plaintext mode are all refused.
  const tampered = Buffer.from(JSON.stringify({ ToUserName: 'gh_97417a04a28d', Encrypt: `${DOC_ENCRYPT.slice(0, -5)}AAAA=` }))
  assert.throws(() => codec.openPush(query, tampered), (error: unknown) => error instanceof AppError && error.status === 401)
  const plaintextMode = new URLSearchParams(query)
  plaintextMode.delete('encrypt_type')
  assert.throws(() => codec.openPush(plaintextMode, body), (error: unknown) => error instanceof AppError && error.code === 'WECHAT_MESSAGE_PLAINTEXT_REFUSED')
  const unsigned = new URLSearchParams(query)
  unsigned.delete('msg_signature')
  assert.throws(() => codec.openPush(unsigned, body), (error: unknown) => error instanceof AppError && error.status === 401)

  assert.deepEqual(codec.sealReply('{"demo_resp":"good luck"}', '415670741'), {
    Encrypt: 'ELGduP2YcVatjqIS+eZbp80MNLoAUWvzzyJxgGzxZO/5sAvd070Bs6qrLARC9nVHm48Y4hyRbtzve1L32tmxSQ==',
    MsgSignature: '1b9339964ed2e271e7c7b6ff2b0ef902fc94dea1',
    TimeStamp: 1713424427,
    Nonce: '415670741'
  })
})

interface Call { url: URL; body: string }

function fakeWechat(responses: Record<string, unknown[]>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const body = String(init?.body ?? '')
    calls.push({ url, body })
    const queue = responses[url.pathname]
    assert.ok(queue && queue.length, `unexpected call ${url.pathname}`)
    return new Response(JSON.stringify(queue.shift()), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { fetch: fetchImpl, calls }
}

const config = {
  appId: 'wx1234567890abcdef', appSecret: 'synthetic-app-secret', offerId: '1450664905', appKey: 'synthetic-sandbox-app-key',
  env: 1 as const, products: { EDUCATION_GROWTH_DISCOVERY_SINGLE_V1: { productId: 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1', priceFen: 3990 } }
}

test('the payment request carries the configured offer, item and price and is signed with the app key and session key', () => {
  const xpay = new WechatVirtualPayment(config, fakeWechat({}).fetch)
  const order = { id: 'ord_1', outTradeNo: `PX${'a'.repeat(30)}`, productCode: 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1', amountFen: 3990 }
  const request = xpay.buildPaymentRequest(order, 'c2Vzc2lvbi1rZXktMTIzNA==')
  assert.equal(request.mode, 'short_series_goods')
  assert.deepEqual(JSON.parse(request.signData), {
    offerId: '1450664905', buyQuantity: 1, env: 1, currencyType: 'CNY',
    productId: 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1', goodsPrice: 3990, outTradeNo: order.outTradeNo, attach: 'ord_1'
  })
  assert.equal(request.paySig, xpayPaySig('synthetic-sandbox-app-key', 'requestVirtualPayment', request.signData))
  assert.equal(request.signature, xpayUserSignature('c2Vzc2lvbi1rZXktMTIzNA==', request.signData))

  // Products without a configured item, a price that differs from the item, and order numbers the
  // platform would reject never produce a signed request.
  assert.throws(() => xpay.buildPaymentRequest({ ...order, productCode: 'COMPASS_REPORT_SINGLE_39_9' }, 'k'), (error: unknown) =>
    error instanceof AppError && error.code === 'VIRTUAL_PAYMENT_PRODUCT_NOT_CONFIGURED')
  assert.throws(() => xpay.buildPaymentRequest({ ...order, amountFen: 100 }, 'k'), (error: unknown) =>
    error instanceof AppError && error.code === 'VIRTUAL_PAYMENT_PRICE_MISMATCH')
  for (const outTradeNo of ['short', `_${'a'.repeat(20)}`, `PX${'a'.repeat(31)}`, 'PX#aaaaaaaa']) {
    assert.throws(() => xpay.buildPaymentRequest({ ...order, outTradeNo }, 'k'), (error: unknown) =>
      error instanceof AppError && error.code === 'VIRTUAL_PAYMENT_ORDER_NO_INVALID', outTradeNo)
  }
})

test('server calls use a cached stable access token and sign the exact request body', async () => {
  const wechat = fakeWechat({
    '/cgi-bin/stable_token': [{ access_token: 'token-1', expires_in: 7200 }],
    '/xpay/query_order': [
      { errcode: 0, errmsg: '', order: { order_id: 'PXorder', wx_order_id: 'wx-1', status: 4, order_type: 0, order_fee: 3990, paid_fee: 3990, left_fee: 3990, paid_time: 1760000000, env_type: 2, wxpay_order_id: '4200001' } },
      { errcode: 268490001, errmsg: 'openid error' }
    ],
    '/xpay/refund_order': [{ errcode: 0, errmsg: '', refund_order_id: 'PRrefund01', refund_wx_order_id: 'wx-r-1', pay_order_id: 'PXorder', pay_wx_order_id: 'wx-1' }],
    '/xpay/notify_provide_goods': [{ errcode: 0, errmsg: 'ok' }]
  })
  const xpay = new WechatVirtualPayment(config, wechat.fetch, () => new Date('2026-10-12T03:00:00.000Z'))

  const order = await xpay.queryOrder('openid-1', 'PXorder')
  assert.deepEqual(order, {
    orderId: 'PXorder', wxOrderId: 'wx-1', status: 4, orderType: 0, orderFee: 3990, paidFee: 3990,
    refundFee: 0, leftFee: 3990, paidTime: 1760000000, envType: 2, wxpayOrderId: '4200001'
  })
  await assert.rejects(() => xpay.queryOrder('openid-1', 'PXorder'), (error: unknown) =>
    error instanceof AppError && error.code === 'VIRTUAL_PAYMENT_API_ERROR' && (error.details as { providerCode?: number }).providerCode === 268490001)
  const refund = await xpay.refundOrder({ openid: 'openid-1', orderId: 'PXorder', refundOrderId: 'PRrefund01', leftFee: 3990, refundFee: 3990, reason: '5', bizMeta: 'rfd_1' })
  assert.deepEqual(refund, { refundOrderId: 'PRrefund01', refundWxOrderId: 'wx-r-1' })
  await xpay.notifyProvideGoods('PXorder')

  const tokenCalls = wechat.calls.filter((call) => call.url.pathname === '/cgi-bin/stable_token')
  assert.equal(tokenCalls.length, 1, 'the access token is cached between calls')
  assert.deepEqual(JSON.parse(tokenCalls[0]!.body), { grant_type: 'client_credential', appid: config.appId, secret: config.appSecret, force_refresh: false })
  for (const call of wechat.calls.filter((item) => item.url.pathname.startsWith('/xpay/'))) {
    assert.equal(call.url.searchParams.get('access_token'), 'token-1')
    assert.equal(call.url.searchParams.get('pay_sig'), xpayPaySig(config.appKey, call.url.pathname, call.body), `${call.url.pathname} pay_sig`)
    assert.equal(JSON.parse(call.body).env, 1, `${call.url.pathname} uses the configured environment`)
  }
  const refundCall = wechat.calls.find((call) => call.url.pathname === '/xpay/refund_order')!
  assert.deepEqual(JSON.parse(refundCall.body), {
    openid: 'openid-1', order_id: 'PXorder', refund_order_id: 'PRrefund01', left_fee: 3990, refund_fee: 3990,
    biz_meta: 'rfd_1', refund_reason: '5', req_from: '1', env: 1
  })
  assert.deepEqual(JSON.parse(wechat.calls.find((call) => call.url.pathname === '/xpay/notify_provide_goods')!.body), { order_id: 'PXorder', env: 1 })
})
