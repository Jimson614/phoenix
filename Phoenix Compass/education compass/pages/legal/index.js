const { getDoc } = require('../../config/legal-text')

const META = {
  'terms': { navTitle: '用户协议' },
  'ai-report': { navTitle: 'AI 报告声明' },
  'guardian-consent': { navTitle: '监护人同意文本' }
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
    this.setData({
      type: type,
      title: doc.title,
      notes: doc.notes || [],
      blocks: doc.blocks || []
    })
  },

  onShareAppMessage() {
    return { title: this.data.title || 'Phoenix Family OS 法务文本' }
  }
})
