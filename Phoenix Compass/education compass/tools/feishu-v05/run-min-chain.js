#!/usr/bin/env node
'use strict'

/**
 * V0.5 最小链路执行器
 * 基线：Phoenix_Feishu_Operating_Model_V0.5_Clean_Master.xlsx
 * 主链：Family/Student → Deal → Contract + Payment → ServiceProject
 *
 * 默认 dry-run：不连飞书，只构建 Core 事实源 → 飞书记录 → Integration_Links，
 * 并跑完 10 条 V0.5 Gate，输出将要发往飞书的原始载荷。
 *
 * 加 --live：真正写入飞书；--create-tables 会先按母版建齐 11 张空表。
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const {
  MASTER,
  TABLES,
  CHAIN,
  LINKS_SHEET,
  BACKFILL_REFS,
  READ_ONLY_FIELDS,
  tableBySheet
} = require('./schema')
const { buildCoreFixture, buildChainRecords, buildLinks, applyBackfills, runGates } = require('./core')
const { FeishuClient } = require('./feishu-client')

function parseArgs(argv) {
  const args = { live: false, createTables: false, verifyOnly: false, appToken: null, out: null }
  for (const raw of argv) {
    if (raw === '--live') args.live = true
    else if (raw === '--create-tables') args.createTables = true
    else if (raw === '--verify-only') args.verifyOnly = true
    else if (raw.startsWith('--app-token=')) args.appToken = raw.slice('--app-token='.length)
    else if (raw.startsWith('--out=')) args.out = raw.slice('--out='.length)
    else if (raw === '--help' || raw === '-h') args.help = true
    else throw new Error(`未知参数 ${raw}`)
  }
  if (args.verifyOnly) args.live = true
  return args
}

/** 允许直接粘贴 Base 链接：https://<租户>.feishu.cn/base/<app_token>?… */
function parseAppToken(value) {
  if (!value) return value
  const matched = String(value).match(/\/base\/([A-Za-z0-9]+)/)
  return matched ? matched[1] : String(value).trim()
}

const HELP = `V0.5 最小链路执行器（基线：${MASTER.source_workbook}）

  --live            真正写入飞书（需要 FEISHU_APP_ID / FEISHU_APP_SECRET 和 Base App Token）
  --verify-only     只读：按母版校验 Base 里 11 张表的字段合同，不写任何记录（隐含 --live）
  --create-tables   Base 中缺表时按母版建空表（配合 --live，会建齐 11 张）
  --app-token=<v>   Base App Token，也可直接粘贴 Base 链接；默认读 FEISHU_V05_BITABLE_APP_TOKEN
  --out=<dir>       证据输出目录，默认 artifacts/feishu-v05/<时间戳>

表 ID 可用环境变量指定，例如 FEISHU_V05_TABLE_DEALS、FEISHU_V05_TABLE_FAMILY_STUDENT_VIEW。
`

