"use client";

import { useMemo, useState } from "react";

export type DimensionId =
  | "financial_readiness"
  | "risk_readiness"
  | "family_alignment"
  | "action_habit"
  | "goal_clarity"
  | "resilience";

export const QUESTION_BANK_VERSION = "wc-preview-question-bank-v1.0.0";
export const SCORING_RULES_VERSION = "wc-preview-scoring-v1.0.0";
export const CONSENT_COPY_VERSION = "wc-preview-consent-v1.0.0";
export const PERSONA_PRESET_VERSION = "wc-preview-persona-v1.0.0";

export const SKIP_VALUE = "skip" as const;

export type Option = Readonly<{
  value: string;
  label: string;
  help?: string;
  scores?: Partial<Record<DimensionId, number>>;
}>;

export type StepType = "intro" | "c1" | "c2" | "question" | "c3" | "c4" | "c5" | "result";

export type Step = Readonly<{
  id: string;
  type: StepType;
  title: string;
  description: string;
  question: string;
  required?: boolean;
  options: Option[];
  allowSkip?: boolean;
}>;

export type PersonaId = "personaA" | "personaB" | "personaC";

export type Persona = Readonly<{
  id: PersonaId;
  name: string;
  note: string;
  answers: Record<string, string>;
  score: Record<DimensionId, number>;
  topGaps: string[];
}>;

export type ValidationResult = Readonly<{ success: true; errors: [] }> | Readonly<{ success: false; errors: readonly string[] }>;

export type QuestionBankContract = Readonly<{
  version: string;
  dimensionIds: readonly DimensionId[];
  stepOrder: readonly string[];
  questionIds: readonly string[];
  stepProfiles: ReadonlyArray<{
    id: string;
    type: StepType;
    optionCount: number;
    hasSkip: boolean;
    scoreDimensionKeys: readonly DimensionId[];
  }>;
}>;

export type ScoringContract = Readonly<{
  version: string;
  questions: ReadonlyArray<{
    id: string;
    options: ReadonlyArray<{
      value: string;
      scores: ReadonlyArray<{ dimension: DimensionId; value: number }>;
    }>;
  }>;
}>;

export type ConsentContract = Readonly<{
  version: string;
  items: ReadonlyArray<{
    id: string;
    title: string;
    description: string;
    question: string;
    options: ReadonlyArray<{ value: string; label: string; help?: string }>;
  }>;
}>;

export type PersonaContract = Readonly<{
  version: string;
  personas: ReadonlyArray<{
    id: PersonaId;
    name: string;
    note: string;
    answers: ReadonlyArray<[string, string]>;
    score: ReadonlyArray<{ dimension: DimensionId; value: number }>;
    topGaps: readonly string[];
  }>;
}>;

export const DIMENSIONS: ReadonlyArray<{ id: DimensionId; label: string; unit: string }> = [
  { id: "financial_readiness", label: "财务基础", unit: "Financial Readiness" },
  { id: "risk_readiness", label: "风险承受", unit: "Risk Readiness" },
  { id: "family_alignment", label: "家庭共识", unit: "Family Alignment" },
  { id: "action_habit", label: "执行节奏", unit: "Action Habit" },
  { id: "goal_clarity", label: "目标清晰度", unit: "Goal Clarity" },
  { id: "resilience", label: "抗波动韧性", unit: "Resilience" },
];

