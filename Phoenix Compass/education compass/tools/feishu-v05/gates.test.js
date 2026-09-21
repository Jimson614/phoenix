'use strict'

/**
 * 反向测试：逐条注入 V0.5 违规，确认对应 Gate 会拦截。
 * 运行：node --test tools/feishu-v05/gates.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { TABLES, CHAIN, tableBySheet } = require('./schema')
const { buildCoreFixture, buildChainRecords, buildLinks, runGates } = require('./core')

function baseline() {
  const now = new Date('2026-09-20T00:00:00.000Z')
  const runTag = 'deadbeefcafe1234'
  const core = buildCoreFixture({ now, runTag })
  const { ids, records, backfills } = buildChainRecords({ core, runTag })
  const links = buildLinks({ core, ids, runTag })
  return { core, ids, records, backfills, links }
}

function gateById(gates, id) {
  const found = gates.find((item) => item.id === id)
  assert.ok(found, `缺少 Gate ${id}`)
  return found
}

test('母版合同读取正确：主字段即首列，链路表齐备', () => {
  // 不锁表数 —— 母版会随业务增表；锁的是结构性约定
  assert.ok(TABLES.length >= CHAIN.length + 1, '至少要有链路表加映射表')
  for (const table of TABLES) {
    assert.equal(table.fields[0].name, table.unique, `${table.sheet} 的主字段应是首列`)
    assert.equal(table.fields[0].primary, true)
    assert.ok(table.fields.length > 0)
  }
  for (const sheet of CHAIN) {
    assert.ok(
      TABLES.some((table) => table.sheet === sheet),
      `母版缺链路表 ${sheet}`
    )
  }
})

test('基线：干净的最小链路 10 条 Gate 全部通过', () => {
  const gates = runGates(baseline())
  assert.equal(gates.length, 10)
  assert.deepEqual(
    gates.filter((item) => !item.pass).map((item) => item.id),
    []
  )
})

const cases = [
  {
    gate: 'G1',
    title: '复活 Service Order ID 会被 G1 拦截',
    mutate: ({ records }) => {
      records.Service_Projects['Service Order ID'] = 'SO-0001'
    }
  },
  {
    gate: 'G2',
    title: '拿 Client ID 当 Family ID 用会被 G2 拦截',
    mutate: ({ records }) => {
      records.Family_Student_View['Family ID'] = records.Family_Student_View['Client ID']
    }
  },
  {
    gate: 'G3',
    title: 'Source Owner 与 Account Manager 混成同一个值会被 G3 拦截',
    mutate: ({ records }) => {
      records.Deals['Source Owner'] = records.Deals['Account Manager']
    }
  },
  {
    gate: 'G4',
    title: 'System Record ID 被当成 Partner ID 会被 G4 拦截',
    mutate: ({ records }) => {
      records.Family_Student_View['Partner ID'] = records.Family_Student_View['System Record ID']
    }
  },
  {
    gate: 'G5',
    title: '飞书自行改号 Contract Code 会被 G5 拦截',
    mutate: ({ records }) => {
      records.Contracts['Contract Code'] = 'FEISHU-SELF-0001'
    }
  },
  {
    gate: 'G7',
    title: '缺少 Integration_Links 映射会被 G7 拦截',
    mutate: ({ links }) => {
      const index = links.findIndex((link) => link.fields['Source Entity Type'] === 'PAYMENT')
      links.splice(index, 1)
    }
  },
  {
    gate: 'G7',
    title: '把飞书本地 ID 写进 Target Record ID 会被 G7 拦截',
    mutate: ({ ids, links }) => {
      const link = links.find((item) => item.fields['Source Entity Type'] === 'DEAL')
      link.fields['Target Record ID'] = ids.Deals
    }
  },
  {
    gate: 'G7',
    title: '把飞书当成事实源会被 G7 拦截',
    mutate: ({ links }) => {
      links.find((item) => item.fields['Source Entity Type'] === 'CONTRACT').fields['Source of Truth'] = 'FEISHU'
    }
  },
  {
    gate: 'G8',
    title: '主链断链会被 G8 拦截',
    mutate: ({ records }) => {
      records.Payments['Contract ID'] = 'CONTRACT-WRONG'
    }
  },
  {
    gate: 'G8',
    title: '反向引用没回填会被 G8 拦截',
    mutate: (fixture) => {
      fixture.backfills = fixture.backfills.filter((item) => item.field !== 'Primary Deal ID')
    }
  },
  {
    gate: 'G9',
    title: '下拉白名单外的状态会被 G9 拦截',
    mutate: ({ records }) => {
      records.Deals['Deal Status'] = 'WON'
    }
  },
  {
    gate: 'G10',
    title: '自造母版之外的列会被 G10 拦截',
    mutate: ({ records }) => {
      records.Contracts['Grant ID'] = 'GRANT-0001'
    }
  }
]

for (const item of cases) {
  test(item.title, () => {
    const fixture = baseline()
    item.mutate(fixture)
    const gates = runGates(fixture)
    assert.equal(gateById(gates, item.gate).pass, false, `${item.gate} 应当拦截该违规`)
  })
}

test('G6 依赖母版本身：母版一旦出现 Service Order ID 就失败', () => {
  const fixture = baseline()
  const table = tableBySheet('Service_Projects')
  table.fields.push({ name: 'Service Order ID', column: 'ZZ', type: 1, primary: false })
  try {
    assert.equal(gateById(runGates(fixture), 'G6').pass, false)
  } finally {
    table.fields.pop()
  }
})

test('链路写入的每一列都在母版里，且下拉值合法', () => {
  const { records } = baseline()
  for (const sheet of CHAIN) {
    const allowed = new Map(tableBySheet(sheet).fields.map((field) => [field.name, field]))
    for (const [name, value] of Object.entries(records[sheet])) {
      const field = allowed.get(name)
      assert.ok(field, `${sheet}.${name} 不在母版中`)
      if (Array.isArray(field.options)) {
        assert.ok(field.options.includes(value), `${sheet}.${name}=${value} 不在白名单`)
      }
      if (field.type === 2) assert.equal(typeof value, 'number', `${sheet}.${name} 应为数字`)
      if (field.type === 7) assert.equal(typeof value, 'boolean', `${sheet}.${name} 应为复选框`)
    }
  }
})
