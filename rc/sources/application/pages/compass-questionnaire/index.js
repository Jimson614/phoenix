const familyData = require('../../services/family-data')
const session = require('../../services/session')
const assessmentService = require('../../services/assessment')
const legacyQuestionnaire = require('../../models/questionnaire-schema')
const educationCompass = require('../../services/education-compass')
const questionnaireModel = require('../../models/education-compass-questionnaire')
const runtime = require('../../config/runtime')
const analytics = require('../../services/analytics')

const QUESTIONS_PER_STEP = 4
const UI_SCREENS = Object.freeze({
  FREE: 'education-compass-free-questionnaire',
  GROWTH: 'education-compass-growth-questionnaire',
  LEGACY: 'education-compass-legacy-questionnaire'
})

function uiScreen(level) {
  return Number(level) === 2 ? UI_SCREENS.GROWTH : UI_SCREENS.FREE
}

function initialAnswers(student, cached) {
  if (Object.keys(cached || {}).length) return cached
  return {
    education_system: student.education_system || '',
    interests: student.interest || '',
    future_goal: student.goal || ''
  }
}

function chunkQuestions(questions, respondentHint) {
  const steps = []
  for (let index = 0; index < questions.length; index += QUESTIONS_PER_STEP) {
    steps.push({
      key: `group_${Math.floor(index / QUESTIONS_PER_STEP) + 1}`,
      title: '请按最近真实情况作答',
      hint: respondentHint || '答案没有高低之分；“尚未确定”也是有效回答。',
      questionStart: index + 1,
      questionEnd: Math.min(index + QUESTIONS_PER_STEP, questions.length),
      questions: questions.slice(index, index + QUESTIONS_PER_STEP)
    })
  }
  return steps
}

function toIdAnswers(bank, keyAnswers) {
  return bank.questions.reduce((answers, question) => {
    if (keyAnswers[question.key] !== undefined) answers[question.id] = keyAnswers[question.key]
    return answers
  }, {})
}

function toKeyAnswers(bank, idAnswers) {
  return bank.questions.reduce((answers, question) => {
    if (idAnswers[question.id] !== undefined) answers[question.key] = idAnswers[question.id]
    else if (idAnswers[question.key] !== undefined) answers[question.key] = idAnswers[question.key]
    return answers
  }, {})
}

function toApiAnswers(bank, idAnswers) {
  return bank.questions.reduce((answers, question) => {
    const value = idAnswers[question.id]
    if (value === undefined) return answers
    if (question.type === questionnaireModel.QUESTION_TYPES.SUBJECT_RANGE_MATRIX) {
      answers[question.id] = (Array.isArray(value) ? value : []).map((row) => ({
        subject_code: row.subject_code || row.subjectCode,
        range_code: row.range_code || row.rangeCode
      }))
    } else answers[question.id] = value
    return answers
  }, {})
}

function questionGuidance(question) {
  if (question.key === 'student_self_confirmation') {
    return '若当前不是学生本人，可选择退出；草稿会保存，且不会生成结果或负面信号。'
  }
  if (question.key === 'education_system') {
    return '选择后会更新相应体系题库；IB 与其他体系当前使用公共题 fallback。'
  }
  if (question.key === 'education_pathway_target_codes') {
    return '选填背景项，不参与教育体系题库路由、评分或自动形成学历／录取结论。'
  }
  if (question.type === questionnaireModel.QUESTION_TYPES.SUBJECT_RANGE_MATRIX) {
    return '成绩区间为选填；不填写不会形成负面评价。'
  }
  if ([questionnaireModel.QUESTION_TYPES.MULTI_CHOICE, questionnaireModel.QUESTION_TYPES.MULTI_CHOICE_DYNAMIC].includes(question.type)) {
    const maxSelections = Number(question.validation && question.validation.maxSelections)
    return Number.isInteger(maxSelections) && maxSelections > 0
      ? `最多选 ${maxSelections} 项。`
      : '可多选。'
  }
  return ''
}

