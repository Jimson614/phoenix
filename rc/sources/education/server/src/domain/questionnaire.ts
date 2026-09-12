import { invariant } from './errors'
import { Confidence } from './model'

export const QUESTIONNAIRE_VERSION = 'education_compass_v1'

type FieldType = 'single' | 'multi' | 'text'
interface QuestionnaireField {
  key: string
  type: FieldType
  weight: number
  options?: readonly string[]
  maxLength?: number
}

export const QUESTIONNAIRE_FIELDS: readonly QuestionnaireField[] = [
  { key: 'identity_type', type: 'single', weight: 6, options: ['香港永久居民', '香港非永久居民 / 受养人', '内地学生', '其他'] },
  { key: 'school_stage', type: 'single', weight: 4, options: ['小学', '初中', '高中', '大学', '其他'] },
  { key: 'education_system', type: 'single', weight: 4, options: ['内地课程', 'DSE', 'IB', 'A-Level', 'AP / 美式课程', '其他'] },
  { key: 'target_enrollment_year', type: 'single', weight: 6, options: ['1 年内', '2—3 年', '4 年以上', '尚未确定'] },
  { key: 'academic_summary', type: 'text', weight: 12, maxLength: 600 },
  { key: 'language_level', type: 'text', weight: 5, maxLength: 600 },
  { key: 'strongest_subjects', type: 'text', weight: 5, maxLength: 600 },
  { key: 'learning_feeling', type: 'single', weight: 3, options: ['主动投入', '基本稳定', '有些迷茫', '压力较大'] },
  { key: 'strengths', type: 'multi', weight: 6, options: ['好奇心', '表达力', '逻辑力', '创造力', '专注力', '同理心'] },
  { key: 'interests', type: 'text', weight: 6, maxLength: 600 },
  { key: 'strength_evidence', type: 'text', weight: 3, maxLength: 600 },
  { key: 'challenges', type: 'multi', weight: 4, options: ['目标不清晰', '学习动力不足', '时间管理', '亲子沟通', '升学选择', '压力焦虑'] },
  { key: 'parent_observation', type: 'text', weight: 3, maxLength: 600 },
  { key: 'parent_expectation', type: 'single', weight: 3, options: ['身心健康', '保持热爱', '学术成长', '独立选择', '综合发展'] },
  { key: 'future_goal', type: 'text', weight: 5, maxLength: 600 },
  { key: 'target_region', type: 'multi', weight: 5, options: ['香港', '中国内地', '英国', '美国', '加拿大', '澳大利亚', '其他 / 未确定'] },
  { key: 'target_major', type: 'text', weight: 5, maxLength: 600 },
  { key: 'route_preference', type: 'single', weight: 3, options: ['学术升学', '应用 / 职业方向', '艺术 / 体育方向', '跨学科探索', '尚未确定'] },
  { key: 'backup_route_acceptance', type: 'single', weight: 2, options: ['愿意', '需要了解后决定', '暂不考虑'] },
  { key: 'annual_budget', type: 'single', weight: 4, options: ['10 万元以内', '10—25 万元', '25—50 万元', '50 万元以上', '暂不确定'] },
  { key: 'available_time', type: 'single', weight: 2, options: ['每周一次', '每两周一次', '每月一次', '先获得建议再决定'] },
  { key: 'support_need', type: 'multi', weight: 3, options: ['方向梳理', '选科建议', '项目体验', '学习计划', '亲子沟通', '顾问解读'] },
  { key: 'location_preference', type: 'text', weight: 1, maxLength: 600 }
] as const

export const QUESTIONNAIRE_TOTAL_WEIGHT = QUESTIONNAIRE_FIELDS.reduce((sum, item) => sum + item.weight, 0)
if (QUESTIONNAIRE_TOTAL_WEIGHT !== 100) throw new Error('Questionnaire weights must total 100')

function isAnswered(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return value !== undefined && value !== null && String(value).trim().length > 0
}

export function calculateCompleteness(answers: Record<string, unknown>): {
  score: number
  missingFields: string[]
  confidence: Confidence
} {
  const earned = QUESTIONNAIRE_FIELDS.reduce((sum, field) => sum + (isAnswered(answers[field.key]) ? field.weight : 0), 0)
  const score = Math.round((earned / QUESTIONNAIRE_TOTAL_WEIGHT) * 100)
  const missingFields = QUESTIONNAIRE_FIELDS
    .filter((field) => !isAnswered(answers[field.key]))
    .sort((left, right) => right.weight - left.weight)
    .map((field) => field.key)
  const confidence: Confidence = score < 75 ? 'low' : score < 90 ? 'medium' : 'high'
  return { score, missingFields, confidence }
}

export function normalizeAnswers(input: unknown): Record<string, unknown> {
  invariant(input !== null && typeof input === 'object' && !Array.isArray(input), 400, 'INVALID_ANSWERS', 'answers 必须是对象')
  const source = input as Record<string, unknown>
  const fields = new Map(QUESTIONNAIRE_FIELDS.map((field) => [field.key, field]))
  const unknownFields = Object.keys(source).filter((key) => !fields.has(key))
  invariant(unknownFields.length === 0, 400, 'UNKNOWN_ANSWER_FIELDS', '问卷包含未知字段', { fields: unknownFields })
  const result: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(source)) {
    const field = fields.get(key)!
    if (field.type === 'text') {
      invariant(typeof raw === 'string', 400, 'ANSWER_SCHEMA_MISMATCH', `${key} 必须是文本`)
      invariant(raw.length <= (field.maxLength ?? 600), 400, 'ANSWER_TOO_LONG', `${key} 超过长度限制`)
      result[key] = raw.trim()
      continue
    }
    if (field.type === 'single') {
      invariant(typeof raw === 'string', 400, 'ANSWER_SCHEMA_MISMATCH', `${key} 必须是单选值`)
      const value = raw.trim()
      invariant(value === '' || field.options?.includes(value), 400, 'ANSWER_ENUM_INVALID', `${key} 选项无效`)
      result[key] = value
      continue
    }
    invariant(Array.isArray(raw), 400, 'ANSWER_SCHEMA_MISMATCH', `${key} 必须是多选数组`)
    invariant(raw.length <= (field.options?.length ?? 20), 400, 'ANSWER_SCHEMA_MISMATCH', `${key} 多选项过多`)
    invariant(raw.every((item) => typeof item === 'string' && field.options?.includes(item)), 400, 'ANSWER_ENUM_INVALID', `${key} 包含无效选项`)
    result[key] = [...new Set(raw)]
  }
  invariant(JSON.stringify(result).length <= 50_000, 400, 'INVALID_ANSWERS', '问卷答案总长度过大')
  return result
}
