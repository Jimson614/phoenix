const { getDoc } = require('../../config/legal-text')

const META = {
  'terms': { navTitle: '用户协议' },
  'ai-report': { navTitle: 'AI 报告声明' },
  'guardian-consent': { navTitle: '监护人同意文本' }
}

const NAME_PLACEHOLDER = '孩子姓名'

// 只在监护人同意文本里把占位替换成当前孩子姓名。每次进入都生成副本，
// 不改动 config/legal-text.js 的原文，避免把某个孩子的姓名固化到全局文案。
function childNameFrom(options) {
  const raw = options && options.name
  if (!raw) return ''
  let value = String(raw)
  try { value = decodeURIComponent(value) } catch (error) {}
  return value.trim().slice(0, 20)
}

function withChildName(blocks, name) {
  if (!name) return blocks
  const runs = (list) => (list || []).map((run) => (
    run && run.var && run.text === NAME_PLACEHOLDER ? { ...run, text: name, var: false } : run
  ))
  return (blocks || []).map((block) => {
    if (!block) return block
    if (block.t === 'p') return { ...block, runs: runs(block.runs) }
    if (block.t === 'ol' || block.t === 'ul') {
      return { ...block, items: (block.items || []).map((item) => runs(item)) }
    }
    return block
  })
}

Page({
  data: {
    type: 'terms',
    title: '',
    notes: [],
    blocks: []
  },

  onLoad(options) {
    const type = (options && options.type) || 'terms'
    const doc = getDoc(type)
    if (!doc) {
      wx.showModal({ title: '内容未找到', content: '该法务文本暂不可用，请稍后重试。', showCancel: false })
      return
    }
    const meta = META[type] || {}
    wx.setNavigationBarTitle({ title: meta.navTitle || doc.title || '法务文本' })
    const name = type === 'guardian-consent' ? childNameFrom(options) : ''
    this.setData({
      type: type,
      title: doc.title,
      notes: doc.notes || [],
      blocks: withChildName(doc.blocks || [], name)
    })
  },

  onShareAppMessage() {
    return { title: this.data.title || 'Phoenix Family OS 法务文本' }
  }
})