export const FLOW: ReadonlyArray<Step> = [
  {
    id: "intro",
    type: "intro",
    title: "入口说明",
    description:
      "这是 Wealth Compass 的内部移动端交互测试壳，默认展示 Mock 数据，便于 Jimmy 在不改动生产闭环的情况下验收交互结构。",
    question: "开始前请先确认你是内部预览。",
    options: [],
  },
  {
    id: "c1",
    type: "c1",
    title: "C1 基础授权",
    description: "用于演示授权文案与同意态势的入口，不作生产写入。",
    question: "同意在本次测试中继续采集题目与交互状态吗？",
    required: true,
    options: [
      { value: "c1_allow", label: "同意", help: "允许继续" },
      { value: "c1_deny", label: "不同意", help: "仅允许查看说明，不进入题目" },
    ],
  },
  {
    id: "c2",
    type: "c2",
    title: "C2 基础授权",
    description: "用于演示结果页和反馈环节的授权确认，不绑定真实 CRM。",
    question: "是否允许本次测评结果用于页面预览与内部讨论？",
    required: true,
    options: [
      { value: "c2_allow", label: "允许", help: "进入后续流程" },
      { value: "c2_deny", label: "不允许", help: "无法进入评分阶段" },
      { value: "c2_partial", label: "仅允许匿名预览", help: "保留匿名化结果" },
    ],
  },
  {
    id: "q1",
    type: "question",
    title: "第1题｜是否具备现金流缓冲？",
    description: "每屏只展示一题，确认“暂不回答”体验。",
    question: "家庭近6个月是否具备至少1-2个月支出缓冲？",
    required: true,
    allowSkip: true,
    options: [
      {
        value: "q1_yes",
        label: "有，且有固定预算记录",
        scores: {
          financial_readiness: 88,
          resilience: 75,
        },
      },
      {
        value: "q1_limited",
        label: "有一点，但不够稳定",
        scores: {
          financial_readiness: 55,
          resilience: 58,
        },
      },
      {
        value: "q1_no",
        label: "目前还没有",
        scores: {
          financial_readiness: 32,
          resilience: 40,
        },
      },
    ],
  },
  {
    id: "q2",
    type: "question",
    title: "第2题｜对波动的接受程度",
    description: "每屏只展示一题。",
    question: "当投资组合出现回撤时，家庭对调整节奏的偏好是？",
    required: true,
    allowSkip: true,
    options: [
      {
        value: "q2_low",
        label: "偏保守，优先稳态",
        scores: {
          risk_readiness: 35,
          resilience: 42,
        },
      },
      {
        value: "q2_mid",
        label: "可承担中等波动，愿意分批执行",
        scores: {
          risk_readiness: 66,
          resilience: 64,
        },
      },
      {
        value: "q2_high",
        label: "接受一定波动，关注成长节奏",
        scores: {
          risk_readiness: 82,
          resilience: 76,
        },
      },
    ],
  },
  {
    id: "q3",
    type: "question",
    title: "第3题｜家庭目标一致性",
    description: "每屏只展示一题。",
    question: "家庭成员是否已形成统一的阶段目标与行动边界？",
    required: true,
    allowSkip: true,
    options: [
      {
        value: "q3_low",
        label: "目前分歧较大",
        scores: {
          family_alignment: 28,
          goal_clarity: 31,
        },
      },
      {
        value: "q3_mid",
        label: "基本一致，偶有边界不同",
        scores: {
          family_alignment: 64,
          goal_clarity: 60,
        },
      },
      {
        value: "q3_high",
        label: "高度一致，执行前先统一节奏",
        scores: {
          family_alignment: 86,
          goal_clarity: 84,
        },
      },
    ],
  },
  {
    id: "q4",
    type: "question",
    title: "第4题｜是否有日常执行机制",
    description: "每屏只展示一题。",
    question: "你更可能在家庭层面维持多长的持续行动周期？",
    required: true,
    allowSkip: true,
    options: [
      {
        value: "q4_irregular",
        label: "执行容易中断，需要提醒",
        scores: {
          action_habit: 34,
          resilience: 36,
        },
      },
      {
        value: "q4_regular",
        label: "可维持1-2周的规律循环",
        scores: {
          action_habit: 64,
          resilience: 68,
        },
      },
      {
        value: "q4_consistent",
        label: "可稳定每周回顾并复盘",
        scores: {
          action_habit: 86,
          resilience: 80,
        },
      },
    ],
  },
  {
    id: "q5",
    type: "question",
    title: "第5题｜目标拆解能力",
    description: "每屏只展示一题。",
    question: "目标是否可拆成周度行动清单？",
    required: true,
    allowSkip: true,
    options: [
      {
        value: "q5_no",
        label: "目前只停留在口头共识",
        scores: {
          goal_clarity: 38,
          action_habit: 42,
        },
      },
      {
        value: "q5_partial",
        label: "有大方向，细节还在补齐",
        scores: {
          goal_clarity: 60,
          action_habit: 58,
        },
      },
      {
        value: "q5_yes",
        label: "目标可拆分并已开始执行",
        scores: {
          goal_clarity: 87,
          action_habit: 82,
        },
      },
    ],
  },
  {
    id: "q6",
    type: "question",
    title: "第6题｜压力触发点",
    description: "每屏只展示一题。",
    question: "当外部噪音较大时，家庭更容易因为什么停止行动？",
    required: true,
    allowSkip: true,
    options: [
      {
        value: "q6_info",
        label: "消息过载，缺少决策边界",
        scores: {
          resilience: 38,
          goal_clarity: 43,
        },
      },
      {
        value: "q6_time",
        label: "时间不足，优先级分散",
        scores: {
          resilience: 52,
          action_habit: 54,
        },
      },
      {
        value: "q6_none",
        label: "会保留观察窗口并降低损失",
        scores: {
          resilience: 79,
          goal_clarity: 72,
        },
      },
    ],
  },
  {
    id: "c3",
    type: "c3",
    title: "C3 顾问联系选择",
    description: "仅为预览用途，提交后不发生真实转介。",
    question: "如需复核，偏好哪种顾问联系方式？",
    options: [
      { value: "c3_wechat", label: "微信联系" },
      { value: "c3_phone", label: "电话联系" },
      { value: "c3_none", label: "暂不联系" },
    ],
  },
  {
    id: "c4",
    type: "c4",
    title: "C4 伙伴授权占位",
    description: "本项为占位项，验证界面占位与回传结构，不真实触发。",
    question: "是否允许占位展示中的合作方同步？",
    options: [
      { value: "c4_allowed", label: "允许（占位）" },
      { value: "c4_denied", label: "不允许（占位）" },
    ],
  },
  {
    id: "c5",
    type: "c5",
    title: "C5 营销授权",
    description: "用于展示营销消息开关，与真实推送解耦。",
    question: "是否同意接收后续运营与活动通知？",
    options: [
      { value: "c5_opt_in", label: "是，愿意接收" },
      { value: "c5_opt_out", label: "否，不接收" },
    ],
  },
  {
    id: "result",
    type: "result",
    title: "六维结果预览",
    description: "Mock 结果面板：六维预览 + Top Gaps + Hard Risk 提示。",
    question: "以下为当前答题路径下的 Wealth Compass 预览结果。",
    options: [],
  },
];

