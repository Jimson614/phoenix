const reportService = require('../../services/report')
const reportModel = require('../../models/education-compass-report')
const educationCompass = require('../../services/education-compass')
const payment = require('../../services/payment')
const session = require('../../services/session')
const educationNavigation = require('../../utils/education-compass-navigation')
const runtime = require('../../config/runtime')
const { dateLabel } = require('../../utils/date')

const FIELD_LABELS = {
  status: '状态', code: '信号', label: '名称', title: '主题', summary: '说明', description: '说明',
  focus: '重点', action: '行动', cadence: '频率', owner: '执行人', evidence: '依据',
  subject: '科目', subject_code: '科目', subjectCode: '科目', timeframe: '时间',
  week: '周期', goal: '目标', goals: '行动目标', metric: '观察指标', horizon_days: '计划周期（天）',
  selected_action_code: '本人选择的行动', evidence_refs: '依据题号', education_system: '教育体系',
  grade_stage: '年级／阶段', major_exam_year: '毕业或主要考试年份', target_regions: '考虑地区',
  performance_self_view: '学业状态自我观察', dimension: '维度'
}

const CODE_LABELS = {
  GAOKAO: '内地高考', DSE: '香港 DSE', IGCSE: 'IGCSE', A_LEVEL: 'A-Level', AP_US: 'AP／美式课程', IB: 'IB', OTHER: '其他体系',
  SUPPORTED: '已有回答支持', NEEDS_VALIDATION: '需要进一步验证', UNKNOWN: '暂不确定',
  ACADEMIC_PERFORMANCE: '学业表现', LEARNING_PROCESS: '学习过程', THINKING_LEARNING_STYLE: '思维与学习方式', INTEREST_DIRECTION: '兴趣方向',
  FULL_SYSTEM_BANK: '正式体系题库', SYSTEM_BANK_PENDING: '公共题库 fallback',
  MATH: '数学', CHINESE: '中文／语文', ENGLISH: '英语', PHYSICS: '物理', CHEMISTRY: '化学', BIOLOGY: '生物',
  HISTORY: '历史', GEOGRAPHY: '地理', POLITICS: '政治', ECONOMICS: '经济', BUSINESS: '商业', COMPUTER_SCIENCE: '计算机科学',
  SCIENCE: '科学', ENGINEERING_TECH: '工程与科技', BUSINESS_ECONOMICS: '商业与经济', SOCIAL_PUBLIC: '社会与公共事务',
  LANGUAGE_HUMANITIES: '语言与人文', ARTS_CREATIVE: '艺术与创意', HEALTH_LIFE: '健康与生命', EDUCATION_CHILDREN: '教育与儿童',
  SUBJECT_DIAGNOSIS: '完成一次学科任务诊断', LEARNING_METHOD_PRACTICE: '尝试一套学习方法训练',
  INTEREST_PROJECT: '完成一个小型兴趣项目', SYSTEM_COMPARISON: '了解课程体系差异', PATH_CONSULTATION: '进行一次路径咨询',
  FAMILY_GOAL_ALIGNMENT: '与家长对齐近期目标',
  FOUNDATION_GAP: '基础知识存在卡点', KNOWLEDGE_TRANSFER_GAP: '知识迁移需要加强', FIRST_STEP_GAP: '复杂问题的第一步需要支持',
  ERROR_REVIEW_GAP: '错题复盘需要加强', PLANNING_GAP: '计划与执行节奏需要加强', DIRECTION_CLARITY_GAP: '兴趣方向清晰度待探索',
  FAMILY_GOAL_ALIGNMENT_GAP: '家庭目标需要进一步对齐', SUSTAINED_ENGAGEMENT: '持续投入信号', PLANNING_AND_REVIEW: '计划与复盘信号',
  ERROR_REVIEW_PATTERN: '错题归因与重试信号', PROBLEM_DECOMPOSITION: '问题拆解信号', KNOWLEDGE_RETRIEVAL_STABLE: '知识提取较稳定',
  KNOWLEDGE_RETRIEVAL_GAP: '知识提取需要支持', SUPPORT_CHECK_IN: '建议增加支持性沟通', SELF_SELECTED_FOCUS_UNKNOWN: '本人优先方向尚未确定'
}

const SECTION_TITLES = {
  student_snapshot: 'Student Snapshot / 学生成长快照',
  strength_signals: 'Strength Signals / 优势信号',
  learning_bottlenecks: 'Learning Bottlenecks / 学习卡点',
  subject_focus: 'Subject Focus / 学科重点',
  growth_direction: 'Growth Direction / 成长方向',
  action_plan_30d: '30-Day Action Plan / 30 天行动计划'
}

