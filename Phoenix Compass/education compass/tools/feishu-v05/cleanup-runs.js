#!/usr/bin/env node
'use strict'

/**
 * 删掉某次验收运行在飞书里留下的记录。
 *
 * 每条验收链路的 ID 都带运行标记（PN-CLI-CF4F9628、PN-LINK-CF4F9628-01 …），
 * 按标记在链路 6 张表里找记录，删除顺序是创建顺序的倒序。
 *
 * 默认只打印计划不删任何东西；要真删必须显式加 --apply。
 * 删除不可逆，删之前请确认 artifacts/feishu-v05/ 下对应的证据已经提交。
 *
 * 用法：
 *   node tools/feishu-v05/cleanup-runs.js --run=CF4F9628
 *   node tools/feishu-v05/cleanup-runs.js --run=A2535575,CF4F9628
 *   node tools/feishu-v05/cleanup-runs.js --run=A2535575,CF4F9628 --apply
 */

const fs = require('node:fs')
const path = require('node:path')

const { MASTER, CHAIN, LINKS_SHEET, tableBySheet } = require('./schema')
const { FeishuClient, maskAppToken } = require('./feishu-client')
const { loadEnvFile, ENV_FILENAME } = require('./load-env')

/** 运行标记是 8 位十六进制；限死格式，免得一个宽泛的关键字扫掉整张表 */
const RUN_TAG_PATTERN = /^[0-9A-Fa-f]{8}$/

/** 一次运行最多产出 5 条链路记录 + 6 行映射；超过就是匹配错了 */
const MAX_PER_TABLE_PER_RUN = 10

/** 删除顺序：先映射，再按创建顺序倒着删链路 */
const DELETE_ORDER = [LINKS_SHEET, ...[...CHAIN].reverse()]

function parseArgs(argv) {
  const args = { runs: [], apply: false, appToken: null, out: null }
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true
    else if (raw.startsWith('--run=')) {
      args.runs.push(
        ...raw
          .slice('--run='.length)
          .split(',')
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean)
      )
    } else if (raw.startsWith('--app-token=')) args.appToken = raw.slice('--app-token='.length)
    else if (raw.startsWith('--out=')) args.out = raw.slice('--out='.length)
    else if (raw === '--help' || raw === '-h') args.help = true
    else throw new Error(`未知参数 ${raw}`)
  }
  return args
}

const HELP = `删除验收运行在飞书里留下的记录（基线：${MASTER.source_workbook}）

  --run=<标记>      运行标记，8 位十六进制，逗号分隔可给多个。必填
  --apply           真正删除；不加就只打印计划
  --app-token=<v>   Base App Token，也可直接粘 Base 链接
  --out=<dir>       计划与结果的输出目录，默认 artifacts/feishu-v05/<时间戳>-cleanup

删除不可逆。执行前请确认对应运行的证据文件已经提交。
`

function parseAppToken(value) {
  if (!value) return value
  const matched = String(value).match(/\/base\/([A-Za-z0-9]+)/)
  return matched ? matched[1] : String(value).trim()
}

function width(text) {
  return [...String(text)].reduce((sum, char) => sum + (/[一-鿿＀-￯]/.test(char) ? 2 : 1), 0)
}

function pad(text, size) {
  return String(text) + ' '.repeat(Math.max(0, size - width(text)))
}

