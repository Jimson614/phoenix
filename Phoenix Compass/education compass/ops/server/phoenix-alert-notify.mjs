#!/usr/bin/env node
// 往飞书群机器人发一条告警。健康检查、每日巡检和配置脚本都通过它发消息。
//
// 用法：node phoenix-alert-notify.mjs <alert|recovery|daily|test> <标题> [正文]
//
// 配置读自 ~/.config/phoenix-alert/feishu.env（权限 600），由 set-feishu-alert.sh 写入：
//   FEISHU_ALERT_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/...
//   FEISHU_ALERT_SECRET=...        机器人开了「签名校验」时必填
//
// 这里用 Node 而不是 curl：webhook 地址和 secret 都是密钥，放进 curl 的命令行参数
// 会在 ps 里短暂可见；在进程内签名和发送就没有这个问题。配置文件按行解析而不是
// source，理由同 phoenix_uat_start.sh：值里的元字符不该交给 shell 解释。
//
// PHOENIX_ALERT_DRY_RUN=1 时只打印将要发送的内容（隐去 webhook），不真正发送。

import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// 每条消息都以「Phoenix」开头：机器人如果用的是关键词校验，把关键词设成 Phoenix 即可。
const PREFIX = Object.freeze({
  alert: '【Phoenix 告警】',
  recovery: '【Phoenix 恢复】',
  daily: '【Phoenix 巡检】',
  test: '【Phoenix 测试】'
})

// 飞书返回的错误码直接翻译成该怎么处理，否则配置出错时只能看到一个数字。
const FEISHU_ERRORS = Object.freeze({
  19021: '签名校验失败：secret 不对，或服务器时间与飞书相差超过 1 小时',
  19022: '服务器 IP 不在机器人的 IP 白名单里',
  19024: '消息里没有机器人设置的关键词；本脚本的消息都以「Phoenix」开头，把关键词设成 Phoenix',
  11232: '触发飞书限流（每个机器人每分钟 100 条、每秒 5 条）'
})

/** 飞书自定义机器人签名：以 `timestamp\nsecret` 为 HMAC-SHA256 的密钥、空消息，结果 base64。 */
export function sign(timestamp, secret) {
  return createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64')
}

export function buildPayload({ kind, title, body = '', secret = '', now = Date.now(), host = hostname() }) {
  if (!PREFIX[kind]) throw new Error(`未知的消息类型：${kind}`)
  const time = new Date(now).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  const text = [`${PREFIX[kind]}${title}`, body, `时间：${time}　主机：${host}`]
    .filter((line) => line && String(line).trim())
    .join('\n')
  const payload = { msg_type: 'text', content: { text } }
  if (secret) {
    const timestamp = String(Math.floor(now / 1000))
    payload.timestamp = timestamp
    payload.sign = sign(timestamp, secret)
  }
  return payload
}

export function readConfig(path) {
  const config = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match) config[match[1]] = match[2].trim()
  }
  return config
}

export function describeFeishuResult(result) {
  // 旧版接口返回 StatusCode，新版返回 code；两种都认。
  const code = result?.code ?? result?.StatusCode
  if (code === 0) return { ok: true }
  return { ok: false, code, reason: FEISHU_ERRORS[code] ?? (result?.msg || result?.StatusMessage || '未知错误') }
}

async function main(argv) {
  const [kind, title, ...rest] = argv
  if (!kind || !title) {
    console.error('用法：node phoenix-alert-notify.mjs <alert|recovery|daily|test> <标题> [正文]')
    return 2
  }
  const dryRun = process.env.PHOENIX_ALERT_DRY_RUN === '1'
  const configPath = process.env.PHOENIX_ALERT_CONFIG || join(homedir(), '.config', 'phoenix-alert', 'feishu.env')

  let config = {}
  try {
    config = readConfig(configPath)
  } catch {
    if (!dryRun) {
      console.error(`读不到告警配置：${configPath}。先运行 ~/set-feishu-alert.sh`)
      return 1
    }
  }
  const webhook = config.FEISHU_ALERT_WEBHOOK || ''
  const secret = config.FEISHU_ALERT_SECRET || ''
  const payload = buildPayload({ kind, title, body: rest.join('\n'), secret })

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, webhookConfigured: Boolean(webhook), payload }, null, 2))
    return 0
  }
  if (!/^https:\/\/open\.(feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9-]+$/.test(webhook)) {
    console.error('告警配置里的 webhook 地址格式不对，重新运行 ~/set-feishu-alert.sh')
    return 1
  }

  let result
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000)
    })
    result = await response.json()
  } catch (error) {
    console.error(`发送失败：无法连接飞书（${error instanceof Error ? error.message : String(error)}）`)
    return 1
  }
  const outcome = describeFeishuResult(result)
  if (!outcome.ok) {
    console.error(`飞书拒收（错误码 ${outcome.code}）：${outcome.reason}`)
    return 1
  }
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2))
}