const DIMENSION_ORDER = [
  { code: 'ACADEMIC_PERFORMANCE', title: '学习表现' },
  { code: 'LEARNING_PROCESS', title: '学习过程' },
  { code: 'THINKING_LEARNING_STYLE', title: '思维与学习方式' },
  { code: 'INTEREST_DIRECTION', title: '兴趣方向' }
]

const SUPPORT_STATE_COPY = {
  AVAILABLE: '当前回答包含由学生或家庭主动提出的深度评估需求，可进入独立授权的顾问表单。',
  CONSIDER: '当前存在需要人工进一步对齐的复合证据，可先了解深度评估并预约顾问。',
  NOT_RECOMMENDED: '根据当前证据暂不建议进入深度评估。',
  DEFERRED: '当前证据不足以主动推荐深度评估，可先执行报告中的 30 天行动计划。'
}

function readableKey(key) {
  return FIELD_LABELS[key] || String(key || '').replace(/_/g, ' ')
}

function codeLabel(value) {
  const code = String(value)
  if (CODE_LABELS[code]) return CODE_LABELS[code]
  if (code.startsWith('SUBJECT_STRENGTH_')) return `学科优势：${codeLabel(code.slice('SUBJECT_STRENGTH_'.length))}`
  if (code.startsWith('SUBJECT_')) return `学科重点：${codeLabel(code.slice('SUBJECT_'.length))}`
  if (code.startsWith('ACTION_')) return `30 天行动：${codeLabel(code.slice('ACTION_'.length))}`
  return code.replace(/_/g, ' ')
}

function valueText(value) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return codeLabel(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join('、')
  return ''
}

function valueLines(value) {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) return value.reduce((lines, item) => lines.concat(valueLines(item)), [])
  const direct = valueText(value)
  if (direct) return [direct]
  if (typeof value !== 'object') return [String(value)]
  const heading = value.title || value.label || value.name
  const detail = value.summary || value.description || value.text
  if (heading || detail) {
    const primary = [heading, detail].filter(Boolean).map(valueText).filter(Boolean).join('：')
    const rest = Object.keys(value).filter((key) => !['title', 'label', 'name', 'summary', 'description', 'text'].includes(key))
      .map((key) => {
        const text = valueText(value[key])
        return text ? `${readableKey(key)}：${text}` : ''
      }).filter(Boolean)
    return [primary].filter(Boolean).concat(rest)
  }
  return Object.keys(value).reduce((lines, key) => {
    const text = valueText(value[key])
    if (text) return lines.concat(`${readableKey(key)}：${text}`)
    return lines.concat(valueLines(value[key]).map((line) => `${readableKey(key)}：${line}`))
  }, [])
}

function growthSection(section, index) {
  return {
    key: section.key,
    title: SECTION_TITLES[section.key] || section.title,
    number: index + 1 < 10 ? `0${index + 1}` : String(index + 1),
    lines: valueLines(section.value)
  }
}

function signalDimension(signal) {
  return signal && (signal.dimension || signal.dimension_code || signal.dimensionCode) || ''
}

function signalStatus(signal) {
  const status = signal && (signal.status || signal.validation_status || signal.validationStatus)
  return ['SUPPORTED', 'NEEDS_VALIDATION', 'UNKNOWN'].includes(status) ? status : 'UNKNOWN'
}

function dimensionPresentation(rendered) {
  const signals = [].concat(rendered.learningSignals || [], rendered.interestSignals || [])
  return DIMENSION_ORDER.map((dimension) => {
    const matching = signals.filter((signal) => signalDimension(signal) === dimension.code)
    const statuses = matching.map(signalStatus)
    const status = statuses.includes('SUPPORTED')
      ? 'SUPPORTED'
      : (statuses.includes('NEEDS_VALIDATION') ? 'NEEDS_VALIDATION' : 'UNKNOWN')
    return {
      code: dimension.code,
      title: dimension.title,
      status,
      statusLabel: CODE_LABELS[status],
      evidenceCount: matching.length
    }
  })
}

function nextSupportPresentation(response) {
  const capability = response && response.capabilities && response.capabilities.nextSupport
    ? response.capabilities.nextSupport
    : {}
  const askwise = capability.askwise || {}
  const deepAssessment = capability.deepAssessment || {}
  const advisor = capability.advisor || {}
  const state = ['AVAILABLE', 'CONSIDER', 'NOT_RECOMMENDED', 'DEFERRED'].includes(deepAssessment.state)
    ? deepAssessment.state
    : 'DEFERRED'
  const deepAdvisorVisible = advisor.available === true &&
    (state === 'AVAILABLE' || state === 'CONSIDER') &&
    deepAssessment.advisorIntent === 'DEEP_ASSESSMENT'
  return {
    askwiseStatus: ['RESERVED', 'BLOCKED', 'DISABLED'].includes(askwise.status) ? askwise.status : 'DISABLED',
    askwiseEnabled: false,
    askwiseLabel: askwise.status === 'RESERVED' ? 'Askwise 即将开放' : 'Askwise 暂未开放',
    deepState: state,
    deepStateCopy: SUPPORT_STATE_COPY[state],
    deepAdvisorVisible,
    advisorIntent: deepAdvisorVisible ? 'DEEP_ASSESSMENT' : ''
  }
}