export const PERSONAS: Readonly<Record<PersonaId, Persona>> = {
  personaA: {
    id: "personaA",
    name: "Persona A｜平衡成长型",
    note: "偏稳健，适合小步快跑，结果适合周计划迭代。",
    answers: {
      c1: "c1_allow",
      c2: "c2_allow",
      q1: "q1_yes",
      q2: "q2_mid",
      q3: "q3_high",
      q4: "q4_regular",
      q5: "q5_yes",
      q6: "q6_none",
      c3: "c3_wechat",
      c4: "c4_allowed",
      c5: "c5_opt_in",
    },
    score: {
      financial_readiness: 82,
      risk_readiness: 72,
      family_alignment: 86,
      action_habit: 78,
      goal_clarity: 84,
      resilience: 74,
    },
    topGaps: ["优化现金流月度复盘", "提升执行复盘节奏", "引入更稳定风险上限规则"],
  },
  personaB: {
    id: "personaB",
    name: "Persona B｜目标导向型",
    note: "目标很清楚但执行波动较大，建议增加流程约束。",
    answers: {
      c1: "c1_allow",
      c2: "c2_allow",
      q1: "q1_limited",
      q2: "q2_mid",
      q3: "q3_mid",
      q4: "q4_irregular",
      q5: "q5_partial",
      q6: "q6_time",
      c3: "c3_phone",
      c4: "c4_denied",
      c5: "c5_opt_in",
    },
    score: {
      financial_readiness: 61,
      risk_readiness: 58,
      family_alignment: 62,
      action_habit: 44,
      goal_clarity: 75,
      resilience: 56,
    },
    topGaps: ["固化周例会节奏", "优化时间分配", "建立执行触发提醒机制"],
  },
  personaC: {
    id: "personaC",
    name: "Persona C｜Hard Risk 警示型",
    note: "存在高风险点，建议先做人工复核后再走后续推荐。",
    answers: {
      c1: "c1_allow",
      c2: "c2_allow",
      q1: "q1_no",
      q2: "q2_low",
      q3: "q3_low",
      q4: "q4_irregular",
      q5: "q5_no",
      q6: "q6_info",
      c3: "c3_wechat",
      c4: "c4_denied",
      c5: "c5_opt_out",
    },
    score: {
      financial_readiness: 28,
      risk_readiness: 30,
      family_alignment: 32,
      action_habit: 26,
      goal_clarity: 38,
      resilience: 29,
    },
    topGaps: ["现金流和风险边界未建立", "家庭共识不足", "先建立30天稳定执行窗口"],
  },
};

