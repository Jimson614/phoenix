const session = require('../../services/session')
const assessmentService = require('../../services/assessment')
const payment = require('../../services/payment')
const analytics = require('../../services/analytics')
const educationCompass = require('../../services/education-compass')
const questionnaireModel = require('../../models/education-compass-questionnaire')
const reportModel = require('../../models/education-compass-report')
const runtime = require('../../config/runtime')
const { PRODUCT } = require('../../config/compass')

const EXPECTED_AMOUNT_FEN = 3990
const RESULT_LABELS = {
  AVAILABLE: '可以邀请学生本人继续测评',
  CONSIDER: '建议先向学生解释测评边界，再决定是否继续',
  NOT_RECOMMENDED: '当前不建议推动学生继续',
  DEFERRED: '暂缓决定，之后可再确认学生意愿',
  STUDENT_READY_FOR_SELF_ASSESSMENT: '学生愿意本人参与测评',
  STUDENT_NEEDS_EXPLANATION: '学生可能需要先了解测评用途与退出权利',
  STUDENT_DECLINED: '学生当前不愿参与，应尊重其选择',
  STUDENT_READINESS_UNKNOWN: '学生参与意愿尚未确认'
}

function codeLabelMap(bank) {
  return bank.questions.reduce((labels, question) => {
    ;(question.options || []).forEach((option) => { labels[option.code] = option.label })
    if (question.matrix) {
      question.matrix.subjects.forEach((option) => { labels[option.code] = option.label })
      question.matrix.ranges.forEach((option) => { labels[option.code] = option.label })
    }
    return labels
  }, {})
}

function displayLine(value, labels) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string' || typeof value === 'number') return labels[String(value)] || RESULT_LABELS[String(value)] || String(value)
  if (Array.isArray(value)) return value.map((item) => displayLine(item, labels)).filter(Boolean).join('、')
  if (typeof value === 'object') {
    const direct = value.label || value.title || value.summary || value.text || value.name
    if (direct) return displayLine(direct, labels)
    const subject = value.subjectCode || value.subject_code
    const range = value.rangeCode || value.range_code
    if (subject || range) return [labels[subject] || subject, labels[range] || range].filter(Boolean).join(' · ')
    return Object.keys(value).map((key) => displayLine(value[key], labels)).filter(Boolean).join(' · ')
  }
  return String(value)
}

function sectionView(section, labels) {
  const values = Array.isArray(section.value) ? section.value : [section.value]
  return {
    key: section.key,
    title: section.title,
    source: section.source === 'PARENT_OBSERVATION' ? '家长观察' : '',
    lines: values.map((value) => displayLine(value, labels)).filter(Boolean)
  }
}

function familyPresentation(sections) {
  const difficulty = sections.find((section) => section.key === 'observed_difficulty_signals' && section.lines.length)
  const concern = sections.find((section) => section.key === 'family_concerns' && section.lines.length)
  const strength = sections.find((section) => section.key === 'observed_strength_signals' && section.lines.length)
  const primary = difficulty || concern || strength || sections.find((section) => section.lines.length)
  const overviewOrder = ['observed_strength_signals', 'family_concerns', 'family_priorities']
  const overviewCards = overviewOrder.map((key) => sections.find((section) => section.key === key)).filter(Boolean).map((section) => ({
    key: section.key,
    title: section.title,
    value: section.lines[0] || '本次未选择相关内容'
  }))
  return {
    primarySignal: primary && primary.lines[0] ? primary.lines[0] : '已形成一份家庭教育关注快照',
    primarySignalSource: primary ? primary.title : '家庭教育观察',
    overviewCards
  }
}

function paymentParams(result) {
  const value = (result && (result.paymentParams || result.payment_params)) || result || {}
  return {
    timeStamp: value.timeStamp || value.time_stamp || '',
    nonceStr: value.nonceStr || value.nonce_str || '',
    package: value.package || '',
    signType: value.signType || value.sign_type || '',
    paySign: value.paySign || value.pay_sign || ''
  }
}

function invokePayment(params) {
  return new Promise((resolve) => {
    wx.requestPayment({
      ...params,
      success: () => resolve({ clientOutcome: 'accepted' }),
      fail: (error) => resolve({
        clientOutcome: String(error.errMsg || '').toLowerCase().includes('cancel') ? 'cancelled' : 'failed',
        clientMessage: error.errMsg || ''
      })
    })
  })
}

