const familyData = require('../../services/family-data')
const assessmentService = require('../../services/assessment')
const payment = require('../../services/payment')
const educationCompass = require('../../services/education-compass')
const educationNavigation = require('../../utils/education-compass-navigation')
const runtime = require('../../config/runtime')
const session = require('../../services/session')
const { getNavigationMetrics } = require('../../utils/navigation')

function safeName(value, fallback = '') {
  return value === undefined || value === null ? fallback : String(value).trim()
}

function initial(value, fallback = '+') {
  const name = safeName(value)
  return name ? name.charAt(0) : fallback
}

function actionCode(state) {
  const action = state && state.nextAction
  return String(typeof action === 'string' ? action : ((action && (action.code || action.action)) || '')).toUpperCase()
}

function actionCopy(state) {
  const action = state && state.nextAction
  if (action && typeof action === 'object') {
    const title = safeName(action.title || action.label)
    const note = safeName(action.note || action.description)
    if (title) return { title, note: note || '继续完成当前 Education Compass 步骤' }
  }
  const code = actionCode(state)
  const copies = {
    START_LEVEL_1: ['开始免费家长教育罗盘', '约 3—5 分钟，完成 Family Education Snapshot'],
    START_FREE_PARENT_COMPASS: ['开始免费家长教育罗盘', '约 3—5 分钟，完成 Family Education Snapshot'],
    CONTINUE_LEVEL_1: ['继续免费家长教育罗盘', '草稿已由服务端保存，可从上次进度继续'],
    VIEW_FAMILY_SNAPSHOT: ['查看家庭教育快照', '查看家庭关注、观察信号和下一步建议'],
    VIEW_FAMILY_EDUCATION_SNAPSHOT: ['查看家庭教育快照', '查看家庭关注、观察信号和下一步建议'],
    COMPLETE_STUDENT_PROFILE: ['确认学生阶段与课程体系', '进入学生本人测评前，只确认必要资料'],
    COMPLETE_LEVEL_2_PROFILE: ['确认学生阶段与课程体系', '进入学生本人测评前，只确认必要资料'],
    START_LEVEL_2: ['开始学生成长发现', '由学生本人完成约 15—20 分钟测评'],
    START_STUDENT_GROWTH_DISCOVERY: ['开始学生成长发现', '由学生本人完成约 15—20 分钟测评'],
    CONTINUE_LEVEL_2: ['继续学生成长发现', '草稿已由服务端保存，可跨设备恢复'],
    VIEW_LOCKED_RESULT: ['查看提交状态并解锁报告', '问卷已提交，付款后查看完整六项结果'],
    PURCHASE_TO_UNLOCK_REPORT: ['付款解锁完整报告', '问卷已提交，完整结果仍由服务端锁定'],
    CHECK_PAYMENT_STATUS: ['查询支付状态', '请勿重复支付，以服务端核验状态为准'],
    VIEW_REPORT: ['查看学生成长发现报告', '查看六项成长发现结果与 30 天行动计划']
  }
  const copy = copies[code] || ['继续 Education Compass', '按服务端记录继续当前步骤']
  return { title: copy[0], note: copy[1] }
}

