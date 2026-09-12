import assert from 'node:assert/strict'
import {
  constants,
  createCipheriv,
  generateKeyPairSync,
  sign,
  verify
} from 'node:crypto'
import test from 'node:test'
import { AppError } from '../src/domain/errors'
import { Order, Refund } from '../src/domain/model'
import {
  canonicalApiRequest,
  canonicalWechatMessage,
  decryptWechatResource,
  WechatPayProvider
} from '../src/payments/wechat-pay-provider'

const fixed = new Date('2026-08-20T10:00:00.000Z')
const timestamp = Math.floor(fixed.getTime() / 1000).toString()
const apiV3Key = '0123456789abcdef0123456789abcdef'

const merchantKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})
const wechatKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})

function rsaSign(privateKey: string, message: Buffer): string {
  return sign('RSA-SHA256', message, { key: privateKey, padding: constants.RSA_PKCS1_PADDING }).toString('base64')
}

function signedResponse(body: Record<string, unknown>, status = 200): Response {
  const raw = Buffer.from(JSON.stringify(body), 'utf8')
  const nonce = 'response-nonce-001'
  return new Response(raw, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Wechatpay-Timestamp': timestamp,
      'Wechatpay-Nonce': nonce,
      'Wechatpay-Serial': 'PUB_KEY_ID_TEST',
      'Wechatpay-Signature': rsaSign(wechatKeys.privateKey, canonicalWechatMessage(timestamp, nonce, raw)),
      'Wechatpay-Signature-Type': 'WECHATPAY2-SHA256-RSA2048'
    }
  })
}

function signedEmptyResponse(status = 204): Response {
  const raw = Buffer.alloc(0)
  const nonce = 'response-nonce-empty'
  return new Response(null, {
    status,
    headers: {
      'Wechatpay-Timestamp': timestamp,
      'Wechatpay-Nonce': nonce,
      'Wechatpay-Serial': 'PUB_KEY_ID_TEST',
      'Wechatpay-Signature': rsaSign(wechatKeys.privateKey, canonicalWechatMessage(timestamp, nonce, raw)),
      'Wechatpay-Signature-Type': 'WECHATPAY2-SHA256-RSA2048'
    }
  })
}

function provider(fetchImpl: typeof fetch): WechatPayProvider {
  return new WechatPayProvider({
    appId: 'wx_phoenix_test',
    mchId: '1900000001',
    merchantCertificateSerialNo: 'MCH_CERT_SERIAL_TEST',
    merchantPrivateKeyPem: merchantKeys.privateKey,
    apiV3Key,
    wechatPayPublicKeyId: 'PUB_KEY_ID_TEST',
    wechatPayPublicKeyPem: wechatKeys.publicKey,
    transactionNotifyUrl: 'https://api.example.com/v1/webhooks/wechat-pay/transactions',
    refundNotifyUrl: 'https://api.example.com/v1/webhooks/wechat-pay/refunds'
  }, fetchImpl, () => new Date(fixed), () => '593BEC0C930BF1AFEB40B4A08C8FB242')
}

function orderFixture(): Order {
  return {
    id: 'ord_wechat_test', outTradeNo: 'PXWECHATORDER000000000000000001', userId: 'usr_test',
    familyId: 'fam_test', studentId: 'stu_test', assessmentId: 'asm_test', reportId: 'rpt_test',
    productCode: 'COMPASS_REPORT_SINGLE_39_9', amountFen: 3990, currency: 'CNY', status: 'CREATED',
    idempotencyKey: 'wechat-order-test-key', provider: 'wechat', providerPrepayId: null, paymentParams: null,
    providerTransactionId: null, lastProviderQueryAt: null,
    createdAt: fixed.toISOString(), updatedAt: fixed.toISOString(), expiresAt: new Date(fixed.getTime() + 7200000).toISOString(),
    paidAt: null, refundedAt: null
  }
}

function refundFixture(): Refund {
  return {
    id: 'rfd_wechat_test', outRefundNo: 'PRWECHATREFUND0000000000000001', orderId: 'ord_wechat_test',
    requestedBy: 'usr_admin', idempotencyKey: 'refund-idempotency-test', reason: '用户确认取消报告',
    amountFen: 3990, currency: 'CNY', status: 'PROCESSING', providerRefundId: null,
    createdAt: fixed.toISOString(), updatedAt: fixed.toISOString(), succeededAt: null
  }
}

function encryptResource(plain: Buffer, nonce: string, associatedData: string): string {
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce), { authTagLength: 16 })
  cipher.setAAD(Buffer.from(associatedData))
  return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]).toString('base64')
}

