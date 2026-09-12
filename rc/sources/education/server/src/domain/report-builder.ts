import { invariant } from './errors'
import { Assessment, Report, ReportModule, ReportModuleKey, ReportPreview, Student } from './model'
import { SourceCatalog } from './source-catalog'

const MODULE_KEYS: ReportModuleKey[] = [
  'student_profile',
  'strengths',
  'major_directions',
  'university_match',
  'routes',
  'action_plan'
]

const MODULE_TITLES = ['学生成长画像', '优势能力分析', '推荐专业方向', '大学与专业匹配', '升学路线建议', '未来6—24个月时间规划']
const DISCLAIMER = '本报告用于支持家庭教育与升学讨论，不代表学校决定或最终结果。请结合最新官方信息与专业意见复核。'

function answerText(answers: Record<string, unknown>, key: string, fallback: string): string {
  const value = answers[key]
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join('、') || fallback
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object') return Object.values(value).map(String).filter(Boolean).join('、') || fallback
  return fallback
}

export function buildPreview(
  reportId: string,
  assessment: Assessment,
  student: Student,
  dataAsOf: string
): ReportPreview {
  const { answers } = assessment
  const schoolStage = answerText(answers, 'school_stage', student.grade || '当前成长阶段')
  const strength = answerText(answers, 'strengths', '持续探索意愿')
  const challenge = answerText(answers, 'challenges', '方向仍需通过行动验证')
  const interest = answerText(answers, 'interests', student.interest || '多元兴趣')
  const confidence = assessment.completenessScore < 75 ? 'low' : assessment.completenessScore < 90 ? 'medium' : 'high'
  return {
    reportId,
    assessmentId: assessment.id,
    completenessScore: assessment.completenessScore,
    confidence,
    profileSummary: `当前处于${schoolStage}，可围绕已填写信息逐步形成可验证的成长方向。`,
    oneStrength: `已观察优势：${strength}`,
    oneRisk: `当前需关注：${challenge}`,
    routeOverview: `先围绕“${interest}”完成低成本体验，再根据反馈调整主路线与备选路线。`,
    tableOfContents: [...MODULE_TITLES],
    dataAsOf,
    disclaimer: DISCLAIMER,
    canPurchase: assessment.completenessScore >= 70
  }
}

export function buildLockedReport(
  reportId: string,
  assessment: Assessment,
  student: Student,
  now: string,
  sourceCatalog: SourceCatalog
): Report {
  const dataAsOf = sourceCatalog.verified ? sourceCatalog.dataAsOf.slice(0, 10) : now.slice(0, 10)
  const confidence = assessment.completenessScore < 75 ? 'low' : assessment.completenessScore < 90 ? 'medium' : 'high'
  return {
    id: reportId,
    userId: assessment.userId,
    familyId: assessment.familyId,
    studentId: assessment.studentId,
    assessmentId: assessment.id,
    status: 'LOCKED',
    deliveryStatus: 'LOCKED',
    preview: buildPreview(reportId, assessment, student, dataAsOf),
    modules: null,
    sources: [
      { sourceId: `USER_INPUT:${assessment.id}`, applicableYear: dataAsOf.slice(0, 4), verifiedAt: dataAsOf, dataVersion: assessment.questionnaireVersion },
      { sourceId: 'PHOENIX_RULESET:EDUCATION_V1', applicableYear: dataAsOf.slice(0, 4), verifiedAt: dataAsOf, dataVersion: 'rules-v1' },
      ...sourceCatalog.entries.map((entry) => ({
        sourceId: entry.sourceId,
        applicableYear: entry.applicableYear,
        verifiedAt: entry.verifiedAt.slice(0, 10),
        dataVersion: sourceCatalog.version
      }))
    ],
    dataAsOf,
    disclaimer: DISCLAIMER,
    confidence,
    versions: {
      studentVersion: assessment.studentVersion,
      ruleVersion: 'education-rules-v1',
      dataVersion: sourceCatalog.version,
      promptVersion: 'deterministic-explanation-v1',
      templateVersion: 'compass-six-modules-v1'
    },
    qaPassed: false,
    sourceCatalogVerified: sourceCatalog.verified,
    sourceCatalogVersion: sourceCatalog.version,
    createdAt: now,
    updatedAt: now,
    reportKind: 'LEGACY_EDUCATION_COMPASS_REPORT',
    resultVersion: 'compass-six-modules-v1',
    resultPayload: null,
    disclaimerVersion: 'legacy-education-compass-disclaimer-v1',
    ruleVersion: 'education-rules-v1',
    disclaimerTextHash: null
  }
}