Page({
  data: {
    isV05: !runtime.isDemo(),
    user: { name: '' }, family: null, students: [], latestReport: null,
    primaryStudent: null, stage: '', v05State: null, error: '',
    nextStep: { title: '建立家庭档案', note: '用 2 分钟告诉我们家庭最关心的成长目标', url: '/pages/family-edit/index' },
    progress: 0,
    latestReportActionLabel: '', insightCopy: '', reportTargetUrl: '', loading: true,
    navigation: getNavigationMetrics()
  },

  async onShow() {
    const user = session.guard(['family_user'])
    if (!user) return
    if (runtime.isDemo()) return this.loadLegacy(user)
    return this.loadV05(user)
  },

  async loadV05(user) {
    this.setData({ loading: true, error: '' })
    try {
      const [state, family] = await Promise.all([educationCompass.getState(), familyData.getFamily(user.id)])
      const students = family ? await familyData.getStudents(family.id) : []
      const reports = family ? await familyData.getReports(family.id) : []
      const primaryStudent = students.find((student) => student.id === state.studentId) || students[0] || null
      const latestReport = reports.find((report) => report.id === state.reportId) || reports[0] || null
      const nextStep = actionCopy(state)
      const coverageValue = state.coverage === undefined ? (state.progress && state.progress.coverage) : state.coverage
      const coverage = Number(coverageValue)
      const reportId = state.reportId || (latestReport && latestReport.id) || ''
      const reportRecord = latestReport || (reportId ? {
        id: reportId,
        assessment_id: state.assessmentId,
        report_kind: state.resultKind,
        entitled: actionCode(state) === 'VIEW_FULL_REPORT'
      } : null)
      let reportTargetUrl = ''
      let latestReportActionLabel = nextStep.title
      if (reportRecord) {
        const destination = educationNavigation.resolveReportDestination(reportRecord, state)
        reportTargetUrl = destination.url
        latestReportActionLabel = destination.code === 'VIEW_FAMILY_SNAPSHOT'
          ? '查看家庭教育快照'
          : destination.code === 'VIEW_REPORT'
              ? '查看完整报告'
              : destination.code === 'CHECK_PAYMENT_STATUS'
                  ? '查询支付状态'
                  : '查看提交与解锁状态'
      }
      this.setData({
        user: { ...user, name: (family && safeName(family.parent_name)) || safeName(user.name) },
        family, students, primaryStudent, latestReport, v05State: state, nextStep,
        progress: Number.isFinite(coverage) ? Math.max(0, Math.min(100, coverage)) : 0,
        studentInitial: initial(primaryStudent && primaryStudent.name),
        stage: safeName(state.stageLabel || state.stage || (primaryStudent && primaryStudent.grade), '资料待确认'),
        insightCopy: nextStep.note,
        latestReportActionLabel,
        reportTargetUrl,
        loading: false
      })
    } catch (error) {
      this.setData({ loading: false, error: error.message || '家庭中心暂时无法连接服务端' })
    }
  },

  async loadLegacy(user) {
    this.setData({ loading: true, error: '' })
    try {
      const family = await familyData.getFamily(user.id)
      const students = family ? await familyData.getStudents(family.id) : []
      const reports = family ? await familyData.getReports(family.id) : []
      const primaryStudent = students[0] || null
      const studentReports = primaryStudent ? reports.filter((report) => report.student_id === primaryStudent.id) : []
      const latestReport = studentReports.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0] || null
      const reference = primaryStudent ? assessmentService.referenceForStudent(primaryStudent.id) : null
      const cachedOrders = await payment.refreshCachedOrders()
      const latestOrder = latestReport
        ? cachedOrders.find((order) => order.reportId === latestReport.id)
        : (reference ? cachedOrders.find((order) => order.assessmentId === reference.assessmentId) : null)

      let progress = !family ? 0 : !primaryStudent ? 34 : 67
      let nextStep = { title: '建立家庭档案', note: '用 2 分钟告诉我们家庭最关心的成长目标', url: '/pages/family-edit/index' }
      let reportTargetUrl = ''
      let latestReportActionLabel = '开始第一次探索'
      let insightCopy = '完成 Education Compass 后，这里会出现属于孩子的成长洞察。'
      let stage = primaryStudent ? `${safeName(primaryStudent.grade, '当前')}成长规划期` : ''

      if (family && !primaryStudent) nextStep = { title: '添加孩子档案', note: '记录孩子当前阶段、兴趣与未来想法', url: '/pages/student-edit/index' }
      if (primaryStudent) nextStep = { title: '完成 Education Compass', note: '从身份、学术、兴趣与家庭约束中找到下一步', url: `/pages/compass/index?studentId=${primaryStudent.id}` }
      if (!latestReport && reference && reference.status === 'DRAFT') {
        progress = 72
        nextStep = { title: '继续 Education Compass 问卷', note: '草稿已保存，可从上次进度继续', url: `/pages/compass-questionnaire/index?studentId=${primaryStudent.id}&assessmentId=${reference.assessmentId}` }
      }
      if (!latestReport && reference && reference.status === 'PREVIEW_READY') {
        const entitled = !!(latestOrder && latestOrder.status === 'PAID')
        progress = entitled ? 100 : 85
        insightCopy = '报告预览已生成，可先查看画像摘要、优势、风险和路线概览。'
        stage = entitled ? '完整成长规划报告已解锁' : '免费报告预览已生成'
        if (entitled && reference.reportId) {
          reportTargetUrl = `/pages/report/index?id=${reference.reportId}`
          latestReportActionLabel = '查看完整报告'
          nextStep = { title: '查看完整六模块报告', note: '你的付费权益已经服务端确认', url: reportTargetUrl }
        } else if (latestOrder && ['CREATED', 'PAYING'].includes(latestOrder.status)) {
          reportTargetUrl = `/pages/payment-result/index?orderId=${latestOrder.orderId}&reportId=${reference.reportId || latestOrder.reportId}`
          latestReportActionLabel = '查询支付状态'
          nextStep = { title: '确认报告支付状态', note: '请勿重复支付，以服务端核验结果为准', url: reportTargetUrl }
        } else {
          reportTargetUrl = `/pages/compass-preview/index?assessmentId=${reference.assessmentId}`
          latestReportActionLabel = '查看免费预览'
          nextStep = { title: '查看免费预览', note: '确认适合后，可按预览页展示的服务端商品信息单次解锁完整六模块报告', url: reportTargetUrl }
        }
      }
      if (latestReport) {
        const entitled = !!latestReport.entitled || !!(latestOrder && latestOrder.status === 'PAID')
        const preview = latestReport.preview || {}
        insightCopy = (latestReport.summary && latestReport.summary.narrative) || preview.profileSummary || '报告已生成，点击查看当前状态。'
        stage = (latestReport.summary && latestReport.summary.currentStage) || (entitled ? '完整成长规划报告已解锁' : '免费报告预览已生成')
        if (entitled) {
          progress = 100
          reportTargetUrl = `/pages/report/index?id=${latestReport.id}`
          latestReportActionLabel = '查看完整报告'
          nextStep = { title: (latestReport.recommendation && latestReport.recommendation.nextAction) || '查看完整六模块报告', note: '来自已解锁的 Education Compass 成长规划报告', url: reportTargetUrl }
        } else if (latestOrder && ['CREATED', 'PAYING'].includes(latestOrder.status)) {
          progress = 88
          reportTargetUrl = `/pages/payment-result/index?orderId=${latestOrder.orderId}&reportId=${latestReport.id}`
          latestReportActionLabel = '查询支付状态'
          nextStep = { title: '确认报告支付状态', note: '请勿重复支付，以服务端核验结果为准', url: reportTargetUrl }
        } else {
          progress = 85
          reportTargetUrl = `/pages/compass-preview/index?assessmentId=${latestReport.assessment_id}`
          latestReportActionLabel = '查看免费预览'
          nextStep = { title: '查看免费预览', note: '确认适合后，可按预览页展示的服务端商品信息单次解锁完整六模块报告', url: reportTargetUrl }
        }
      }
      this.setData({
        user: { ...user, name: (family && family.parent_name) || user.name || '' }, family, students, primaryStudent, latestReport, progress, nextStep,
        studentInitial: initial(primaryStudent && primaryStudent.name), stage, insightCopy, latestReportActionLabel, reportTargetUrl, loading: false
      })
    } catch (error) {
      this.setData({ loading: false, error: error.message || '家庭中心加载失败' })
    }
  },

  retry() { this.onShow() },
  goNext() {
    if (this.data.isV05) {
      try { educationNavigation.navigateFromState(this.data.v05State) }
      catch (error) { wx.showToast({ title: error.message || '当前步骤暂不可用', icon: 'none' }) }
      return
    }
    if (this.data.nextStep) wx.navigateTo({ url: this.data.nextStep.url })
  },
  goFamily() { wx.navigateTo({ url: '/pages/family-edit/index' }) },
  goStudent() {
    const id = this.data.primaryStudent && this.data.primaryStudent.id ? `?id=${encodeURIComponent(this.data.primaryStudent.id)}` : ''
    wx.navigateTo({ url: `/pages/student-edit/index${id}` })
  },
  goCompass() {
    if (this.data.isV05) return this.goNext()
    if (!this.data.family) return this.goFamily()
    if (!this.data.primaryStudent) return this.goStudent()
    wx.navigateTo({ url: `/pages/compass/index?studentId=${this.data.primaryStudent.id}` })
  },
  goReport() {
    if (this.data.reportTargetUrl) return wx.navigateTo({ url: this.data.reportTargetUrl })
    this.goNext()
  },
  goAdvisor() {
    if (!this.data.family) return this.goFamily()
    wx.navigateTo({ url: '/pages/advisor-request/index' })
  },
  goMasters() { wx.navigateTo({ url: '/pages/masters-intake/index?channel=organic' }) }
})
