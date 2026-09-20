'use strict'

/**
 * V0.5 飞书建表合同 —— 唯一基线是 Phoenix_Feishu_Operating_Model_V0.5_Clean_Master.xlsx。
 *
 * 表名、列名、列序、下拉白名单全部来自母版（由 extract-master.py 抽成
 * master-contract.json）。本文件只额外声明三件母版里用文字写、代码要执行的东西：
 *   1. 最小链路是哪几张表、按什么顺序写；
 *   2. 表与表之间的引用关系（含需要回填的反向引用）；
 *   3. V0.5 字段调整的红线常量。
 */

const fs = require('node:fs')
const path = require('node:path')

const CONTRACT_PATH = path.join(__dirname, 'master-contract.json')

if (!fs.existsSync(CONTRACT_PATH)) {
  throw new Error('缺少 master-contract.json，先运行：python tools/feishu-v05/extract-master.py')
}

const MASTER = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'))

/** 飞书多维表格字段类型 */
const T = { TEXT: 1, NUMBER: 2, SELECT: 3, CHECKBOX: 7 }

/** 母版 11 张表 */
const TABLES = MASTER.tables

/** V0.5 删除/停用：这三个字段不得在任何一张表里出现 */
const BANNED_FIELDS = ['Member ID', 'Grant ID', 'Service Order ID']

/** V0.5 重定义：client_id 只是 Founder OS 经营记录 ID，不是身份主键 */
const IDENTITY_FIELDS = ['Family ID', 'Student ID']
const NON_IDENTITY_FIELD = 'Client ID'

/** V0.5 保留并分开：四个来源字段各自独立，不得混用 */
const SEPARATED_SOURCE_FIELDS = ['Source Type', 'Partner ID', 'Source Owner', 'Account Manager']

/** V0.5 保留原义：外部／遗留系统记录号 */
const EXTERNAL_RECORD_FIELDS = ['Source System', 'System Record ID']

/** V0.5 限制写入：只读引用 Founder OS 生成的编号 */
const READ_ONLY_FIELDS = ['Contract Code']

/** 最小链路：Family/Student → Deal → Contract + Payment → ServiceProject */
const CHAIN = ['Family_Student_View', 'Deals', 'Contracts', 'Payments', 'Service_Projects']

/** 映射表，链路之外单独写 */
const LINKS_SHEET = 'Integration_Links'

/**
 * 正向引用：写入时就能填的外键（子表 -> 父表的主键值）。
 * field 是子表列名，to/toField 指向父表及其列。
 */
const CHAIN_REFS = [
  { from: 'Deals', field: 'Client ID', to: 'Family_Student_View', toField: 'Client ID' },
  { from: 'Deals', field: 'Family ID', to: 'Family_Student_View', toField: 'Family ID' },
  { from: 'Deals', field: 'Student ID', to: 'Family_Student_View', toField: 'Student ID' },
  { from: 'Contracts', field: 'Deal ID', to: 'Deals', toField: 'Deal ID' },
  { from: 'Contracts', field: 'Client ID', to: 'Family_Student_View', toField: 'Client ID' },
  { from: 'Payments', field: 'Contract ID', to: 'Contracts', toField: 'Contract ID' },
  { from: 'Payments', field: 'Deal ID', to: 'Deals', toField: 'Deal ID' },
  { from: 'Payments', field: 'Client ID', to: 'Family_Student_View', toField: 'Client ID' },
  { from: 'Service_Projects', field: 'Deal ID', to: 'Deals', toField: 'Deal ID' },
  { from: 'Service_Projects', field: 'Contract ID', to: 'Contracts', toField: 'Contract ID' },
  { from: 'Service_Projects', field: 'Client ID', to: 'Family_Student_View', toField: 'Client ID' },
  { from: 'Service_Projects', field: 'Family ID', to: 'Family_Student_View', toField: 'Family ID' },
  { from: 'Service_Projects', field: 'Student ID', to: 'Family_Student_View', toField: 'Student ID' }
]

/**
 * 反向引用：父表上指向后建记录的列，必须等子表写完再回填。
 * 这是母版里 Deals.Contract ID、Family_Student_View.Primary Deal ID 这类列。
 */
const BACKFILL_REFS = [
  { from: 'Deals', field: 'Contract ID', to: 'Contracts', toField: 'Contract ID' },
  { from: 'Deals', field: 'Service Project ID', to: 'Service_Projects', toField: 'Service Project ID' },
  { from: 'Family_Student_View', field: 'Primary Deal ID', to: 'Deals', toField: 'Deal ID' },
  {
    from: 'Family_Student_View',
    field: 'Service Project ID',
    to: 'Service_Projects',
    toField: 'Service Project ID'
  }
]

function tableBySheet(sheet) {
  const table = TABLES.find((item) => item.sheet === sheet)
  if (!table) throw new Error(`母版中没有表 ${sheet}`)
  return table
}

function fieldNames(sheet) {
  return tableBySheet(sheet).fields.map((field) => field.name)
}

function fieldByName(sheet, name) {
  return tableBySheet(sheet).fields.find((field) => field.name === name) || null
}

/** 某列的下拉白名单，没有下拉则返回 null */
function optionsFor(sheet, name) {
  const field = fieldByName(sheet, name)
  return field && Array.isArray(field.options) ? field.options : null
}

module.exports = {
  MASTER,
  T,
  TABLES,
  CHAIN,
  LINKS_SHEET,
  CHAIN_REFS,
  BACKFILL_REFS,
  BANNED_FIELDS,
  IDENTITY_FIELDS,
  NON_IDENTITY_FIELD,
  SEPARATED_SOURCE_FIELDS,
  EXTERNAL_RECORD_FIELDS,
  READ_ONLY_FIELDS,
  tableBySheet,
  fieldNames,
  fieldByName,
  optionsFor
}
