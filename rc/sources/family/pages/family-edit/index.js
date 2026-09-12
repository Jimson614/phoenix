const repository = require('../../services/repository')
const session = require('../../services/session')
const analytics = require('../../services/analytics')
const { navigateBackOrHome } = require('../../utils/navigation')

Page({
  data: {
    editing: false, saving: false,
    form: { family_name: '', parent_name: '', phone: '', location: '', goal: '' }
  },

  onLoad() {
    const user = session.guard(['family_user'])
    if (!user) return
    const family = repository.familyForUser(user.id)
    if (family) {
      this.setData({
        editing: true,
        form: {
          family_name: family.family_name || '', parent_name: family.parent_name || '',
          phone: family.phone || '', location: family.location || '', goal: family.goal || ''
        }
      })
    }
  },

  input({ currentTarget, detail }) {
    this.setData({ [`form.${currentTarget.dataset.field}`]: detail.value })
  },

  save() {
    if (this.data.saving) return
    const user = session.guard(['family_user'])
    if (!user) return
    const form = this.data.form
    if (!form.family_name.trim() || !form.parent_name.trim() || !form.phone.trim()) {
      return wx.showToast({ title: '请填写家庭称呼、家长姓名和电话', icon: 'none' })
    }
    this.setData({ saving: true })
    try {
      const family = repository.upsertFamily(user.id, form)
      analytics.track('family_profile_completed', { userId: user.id, familyId: family.id })
      wx.showToast({ title: '家庭档案已保存', icon: 'success' })
      if (this.data.editing) {
        setTimeout(navigateBackOrHome, 500)
      } else {
        setTimeout(() => wx.redirectTo({ url: `/pages/student-edit/index?familyId=${family.id}` }), 500)
      }
    } catch (error) {
      this.setData({ saving: false })
      wx.showToast({ title: '保存失败，请检查空间后重试', icon: 'none' })
    }
  }
})
