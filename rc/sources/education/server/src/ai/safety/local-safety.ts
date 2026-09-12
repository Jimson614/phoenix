import { AppError, invariant } from '../../domain/errors'
import { AgentReplyDraft, AgentReportContext } from '../provider/agent-provider'

export type LocalBlockKind =
  | 'PII_DETECTED'
  | 'CRISIS_CONTENT'
  | 'PROFESSIONAL_BOUNDARY'
  | 'PROMPT_INJECTION'

export interface LocalSafetyDecision {
  action: 'ALLOW' | 'BLOCK'
  normalized: string
  code?: LocalBlockKind
  category?: string
  safeMessage?: string
  requiresGuardianAttention: boolean
}

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const MAINLAND_PHONE = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/
const HONG_KONG_PHONE = /(?<!\d)(?:\+?852[-\s]?)?[2-9]\d{3}[-\s]?\d{4}(?!\d)/
const MAINLAND_ID = /(?<!\d)\d{17}[0-9Xx](?!\d)/
const HONG_KONG_ID = /\b[A-Z]{1,2}\d{6}\([0-9A]\)\b/i
const OPEN_ID = /\b(?:openid|unionid|transaction[_-]?id)\s*[:=]\s*[A-Za-z0-9_-]{6,}\b/i
const EXACT_SCHOOL = /[\p{Script=Han}A-Za-z0-9·]{2,30}(?:小学|中学|学校)(?=[，。！？、\s]|$)/u
const EXACT_ADDRESS = /(?:住址|地址|居住在|住在)[:：]?[^，。！？\n]{4,80}/u
const PERSON_NAME = /(?:姓名|名字|孩子叫|我叫)[:：]?\s*[\p{Script=Han}A-Za-z·]{2,30}/u

const CRISIS = /自杀|不想活|结束生命|伤害自己|割腕|跳楼|杀死|伤害他人|性侵|猥亵|虐待/u
const PROFESSIONAL_BOUNDARY = /确诊|诊断为|处方|法律意见|投资建议|保证录取|百分之百录取|一定能录取/u
const PROMPT_INJECTION = /忽略.{0,16}(?:之前|以上|系统).{0,16}指令|系统提示词|system\s*prompt|泄露.{0,8}(?:提示词|规则)|修改价格|改价|解锁报告|绕过.{0,8}(?:付费|权限)/iu

const CRISIS_MESSAGE = '如果孩子或任何人正面临立即危险，请立刻联系身边可信成年人和当地紧急服务。此功能不能处理危机情况，请尽快寻求合资格专业人员协助。'

function piiCategory(value: string): string | null {
  if (EMAIL.test(value)) return 'email'
  if (MAINLAND_PHONE.test(value) || HONG_KONG_PHONE.test(value)) return 'phone'
  if (MAINLAND_ID.test(value) || HONG_KONG_ID.test(value)) return 'identity_document'
  if (OPEN_ID.test(value)) return 'platform_identifier'
  if (EXACT_ADDRESS.test(value)) return 'exact_address'
  if (EXACT_SCHOOL.test(value)) return 'school'
  if (PERSON_NAME.test(value)) return 'name'
  return null
}

export function inspectLocalInput(raw: unknown, maxCharacters: number): LocalSafetyDecision {
  invariant(typeof raw === 'string', 400, 'AGENT_MESSAGE_INVALID', 'message 必须是文本')
  const normalized = raw.trim().replace(/\r\n/g, '\n')
  invariant(normalized.length > 0, 400, 'AGENT_MESSAGE_REQUIRED', '请输入需要解读的问题')
  invariant(normalized.length <= maxCharacters, 400, 'AGENT_MESSAGE_TOO_LONG', `问题不能超过${maxCharacters}个字符`)

  if (CRISIS.test(normalized)) {
    return {
      action: 'BLOCK', normalized: '', code: 'CRISIS_CONTENT', category: 'crisis',
      safeMessage: CRISIS_MESSAGE, requiresGuardianAttention: true
    }
  }
  const pii = piiCategory(normalized)
  if (pii) {
    return {
      action: 'BLOCK', normalized: '', code: 'PII_DETECTED', category: pii,
      safeMessage: '为保护孩子与家庭隐私，请移除姓名、电话、邮箱、学校、证件或详细地址后重新提问。',
      requiresGuardianAttention: false
    }
  }
  if (PROFESSIONAL_BOUNDARY.test(normalized)) {
    return {
      action: 'BLOCK', normalized: '', code: 'PROFESSIONAL_BOUNDARY', category: 'professional_boundary',
      safeMessage: 'AI 解读不能提供诊断、法律或财务结论，也不能保证录取结果。请改为询问报告中已呈现的方向、依据或下一步行动。',
      requiresGuardianAttention: false
    }
  }
  if (PROMPT_INJECTION.test(normalized)) {
    return {
      action: 'BLOCK', normalized: '', code: 'PROMPT_INJECTION', category: 'instruction_override',
      safeMessage: '该请求超出报告解读范围。你可以继续询问报告中的结论、来源、限制或行动建议。',
      requiresGuardianAttention: false
    }
  }
  return { action: 'ALLOW', normalized, requiresGuardianAttention: false }
}