function hasSensitiveContent(text: string): boolean {
  const sensitiveWords = ["请输入", "请填写", "手机号", "身份证", "住址", "邮箱", "email", "联系方式", "家庭联系电话", "姓名", "身份证号"];
  return sensitiveWords.some((word) => text.includes(word));
}

function validateDimensionId(value: unknown): value is DimensionId {
  return (
    value === "financial_readiness" ||
    value === "risk_readiness" ||
    value === "family_alignment" ||
    value === "action_habit" ||
    value === "goal_clarity" ||
    value === "resilience"
  );
}

function sanitizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function buildQuestionBankContract(flow: ReadonlyArray<Step> = FLOW): QuestionBankContract {
  return {
    version: QUESTION_BANK_VERSION,
    dimensionIds: DIMENSIONS.map((dimension) => dimension.id),
    stepOrder: flow.map((step) => step.id),
    questionIds: flow.filter((step) => step.type === "question").map((step) => step.id),
    stepProfiles: flow.map((step) => {
      const scoreDimensionKeys = Array.from(
        new Set(
          step.options.flatMap((option) =>
            Object.keys(option.scores ?? {}).filter((value): value is DimensionId => validateDimensionId(value)),
          ),
        ),
      ).sort((left, right) => left.localeCompare(right));

      return {
        id: step.id,
        type: step.type,
        optionCount: step.options.length,
        hasSkip: Boolean(step.allowSkip),
        scoreDimensionKeys,
      };
    }),
  };
}

export function buildScoringContract(flow: ReadonlyArray<Step> = FLOW): ScoringContract {
  const questions = flow.filter((step) => step.type === "question");
  return {
    version: SCORING_RULES_VERSION,
    questions: questions.map((step) => ({
      id: step.id,
      options: step.options.map((option) => ({
        value: option.value,
        scores: Object.entries(option.scores ?? {})
          .map(([dimension, value]) => ({ dimension, value }))
          .filter((score): score is { dimension: DimensionId; value: number } =>
            validateDimensionId(score.dimension) && typeof score.value === "number",
          )
          .sort((left, right) => left.dimension.localeCompare(right.dimension)),
      })),
    })),
  };
}

export function buildConsentContract(flow: ReadonlyArray<Step> = FLOW): ConsentContract {
  const consentSteps = flow.filter((step) => ["c1", "c2", "c3", "c4", "c5"].includes(step.id));
  return {
    version: CONSENT_COPY_VERSION,
    items: consentSteps.map((step) => ({
      id: step.id,
      title: step.title,
      description: step.description,
      question: step.question,
      options: step.options.map((option) => ({
        value: option.value,
        label: option.label,
        help: option.help,
      })),
    })),
  };
}

export function buildPersonaContract(personas: Readonly<Record<PersonaId, Persona>> = PERSONAS): PersonaContract {
  return {
    version: PERSONA_PRESET_VERSION,
    personas: Object.values(personas).map((persona) => ({
      id: persona.id,
      name: persona.name,
      note: persona.note,
      answers: Object.entries(persona.answers).map(([key, value]) => [key, value]),
      score: DIMENSIONS.map((dimension) => ({ dimension: dimension.id, value: persona.score[dimension.id] })),
      topGaps: persona.topGaps,
    })),
  };
}