Page({
  data: {
    assessmentId: '', isV05: !runtime.isDemo(), viewKind: '', rendered: null,
    familySections: [], studentReadiness: '', nextStepStatus: '', nextStepReasons: [],
    canStartLevel2: false, primarySignal: '', primarySignalSource: '', overviewCards: [], growthPrice: '', growthPriceError: '',
    preview: null, loading: true, paying: false, error: '',
    product: runtime.isDemo() ? PRODUCT : null, canPurchase: runtime.isDemo(), isDemo: runtime.isDemo(), reportId: ''
  },

  onLoad(options) {
    this.options = options || {}
    this.setData({ assessmentId: options.assessmentId || '' })
  },

  onShow() {
    if (this.data.assessmentId) this.load()
    else this.setData({ loading: false, error: '缺少 Assessment ID，无法读取服务端结果。' })
  },

  load() {
    if (!session.guard(['family_user'])) return Promise.resolve()
    if (runtime.isDemo()) return this.loadLegacy()
    return this.loadV05()
  },

  async loadV05() {
    this.setData({ loading: true, error: '' })
    try {
      const rawResult = await educationCompass.getResult(this.data.assessmentId)
      const rendered = reportModel.renderResult(rawResult)
      if (rendered.rendererKey === reportModel.RENDERER_KEYS.FAMILY_SNAPSHOT) {
        let labels = {}
        try {
          const rawBank = await educationCompass.getAssessmentQuestionnaire(this.data.assessmentId)
          labels = codeLabelMap(questionnaireModel.normalizeQuestionBank(rawBank, { educationSystem: rendered.educationSystem }))
        } catch (error) {}
        const familySections = rendered.sections.map((section) => sectionView(section, labels))
        const presentation = familyPresentation(familySections)
        const canStartLevel2 = rendered.nextStepStatus === 'AVAILABLE'
        let growthPrice = ''
        let growthPriceError = ''
        if (canStartLevel2) {
          try {
            const growthProduct = await educationCompass.getGrowthProduct()
            growthPrice = growthProduct && growthProduct.displayPrice
              ? growthProduct.displayPrice
              : (growthProduct && Number.isFinite(growthProduct.amountFen) ? `¥${(growthProduct.amountFen / 100).toFixed(2)}` : '')
          } catch (error) {
            growthPriceError = error && error.code === 'PRODUCT_CONTRACT_MISMATCH'
              ? '完整报告价格暂不可展示：服务端商品合同需要核验。'
              : '完整报告价格暂不可用，请稍后重试。'
          }
        }
        this.setData({
          viewKind: 'family', rendered,
          familySections,
          ...presentation,
          studentReadiness: displayLine(rendered.studentReadiness, labels) || '尚未形成明确判断',
          nextStepStatus: displayLine(rendered.nextStepStatus, labels) || '可根据家庭意愿决定下一步',
          nextStepReasons: (rendered.nextStepReasonCodes || []).map((value) => displayLine(value, labels)).filter(Boolean),
          canStartLevel2,
          growthPrice,
          growthPriceError,
          product: null, reportId: '', loading: false
        })
        return
      }
      if (rendered.rendererKey !== reportModel.RENDERER_KEYS.STUDENT_GROWTH) throw new Error('当前结果类型不属于 Education Compass V0.5')
      if (rendered.resultState === 'FULL') {
        let reportId = rendered.reportId || ''
        if (!reportId) {
          try {
            const state = await educationCompass.getState()
            if (!state.assessmentId || state.assessmentId === this.data.assessmentId) reportId = state.reportId || ''
          } catch (error) {}
        }
        this.setData({ viewKind: 'growth-full', rendered, reportId, product: null, loading: false })
        return
      }
      const product = await educationCompass.getGrowthProduct()
      if (!product.productCode || !Number.isFinite(product.amountFen) || product.amountFen !== EXPECTED_AMOUNT_FEN ||
        product.currency !== 'CNY' || product.paymentTiming !== 'AFTER_SUBMIT_BEFORE_REPORT') {
        throw new Error('服务端商品配置与已冻结的单次产品不一致，请勿支付')
      }
      this.setData({
        viewKind: 'growth-locked', rendered,
        product: { ...product, displayPrice: product.displayPrice || `¥${(product.amountFen / 100).toFixed(2)}` },
        canPurchase: product.paymentEnabled === true,
        reportId: '', loading: false
      })
    } catch (error) {
      this.setData({ loading: false, error: error.message || '结果加载失败' })
    }
  },

  async loadLegacy() {
    this.setData({ loading: true, error: '' })
    try {
      const preview = await assessmentService.preview(this.data.assessmentId)
      this.setData({ preview, viewKind: 'legacy', product: PRODUCT })
    } catch (error) {
      this.setData({ error: error.message || '预览加载失败' })
    } finally { this.setData({ loading: false }) }
  },

  async purchase() {
    if (runtime.isDemo()) return this.purchaseLegacy()
    if (this.data.paying || this.data.viewKind !== 'growth-locked' || !this.data.product || !this.data.canPurchase) return
    this.setData({ paying: true })
    try {
      this.orderKey = this.orderKey || educationCompass.createIdempotencyKey('growth_order')
      const order = await educationCompass.createGrowthOrder(this.data.assessmentId, this.orderKey)
      if (order.productCode !== this.data.product.productCode || order.amountFen !== this.data.product.amountFen) {
        throw new Error('订单商品或金额与服务端产品不一致，请勿支付')
      }
      if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(order.status)) {
        this.orderKey = ''
        throw new Error('当前订单已失效，请再次点击创建新订单')
      }
      if (order.status === 'PAID') {
        const verified = await educationCompass.getOrder(order.orderId)
        this.orderKey = ''
        return this.goToVerifiedOrder(verified, 'already_paid')
      }
      const prepay = await educationCompass.createWechatPrepay(order.orderId)
      const params = paymentParams(prepay)
      if (!params.timeStamp || !params.nonceStr || !params.package || !params.signType || !params.paySign) {
        throw new Error('微信支付参数不完整，请稍后重试')
      }
      const client = await invokePayment(params)
      const verified = await educationCompass.getOrder(order.orderId)
      this.orderKey = ''
      analytics.track('education_growth_payment_client_returned', {
        userId: session.currentUser().id,
        properties: { assessment_id: this.data.assessmentId, order_id: order.orderId, client_outcome: client.clientOutcome, verified_status: verified.status }
      })
      this.goToVerifiedOrder(verified, client.clientOutcome)
    } catch (error) {
      wx.showModal({ title: '暂时无法支付', content: error.message || '请稍后重试', showCancel: false })
    } finally { this.setData({ paying: false }) }
  },

  goToVerifiedOrder(order, clientOutcome) {
    if (order.status === 'PAID' && order.reportId) {
      wx.redirectTo({ url: `/pages/report/index?id=${encodeURIComponent(order.reportId)}` })
      return
    }
    wx.redirectTo({
      url: `/pages/payment-result/index?orderId=${encodeURIComponent(order.orderId)}&reportId=${encodeURIComponent(order.reportId || '')}&clientOutcome=${encodeURIComponent(clientOutcome || '')}`
    })
  },

  async purchaseLegacy() {
    if (this.data.paying || !this.data.preview || !this.data.preview.canPurchase) return
    this.setData({ paying: true })
    try {
      const order = await payment.createOrder(this.data.assessmentId)
      if (order.amountFen !== PRODUCT.amountFen || order.productCode !== PRODUCT.code) throw new Error('订单商品或金额校验失败，请勿支付并联系客服')
      if (order.status === 'PAID') return wx.redirectTo({ url: `/pages/report/index?id=${order.reportId}` })
      const clientResult = await payment.requestWeChatPayment(order.orderId)
      wx.redirectTo({ url: `/pages/payment-result/index?orderId=${order.orderId}&reportId=${order.reportId}&clientOutcome=${clientResult.clientOutcome}` })
    } catch (error) {
      wx.showModal({ title: '暂时无法支付', content: error.message || '请稍后重试', showCancel: false })
    } finally { this.setData({ paying: false }) }
  },

  startStudentAssessment() {
    const result = this.data.rendered
    if (!result || !result.studentId) return wx.showToast({ title: '缺少 Student ID，请返回重试', icon: 'none' })
    wx.navigateTo({
      url: `/pages/compass/index?level=2&studentId=${encodeURIComponent(result.studentId)}&sourceAssessmentId=${encodeURIComponent(result.assessmentId || this.data.assessmentId)}`
    })
  },

  openGrowthReport() {
    if (this.data.reportId) wx.redirectTo({ url: `/pages/report/index?id=${encodeURIComponent(this.data.reportId)}` })
    else wx.showToast({ title: '报告正在生成，请稍后刷新', icon: 'none' })
  },

  openFreeAnalysis() {
    if (!this.data.preview || !this.data.assessmentId) return
    wx.showModal({
      title: '后端联调能力',
      content: '本地演示不会把测评数据发送给外部 AI。切换到已配置的 Phoenix remote API 后，监护人可单独同意并生成免费有限分析。',
      showCancel: false
    })
  },

  onShareAppMessage() {
    return {
      title: 'Phoenix Education Compass™ 家庭成长入口',
      path: '/pages/welcome/index'
    }
  },

  home() { wx.switchTab({ url: '/pages/home/index' }) },
  retry() { this.load() }
})
