import { Assessment, Report, SourceReference } from '../../domain/model'
import { invariant } from '../../domain/errors'
import { AgentContentCrypto, agentReportVersion } from '../crypto'
import { AgentReportContext } from '../provider/agent-provider'
import { assertSafeAgentReportContext, inspectLocalInput, redactContextText } from '../safety/local-safety'
import { sanitizeAgentSource } from './report-context'

const MAX_CONTEXT_LENGTH = 20_000

const LABELS: Record<string, string> = {
  identity_type: '身份类型', school_stage: '学习阶段', education_system: '课程体系',
  target_enrollment_year: '目标入学时间', academic_summary: '学业概况', language_level: '语言水平',
  strongest_subjects: '优势学科', learning_feeling: '学习感受', strengths: '已观察优势',
  interests: '兴趣线索', strength_evidence: '优势证据', challenges: '当前挑战',
  parent_observation: '家长观察', parent_expectation: '家庭期待', future_goal: '未来目标',
  target_region: '目标地区', target_major: '目标专业', route_preference: '路线偏好',
  backup_route_acceptance: '备选路线接受度', annual_budget: '年度预算区间',
  available_time: '可投入节奏', support_need: '支持需要', location_preference: '地点偏好'
}

const GROUPS: Array<{ key: string; title: string; fields: string[] }> = [
  {
    key: 'free_assessment_learning_snapshot', title: '学习背景与当前状态',
    fields: ['school_stage', 'education_system', 'target_enrollment_year', 'learning_feeling']
  },
  {
    key: 'free_assessment_strength_snapshot', title: '优势、兴趣与挑战线索',
    fields: ['strengths', 'challenges', 'parent_expectation']
  },
  {
    key: 'free_assessment_route_snapshot', title: '目标、路线与支持偏好',
    fields: ['target_region', 'route_preference', 'backup_route_acceptance', 'available_time', 'support_need']
  }
]

function safeValue(raw: unknown): string | null {
  const source = Array.isArray(raw) ? raw.map(String).join('、') : typeof raw === 'string' ? raw : ''
  const trimmed = source.trim()
  if (!trimmed) return null
  const decision = inspectLocalInput(trimmed, 1200)
  invariant(decision.action === 'ALLOW', 409,
    decision.code === 'CRISIS_CONTENT' ? 'AGENT_CONTEXT_REQUIRES_HUMAN_REVIEW' : 'AGENT_CONTEXT_UNSAFE',
    decision.safeMessage ?? '测评内容需要移除敏感信息后才能进行 AI 分析')
  return redactContextText(decision.normalized).slice(0, 600)
}

function itemsFor(assessment: Assessment, fields: readonly string[]): string[] {
  return fields.flatMap((field) => {
    const value = safeValue(assessment.answers[field])
    return value ? [`${LABELS[field] ?? field}：${value}`] : []
  })
}

function structuredItems(value: unknown, maxItems = 12): string[] {
  if (Array.isArray(value)) {
    return value.slice(0, maxItems).map((item) => {
      if (typeof item === 'string') return item
      if (item !== null && typeof item === 'object') {
        const record = item as Record<string, unknown>
        const allowed = ['code', 'dimension', 'status', 'evidence_refs', 'source']
        return JSON.stringify(Object.fromEntries(allowed.filter((key) => record[key] !== undefined).map((key) => [key, record[key]])))
      }
      return String(item)
    })
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.entries(record).slice(0, maxItems).map(([key, item]) => `${key}：${Array.isArray(item) ? item.join('、') : String(item)}`)
  }
  return value === undefined || value === null ? [] : [String(value)]
}

function buildV05FreeContext(assessment: Assessment, report: Report): {
  context: AgentReportContext
  sourceMap: Record<string, SourceReference>
} {
  invariant(assessment.assessmentKind === 'FREE_PARENT_COMPASS' && assessment.status === 'SUBMITTED' &&
    report.reportKind === 'FAMILY_EDUCATION_SNAPSHOT' && report.resultPayload && report.qaPassed,
    409, 'AGENT_ASSESSMENT_NOT_READY', '免费家长测评尚未完成提交和安全校验')
  const result = report.resultPayload
  const modules = [
    {
      key: 'family_concerns', title: '家庭教育关注（家长观察）',
      summary: '仅解释家长本次选择的结构化关注项。', items: structuredItems(result.family_concerns)
    },
    {
      key: 'parent_observation_signals', title: '家长观察信号',
      summary: '这些是家长观察，不是学生能力判断。',
      items: [...structuredItems(result.observed_strength_signals), ...structuredItems(result.observed_difficulty_signals)]
    },
    {
      key: 'next_step', title: '下一步状态',
      summary: '下一步由冻结路由规则决定，不由 AI 重新评分。',
      items: [...structuredItems(result.next_step_status), ...structuredItems(result.next_step_reason_codes)]
    }
  ]
  const source: SourceReference = {
    sourceId: 'PHOENIX_ASSESSMENT_SNAPSHOT', applicableYear: report.dataAsOf.slice(0, 4),
    verifiedAt: report.dataAsOf, dataVersion: report.resultVersion ?? assessment.questionnaireVersion
  }
  const context: AgentReportContext = {
    dataAsOf: report.dataAsOf,
    confidence: report.confidence,
    disclaimer: '这是对 Family Education Snapshot 的有限 AI 辅助解释。家长观察不是诊断、排名、录取预测或结果保证，AI 不改变确定性核心结果。',
    modules,
    sources: [{ alias: 'S1', applicableYear: source.applicableYear, verifiedAt: source.verifiedAt, dataVersion: source.dataVersion }]
  }
  assertSafeAgentReportContext(context)
  return { context, sourceMap: { S1: source } }
}

