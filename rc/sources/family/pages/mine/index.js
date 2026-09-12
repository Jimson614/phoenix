const repository = require('../../services/repository')
const session = require('../../services/session')
const auth = require('../../services/auth')

Page({
  data: { user: null, family: null, studentCount: 0, reportCount: 0 },
  onShow() {
    const user = session.guard(['family_user'])
    if (!user) return
    const family = repository.familyForUser(user.id)
    this.setData({
      user: { ...user, initial: user.name ? user.name.charAt(0) : '家' }, family,
      studentCount: family ? repository.studentsForFamily(family.id).length : 0,
      reportCount: family ? repository.reportsForFamily(family.id).length : 0
    })
  },
  editFamily() { wx.navigateTo({ url: '/pages/family-edit/index' }) },
  addStudent() { wx.navigateTo({ url: '/pages/student-edit/index' }) },
  advisor() { if (this.data.family) wx.navigateTo({ url: '/pages/advisor-request/index' }); else this.editFamily() },
  logout() {
    wx.showModal({ title: '退出当前身份？', content: '家庭档案仍会保留在本机演示数据中。', success: ({ confirm }) => { if (confirm) { auth.logout(); wx.reLaunch({ url: '/pages/welcome/index' }) } } })
  }
})
