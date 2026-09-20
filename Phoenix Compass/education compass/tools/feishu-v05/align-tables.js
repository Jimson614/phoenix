#!/usr/bin/env node
'use strict'

/**
 * 把飞书 Base 里的表结构对齐到 V0.5 Clean Master。
 *
 * 只做两件事，都以母版为准：
 *   1. 改列名 —— 建表时写岔的分隔符（Final PDF | Link → Final PDF / Link）
 *   2. 改字段类型 —— 被建成纯文本的单选／数字／复选框，单选选项直接用母版白名单
 *
 * 默认只打印计划不动飞书；要真改必须显式加 --apply。
 * 默认只处理最小链路缺的三张表，--sheets= 可以改范围。
 *
 * 用法：
 *   node tools/feishu-v05/align-tables.js                    # 只看计划
 *   node tools/feishu-v05/align-tables.js --apply            # 执行
 *   node tools/feishu-v05/align-tables.js --sheets=Deals --apply
 */

const fs = require('node:fs')
const path = require('node:path')

const { MASTER, T, tableBySheet } = require('./schema')
const { FeishuClient } = require('./feishu-client')

/** 最小链路里还没对齐的三张表 */
const DEFAULT_SHEETS = ['Deals', 'Contracts', 'Payments']

const TYPE_LABEL = { [T.TEXT]: '单行文本', [T.NUMBER]: '数字', [T.SELECT]: '单选', [T.CHECKBOX]: '复选框' }

function parseArgs(argv) {
  const args = { apply: false, sheets: DEFAULT_SHEETS, appToken: null, out: null }
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true
    else if (raw.startsWith('--sheets=')) args.sheets = raw.slice('--sheets='.length).split(',').map((s) => s.trim())
    else if (raw.startsWith('--app-token=')) args.appToken = raw.slice('--app-token='.length)
    else if (raw.startsWith('--out=')) args.out = raw.slice('--out='.length)
    else if (raw === '--help' || raw === '-h') args.help = true
    else throw new Error(`未知参数 ${raw}`)
  }
  return args
}

const HELP = `把飞书表结构对齐到 ${MASTER.source_workbook}

  --apply           真正执行；不加就只打印计划
  --sheets=A,B      要处理的表，默认 ${DEFAULT_SHEETS.join(',')}
  --app-token=<v>   Base App Token，也可直接粘 Base 链接
  --out=<dir>       计划与结果的输出目录，默认 artifacts/feishu-v05/<时间戳>-align
`

function parseAppToken(value) {
  if (!value) return value
  const matched = String(value).match(/\/base\/([A-Za-z0-9]+)/)
  return matched ? matched[1] : String(value).trim()
}