Page({
  data: {
    reportId: '', response: null, rendered: null, isGrowthReport: false, growthReady: false,
    growthSections: [], dimensionCards: [], evidenceLines: [], questionnaireVersionsLabel: '', growthEducationSystem: '',
    nextSupportVisible: false, nextSupport: null,
    student: null, family: null, dateLabel: '', userRole: '',
    loading: true, error: '', pdfLoading: false, feedbackSending: false, feedbackSent: false,
    paidAnalysisVisible: false, agentEntryVisible: false, agentManagementVisible: false, agentEntryLabel: '了解并开启 AI 追问',
    isDemo: runtime.isDemo(), ratings: [1, 2, 3, 4, 5],
    feedbackTags: [
      { text: '方向清晰', selected: false }, { text: '建议可执行', selected: false },
      { text: '数据可信', selected: false }, { text: '仍需解读', selected: false }
    ],
    feedback: { rating: 0, tags: [], comment: '' }
  },
  onLoad(options) {
    const user = session.guard(['family_user', 'admin'])
    if (!user) return
    this.setData({ reportId: options.id || '', userRole: user.role })
  },
  onShow() { if (this.data.reportId) this.load() },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const response = await reportService.getReport(this.data.reportId)
      const context = response.context || {}
      const user = session.currentUser()
      if (runtime.isDemo() && user && user.role === 'family_user' && context.family && context.family.user_id !== user.id) {
        wx.reLaunch({ url: '/pages/home/index' })
        return
      }
      let rendered = null
      const growthContract = response.reportKind === 'STUDENT_GROWTH_DISCOVERY' || response.report_kind === 'STUDENT_GROWTH_DISCOVERY'
      const renderInput = growthContract && response.full && response.full.result
        ? {
            ...response.full.result,
            reportId: response.reportId,
            resultKind: response.reportKind,
            resultVersion: response.resultVersion,
            resultState: 'FULL'
          }
        : (growthContract
            ? {
                reportId: response.reportId,
                assessmentId: response.assessmentId,
                resultKind: response.reportKind,
                resultVersion: response.resultVersion,
                resultState: 'LOCKED'
              }
            : response)
      try { rendered = reportModel.renderResult(renderInput) }
      catch (error) {
        if (growthContract) throw error
      }
      const isGrowthReport = Boolean(rendered && rendered.rendererKey === reportModel.RENDERER_KEYS.STUDENT_GROWTH)
      const growthReady = Boolean(isGrowthReport && rendered.resultState === 'FULL')
      const snapshot = growthReady ? rendered.sections.find((section) => section.key === 'student_snapshot') : null
      const growthEducationSystem = snapshot && snapshot.value
        ? (snapshot.value.educationSystem || snapshot.value.education_system || rendered.educationSystem || '')
        : (rendered && rendered.educationSystem) || ''
      const familyUser = Boolean(user && user.role === 'family_user')
      this.setData({
        response,
        rendered,
        isGrowthReport,
        growthReady,
        growthSections: growthReady ? rendered.sections.map(growthSection) : [],
        dimensionCards: growthReady ? dimensionPresentation(rendered) : [],
        evidenceLines: growthReady ? valueLines(rendered.evidenceRefs) : [],
        growthEducationSystem,
        questionnaireVersionsLabel: growthReady && rendered.questionnaireVersions.length
          ? rendered.questionnaireVersions.map(valueText).filter(Boolean).join('、')
          : '以服务端审计记录为准',
        student: context.student || this.data.student,
        family: context.family || this.data.family,
        dateLabel: response.createdAt ? dateLabel(response.createdAt) : this.data.dateLabel,
        nextSupportVisible: growthReady && familyUser,
        nextSupport: growthReady ? nextSupportPresentation(response) : null,
        ...this.agentVisibility(response, user)
      })
    } catch (error) {
      this.setData({ error: error.message || '报告加载失败' })
    } finally { this.setData({ loading: false }) }
  },
  agentVisibility(response, user) {
    const capability = response && response.capabilities && response.capabilities.agentFollowup
      ? response.capabilities.agentFollowup
      : {}
    const familyUser = Boolean(user && user.role === 'family_user')
    const paidReportEligible = Boolean(
      familyUser && response && response.access === 'full' && response.status === 'READY' &&
      response.deliveryStatus === 'DELIVERED' && response.qaPassed === true && response.entitled === true
    )
    const eligible = paidReportEligible && capability.available === true
    const hasConversation = Boolean(
      capability.activeConversationId || capability.hasConversations === true ||
      Number(capability.conversationCount || 0) > 0 || capability.managementAvailable === true
    )
    return {
      paidAnalysisVisible: paidReportEligible,
      agentEntryVisible: eligible,
      agentManagementVisible: familyUser && !eligible && hasConversation,
      agentEntryLabel: capability.activeConversationId ? '继续 AI 追问' : '了解并开启 AI 追问'
    }
  },
  openPaidAnalysis() {
    if (runtime.isDemo()) {
      wx.showModal({
        title: '后端联调能力',
        content: '本地演示不会把报告关联数据发送给外部 AI。切换到已配置的 Phoenix remote API 后，监护人可单独同意并发起已购报告 AI 总分析。',
        showCancel: false
      })
      return
    }
    wx.navigateTo({ url: `/pages/assessment-analysis/index?mode=paid&reportId=${encodeURIComponent(this.data.reportId)}` })
  },
  async openPdf() {
    if (this.data.pdfLoading) return
    this.setData({ pdfLoading: true })
    try { await reportService.openPdf(this.data.reportId) }
    catch (error) { wx.showModal({ title: 'PDF 暂不可用', content: error.message || '请稍后重试', showCancel: false }) }
    finally { this.setData({ pdfLoading: false }) }
  },
  chooseRating({ currentTarget }) { this.setData({ 'feedback.rating': Number(currentTarget.dataset.rating) }) },
  toggleFeedbackTag({ currentTarget }) {
    const index = Number(currentTarget.dataset.index)
    const tags = this.data.feedbackTags
    tags[index].selected = !tags[index].selected
    this.setData({ feedbackTags: tags, 'feedback.tags': tags.filter((item) => item.selected).map((item) => item.text) })
  },
  feedbackInput({ detail }) { this.setData({ 'feedback.comment': detail.value }) },
  async submitFeedback() {
    if (!this.data.feedback.rating || this.data.feedbackSending) return wx.showToast({ title: '请先选择评分', icon: 'none' })
    this.setData({ feedbackSending: true })
    try {
      await reportService.submitFeedback(this.data.reportId, this.data.feedback)
      this.setData({ feedbackSent: true })
      wx.showToast({ title: '感谢你的反馈', icon: 'success' })
    } catch (error) { wx.showToast({ title: error.message || '反馈提交失败', icon: 'none' }) }
    finally { this.setData({ feedbackSending: false }) }
  },
  async unlock() {
    const assessmentId = (this.data.rendered && this.data.rendered.assessmentId) || (this.data.response && this.data.response.assessmentId)
    if (assessmentId) return wx.redirectTo({ url: `/pages/compass-preview/index?assessmentId=${assessmentId}` })
    if (!runtime.isDemo()) {
      try {
        const state = await educationCompass.getState()
        const stateAssessmentId = educationNavigation.assessmentIdForReport(state, this.data.reportId)
        if (stateAssessmentId) {
          return wx.redirectTo({ url: `/pages/compass-preview/index?assessmentId=${encodeURIComponent(stateAssessmentId)}` })
        }
      } catch (error) {}
    }
    const cached = payment.listCachedOrders().find((order) => order.reportId === this.data.reportId)
    if (cached && cached.assessmentId) return wx.redirectTo({ url: `/pages/compass-preview/index?assessmentId=${cached.assessmentId}` })
    wx.showToast({ title: '请从 Education Compass 预览页解锁', icon: 'none' })
  },
  contact() {
    const studentId = this.data.student ? this.data.student.id : ''
    wx.navigateTo({ url: `/pages/advisor-request/index?reportId=${encodeURIComponent(this.data.reportId)}&studentId=${encodeURIComponent(studentId)}&intent=GENERAL_ADVISOR` })
  },
  contactDeep() {
    if (!this.data.nextSupport || !this.data.nextSupport.deepAdvisorVisible) return
    const studentId = this.data.student ? this.data.student.id : ''
    wx.navigateTo({ url: `/pages/advisor-request/index?reportId=${encodeURIComponent(this.data.reportId)}&studentId=${encodeURIComponent(studentId)}&intent=DEEP_ASSESSMENT` })
  },
  openAgent() { wx.navigateTo({ url: `/pages/agent-chat/index?reportId=${this.data.reportId}` }) },
  manageAgent() { wx.navigateTo({ url: `/pages/agent-chat/index?reportId=${this.data.reportId}&mode=manage` }) },
  onShareAppMessage() {
    return {
      title: 'Phoenix Education Compass™ 家庭成长入口',
      path: '/pages/welcome/index'
    }
  },
  home() { wx.switchTab({ url: '/pages/home/index' }) },
  retry() { this.load() }
})
