const api = require('./api')
const agent = require('./agent')

const ANALYSIS_MODES = Object.freeze({ FREE: 'free', PAID: 'paid' })

function normalizeAnalysisRun(result, mode) {
  const run = agent.normalizeRun(result)
  let reply = run.reply
  if (reply) {
    let limitations = reply.limitations || []
    if (mode === ANALYSIS_MODES.FREE && limitations.length === 1 && limitations[0] === '仅解释当前报告，不保证录取或升学结果。') {
      limitations = ['仅基于本次测评的有限字段提供概览，不等同于 ¥39.90 完整报告。']
    }
    reply = { ...reply, limitations }
  }
  return {
    ...run,
    analysisType: run.analysisType || run.type || run.purpose || '',
    reply
  }
}

function consentPayload() {
  return agent.consentPayload()
}

async function createFreeAnalysis(assessmentId, idempotencyKey) {
  const result = await api.request(`/v1/assessments/${encodeURIComponent(assessmentId)}/agent-analyses`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    data: consentPayload()
  })
  return normalizeAnalysisRun(result, ANALYSIS_MODES.FREE)
}

async function createPaidAnalysis(reportId, idempotencyKey) {
  const result = await api.request(`/v1/reports/${encodeURIComponent(reportId)}/agent-analyses`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    data: consentPayload()
  })
  return normalizeAnalysisRun(result, ANALYSIS_MODES.PAID)
}

async function getAnalysis(runId, mode) {
  const result = await api.request(`/v1/agent-analyses/${encodeURIComponent(runId)}`)
  return normalizeAnalysisRun(result, mode)
}

async function getLatestFreeAnalysis(assessmentId) {
  const result = await api.request(`/v1/assessments/${encodeURIComponent(assessmentId)}/agent-analyses/latest`)
  const payload = result && result.data ? result.data : result
  return payload && payload.analysis ? normalizeAnalysisRun(payload.analysis, ANALYSIS_MODES.FREE) : null
}

async function getLatestPaidAnalysis(reportId) {
  const result = await api.request(`/v1/reports/${encodeURIComponent(reportId)}/agent-analyses/latest`)
  const payload = result && result.data ? result.data : result
  return payload && payload.analysis ? normalizeAnalysisRun(payload.analysis, ANALYSIS_MODES.PAID) : null
}

module.exports = {
  ANALYSIS_MODES,
  consentPayload,
  createFreeAnalysis,
  createPaidAnalysis,
  getAnalysis,
  getLatestFreeAnalysis,
  getLatestPaidAnalysis,
  normalizeAnalysisRun
}
