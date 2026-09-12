const familyData = require('../../services/family-data')
const session = require('../../services/session')
const analytics = require('../../services/analytics')

Page({
  data: {
    editing: false, loading: true, saving: false,
    form: { family_name: '', parent_name: '', phone: '', location: '', goal: '' }
  },

  async onLoad() {
    const user = session.guard(['family_user'])
    if (!user) return
    try {
      const family = await familyData.getFamily(user.id)
      if (family) {
        this.setData({
          editing: true, familyId: family.id,
          form: {
            family_name: family.family_name || '', parent_name: family.parent_name || '',
            phone: family.phone || '', location: family.location || '', goal: family.goal || ''
          }
        })
      }
    } catch (error) { wx.showToast({ title: error.message || '家庭档案加载失败', icon: 'none' }) }
    finally { this.setData({ loading: false }) }
  },

  input({ currentTarget, detail }) {
    this.setData({ [`form.${currentTarget.dataset.field}`]: detail.value })
  },

  async save() {
    if (this.data.saving) return
    const user = session.currentUser()
    const form = this.data.form
    if (!form.family_name.trim() || !form.parent_name.trim() || !form.phone.trim()) {
      return wx.showToast({ title: '请填写家庭称呼、家长姓名和电话', icon: 'none' })
    }
    this.setData({ saving: true })
    try {
      const family = await familyData.saveFamily(user.id, form, this.data.familyId)
      analytics.track('family_profile_completed', { userId: user.id, familyId: family.id })
      wx.showToast({ title: '家庭档案已保存', icon: 'success' })
      if (this.data.editing) setTimeout(() => wx.navigateBack(), 500)
      else setTimeout(() => wx.redirectTo({ url: `/pages/student-edit/index?familyId=${family.id}` }), 500)
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' })
      this.setData({ saving: false })
    }
  }
})
