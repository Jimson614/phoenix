const RESULT_KINDS = Object.freeze({
  LEGACY_SIX_MODULES: 'LEGACY_COMPASS_SIX_MODULES',
  FAMILY_SNAPSHOT: 'FAMILY_EDUCATION_SNAPSHOT',
  STUDENT_GROWTH: 'STUDENT_GROWTH_DISCOVERY'
})

const RENDERER_KEYS = Object.freeze({
  LEGACY_SIX_MODULES: 'compass-six-modules-v1',
  FAMILY_SNAPSHOT: 'family_education_snapshot_v1',
  STUDENT_GROWTH: 'student_growth_discovery_report_v1'
})

class ResultContractError extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'ResultContractError'
    this.code = 'RESULT_CONTRACT_INVALID'
    this.details = details || null
  }
}

function unwrap(input) {
  let value = input && input.data !== undefined ? input.data : input
  if (value && value.result && typeof value.result === 'object' && !Array.isArray(value.result)) {
    value = { ...value, ...value.result }
    delete value.result
  }
  else if (value && value.report) value = value.report
  return value || {}
}

function field(value, camel, snake) {
  return value[camel] !== undefined ? value[camel] : value[snake]
}

function resultState(value) {
  return String(field(value, 'resultState', 'result_state') || value.access || '').toUpperCase()
}

function normalizeLocked(value) {
  return {
    rendererKey: RENDERER_KEYS.STUDENT_GROWTH,
    resultKind: RESULT_KINDS.STUDENT_GROWTH,
    resultState: 'LOCKED',
    assessmentId: field(value, 'assessmentId', 'assessment_id') || '',
    productCode: field(value, 'productCode', 'product_code') || '',
    amountFen: Number(field(value, 'amountFen', 'amount_fen')),
    currency: value.currency || '',
    nextAction: field(value, 'nextAction', 'next_action') || '',
    systemResultMarker: field(value, 'systemResultMarker', 'system_result_marker') || '',
    sections: []
  }
}

function normalizeLegacy(value) {
  const full = value.full || value
  const modules = Array.isArray(full.modules) ? full.modules : []
  if (!modules.length) throw new ResultContractError('历史六模块报告缺少 modules')
  return {
    rendererKey: RENDERER_KEYS.LEGACY_SIX_MODULES,
    resultKind: RESULT_KINDS.LEGACY_SIX_MODULES,
    resultState: String(value.access || 'FULL').toUpperCase(),
    reportId: field(value, 'reportId', 'report_id') || value.id || '',
    assessmentId: field(value, 'assessmentId', 'assessment_id') || '',
    resultVersion: field(value, 'reportVersion', 'report_version') || RENDERER_KEYS.LEGACY_SIX_MODULES,
    sections: modules.map((module, index) => ({
      key: module.key || `legacy_module_${index + 1}`,
      title: module.title || `模块 ${index + 1}`,
      summary: module.summary || '',
      items: Array.isArray(module.items) ? module.items : []
    })),
    sources: Array.isArray(full.sources) ? full.sources : [],
    disclaimer: full.disclaimer || '',
    disclaimerVersion: field(full, 'disclaimerVersion', 'disclaimer_version') || ''
  }
}

function normalizeFamilySnapshot(value) {
  const required = [
    'family_concerns', 'observed_strength_signals', 'observed_difficulty_signals',
    'student_readiness', 'family_priorities', 'preferred_next_support', 'next_step_status'
  ]
  const missing = required.filter((key) => value[key] === undefined && value[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] === undefined)
  if (missing.length) throw new ResultContractError('Family Education Snapshot 字段不完整', { missing })
  return {
    rendererKey: RENDERER_KEYS.FAMILY_SNAPSHOT,
    resultKind: RESULT_KINDS.FAMILY_SNAPSHOT,
    resultState: 'FULL',
    resultVersion: field(value, 'resultVersion', 'result_version') || '',
    familyId: field(value, 'familyId', 'family_id') || '',
    studentId: field(value, 'studentId', 'student_id') || '',
    assessmentId: field(value, 'assessmentId', 'assessment_id') || '',
    educationSystem: field(value, 'educationSystem', 'education_system') || '',
    gradeStage: field(value, 'gradeStage', 'grade_stage') || '',
    sections: [
      { key: 'family_concerns', title: '家庭教育关注', value: field(value, 'familyConcerns', 'family_concerns') || [], source: 'PARENT_OBSERVATION' },
      { key: 'observed_strength_signals', title: '家长观察到的优势信号', value: field(value, 'observedStrengthSignals', 'observed_strength_signals') || [], source: 'PARENT_OBSERVATION' },
      { key: 'observed_difficulty_signals', title: '家长观察到的困难信号', value: field(value, 'observedDifficultySignals', 'observed_difficulty_signals') || [], source: 'PARENT_OBSERVATION' },
      { key: 'family_priorities', title: '家庭优先方向', value: field(value, 'familyPriorities', 'family_priorities') || [], source: 'PARENT_OBSERVATION' },
      { key: 'preferred_next_support', title: '希望获得的下一步支持', value: field(value, 'preferredNextSupport', 'preferred_next_support') || '', source: 'PARENT_OBSERVATION' }
    ],
    studentReadiness: field(value, 'studentReadiness', 'student_readiness') || '',
    nextStepStatus: field(value, 'nextStepStatus', 'next_step_status') || '',
    nextStepReasonCodes: field(value, 'nextStepReasonCodes', 'next_step_reason_codes') || [],
    disclaimer: value.disclaimer || '',
    disclaimerVersion: field(value, 'disclaimerVersion', 'disclaimer_version') || ''
  }
}

