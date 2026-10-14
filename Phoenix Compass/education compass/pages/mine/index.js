const familyData = require('../../services/family-data')
const session = require('../../services/session')
const auth = require('../../services/auth')
const payment = require('../../services/payment')
const educationCompass = require('../../services/education-compass')
const agent = require('../../services/agent')
const account = require('../../services/account')
const dataExport = require('../../services/data-export')
const runtime = require('../../config/runtime')
const currentStudent = require('../../utils/current-student')

// 订单区默认只展示最近几笔，其余点"显示全部"展开。
const ORDER_PREVIEW_COUNT = 5

function studentMeta(student) {
  const system = student.education_system ? familyData.educationSystemLabel(student.education_system) : ''
  const grade = student.grade && !/^[A-Z_]+$/.test(student.grade) ? student.grade : ''
  return [system === '请选择' ? '' : system, grade].filter(Boolean).join(' · ') || '资料待完善'
}

Page({
  data: { user: { name: '', initial: '家' }, family: null, primaryStudent: null, consentStudents: [], consentStudentNames: [], consentStudentIndex: 0, consentStudent: null, studentCount: 0, reportCount: 0, orderCount: 0, unlockedReportCount: 0, recentOrders: [], allOrders: [], showAllOrders: false, students: [], studentBusy: false, loading: true, isV05: !runtime.isDemo(), consentBusy: false, deleteBusy: false, exportBusy: false },
  async onShow() {
    const user = session.guard(['family_user'])
    if (!user) return
    this.setData({ loading: true })
    try {
      const family = await familyData.getFamily(user.id)
      const students = family ? await familyData.getStudents(family.id) : []
      const reports = family ? await familyData.getReports(family.id) : []
      const orders = (await payment.listOrders()).map((order) => ({
        ...order,
        statusLabel: payment.statusLabel(order.status),
        amountLabel: `${(order.amountFen / 100).toFixed(2)} 元`,
        studentLabel: order.studentName ? `${order.studentName}${order.studentDeleted ? '（档案已删除）' : ''}` : ''
      }))
      const currentId = currentStudent.resolve(students)
      // Consent withdrawal must target the child the guardian picks, not silently the first one.
      const previousId = this.data.consentStudent && this.data.consentStudent.id
      const consentStudentIndex = Math.max(0, students.findIndex((student) => student.id === previousId))
      this.setData({
        user: { ...user, name: (family && family.parent_name) || user.name || '', initial: family && family.parent_name ? family.parent_name.charAt(0) : (user.name ? user.name.charAt(0) : '家') }, family,
        primaryStudent: students.find((student) => student.id === currentId) || null,
        students: students.map((student) => ({
          ...student,
          initial: student.name ? student.name.charAt(0) : '学',
          meta: studentMeta(student),
          current: student.id === currentId
        })),
        consentStudents: students,
        consentStudentNames: students.map((student) => student.name || '未填写姓名的学生档案'),
        consentStudentIndex,
        consentStudent: students[consentStudentIndex] || null,
        studentCount: students.length, reportCount: reports.length,
        orderCount: orders.length,
        unlockedReportCount: reports.filter((report) => report.product_code && report.entitled).length,
        allOrders: orders,
        recentOrders: this.data.showAllOrders ? orders : orders.slice(0, ORDER_PREVIEW_COUNT), loading: false
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
    const student = this.data.primaryStudent || (this.data.students[0] || null)
    if (!student) return this.addStudent()
    wx.navigateTo({ url: `/pages/compass/index?studentId=${student.id}` })
  },
  openOrder({ currentTarget }) {
    const order = this.data.recentOrders.find((item) => item.orderId === currentTarget.dataset.id)
    if (!order) return
    if (order.status === 'PAID') return wx.navigateTo({ url: `/pages/report/index?id=${order.reportId}` })
    // 删除孩子或问卷后，没付款的订单只剩财务记录，已经没有报告可去。
    if (!order.reportId) return wx.showToast({ title: `订单${order.statusLabel}，没有可查看的报告`, icon: 'none' })
    wx.navigateTo({ url: `/pages/payment-result/index?orderId=${order.orderId}&reportId=${order.reportId}` })
  },
  toggleOrders() {
    const showAllOrders = !this.data.showAllOrders
    this.setData({
      showAllOrders,
      recentOrders: showAllOrders ? this.data.allOrders : this.data.allOrders.slice(0, ORDER_PREVIEW_COUNT)
    })
  },
  studentFrom({ currentTarget }) {
    return this.data.students.find((student) => student.id === currentTarget.dataset.id) || null
  },
  selectStudent(event) {
    const student = this.studentFrom(event)
    if (!student) return
    currentStudent.set(student.id)
    this.setData({
      primaryStudent: student,
      students: this.data.students.map((item) => ({ ...item, current: item.id === student.id }))
    })
    wx.showToast({ title: `当前孩子：${student.name || '未填写姓名'}`, icon: 'none' })
  },
  editStudent(event) {
    const student = this.studentFrom(event)
    if (student) wx.navigateTo({ url: `/pages/student-edit/index?id=${encodeURIComponent(student.id)}` })
  },
  openRecords(event) {
    const student = this.studentFrom(event)
    if (!student) return
    if (!this.data.isV05) return wx.showToast({ title: '演示模式没有问卷记录', icon: 'none' })
    wx.navigateTo({ url: `/pages/compass/index?mode=records&studentId=${encodeURIComponent(student.id)}` })
  },
  /**
   * 删除一个孩子档案（2026-10-14 定）：两步确认。买过的报告和订单留在历史订单里，
   * 其余问卷和结果删除，不可恢复——这些在动手前讲清楚。
   */
  deleteStudent(event) {
    const student = this.studentFrom(event)
    if (!student || this.data.studentBusy) return
    const name = student.name || '未填写姓名的孩子'
    wx.showModal({
      title: `删除「${name}」的档案？`,
      content: '将删除这个孩子的资料、全部问卷和结果。已经购买的报告和订单会保留在历史订单里，仍可查看。',
      confirmText: '继续',
      success: ({ confirm }) => {
        if (!confirm) return
        wx.showModal({
          title: '确认删除？此操作不可撤销',
          content: '删除后无法恢复这个孩子的问卷和结果。',
          confirmText: '确认删除',
          confirmColor: '#9a3f35',
          cancelText: '再想想',
          success: async ({ confirm: sure }) => {
            if (!sure) return
            this.setData({ studentBusy: true })
            try {
              await familyData.deleteStudent(student.id)
              if (currentStudent.get() === student.id) currentStudent.clear()
              wx.showToast({ title: '已删除', icon: 'success' })
              await this.onShow()
            } catch (error) {
              wx.showModal({ title: '删除失败', content: (error && error.message) || '请稍后重试', showCancel: false })
            } finally { this.setData({ studentBusy: false }) }
          }
        })
      }
    })
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
  },
  /**
   * 导出个人数据副本（可携带权）。不需要二次确认——这是只读操作，
   * 但要提醒文件含未成年人信息。
   */
  async exportData() {
    if (this.data.exportBusy) return
    if (runtime.isDemo()) {
      return wx.showModal({ title: '演示模式', content: '演示模式没有服务端账号，无数据可导出。', showCancel: false })
    }
    this.setData({ exportBusy: true })
    try {
      const bundle = await dataExport.fetchExport()
      const result = await dataExport.saveAndShare(bundle)
      if (result.shared) return
      if (result.reason === 'CANCELLED') return
      wx.showModal({
        title: '文件已生成，但没能发送',
        content: '数据已导出到小程序的临时文件，但当前微信版本无法转发。升级微信后再试一次即可。',
        showCancel: false
      })
    } catch (error) {
      wx.showModal({
        title: '导出失败',
        content: (error && error.message) || '请稍后重试。',
        showCancel: false
      })
    } finally { this.setData({ exportBusy: false }) }
  },
  /**
   * 账号注销。两步确认：第一步说清删什么，第二步确认不可撤销。
   * 已购报告会一并删除，这一点必须在动手之前讲明白，不能藏在细则里。
   */
  deleteAccount() {
    if (this.data.deleteBusy) return
    if (runtime.isDemo()) {
      return wx.showModal({ title: '演示模式', content: '演示模式没有服务端账号，无需注销。', showCancel: false })
    }
    wx.showModal({
      title: '注销账号？',
      content: '将删除你的家庭档案、孩子资料、全部问卷与报告，包括已购买的报告。订单记录会按法规保留，但不再关联到你。',
      confirmText: '继续',
      cancelText: '取消',
      success: ({ confirm }) => {
        if (!confirm) return
        wx.showModal({
          title: '确认注销？此操作不可撤销',
          content: '注销后无法恢复任何数据。如果以后再用微信登录，会是一个全新的空白账号。',
          confirmText: '确认注销',
          confirmColor: '#9a3f35',
          cancelText: '再想想',
          success: async ({ confirm: sure }) => {
            if (!sure) return
            this.setData({ deleteBusy: true })
            try {
              await account.deleteAccount()
              // 本机缓存要一起清掉，否则注销后界面还会显示上一个账号的残留。
              try { auth.logout() } catch (error) {}
              wx.showModal({
                title: '账号已注销',
                content: '你的个人数据已删除。感谢使用 Phoenix。',
                showCancel: false,
                success: () => wx.reLaunch({ url: '/pages/welcome/index' })
              })
            } catch (error) {
              wx.showModal({
                title: '注销失败',
                content: (error && error.message) || '请稍后重试；如果反复失败请联系客服。',
                showCancel: false
              })
            } finally { this.setData({ deleteBusy: false }) }
          }
        })
      }
    })
  }
})