function buildV05PaidContext(assessment: Assessment, report: Report): {
  context: AgentReportContext
  sourceMap: Record<string, SourceReference>
} {
  invariant(assessment.assessmentKind === 'STUDENT_GROWTH_DISCOVERY' && assessment.status === 'SUBMITTED' &&
    report.reportKind === 'STUDENT_GROWTH_DISCOVERY' && report.resultPayload && report.status === 'READY' &&
    report.deliveryStatus === 'DELIVERED' && report.qaPassed,
    409, 'AGENT_REPORT_NOT_READY', '学生成长发现报告尚未完成交付')
  const result = report.resultPayload
  const definitions: Array<[string, string, string]> = [
    ['student_snapshot', 'Student Snapshot', '学生本人本次结构化自述快照。'],
    ['strength_signals', 'Strength Signals', '只解释冻结规则已生成且带 evidence refs 的信号。'],
    ['learning_bottlenecks', 'Learning Bottlenecks', '只解释已生成的学习瓶颈，不作诊断。'],
    ['subject_focus', 'Subject Focus', '只解释当前学科重点，不作录取或院校判断。'],
    ['growth_direction', 'Growth Direction', '兴趣方向需要用真实行动继续验证。'],
    ['action_plan_30d', '30-Day Action Plan', '仅解释未来30天行动，不扩展成完整升学规划。']
  ]
  const modules = definitions.map(([key, title, summary]) => ({
    key,
    title,
    summary,
    items: key === 'action_plan_30d'
      ? [
          ...structuredItems(result[key]),
          ...structuredItems(result.recommended_focus).map((item) => `recommended_focus：${item}`)
        ]
      : structuredItems(result[key])
  }))
  const context: AgentReportContext = {
    dataAsOf: report.dataAsOf,
    confidence: report.confidence,
    disclaimer: '这是对已解锁 Student Growth Discovery 的有限 AI 辅助解释。AI 不重评分、不创造证据、不诊断，也不生成录取结论。',
    modules,
    sources: []
  }
  assertSafeAgentReportContext(context)
  return { context, sourceMap: {} }
}

export function agentAssessmentVersion(assessment: Assessment, report: Report): string {
  return [
    'assessment-analysis-v1', assessment.questionnaireVersion, assessment.studentVersion,
    assessment.updatedAt, String(assessment.completenessScore), agentReportVersion(report)
  ].join('|')
}

export function buildAssessmentAnalysisContext(assessment: Assessment, report: Report): {
  context: AgentReportContext
  sourceMap: Record<string, SourceReference>
} {
  if (assessment.assessmentKind === 'FREE_PARENT_COMPASS') return buildV05FreeContext(assessment, report)
  invariant(assessment.status === 'PREVIEW_READY' && assessment.reportId === report.id && assessment.completenessScore >= 70,
    409, 'AGENT_ASSESSMENT_NOT_READY', '免费测评尚未完成提交')
  invariant(report.userId === assessment.userId && report.assessmentId === assessment.id && report.qaPassed,
    409, 'AGENT_ASSESSMENT_NOT_READY', '免费测评快照尚未通过安全校验')
  const modules = GROUPS.map((group) => {
    const items = itemsFor(assessment, group.fields)
    return {
      key: group.key,
      title: group.title,
      summary: items.length ? '以下内容来自本次免费测评的脱敏快照。' : '本组信息本次未填写。',
      items
    }
  })
  const source: SourceReference = {
    sourceId: 'PHOENIX_ASSESSMENT_SNAPSHOT',
    applicableYear: report.dataAsOf.slice(0, 4),
    verifiedAt: report.dataAsOf,
    dataVersion: assessment.questionnaireVersion
  }
  const context: AgentReportContext = {
    dataAsOf: report.dataAsOf,
    confidence: report.preview.confidence,
    disclaimer: '这是基于本次免费测评脱敏快照的 AI 辅助分析，仅用于家庭讨论；不包含完整付费报告，不代表诊断、录取保证或最终结论。',
    modules,
    sources: [{ alias: 'S1', applicableYear: source.applicableYear, verifiedAt: source.verifiedAt, dataVersion: source.dataVersion }]
  }
  assertSafeAgentReportContext(context)
  invariant(JSON.stringify(context).length <= MAX_CONTEXT_LENGTH, 409, 'AGENT_CONTEXT_TOO_LARGE', '免费测评上下文超过安全上限')
  return { context, sourceMap: { S1: source } }
}

