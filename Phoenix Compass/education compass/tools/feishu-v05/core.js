'use strict'

const {
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
  optionsFor
} = require('./schema')

/** 飞书本地运营 ID 一律 PN- 前缀；Core／Founder OS 的 canonical ID 不用这个前缀 */
const FEISHU_ID_PREFIX = 'PN-'

/** 每张链路表在 Integration_Links 里的实体语义与事实源系统（对齐母版 README 的 Source of Truth 列） */
const LINK_TARGETS = {
  Family_Student_View: [
    { sourceEntity: 'CLIENT_PROJECTION', targetSystem: 'PHOENIX_CORE', targetEntity: 'FAMILY', coreKey: 'familyId' },
    { sourceEntity: 'CLIENT_PROJECTION', targetSystem: 'PHOENIX_CORE', targetEntity: 'STUDENT', coreKey: 'studentId' }
  ],
  Deals: [{ sourceEntity: 'DEAL', targetSystem: 'PHOENIX_FOUNDER_OS', targetEntity: 'DEAL', coreKey: 'dealId' }],
  Contracts: [
    { sourceEntity: 'CONTRACT', targetSystem: 'PHOENIX_FOUNDER_OS', targetEntity: 'CONTRACT', coreKey: 'contractId' }
  ],
  Payments: [
    { sourceEntity: 'PAYMENT', targetSystem: 'PHOENIX_FOUNDER_OS', targetEntity: 'PAYMENT', coreKey: 'paymentId' }
  ],
  Service_Projects: [
    {
      sourceEntity: 'SERVICE_PROJECT',
      targetSystem: 'PHOENIX_FOUNDER_OS',
      targetEntity: 'SERVICE_PROJECT',
      coreKey: 'serviceProjectId'
    }
  ]
}

/**
 * Founder OS / Phoenix Core 侧的事实源。
 * 这些 canonical ID 只经 Integration_Links 关联，不当飞书主键用。
 */
function buildCoreFixture({ now, runTag }) {
  const iso = now.toISOString()
  const day = iso.slice(0, 10)
  const month = day.slice(0, 7).replace('-', '')
  const tag = runTag.slice(0, 8).toUpperCase()

  return {
    // Phoenix Core：身份事实
    familyId: `FAM-${tag}`,
    studentId: `STU-${tag}`,
    displayName: '最小链路验收学生',
    // Founder OS：经营事实
    clientRecordId: `CLI-${tag}`,
    dealId: `DEAL-${tag}`,
    contractId: `CONTRACT-${tag}`,
    paymentId: `PAY-${tag}`,
    serviceProjectId: `SP-${tag}`,
    // Contract Code 只由 Founder OS 签发
    contractCode: `PN-EDU-${month}-0001`,
    contractCodeIssuedBy: 'PHOENIX_FOUNDER_OS',
    productId: 'PN-PROD-ADM-001',
    templateId: 'TPL-HK-MASTER',
    owner: 'Katrina',
    sourceOwner: 'Founder',
    accountManager: 'Katrina',
    partnerId: 'PN-PARTNER-0001',
    legacyRecordId: 'LEGACY-CRM-000917',
    amount: 39900,
    currency: 'CNY',
    createdAt: iso,
    updatedAt: iso,
    startDate: day
  }
}

/** 去掉未发生事件的空字段；false 与 0 是有效值，必须保留 */
function compact(fields) {
  const out = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = value
  }
  return out
}

/** 飞书侧运营 ID */
function feishuId(kind, runTag) {
  return `${FEISHU_ID_PREFIX}${kind}-${runTag.slice(0, 8).toUpperCase()}`
}

/**
 * 按母版列名构造最小链路的 5 条飞书记录。
 * 正向外键在这里就填好，反向引用（Deals.Contract ID 等）留到写入后回填。
 */
