const familyData = require('../../services/family-data')
const session = require('../../services/session')
const assessmentService = require('../../services/assessment')
const educationCompass = require('../../services/education-compass')
const runtime = require('../../config/runtime')
const { PRODUCT, CONSENT_VERSION } = require('../../config/compass')
const { dateLabel } = require('../../utils/date')
const educationNavigation = require('../../utils/education-compass-navigation')
const currentStudent = require('../../utils/current-student')

const GUARDIAN_COPY = '我已了解本测评用于形成教育成长快照与下一步支持建议。我确认有权为该家庭／未成年学生管理必要资料，并同意系统按隐私说明保存版本化问卷与结果。我可以撤回非必要授权；撤回不会被解释为学生能力或意愿不足。'
const STUDENT_ASSENT_COPY = '这份测评需要由我本人作答。我知道可以暂停、退出或不回答选填成绩区间，也不会因此得到负面评价。我同意系统用本次回答生成成长快照；如果不愿继续，我可以现在退出。'
const GUARDIAN_COPY_HASH = '334a1e8e455dfef386fcaf491acea3dac23b13c4ece010cfad66d1087f6a84a5'
const STUDENT_ASSENT_COPY_HASH = '0ab8f89835cfe500f97944324ab58a3cf2cce27913fc5af5d02461227b2a821d'
const UI_SCREENS = Object.freeze({
  FREE: 'education-compass-free-home',
  GROWTH: 'education-compass-growth-home',
  LEGACY: 'education-compass-legacy-home'
})

function initial(name) {
  const value = name === undefined || name === null ? '' : String(name).trim()
  return value ? value.charAt(0) : '学'
}

// 问卷记录里每一行的显示文字；能做哪些操作由服务端算好（canDelete、canReset、canRedo）。
function recordView(record) {
  const level = Number(record.level) === 2 ? 2 : 1
  const coverage = Number(record.completenessCoverage)
  let statusLabel = '已提交 · 待解锁'
  if (record.status === 'DRAFT') statusLabel = Number.isFinite(coverage) ? `填写中 · 已完成 ${Math.round(coverage)}%` : '填写中'
  else if (record.resultState === 'READY') statusLabel = '已出免费结果'
  else if (record.resultState === 'UNLOCKED') statusLabel = '已解锁完整报告'
  else if (record.paymentStatus === 'PENDING') statusLabel = '已提交 · 支付处理中'
  return {
    ...record,
    level,
    title: level === 1 ? '家长问卷 · 免费家庭快照' : '学生问卷 · 成长发现',
    dateLabel: record.createdAt ? dateLabel(record.createdAt) : '日期待同步',
    statusLabel
  }
}