export function redactContextText(raw: string): string {
  const replaceEvery = (value: string, pattern: RegExp, replacement: string): string => {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    return value.replace(new RegExp(pattern.source, flags), replacement)
  }
  return [
    [EMAIL, '[EMAIL_REDACTED]'],
    [MAINLAND_PHONE, '[PHONE_REDACTED]'],
    [HONG_KONG_PHONE, '[PHONE_REDACTED]'],
    [MAINLAND_ID, '[ID_REDACTED]'],
    [HONG_KONG_ID, '[ID_REDACTED]'],
    [OPEN_ID, '[PLATFORM_ID_REDACTED]'],
    [EXACT_ADDRESS, '[ADDRESS_REDACTED]'],
    [EXACT_SCHOOL, '[SCHOOL_REDACTED]'],
    [PERSON_NAME, '[NAME_REDACTED]']
  ].reduce((value, pair) => replaceEvery(value, pair[0] as RegExp, pair[1] as string), raw)
}

export function assertSafeAgentReportContext(context: AgentReportContext): void {
  const fragments = [context.disclaimer, ...context.modules.flatMap((module) => [module.title, module.summary, ...module.items])]
  for (const fragment of fragments) {
    invariant(!PROMPT_INJECTION.test(fragment), 409, 'AGENT_CONTEXT_UNSAFE', '报告上下文包含不安全指令')
    invariant(!/(?:引用|来源|source)\s*[:：#]?\s*S\d{1,3}\b/iu.test(fragment), 409, 'AGENT_CONTEXT_UNSAFE', '报告上下文包含未经验证的来源引用')
    invariant(!CRISIS.test(fragment), 409, 'AGENT_CONTEXT_REQUIRES_HUMAN_REVIEW', '报告上下文需要人工复核')
    const sentences = fragment.split(/[。！？!?;；\n]/u)
    for (const sentence of sentences) {
      const guarantee = /(?:保证|确保|一定|百分之百).{0,16}(?:录取|升学成功|申请成功)/u.test(sentence)
      const guaranteeDisclaimer = /(?:不|不能|无法|不可|并非|绝不)(?:能)?(?:保证|确保)|不代表.{0,8}(?:录取|申请)结果/u.test(sentence)
      invariant(!guarantee || guaranteeDisclaimer, 409, 'AGENT_CONTEXT_UNSAFE', '报告上下文包含保证性结论')
      const diagnosis = /(?:确诊|诊断为|患有|判定为).{0,20}(?:疾病|障碍|抑郁|焦虑|多动|自闭)|(?:确诊|诊断为)\S{1,30}/u.test(sentence)
      const diagnosisDisclaimer = /(?:不构成|不能|无法|不可|并非|不是|非)(?:医学)?诊断|不能替代.{0,8}(?:医生|专业诊断)/u.test(sentence)
      invariant(!diagnosis || diagnosisDisclaimer, 409, 'AGENT_CONTEXT_UNSAFE', '报告上下文包含诊断性结论')
    }
  }
  invariant(context.sources.every((source, index) => source.alias === `S${index + 1}`), 409, 'AGENT_CONTEXT_UNSAFE', '报告来源别名无效')
}

function stringArray(value: unknown, field: string, min: number, max: number, itemMax: number): string[] {
  invariant(Array.isArray(value), 502, 'AGENT_OUTPUT_SCHEMA_INVALID', `${field} 格式无效`)
  invariant(value.length >= min && value.length <= max, 502, 'AGENT_OUTPUT_SCHEMA_INVALID', `${field} 数量无效`)
  invariant(value.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= itemMax), 502, 'AGENT_OUTPUT_SCHEMA_INVALID', `${field} 内容无效`)
  return value.map((item) => String(item).trim())
}

export function validateAgentReplyDraft(value: unknown, allowedAliases: readonly string[]): AgentReplyDraft {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 502, 'AGENT_OUTPUT_SCHEMA_INVALID', '模型输出不是对象')
  const source = value as Record<string, unknown>
  invariant(Object.keys(source).every((key) => ['answer', 'keyPoints', 'nextSteps', 'limitations', 'sourceAliases', 'safety'].includes(key)), 502, 'AGENT_OUTPUT_SCHEMA_INVALID', '模型输出包含未知字段')
  invariant(typeof source.answer === 'string' && source.answer.trim().length > 0 && source.answer.length <= 4000, 502, 'AGENT_OUTPUT_SCHEMA_INVALID', 'answer 无效')
  const keyPoints = stringArray(source.keyPoints, 'keyPoints', 0, 5, 500)
  const nextSteps = stringArray(source.nextSteps, 'nextSteps', 0, 3, 500)
  const limitations = stringArray(source.limitations, 'limitations', 1, 3, 500)
  const sourceAliases = stringArray(source.sourceAliases, 'sourceAliases', 0, Math.min(20, allowedAliases.length), 12)
  invariant(new Set(sourceAliases).size === sourceAliases.length && sourceAliases.every((alias) => allowedAliases.includes(alias)), 502, 'AGENT_SOURCE_INVALID', '模型引用了未提供的来源')
  invariant(source.safety !== null && typeof source.safety === 'object' && !Array.isArray(source.safety), 502, 'AGENT_OUTPUT_SCHEMA_INVALID', 'safety 无效')
  const safety = source.safety as Record<string, unknown>
  invariant(Object.keys(safety).every((key) => ['level', 'requiresGuardianAttention'].includes(key)), 502, 'AGENT_OUTPUT_SCHEMA_INVALID', 'safety 包含未知字段')
  invariant(safety.level === 'STANDARD', 502, 'AGENT_OUTPUT_SCHEMA_INVALID', 'safety.level 无效')
  invariant(typeof safety.requiresGuardianAttention === 'boolean', 502, 'AGENT_OUTPUT_SCHEMA_INVALID', 'safety.requiresGuardianAttention 无效')

  const reply: AgentReplyDraft = {
    answer: source.answer.trim(), keyPoints, nextSteps, limitations, sourceAliases,
    safety: {
      level: safety.level,
      requiresGuardianAttention: safety.requiresGuardianAttention
    }
  }
  validateLocalOutput(reply)
  return reply
}

