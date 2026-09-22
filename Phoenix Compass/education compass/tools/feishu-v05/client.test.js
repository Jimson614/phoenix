'use strict'

/**
 * 客户端的纯函数测试：读回来的单元格形状、网络错误的原因拆解。
 * 运行：node --test tools/feishu-v05/client.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { FeishuClient, maskAppToken } = require('./feishu-client')

const normalize = FeishuClient.normalizeCellValue

test('文本字段：字符串和富文本分段都压成同一个值', () => {
  assert.equal(normalize('PN-DEAL-0001'), 'PN-DEAL-0001')
  assert.equal(normalize([{ type: 'text', text: 'PN-DEAL-0001' }]), 'PN-DEAL-0001')
  assert.equal(normalize([{ text: 'PN-' }, { text: 'DEAL-0001' }]), 'PN-DEAL-0001')
})

test('单选字段：字符串或 { name } 都取得到选项名', () => {
  assert.equal(normalize('VERIFIED'), 'VERIFIED')
  assert.equal(normalize({ name: 'VERIFIED' }), 'VERIFIED')
})

test('数字和复选框保持原始类型，不被转成字符串', () => {
  assert.equal(normalize(39900), 39900)
  assert.equal(normalize(0), 0)
  assert.equal(normalize(true), true)
  assert.equal(normalize(false), false)
})

test('空值统一成 null，不会变成 "undefined" 这种字符串', () => {
  assert.equal(normalize(null), null)
  assert.equal(normalize(undefined), null)
  assert.equal(normalize([]), '')
})

test('回填校验用得上：读回的富文本与写入的字符串比对得上', () => {
  const written = 'PN-SP-A2535575'
  const readBack = normalize([{ type: 'text', text: 'PN-SP-A2535575' }])
  assert.equal(String(readBack), String(written))
})

test('网络错误把 cause 链拆开，指出真正的原因', () => {
  const error = new Error('fetch failed')
  error.cause = Object.assign(new Error('getaddrinfo ENOTFOUND open.feishu.cn'), { code: 'ENOTFOUND' })
  const described = FeishuClient.describeNetworkError(error)
  assert.match(described, /fetch failed/)
  assert.match(described, /ENOTFOUND/)
})

test('没有 cause 时也不会报错', () => {
  assert.equal(FeishuClient.describeNetworkError(new Error('socket hang up')), 'socket hang up')
})

test('凭据不全直接拒绝构造，不会带着空 token 去请求', () => {
  assert.throws(() => new FeishuClient({ appId: 'cli_x', appSecret: '', appToken: 'tok' }), /配置不完整/)
})

test('只有幂等请求可以重试，写操作不重放', () => {
  const idempotent = FeishuClient.isIdempotent
  assert.equal(idempotent('GET', '/open-apis/bitable/v1/apps/a/tables'), true)
  assert.equal(idempotent('POST', '/open-apis/bitable/v1/apps/a/tables/t/records/search?page_size=2'), true)
  assert.equal(idempotent('POST', '/open-apis/auth/v3/tenant_access_token/internal'), true)
  assert.equal(idempotent('POST', '/open-apis/bitable/v1/apps/a/tables/t/records'), false)
  assert.equal(idempotent('PUT', '/open-apis/bitable/v1/apps/a/tables/t/records/r'), false)
  assert.equal(idempotent('POST', '/open-apis/bitable/v1/apps/a/tables/t/records/batch_delete'), false)
})

test('写操作网络失败只请求一次，并提示可能已经生效', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls += 1; throw new Error('fetch failed') }
  try {
    const client = new FeishuClient({ appId: 'cli_x', appSecret: 's', appToken: 'tok', retries: 3 })
    await assert.rejects(
      client.request('/open-apis/bitable/v1/apps/a/tables/t/records', { method: 'POST', body: {}, auth: false }),
      (error) => error.code === 'NETWORK_ERROR' && /可能已经在飞书生效/.test(error.message) && error.retried === false
    )
    assert.equal(calls, 1, '写操作不能重试')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('只读检索网络失败会重试到上限', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls += 1; throw new Error('fetch failed') }
  const warn = console.warn
  console.warn = () => undefined
  try {
    const client = new FeishuClient({ appId: 'cli_x', appSecret: 's', appToken: 'tok', retries: 2 })
    await assert.rejects(
      client.request('/open-apis/bitable/v1/apps/a/tables/t/records/search?page_size=2', { method: 'POST', body: {}, auth: false }),
      (error) => error.code === 'NETWORK_ERROR' && error.retried === true
    )
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = originalFetch
    console.warn = warn
  }
})

test('打印用的 app_token 只保留前 6 位', () => {
  assert.equal(maskAppToken('VDy5beAbCdEfGhIjKl'), 'VDy5be***')
  assert.equal(maskAppToken('abc'), 'ab***')
  assert.equal(maskAppToken(''), '(未配置)')
  assert.equal(maskAppToken(undefined), '(未配置)')
})
