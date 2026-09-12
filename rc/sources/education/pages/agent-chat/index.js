const agent = require('../../services/agent')
const reportService = require('../../services/report')
const session = require('../../services/session')

const FALLBACK_COPY = {
  BLOCKED: '这条信息未发送给解读模型。请改为询问报告中的画像、方向、路线或行动建议。',
  ESCALATE: '如果你或孩子正面临立即危险，请立刻联系可信成年人及当地紧急服务。',
  FAILED: 'AI 解读暂时不可用，已购报告和 PDF 不受影响，请稍后再试。',
  CANCELLED: '本次解读已取消，未消耗成功回复次数。'
}
const MAX_POLL_ATTEMPTS = 60
const MAX_POLL_DURATION_MS = 120000

function capabilityFrom(report) {
  const value = report && report.capabilities && report.capabilities.agentFollowup
    ? report.capabilities.agentFollowup
    : {}
  return {
    available: value.available === true,
    reasonCode: value.reasonCode || null,
    maxRepliesPerReport: Number(value.maxRepliesPerReport || agent.DEFAULT_MAX_REPLIES),
    remainingReplies: Number(value.remainingReplies === undefined ? agent.DEFAULT_MAX_REPLIES : value.remainingReplies),
    activeConversationId: value.activeConversationId || '',
    consentStatus: value.consentStatus || '',
    hasConversations: value.hasConversations === true || Number(value.conversationCount || 0) > 0,
    managementAvailable: value.managementAvailable === true
  }
}

function reportIsEligible(report, capability) {
  return Boolean(
    report && report.access === 'full' && report.status === 'READY' &&
    report.deliveryStatus === 'DELIVERED' && report.qaPassed === true && report.entitled === true &&
    capability && capability.available === true
  )
}

function terminalCopy(run) {
  if (run.status === 'BLOCKED' && /ESCALATE|CRISIS|SELF_HARM|ABUSE/.test(run.code || '')) return FALLBACK_COPY.ESCALATE
  if (run.message && run.message.length <= 300) return run.message
  return FALLBACK_COPY[run.status] || FALLBACK_COPY.FAILED
}

