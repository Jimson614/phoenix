const repository = require('../../services/repository')
const session = require('../../services/session')
const { dateLabel } = require('../../utils/date')

const EVENT_META = {
  family_created: { label: '家庭档案', icon: '家' }, student_created: { label: '孩子档案', icon: '子' },
  compass_completed: { label: 'Education Compass', icon: '罗' }, report_generated: { label: 'AI 成长洞察', icon: '析' },
  advisor_contact: { label: '顾问联系', icon: '联' }, advisor_note: { label: '重要记录', icon: '记' },
  partner_plan_saved: { label: '联合成长计划', icon: '艺' }, partner_exploration: { label: '音乐探索', icon: '音' },
  partner_application: { label: '联合体验', icon: '创' }
}

Page({
  data: { family: null, events: [] },
  onShow() { this.load() },
  onPullDownRefresh() { this.load(); wx.stopPullDownRefresh() },
  load() {
    const user = session.guard(['family_user'])
    if (!user) return
    const family = repository.familyForUser(user.id)
    const events = family ? repository.eventsForFamily(family.id).map((event) => ({
      ...event, dateLabel: dateLabel(event.date), meta: EVENT_META[event.event_type] || { label: '家庭记录', icon: '·' }
    })) : []
    this.setData({ family, events })
  },
  goHome() { wx.switchTab({ url: '/pages/home/index' }) }
})