function decorateMatrixQuestion(question) {
  const decorated = { ...question, guidance: questionGuidance(question) }
  if (question.type !== questionnaireModel.QUESTION_TYPES.SUBJECT_RANGE_MATRIX) return decorated
  const rows = (question.value || []).map((row) => {
    const subjectCode = row.subjectCode || row.subject_code
    const rangeCode = row.rangeCode || row.range_code
    const subject = question.matrix.subjects.find((option) => option.code === subjectCode)
    const range = question.matrix.ranges.find((option) => option.code === rangeCode)
    return {
      subjectCode,
      rangeCode,
      subjectLabel: subject ? subject.label : subjectCode,
      rangeLabel: range ? range.label : rangeCode,
      rangeIndex: Math.max(0, question.matrix.ranges.findIndex((option) => option.code === rangeCode))
    }
  })
  return {
    ...decorated,
    value: rows,
    matrixPickerRange: [question.matrix.subjects.map((option) => option.label), question.matrix.ranges.map((option) => option.label)],
    matrixRangeLabels: question.matrix.ranges.map((option) => option.label)
  }
}

function systemRouteHint(bank) {
  if (!bank || bank.assessmentKind !== educationCompass.ASSESSMENT_KINDS.STUDENT_GROWTH) return ''
  const systemQuestion = bank.questionByKey && bank.questionByKey.education_system
  const selectedOption = systemQuestion && systemQuestion.options.find((option) => option.code === bank.educationSystem)
  const systemLabel = selectedOption ? selectedOption.label : bank.educationSystem
  if (!bank.educationSystem) return '请先选择教育体系；正式体系会加载对应分支题，IB 与其他体系暂用公共题 fallback。'
  if (bank.systemFallback) return `当前为 ${systemLabel}：首版使用公共题 fallback，不会混入其他体系的正式分支题。`
  return `当前按 ${systemLabel} 加载公共题与体系分支题；如切换体系，公共答案会保留，分支题会更新。`
}

