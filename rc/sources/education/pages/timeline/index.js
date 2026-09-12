const familyData = require('../../services/family-data')
const session = require('../../services/session')
const { dateLabel } = require('../../utils/date')

const EVENT_META = {
  family_created: { label: '家庭档案', icon: '家' }, student_created: { label: '孩子档案', icon: '子' },
  compass_completed: { label: 'Education Compass', icon: '罗' }, report_generated: { label: 'AI 成长洞察', icon: '析' },
  report_preview_ready: { label: '报告预览', icon: '览' }, order_paid: { label: '支付记录', icon: '付' }, report_unlocked: { label: '完整报告', icon: '解' },
  advisor_contact: { label: '顾问联系', icon: '联' }, advisor_note: { label: '重要记录', icon: '记' }
}

Page({
  data: { family: null, events: [], loading: true, error: '' },
  onShow() { this.load() },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh() },
  async load() {
    const user = session.guard(['family_user'])
    if (!user) return
    this.setData({ loading: true, error: '' })
    try {
      const family = await familyData.getFamily(user.id)
      const events = family ? (await familyData.getTimeline(family.id)).map((event) => {
        const eventType = String(event.event_type || '').toLowerCase()
        return { ...event, event_type: eventType, dateLabel: dateLabel(event.date), meta: EVENT_META[eventType] || { label: '家庭记录', icon: '·' } }
      }) : []
      this.setData({ family, events })
    } catch (error) { this.setData({ error: error.message || '时间线加载失败' }) }
    finally { this.setData({ loading: false }) }
  },
  goHome() { wx.switchTab({ url: '/pages/home/index' }) }
})