function envKey(sheet) {
  return `FEISHU_V05_TABLE_${sheet.toUpperCase()}`
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

function indent(value, prefix = '     ') {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((row) => prefix + row)
    .join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(HELP)
    return 0
  }

  const now = new Date()
  const runTag = crypto.randomBytes(8).toString('hex')

  console.log(line('═'))
  console.log('V0.5 最小链路：Family/Student → Deal → Contract + Payment → ServiceProject')
  console.log(`基线母版：${MASTER.source_workbook}（${TABLES.length} 张表 / ${TABLES.reduce((sum, t) => sum + t.fields.length, 0)} 个字段）`)
  console.log(`模式：${args.live ? 'LIVE（写入飞书）' : 'DRY-RUN（不连接飞书）'}    运行标记：${runTag}    时间：${now.toISOString()}`)
  console.log(line('═'))

  const core = buildCoreFixture({ now, runTag })
  const { ids, records, backfills } = buildChainRecords({ core, runTag })
  const links = buildLinks({ core, ids, runTag })

  console.log('\n【1】事实源（Core / Founder OS，canonical ID 不进飞书主键）')
  console.log(`  ${pad('Phoenix Core', 22)} Family ID=${core.familyId}  Student ID=${core.studentId}`)
  console.log(`  ${pad('Founder OS', 22)} Deal=${core.dealId}  Contract=${core.contractId}  Payment=${core.paymentId}  ServiceProject=${core.serviceProjectId}`)
  console.log(`  ${pad('Contract Code', 22)} ${core.contractCode}（签发方 ${core.contractCodeIssuedBy}，飞书只读）`)

  console.log('\n【2】飞书运营记录（按母版列名）')
  for (const sheet of CHAIN) {
    const table = tableBySheet(sheet)
    console.log(`  ${pad(sheet, 22)} ${pad(table.unique, 20)} = ${ids[sheet]}`)
  }

  console.log('\n【3】写入后回填的反向引用')
  for (const item of backfills) {
    console.log(`  ${pad(item.sheet, 22)} ${pad(item.field, 20)} = ${item.value}`)
  }

  console.log('\n【4】Integration_Links 映射行')
  for (const link of links) {
    const fields = link.fields
    console.log(
      `  ${pad(fields['Source Entity Type'], 18)} ${pad(fields['Source Record ID'], 18)} → ${pad(fields['Target System'], 20)} ${fields['Target Entity Type']}:${fields['Target Record ID']}`
    )
  }

  const gates = runGates({ core, ids, records, backfills, links })
  console.log('\n【5】V0.5 Gate')
  console.log(line())
  for (const item of gates) {
    console.log(`  ${item.pass ? 'PASS' : 'FAIL'}  ${item.id}  ${item.title}`)
    console.log(`        ${item.detail}`)
  }
  console.log(line())
  const failed = gates.filter((item) => !item.pass)
  console.log(`  Gate 结果：${gates.length - failed.length}/${gates.length} 通过`)

  const artifactDir =
    args.out ||
    path.join(process.cwd(), 'artifacts', 'feishu-v05', `${now.toISOString().replace(/[:.]/g, '-')}-${runTag}`)
  fs.mkdirSync(artifactDir, { recursive: true })
  const evidencePath = path.join(artifactDir, 'min-chain-evidence.json')

  const evidence = {
    run_tag: runTag,
    run_at: now.toISOString(),
    mode: args.live ? 'live' : 'dry-run',
    master_workbook: MASTER.source_workbook,
    chain: CHAIN,
    core_fixture: core,
    feishu_records: records,
    backfills,
    integration_links: links.map((link) => link.fields),
    gates,
    live_result: null
  }

  if (failed.length > 0) {
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
    console.log('\n存在未通过的 Gate，已停止，未触碰飞书。')
    console.log(`证据：${path.relative(process.cwd(), evidencePath)}`)
    return 1
  }

  if (!args.live) {
    console.log('\n【6】DRY-RUN：以下载荷将原样发往飞书')
    for (const sheet of CHAIN) {
      console.log(`\n  ── ${sheet}（主字段 ${tableBySheet(sheet).unique}）`)
      console.log(indent(records[sheet]))
    }
    console.log(`\n  ── ${LINKS_SHEET}（${links.length} 行）`)
    console.log(indent(links[0].fields))
    console.log('     …（其余 %d 行结构相同，见证据文件）'.replace('%d', String(links.length - 1)))

    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
    console.log(`\n最小链路 dry-run 通过。证据：${path.relative(process.cwd(), evidencePath)}`)
    console.log('要真正写入飞书：配置凭据后加 --live（首次加 --create-tables 按母版建齐 11 张空表）。')
    return 0
  }

  // ── LIVE ──────────────────────────────────────────────────────────────
  const appToken = parseAppToken(
    args.appToken || process.env.FEISHU_V05_BITABLE_APP_TOKEN || process.env.FEISHU_BITABLE_APP_TOKEN
  )
  const client = new FeishuClient({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    appToken,
    baseUrl: process.env.FEISHU_API_BASE_URL || undefined
  })

  console.log(`\n【6】LIVE：解析 Base 中的表（app_token=${appToken}）`)
  const remoteTables = await client.listTables()
  const tableIds = {}
  const needed =
    args.createTables || args.verifyOnly ? TABLES.map((table) => table.sheet) : CHAIN.concat([LINKS_SHEET])
  for (const sheet of needed) {
    const table = tableBySheet(sheet)
    const fromEnv = process.env[envKey(sheet)]
    const matched = remoteTables.find((item) => item.name === sheet)
    let tableId = fromEnv || matched?.tableId || null
    if (!tableId && args.createTables) {
      tableId = await client.createTable({ name: sheet, fields: table.fields })
      console.log(`  CREATE ${pad(sheet, 24)} ${tableId}  字段 ${table.fields.length}`)
    } else if (tableId) {
      console.log(`  EXISTS ${pad(sheet, 24)} ${tableId}${fromEnv ? '（环境变量指定）' : ''}`)
    } else {
      throw new Error(`Base 中缺少表「${sheet}」，请先建表或加 --create-tables`)
    }
    tableIds[sheet] = tableId
  }

  console.log('\n【7】LIVE：字段合同预检（对照母版）')
  const preflight = []
  for (const sheet of needed) {
    const table = tableBySheet(sheet)
    const remoteFields = await client.listFields(tableIds[sheet])
    const byName = new Map(remoteFields.map((field) => [field.name, field]))
    const missing = table.fields.filter((field) => !byName.has(field.name)).map((field) => field.name)
    const mismatched = table.fields
      .filter((field) => byName.has(field.name) && byName.get(field.name).type !== field.type)
      .map((field) => `${field.name}(期望 ${field.type}，实际 ${byName.get(field.name).type})`)
    const extra = remoteFields
      .filter((field) => !table.fields.some((item) => item.name === field.name))
      .map((field) => field.name)
    const primary = remoteFields.find((field) => field.isPrimary)
    const primaryOk = primary?.name === table.unique
    const ok = missing.length === 0 && mismatched.length === 0 && primaryOk
    preflight.push({ sheet, table_id: tableIds[sheet], ok, missing, mismatched, extra, primary: primary?.name ?? null })

    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${pad(sheet, 24)} 远端 ${remoteFields.length} 列 / 母版 ${table.fields.length} 列，主字段 ${primary?.name ?? '未知'}`)
    if (missing.length) console.log(`        缺字段（${missing.length}）：${missing.join('、')}`)
    if (mismatched.length) console.log(`        类型不符：${mismatched.join('、')}`)
    if (!primaryOk) console.log(`        主字段应为 ${table.unique}`)
    if (extra.length) console.log(`        母版之外的多余列（不阻断）：${extra.join('、')}`)
  }

  const broken = preflight.filter((item) => !item.ok)
  evidence.live_result = { app_token: appToken, table_ids: tableIds, preflight }

  if (args.verifyOnly) {
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
    console.log(line())
    console.log(`  预检结果：${preflight.length - broken.length}/${preflight.length} 张表符合母版`)
    console.log(`证据：${path.relative(process.cwd(), evidencePath)}`)
    if (broken.length) {
      console.log('先按上面的差异改齐飞书表结构，再跑 --live 写入链路。')
      return 1
    }
    console.log('表结构已对齐母版，可以跑 --live 写入最小链路。')
    return 0
  }

  if (broken.length) {
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
    throw new Error(
      `${broken.length} 张表不符合母版：${broken.map((item) => item.sheet).join('、')}；详见 ${path.relative(process.cwd(), evidencePath)}`
    )
  }

  console.log('\n【8】LIVE：按主链顺序写入')
  const written = {}
  for (const sheet of CHAIN) {
    const table = tableBySheet(sheet)
    const fields = { ...records[sheet] }
    const existing = await client.findRecordId({
      tableId: tableIds[sheet],
      uniqueField: table.unique,
      uniqueValue: ids[sheet]
    })
    let recordId
    if (existing) {
      for (const readOnly of READ_ONLY_FIELDS) delete fields[readOnly]
      recordId = await client.updateRecord({ tableId: tableIds[sheet], recordId: existing, fields })
      console.log(`  UPDATE ${pad(sheet, 24)} ${recordId}`)
    } else {
      recordId = await client.createRecord({ tableId: tableIds[sheet], fields })
      console.log(`  CREATE ${pad(sheet, 24)} ${recordId}`)
    }
    written[sheet] = recordId
  }

  console.log('\n【9】LIVE：回填反向引用')
  const grouped = new Map()
  for (const item of backfills) {
    if (!grouped.has(item.sheet)) grouped.set(item.sheet, {})
    grouped.get(item.sheet)[item.field] = item.value
  }
  for (const [sheet, fields] of grouped) {
    await client.updateRecord({ tableId: tableIds[sheet], recordId: written[sheet], fields })
    console.log(`  PATCH  ${pad(sheet, 24)} ${Object.keys(fields).join('、')}`)
  }

  console.log('\n【10】LIVE：写入 Integration_Links')
  const linkTable = tableBySheet(LINKS_SHEET)
  const linkResults = []
  for (const link of links) {
    const existing = await client.findRecordId({
      tableId: tableIds[LINKS_SHEET],
      uniqueField: linkTable.unique,
      uniqueValue: link.fields[linkTable.unique]
    })
    const recordId = existing
      ? await client.updateRecord({ tableId: tableIds[LINKS_SHEET], recordId: existing, fields: link.fields })
      : await client.createRecord({ tableId: tableIds[LINKS_SHEET], fields: link.fields })
    linkResults.push({ ...link.fields, feishu_record_id: recordId })
    console.log(`  ${existing ? 'UPDATE' : 'CREATE'} ${pad(link.fields['Source Entity Type'], 18)} ${recordId}`)
  }

  console.log('\n【11】LIVE：读回校验')
  for (const sheet of CHAIN) {
    const table = tableBySheet(sheet)
    const found = await client.findRecordId({
      tableId: tableIds[sheet],
      uniqueField: table.unique,
      uniqueValue: ids[sheet]
    })
    if (found !== written[sheet]) {
      throw new Error(`读回校验失败：${sheet} 期望 ${written[sheet]}，实际 ${found}`)
    }
    console.log(`  PASS  ${pad(sheet, 24)} ${found}`)
  }

  evidence.live_result = { ...evidence.live_result, records: written, integration_links: linkResults }
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
  console.log(`\n最小链路已在飞书跑通。证据：${path.relative(process.cwd(), evidencePath)}`)
  console.log('下一步：确认 Founder OS 与飞书通过 Integration_Links 映射无误后，再接 Delivery / Applications / Settlements。')
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\n执行失败：${error.message}`)
    process.exit(1)
  })
