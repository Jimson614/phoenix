const api = require('./api')
const runtime = require('../config/runtime')
const { repository } = require('./demo-runtime')
const session = require('./session')
const { isoNow } = require('../utils/date')

const MODULE_ORDER = ['student_profile', 'strengths', 'major_directions', 'university_match', 'routes', 'action_plan']
const MODULE_TITLES = {
  student_profile: '学生成长画像', strengths: '优势能力分析', major_directions: '推荐专业方向',
  university_match: '大学匹配', routes: '主路线与备选路线', action_plan: '未来 6—24 个月行动规划'
}

function normalizeModule(module, index) {
  if (typeof module === 'string') return { key: MODULE_ORDER[index], title: MODULE_TITLES[MODULE_ORDER[index]], summary: module, items: [] }
  const key = module.key || MODULE_ORDER[index]
  let items = module.items || []
  if (!Array.isArray(items)) items = Object.keys(items).map((item) => `${item}：${items[item]}`)
  return { key, title: module.title || MODULE_TITLES[key] || `模块 ${index + 1}`, summary: module.summary || '', items }
}

function normalizeFull(full) {
  if (!full) return null
  const byKey = {}
  ;(full.modules || []).forEach((module, index) => { byKey[module.key || MODULE_ORDER[index]] = normalizeModule(module, index) })
  const modules = MODULE_ORDER.map((key) => byKey[key]).filter(Boolean)
  return {
    ...full,
    modules,
    complete: modules.length === MODULE_ORDER.length,
    sources: Array.isArray(full.sources) ? full.sources.map((source) => {
      if (typeof source === 'string') return { name: source, dataAsOf: full.dataAsOf, applicableYear: '', dataVersion: '' }
      return {
        ...source,
        name: source.name || source.sourceId || '数据来源',
        dataAsOf: source.dataAsOf || source.verifiedAt || full.dataAsOf,
        applicableYear: source.applicableYear || '',
        dataVersion: source.dataVersion || ''
      }
    }) : []
  }
}

function legacyResponse(report, context) {
  return {
    access: 'legacy', reportId: report.id, status: 'READY',
    assessmentId: report.assessment_id, createdAt: report.created_at, context,
    legacy: { summary: report.summary || {}, recommendation: report.recommendation || {} },
    preview: {
      profileSummary: report.summary && report.summary.narrative,
      oneStrength: report.summary && report.summary.strength,
      oneRisk: report.summary && report.summary.potentialChallenge,
      routeOverview: report.recommendation && report.recommendation.suggestedDirection,
      disclaimer: '这是 V0.1 历史免费成长洞察，不代表已购买新版 39.9 元完整报告。'
    }
  }
}

function normalizeResponse(response) {
  if (!response) return response
  const payload = response.data || response
  const report = payload.report || payload
  return { ...report, full: normalizeFull(report.full) }
}

async function getReport(reportId) {
  if (!runtime.isDemo()) return normalizeResponse(await api.request(`/v1/reports/${encodeURIComponent(reportId)}`))
  const report = repository.getById('reports', reportId)
  if (!report) throw new api.ApiError('报告不存在', { code: 'REPORT_NOT_FOUND', statusCode: 404 })
  const assessment = repository.getById('assessments', report.assessment_id)
  const student = assessment && repository.getById('students', assessment.student_id)
  const family = student && repository.getById('families', student.family_id)
  const context = { student, family }
  if (!report.preview || !report.full) return legacyResponse(report, context)
  const paid = repository.where('orders', (order) => order.report_id === report.id && order.status === 'PAID')[0]
  return normalizeResponse({
    access: paid ? 'full' : 'preview',
    reportId: report.id,
    assessmentId: report.assessment_id,
    createdAt: report.created_at,
    context,
    status: report.status || 'READY',
    preview: report.preview,
    ...(paid ? { full: report.full } : {})
  })
}

async function getPdf(reportId) {
  if (runtime.isDemo()) throw new api.ApiError('演示模式不生成 PDF，请在生产服务配置后验证', { code: 'DEMO_PDF_UNAVAILABLE' })
  return new Promise((resolve, reject) => {
    let baseUrl = ''
    try { baseUrl = runtime.apiBaseUrl() } catch (error) { reject(error); return }
    const token = api.accessToken()
    wx.downloadFile({
      url: `${baseUrl}/v1/reports/${encodeURIComponent(reportId)}/pdf`,
      timeout: 30000,
      header: {
        Accept: 'application/pdf',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300 && response.tempFilePath) {
          resolve(response.tempFilePath)
          return
        }
        reject(new api.ApiError(`PDF 下载失败（${response.statusCode || 0}）`, {
          code: 'PDF_DOWNLOAD_FAILED', statusCode: response.statusCode || 0
        }))
      },
      fail(error) {
        reject(new api.ApiError(error.errMsg || 'PDF 下载失败', { code: 'PDF_DOWNLOAD_FAILED' }))
      }
    })
  })
}

async function openPdf(reportId) {
  const tempFilePath = await getPdf(reportId)
  return new Promise((resolve, reject) => wx.openDocument({
    filePath: tempFilePath, fileType: 'pdf', showMenu: true, success: resolve, fail: reject
  }))
}

async function submitFeedback(reportId, feedback) {
  const payload = {
    rating: Number(feedback.rating),
    tags: feedback.tags || [],
    comment: feedback.comment || '',
    advisorContactRequested: !!feedback.advisorContactRequested
  }
  if (!runtime.isDemo()) return api.request(`/v1/reports/${encodeURIComponent(reportId)}/feedback`, { method: 'POST', data: payload })
  const user = session.currentUser()
  const record = repository.insert('reportFeedback', {
    report_id: reportId, user_id: user ? user.id : '', rating: payload.rating,
    tags: payload.tags, comment: payload.comment,
    advisor_contact_requested: payload.advisorContactRequested, created_at: isoNow()
  })
  return { feedbackId: record.id, createdAt: record.created_at }
}

module.exports = { MODULE_ORDER, getPdf, getReport, normalizeResponse, openPdf, submitFeedback }