export function validateLocalOutput(reply: AgentReplyDraft): void {
  const text = [reply.answer, ...reply.keyPoints, ...reply.nextSteps, ...reply.limitations].join('\n')
  invariant(!piiCategory(text), 502, 'AGENT_OUTPUT_PII', '模型输出包含个人信息')
  invariant(!PROMPT_INJECTION.test(text), 502, 'AGENT_OUTPUT_POLICY', '模型输出包含内部指令内容')
  const prohibitedConclusion = text.split(/[。！？!?;；\n]/u).some((sentence) => {
    const guarantee = /(?:保证|确保|一定|百分之百).{0,12}(?:录取|升学成功|申请成功)/u.test(sentence)
    const guaranteeDisclaimer = /(?:不|不能|无法|不可|并非|绝不)(?:能)?(?:保证|确保)|不代表.{0,8}(?:录取|申请)结果/u.test(sentence)
    const diagnosis = /确诊为|诊断为|法律结论|投资回报/u.test(sentence)
    const diagnosisDisclaimer = /(?:不构成|不能|无法|不可|并非|不是|非)(?:医学)?诊断|不能替代.{0,8}(?:医生|专业诊断)/u.test(sentence)
    return (guarantee && !guaranteeDisclaimer) || (diagnosis && !diagnosisDisclaimer)
  })
  invariant(!prohibitedConclusion, 502, 'AGENT_OUTPUT_POLICY', '模型输出包含越权结论')
  invariant(!/https?:\/\/|\b\d{3,4}-\d{6,8}\b/u.test(text), 502, 'AGENT_OUTPUT_UNTRUSTED_CONTACT', '模型输出包含未经批准的链接或热线')
}

export function stableBlockedReply(decision: LocalSafetyDecision): AgentReplyDraft {
  if (decision.action !== 'BLOCK' || !decision.safeMessage) throw new AppError(500, 'AGENT_SAFETY_STATE_INVALID', '安全阻断状态无效')
  return {
    answer: decision.safeMessage,
    keyPoints: [],
    nextSteps: decision.requiresGuardianAttention ? ['请由监护人陪同，并尽快联系可信成年人或当地紧急服务。'] : [],
    limitations: ['Phoenix AI 仅提供已购报告的辅助解读，不能替代专业判断。'],
    sourceAliases: [],
    safety: {
      level: 'STANDARD',
      requiresGuardianAttention: decision.requiresGuardianAttention
    }
  }
}
