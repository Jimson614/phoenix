import type { AssessmentInput } from "@/lib/compass/types";

export const GROWTH_SNAPSHOT_SYSTEM_PROMPT = `你是 Phoenix Compass™ Growth Snapshot Agent，为家长生成简短、温暖、可解释的孩子成长探索结果。

任务：
1. 用年龄、年级与课程描述教育情境，不评价优劣。
2. 只依据 interests 生成受控成长类型；两个兴趣可生成“方向A × 方向B探索型”。
3. 生成3条优势信号，每条说明输入依据，使用“可能、值得观察、当前更愿意”等探索性语言。
4. 生成2-3个可以探索的方向；每个方向包含一个7天内可执行、低成本的小行动。
5. 根据 family_goal 生成一个今天就能开始、低压力且不超过80字的行动建议。

边界：
- 不得编造成绩、奖项、行为、性格、智力、家庭条件或学校信息。
- 不得把地区、身份或课程体系解释为能力、潜力或价值高低。
- 不得给出录取概率、学校排名、专业确定结论、医疗建议、心理诊断或职业适配诊断。
- 不得把兴趣直接写成天赋，不得保证结果或制造焦虑。
- 不得推荐、销售或引导购买任何产品或服务，不得输出价格、支付或购买链接。
- 语言温暖、专业、克制，所有判断必须可追溯到输入。
- 只返回符合 JSON Schema 的对象。`;

export const growthSnapshotJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    result_version: { type: "string", enum: ["growth-snapshot-v1.0"] },
    growth_type: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 2, maxLength: 30 },
        summary: { type: "string", minLength: 10, maxLength: 140 },
      },
      required: ["title", "summary"],
    },
    strength_signals: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 2, maxLength: 30 },
          evidence: { type: "string", minLength: 8, maxLength: 120 },
        },
        required: ["title", "evidence"],
      },
    },
    possible_directions: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 2, maxLength: 40 },
          reason: { type: "string", minLength: 8, maxLength: 140 },
          micro_action: { type: "string", minLength: 8, maxLength: 140 },
        },
        required: ["title", "reason", "micro_action"],
      },
    },
    today_action: { type: "string", minLength: 8, maxLength: 160 },
    disclaimer: { type: "string", minLength: 10, maxLength: 120 },
  },
  required: [
    "result_version",
    "growth_type",
    "strength_signals",
    "possible_directions",
    "today_action",
    "disclaimer",
  ],
} as const;

export function buildGrowthSnapshotInput(input: AssessmentInput): string {
  return `请根据以下结构化回答生成 Growth Snapshot。不要补充输入之外的事实：\n${JSON.stringify(input)}`;
}
