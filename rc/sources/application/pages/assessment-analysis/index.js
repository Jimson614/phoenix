const analysis = require('../../services/agent-analysis')
const agent = require('../../services/agent')
const session = require('../../services/session')

const MAX_POLL_ATTEMPTS = 60
const MAX_POLL_DURATION_MS = 120000
const COPY = {
  free: {
    eyebrow: 'FREE ASSESSMENT AI ANALYSIS',
    title: '免费测评 · 有限 AI 分析',
    consentLead: '服务端只会从本次已提交测评中选取生成有限概览所需的最小字段。',
    boundary: '这是一次有限测评分析，不包含付费完整报告的六模块内容、PDF或报告追问。',
    running: '正在生成免费测评的有限分析，请稍候…',
    unavailable: '免费测评 AI 分析暂未开启，请稍后再试；测评结果和免费预览不受影响。'
  },
  paid: {
    eyebrow: 'PAID REPORT AI ANALYSIS',
    title: '已购完整报告 · AI 总分析',
    consentLead: '服务端只使用报告关联的受控选项、结构化结论与核验来源；不发送六模块原文、问卷自由文本或客户资料。',
    boundary: '这是完整已购报告的一次性结构化分析；报告追问是下一个独立能力，仍会再次经过服务端门禁。',
    running: '正在分析已购完整报告，请稍候…',
    unavailable: '已购报告 AI 分析暂未开启；完整报告、PDF和原有服务不受影响。'
  }
}

function safeStatusMessage(run, mode) {
  const code = String(run.code || '').toUpperCase()
  if (code.includes('PII')) return '为保护孩子与家庭隐私，请勿提交姓名、电话、邮箱、学校、证件或详细地址。服务端已阻止本次处理。'
  if (/CRISIS|SELF_HARM|ABUSE|ESCALATE/.test(code)) {
    return '如果孩子或任何人正面临立即危险，请立刻联系身边可信成年人和当地紧急服务；本功能不能处理危机情况。'
  }
  if (/DISABLED|NOT_ENABLED|NOT_CONFIGURED/.test(code)) return COPY[mode].unavailable
  if (/PAYMENT|ENTITLEMENT|REPORT_ACCESS/.test(code)) return '服务端未确认当前报告权益，未执行分析。请返回报告刷新状态或联系客服。'
  if (/ASSESSMENT.*(?:INCOMPLETE|NOT_READY)|PREVIEW_NOT_READY/.test(code)) return '测评尚未达到服务端生成条件，请返回问卷补充资料后重试。'
  if (/RATE_LIMIT/.test(code)) return '请求较多，请稍后再试。测评、报告和支付状态不受影响。'
  if (run.message && run.message.length <= 300) return run.message
  if (run.status === 'CANCELLED') return '本次分析已取消，测评、报告和支付状态不受影响。'
  if (run.status === 'BLOCKED') return '服务端安全检查已阻止本次分析，请按提示调整后重试。'
  return COPY[mode].unavailable
}