Page({
  data: {
    reportId: '', report: null, capability: null, conversations: [], conversationId: '',
    loading: true, error: '', eligible: false, managementOnly: false,
    consentAccepted: false, consentActive: false, starting: false,
    messages: [], historyLoading: false, draft: '', messageChars: 0,
    maxMessageChars: agent.DEFAULT_MAX_MESSAGE_CHARS,
    maxRepliesPerReport: agent.DEFAULT_MAX_REPLIES,
    remainingReplies: agent.DEFAULT_MAX_REPLIES,
    sending: false, runId: '', runStatus: '', runMessage: '', pollLimitReached: false, canSend: false,
    safetyNotice: 'AI 仅辅助解释已购报告，不保证录取或升学结果。请由监护人陪同使用，勿输入姓名、电话、学校、证件或详细地址。'
  },

  onLoad(options) {
    if (!session.guard(['family_user'])) return
    this.setData({ reportId: options.reportId || options.id || '', managementOnly: options.mode === 'manage' })
  },

  onShow() {
    if (this.data.reportId) this.load()
    else this.setData({ loading: false, error: '缺少报告标识，无法打开 AI 解读。' })
  },

  onHide() { this.stopPolling() },
  onUnload() { this.stopPolling() },

  async load() {
    if (this.loadingRequest) return
    this.loadingRequest = true
    this.stopPolling()
    this.setData({ loading: true, error: '', runMessage: '' })
    try {
      const report = await reportService.getReport(this.data.reportId)
      const capability = capabilityFrom(report)
      let conversations = []
      try { conversations = await agent.listConversations(this.data.reportId) }
      catch (error) {
        if (capability.hasConversations || capability.managementAvailable) throw error
      }
      const active = conversations.find((item) => item.status === 'ACTIVE') ||
        conversations.find((item) => item.conversationId === capability.activeConversationId) || null
      const eligible = reportIsEligible(report, capability)
      const consentActive = Boolean(active && active.consentStatus !== 'REVOKED')
      this.setData({
        report, capability, conversations, eligible,
        conversationId: active ? active.conversationId : '', consentActive,
        maxMessageChars: active ? active.maxMessageChars : agent.DEFAULT_MAX_MESSAGE_CHARS,
        maxRepliesPerReport: capability.maxRepliesPerReport,
        remainingReplies: active ? Math.min(active.remainingReplies, capability.remainingReplies) : capability.remainingReplies,
        messages: eligible && consentActive ? this.data.messages : [],
        canSend: false
      })
      if (eligible && consentActive) await this.loadMessages(active.conversationId)
      if (eligible && consentActive && this.data.runId) this.schedulePoll(250)
    } catch (error) {
      this.setData({ error: error.message || 'AI 解读状态加载失败' })
    } finally {
      this.loadingRequest = false
      this.setData({ loading: false })
      this.updateCanSend()
    }
  },

  async loadMessages(conversationId = this.data.conversationId) {
    if (!conversationId || !this.data.eligible) return
    this.setData({ historyLoading: true })
    try {
      const history = await agent.listMessages(conversationId, { limit: 50 })
      this.setData({ messages: history.messages })
    } catch (error) {
      if (error.statusCode === 403) {
        this.setData({ eligible: false, canSend: false, runMessage: '当前权益或同意已失效；仍可删除会话和撤回同意。' })
      } else {
        this.setData({ runMessage: error.message || '历史消息暂时无法加载' })
      }
    } finally { this.setData({ historyLoading: false }) }
  },

  consentChange({ detail }) {
    const values = detail.value || []
    this.setData({ consentAccepted: values.includes('student') && values.includes('guardian') })
  },

  async startConversation() {
    if (!this.data.eligible || !this.data.consentAccepted || this.data.starting) return
    this.setData({ starting: true, error: '' })
    this.createIdempotencyKey = this.createIdempotencyKey || agent.createIdempotencyKey('conversation')
    try {
      const conversation = await agent.createConversation(this.data.reportId, this.createIdempotencyKey)
      this.createIdempotencyKey = ''
      this.setData({
        conversationId: conversation.conversationId, consentActive: true, consentAccepted: false,
        maxMessageChars: conversation.maxMessageChars,
        maxRepliesPerReport: conversation.maxRepliesPerReport,
        remainingReplies: conversation.remainingReplies,
        conversations: [conversation].concat(this.data.conversations.filter((item) => item.conversationId !== conversation.conversationId))
      })
      this.updateCanSend()
      await this.loadMessages(conversation.conversationId)
    } catch (error) {
      this.setData({ error: error.message || '暂时无法开启 AI 解读' })
    } finally { this.setData({ starting: false }) }
  },

  draftInput({ detail }) {
    const draft = detail.value || ''
    if (draft !== this.data.draft) this.messageIdempotencyKey = ''
    this.setData({ draft, messageChars: draft.length })
    this.updateCanSend()
  },

  updateCanSend() {
    const draft = (this.data.draft || '').trim()
    this.setData({
      canSend: Boolean(
        this.data.eligible && this.data.consentActive && this.data.conversationId &&
        this.data.remainingReplies > 0 && !this.data.sending && !this.data.runId &&
        draft && draft.length <= this.data.maxMessageChars
      )
    })
  },

  async send() {
    if (!this.data.canSend) return
    const message = this.data.draft.trim()
    this.messageIdempotencyKey = this.messageIdempotencyKey || agent.createIdempotencyKey('message')
    this.setData({ sending: true, runMessage: '' })
    this.updateCanSend()
    try {
      const run = await agent.sendMessage(this.data.conversationId, message, this.messageIdempotencyKey)
      this.messageIdempotencyKey = ''
      this.setData({ draft: '', messageChars: 0 })
      if (run.status !== 'BLOCKED') {
        this.setData({ messages: this.data.messages.concat([{
          id: `local_${run.runId || Date.now()}`, role: 'USER', content: message,
          reply: null, safetyState: 'ALLOWED', createdAt: ''
        }]) })
      }
      this.handleRun(run)
    } catch (error) {
      if (error.statusCode === 403) this.setData({ eligible: false, consentActive: false })
      this.setData({ runMessage: error.message || FALLBACK_COPY.FAILED })
    } finally {
      this.setData({ sending: false })
      this.updateCanSend()
    }
  },

  handleRun(run) {
    if (run.remainingReplies !== null) this.setData({ remainingReplies: run.remainingReplies })
    if (run.status === 'SUCCEEDED') {
      this.resetPollBudget()
      this.setData({ runId: '', runStatus: '', runMessage: '', pollLimitReached: false })
      this.load()
      this.updateCanSend()
      return
    }
    if (run.status === 'FAILED' || run.status === 'BLOCKED' || run.status === 'CANCELLED') {
      this.resetPollBudget()
      this.setData({ runId: '', runStatus: run.status, runMessage: terminalCopy(run), pollLimitReached: false })
      this.updateCanSend()
      return
    }
    if (!run.runId) {
      this.resetPollBudget()
      this.setData({
        runId: '', runStatus: 'FAILED', pollLimitReached: false,
        runMessage: '服务端未返回可查询的解读任务，请稍后重试。'
      })
      this.updateCanSend()
      return
    }
    if (this.data.runId !== run.runId || !this.pollStartedAt) {
      this.pollAttempts = 0
      this.pollStartedAt = Date.now()
    }
    this.setData({ runId: run.runId, runStatus: run.status, runMessage: '正在安全地解读报告，请稍候…', pollLimitReached: false })
    this.updateCanSend()
    this.schedulePoll(run.retryAfterMs)
  },

  schedulePoll(delay) {
    this.stopPolling(false)
    const elapsed = this.pollStartedAt ? Date.now() - this.pollStartedAt : 0
    if (this.pollAttempts >= MAX_POLL_ATTEMPTS || elapsed >= MAX_POLL_DURATION_MS) {
      this.setData({
        runStatus: 'PENDING', pollLimitReached: true,
        runMessage: '本次解读仍在后台处理。已停止自动轮询以节省资源，请稍后点击“刷新处理状态”。'
      })
      return
    }
    const parsedDelay = Number(delay)
    const safeDelay = Number.isFinite(parsedDelay) ? Math.max(250, Math.min(parsedDelay, 5000)) : 1000
    this.pollTimer = setTimeout(() => this.pollRun(), safeDelay)
  },

  async pollRun() {
    const runId = this.data.runId
    if (!runId || this.polling) return
    this.polling = true
    this.pollAttempts = (this.pollAttempts || 0) + 1
    try {
      this.handleRun(await agent.getRun(runId))
    } catch (error) {
      this.resetPollBudget()
      const accessLost = [401, 403, 404].includes(Number(error.statusCode))
      this.setData({
        runId: accessLost ? '' : runId,
        runStatus: accessLost ? 'FAILED' : 'PENDING',
        runMessage: accessLost
          ? (error.message || FALLBACK_COPY.FAILED)
          : '暂时无法取得处理状态。已停止自动轮询，请稍后点击“刷新处理状态”；已保留本次任务标识。',
        pollLimitReached: !accessLost
      })
      if ([401, 403].includes(Number(error.statusCode))) this.setData({ eligible: false, consentActive: false })
      this.updateCanSend()
    } finally { this.polling = false }
  },

  stopPolling(clearRun = false) {
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = null
    if (clearRun) {
      this.resetPollBudget()
      this.setData({ runId: '', runStatus: '', pollLimitReached: false })
    }
  },

  resetPollBudget() {
    this.pollAttempts = 0
    this.pollStartedAt = 0
  },

  resumeRunPolling() {
    if (!this.data.runId || !this.data.eligible) return
    this.pollAttempts = 0
    this.pollStartedAt = Date.now()
    this.setData({ pollLimitReached: false, runMessage: '正在刷新处理状态…' })
    this.pollRun()
  },

  withdrawConsent() {
    const conversationId = this.data.conversationId
    if (!conversationId) return
    wx.showModal({
      title: '撤回 AI 同意',
      content: '撤回后将停止解读、关闭会话并取消未完成任务。你仍可删除已保留内容。',
      success: async ({ confirm }) => {
        if (!confirm) return
        try {
          await agent.withdrawConsent(conversationId)
          this.stopPolling(true)
          await this.load()
          wx.showToast({ title: '同意已撤回', icon: 'success' })
        } catch (error) { wx.showToast({ title: error.message || '撤回失败', icon: 'none' }) }
      }
    })
  },

  deleteConversation({ currentTarget } = {}) {
    const conversationId = currentTarget && currentTarget.dataset && currentTarget.dataset.id
      ? currentTarget.dataset.id
      : this.data.conversationId
    if (!conversationId) return
    wx.showModal({
      title: '删除 AI 对话',
      content: '删除会立即撤销产品内访问并清理在线内容；无正文的安全与用量记录可能按政策保留。',
      confirmColor: '#9b4438',
      success: async ({ confirm }) => {
        if (!confirm) return
        try {
          await agent.deleteConversation(conversationId)
          if (conversationId === this.data.conversationId) {
            this.stopPolling(true)
            this.setData({ conversationId: '', consentActive: false, messages: [], draft: '', messageChars: 0 })
          }
          await this.load()
          wx.showToast({ title: '对话已删除', icon: 'success' })
        } catch (error) { wx.showToast({ title: error.message || '删除失败', icon: 'none' }) }
      }
    })
  },

  retry() { this.load() },
  backToReport() { wx.navigateBack() }
})

module.exports = { MAX_POLL_ATTEMPTS, MAX_POLL_DURATION_MS, capabilityFrom, reportIsEligible }
