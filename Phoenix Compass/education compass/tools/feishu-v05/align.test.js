'use strict'

/**
 * 用预检实际看到的远端状态，验证对齐计划算得对。
 * 运行：node --test tools/feishu-v05/align.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { T, tableBySheet } = require('./schema')
const { planForTable, normalizeName } = require('./align-tables')

/** 按母版造一份远端字段，再把指定列改成建表时的错误状态 */
function remoteLike(sheet, { asText = [], renamed = {} } = {}) {
  return tableBySheet(sheet).fields.map((field, index) => ({
    id: `fld${index}`,
    name: renamed[field.name] ?? field.name,
    type: asText.includes(field.name) ? T.TEXT : field.type,
    isPrimary: index === 0
  }))
}

test('分隔符差异会被认成同一列', () => {
  assert.equal(normalizeName('Final PDF | Link'), normalizeName('Final PDF / Link'))
  assert.equal(normalizeName('Receipt  |  Evidence'), normalizeName('Receipt / Evidence'))
  assert.notEqual(normalizeName('Deal ID'), normalizeName('Client ID'))
})

test('Payments：6 个类型错 + 1 个列名错，算出 7 步', () => {
  const remote = remoteLike('Payments', {
    asText: [
      'Amount Due',
      'Amount Received',
      'Payment Status',
      'Refund Amount',
      'Refund Status',
      'Service Activation Eligible'
    ],
    renamed: { 'Receipt / Evidence': 'Receipt | Evidence' }
  })
  const plan = planForTable('Payments', remote)

  assert.deepEqual(plan.extra, [])
  assert.equal(plan.steps.length, 7)

  const rename = plan.steps.find((step) => step.rename)
  assert.equal(rename.from, 'Receipt | Evidence')
  assert.equal(rename.to, 'Receipt / Evidence')
  assert.equal(rename.retype, false, '只改名的列不应顺带改类型')

  const status = plan.steps.find((step) => step.to === 'Payment Status')
  assert.equal(status.toType, T.SELECT)
  assert.deepEqual(status.options, tableBySheet('Payments').fields.find((f) => f.name === 'Payment Status').options)

  const eligible = plan.steps.find((step) => step.to === 'Service Activation Eligible')
  assert.equal(eligible.toType, T.CHECKBOX)
  assert.equal(eligible.options, null)

  const amount = plan.steps.find((step) => step.to === 'Amount Due')
  assert.equal(amount.toType, T.NUMBER)
})

test('Deals：5 个类型错、列名全对，算出 5 步且都不改名', () => {
  const remote = remoteLike('Deals', {
    asText: ['Source Type', 'Deal Status', 'Proposal Status', 'Payment Status', 'Founder Review Required']
  })
  const plan = planForTable('Deals', remote)
  assert.equal(plan.steps.length, 5)
  assert.equal(
    plan.steps.every((step) => step.rename === false),
    true
  )
})

test('已经对齐的表算出 0 步', () => {
  const plan = planForTable('Service_Projects', remoteLike('Service_Projects'))
  assert.deepEqual(plan.steps, [])
  assert.deepEqual(plan.extra, [])
})

test('远端真的少一列时算成新增，不会误认到别的列上', () => {
  const remote = remoteLike('Contracts').filter((field) => field.name !== 'Risk Gate')
  const plan = planForTable('Contracts', remote)
  assert.equal(plan.steps.length, 1)
  const [step] = plan.steps
  assert.equal(step.kind, 'add-field')
  assert.equal(step.to, 'Risk Gate')
  assert.deepEqual(step.options, tableBySheet('Contracts').fields.find((f) => f.name === 'Risk Gate').options)
})

test('Base 里没有这张表时整张新建', () => {
  const plan = planForTable('Deliveries', null)
  assert.equal(plan.missingTable, true)
  assert.equal(plan.steps.length, 1)
  assert.equal(plan.steps[0].kind, 'create-table')
  assert.equal(plan.steps[0].fieldCount, tableBySheet('Deliveries').fields.length)
})

test('母版之外的远端列只报告，不产生改动', () => {
  const remote = remoteLike('Payments').concat([{ id: 'fldX', name: 'Business Basis Key', type: 1, isPrimary: false }])
  const plan = planForTable('Payments', remote)
  assert.deepEqual(plan.steps, [])
  assert.deepEqual(plan.extra, ['Business Basis Key'])
})
