'use strict'

/**
 * 校验正式来源目录（SOURCE_CATALOG_PATH 指向的文件）。
 *
 * 用的是服务端编译产物里那一份 validateSourceCatalog，不另写一套规则：
 * 这里通过不代表线上一定通过是最糟的结果，所以两边必须是同一段代码。
 *
 * 用法：node scripts/validate-source-catalog.js <文件路径>
 */

const { readFileSync } = require('node:fs')
const path = require('node:path')

const { serverDist } = require('./server-dist-path')

// 模板占位值能通过 schema 校验，但一旦当成真目录上线，报告就会带着假证据收费。
const placeholderMarkers = ['TEMPLATE_REPLACE_ME', 'REPLACE_ME', 'DEMO_ONLY']

function placeholdersIn(catalog) {
  const found = []
  const check = (label, value) => {
    if (typeof value !== 'string') return
    const hit = placeholderMarkers.find((marker) => value.toUpperCase().includes(marker))
    if (hit) found.push(`${label} 仍是占位值（含 ${hit}）`)
  }
  check('version', catalog.version)
  check('reviewedBy', catalog.reviewedBy)
  for (const [index, entry] of catalog.entries.entries()) {
    check(`entries[${index}].sourceId`, entry.sourceId)
    check(`entries[${index}].title`, entry.title)
  }
  return found
}

function main(argv = process.argv.slice(2)) {
  const target = argv[0] || process.env.SOURCE_CATALOG_PATH || ''
  if (!target) {
    process.stderr.write('用法：node scripts/validate-source-catalog.js <文件路径>\n')
    process.exitCode = 2
    return
  }
  const absolute = path.resolve(target)

  let raw
  try {
    raw = readFileSync(absolute, 'utf8')
  } catch (error) {
    process.stderr.write(`读不到文件：${absolute}\n${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
    return
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    process.stderr.write(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
    return
  }

  let validateSourceCatalog
  try {
    ({ validateSourceCatalog } = require(serverDist('domain', 'source-catalog.js')))
  } catch (error) {
    process.stderr.write(`找不到服务端编译产物，请先运行 npm run build:server\n${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
    return
  }

  let catalog
  try {
    catalog = validateSourceCatalog(parsed)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', file: absolute, reason: error instanceof Error ? error.message : String(error) }, null, 2)}\n`)
    process.exitCode = 1
    return
  }

  const placeholders = placeholdersIn(catalog)
  if (placeholders.length) {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', file: absolute, reason: '仍包含模板占位值，不能作为正式来源目录', placeholders }, null, 2)}\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    file: absolute,
    version: catalog.version,
    dataAsOf: catalog.dataAsOf,
    reviewedBy: catalog.reviewedBy,
    entries: catalog.entries.length
  }, null, 2)}\n`)
}

if (require.main === module) main()

module.exports = { main, placeholderMarkers, placeholdersIn }