Page({
  data: {
    isV05: !runtime.isDemo(), level: 1,
    uiScreen: UI_SCREENS.FREE,
    student: { id: '', name: '' }, family: null, assessmentId: '', steps: [], stepIndex: 0, current: null,
    progress: 0, completenessScore: 0, threshold: 70, coverage: 0, revision: 0,
    answeredCount: 0, totalQuestions: 0, requiredQuestions: 0,
    currentRangeLabel: '正在准备题目', estimatedMinutesLabel: '约 3—5 分钟',
    experienceEyebrow: 'FREE PARENT EDUCATION COMPASS', experienceTitle: '', experienceSummary: '',
    respondentHint: '', completionOutcome: '', primaryActionHint: '', systemRouteHint: '',
    loading: true, error: '', saving: false, submitting: false, routeReloading: false,
    savedLabel: '草稿自动保存'
  },

  async onLoad(options) {
    this.options = options || {}
    const level = String(options.level || '') === '2' ? 2 : 1
    this.setData({
      isV05: !runtime.isDemo(), level, uiScreen: runtime.isDemo() ? UI_SCREENS.LEGACY : uiScreen(level),
      estimatedMinutesLabel: level === 2 ? '约 15—20 分钟' : '约 3—5 分钟',
      assessmentId: options.assessmentId || ''
    })
    if (runtime.isDemo()) return this.loadLegacy(options)
    return this.loadV05(options)
  },

  async loadV05(options) {
    const user = session.guard(['family_user'])
    if (!user) return
    if (!options.assessmentId) return this.setData({ loading: false, error: '缺少 Assessment ID，无法读取服务端草稿。' })
    this.setData({ loading: true, error: '' })
    try {
      const [rawBank, draft, state] = await Promise.all([
        educationCompass.getAssessmentQuestionnaire(options.assessmentId),
        educationCompass.getDraft(options.assessmentId),
        educationCompass.getState()
      ])
      const draftAnswers = draft.answers || {}
      const educationSystem = draftAnswers.EGD03 || draftAnswers.education_system || state.educationSystem || ''
      const bank = questionnaireModel.normalizeQuestionBank(rawBank, { educationSystem, assessmentKind: draft.assessmentKind })
      this.remoteBank = bank
      this.remoteAnswers = toIdAnswers(bank, toKeyAnswers(bank, draftAnswers))
      this.editGeneration = 0
      this.dirty = false
      const level = draft.assessmentKind === educationCompass.ASSESSMENT_KINDS.STUDENT_GROWTH ? 2 : 1
      this.setData({
        student: { id: options.studentId || state.studentId || '', name: state.studentDisplayName || '学生本人' },
        assessmentId: options.assessmentId,
        level,
        uiScreen: uiScreen(level),
        revision: draft.revision,
        savedLabel: draft.revision ? `已恢复服务端草稿 · v${draft.revision}` : '尚未填写', loading: false
      })
      this.applyRemoteView(0)
    } catch (error) {
      this.setData({ loading: false, error: error.message || '问卷或草稿加载失败' })
    }
  },

  async loadLegacy(options) {
    const user = session.guard(['family_user'])
    if (!user) return
    try {
      const family = await familyData.getFamily(user.id)
      const student = family ? await familyData.getStudent(family.id, options.studentId) : null
      if (!family || !student || student.family_id !== family.id) return wx.reLaunch({ url: '/pages/home/index' })
      if (!options.assessmentId) return wx.redirectTo({ url: `/pages/compass/index?studentId=${student.id}` })
      const draft = await assessmentService.loadDraft(options.assessmentId)
      const answers = { ...initialAnswers(student, {}), ...(draft.answers || {}) }
      const steps = legacyQuestionnaire.viewSteps(answers)
      const completion = legacyQuestionnaire.completeness(answers)
      this.setData({
        uiScreen: UI_SCREENS.LEGACY,
        student, family, assessmentId: options.assessmentId, steps, current: steps[0], stepIndex: 0,
        progress: 100 / steps.length, completenessScore: completion.score, threshold: completion.threshold, loading: false
      })
    } catch (error) {
      this.setData({ loading: false, error: error.message || '问卷加载失败' })
    }
  },

  applyRemoteView(preferredStep) {
    const keyAnswers = toKeyAnswers(this.remoteBank, this.remoteAnswers || {})
    const view = questionnaireModel.buildViewModel(this.remoteBank, keyAnswers)
    const presentation = this.remoteBank.presentation || {}
    const questions = view.questions.map(decorateMatrixQuestion)
    const steps = chunkQuestions(questions, presentation.respondentHint)
    const stepIndex = Math.max(0, Math.min(preferredStep === undefined ? this.data.stepIndex : preferredStep, steps.length - 1))
    const totalQuestions = questions.length
    const requiredQuestions = questions.filter((question) => question.required).length
    const answeredCount = this.remoteBank.questions.filter((question) => !questionnaireModel.isEmpty((this.remoteAnswers || {})[question.id])).length
    const defaultMin = this.data.level === 2 ? 15 : 3
    const defaultMax = this.data.level === 2 ? 20 : 5
    const min = Number(presentation.estimatedMinutesMin)
    const max = Number(presentation.estimatedMinutesMax)
    const estimatedMinutesMin = Number.isFinite(min) && min > 0 ? min : defaultMin
    const estimatedMinutesMax = Number.isFinite(max) && max >= estimatedMinutesMin ? max : defaultMax
    const current = steps[stepIndex] || null
    this.setData({
      steps, stepIndex, current, coverage: view.coverage,
      answeredCount, totalQuestions, requiredQuestions,
      currentRangeLabel: current ? `第 ${current.questionStart}—${current.questionEnd} 题` : '当前没有题目',
      estimatedMinutesLabel: `约 ${estimatedMinutesMin}—${estimatedMinutesMax} 分钟`,
      progress: totalQuestions ? (answeredCount / totalQuestions) * 100 : 0,
      experienceEyebrow: presentation.experienceEyebrow || '',
      experienceTitle: presentation.experienceTitle || '',
      experienceSummary: presentation.experienceSummary || '',
      respondentHint: presentation.respondentHint || '',
      completionOutcome: presentation.completionOutcome || '',
      primaryActionHint: presentation.primaryActionHint || '',
      systemRouteHint: systemRouteHint(this.remoteBank)
    })
  },

  collectAnswers() {
    const answers = {}
    this.data.steps.forEach((step) => step.questions.forEach((item) => { answers[item.key] = item.value }))
    return answers
  },

  refreshCompletion() {
    const completion = legacyQuestionnaire.completeness(this.collectAnswers())
    this.setData({ completenessScore: completion.score })
    return completion
  },

  choose(event) {
    if (this.data.isV05) return this.chooseV05(event)
    const questionIndex = Number(event.currentTarget.dataset.question)
    const optionIndex = Number(event.currentTarget.dataset.option)
    const stepIndex = this.data.stepIndex
    const steps = this.data.steps
    const target = steps[stepIndex].questions[questionIndex]
    if (target.type === 'single') {
      target.options.forEach((option, index) => { option.selected = index === optionIndex })
      target.value = target.options[optionIndex].text
    } else {
      target.options[optionIndex].selected = !target.options[optionIndex].selected
      target.value = target.options.filter((option) => option.selected).map((option) => option.text)
    }
    this.setData({ steps, current: steps[stepIndex] }, () => { this.refreshCompletion(); this.scheduleSave() })
  },

  chooseV05({ currentTarget }) {
    if (this.data.saving || this.data.submitting || this.data.routeReloading) return
    const questionId = currentTarget.dataset.id
    const optionCode = currentTarget.dataset.code
    const question = this.remoteBank.questions.find((item) => item.id === questionId)
    if (!question) return
    const types = questionnaireModel.QUESTION_TYPES
    const previous = this.remoteAnswers[questionId]
    if ([types.SINGLE_CHOICE, types.YEAR_SELECT, types.PROVINCE_REGION_SELECT].includes(question.type)) {
      this.remoteAnswers[questionId] = optionCode
    } else {
      let values = Array.isArray(previous) ? previous.slice() : []
      const exclusive = question.validation.exclusiveOptions || []
      if (values.includes(optionCode)) values = values.filter((code) => code !== optionCode)
      else if (exclusive.includes(optionCode)) values = [optionCode]
      else {
        values = values.filter((code) => !exclusive.includes(code))
        const max = Number(question.validation.maxSelections || question.options.length)
        if (values.length >= max) return wx.showToast({ title: `最多选择 ${max} 项`, icon: 'none' })
        values.push(optionCode)
      }
      this.remoteAnswers[questionId] = values
    }
    this.markRemoteDirty()
    this.applyRemoteView()
    if (question.key === 'student_self_confirmation' && optionCode === 'EXIT_NOT_STUDENT') {
      this.saveAndExit(true)
      return
    }
    if (question.key === 'education_system' && previous !== optionCode) this.changeEducationSystem(optionCode)
    else this.scheduleSave()
  },

  addMatrixRow({ currentTarget, detail }) {
    const question = this.remoteBank.questions.find((item) => item.id === currentTarget.dataset.id)
    if (!question || !question.matrix) return
    const indexes = detail.value || []
    const subject = question.matrix.subjects[Number(indexes[0])]
    const range = question.matrix.ranges[Number(indexes[1])]
    if (!subject || !range) return
    const rows = Array.isArray(this.remoteAnswers[question.id]) ? this.remoteAnswers[question.id].slice() : []
    const existing = rows.find((row) => (row.subjectCode || row.subject_code) === subject.code)
    if (existing) existing.rangeCode = range.code
    else {
      const maxRows = Number(question.validation.maxRows || question.matrix.subjects.length)
      if (rows.length >= maxRows) return wx.showToast({ title: `最多填写 ${maxRows} 科`, icon: 'none' })
      rows.push({ subjectCode: subject.code, rangeCode: range.code })
    }
    this.remoteAnswers[question.id] = rows
    this.markRemoteDirty(); this.applyRemoteView(); this.scheduleSave()
  },

  updateMatrixRange({ currentTarget, detail }) {
    const question = this.remoteBank.questions.find((item) => item.id === currentTarget.dataset.id)
    if (!question || !question.matrix) return
    const rows = Array.isArray(this.remoteAnswers[question.id]) ? this.remoteAnswers[question.id].slice() : []
    const row = rows[Number(currentTarget.dataset.row)]
    const range = question.matrix.ranges[Number(detail.value)]
    if (!row || !range) return
    row.rangeCode = range.code
    this.remoteAnswers[question.id] = rows
    this.markRemoteDirty(); this.applyRemoteView(); this.scheduleSave()
  },

  removeMatrixRow({ currentTarget }) {
    const question = this.remoteBank.questions.find((item) => item.id === currentTarget.dataset.id)
    if (!question) return
    const rows = Array.isArray(this.remoteAnswers[question.id]) ? this.remoteAnswers[question.id].slice() : []
    rows.splice(Number(currentTarget.dataset.row), 1)
    this.remoteAnswers[question.id] = rows
    this.markRemoteDirty(); this.applyRemoteView(); this.scheduleSave()
  },

  typeAnswer({ currentTarget, detail }) {
    if (this.data.isV05) return
    const questionIndex = Number(currentTarget.dataset.question)
    const path = `steps[${this.data.stepIndex}].questions[${questionIndex}].value`
    this.setData({ [path]: detail.value }, () => {
      this.setData({ current: this.data.steps[this.data.stepIndex] })
      this.refreshCompletion(); this.scheduleSave()
    })
  },

  markRemoteDirty() { this.dirty = true; this.editGeneration = (this.editGeneration || 0) + 1 },
  scheduleSave() {
    this.dirty = true
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveDraft(true).catch(() => {}), 700)
  },

  async saveDraft(silent) {
    if (!this.data.isV05) return this.saveLegacyDraft(silent)
    if (!this.dirty && silent) return null
    if (this.savePromise) {
      this.saveQueued = true
      await this.savePromise
      if (this.saveQueued && this.dirty) { this.saveQueued = false; return this.saveDraft(silent) }
      return null
    }
    const generation = this.editGeneration || 0
    const answers = toApiAnswers(this.remoteBank, this.remoteAnswers || {})
    const revision = this.data.revision
    const clientSaveToken = educationCompass.createClientSaveToken()
    this.setData({ saving: true, savedLabel: '正在保存到服务端…' })
    const educationSystemQuestion = this.remoteBank && this.remoteBank.questionByKey
      ? this.remoteBank.questionByKey.education_system
      : null
    const educationSystem = educationSystemQuestion ? answers[educationSystemQuestion.id] : undefined
    this.savePromise = educationCompass.saveDraft(this.data.assessmentId, {
      answers,
      revision,
      clientSaveToken,
      ...(this.data.level === 2 && educationSystem ? { educationSystem } : {})
    })
    try {
      const result = await this.savePromise
      if (result.clientSaveToken && result.clientSaveToken !== clientSaveToken) return null
      if (Number(result.revision) < Number(this.data.revision)) return null
      if (generation === this.editGeneration) this.dirty = false
      this.setData({ revision: result.revision, savedLabel: `已保存 · v${result.revision}` })
      return result
    } catch (error) {
      const stale = error && error.code === 'DRAFT_REVISION_STALE'
      this.setData({ savedLabel: stale ? '检测到其他设备的新版本' : '保存失败，请重试' })
      if (!silent && stale) {
        wx.showModal({
          title: '草稿已在其他设备更新',
          content: '为避免覆盖新版本，请重新加载服务端草稿。当前页面不会强行覆盖。',
          confirmText: '重新加载',
          cancelText: '留在此页',
          success: ({ confirm }) => { if (confirm) this.loadV05(this.options || {}) }
        })
      } else if (!silent) wx.showToast({ title: error.message || '草稿保存失败', icon: 'none' })
      throw error
    } finally {
      this.savePromise = null
      this.setData({ saving: false })
      if (this.dirty && this.saveQueued) { this.saveQueued = false; this.scheduleSave() }
    }
  },

  async saveLegacyDraft(silent) {
    if (!this.dirty && silent) return null
    this.setData({ saving: true, savedLabel: '正在保存…' })
    try {
      const result = await assessmentService.saveDraft(this.data.assessmentId, this.data.student.id, this.collectAnswers())
      this.dirty = false
      this.setData({ completenessScore: result.completenessScore, savedLabel: '草稿已保存' })
      return result
    } catch (error) {
      this.setData({ savedLabel: '保存失败，请重试' })
      if (!silent) wx.showToast({ title: error.message || '草稿保存失败', icon: 'none' })
      throw error
    } finally { this.setData({ saving: false }) }
  },

  async changeEducationSystem(nextSystem) {
    if (this.data.routeReloading) return
    this.setData({ routeReloading: true, savedLabel: '正在切换体系题库…' })
    try {
      const switched = questionnaireModel.switchEducationSystem(this.remoteBank, toKeyAnswers(this.remoteBank, this.remoteAnswers), nextSystem)
      this.remoteAnswers = toIdAnswers(this.remoteBank, switched.answers)
      this.markRemoteDirty(); this.applyRemoteView()
      await this.saveDraft(false)
      const rawBank = await educationCompass.getAssessmentQuestionnaire(this.data.assessmentId)
      this.remoteBank = questionnaireModel.normalizeQuestionBank(rawBank, {
        educationSystem: nextSystem,
        assessmentKind: this.data.level === 2 ? educationCompass.ASSESSMENT_KINDS.STUDENT_GROWTH : educationCompass.ASSESSMENT_KINDS.FREE_PARENT
      })
      this.remoteAnswers = toIdAnswers(this.remoteBank, toKeyAnswers(this.remoteBank, this.remoteAnswers))
      this.applyRemoteView(0)
      this.setData({ savedLabel: '体系题库已更新' })
    } catch (error) {
      this.setData({ error: error.message || '体系题库切换失败' })
    } finally { this.setData({ routeReloading: false }) }
  },

  validCurrent() {
    if (!this.data.isV05) return legacyQuestionnaire.stepIsValid(this.data.steps[this.data.stepIndex], this.collectAnswers())
    const keyAnswers = toKeyAnswers(this.remoteBank, this.remoteAnswers)
    const errors = this.data.current.questions.reduce((all, view) => {
      const question = this.remoteBank.questionByKey[view.key]
      return all.concat(questionnaireModel.validateQuestion(question, keyAnswers[question.key], { forSubmit: true }))
    }, [])
    if (errors.length) wx.showToast({ title: errors[0].message || '请完成本页必答问题', icon: 'none' })
    return errors.length === 0
  },

  async next() {
    if (this.data.submitting || this.data.saving || this.data.routeReloading) return
    if (!this.validCurrent()) return
    try { await this.saveDraft(false) } catch (error) { return }
    if (this.data.stepIndex === this.data.steps.length - 1) return this.submit()
    const stepIndex = this.data.stepIndex + 1
    if (this.data.isV05) this.applyRemoteView(stepIndex)
    else this.setData({ stepIndex, current: this.data.steps[stepIndex], progress: ((stepIndex + 1) / this.data.steps.length) * 100 })
    wx.pageScrollTo({ scrollTop: 0, duration: 250 })
  },

  async previous() {
    if (this.data.isV05 && !this.data.stepIndex) return this.saveAndExit(false)
    try { await this.saveDraft(true) } catch (error) {}
    if (!this.data.stepIndex) return wx.navigateBack()
    const stepIndex = this.data.stepIndex - 1
    if (this.data.isV05) this.applyRemoteView(stepIndex)
    else this.setData({ stepIndex, current: this.data.steps[stepIndex], progress: ((stepIndex + 1) / this.data.steps.length) * 100 })
    wx.pageScrollTo({ scrollTop: 0, duration: 250 })
  },

  async saveAndExit(studentRefused) {
    clearTimeout(this.saveTimer)
    try { await this.saveDraft(false) }
    catch (error) { return wx.showToast({ title: '保存失败，请重试后退出', icon: 'none' }) }
    if (studentRefused) {
      wx.showModal({
        title: '已尊重学生选择', content: '草稿已保存。本次不会生成结果、允许购买或形成负面信号。', showCancel: false,
        success: () => wx.switchTab({ url: '/pages/home/index' })
      })
      return
    }
    wx.switchTab({ url: '/pages/home/index' })
  },

  exitQuestionnaire() { return this.saveAndExit(false) },

  async submit() {
    if (!this.data.isV05) return this.submitLegacy()
    if (this.data.submitting) return
    const validation = questionnaireModel.validateAnswers(this.remoteBank, toKeyAnswers(this.remoteBank, this.remoteAnswers), { forSubmit: true })
    if (!validation.valid) {
      return wx.showModal({ title: '还有问题需要确认', content: validation.errors.slice(0, 3).map((error) => error.message).join('；'), showCancel: false })
    }
    this.setData({ submitting: true })
    try {
      await this.saveDraft(false)
      this.submitKey = this.submitKey || educationCompass.createIdempotencyKey(`level${this.data.level}_submit`)
      const result = await educationCompass.submitAssessment(this.data.assessmentId, { revision: this.data.revision }, this.submitKey)
      this.submitKey = ''
      this.submitted = true
      wx.redirectTo({
        url: `/pages/compass-preview/index?assessmentId=${encodeURIComponent(result.assessmentId || this.data.assessmentId)}&mode=${this.data.level === 1 ? 'family-snapshot' : 'growth-locked'}`
      })
    } catch (error) {
      wx.showModal({ title: '提交未完成', content: error.message || '请检查网络后重试', showCancel: false })
    } finally { this.setData({ submitting: false }) }
  },

  async submitLegacy() {
    if (this.data.submitting) return
    const localCompletion = legacyQuestionnaire.completeness(this.collectAnswers())
    if (!localCompletion.eligible) {
      return wx.showModal({ title: `资料完整度 ${localCompletion.score} 分`, content: `达到 ${localCompletion.threshold} 分才能生成预览。建议补充：${localCompletion.missingLabels.slice(0, 3).join('、')}`, showCancel: false })
    }
    this.setData({ submitting: true })
    try {
      await assessmentService.saveDraft(this.data.assessmentId, this.data.student.id, this.collectAnswers(), { verify: true })
      const result = await assessmentService.submit(this.data.assessmentId, this.data.student.id)
      this.submitted = true
      analytics.track('education_compass_preview_ready', {
        userId: session.currentUser().id, familyId: this.data.family.id,
        properties: { student_id: this.data.student.id, assessment_id: result.assessmentId, report_id: result.reportId, completeness_score: result.completenessScore }
      })
      wx.redirectTo({ url: `/pages/compass-preview/index?assessmentId=${result.assessmentId}` })
    } catch (error) {
      const details = error.details || {}
      if (error.code === 'ASSESSMENT_INCOMPLETE') {
        wx.showModal({ title: `资料完整度 ${details.completenessScore || this.data.completenessScore} 分`, content: `服务端校验未通过。请补充：${(details.missingLabels || details.missingFields || []).slice(0, 3).join('、') || '关键资料'}`, showCancel: false })
      } else wx.showToast({ title: error.message || '生成预览失败，请重试', icon: 'none' })
    } finally { this.setData({ submitting: false }) }
  },

  retry() {
    if (runtime.isDemo()) return this.loadLegacy(this.options || {})
    return this.loadV05(this.options || {})
  },
  onHide() { if (this.data.isV05 && this.dirty && !this.submitted) this.saveDraft(true).catch(() => {}) },
  onUnload() {
    clearTimeout(this.saveTimer)
    if (!this.data.isV05 && this.dirty && !this.submitted) assessmentService.saveDraft(this.data.assessmentId, this.data.student.id, this.collectAnswers()).catch(() => {})
  }
})