Page({
  data: {
    mode: 'free', copy: COPY.free, assessmentId: '', reportId: '',
    consentAccepted: false, starting: false, phase: 'CONSENT',
    runId: '', runStatus: '', statusMessage: '', pollLimitReached: false,
    reply: null
  },

  onLoad(options) {
    if (!session.guard(['family_user'])) return
    const mode = options.mode === 'paid' ? 'paid' : 'free'
    const assessmentId = options.assessmentId || ''
    const reportId = options.reportId || ''
    const missingTarget = (mode === 'paid' && !reportId) || (mode === 'free' && !assessmentId)
    this.setData({
      mode, copy: COPY[mode], assessmentId, reportId,
      ...(missingTarget ? { phase: 'ERROR', statusMessage: mode === 'paid' ? '缺少报告标识，无法发起分析。' : '缺少测评标识，无法发起分析。' } : {})
    })
  },

  onShow() {
    this.hidden = false
    if (!this.latestLoaded && this.targetIsPresent()) {
      this.loadLatest()
      return
    }
    if (this.data.runId && ['QUEUED', 'RUNNING', 'PENDING'].includes(this.data.runStatus) && !this.data.pollLimitReached) {
      this.schedulePoll(250)
    }
  },
  onHide() { this.hidden = true; this.stopPolling() },
  onUnload() { this.hidden = true; this.stopPolling() },

  consentChange({ detail }) {
    const values = detail.value || []
    this.setData({ consentAccepted: values.includes('student') && values.includes('guardian') })
  },

  targetIsPresent() {
    return this.data.mode === 'paid' ? Boolean(this.data.reportId) : Boolean(this.data.assessmentId)
  },

  async loadLatest() {
    if (this.latestLoading || this.latestLoaded) return
    this.latestLoading = true
    this.setData({ phase: 'LOADING', statusMessage: '正在从 Phoenix 服务端查询最近一次分析…' })
    try {
      const run = this.data.mode === 'paid'
        ? await analysis.getLatestPaidAnalysis(this.data.reportId)
        : await analysis.getLatestFreeAnalysis(this.data.assessmentId)
      this.latestLoaded = true
      if (run) this.handleRun(run)
      else this.setData({ phase: 'CONSENT', statusMessage: '' })
    } catch (error) {
      this.latestLoaded = true
      this.setData({ phase: 'ERROR', statusMessage: safeStatusMessage({ status: 'FAILED', code: error.code, message: error.message }, this.data.mode) })
    } finally { this.latestLoading = false }
  },

  async startAnalysis() {
    if (!this.data.consentAccepted || this.data.starting) return
    if ((this.data.mode === 'paid' && !this.data.reportId) || (this.data.mode === 'free' && !this.data.assessmentId)) return
    this.setData({ starting: true, phase: 'RUNNING', statusMessage: this.data.copy.running, reply: null, pollLimitReached: false })
    this.idempotencyKey = this.idempotencyKey || agent.createIdempotencyKey(`${this.data.mode}_analysis`)
    try {
      const run = this.data.mode === 'paid'
        ? await analysis.createPaidAnalysis(this.data.reportId, this.idempotencyKey)
        : await analysis.createFreeAnalysis(this.data.assessmentId, this.idempotencyKey)
      this.idempotencyKey = ''
      this.handleRun(run)
    } catch (error) {
      this.setData({ phase: 'ERROR', statusMessage: safeStatusMessage({ status: 'FAILED', code: error.code, message: error.message }, this.data.mode) })
    } finally { this.setData({ starting: false }) }
  },

  handleRun(run) {
    const status = String(run.status || 'QUEUED').toUpperCase()
    const expectedType = this.data.mode === 'paid' ? 'REPORT_ANALYSIS' : 'ASSESSMENT_ANALYSIS'
    if (run.analysisType !== expectedType) {
      this.stopPolling()
      this.resetPollBudget()
      this.setData({ runId: '', runStatus: 'FAILED', phase: 'ERROR', reply: null, pollLimitReached: false,
        statusMessage: '服务端返回的分析类型与当前入口不一致，结果未展示。请稍后重试。' })
      return
    }
    if (status === 'SUCCEEDED') {
      this.stopPolling()
      this.resetPollBudget()
      if (!run.reply || !run.reply.answer) {
        this.setData({ runId: '', runStatus: 'FAILED', phase: 'ERROR', statusMessage: '服务端返回的分析结果不完整，请稍后重试。', pollLimitReached: false })
        return
      }
      this.setData({ runId: '', runStatus: status, phase: 'RESULT', reply: run.reply, statusMessage: '', pollLimitReached: false })
      return
    }
    if (['FAILED', 'BLOCKED', 'CANCELLED'].includes(status)) {
      this.stopPolling()
      this.resetPollBudget()
      this.setData({ runId: '', runStatus: status, phase: status === 'BLOCKED' ? 'BLOCKED' : 'ERROR', statusMessage: safeStatusMessage(run, this.data.mode), reply: null, pollLimitReached: false })
      return
    }
    if (!run.runId) {
      this.stopPolling()
      this.resetPollBudget()
      this.setData({ runId: '', runStatus: 'FAILED', phase: 'ERROR', reply: null, pollLimitReached: false,
        statusMessage: '服务端未返回可查询的分析任务，请稍后重试。' })
      return
    }
    if (this.data.runId !== run.runId || !this.pollStartedAt) {
      this.pollAttempts = 0
      this.pollStartedAt = Date.now()
    }
    this.setData({ runId: run.runId, runStatus: status, phase: 'RUNNING', statusMessage: this.data.copy.running, pollLimitReached: false })
    this.schedulePoll(run.retryAfterMs)
  },

  schedulePoll(delay) {
    this.stopPolling()
    if (this.hidden || !this.data.runId) return
    const elapsed = this.pollStartedAt ? Date.now() - this.pollStartedAt : 0
    if ((this.pollAttempts || 0) >= MAX_POLL_ATTEMPTS || elapsed >= MAX_POLL_DURATION_MS) {
      this.setData({
        phase: 'PENDING', runStatus: 'PENDING', pollLimitReached: true,
        statusMessage: '分析仍在后台处理。已停止自动轮询，请稍后点击“刷新处理状态”；本次任务标识仍保留在当前页面内存。'
      })
      return
    }
    this.pollTimer = setTimeout(() => this.pollRun(), Math.max(250, Math.min(Number(delay || 1000), 5000)))
  },

  async pollRun() {
    const runId = this.data.runId
    if (!runId || this.polling || this.hidden) return
    this.polling = true
    this.pollAttempts = (this.pollAttempts || 0) + 1
    try {
      this.handleRun(await analysis.getAnalysis(runId, this.data.mode))
    } catch (error) {
      this.stopPolling()
      this.resetPollBudget()
      const accessLost = [401, 403, 404].includes(Number(error.statusCode))
      this.setData({
        runId: accessLost ? '' : runId,
        runStatus: accessLost ? 'FAILED' : 'PENDING',
        phase: accessLost ? 'ERROR' : 'PENDING',
        pollLimitReached: !accessLost,
        statusMessage: accessLost
          ? safeStatusMessage({ status: 'FAILED', code: error.code, message: error.message }, this.data.mode)
          : '暂时无法取得分析状态。已停止自动轮询，请稍后点击“刷新处理状态”；本次任务标识仍保留在当前页面内存。'
      })
    } finally { this.polling = false }
  },

  resumePolling() {
    if (!this.data.runId) return
    this.pollAttempts = 0
    this.pollStartedAt = Date.now()
    this.setData({ phase: 'RUNNING', pollLimitReached: false, statusMessage: '正在刷新服务端处理状态…' })
    this.pollRun()
  },

  retryAnalysis() {
    this.stopPolling()
    this.resetPollBudget()
    this.setData({ phase: 'CONSENT', runId: '', runStatus: '', statusMessage: '', reply: null, consentAccepted: false, pollLimitReached: false })
  },

  stopPolling() {
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = null
  },
  resetPollBudget() { this.pollAttempts = 0; this.pollStartedAt = 0 },
  back() { wx.navigateBack() }
})

module.exports = { COPY, MAX_POLL_ATTEMPTS, MAX_POLL_DURATION_MS, safeStatusMessage }
