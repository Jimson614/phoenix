import {
  AGE_BANDS,
  ASSESSMENT_VERSION,
  CURRICULA,
  FAMILY_GOALS,
  GRADE_BANDS,
  IDENTITY_STATUSES,
  INTERESTS,
  LOCATIONS,
  RESULT_VERSION,
  type AssessmentDraft,
  type AssessmentInput,
  type GrowthSnapshotResponse,
  type GrowthSnapshot,
} from "@/lib/compass/types";

type ValidationSuccess<T> = Readonly<{ success: true; data: T }>;
type ValidationFailure = Readonly<{ success: false; errors: readonly string[] }>;
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

const assessmentKeys = new Set([
  "assessment_version",
  "age_band",
  "grade_band",
  "location",
  "identity_status",
  "curriculum",
  "interests",
  "family_goal",
  "language",
]);

const growthSnapshotKeys = new Set([
  "result_version",
  "growth_type",
  "strength_signals",
  "possible_directions",
  "today_action",
  "disclaimer",
]);
const growthTypeKeys = new Set(["title", "summary"]);
const strengthSignalKeys = new Set(["title", "evidence"]);
const possibleDirectionKeys = new Set(["title", "reason", "micro_action"]);
const growthSnapshotResponseKeys = new Set(["result", "generation_status"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function validText(value: unknown, min: number, max: number): value is string {
  if (typeof value !== "string" || value.length > max) return false;
  const normalizedLength = value.trim().length;
  return normalizedLength >= min && normalizedLength <= max;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

export function normalizeAssessmentDraft(value: unknown): AssessmentDraft {
  if (!isRecord(value)) return {};

  const draft: { -readonly [Key in keyof AssessmentDraft]: AssessmentDraft[Key] } = {};
  if (includes(AGE_BANDS, value.age_band)) draft.age_band = value.age_band;
  if (includes(GRADE_BANDS, value.grade_band)) draft.grade_band = value.grade_band;
  if (includes(LOCATIONS, value.location)) draft.location = value.location;
  if (includes(IDENTITY_STATUSES, value.identity_status)) draft.identity_status = value.identity_status;
  if (includes(CURRICULA, value.curriculum)) draft.curriculum = value.curriculum;
  if (includes(FAMILY_GOALS, value.family_goal)) draft.family_goal = value.family_goal;

  if (Array.isArray(value.interests)) {
    const interests = value.interests.filter((item) => includes(INTERESTS, item));
    const uniqueInterests = [...new Set(interests)];
    if (
      uniqueInterests.length >= 1 &&
      uniqueInterests.length <= 2 &&
      !(uniqueInterests.includes("exploring") && uniqueInterests.length > 1)
    ) {
      draft.interests = uniqueInterests;
    }
  }

  return draft;
}

export function validateAssessmentInput(value: unknown): ValidationResult<AssessmentInput> {
  if (!isRecord(value)) {
    return { success: false, errors: ["请求必须是对象。"] };
  }

  const errors: string[] = [];
  const unexpectedKeys = Object.keys(value).filter((key) => !assessmentKeys.has(key));
  if (unexpectedKeys.length) errors.push("请求包含未允许的字段。请勿提交姓名、学校或联系方式。");
  if (value.assessment_version !== ASSESSMENT_VERSION) errors.push("assessment_version 无效。");
  if (!includes(AGE_BANDS, value.age_band)) errors.push("age_band 无效。");
  if (!includes(GRADE_BANDS, value.grade_band)) errors.push("grade_band 无效。");
  if (!includes(LOCATIONS, value.location)) errors.push("location 无效。");
  if (!includes(IDENTITY_STATUSES, value.identity_status)) errors.push("identity_status 无效。");
  if (!includes(CURRICULA, value.curriculum)) errors.push("curriculum 无效。");
  if (!includes(FAMILY_GOALS, value.family_goal)) errors.push("family_goal 无效。");
  if (value.language !== "zh-CN") errors.push("language 无效。");

  if (!Array.isArray(value.interests) || value.interests.length < 1 || value.interests.length > 2) {
    errors.push("interests 必须包含 1–2 项。");
  } else {
    const uniqueInterests = new Set(value.interests);
    if (uniqueInterests.size !== value.interests.length || !value.interests.every((item) => includes(INTERESTS, item))) {
      errors.push("interests 包含无效或重复选项。");
    }
    if (value.interests.includes("exploring") && value.interests.length > 1) {
      errors.push("尚在探索不能与其他兴趣同时选择。");
    }
  }

  if (errors.length) return { success: false, errors };
  return { success: true, data: value as AssessmentInput };
}

export function validateGrowthSnapshot(value: unknown): ValidationResult<GrowthSnapshot> {
  if (!isRecord(value)) return { success: false, errors: ["结果不是对象。"] };
  const errors: string[] = [];
  const growthType = value.growth_type;
  const signals = value.strength_signals;
  const directions = value.possible_directions;

  if (Object.keys(value).some((key) => !growthSnapshotKeys.has(key))) {
    errors.push("结果包含未允许的字段。");
  }

  if (value.result_version !== RESULT_VERSION) errors.push("result_version 无效。");
  if (
    !isRecord(growthType) ||
    !hasOnlyKeys(growthType, growthTypeKeys) ||
    !validText(growthType.title, 2, 30) ||
    !validText(growthType.summary, 10, 140)
  ) {
    errors.push("growth_type 无效。");
  }
  if (
    !Array.isArray(signals) ||
    signals.length !== 3 ||
    !signals.every(
      (item) =>
        isRecord(item) &&
        hasOnlyKeys(item, strengthSignalKeys) &&
        validText(item.title, 2, 30) &&
        validText(item.evidence, 8, 120),
    )
  ) {
    errors.push("strength_signals 必须包含 3 条完整信号。");
  }
  if (
    !Array.isArray(directions) ||
    directions.length < 2 ||
    directions.length > 3 ||
    !directions.every(
      (item) =>
        isRecord(item) &&
        hasOnlyKeys(item, possibleDirectionKeys) &&
        validText(item.title, 2, 40) &&
        validText(item.reason, 8, 140) &&
        validText(item.micro_action, 8, 140),
    )
  ) {
    errors.push("possible_directions 必须包含 2–3 个完整方向。");
  }
  if (!validText(value.today_action, 8, 160)) errors.push("today_action 无效。");
  if (!validText(value.disclaimer, 10, 120)) errors.push("disclaimer 无效。");

  if (errors.length) return { success: false, errors };
  return { success: true, data: value as unknown as GrowthSnapshot };
}

export function validateGrowthSnapshotResponse(value: unknown): ValidationResult<GrowthSnapshotResponse> {
  if (!isRecord(value)) return { success: false, errors: ["结果响应不是对象。"] };

  const errors: string[] = [];
  if (!hasOnlyKeys(value, growthSnapshotResponseKeys)) errors.push("结果响应包含未允许的字段。");

  const resultValidation = validateGrowthSnapshot(value.result);
  if (!resultValidation.success) errors.push(...resultValidation.errors);
  if (value.generation_status !== "ai" && value.generation_status !== "fallback") {
    errors.push("generation_status 无效。");
  }

  if (errors.length || !resultValidation.success) return { success: false, errors };
  return {
    success: true,
    data: {
      result: resultValidation.data,
      generation_status: value.generation_status as GrowthSnapshotResponse["generation_status"],
    },
  };
}