export function validateQuestionBankSchema(flow: ReadonlyArray<Step> = FLOW): ValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(flow)) {
    return { success: false, errors: ["题库结构必须是数组。"] };
  }

  if (flow.length < 2) {
    errors.push("题库需要包含至少 intro 与 result。");
  }

  const ids = new Set<string>();
  let introStepCount = 0;
  let resultStepCount = 0;
  const consentIds = new Set(["c1", "c2", "c3", "c4", "c5"]);
  const consentSteps = new Set<DimensionId | string>([]);

  for (const step of flow) {
    if (!step || typeof step !== "object") {
      errors.push("每个步骤必须是对象。");
      continue;
    }

    if (step.type === "intro") introStepCount += 1;
    if (step.type === "result") resultStepCount += 1;
    if (!step.id) errors.push("步骤必须有 id。");
    if (ids.has(step.id)) {
      errors.push(`步骤 id 重复：${step.id}`);
    } else {
      ids.add(step.id);
    }

    if (step.type !== "intro" && step.type !== "result" && step.options.length === 0) {
      errors.push(`步骤 ${step.id} 未配置选项。`);
    }

    if (step.type === "question" && !step.options.some((option) => Object.keys(option.scores ?? {}).length > 0)) {
      errors.push(`步骤 ${step.id} 缺少可评分选项。`);
    }

    if (hasSensitiveContent(`${step.title}${step.description}${step.question}`)) {
      errors.push(`步骤 ${step.id} 存在敏感文案。`);
    }

    if (step.id.startsWith("q") && !/^q\d+$/.test(step.id)) {
      errors.push(`问题 id 非法：${step.id}`);
    }

    if (consentIds.has(step.id)) {
      consentSteps.add(step.id);
    }

    const optionValues = new Set<string>();
    for (const option of step.options) {
      if (!sanitizeText(option.value)) errors.push(`步骤 ${step.id} 存在无效选项值。`);
      if (!sanitizeText(option.label)) errors.push(`步骤 ${step.id} 存在无效选项文案。`);
      if (optionValues.has(option.value)) {
        errors.push(`步骤 ${step.id} 选项重复：${option.value}`);
      } else {
        optionValues.add(option.value);
      }

      for (const [dimension, score] of Object.entries(option.scores ?? {})) {
        if (!validateDimensionId(dimension)) {
          errors.push(`步骤 ${step.id} 的评分维度非法：${dimension}`);
          continue;
        }
        if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) {
          errors.push(`步骤 ${step.id} 的评分值非法：${step.id}/${option.value}/${dimension}`);
        }
      }
    }
  }

  if (consentSteps.size !== 5) errors.push("需要完整的 C1–C5 同意步骤。");
  if (introStepCount !== 1) errors.push("需要且仅允许一个 intro 步骤。");
  if (resultStepCount !== 1) errors.push("需要且仅允许一个 result 步骤。");

  if (!flow.some((step) => step.type === "question")) {
    errors.push("题库缺少题目。");
  }

  const uniqueDimensionIds = DIMENSIONS.map((dimension) => dimension.id);
  const duplicatedDimensionIds = uniqueDimensionIds.filter((item, index) => uniqueDimensionIds.indexOf(item) !== index);
  if (duplicatedDimensionIds.length) {
    errors.push(`维度定义重复：${duplicatedDimensionIds.join(",")}`);
  }

  if (errors.length) {
    return {
      success: false,
      errors: [...new Set(errors)],
    };
  }
  return { success: true, errors: [] };
}

export function isConsentBlocked(answers: Readonly<Record<string, string>>): boolean {
  return answers.c1 === "c1_deny" || answers.c2 === "c2_deny";
}

export function canGeneratePreviewResult(answers: Readonly<Record<string, string>>): boolean {
  return !isConsentBlocked(answers);
}

export function canProgressFromStep(
  stepIndex: number,
  answers: Readonly<Record<string, string>>,
  flow: ReadonlyArray<Step> = FLOW,
): boolean {
  const step = flow[stepIndex];
  if (!step) return false;
  if (step.type === "intro" || step.type === "result") return true;

  const requireAnswer = new Set<StepType>(["question", "c1", "c2", "c3", "c4", "c5"]);
  return !requireAnswer.has(step.type) || Boolean(answers[step.id]);
}

export function getNextStepIndex(
  stepIndex: number,
  answers: Readonly<Record<string, string>>,
  flow: ReadonlyArray<Step> = FLOW,
): number {
  if (!canProgressFromStep(stepIndex, answers, flow)) return stepIndex;
  if (stepIndex >= flow.length - 1) return stepIndex;
  return stepIndex + 1;
}

export function getProgressPercent(stepIndex: number, flow: ReadonlyArray<Step> = FLOW): number {
  const step = flow[stepIndex];
  if (!step || step.type === "intro" || step.type === "result") return 0;
  const progressFlow = flow.filter((item) => item.type !== "intro" && item.type !== "result");
  const interactiveIndex = progressFlow.findIndex((item) => item.id === step.id);
  return ((interactiveIndex + 1) / progressFlow.length) * 100;
}