function signedNotification(plain: Record<string, unknown>, eventType: string, originalType: string) {
  const resourceNonce = '0123456789ab'
  const associatedData = originalType
  const envelope = {
    id: `event-${originalType}-001`,
    event_type: eventType,
    resource_type: 'encrypt-resource',
    resource: {
      algorithm: 'AEAD_AES_256_GCM',
      ciphertext: encryptResource(Buffer.from(JSON.stringify(plain)), resourceNonce, associatedData),
      nonce: resourceNonce,
      associated_data: associatedData,
      original_type: originalType
    }
  }
  const rawBody = Buffer.from(JSON.stringify(envelope), 'utf8')
  const nonce = 'callback-nonce-001'
  return {
    rawBody,
    headers: {
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-serial': 'PUB_KEY_ID_TEST',
      'wechatpay-signature': rsaSign(wechatKeys.privateKey, canonicalWechatMessage(timestamp, nonce, rawBody)),
      'wechatpay-signature-type': 'WECHATPAY2-SHA256-RSA2048'
    }
  }
}

function signedRawNotification(value: unknown) {
  const rawBody = Buffer.from(JSON.stringify(value), 'utf8')
  const nonce = 'callback-nonce-invalid'
  return {
    rawBody,
    headers: {
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-serial': 'PUB_KEY_ID_TEST',
      'wechatpay-signature': rsaSign(wechatKeys.privateKey, canonicalWechatMessage(timestamp, nonce, rawBody)),
      'wechatpay-signature-type': 'WECHATPAY2-SHA256-RSA2048'
    }
  }
}

test('canonical API v3 message keeps exact bytes and final LF', () => {
  const body = '{"amount":{"total":3990,"currency":"CNY"}}'
  const expected = `POST\n/v3/pay/transactions/jsapi\n${timestamp}\nnonce\n${body}\n`
  assert.equal(canonicalApiRequest('POST', '/v3/pay/transactions/jsapi', timestamp, 'nonce', body).toString('utf8'), expected)
})

test('API v3 provider signs exact request, verifies response, and signs mini-program params', async () => {
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input)
    capturedInit = init
    if (capturedUrl.endsWith('/close')) return signedEmptyResponse()
    return signedResponse({ prepay_id: 'wx_test_prepay_001' })
  }) as typeof fetch
  const pay = provider(fetchStub)
  const result = await pay.createPrepay(orderFixture(), 'openid_for_same_app')
  assert.equal(capturedUrl, 'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi')
  const rawBody = String(capturedInit?.body ?? '')
  const body = JSON.parse(rawBody)
  assert.equal(body.amount.total, 3990)
  assert.equal(body.payer.openid, 'openid_for_same_app')
  assert.equal(body.time_expire, orderFixture().expiresAt)
  const authorization = String((capturedInit?.headers as Record<string, string>).Authorization)
  const field = (name: string) => authorization.match(new RegExp(`${name}="([^"]+)"`))?.[1] ?? ''
  const requestSignatureValid = verify(
    'RSA-SHA256',
    canonicalApiRequest('POST', '/v3/pay/transactions/jsapi', field('timestamp'), field('nonce_str'), rawBody),
    { key: merchantKeys.publicKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(field('signature'), 'base64')
  )
  assert.equal(requestSignatureValid, true)
  assert.equal(result.paymentParams.package, 'prepay_id=wx_test_prepay_001')
  assert.equal(result.paymentParams.signType, 'RSA')
  const clientSignatureValid = verify(
    'RSA-SHA256',
    Buffer.from(`wx_phoenix_test\n${result.paymentParams.timeStamp}\n${result.paymentParams.nonceStr}\n${result.paymentParams.package}\n`),
    { key: merchantKeys.publicKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(result.paymentParams.paySign, 'base64')
  )
  assert.equal(clientSignatureValid, true)

  await pay.closeOrder(orderFixture().outTradeNo)
  assert.equal(capturedUrl, `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${orderFixture().outTradeNo}/close`)
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), { mchid: '1900000001' })
})

test('NOTPAY query accepts the official response shape without optional payer or amount', async () => {
  const fetchStub = (async () => signedResponse({
    appid: 'wx_phoenix_test', mchid: '1900000001', out_trade_no: orderFixture().outTradeNo,
    trade_type: 'JSAPI', trade_state: 'NOTPAY'
  })) as typeof fetch
  const result = await provider(fetchStub).queryOrder(orderFixture().outTradeNo)
  assert.equal(result.tradeState, 'NOTPAY')
  assert.equal(result.totalFen, undefined)
  assert.equal(result.currency, undefined)
  assert.equal(result.payerOpenid, undefined)
})

test('refund request uses validated reason and query/refund responses are signature-verified', async () => {
  const calls: Array<{ url: string; body: string }> = []
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = String(init?.body ?? '')
    calls.push({ url, body })
    if (url.endsWith('/v3/refund/domestic/refunds')) return signedResponse({ refund_id: 'wx_refund_001', status: 'PROCESSING' })
    if (url.includes('/v3/refund/domestic/refunds/')) {
      return signedResponse({
        mchid: '1900000001', out_trade_no: orderFixture().outTradeNo,
        out_refund_no: refundFixture().outRefundNo, refund_id: 'wx_refund_001', status: 'SUCCESS',
        amount: { refund: 3990, total: 3990, currency: 'CNY' }, success_time: fixed.toISOString()
      })
    }
    throw new Error('unexpected URL')
  }) as typeof fetch
  const pay = provider(fetchStub)
  const requested = await pay.requestRefund(orderFixture(), refundFixture())
  assert.equal(requested.status, 'PROCESSING')
  assert.equal(JSON.parse(calls[0]!.body).reason, '用户确认取消报告')
  const queried = await pay.queryRefund(refundFixture().outRefundNo)
  assert.equal(queried.refundStatus, 'SUCCESS')
  assert.equal(queried.refundFen, 3990)
})

