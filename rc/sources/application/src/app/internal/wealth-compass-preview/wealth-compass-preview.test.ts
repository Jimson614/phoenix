import { describe, expect, it } from "vitest";

import {
  PERSONAS,
  calculateResult,
  buildConsentContract,
  buildPersonaContract,
  buildQuestionBankContract,
  buildScoringContract,
  canGeneratePreviewResult,
  canProgressFromStep,
  getNextStepIndex,
  getProgressPercent,
  isConsentBlocked,
  validateQuestionBankSchema,
  CONSENT_COPY_VERSION,
  PERSONA_PRESET_VERSION,
  QUESTION_BANK_VERSION,
  SCORING_RULES_VERSION,
  FLOW,
  SKIP_VALUE,
} from "./page";

const QUESTION_BANK_CONTRACTS = {
  [QUESTION_BANK_VERSION]: {
    version: QUESTION_BANK_VERSION,
    dimensionIds: ["financial_readiness", "risk_readiness", "family_alignment", "action_habit", "goal_clarity", "resilience"],
    stepOrder: ["intro", "c1", "c2", "q1", "q2", "q3", "q4", "q5", "q6", "c3", "c4", "c5", "result"],
    questionIds: ["q1", "q2", "q3", "q4", "q5", "q6"],
    stepProfiles: [
      { id: "intro", type: "intro", optionCount: 0, hasSkip: false, scoreDimensionKeys: [] },
      { id: "c1", type: "c1", optionCount: 2, hasSkip: false, scoreDimensionKeys: [] },
      { id: "c2", type: "c2", optionCount: 3, hasSkip: false, scoreDimensionKeys: [] },
      { id: "q1", type: "question", optionCount: 3, hasSkip: true, scoreDimensionKeys: ["financial_readiness", "resilience"] },
      { id: "q2", type: "question", optionCount: 3, hasSkip: true, scoreDimensionKeys: ["resilience", "risk_readiness"] },
      { id: "q3", type: "question", optionCount: 3, hasSkip: true, scoreDimensionKeys: ["family_alignment", "goal_clarity"] },
      { id: "q4", type: "question", optionCount: 3, hasSkip: true, scoreDimensionKeys: ["action_habit", "resilience"] },
      { id: "q5", type: "question", optionCount: 3, hasSkip: true, scoreDimensionKeys: ["action_habit", "goal_clarity"] },
      { id: "q6", type: "question", optionCount: 3, hasSkip: true, scoreDimensionKeys: ["goal_clarity", "resilience"] },
      { id: "c3", type: "c3", optionCount: 3, hasSkip: false, scoreDimensionKeys: [] },
      { id: "c4", type: "c4", optionCount: 2, hasSkip: false, scoreDimensionKeys: [] },
      { id: "c5", type: "c5", optionCount: 2, hasSkip: false, scoreDimensionKeys: [] },
      { id: "result", type: "result", optionCount: 0, hasSkip: false, scoreDimensionKeys: [] },
    ],
  },
} as const;

