const repository = require('../../services/repository')
const session = require('../../services/session')
const analytics = require('../../services/analytics')
const { navigateBackOrHome } = require('../../utils/navigation')

Page({
  data: {
    familyId: '', studentId: '', editing: false, saving: false,
    genders: ['请选择', '男', '女', '不便说明'], genderIndex: 0,
    systems: ['请选择', '内地课程', 'DSE', 'IB', 'A-Level', 'AP / 美式课程', '其他'], systemIndex: 0,
    form: { name: '', age: '', gender: '', school: '', education_system: '', grade: '', interest: '', goal: '' }
  },

  onLoad(options) {
    const user = session.guard(['family_user'])
    if (!user) return
    const family = repository.familyForUser(user.id)
    if (!family) return wx.redirectTo({ url: '/pages/family-edit/index' })
    const student = options.id ? repository.getById('students', options.id) : null
    if (options.id && !student) {
      wx.showToast({ title: '孩子档案不存在', icon: 'none' })
      return navigateBackOrHome()
    }
    if (student && student.family_id !== family.id) return navigateBackOrHome()
    if (student) {
      this.setData({
        familyId: family.id, studentId: student.id, editing: true, form: { ...student },
        genderIndex: Math.max(0, this.data.genders.indexOf(student.gender)),
        systemIndex: Math.max(0, this.data.systems.indexOf(student.education_system))
      })
    } else {
      this.setData({ familyId: family.id })
    }
  },

  input({ currentTarget, detail }) { this.setData({ [`form.${currentTarget.dataset.field}`]: detail.value }) },
  pickGender({ detail }) {
    const index = Number(detail.value)
    this.setData({ genderIndex: index, 'form.gender': index ? this.data.genders[index] : '' })
  },
  pickSystem({ detail }) {
    const index = Number(detail.value)
    this.setData({ systemIndex: index, 'form.education_system': index ? this.data.systems[index] : '' })
  },
  save() {
    if (this.data.saving) return
    const user = session.guard(['family_user'])
    if (!user) return
    const family = repository.familyForUser(user.id)
    if (!family || family.id !== this.data.familyId) return wx.reLaunch({ url: '/pages/home/index' })
    const form = this.data.form
    if (!form.name.trim() || !String(form.age).trim() || !form.school.trim() || !form.grade.trim()) {
      return wx.showToast({ title: '请填写姓名、年龄、学校和年级', icon: 'none' })
    }
    this.setData({ saving: true })
    try {
      const student = repository.upsertStudent(this.data.familyId, form, this.data.studentId)
      analytics.track('student_profile_completed', { userId: user.id, familyId: this.data.familyId, properties: { student_id: student.id } })
      wx.showToast({ title: '孩子档案已保存', icon: 'success' })
      if (this.data.editing) setTimeout(navigateBackOrHome, 500)
      else setTimeout(() => wx.redirectTo({ url: `/pages/compass/index?studentId=${student.id}` }), 500)
    } catch (error) {
      this.setData({ saving: false })
      wx.showToast({ title: '保存失败，请检查空间后重试', icon: 'none' })
    }
  }
})