/**
 * Builds the paid one-shot analysis context from normalized enum/multi-select answers only.
 * The six paid report modules may contain customer-authored free text, so they are deliberately
 * not copied into the provider request. The customer still reads the complete report locally;
 * OpenAI receives only the minimum structured evidence needed to explain it.
 */
export function buildPaidReportAnalysisContext(assessment: Assessment, report: Report): {
  context: AgentReportContext
  sourceMap: Record<string, SourceReference>
} {
  if (assessment.assessmentKind === 'STUDENT_GROWTH_DISCOVERY') return buildV05PaidContext(assessment, report)
  invariant(assessment.status === 'PREVIEW_READY' && assessment.reportId === report.id &&
    assessment.userId === report.userId && assessment.id === report.assessmentId,
    409, 'AGENT_REPORT_NOT_READY', '已购报告关联的测评快照无效')
  invariant(report.status === 'READY' && report.deliveryStatus === 'DELIVERED' && report.qaPassed &&
    Array.isArray(report.modules) && report.modules.length > 0,
    409, 'AGENT_REPORT_NOT_READY', '报告尚未完成交付')

  const moduleDefinitions: Array<{ key: string; title: string; fields: string[]; summary: string }> = [
    {
      key: 'student_profile', title: '学生成长画像',
      fields: ['school_stage', 'education_system', 'target_enrollment_year', 'learning_feeling'],
      summary: '依据本次测评的受控选项解释当前学习背景与状态。'
    },
    {
      key: 'strengths', title: '优势能力分析',
      fields: ['strengths', 'challenges', 'parent_expectation'],
      summary: '依据已选择的优势、挑战与家庭期待形成验证建议。'
    },
    {
      key: 'major_directions', title: '推荐专业方向',
      fields: ['strengths', 'route_preference', 'support_need'],
      summary: '仅给出方向探索方法，不传输或复述客户填写的自由文本专业目标。'
    },
    {
      key: 'university_match', title: '大学与专业匹配',
      fields: ['target_region', 'target_enrollment_year', 'education_system'],
      summary: '结合受控地区、时间与课程体系选项说明匹配框架，不承诺录取结果。'
    },
    {
      key: 'routes', title: '升学路线建议',
      fields: ['route_preference', 'backup_route_acceptance', 'target_region'],
      summary: '依据受控路线选项比较主路线与备选路线。'
    },
    {
      key: 'action_plan', title: '未来6—24个月时间规划',
      fields: ['available_time', 'support_need', 'target_enrollment_year'],
      summary: '依据可投入节奏与支持需要形成分阶段行动建议。'
    }
  ]
  const sourceMap: Record<string, SourceReference> = {}
  const sources = report.sources.slice(0, 20).map((source, index) => {
    const alias = `S${index + 1}`
    const sanitized = sanitizeAgentSource(source)
    sourceMap[alias] = sanitized
    return {
      alias,
      applicableYear: sanitized.applicableYear,
      verifiedAt: sanitized.verifiedAt,
      dataVersion: sanitized.dataVersion
    }
  })
  const context: AgentReportContext = {
    dataAsOf: report.dataAsOf,
    confidence: report.confidence,
    disclaimer: '这是对已购 Education Compass 报告的 AI 辅助解读。为保护家庭隐私，AI 仅接收问卷中的必要受控选项，不接收姓名、电话、学校、地址或任何自由文本答案；结论不代表诊断或录取保证。',
    modules: moduleDefinitions.map((module) => ({
      key: module.key,
      title: module.title,
      summary: module.summary,
      items: itemsFor(assessment, module.fields)
    })),
    sources
  }
  assertSafeAgentReportContext(context)
  invariant(JSON.stringify(context).length <= MAX_CONTEXT_LENGTH, 409, 'AGENT_CONTEXT_TOO_LARGE', '已购报告分析上下文超过安全上限')
  return { context, sourceMap }
}

export function contextDigestForAssessment(assessment: Assessment, report: Report, crypto: AgentContentCrypto): string {
  return crypto.keyedDigest('assessment-context', buildAssessmentAnalysisContext(assessment, report).context)
}

export function contextDigestForPaidReportAnalysis(assessment: Assessment, report: Report, crypto: AgentContentCrypto): string {
  return crypto.keyedDigest('paid-analysis-context', buildPaidReportAnalysisContext(assessment, report).context)
}
