const repository = require('../../services/repository')
const session = require('../../services/session')
const { dateLabel } = require('../../utils/date')

Page({
  data: { student: null, reports: [] },
  onLoad(options) {
    const user = session.guard(['family_user'])
    if (!user) return
    const family = repository.familyForUser(user.id)
    if (!family) return wx.redirectTo({ url: '/pages/family-edit/index' })
    const students = repository.studentsForFamily(family.id)
    const student = options.studentId ? repository.getById('students', options.studentId) : students[0]
    if (!student || student.family_id !== family.id) return wx.redirectTo({ url: '/pages/student-edit/index' })
    const reports = repository.reportsForFamily(family.id)
      .filter((report) => report.assessment.student_id === student.id)
      .map((report) => ({ ...report, dateLabel: dateLabel(report.created_at) }))
    this.setData({ student: { ...student, initial: student.name.charAt(0) }, reports })
  },
  start() {
    if (!this.data.student || !this.data.student.id) return wx.showToast({ title: '请先选择有效的孩子档案', icon: 'none' })
    wx.navigateTo({ url: `/pages/compass-questionnaire/index?studentId=${this.data.student.id}` })
  },
  openReport({ currentTarget }) { wx.navigateTo({ url: `/pages/report/index?id=${currentTarget.dataset.id}` }) }
})