const SCORING_CONTRACTS = {
  [SCORING_RULES_VERSION]: {
    version: SCORING_RULES_VERSION,
    questions: [
      {
        id: "q1",
        options: [
          { value: "q1_yes", scores: [{ dimension: "financial_readiness", value: 88 }, { dimension: "resilience", value: 75 }] },
          { value: "q1_limited", scores: [{ dimension: "financial_readiness", value: 55 }, { dimension: "resilience", value: 58 }] },
          { value: "q1_no", scores: [{ dimension: "financial_readiness", value: 32 }, { dimension: "resilience", value: 40 }] },
        ],
      },
      {
        id: "q2",
        options: [
          { value: "q2_low", scores: [{ dimension: "risk_readiness", value: 35 }, { dimension: "resilience", value: 42 }] },
          { value: "q2_mid", scores: [{ dimension: "risk_readiness", value: 66 }, { dimension: "resilience", value: 64 }] },
          { value: "q2_high", scores: [{ dimension: "risk_readiness", value: 82 }, { dimension: "resilience", value: 76 }] },
        ],
      },
      {
        id: "q3",
        options: [
          { value: "q3_low", scores: [{ dimension: "family_alignment", value: 28 }, { dimension: "goal_clarity", value: 31 }] },
          { value: "q3_mid", scores: [{ dimension: "family_alignment", value: 64 }, { dimension: "goal_clarity", value: 60 }] },
          { value: "q3_high", scores: [{ dimension: "family_alignment", value: 86 }, { dimension: "goal_clarity", value: 84 }] },
        ],
      },
      {
        id: "q4",
        options: [
          { value: "q4_irregular", scores: [{ dimension: "action_habit", value: 34 }, { dimension: "resilience", value: 36 }] },
          { value: "q4_regular", scores: [{ dimension: "action_habit", value: 64 }, { dimension: "resilience", value: 68 }] },
          { value: "q4_consistent", scores: [{ dimension: "action_habit", value: 86 }, { dimension: "resilience", value: 80 }] },
        ],
      },
      {
        id: "q5",
        options: [
          { value: "q5_no", scores: [{ dimension: "goal_clarity", value: 38 }, { dimension: "action_habit", value: 42 }] },
          { value: "q5_partial", scores: [{ dimension: "goal_clarity", value: 60 }, { dimension: "action_habit", value: 58 }] },
          { value: "q5_yes", scores: [{ dimension: "goal_clarity", value: 87 }, { dimension: "action_habit", value: 82 }] },
        ],
      },
      {
        id: "q6",
        options: [
          { value: "q6_info", scores: [{ dimension: "goal_clarity", value: 43 }, { dimension: "resilience", value: 38 }] },
          { value: "q6_time", scores: [{ dimension: "action_habit", value: 54 }, { dimension: "resilience", value: 52 }] },
          { value: "q6_none", scores: [{ dimension: "goal_clarity", value: 72 }, { dimension: "resilience", value: 79 }] },
        ],
      },
    ],
  },
} as const;

const CONSENT_CONTRACTS = {
  [CONSENT_COPY_VERSION]: {
    version: CONSENT_COPY_VERSION,
    items: [
      {
        id: "c1",
        title: "C1 基础授权",
        description: "用于演示授权文案与同意态势的入口，不作生产写入。",
        question: "同意在本次测试中继续采集题目与交互状态吗？",
        options: [
          { value: "c1_allow", label: "同意", help: "允许继续" },
          { value: "c1_deny", label: "不同意", help: "仅允许查看说明，不进入题目" },
        ],
      },
      {
        id: "c2",
        title: "C2 基础授权",
        description: "用于演示结果页和反馈环节的授权确认，不绑定真实 CRM。",
        question: "是否允许本次测评结果用于页面预览与内部讨论？",
        options: [
          { value: "c2_allow", label: "允许", help: "进入后续流程" },
          { value: "c2_deny", label: "不允许", help: "无法进入评分阶段" },
          { value: "c2_partial", label: "仅允许匿名预览", help: "保留匿名化结果" },
        ],
      },
      {
        id: "c3",
        title: "C3 顾问联系选择",
        description: "仅为预览用途，提交后不发生真实转介。",
        question: "如需复核，偏好哪种顾问联系方式？",
        options: [
          { value: "c3_wechat", label: "微信联系", help: undefined },
          { value: "c3_phone", label: "电话联系", help: undefined },
          { value: "c3_none", label: "暂不联系", help: undefined },
        ],
      },
      {
        id: "c4",
        title: "C4 伙伴授权占位",
        description: "本项为占位项，验证界面占位与回传结构，不真实触发。",
        question: "是否允许占位展示中的合作方同步？",
        options: [
          { value: "c4_allowed", label: "允许（占位）", help: undefined },
          { value: "c4_denied", label: "不允许（占位）", help: undefined },
        ],
      },
      {
        id: "c5",
        title: "C5 营销授权",
        description: "用于展示营销消息开关，与真实推送解耦。",
        question: "是否同意接收后续运营与活动通知？",
        options: [
          { value: "c5_opt_in", label: "是，愿意接收", help: undefined },
          { value: "c5_opt_out", label: "否，不接收", help: undefined },
        ],
      },
    ],
  },
} as const;