/** 把分隔符差异抹平，用来认出"同一列被写成了另一个名字" */
function normalizeName(name) {
  return String(name)
    .replace(/[|/]/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
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

/** 对照母版算出每张表要做的改动 */
function planForTable(sheet, remoteFields) {
  const table = tableBySheet(sheet)
  const byName = new Map(remoteFields.map((field) => [field.name, field]))
  const byNormalized = new Map(remoteFields.map((field) => [normalizeName(field.name), field]))
  const steps = []
  const unresolved = []

  for (const field of table.fields) {
    const exact = byName.get(field.name)
    const loose = byNormalized.get(normalizeName(field.name))
    const remote = exact || loose
    if (!remote) {
      unresolved.push(field.name)
      continue
    }

    const renameTo = remote.name === field.name ? null : field.name
    const retypeTo = remote.type === field.type ? null : field.type
    if (!renameTo && !retypeTo) continue

    steps.push({
      fieldId: remote.id,
      from: remote.name,
      to: field.name,
      rename: Boolean(renameTo),
      fromType: remote.type,
      toType: field.type,
      retype: Boolean(retypeTo),
      options: Array.isArray(field.options) ? field.options : null,
      primary: remote.isPrimary
    })
  }

  return { sheet, steps, unresolved }
}

function describe(step) {
  const parts = []
  if (step.rename) parts.push(`改名 "${step.from}" → "${step.to}"`)
  if (step.retype) {
    const from = TYPE_LABEL[step.fromType] ?? step.fromType
    const to = TYPE_LABEL[step.toType] ?? step.toType
    parts.push(`类型 ${from} → ${to}${step.options ? `（${step.options.length} 个选项）` : ''}`)
  }
  return parts.join('，')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(HELP)
    return 0
  }

  const now = new Date()
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
  console.log(`表结构对齐到母版：${MASTER.source_workbook}`)
  console.log(`模式：${args.apply ? 'APPLY（真正修改飞书表结构）' : 'PLAN（只打印，不修改）'}    app_token=${appToken}`)
  console.log(`范围：${args.sheets.join('、')}`)
  console.log(line('═'))

  const remoteTables = await client.listTables()
  const tableIds = {}
  for (const sheet of args.sheets) {
    tableBySheet(sheet)
    const matched = remoteTables.find((item) => item.name === sheet)
    if (!matched) throw new Error(`Base 中没有表「${sheet}」`)
    tableIds[sheet] = matched.tableId
  }

  const plans = []
  for (const sheet of args.sheets) {
    const remoteFields = await client.listFields(tableIds[sheet])
    plans.push({ ...planForTable(sheet, remoteFields), tableId: tableIds[sheet] })
  }

  console.log('\n【1】改动计划')
  let total = 0
  for (const plan of plans) {
    console.log(`\n  ── ${plan.sheet}（${plan.tableId}）：${plan.steps.length} 处`)
    for (const step of plan.steps) {
      console.log(`     ${pad(step.to, 30)} ${describe(step)}`)
      total += 1
    }
    if (plan.steps.length === 0) console.log('     已对齐母版，无需改动')
    if (plan.unresolved.length) {
      console.log(`     无法定位（母版有、远端连近似列名都没有）：${plan.unresolved.join('、')}`)
    }
  }

  const artifactDir =
    args.out || path.join(process.cwd(), 'artifacts', 'feishu-v05', `${now.toISOString().replace(/[:.]/g, '-')}-align`)
  fs.mkdirSync(artifactDir, { recursive: true })
  const planPath = path.join(artifactDir, 'align-plan.json')
  const record = {
    run_at: now.toISOString(),
    mode: args.apply ? 'apply' : 'plan',
    master_workbook: MASTER.source_workbook,
    app_token: appToken,
    sheets: args.sheets,
    plans,
    results: null
  }

  console.log(`\n${line()}`)
  console.log(`  合计 ${total} 处改动`)

  const blocked = plans.filter((plan) => plan.unresolved.length > 0)
  if (blocked.length) {
    fs.writeFileSync(planPath, JSON.stringify(record, null, 2))
    console.log(`  有列在远端找不到对应，请先手工确认：${blocked.map((plan) => plan.sheet).join('、')}`)
    console.log(`  计划：${path.relative(process.cwd(), planPath)}`)
    return 1
  }

  if (!args.apply) {
    fs.writeFileSync(planPath, JSON.stringify(record, null, 2))
    console.log(`  计划：${path.relative(process.cwd(), planPath)}`)
    console.log('  确认无误后加 --apply 执行。')
    return 0
  }

  console.log('\n【2】执行')
  const results = []
  for (const plan of plans) {
    for (const step of plan.steps) {
      try {
        await client.updateField({
          tableId: plan.tableId,
          fieldId: step.fieldId,
          name: step.to,
          type: step.toType,
          options: step.options
        })
        results.push({ sheet: plan.sheet, field: step.to, ok: true })
        console.log(`  OK    ${pad(plan.sheet, 20)} ${pad(step.to, 30)} ${describe(step)}`)
      } catch (error) {
        results.push({ sheet: plan.sheet, field: step.to, ok: false, error: error.message })
        console.log(`  FAIL  ${pad(plan.sheet, 20)} ${pad(step.to, 30)} ${error.message}`)
      }
    }
  }

  console.log('\n【3】改完读回校验')
  const remaining = []
  for (const plan of plans) {
    const remoteFields = await client.listFields(plan.tableId)
    const after = planForTable(plan.sheet, remoteFields)
    const ok = after.steps.length === 0 && after.unresolved.length === 0
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${pad(plan.sheet, 20)} 剩余差异 ${after.steps.length + after.unresolved.length}`)
    for (const step of after.steps) console.log(`        ${step.to}：${describe(step)}`)
    if (!ok) remaining.push(plan.sheet)
  }

  record.results = results
  fs.writeFileSync(planPath, JSON.stringify(record, null, 2))

  const failed = results.filter((item) => !item.ok)
  console.log(`\n${line()}`)
  console.log(`  执行结果：${results.length - failed.length}/${results.length} 成功`)
  console.log(`  证据：${path.relative(process.cwd(), planPath)}`)
  if (remaining.length) {
    console.log(`  仍有差异：${remaining.join('、')}`)
    return 1
  }
  console.log('  这几张表已对齐母版，可以跑 run-min-chain.js --verify-only 复核。')
  return 0
}

module.exports = { planForTable, normalizeName, describe, DEFAULT_SHEETS }

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`\n执行失败：${error.message}`)
      process.exit(1)
    })
}