Page({
  data: {
    isV05: !runtime.isDemo(), level: 1,
    uiScreen: runtime.isDemo() ? UI_SCREENS.LEGACY : UI_SCREENS.FREE,
    student: null, family: null, reports: [], state: null, loading: true, creating: false, error: '',
    mode: '', records: [], recordBusy: false,
    product: runtime.isDemo() ? PRODUCT : null, isDemo: runtime.isDemo(), level2EntryAuthorized: false,
    consentValues: [], consentComplete: false,
    guardianAccepted: false, studentAssentAccepted: false,
    guardianCopy: GUARDIAN_COPY, studentAssentCopy: STUDENT_ASSENT_COPY,
    heroTitle: '3—5 分钟，\n看见孩子当前\n最值得关注的信号。',
    heroCopy: ''
  },

  onLoad(options) {
    this.options = options || {}
    this.studentId = options.studentId || ''
    this.sourceAssessmentId = options.sourceAssessmentId || ''
    const level = String(options.level || '') === '2' ? 2 : 1
    this.requestedLevel = level
    // mode=records：问卷记录；redo=1：从问卷记录"重新测评"，新建一份同级问卷。
    this.mode = options.mode === 'records' ? 'records' : ''
    this.redo = String(options.redo || '') === '1'
    this.setData({ level, mode: this.mode, uiScreen: runtime.isDemo() ? UI_SCREENS.LEGACY : (level === 2 ? UI_SCREENS.GROWTH : UI_SCREENS.FREE) })
  },

  async onShow() {
    const user = session.guard(['family_user'])
    if (!user) return
    this.user = user
    if (runtime.isDemo()) return this.loadLegacy(user)
    if (this.mode === 'records') return this.loadRecords(user)
    return this.loadV05(user)
  },

  async loadRecords(user) {
    this.setData({ loading: true, error: '' })
    try {
      const family = await familyData.getFamily(user.id)
      const students = family ? await familyData.getStudents(family.id) : []
      const student = students.find((item) => item.id === (this.studentId || currentStudent.resolve(students)))
      if (!student) throw new Error('这个孩子档案已不存在')
      this.studentId = student.id
      const records = (await educationCompass.listStudentAssessments(student.id)).map(recordView)
      this.setData({
        family, student: { ...student, initial: initial(student.name) }, records, uiScreen: UI_SCREENS.FREE,
        heroTitle: '问卷记录',
        heroCopy: '这个孩子做过的全部问卷都在这里：可以继续填写、查看结果、清空重填或重新测评；还没出报告的问卷可以删除。',
        loading: false
      })
    } catch (error) {
      this.setData({ loading: false, error: error.message || '问卷记录暂时无法加载' })
    }
  },

  async loadV05(user) {
    this.setData({ loading: true, error: '', level2EntryAuthorized: false, product: null })
    try {
      const [rootState, family] = await Promise.all([educationCompass.getState(), familyData.getFamily(user.id)])
      const students = family ? await familyData.getStudents(family.id) : []
      const state = educationNavigation.selectStudentState(rootState, this.studentId || currentStudent.resolve(students, rootState.studentId))
      const studentId = state.studentId
      const student = students.find((item) => item.id === studentId) || (studentId
        ? { id: studentId, name: '', grade: '', education_system: '' }
        : null)
      // 从问卷记录"重新测评"时不按当前进度跳转：新建时服务端仍会校验来源问卷和同意。
      const entry = this.redo
        ? { authorized: true, level: this.requestedLevel }
        : educationNavigation.resolveCompassEntry(state, this.requestedLevel || this.data.level)
      if (!entry.authorized) {
        this.setData({ state, family, student: student ? { ...student, initial: initial(student.name) } : null })
        this.redirectToAuthoritative(entry.destination)
        return
      }
      if (!student || !student.id) throw new Error('服务端尚未建立可用于测评的 Student ID')
      this.studentId = student.id
      const level = entry.level
      this.sourceAssessmentId = level === 2 ? ((this.redo && this.sourceAssessmentId) || state.sourceAssessmentId || '') : ''
      if (level === 2 && !this.sourceAssessmentId) throw new Error('服务端尚未返回已完成的 Level 1 Assessment ID')
      const reports = family ? (await familyData.getReports(family.id))
        .filter((report) => report.student_id === student.id)
        .map((report) => ({
          ...report,
          dateLabel: report.created_at ? dateLabel(report.created_at) : '日期待同步',
          accessLabel: report.entitled ? '完整报告' : '结果／预览',
          title: (report.preview && report.preview.profileSummary) || 'Education Compass 结果'
        })) : []
      const product = level === 2 ? await educationCompass.getGrowthProduct() : null
      this.setData({
        state, family, student: { ...student, initial: initial(student.name) }, reports, level,
        uiScreen: level === 2 ? UI_SCREENS.GROWTH : UI_SCREENS.FREE,
        level2EntryAuthorized: level === 2,
        ...(product ? { product: { ...product, displayPrice: product.displayPrice || `¥${(product.amountFen / 100).toFixed(2)}`, purchaseType: '单次解锁' } } : {}),
        heroTitle: level === 1 ? '3—5 分钟，\n看见孩子当前\n最值得关注的信号。' : '15—20 分钟，\n进一步看清孩子\n当前需要支持的地方。',
        heroCopy: level === 1
          ? '免费家长教育罗盘约 3—5 分钟，完成后可查看完整 Family Education Snapshot。'
          : '学生成长发现约 15—20 分钟。先完成并提交，付款后解锁完整六项报告；不做录取预测。',
        loading: false
      })
    } catch (error) {
      this.setData({ loading: false, error: error.message || 'Education Compass 暂时无法加载' })
    }
  },

  async loadLegacy(user) {
    this.setData({ loading: true, error: '' })
    try {
      const family = await familyData.getFamily(user.id)
      if (!family) return wx.redirectTo({ url: '/pages/family-edit/index' })
      const students = await familyData.getStudents(family.id)
      const student = this.studentId ? students.find((item) => item.id === this.studentId) : students[0]
      if (!student) return wx.redirectTo({ url: '/pages/student-edit/index' })
      this.studentId = student.id
      const reports = (await familyData.getReports(family.id))
        .filter((report) => report.student_id === student.id)
        .map((report) => ({
          ...report,
          dateLabel: dateLabel(report.created_at),
          accessLabel: report.product_code ? (report.entitled ? '完整报告' : '免费预览') : '历史免费洞察',
          title: (report.summary && report.summary.currentStage) || (report.preview && report.preview.profileSummary) || 'Education Compass 报告'
        }))
      this.setData({
        uiScreen: UI_SCREENS.LEGACY,
        student: { ...student, initial: initial(student.name) }, family, reports,
        heroCopy: '先免费完成问卷并查看结果预览，再决定是否单次解锁完整的六模块成长规划报告。',
        loading: false
      })
    } catch (error) {
      this.setData({ loading: false, error: error.message || 'Education Compass 加载失败' })
    }
  },

  consentChange({ detail }) {
    const consentValues = detail.value || []
    this.setData({ consentValues, consentComplete: ['guardian', 'privacy', 'terms'].every((item) => consentValues.includes(item)) })
  },
  guardianChange({ detail }) { this.setData({ guardianAccepted: (detail.value || []).includes('guardian') }) },
  assentChange({ detail }) { this.setData({ studentAssentAccepted: (detail.value || []).includes('student') }) },

  showPrivacy() {
    if (wx.openPrivacyContract) {
      wx.openPrivacyContract({ fail: () => wx.showModal({ title: '隐私说明', content: '问卷资料仅用于生成 Education Compass 结果；生产环境按版本化隐私合同存储、访问和删除。', showCancel: false }) })
      return
    }
    wx.showModal({ title: '隐私说明', content: '问卷资料仅用于生成 Education Compass 结果；生产环境按版本化隐私合同存储、访问和删除。', showCancel: false })
  },
  showTerms() {
    wx.showModal({
      title: '服务边界',
      content: this.data.isV05
        ? '成长快照仅供教育支持参考，不是诊断、排名、录取预测或结果保证。Level 2 提交后付款解锁本次完整报告。'
        : '填写问卷和查看预览免费；可按预览页展示的商品信息单次解锁本次完整报告与 PDF。报告不承诺录取，不替代学校、心理或医疗专业意见。',
      showCancel: false
    })
  },

  guardianConsent() {
    return {
      consentVersion: 'guardian_core_assessment_v1.0.0-rc1', scope: 'CORE_ASSESSMENT',
      textHash: GUARDIAN_COPY_HASH, locale: 'zh-CN', guardianAuthority: 'CONFIRMED',
      childSubjectId: this.data.student.id, guardianConfirmed: true, acceptedAt: new Date().toISOString()
    }
  },
  studentAssent() {
    return {
      consentVersion: 'student_assent_growth_discovery_v1.0.0-rc1', scope: 'STUDENT_ASSESSMENT_ASSENT',
      textHash: STUDENT_ASSENT_COPY_HASH, locale: 'zh-CN', childSubjectId: this.data.student.id,
      studentConfirmed: true, assistanceMode: 'OPERATIONAL_OR_LANGUAGE_CLARIFICATION_ONLY', acceptedAt: new Date().toISOString()
    }
  },

  async start() {
    if (this.data.isV05) return this.startV05()
    if (this.data.loading || this.data.creating) return
    if (!this.data.consentComplete) return wx.showToast({ title: '请完成监护确认与协议同意', icon: 'none' })
    this.setData({ creating: true })
    try {
      const result = await assessmentService.createForStudent({
        student: this.data.student,
        family: this.data.family,
        consent: { consentVersion: CONSENT_VERSION, scope: 'education_compass_report', guardianConfirmed: true }
      })
      wx.navigateTo({ url: `/pages/compass-questionnaire/index?studentId=${this.data.student.id}&assessmentId=${result.assessmentId}` })
    } catch (error) {
      wx.showToast({ title: error.message || '暂时无法开始问卷', icon: 'none' })
    } finally { this.setData({ creating: false }) }
  },

  async startV05() {
    if (this.data.creating || !this.data.student) return
    if (!this.data.guardianAccepted) return wx.showToast({ title: '请先由监护人确认核心测评同意', icon: 'none' })
    if (this.data.level === 2 && !this.data.studentAssentAccepted) return wx.showToast({ title: '请由学生本人确认自愿作答', icon: 'none' })
    if (this.data.level === 2 && !this.data.level2EntryAuthorized) return wx.showToast({ title: '请先完成免费家长教育快照', icon: 'none' })
    this.setData({ creating: true })
    try {
      if (this.data.level === 2 && !this.redo) {
        const rootState = await educationCompass.getState()
        const state = educationNavigation.selectStudentState(rootState, this.data.student.id)
        const entry = educationNavigation.resolveCompassEntry(state, 2)
        if (!entry.authorized) {
          this.redirectToAuthoritative(entry.destination)
          return
        }
        this.sourceAssessmentId = state.sourceAssessmentId || ''
        if (!this.sourceAssessmentId) throw new Error('免费 Family Education Snapshot 尚未准备完成')
        this.setData({ state })
      }
      this.createKey = this.createKey || educationCompass.createIdempotencyKey(this.data.level === 1 ? 'level1_create' : 'level2_create')
      const result = this.data.level === 1
        ? await educationCompass.createFreeParentAssessment({
          studentId: this.data.student.id, sourceEntry: 'MINIPROGRAM_HOME', guardianConsent: this.guardianConsent()
        }, this.createKey)
        : await educationCompass.createStudentGrowthAssessment(this.data.student.id, {
          sourceAssessmentId: this.sourceAssessmentId,
          educationSystem: this.data.state.educationSystem || this.data.student.education_system || undefined,
          sourceEntry: 'LEVEL_1_RESULT',
          assistanceMode: 'OPERATIONAL_OR_LANGUAGE_CLARIFICATION_ONLY',
          guardianConsent: this.guardianConsent(), studentAssent: this.studentAssent()
        }, this.createKey)
      this.createKey = ''
      // 重新测评建好后替换掉本页，返回时不会停在"开始"上再建一份。
      const url = `/pages/compass-questionnaire/index?level=${this.data.level}&studentId=${encodeURIComponent(this.data.student.id)}&assessmentId=${encodeURIComponent(result.assessmentId)}`
      if (this.redo) wx.redirectTo({ url })
      else wx.navigateTo({ url })
    } catch (error) {
      wx.showModal({ title: '暂时无法开始测评', content: error.message || '请稍后重试', showCancel: false })
    } finally { this.setData({ creating: false }) }
  },

  retry() { this.onShow() },
  redirectToAuthoritative(destination) {
    if (!destination || !destination.url) throw new Error('服务端下一步缺少目标页面')
    if (destination.method === 'switchTab') return wx.switchTab({ url: destination.url })
    return wx.redirectTo({ url: destination.url })
  },
  recordFrom({ currentTarget }) {
    return this.data.records.find((item) => item.assessmentId === currentTarget.dataset.id) || null
  },
  continueRecord(event) {
    const record = this.recordFrom(event)
    if (!record) return
    wx.navigateTo({ url: `/pages/compass-questionnaire/index?level=${record.level}&studentId=${encodeURIComponent(this.studentId)}&assessmentId=${encodeURIComponent(record.assessmentId)}` })
  },
  viewRecord(event) {
    const record = this.recordFrom(event)
    if (!record) return
    if (record.resultState === 'UNLOCKED' && record.reportId) {
      return wx.navigateTo({ url: `/pages/report/index?id=${encodeURIComponent(record.reportId)}` })
    }
    wx.navigateTo({ url: `/pages/compass-preview/index?assessmentId=${encodeURIComponent(record.assessmentId)}` })
  },
  redoRecord(event) {
    const record = this.recordFrom(event)
    if (!record) return
    const source = record.level === 2 ? `&sourceAssessmentId=${encodeURIComponent(record.sourceAssessmentId || '')}` : ''
    wx.navigateTo({ url: `/pages/compass/index?level=${record.level}&redo=1&studentId=${encodeURIComponent(this.studentId)}${source}` })
  },
  startFirstRecord() {
    wx.redirectTo({ url: `/pages/compass/index?studentId=${encodeURIComponent(this.studentId)}` })
  },
  confirmRecordChange(record, modal, action, doneTitle) {
    if (!record || this.data.recordBusy) return
    wx.showModal({
      ...modal,
      confirmColor: '#9a3f35',
      success: async ({ confirm }) => {
        if (!confirm) return
        this.setData({ recordBusy: true })
        try {
          await action(record.assessmentId)
          wx.showToast({ title: doneTitle, icon: 'success' })
          await this.loadRecords(this.user)
        } catch (error) {
          wx.showModal({ title: '操作失败', content: (error && error.message) || '请稍后重试', showCancel: false })
        } finally { this.setData({ recordBusy: false }) }
      }
    })
  },
  resetRecord(event) {
    this.confirmRecordChange(this.recordFrom(event), {
      title: '清空这份问卷？', content: '已填写的答案会全部清空，从第一题重新开始。', confirmText: '清空'
    }, (assessmentId) => educationCompass.resetDraft(assessmentId), '已清空')
  },
  deleteRecord(event) {
    const record = this.recordFrom(event)
    this.confirmRecordChange(record, {
      title: '删除这份问卷？',
      content: record && record.status === 'DRAFT'
        ? '这份问卷还没提交，删除后已填写的答案无法恢复。'
        : '这份问卷已提交但还没购买报告，删除后问卷和锁定的报告都无法恢复。',
      confirmText: '删除'
    }, (assessmentId) => educationCompass.deleteAssessment(assessmentId), '已删除')
  },
  openReport({ currentTarget }) {
    if (currentTarget.dataset.access !== 'full' && currentTarget.dataset.assessmentId) {
      return wx.navigateTo({ url: `/pages/compass-preview/index?assessmentId=${currentTarget.dataset.assessmentId}` })
    }
    wx.navigateTo({ url: `/pages/report/index?id=${currentTarget.dataset.id}` })
  }
})
