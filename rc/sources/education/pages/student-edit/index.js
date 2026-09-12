const familyData = require('../../services/family-data')
const session = require('../../services/session')
const analytics = require('../../services/analytics')

Page({
  data: {
    familyId: '', studentId: '', editing: false, loading: true, saving: false,
    genders: ['请选择', '男', '女', '不便说明'], genderIndex: 0,
    systems: familyData.EDUCATION_SYSTEM_OPTIONS.map((item) => item.label),
    systemValues: familyData.EDUCATION_SYSTEM_OPTIONS.map((item) => item.value),
    systemIndex: 0, systemLabel: '请选择',
    form: { name: '', age: '', gender: '', school: '', education_system: '', grade: '', interest: '', goal: '' }
  },

  async onLoad(options) {
    const user = session.guard(['family_user'])
    if (!user) return
    try {
      const family = await familyData.getFamily(user.id)
      if (!family) return wx.redirectTo({ url: '/pages/family-edit/index' })
      const student = options.id ? await familyData.getStudent(family.id, options.id) : null
      if (student && student.family_id !== family.id) return wx.navigateBack()
      if (student) {
        const educationSystem = familyData.normalizeEducationSystem(student.education_system)
        const systemIndex = Math.max(0, this.data.systemValues.indexOf(educationSystem))
        this.setData({
          familyId: family.id, studentId: student.id, editing: true,
          form: {
            name: student.name, age: student.age, gender: student.gender, school: student.school,
            education_system: educationSystem, grade: student.grade, interest: student.interest, goal: student.goal
          },
          genderIndex: Math.max(0, this.data.genders.indexOf(student.gender)),
          systemIndex,
          systemLabel: this.data.systems[systemIndex]
        })
      } else this.setData({ familyId: family.id })
    } catch (error) { wx.showToast({ title: error.message || '孩子档案加载失败', icon: 'none' }) }
    finally { this.setData({ loading: false }) }
  },

  input({ currentTarget, detail }) { this.setData({ [`form.${currentTarget.dataset.field}`]: detail.value }) },
  pickGender({ detail }) {
    const index = Number(detail.value)
    this.setData({ genderIndex: index, 'form.gender': index ? this.data.genders[index] : '' })
  },
  pickSystem({ detail }) {
    const index = Number(detail.value)
    this.setData({
      systemIndex: index,
      systemLabel: this.data.systems[index] || '请选择',
      'form.education_system': this.data.systemValues[index] || ''
    })
  },
  async save() {
    if (this.data.saving) return
    const form = this.data.form
    try {
      familyData.validateStudentForm(form)
    } catch (error) {
      return wx.showToast({ title: error.message || '孩子档案格式无效', icon: 'none' })
    }
    this.setData({ saving: true })
    try {
      const student = await familyData.saveStudent(this.data.familyId, form, this.data.studentId, this.data.studentId)
      analytics.track('student_profile_completed', { userId: session.currentUser().id, familyId: this.data.familyId, properties: { student_id: student.id } })
      wx.showToast({ title: '孩子档案已保存', icon: 'success' })
      if (this.data.editing) setTimeout(() => wx.navigateBack(), 500)
      else setTimeout(() => wx.redirectTo({ url: `/pages/compass/index?studentId=${student.id}` }), 500)
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' })
      this.setData({ saving: false })
    }
  }
})