function line(char = '─', size = 82) {
  return char.repeat(size)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(HELP)
    return 0
  }
  if (args.runs.length === 0) {
    process.stdout.write(HELP)
    throw new Error('必须用 --run= 指定要清理哪次运行')
  }
  const invalid = args.runs.filter((tag) => !RUN_TAG_PATTERN.test(tag))
  if (invalid.length) {
    throw new Error(`运行标记必须是 8 位十六进制：${invalid.join('、')}`)
  }

  const now = new Date()
  const env = loadEnvFile()
  const appToken = parseAppToken(
    args.appToken || process.env.FEISHU_V05_BITABLE_APP_TOKEN || process.env.FEISHU_BITABLE_APP_TOKEN
  )
  const client = new FeishuClient({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    appToken,
    baseUrl: process.env.FEISHU_API_BASE_URL || undefined
  })

  console.log(line('═'))
  console.log('清理验收运行留下的记录')
  console.log(`模式：${args.apply ? 'APPLY（真正删除，不可逆）' : 'PLAN（只打印，不删除）'}    app_token=${maskAppToken(appToken)}`)
  console.log(`运行标记：${args.runs.join('、')}`)
  if (env.loaded.length) console.log(`凭据：${ENV_FILENAME} 提供了 ${env.loaded.join('、')}`)
  console.log(line('═'))

  const remoteTables = await client.listTables()
  const tableIds = {}
  for (const sheet of DELETE_ORDER) {
    const matched = remoteTables.find((item) => item.name === sheet)
    if (!matched) throw new Error(`Base 中没有表「${sheet}」`)
    tableIds[sheet] = matched.tableId
  }

  console.log('\n【1】按运行标记查找记录')
  const plan = []
  for (const sheet of DELETE_ORDER) {
    const table = tableBySheet(sheet)
    for (const tag of args.runs) {
      const found = await client.searchRecords({
        tableId: tableIds[sheet],
        conditions: [{ field_name: table.unique, operator: 'contains', value: [tag] }]
      })
      if (found.length > MAX_PER_TABLE_PER_RUN) {
        throw new Error(
          `${sheet} 匹配到 ${found.length} 条记录，超过单次运行应有的 ${MAX_PER_TABLE_PER_RUN} 条，已停止。请手工确认标记 ${tag} 是否写错。`
        )
      }
      for (const item of found) {
        plan.push({ sheet, tag, key: item.fields[table.unique], recordId: item.recordId })
      }
    }
  }

  for (const sheet of DELETE_ORDER) {
    const rows = plan.filter((item) => item.sheet === sheet)
    console.log(`\n  ── ${sheet}：${rows.length} 条`)
    for (const row of rows) console.log(`     ${pad(row.key, 26)} ${row.recordId}`)
    if (rows.length === 0) console.log('     没有匹配的记录')
  }

  const artifactDir =
    args.out || path.join(process.cwd(), 'artifacts', 'feishu-v05', `${now.toISOString().replace(/[:.]/g, '-')}-cleanup`)
  fs.mkdirSync(artifactDir, { recursive: true })
  const planPath = path.join(artifactDir, 'cleanup-plan.json')
  const record = {
    run_at: now.toISOString(),
    mode: args.apply ? 'apply' : 'plan',
    app_token: maskAppToken(appToken),
    run_tags: args.runs,
    plan,
    results: null
  }

  console.log(`\n${line()}`)
  console.log(`  合计 ${plan.length} 条记录`)

  if (plan.length === 0) {
    fs.writeFileSync(planPath, JSON.stringify(record, null, 2))
    console.log('  没有可删的记录，未做任何修改。')
    return 0
  }

  if (!args.apply) {
    fs.writeFileSync(planPath, JSON.stringify(record, null, 2))
    console.log(`  计划：${path.relative(process.cwd(), planPath)}`)
    console.log('  删除不可逆。确认无误后加 --apply 执行。')
    return 0
  }

  console.log('\n【2】删除')
  const results = []
  for (const sheet of DELETE_ORDER) {
    const rows = plan.filter((item) => item.sheet === sheet)
    if (rows.length === 0) continue
    try {
      const deleted = await client.batchDeleteRecords({
        tableId: tableIds[sheet],
        recordIds: rows.map((row) => row.recordId)
      })
      results.push({ sheet, deleted, ok: true })
      console.log(`  OK    ${pad(sheet, 24)} 删除 ${deleted} 条`)
    } catch (error) {
      results.push({ sheet, deleted: 0, ok: false, error: error.message })
      console.log(`  FAIL  ${pad(sheet, 24)} ${error.message}`)
    }
  }

  console.log('\n【3】删完复查')
  let remaining = 0
  for (const sheet of DELETE_ORDER) {
    const table = tableBySheet(sheet)
    let left = 0
    for (const tag of args.runs) {
      const found = await client.searchRecords({
        tableId: tableIds[sheet],
        conditions: [{ field_name: table.unique, operator: 'contains', value: [tag] }]
      })
      left += found.length
    }
    remaining += left
    console.log(`  ${left === 0 ? 'PASS' : 'FAIL'}  ${pad(sheet, 24)} 残留 ${left} 条`)
  }

  record.results = results
  fs.writeFileSync(planPath, JSON.stringify(record, null, 2))

  const failed = results.filter((item) => !item.ok)
  console.log(`\n${line()}`)
  console.log(`  删除结果：${results.length - failed.length}/${results.length} 张表成功，残留 ${remaining} 条`)
  console.log(`  记录：${path.relative(process.cwd(), planPath)}`)
  return remaining === 0 && failed.length === 0 ? 0 : 1
}

module.exports = { RUN_TAG_PATTERN, MAX_PER_TABLE_PER_RUN, DELETE_ORDER, parseArgs }

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`\n执行失败：${error.message}`)
      process.exit(1)
    })
}