export function calculateResult(answers: Record<string, string>): {
  dimensions: Array<{ id: DimensionId; label: string; unit: string; score: number }>;
  topGaps: string[];
  hardRisk: boolean;
} {
  const stats = DIMENSIONS.reduce<Record<DimensionId, { total: number; count: number }>>(
    (acc, dimension) => {
      acc[dimension.id] = { total: 0, count: 0 };
      return acc;
    },
    Object.create(null),
  );

  FLOW.forEach((step) => {
    if (step.type !== "question") return;
    const value = answers[step.id];
    if (!value || value === SKIP_VALUE) return;
    const option = step.options.find((candidate) => candidate.value === value);
    if (!option?.scores) return;

    Object.entries(option.scores).forEach(([dimensionId, score]) => {
      if (!validateDimensionId(dimensionId)) return;
      stats[dimensionId].total += score;
      stats[dimensionId].count += 1;
    });
  });

  const dimensions = DIMENSIONS.map((dimension) => {
    const bucket = stats[dimension.id];
    const score = bucket.count ? bucket.total / bucket.count : 62;
    return {
      id: dimension.id,
      label: dimension.label,
      unit: dimension.unit,
      score: clamp(score),
    };
  });

  const topGaps = [...dimensions]
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((item) => `${item.label}不足：当前在该维度得分偏低`);

  const hardRisk =
    dimensions.some((item) => item.score < 35) ||
    (answers.q2 === "q2_low" && answers.q1 === "q1_no");

  return { dimensions, topGaps, hardRisk };
}

