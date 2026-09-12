const repository = require('../../../services/repository')
const partnerService = require('../../../services/partner-experience')
const analytics = require('../../../services/analytics')
const { getPartnerExperience } = require('../../../data/partner-experiences')

Page({
  data: {
    experience: getPartnerExperience('yuanchao'),
    ageStages: ['请选择', '4–6 岁', '7–9 岁', '10–12 岁', '13–15 岁', '16–18 岁'],
    ageIndex: 0,
    directions: ['请选择', '声音与演唱表达', '节奏与身体表达', '器乐与旋律探索', '故事、作词与原创表达', '潮州文化与音乐表达', '暂未确定，希望共同发现'],
    directionIndex: 0,
    form: { child_name: '', age_stage: '', parent_name: '', contact: '', music_interest: '', preferred_direction: '', privacy_consent: false },
    submitted: false,
    submitting: false
  },

  onLoad() {
    const app = getApp()
    const user = app && app.getCurrentUser ? app.getCurrentUser() : null
    const family = user ? repository.familyForUser(user.id) : null
    const student = family ? repository.studentsForFamily(family.id)[0] : null
    if (family || student) {
      this.setData({
        'form.child_name': student ? student.name : '',
        'form.parent_name': family ? family.parent_name : '',
        'form.contact': family ? family.phone : '',
        'form.music_interest': student ? student.interest : ''
      })
    }
  },

  input({ currentTarget, detail }) { this.setData({ [`form.${currentTarget.dataset.field}`]: detail.value }) },
  pickAge({ detail }) { const index = Number(detail.value); this.setData({ ageIndex: index, 'form.age_stage': index ? this.data.ageStages[index] : '' }) },
  pickDirection({ detail }) { const index = Number(detail.value); this.setData({ directionIndex: index, 'form.preferred_direction': index ? this.data.directions[index] : '' }) },
  toggleConsent() { this.setData({ 'form.privacy_consent': !this.data.form.privacy_consent }) },

  submit() {
    if (this.data.submitting) return
    const form = this.data.form
    if (!form.child_name.trim() || !form.age_stage || !form.parent_name.trim() || !form.contact.trim() || !form.music_interest.trim() || !form.preferred_direction) {
      return wx.showToast({ title: '请完整填写申请信息', icon: 'none' })
    }
    if (!form.privacy_consent) return wx.showToast({ title: '请先确认隐私授权', icon: 'none' })
    this.setData({ submitting: true })
    const app = getApp()
    const user = app && app.getCurrentUser ? app.getCurrentUser() : null
    const family = user ? repository.familyForUser(user.id) : null
    partnerService.submitApplication({
      family_id: family ? family.id : '', user_id: user ? user.id : '',
      partner_experience_id: this.data.experience.id, ...form
    })
    analytics.track('partner_experience_requested', {
      userId: user ? user.id : '', familyId: family ? family.id : '', properties: { partner: 'yuanchao', direction: form.preferred_direction }
    })
    this.setData({ submitted: true, submitting: false })
  },

  done() { wx.switchTab({ url: '/pages/home/index' }) }
})