const PERSONA_CONTRACTS = {
  [PERSONA_PRESET_VERSION]: {
    version: PERSONA_PRESET_VERSION,
    personas: [
      {
        id: "personaA",
        name: "Persona A｜平衡成长型",
        note: "偏稳健，适合小步快跑，结果适合周计划迭代。",
        answers: [
          ["c1", "c1_allow"],
          ["c2", "c2_allow"],
          ["q1", "q1_yes"],
          ["q2", "q2_mid"],
          ["q3", "q3_high"],
          ["q4", "q4_regular"],
          ["q5", "q5_yes"],
          ["q6", "q6_none"],
          ["c3", "c3_wechat"],
          ["c4", "c4_allowed"],
          ["c5", "c5_opt_in"],
        ],
        score: [
          { dimension: "financial_readiness", value: 82 },
          { dimension: "risk_readiness", value: 72 },
          { dimension: "family_alignment", value: 86 },
          { dimension: "action_habit", value: 78 },
          { dimension: "goal_clarity", value: 84 },
          { dimension: "resilience", value: 74 },
        ],
        topGaps: ["优化现金流月度复盘", "提升执行复盘节奏", "引入更稳定风险上限规则"],
      },
      {
        id: "personaB",
        name: "Persona B｜目标导向型",
        note: "目标很清楚但执行波动较大，建议增加流程约束。",
        answers: [
          ["c1", "c1_allow"],
          ["c2", "c2_allow"],
          ["q1", "q1_limited"],
          ["q2", "q2_mid"],
          ["q3", "q3_mid"],
          ["q4", "q4_irregular"],
          ["q5", "q5_partial"],
          ["q6", "q6_time"],
          ["c3", "c3_phone"],
          ["c4", "c4_denied"],
          ["c5", "c5_opt_in"],
        ],
        score: [
          { dimension: "financial_readiness", value: 61 },
          { dimension: "risk_readiness", value: 58 },
          { dimension: "family_alignment", value: 62 },
          { dimension: "action_habit", value: 44 },
          { dimension: "goal_clarity", value: 75 },
          { dimension: "resilience", value: 56 },
        ],
        topGaps: ["固化周例会节奏", "优化时间分配", "建立执行触发提醒机制"],
      },
      {
        id: "personaC",
        name: "Persona C｜Hard Risk 警示型",
        note: "存在高风险点，建议先做人工复核后再走后续推荐。",
        answers: [
          ["c1", "c1_allow"],
          ["c2", "c2_allow"],
          ["q1", "q1_no"],
          ["q2", "q2_low"],
          ["q3", "q3_low"],
          ["q4", "q4_irregular"],
          ["q5", "q5_no"],
          ["q6", "q6_info"],
          ["c3", "c3_wechat"],
          ["c4", "c4_denied"],
          ["c5", "c5_opt_out"],
        ],
        score: [
          { dimension: "financial_readiness", value: 28 },
          { dimension: "risk_readiness", value: 30 },
          { dimension: "family_alignment", value: 32 },
          { dimension: "action_habit", value: 26 },
          { dimension: "goal_clarity", value: 38 },
          { dimension: "resilience", value: 29 },
        ],
        topGaps: ["现金流和风险边界未建立", "家庭共识不足", "先建立30天稳定执行窗口"],
      },
    ],
  },
} as const;

describe("Question Bank schema validation", () => {
  it("passes strict bank schema and version lock", () => {
    const result = validateQuestionBankSchema(FLOW);
    expect(result).toEqual({ success: true, errors: [] });
    expect(buildQuestionBankContract(FLOW)).toEqual(QUESTION_BANK_CONTRACTS[QUESTION_BANK_VERSION]);
  });
});