export default function InternalWealthCompassPreviewPage() {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [appliedPersona, setAppliedPersona] = useState<PersonaId | null>(null);

  const step = FLOW[stepIndex];
  const progress = getProgressPercent(stepIndex);
  const resultFromManual = useMemo(() => calculateResult(answers), [answers]);
  const selectedPersona = appliedPersona ? PERSONAS[appliedPersona] : null;
  const finalDimensions = selectedPersona
    ? DIMENSIONS.map((dimension) => ({
        id: dimension.id,
        label: dimension.label,
        unit: dimension.unit,
        score: selectedPersona.score[dimension.id],
      }))
    : resultFromManual.dimensions;

  const finalTopGaps = selectedPersona ? selectedPersona.topGaps : resultFromManual.topGaps;
  const finalHardRisk = selectedPersona ? appliedPersona === "personaC" : resultFromManual.hardRisk;
  const canProceed = canProgressFromStep(stepIndex, answers);
  const consentBlocked = isConsentBlocked(answers);
  const resultEnabled = canGeneratePreviewResult(answers);

  function pickOption(value: string) {
    setAnswers((current) => ({ ...current, [step.id]: value }));
    setAppliedPersona(null);
  }

  function goNext() {
    if (!canProceed) return;
    setStepIndex((current) => getNextStepIndex(current, answers));
  }

  function goBack() {
    if (stepIndex <= 0) return;
    setStepIndex((current) => current - 1);
  }

  function restart() {
    setStepIndex(0);
    setAnswers({});
    setAppliedPersona(null);
  }

  function applyPersona(persona: PersonaId) {
    setAppliedPersona(persona);
    setAnswers(PERSONAS[persona].answers);
    setStepIndex(FLOW.length - 1);
  }

  const selectedValue = answers[step.id];
  const nextLabel = step.type === "result" ? "" : "下一步";

  return (
    <main style={styles.page}>
      <section style={styles.panel}>
        <header style={styles.header}>
          <div>
            <p style={styles.internalStamp}>INTERNAL PREVIEW</p>
            <h1 style={styles.title}>Wealth Compass 移动端交互测试壳</h1>
            <p style={styles.description}>{step.question}</p>
          </div>
          <span style={styles.badge}>仅内部预览</span>
        </header>

        <div style={styles.noticeWrap}>
          <p>标记：使用模拟数据</p>
          <p>说明：不连接CRM</p>
          <p>说明：不生成真实转介</p>
          <p>说明：不对外发布</p>
        </div>

        <div style={styles.progressWrap} aria-live="polite">
          <div style={styles.progressLabel}>
            <span>流程进度（仅预览）</span>
            <strong>{clamp(progress)}%</strong>
          </div>
          <div style={styles.progressTrack}>
            <span style={{ ...styles.progressFill, width: `${clamp(progress)}%` }} />
          </div>
        </div>

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>{step.title}</h2>
          <p style={styles.cardDescription}>{step.description}</p>

          {step.type === "result" ? (
            <>
              <div style={styles.rowTwo} aria-live="polite">
                <p>结果来源：{selectedPersona ? selectedPersona.name : "当前答题路径动态计算"}</p>
                {!selectedPersona ? null : <p style={styles.note}>{selectedPersona.note}</p>}
              </div>

              <div style={styles.resultGrid}>
                {finalDimensions.map((item) => (
                  <article key={item.id} style={styles.resultCard}>
                    <p style={styles.resultTitle}>
                      {item.label}
                      <span>{item.unit}</span>
                    </p>
                    <div style={styles.barBg}>
                      <span
                        style={{
                          ...styles.barFill,
                          width: `${item.score}%`,
                          background: item.score < 35 ? "#ef4444" : "#2563eb",
                        }}
                      />
                    </div>
                    <strong>{item.score}</strong>
                  </article>
                ))}
              </div>

              <div style={styles.subCard}>
                <p style={styles.subTitle}>Top Gaps</p>
                <ul>
                  {finalTopGaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </div>

              {finalHardRisk ? (
                <div style={styles.riskCard}>
                  <p style={styles.riskTitle}>Hard Risk 人工复核提示</p>
                  <p>当前路径触发高风险复核条件，请在后端策略中接入人工复核池并阻断高风险自动化动作。</p>
                </div>
              ) : null}

              {resultEnabled ? null : (
                <div style={styles.blockHint}>
                  当前分支命中未授权，未开放建议生成功能，仅保留交互与页面结构复核。
                </div>
              )}

              <div style={styles.subCard}>
                <p style={styles.subTitle}>三类 Persona 一键载入</p>
                <div style={styles.personaActions}>
                  {Object.values(PERSONAS).map((persona) => (
                    <button
                      key={persona.id}
                      onClick={() => applyPersona(persona.id)}
                      style={styles.personaButton}
                      type="button"
                    >
                      {persona.name}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <p style={styles.question}>{step.question}</p>
              <div style={styles.options}>
                {step.options.map((option) => {
                  const isChecked = selectedValue === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => pickOption(option.value)}
                      style={isChecked ? { ...styles.option, ...styles.optionSelected } : styles.option}
                      type="button"
                    >
                      <span>{option.label}</span>
                      {option.help ? <small>{option.help}</small> : null}
                    </button>
                  );
                })}
                {step.allowSkip ? (
                  <button
                    onClick={() => pickOption(SKIP_VALUE)}
                    style={selectedValue === SKIP_VALUE ? { ...styles.option, ...styles.optionSkip } : styles.option}
                    type="button"
                  >
                    暂不回答
                  </button>
                ) : null}
                {step.type === "c2" && step.options.every((item) => item.value !== SKIP_VALUE) ? (
                  <p style={styles.helpText}>选择“不同意”用于模拟授权拦截分支，不进行评分预览。</p>
                ) : null}
              </div>
            </>
          )}

          {step.type === "intro" ? (
            <div style={styles.subCard}>
              <p style={styles.subTitle}>三类 Persona 一键载入</p>
              <div style={styles.personaActions}>
                {Object.values(PERSONAS).map((persona) => (
                  <button
                    key={persona.id}
                    onClick={() => applyPersona(persona.id)}
                    style={styles.personaButton}
                    type="button"
                  >
                    {persona.name}
                  </button>
                  ))}
              </div>
            </div>
          ) : null}

          {consentBlocked ? (
            <p style={styles.blockHint}>
              当前分支命中“未授权”状态，页面用于权限与阻断交互验证，不触发后续建议生成。
            </p>
          ) : null}
        </section>

        <div style={styles.actions}>
          <button disabled={!stepIndex} onClick={goBack} style={styles.secondaryButton} type="button">
            返回修改
          </button>
          {step.type === "result" ? (
            <button onClick={restart} style={styles.primaryButton} type="button">
              重新开始
            </button>
          ) : (
            <button disabled={!canProceed} onClick={goNext} style={styles.primaryButton} type="button">
              {nextLabel}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f7f7fb",
    padding: "1.25rem",
    color: "#0f172a",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  },
  panel: {
    maxWidth: 520,
    margin: "0 auto",
    display: "grid",
    gap: "1rem",
  },
  header: {
    background: "#fef3c7",
    borderRadius: 14,
    padding: "1rem",
    border: "1px solid #f59e0b33",
    boxShadow: "0 6px 24px #0000000d",
  },
  internalStamp: {
    margin: 0,
    color: "#92400e",
    fontWeight: 700,
    letterSpacing: "0.08em",
    fontSize: 12,
  },
  title: {
    margin: "0.2rem 0",
    fontSize: "1.25rem",
  },
  description: {
    margin: 0,
    color: "#334155",
    fontSize: 14,
    lineHeight: 1.5,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: "0.8rem",
    color: "#b91c1c",
    border: "1px solid #fecaca",
    background: "#fff7ed",
    borderRadius: 999,
    width: "fit-content",
    padding: "0.3rem 0.8rem",
    fontWeight: 700,
    fontSize: 12,
  },
  noticeWrap: {
    display: "grid",
    gap: 0.4,
    background: "#111827",
    color: "#dbeafe",
    fontSize: 12,
    borderRadius: 12,
    padding: "0.6rem 0.8rem",
    lineHeight: 1.35,
  },
  progressWrap: {
    display: "grid",
    gap: 0.4,
  },
  progressLabel: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
    color: "#475569",
    fontWeight: 600,
  },
  progressTrack: {
    position: "relative",
    height: 10,
    borderRadius: 999,
    background: "#e2e8f0",
    overflow: "hidden",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
    background: "#16a34a",
    transition: "width 180ms ease",
  },
  card: {
    background: "#ffffff",
    borderRadius: 14,
    padding: "1rem",
    boxShadow: "0 10px 30px #0f172a1a",
    display: "grid",
    gap: "0.8rem",
  },
  cardTitle: {
    margin: 0,
    fontSize: "1.05rem",
  },
  cardDescription: {
    margin: 0,
    color: "#475569",
    fontSize: 14,
    lineHeight: 1.5,
  },
  rowTwo: {
    display: "grid",
    gap: 0.35,
    color: "#334155",
    fontSize: 14,
  },
  note: {
    margin: 0,
    color: "#0ea5e9",
    fontSize: 13,
  },
  question: {
    margin: 0,
    fontWeight: 600,
  },
  options: {
    display: "grid",
    gap: 0.6,
  },
  option: {
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    background: "#f8fafc",
    textAlign: "left",
    padding: "0.8rem",
    display: "grid",
    gap: 0.2,
    cursor: "pointer",
    color: "#0f172a",
    minHeight: 44,
  },
  optionSelected: {
    borderColor: "#2563eb",
    background: "#eff6ff",
  },
  optionSkip: {
    borderColor: "#f59e0b",
    background: "#fef3c7",
  },
  helpText: {
    margin: "0.1rem 0 0",
    color: "#64748b",
    fontSize: 12,
  },
  blockHint: {
    margin: 0,
    background: "#fee2e2",
    border: "1px solid #fecaca",
    color: "#7f1d1d",
    borderRadius: 8,
    padding: "0.6rem",
    fontSize: 12,
  },
  resultGrid: {
    display: "grid",
    gap: 0.75,
  },
  resultCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: "0.7rem",
    background: "#f8fafc",
  },
  resultTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: 14,
    display: "flex",
    justifyContent: "space-between",
    gap: "0.5rem",
  },
  barBg: {
    marginTop: 0.4,
    marginBottom: 0.35,
    height: 8,
    borderRadius: 999,
    background: "#e2e8f0",
    overflow: "hidden",
    position: "relative",
  },
  barFill: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    transition: "width 160ms ease",
  },
  subCard: {
    border: "1px dashed #cbd5e1",
    borderRadius: 10,
    padding: "0.7rem",
    display: "grid",
    gap: 0.4,
    color: "#334155",
    fontSize: 14,
    lineHeight: 1.5,
  },
  subTitle: {
    margin: 0,
    color: "#0f172a",
    fontWeight: 700,
    fontSize: 14,
  },
  riskCard: {
    background: "#fee2e2",
    border: "1px solid #fca5a5",
    color: "#7f1d1d",
    borderRadius: 10,
    padding: "0.7rem",
    display: "grid",
    gap: 0.3,
  },
  riskTitle: {
    margin: 0,
    fontWeight: 700,
  },
  personaActions: {
    display: "grid",
    gap: 0.45,
  },
  personaButton: {
    border: "1px solid #2563eb",
    color: "#1d4ed8",
    background: "#e0e7ff",
    borderRadius: 8,
    padding: "0.55rem 0.7rem",
    fontSize: 13,
  },
  actions: {
    display: "grid",
    gap: 0.5,
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    background: "#fff",
    borderRadius: 10,
    padding: "0.75rem",
    minHeight: 44,
    cursor: "pointer",
  },
  primaryButton: {
    border: "1px solid #1d4ed8",
    background: "#2563eb",
    color: "#fff",
    borderRadius: 10,
    padding: "0.75rem",
    minHeight: 44,
    cursor: "pointer",
  },
};