function buildChainRecords({ core, runTag }) {
  const clientId = feishuId('CLI', runTag)
  const dealId = feishuId('DEAL', runTag)
  const paymentId = feishuId('PAY', runTag)
  const serviceProjectId = feishuId('SP', runTag)
  // Contract ID 与 Contract Code 都由 Founder OS 侧签发，飞书只引用
  const contractId = core.contractId

  const ids = {
    Family_Student_View: clientId,
    Deals: dealId,
    Contracts: contractId,
    Payments: paymentId,
    Service_Projects: serviceProjectId
  }

  const records = {
    Family_Student_View: compact({
      'Client ID': clientId,
      'Family ID': core.familyId,
      'Student ID': core.studentId,
      'Display Name': core.displayName,
      'Client Stage': 'ACTIVE',
      'Consent Status': 'GRANTED',
      'Entitlement Status': 'ACTIVE',
      Owner: core.owner,
      'Source Type': 'FOUNDER_DIRECT',
      'Source System': 'PHOENIX_FOUNDER_OS',
      'System Record ID': core.legacyRecordId,
      'Sync Status': 'SYNCED',
      'Last Synced At': core.updatedAt
    }),
    Deals: compact({
      'Deal ID': dealId,
      'Client ID': clientId,
      'Family ID': core.familyId,
      'Student ID': core.studentId,
      'Source Type': 'FOUNDER_DIRECT',
      'Source Owner': core.sourceOwner,
      'Account Manager': core.accountManager,
      'Product ID': core.productId,
      'Quoted Amount': core.amount,
      'Approved Amount': core.amount,
      Currency: core.currency,
      'Deal Status': 'SERVICE_ACTIVE',
      'Proposal Status': 'ACCEPTED',
      'Payment Status': 'VERIFIED',
      'Founder Review Required': false,
      'Created At': core.createdAt,
      'Updated At': core.updatedAt
    }),
    Contracts: compact({
      'Contract ID': contractId,
      'Contract Code': core.contractCode,
      'Deal ID': dealId,
      'Client ID': clientId,
      'Product ID': core.productId,
      'Template ID': core.templateId,
      Version: '1.0',
      'Contract Amount': core.amount,
      Currency: core.currency,
      'Contract Status': 'SIGNED',
      'Risk Gate': 'STANDARD_PASS',
      'Contract Owner': core.owner,
      'Signed At': core.updatedAt,
      'Payment Status': 'VERIFIED'
    }),
    Payments: compact({
      'Payment ID': paymentId,
      'Contract ID': contractId,
      'Deal ID': dealId,
      'Client ID': clientId,
      'Amount Due': core.amount,
      'Amount Received': core.amount,
      Currency: core.currency,
      'Payment Status': 'VERIFIED',
      'Received At': core.updatedAt,
      'Verified By': core.owner,
      'Verified At': core.updatedAt,
      'Refund Amount': 0,
      'Refund Status': 'NONE',
      'Service Activation Eligible': true
    }),
    Service_Projects: compact({
      'Service Project ID': serviceProjectId,
      'Deal ID': dealId,
      'Contract ID': contractId,
      'Client ID': clientId,
      'Family ID': core.familyId,
      'Student ID': core.studentId,
      'Product ID': core.productId,
      'Business Line': 'ADMISSION',
      'Project Type': 'ADMISSION',
      Status: 'ACTIVE',
      'Service Owner': core.owner,
      'Start Date': core.startDate,
      'Delivery Progress': 0,
      'Application Count': 0,
      'Refund Status': 'NONE'
    })
  }

  // 反向引用：写入顺序决定了这些列只能后补
  const backfills = BACKFILL_REFS.map((ref) => ({
    sheet: ref.from,
    field: ref.field,
    value: ids[ref.to]
  }))

  return { ids, records, backfills }
}

/** Integration_Links：跨系统唯一受控入口 */
function buildLinks({ core, ids, runTag }) {
  const tag = runTag.slice(0, 8).toUpperCase()
  const links = []
  let sequence = 1
  for (const sheet of CHAIN) {
    for (const target of LINK_TARGETS[sheet]) {
      links.push({
        sheet,
        fields: compact({
          'Integration Link ID': `${FEISHU_ID_PREFIX}LINK-${tag}-${String(sequence).padStart(2, '0')}`,
          'Source System': 'FEISHU',
          'Source Entity Type': target.sourceEntity,
          'Source Record ID': ids[sheet],
          'Target System': target.targetSystem,
          'Target Entity Type': target.targetEntity,
          'Target Record ID': core[target.coreKey],
          Status: 'ACTIVE',
          'Valid From': core.createdAt,
          'Created By': core.owner,
          'Created At': core.createdAt,
          'Last Verified At': core.updatedAt
        })
      })
      sequence += 1
    }
  }
  return links
}

function gate(id, title, pass, detail) {
  return { id, title, pass, detail }
}

/** 应用回填后的完整记录视图，用于引用完整性校验 */
function applyBackfills(records, backfills) {
  const merged = {}
  for (const [sheet, fields] of Object.entries(records)) merged[sheet] = { ...fields }
  for (const item of backfills) {
    if (item.value === undefined) continue
    merged[item.sheet][item.field] = item.value
  }
  return merged
}