export function generateSixModuleReport(report: Report, assessment: Assessment, student: Student, now: string): Report {
  const answers = assessment.answers
  const stage = answerText(answers, 'school_stage', student.grade || '当前阶段')
  const strengths = answerText(answers, 'strengths', '持续探索意愿')
  const interests = answerText(answers, 'interests', student.interest || '多元兴趣')
  const challenges = answerText(answers, 'challenges', '方向探索')
  const goal = answerText(answers, 'future_goal', student.goal || '逐步明确方向')
  const support = answerText(answers, 'support_need', '阶段规划')
  const rhythm = answerText(answers, 'available_time', '每两周复盘一次')

  const modules: ReportModule[] = [
    {
      key: 'student_profile', title: MODULE_TITLES[0]!,
      summary: `目前处于${stage}。画像只反映本次测评快照，后续行动与反馈可持续更新。`,
      items: [`兴趣线索：${interests}`, `当前目标：${goal}`, `需关注议题：${challenges}`]
    },
    {
      key: 'strengths', title: MODULE_TITLES[1]!,
      summary: `家庭目前观察到的主要优势为：${strengths}。建议通过真实任务继续收集证据。`,
      items: ['记录主动投入的情境', '比较不同任务中的持续度', '用作品或过程记录验证能力变化']
    },
    {
      key: 'major_directions', title: MODULE_TITLES[2]!,
      summary: `以“${interests}”为起点形成三个探索方向，先验证再缩小范围。`,
      items: ['方向A：围绕核心兴趣开展专业调研', '方向B：将已观察优势映射到专业能力要求', '方向C：保留一条跨学科体验方向']
    },
    {
      key: 'university_match', title: MODULE_TITLES[3]!,
      summary: '采用冲刺、适配、稳健三个匹配层级；具体院校须基于已核验的当年官方数据再展示。',
      items: ['冲刺：要求高于当前证据水平的探索目标', '适配：能力与投入条件较吻合的目标', '稳健：在当前约束内可持续推进的目标']
    },
    {
      key: 'routes', title: MODULE_TITLES[4]!,
      summary: `主路线围绕“${goal}”逐步验证，同时保留根据学术反馈与家庭约束切换的备选路线。`,
      items: ['主路线：先补齐关键事实并完成一次体验', '备选路线：保留相邻能力方向', '转换条件：兴趣持续度、学术证据或时间预算发生明显变化']
    },
    {
      key: 'action_plan', title: MODULE_TITLES[5]!,
      summary: `未来30天优先获得${support}支持，并按“${rhythm}”复盘；6—24个月按学期更新路径。`,
      items: ['最近30天：完成一次方向访谈或项目体验', '未来6个月：形成作品、课程或活动证据', '未来12—24个月：结合最新官方要求更新目标组合']
    }
  ]

  assertReportQa(modules)
  return { ...report, status: 'LOCKED', deliveryStatus: 'LOCKED', modules, qaPassed: true, updatedAt: now }
}

export function assertReportQa(modules: ReportModule[]): void {
  invariant(modules.length === 6, 500, 'REPORT_QA_FAILED', '完整报告必须包含六个模块')
  invariant(modules.every((module, index) => module.key === MODULE_KEYS[index]), 500, 'REPORT_QA_FAILED', '报告模块顺序无效')
  const serialized = JSON.stringify(modules)
  const forbidden = ['保证', '一定录取', '保录', '稳进', '保底', '百分百', '录取率']
  invariant(!forbidden.some((word) => serialized.includes(word)), 500, 'REPORT_QA_FAILED', '报告包含不允许的承诺性表述')
}
