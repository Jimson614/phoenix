const familyData = require('../../services/family-data')
const session = require('../../services/session')
const auth = require('../../services/auth')
const payment = require('../../services/payment')
const educationCompass = require('../../services/education-compass')
const agent = require('../../services/agent')
const runtime = require('../../config/runtime')

Page({
  data: { user: { name: '', initial: '家' }, family: null, primaryStudent: null, consentStudents: [], consentStudentNames: [], consentStudentIndex: 0, consentStudent: null, studentCount: 0, reportCount: 0, orderCount: 0, unlockedReportCount: 0, recentOrders: [], loading: true, isV05: !runtime.isDemo(), consentBusy: false },
  async onShow() {
    const user = session.guard(['family_user'])
    if (!user) return
    this.setData({ loading: true })
    try {
      const family = await familyData.getFamily(user.id)
      const students = family ? await familyData.getStudents(family.id) : []
      const reports = family ? await familyData.getReports(family.id) : []
      const orders = (await payment.refreshCachedOrders()).map((order) => ({ ...order, statusLabel: payment.statusLabel(order.status), amountLabel: `${(order.amountFen / 100).toFixed(2)} 元` }))
      // Consent withdrawal must target the child the guardian picks, not silently the first one.
      const previousId = this.data.consentStudent && this.data.consentStudent.id
      const consentStudentIndex = Math.max(0, students.findIndex((student) => student.id === previousId))
      this.setData({
        user: { ...user, name: (family && family.parent_name) || user.name || '', initial: family && family.parent_name ? family.parent_name.charAt(0) : (user.name ? user.name.charAt(0) : '家') }, family,
        primaryStudent: students[0] || null,
        consentStudents: students,
        consentStudentNames: students.map((student) => student.name || '未填写姓名的学生档案'),
        consentStudentIndex,
        consentStudent: students[consentStudentIndex] || null,
        studentCount: students.length, reportCount: reports.length,
        orderCount: orders.length,
        unlockedReportCount: reports.filter((report) => report.product_code && report.entitled).length,
        recentOrders: orders.slice(0, 3), loading: false
      })
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '个人中心加载失败', icon: 'none' })
    }
  },
  editFamily() { wx.navigateTo({ url: '/pages/family-edit/index' }) },
  addStudent() { wx.navigateTo({ url: '/pages/student-edit/index' }) },
  advisor() { if (this.data.family) wx.navigateTo({ url: '/pages/advisor-request/index' }); else this.editFamily() },
  compass() {
    if (!this.data.family) return this.editFamily()
    const student = this.data.primaryStudent
    if (!student) return this.addStudent()
    wx.navigateTo({ url: `/pages/compass/index?studentId=${student.id}` })
  },
  openOrder({ currentTarget }) {
    const order = this.data.recentOrders.find((item) => item.orderId === currentTarget.dataset.id)
    if (!order) return
    if (order.status === 'PAID') wx.navigateTo({ url: `/pages/report/index?id=${order.reportId}` })
    else wx.navigateTo({ url: `/pages/payment-result/index?orderId=${order.orderId}&reportId=${order.reportId}` })
  },
  pickConsentStudent({ detail }) {
    const index = Number(detail.value)
    const student = this.data.consentStudents[index]
    if (student) this.setData({ consentStudentIndex: index, consentStudent: student })
  },
  confirmWithdrawal(title, content, action) {
    const student = this.data.consentStudent
    if (this.data.consentBusy || !student) return
    wx.showModal({
      title, content: `学生：${student.name || '未填写姓名的学生档案'}。${content}`, confirmText: '确认撤回', confirmColor: '#9a3f35',
      success: async ({ confirm }) => {
        if (!confirm) return
        this.setData({ consentBusy: true })
        try {
          await action(student.id)
          wx.showToast({ title: '已撤回', icon: 'success' })
        } catch (error) {
          wx.showModal({ title: '撤回失败', content: error.message || '请稍后重试', showCancel: false })
        } finally { this.setData({ consentBusy: false }) }
      }
    })
  },
  withdrawCoreConsent() {
    this.confirmWithdrawal('撤回核心测评授权？', '撤回后，该学生已有问卷、快照与成长报告将停止访问；财务和必要安全审计仍按政策保留。',
      (studentId) => educationCompass.withdrawAssessmentConsent(studentId, 'CORE_ASSESSMENT'))
  },
  withdrawStudentAssent() {
    this.confirmWithdrawal('撤回学生本人同意？', '撤回后，学生成长发现草稿不能继续提交，已有结果也会停止访问。',
      (studentId) => educationCompass.withdrawAssessmentConsent(studentId, 'STUDENT_ASSESSMENT_ASSENT'))
  },
  withdrawAiConsent() {
    this.confirmWithdrawal('撤回 AI 分析授权？', '撤回后不再创建、执行或读取该学生的 AI 分析；核心问卷和确定性报告不受影响。',
      (studentId) => agent.withdrawStudentConsent(studentId))
  },
  withdrawFeishuConsent() {
    this.confirmWithdrawal('停止飞书资料镜像？', '撤回后立即停止新增、更新和重试；远端已有资料将进入受控最小化审核。',
      (studentId) => educationCompass.updateFeishuProfileConsent({
        studentId, enabled: false, consentVersion: 'feishu_profile_mirror_opt_in_v1.0.0-rc1',
        guardianConfirmed: true
      }))
  },
  withdrawAdvisorConsent() {
    this.confirmWithdrawal('撤回顾问联系授权？', '撤回后，该学生尚未处理的联系申请将取消，且不会再进入运营同步。',
      (studentId) => familyData.updateAdvisorContactConsent(studentId, false))
  },
  logout() {
    const content = runtime.isDemo() ? '家庭档案仍会保留在本机演示数据中。' : '退出后需要重新微信登录；家庭档案保存在 Phoenix 服务端，不会被删除。'
    wx.showModal({ title: '退出当前身份？', content, success: ({ confirm }) => { if (confirm) { auth.logout(); wx.reLaunch({ url: '/pages/welcome/index' }) } } })
  }
})
