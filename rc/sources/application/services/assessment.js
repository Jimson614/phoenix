const api = require('./api')
const runtime = require('../config/runtime')
const { repository, aiProvider } = require('./demo-runtime')
const { isoNow } = require('../utils/date')
const questionnaire = require('../models/questionnaire-schema')
const { QUESTIONNAIRE_VERSION } = require('../config/compass')
const familyData = require('./family-data')

const REFERENCES_KEY = 'PFS_COMPASS_ASSESSMENT_REFS_V1'
const ANSWERS_PREFIX = 'PFS_COMPASS_DRAFT_'
const remoteAnswers = {}

function references() { return wx.getStorageSync(REFERENCES_KEY) || {} }

function setReference(studentId, value) {
  const next = references()
  next[studentId] = { ...(next[studentId] || {}), ...value }
  wx.setStorageSync(REFERENCES_KEY, next)
  return next[studentId]
}

function referenceForStudent(studentId) { return references()[studentId] || null }
function answersKey(assessmentId) { return `${ANSWERS_PREFIX}${assessmentId}` }
function cachedAnswers(assessmentId) {
  if (!runtime.isDemo()) return remoteAnswers[assessmentId] || {}
  return wx.getStorageSync(answersKey(assessmentId)) || {}
}
function cacheAnswers(assessmentId, answers) {
  if (!runtime.isDemo()) {
    remoteAnswers[assessmentId] = answers || {}
    return
  }
  wx.setStorageSync(answersKey(assessmentId), answers || {})
}
function clearRemoteSessionData() { Object.keys(remoteAnswers).forEach((key) => { delete remoteAnswers[key] }) }

function consentIsValid(consent) {
  return !!(consent && consent.guardianConfirmed && consent.scope === 'education_compass_report' && consent.consentVersion)
}

function assessmentDto(result) {
  if (!result) return result
  const value = result.draft || result.assessment || (result.data && (result.data.draft || result.data.assessment || result.data)) || result
  return {
    ...value,
    assessmentId: value.assessmentId || value.id,
    questionnaireVersion: value.questionnaireVersion || value.questionnaire_version
  }
}

async function createForStudent({ student, family, consent }) {
  if (!student || !family) throw new api.ApiError('请先完善家庭与孩子档案', { code: 'PROFILE_REQUIRED' })
  if (!consentIsValid(consent)) throw new api.ApiError('请先完成监护人确认与协议同意', { code: 'CONSENT_REQUIRED', statusCode: 403 })
  const existing = referenceForStudent(student.id)
  if (existing && existing.status === 'DRAFT' && existing.questionnaireVersion === QUESTIONNAIRE_VERSION) return existing

  let result
  if (runtime.isDemo()) {
    const created = repository.insert('assessments', {
      student_id: student.id,
      type: 'education',
      questionnaire_version: QUESTIONNAIRE_VERSION,
      student_version: student.updated_at || 'student_profile_v0.1',
      consent,
      answers: {},
      completeness_score: 0,
      missing_fields: questionnaire.completeness({}).missingFields,
      status: 'DRAFT',
      created_at: isoNow(),
      updated_at: isoNow()
    })
    result = { assessmentId: created.id, status: 'DRAFT', questionnaireVersion: QUESTIONNAIRE_VERSION }
  } else {
    const remote = familyData.assertRemoteProfiles(family, student)
    result = assessmentDto(await api.request(`/v1/students/${encodeURIComponent(remote.studentId)}/education-assessments`, {
      method: 'POST',
      data: {
        familyId: remote.familyId,
        questionnaireVersion: QUESTIONNAIRE_VERSION,
        studentVersion: remote.studentVersion,
        consent
      }
    }))
  }
  setReference(student.id, result)
  return result
}

async function saveDraft(assessmentId, studentId, answers, options = {}) {
  cacheAnswers(assessmentId, answers)
  let result
  if (runtime.isDemo()) {
    const status = questionnaire.completeness(answers)
    repository.update('assessments', assessmentId, {
      answers,
      status: 'DRAFT',
      completeness_score: status.score,
      missing_fields: status.missingFields,
      updated_at: isoNow()
    })
    result = { assessmentId, status: 'DRAFT', completenessScore: status.score, missingFields: status.missingFields }
  } else {
    result = assessmentDto(await api.request(`/v1/assessments/${encodeURIComponent(assessmentId)}/draft`, { method: 'PUT', data: { answers } }))
    if (options.verify) {
      const snapshot = await loadDraft(assessmentId)
      const persisted = snapshot.answers || {}
      const expectedKeys = Object.keys(answers).filter((key) => questionnaire.isAnswered(answers[key]))
      const droppedFields = expectedKeys.filter((key) => persisted[key] === undefined)
      if (droppedFields.length) {
        throw new api.ApiError('服务端问卷版本与当前客户端不一致，请更新后重试', {
          code: 'ANSWER_SCHEMA_MISMATCH', statusCode: 409, details: { droppedFields }
        })
      }
    }
  }
  if (studentId) setReference(studentId, { assessmentId, status: result.status, questionnaireVersion: QUESTIONNAIRE_VERSION })
  return result
}