function normalizeStudentGrowth(value) {
  if (resultState(value) === 'LOCKED') return normalizeLocked(value)
  const sectionDefinitions = [
    ['student_snapshot', 'studentSnapshot', 'Student Snapshot'],
    ['strength_signals', 'strengthSignals', 'Strength Signals'],
    ['learning_bottlenecks', 'learningBottlenecks', 'Learning Bottlenecks'],
    ['subject_focus', 'subjectFocus', 'Subject Focus'],
    ['growth_direction', 'growthDirection', 'Growth Direction'],
    ['action_plan_30d', 'actionPlan30d', '30-Day Action Plan']
  ]
  const missing = sectionDefinitions.filter(([snake, camel]) => value[snake] === undefined && value[camel] === undefined).map(([snake]) => snake)
  if (missing.length) throw new ResultContractError('Student Growth Discovery 六项结果不完整', { missing })
  return {
    rendererKey: RENDERER_KEYS.STUDENT_GROWTH,
    resultKind: RESULT_KINDS.STUDENT_GROWTH,
    resultState: 'FULL',
    resultVersion: field(value, 'resultVersion', 'result_version') || '',
    assessmentId: field(value, 'assessmentId', 'assessment_id') || '',
    reportId: field(value, 'reportId', 'report_id') || '',
    educationSystem: field(value, 'educationSystem', 'education_system') || '',
    systemResultMarker: field(value, 'systemResultMarker', 'system_result_marker') || '',
    educationPathwayContext: field(value, 'educationPathwayContext', 'education_pathway_context') || null,
    sections: sectionDefinitions.map(([snake, camel, title]) => ({
      key: snake,
      title,
      value: value[camel] === undefined ? value[snake] : value[camel]
    })),
    learningSignals: field(value, 'learningSignals', 'learning_signals') || [],
    interestSignals: field(value, 'interestSignals', 'interest_signals') || [],
    recommendedFocus: field(value, 'recommendedFocus', 'recommended_focus') || [],
    evidenceRefs: field(value, 'evidenceRefs', 'evidence_refs') || [],
    questionnaireVersions: field(value, 'questionnaireVersions', 'questionnaire_versions') || [],
    disclaimer: value.disclaimer || '',
    disclaimerVersion: field(value, 'disclaimerVersion', 'disclaimer_version') || ''
  }
}

const RESULT_RENDERERS = Object.freeze({
  [RENDERER_KEYS.LEGACY_SIX_MODULES]: normalizeLegacy,
  [RENDERER_KEYS.FAMILY_SNAPSHOT]: normalizeFamilySnapshot,
  [RENDERER_KEYS.STUDENT_GROWTH]: normalizeStudentGrowth
})

const KIND_ALIASES = Object.freeze({
  LEGACY_EDUCATION_COMPASS: RENDERER_KEYS.LEGACY_SIX_MODULES,
  LEGACY_COMPASS_SIX_MODULES: RENDERER_KEYS.LEGACY_SIX_MODULES,
  FAMILY_EDUCATION_SNAPSHOT: RENDERER_KEYS.FAMILY_SNAPSHOT,
  STUDENT_GROWTH_DISCOVERY: RENDERER_KEYS.STUDENT_GROWTH,
  STUDENT_GROWTH_DISCOVERY_REPORT: RENDERER_KEYS.STUDENT_GROWTH
})

function rendererKeyFor(input) {
  const value = unwrap(input)
  const version = field(value, 'resultVersion', 'result_version') || field(value, 'reportVersion', 'report_version') ||
    field(value, 'templateVersion', 'template_version') || ''
  if (RESULT_RENDERERS[version]) return version
  if (/^family_education_snapshot_v1(?:\.|$)/.test(version)) return RENDERER_KEYS.FAMILY_SNAPSHOT
  if (/^student_growth_discovery_report_v1(?:\.|$)/.test(version)) return RENDERER_KEYS.STUDENT_GROWTH
  if (/^compass-six-modules-v1(?:\.|$)/.test(version)) return RENDERER_KEYS.LEGACY_SIX_MODULES
  const kind = String(field(value, 'resultKind', 'result_kind') || field(value, 'reportKind', 'report_kind') || '').toUpperCase()
  if (KIND_ALIASES[kind]) return KIND_ALIASES[kind]
  if (value.full && Array.isArray(value.full.modules)) return RENDERER_KEYS.LEGACY_SIX_MODULES
  if (Array.isArray(value.modules)) return RENDERER_KEYS.LEGACY_SIX_MODULES
  throw new ResultContractError('无法识别 Education Compass 结果版本', { version, kind })
}

function renderResult(input) {
  const value = unwrap(input)
  const key = rendererKeyFor(value)
  return RESULT_RENDERERS[key](value)
}

module.exports = {
  RENDERER_KEYS,
  RESULT_KINDS,
  RESULT_RENDERERS,
  ResultContractError,
  normalizeFamilySnapshot,
  normalizeLegacy,
  normalizeLocked,
  normalizeStudentGrowth,
  renderResult,
  rendererKeyFor
}