/** V0.5 上线前 Gate：全部通过才允许写飞书 */
function runGates({ core, ids, records, backfills, links }) {
  const gates = []
  const settled = applyBackfills(records, backfills)

  // G1 删除/停用：三个字段在母版 11 张表中都不得存在
  const bannedHits = []
  for (const table of TABLES) {
    for (const field of table.fields) {
      if (BANNED_FIELDS.includes(field.name)) bannedHits.push(`${table.sheet}.${field.name}`)
    }
  }
  for (const [sheet, fields] of Object.entries(settled)) {
    for (const name of Object.keys(fields)) {
      if (BANNED_FIELDS.includes(name)) bannedHits.push(`写入:${sheet}.${name}`)
    }
  }
  gates.push(
    gate(
      'G1',
      '删除/停用字段未复活（Member ID / Grant ID / Service Order ID）',
      bannedHits.length === 0,
      bannedHits.length === 0
        ? `母版 ${TABLES.length} 张表与本次写入均未出现这三个字段`
        : `出现：${bannedHits.join('、')}`
    )
  )

  // G2 重定义：Client ID 是经营记录 ID，不是身份主键
  const view = settled.Family_Student_View
  const hasIdentityColumns = IDENTITY_FIELDS.every((name) => fieldNames('Family_Student_View').includes(name))
  const identityDistinct = IDENTITY_FIELDS.every((name) => view[name] && view[name] !== view[NON_IDENTITY_FIELD])
  const identityLeak = []
  for (const [sheet, fields] of Object.entries(settled)) {
    for (const name of IDENTITY_FIELDS) {
      if (fields[name] !== undefined && fields[name] === fields[NON_IDENTITY_FIELD]) {
        identityLeak.push(`${sheet}.${name}`)
      }
    }
  }
  const g2 = hasIdentityColumns && identityDistinct && identityLeak.length === 0
  gates.push(
    gate(
      'G2',
      'Client ID 仅作经营记录 ID，身份仍以 Family ID / Student ID 为准',
      g2,
      g2
        ? `Client ID=${view[NON_IDENTITY_FIELD]}，Family ID=${view['Family ID']}，Student ID=${view['Student ID']}，三者独立`
        : identityLeak.length
          ? `Client ID 被当身份键用：${identityLeak.join('、')}`
          : '缺少独立的 Family ID / Student ID 列'
    )
  )

  // G3 保留并分开：来源四字段各司其职
  const deal = settled.Deals
  const dealColumns = fieldNames('Deals')
  const missingSeparated = SEPARATED_SOURCE_FIELDS.filter((name) => !dealColumns.includes(name))
  const presentValues = SEPARATED_SOURCE_FIELDS.map((name) => deal[name]).filter((value) => value !== undefined)
  const separatedOk = missingSeparated.length === 0 && new Set(presentValues).size === presentValues.length
  gates.push(
    gate(
      'G3',
      '来源四字段分开维护（Source Type / Partner ID / Source Owner / Account Manager）',
      separatedOk,
      separatedOk
        ? `Deals 四列齐备，本次写入取值互不混用（${presentValues.join(' / ')}）`
        : missingSeparated.length
          ? `Deals 缺列：${missingSeparated.join('、')}`
          : '存在取值混用'
    )
  )

  // G4 保留原义：外部／遗留记录号没有被改名为 Partner ID
  const viewColumns = fieldNames('Family_Student_View')
  const externalOk =
    EXTERNAL_RECORD_FIELDS.every((name) => viewColumns.includes(name)) &&
    viewColumns.includes('Partner ID') &&
    view['System Record ID'] !== view['Partner ID']
  gates.push(
    gate(
      'G4',
      '外部／遗留记录号保留原义（System Record ID 与 Partner ID 是两列）',
      externalOk,
      externalOk
        ? `Source System=${view['Source System']}，System Record ID=${view['System Record ID']}，与 Partner ID 分离`
        : 'System Record ID 缺失或与 Partner ID 混同'
    )
  )

  // G5 限制写入：Contract Code 只读引用 Founder OS
  const contractCodeOk =
    settled.Contracts['Contract Code'] === core.contractCode &&
    core.contractCodeIssuedBy === 'PHOENIX_FOUNDER_OS' &&
    READ_ONLY_FIELDS.includes('Contract Code')
  gates.push(
    gate(
      'G5',
      'Contract Code 只读引用 Founder OS，飞书不生成不改号',
      contractCodeOk,
      contractCodeOk
        ? `Contract Code=${core.contractCode}，签发方=${core.contractCodeIssuedBy}，写入策略=create-only`
        : 'Contract Code 与 Founder OS 不一致或非 Founder OS 签发'
    )
  )

  // G6 服务主链统一走 Service Project ID
  const anyServiceOrder = TABLES.some((table) => table.fields.some((field) => field.name === 'Service Order ID'))
  const serviceOk = !anyServiceOrder && typeof settled.Service_Projects['Service Project ID'] === 'string'
  gates.push(
    gate(
      'G6',
      '服务主链统一用 Service Project ID，母版无 Service Order ID',
      serviceOk,
      serviceOk ? `Service Project ID=${settled.Service_Projects['Service Project ID']}` : '服务主键不符合 V0.5'
    )
  )

  // G7 跨系统只经 Integration_Links；飞书本地 PN- ID 不得出现在 Target Record ID
  const linkedSources = new Set(links.map((link) => link.fields['Source Record ID']))
  const missingLinks = CHAIN.filter((sheet) => !linkedSources.has(ids[sheet]))
  const inactive = links.filter((link) => link.fields.Status !== 'ACTIVE').map((link) => link.fields['Integration Link ID'])
  const canonicalLeak = links
    .filter((link) => String(link.fields['Target Record ID']).startsWith(FEISHU_ID_PREFIX))
    .map((link) => link.fields['Integration Link ID'])
  const g7 = missingLinks.length === 0 && inactive.length === 0 && canonicalLeak.length === 0
  gates.push(
    gate(
      'G7',
      '跨系统关联只经 Integration_Links，飞书 ID 未冒充 Core Canonical ID',
      g7,
      g7
        ? `${links.length} 条 ACTIVE 映射覆盖全部 ${CHAIN.length} 张链路表`
        : `缺映射：${missingLinks.join('、') || '无'}；非 ACTIVE：${inactive.join('、') || '无'}；Target 混入飞书 ID：${canonicalLeak.join('、') || '无'}`
    )
  )

  // G8 主链引用完整（正向 + 回填）
  const brokenRefs = []
  for (const ref of CHAIN_REFS.concat(BACKFILL_REFS)) {
    const actual = settled[ref.from][ref.field]
    const expected = settled[ref.to][ref.toField]
    if (actual !== expected) brokenRefs.push(`${ref.from}.${ref.field} -> ${ref.to}.${ref.toField}`)
  }
  gates.push(
    gate(
      'G8',
      '主链引用完整：Family/Student → Deal → Contract + Payment → ServiceProject',
      brokenRefs.length === 0,
      brokenRefs.length === 0
        ? `${CHAIN_REFS.length} 条正向引用 + ${BACKFILL_REFS.length} 条回填引用全部对齐`
        : `断链：${brokenRefs.join('、')}`
    )
  )

  // G9 下拉取值必须在母版白名单内
  const badOptions = []
  for (const [sheet, fields] of Object.entries(settled)) {
    for (const [name, value] of Object.entries(fields)) {
      const options = optionsFor(sheet, name)
      if (options && !options.includes(value)) badOptions.push(`${sheet}.${name}=${value}`)
    }
  }
  for (const link of links) {
    for (const [name, value] of Object.entries(link.fields)) {
      const options = optionsFor(LINKS_SHEET, name)
      if (options && !options.includes(value)) badOptions.push(`${LINKS_SHEET}.${name}=${value}`)
    }
  }
  gates.push(
    gate(
      'G9',
      '下拉取值全部在母版白名单内',
      badOptions.length === 0,
      badOptions.length === 0 ? '链路与映射表的所有单选列取值合法' : `越界：${badOptions.join('、')}`
    )
  )

  // G10 不得自造列：写入的列必须都在母版里
  const unknownColumns = []
  for (const [sheet, fields] of Object.entries(settled)) {
    const allowed = new Set(fieldNames(sheet))
    for (const name of Object.keys(fields)) {
      if (!allowed.has(name)) unknownColumns.push(`${sheet}.${name}`)
    }
  }
  const linkAllowed = new Set(fieldNames(LINKS_SHEET))
  for (const link of links) {
    for (const name of Object.keys(link.fields)) {
      if (!linkAllowed.has(name)) unknownColumns.push(`${LINKS_SHEET}.${name}`)
    }
  }
  gates.push(
    gate(
      'G10',
      '写入列全部来自 V0.5 Clean Master，未自造字段',
      unknownColumns.length === 0,
      unknownColumns.length === 0
        ? `对齐母版 ${TABLES.reduce((sum, table) => sum + table.fields.length, 0)} 个字段定义`
        : `母版中不存在：${unknownColumns.join('、')}`
    )
  )

  return gates
}

module.exports = {
  FEISHU_ID_PREFIX,
  buildCoreFixture,
  buildChainRecords,
  buildLinks,
  applyBackfills,
  runGates,
  tableBySheet
}