test('callback verifies raw bytes before AES-GCM decrypt and rejects tampering', async () => {
  const noFetch = (async () => { throw new Error('network must not be used') }) as typeof fetch
  const pay = provider(noFetch)
  const notification = signedNotification({
    appid: 'wx_phoenix_test', mchid: '1900000001', out_trade_no: orderFixture().outTradeNo,
    transaction_id: 'wx_transaction_001', trade_type: 'JSAPI', trade_state: 'SUCCESS',
    amount: { total: 3990, currency: 'CNY' }, payer: { openid: 'openid_for_same_app' },
    success_time: fixed.toISOString()
  }, 'TRANSACTION.SUCCESS', 'transaction')
  const parsed = await pay.parseTransactionNotification(notification.headers, notification.rawBody)
  assert.equal(parsed.totalFen, 3990)
  assert.equal(parsed.tradeState, 'SUCCESS')

  const tampered = Buffer.concat([notification.rawBody.subarray(0, -1), Buffer.from(' ')])
  await assert.rejects(pay.parseTransactionNotification(notification.headers, tampered), (error: unknown) => error instanceof AppError && error.code === 'WECHATPAY_SIGNATURE_INVALID')
  await assert.rejects(pay.parseTransactionNotification({ ...notification.headers, 'wechatpay-serial': 'UNKNOWN' }, notification.rawBody),
    (error: unknown) => error instanceof AppError && error.code === 'WECHATPAY_KEY_ID_UNKNOWN')
})

test('official-shape AES-256-GCM vector decrypts and tag changes fail closed', () => {
  const ciphertext = '4ouGVyy/9m/XP1ifx2sIRi6k7vwu8VpHBuy6a7ud98pTXV1bsbx85x3CXRW56A+74R/oydZ0Wx5RjKcLTzxHykLbjMKjfIeHHhW2MFfUJRbaiw=='
  const resource = {
    algorithm: 'AEAD_AES_256_GCM', ciphertext,
    nonce: '0123456789ab', associated_data: 'transaction', original_type: 'transaction'
  }
  assert.equal(
    decryptWechatResource(resource, apiV3Key).toString('utf8'),
    '{"amount":{"total":3990,"currency":"CNY"},"trade_state":"SUCCESS"}'
  )
  const bytes = Buffer.from(ciphertext, 'base64')
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1
  assert.throws(() => decryptWechatResource({ ...resource, ciphertext: bytes.toString('base64') }, apiV3Key),
    (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_RESOURCE_DECRYPT_FAILED')
})

test('signed malformed payment and refund payloads fail closed with stable provider errors', async () => {
  const noFetch = (async () => { throw new Error('network must not be used') }) as typeof fetch
  const pay = provider(noFetch)
  const nullEnvelope = signedRawNotification(null)
  await assert.rejects(pay.parseTransactionNotification(nullEnvelope.headers, nullEnvelope.rawBody),
    (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_NOTIFICATION_INVALID')

  const invalidState = signedNotification({
    appid: 'wx_phoenix_test', mchid: '1900000001', out_trade_no: orderFixture().outTradeNo,
    transaction_id: 'wx_transaction_invalid', trade_type: 'JSAPI', trade_state: 'UNKNOWN',
    amount: { total: 3990, currency: 'CNY' }, payer: { openid: 'openid_for_same_app' }
  }, 'TRANSACTION.SUCCESS', 'transaction')
  await assert.rejects(pay.parseTransactionNotification(invalidState.headers, invalidState.rawBody),
    (error: unknown) => error instanceof AppError && error.code === 'WECHATPAY_TRANSACTION_INVALID')

  const invalidRefundFetch = (async () => signedResponse({
    mchid: '1900000001', out_trade_no: orderFixture().outTradeNo,
    out_refund_no: refundFixture().outRefundNo, refund_id: 'wx_refund_invalid', status: 'UNKNOWN',
    amount: { refund: 3990, total: 3990, currency: 'CNY' }
  })) as typeof fetch
  await assert.rejects(provider(invalidRefundFetch).queryRefund(refundFixture().outRefundNo),
    (error: unknown) => error instanceof AppError && error.code === 'WECHATPAY_REFUND_INVALID')

  const officialRefundQueryWithoutMchid = (async () => signedResponse({
    out_trade_no: orderFixture().outTradeNo,
    out_refund_no: refundFixture().outRefundNo, refund_id: 'wx_refund_official', status: 'PROCESSING',
    amount: { refund: 3990, total: 3990, currency: 'CNY' }
  })) as typeof fetch
  const officialRefundQuery = await provider(officialRefundQueryWithoutMchid).queryRefund(refundFixture().outRefundNo)
  assert.equal(officialRefundQuery.mchId, '1900000001')
  assert.equal(officialRefundQuery.providerRefundId, 'wx_refund_official')
})
