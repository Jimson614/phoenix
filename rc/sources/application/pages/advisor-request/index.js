const familyData = require('../../services/family-data')
const session = require('../../services/session')
const analytics = require('../../services/analytics')

Page({
  data: {
    family: null, submitted: false, submitting: false, loading: true, reportId: '', studentId: '', supportsNote: true,
    intent: 'GENERAL_ADVISOR', heroTitle: '让洞察变成一次\n有温度的讨论。',
    heroCopy: 'Phoenix 顾问会结合已授权的家庭档案与最近报告进行准备，无需重复讲述已经记录的信息。',
    submitLabel: '申请顾问联系', submittedCopy: '顾问会结合你的家庭档案与成长报告进行准备。该节点也已保存到家庭时间线。',
    consentConfirmed: false,
    topics: ['请选择', '解读 Education Compass 报告', '了解深度评估 / 预约顾问', '梳理教育方向', '讨论当前家庭挑战', '其他'], topicIndex: 0,
    times: ['请选择', '工作日上午', '工作日下午', '工作日晚上', '周末', '时间均可'], timeIndex: 0,
    form: { topic: '', preferred_time: '', note: '' }
  },
  async onLoad(options) {
    const user = session.guard(['family_user'])
    if (!user) return
    try {
      const family = await familyData.getFamily(user.id)
      if (!family) return wx.redirectTo({ url: '/pages/family-edit/index' })
      const fromReport = !!options.reportId
      const intent = options.intent === 'DEEP_ASSESSMENT' ? 'DEEP_ASSESSMENT' : 'GENERAL_ADVISOR'
      const deepAssessment = intent === 'DEEP_ASSESSMENT'
      const topicIndex = deepAssessment ? 2 : (fromReport ? 1 : 0)
      this.setData({
        family, reportId: options.reportId || '', studentId: options.studentId || '',
        intent,
        topicIndex,
        'form.topic': topicIndex ? this.data.topics[topicIndex] : '',
        heroTitle: deepAssessment ? '一起看清，\n是否需要更深一步。' : this.data.heroTitle,
        heroCopy: deepAssessment
          ? '本入口只记录了解或预约深度评估的意向，不创建商品、订单或自动预约；顾问联系仍需你的独立授权。'
          : this.data.heroCopy,
        submitLabel: deepAssessment ? '提交深度评估咨询意向' : '申请顾问联系',
        submittedCopy: deepAssessment
          ? '深度评估咨询意向已记录。顾问会在独立授权范围内准备联系；当前没有创建任何订单。'
          : this.data.submittedCopy
      })
    } catch (error) { wx.showToast({ title: error.message || '联系服务加载失败', icon: 'none' }) }
    finally { this.setData({ loading: false }) }
  },
  pickTopic({ detail }) { const i = Number(detail.value); this.setData({ topicIndex: i, 'form.topic': i ? this.data.topics[i] : '' }) },
  pickTime({ detail }) { const i = Number(detail.value); this.setData({ timeIndex: i, 'form.preferred_time': i ? this.data.times[i] : '' }) },
  input({ detail }) { this.setData({ 'form.note': detail.value }) },
  toggleConsent({ detail }) { this.setData({ consentConfirmed: Array.isArray(detail.value) && detail.value.includes('confirmed') }) },
  async submit() {
    if (this.data.submitting) return
    if (!this.data.form.topic || !this.data.form.preferred_time) return wx.showToast({ title: '请选择沟通主题和时间', icon: 'none' })
    if (!this.data.consentConfirmed) return wx.showToast({ title: '请先确认顾问联系专项同意', icon: 'none' })
    const user = session.currentUser()
    this.setData({ submitting: true })
    try {
      await familyData.createAdvisorRequest(this.data.family, user, this.data.form, {
        reportId: this.data.reportId, studentId: this.data.studentId, intent: this.data.intent
      })
      analytics.track('advisor_contact_requested', {
        userId: user.id,
        familyId: this.data.family.id,
        properties: { topic: this.data.form.topic, report_id: this.data.reportId, intent: this.data.intent }
      })
      this.setData({ submitted: true })
    } catch (error) { wx.showToast({ title: error.message || '申请提交失败', icon: 'none' }) }
    finally { this.setData({ submitting: false }) }
  },
  done() { wx.navigateBack() }
})
