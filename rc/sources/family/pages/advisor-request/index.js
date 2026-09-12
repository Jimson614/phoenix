const repository = require('../../services/repository')
const session = require('../../services/session')
const { isoNow } = require('../../utils/date')
const analytics = require('../../services/analytics')

Page({
  data: {
    family: null, submitted: false, submitting: false,
    topics: ['请选择', '解读 Education Compass 报告', '梳理教育方向', '讨论当前家庭挑战', '其他'], topicIndex: 0,
    times: ['请选择', '工作日上午', '工作日下午', '工作日晚上', '周末', '时间均可'], timeIndex: 0,
    form: { topic: '', preferred_time: '', note: '' }
  },
  onLoad() {
    const user = session.guard(['family_user'])
    if (!user) return
    const family = repository.familyForUser(user.id)
    if (!family) return wx.redirectTo({ url: '/pages/family-edit/index' })
    this.setData({ family })
  },
  pickTopic({ detail }) { const i = Number(detail.value); this.setData({ topicIndex: i, 'form.topic': i ? this.data.topics[i] : '' }) },
  pickTime({ detail }) { const i = Number(detail.value); this.setData({ timeIndex: i, 'form.preferred_time': i ? this.data.times[i] : '' }) },
  input({ detail }) { this.setData({ 'form.note': detail.value }) },
  submit() {
    if (this.data.submitting) return
    if (!this.data.form.topic || !this.data.form.preferred_time) return wx.showToast({ title: '请选择沟通主题和时间', icon: 'none' })
    const user = session.guard(['family_user'])
    if (!user) return
    const family = repository.familyForUser(user.id)
    if (!family || !this.data.family || family.id !== this.data.family.id) return wx.reLaunch({ url: '/pages/home/index' })
    this.setData({ submitting: true })
    try {
      repository.insert('advisorRequests', {
        family_id: family.id, user_id: user.id, topic: this.data.form.topic,
        preferred_time: this.data.form.preferred_time, note: this.data.form.note, status: 'requested', created_at: isoNow()
      })
      repository.addTimeline(family.id, 'advisor_contact', `已申请顾问沟通：${this.data.form.topic}`)
      analytics.track('advisor_contact_requested', { userId: user.id, familyId: family.id, properties: { topic: this.data.form.topic } })
      this.setData({ submitted: true, submitting: false })
    } catch (error) {
      this.setData({ submitting: false })
      wx.showToast({ title: '提交失败，请稍后重试', icon: 'none' })
    }
  },
  done() { wx.navigateBack() }
})