describe("Scoring regression", () => {
  it("keeps deterministic dimension outputs for Persona A path", () => {
    const result = calculateResult(PERSONAS.personaA.answers);
    expect(result.dimensions.map((item) => item.score)).toEqual([88, 66, 86, 76, 81, 72]);
    expect(result.hardRisk).toBe(false);
  });

  it("keeps deterministic dimension outputs for Persona B path", () => {
    const result = calculateResult(PERSONAS.personaB.answers);
    expect(result.dimensions.map((item) => item.score)).toEqual([55, 66, 64, 49, 60, 53]);
    expect(result.hardRisk).toBe(false);
  });

  it("keeps deterministic dimension outputs for Persona C hard-risk path", () => {
    const result = calculateResult(PERSONAS.personaC.answers);
    expect(result.dimensions.map((item) => item.score)).toEqual([32, 35, 28, 38, 37, 39]);
    expect(result.hardRisk).toBe(true);
  });

  it("allows skip path without breaking top3 ranking", () => {
    const result = calculateResult({ q1: SKIP_VALUE, q2: SKIP_VALUE, q3: SKIP_VALUE, q4: SKIP_VALUE, q5: SKIP_VALUE, q6: SKIP_VALUE });
    expect(result.dimensions.every((item) => item.score === 62)).toBe(true);
    expect(result.topGaps).toHaveLength(3);
  });

  it("version-locks scoring contract", () => {
    expect(buildScoringContract(FLOW)).toEqual(SCORING_CONTRACTS[SCORING_RULES_VERSION]);
  });
});

describe("Consent gating", () => {
  it("locks forward movement on denied C1/C2 with explicit consent state", () => {
    const c1deny = { c1: "c1_deny", c2: "c2_deny" };
    expect(isConsentBlocked(c1deny)).toBe(true);
    expect(canGeneratePreviewResult(c1deny)).toBe(false);
  });

  it("only allows c-step/c-question progression after selection", () => {
    const c1Index = FLOW.findIndex((step) => step.id === "c1");
    const questionIndex = FLOW.findIndex((step) => step.id === "q1");
    expect(canProgressFromStep(c1Index, {})).toBe(false);
    expect(canProgressFromStep(c1Index, { c1: "c1_allow" })).toBe(true);
    expect(canProgressFromStep(questionIndex, {})).toBe(false);
    expect(canProgressFromStep(questionIndex, { q1: SKIP_VALUE })).toBe(true);
  });

  it("keeps denied path to next screen in flow navigation", () => {
    expect(getNextStepIndex(1, { c1: "c1_deny" }, FLOW)).toBe(2);
    expect(getNextStepIndex(2, { c2: "c2_deny" }, FLOW)).toBe(3);
  });

  it("marks progress as 0 at intro/result and grows with interactive steps", () => {
    const introIndex = FLOW.findIndex((step) => step.type === "intro");
    const q1Index = FLOW.findIndex((step) => step.id === "q1");
    const resultIndex = FLOW.findIndex((step) => step.type === "result");
    expect(getProgressPercent(introIndex, FLOW)).toBe(0);
    expect(Math.round(getProgressPercent(q1Index, FLOW))).toBe(27);
    expect(getProgressPercent(resultIndex, FLOW)).toBe(0);
  });
});

describe("Sensitive input checks", () => {
  it("rejects sensitive copy patterns in flow text", () => {
    const sensitiveTokens = ["请输入", "请填写", "手机号", "邮箱", "身份证", "email", "居住地", "联系号码"];
    const allText = JSON.stringify(FLOW);
    const hasToken = sensitiveTokens.some((token) => allText.includes(token));
    expect(hasToken).toBe(false);
  });
});

describe("Persona snapshot contract", () => {
  it("freezes persona expected values with version lock", () => {
    expect(buildPersonaContract(PERSONAS)).toEqual(PERSONA_CONTRACTS[PERSONA_PRESET_VERSION]);
  });

  it("keeps 3 personas with stable IDs", () => {
    expect(Object.keys(PERSONAS)).toEqual(["personaA", "personaB", "personaC"]);
  });

  it("locks consent copy contract", () => {
    expect(buildConsentContract(FLOW)).toEqual(CONSENT_CONTRACTS[CONSENT_COPY_VERSION]);
  });
});