async function loadDraft(assessmentId) {
  let result
  if (runtime.isDemo()) {
    const assessment = repository.getById('assessments', assessmentId)
    if (!assessment) throw new api.ApiError('问卷不存在', { code: 'ASSESSMENT_NOT_FOUND', statusCode: 404 })
    result = {
      assessmentId: assessment.id,
      status: assessment.status,
      questionnaireVersion: assessment.questionnaire_version || QUESTIONNAIRE_VERSION,
      answers: assessment.answers || {},
      completenessScore: assessment.completeness_score || 0
    }
  } else {
    result = assessmentDto(await api.request(`/v1/assessments/${encodeURIComponent(assessmentId)}/draft`))
  }
  cacheAnswers(assessmentId, result.answers || {})
  return result
}

async function submit(assessmentId, studentId) {
  let result
  if (runtime.isDemo()) {
    const assessment = repository.getById('assessments', assessmentId)
    if (!assessment) throw new api.ApiError('问卷不存在', { code: 'ASSESSMENT_NOT_FOUND', statusCode: 404 })
    if (!consentIsValid(assessment.consent)) throw new api.ApiError('监护人授权已失效', { code: 'CONSENT_REQUIRED', statusCode: 403 })
    const answers = assessment.answers || cachedAnswers(assessmentId)
    const completion = questionnaire.completeness(answers)
    if (!completion.eligible) {
      throw new api.ApiError('资料完整度不足，暂不能生成付费报告', {
        code: 'ASSESSMENT_INCOMPLETE', statusCode: 422,
        details: { completenessScore: completion.score, missingFields: completion.missingFields, missingLabels: completion.missingLabels }
      })
    }
    const student = repository.getById('students', assessment.student_id)
    const generated = aiProvider.generateDemoCompassReport(student, answers, completion.score)
    const existingReport = assessment.report_id ? repository.getById('reports', assessment.report_id) : null
    const reportValue = {
      assessment_id: assessment.id,
      product_code: 'COMPASS_REPORT_SINGLE_39_9',
      status: 'READY',
      access: 'preview',
      preview: generated.preview,
      full: generated.full,
      summary: {
        currentStage: generated.full.modules[0].items[0].replace('当前阶段：', ''),
        strength: generated.preview.oneStrength,
        potentialChallenge: generated.preview.oneRisk,
        narrative: generated.preview.profileSummary
      },
      recommendation: {
        suggestedDirection: generated.preview.routeOverview,
        nextAction: generated.full.modules[5].summary,
        engine: generated.full.versions.engine
      },
      created_at: existingReport ? existingReport.created_at : isoNow(),
      updated_at: isoNow()
    }
    const report = existingReport ? repository.update('reports', existingReport.id, reportValue) : repository.insert('reports', reportValue)
    repository.update('assessments', assessment.id, {
      status: 'PREVIEW_READY', report_id: report.id, completeness_score: completion.score,
      submitted_at: isoNow(), updated_at: isoNow()
    })
    const family = repository.getById('families', student.family_id)
    repository.addTimeline(family.id, 'compass_completed', `${student.name} 已完成 Education Compass`)
    repository.addTimeline(family.id, 'report_preview_ready', `已生成 ${student.name} 的免费报告预览`)
    result = {
      assessmentId: assessment.id,
      status: 'PREVIEW_READY',
      completenessScore: completion.score,
      confidence: generated.preview.confidence,
      reportId: report.id
    }
  } else {
    result = assessmentDto(await api.request(`/v1/assessments/${encodeURIComponent(assessmentId)}/submit`, { method: 'POST', data: {} }))
  }
  if (studentId) setReference(studentId, { assessmentId, reportId: result.reportId, status: result.status, questionnaireVersion: QUESTIONNAIRE_VERSION })
  return result
}

async function preview(assessmentId) {
  if (!runtime.isDemo()) {
    const result = await api.request(`/v1/assessments/${encodeURIComponent(assessmentId)}/preview`)
    return result.preview || (result.data && (result.data.preview || result.data)) || result
  }
  const assessment = repository.getById('assessments', assessmentId)
  const report = assessment && assessment.report_id ? repository.getById('reports', assessment.report_id) : null
  if (!assessment || !report || !report.preview) throw new api.ApiError('报告预览尚未生成', { code: 'PREVIEW_NOT_READY', statusCode: 409 })
  return {
    reportId: report.id,
    assessmentId: assessment.id,
    completenessScore: assessment.completeness_score,
    confidence: report.preview.confidence,
    profileSummary: report.preview.profileSummary,
    oneStrength: report.preview.oneStrength,
    oneRisk: report.preview.oneRisk,
    routeOverview: report.preview.routeOverview,
    tableOfContents: report.preview.tableOfContents,
    dataAsOf: report.preview.dataAsOf,
    disclaimer: report.preview.disclaimer,
    canPurchase: true
  }
}

module.exports = {
  REFERENCES_KEY, cachedAnswers, cacheAnswers, clearRemoteSessionData, createForStudent, loadDraft, preview,
  referenceForStudent, saveDraft, submit
}
