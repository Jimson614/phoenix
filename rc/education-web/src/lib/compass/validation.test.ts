import { describe, expect, it } from "vitest";

import { createSafeFallback } from "@/lib/compass/result";
import { ASSESSMENT_VERSION, type AssessmentInput } from "@/lib/compass/types";
import {
  normalizeAssessmentDraft,
  validateAssessmentInput,
  validateGrowthSnapshot,
  validateGrowthSnapshotResponse,
} from "@/lib/compass/validation";

const validInput: AssessmentInput = {
  assessment_version: ASSESSMENT_VERSION,
  age_band: "15_18",
  grade_band: "senior_secondary",
  location: "hong_kong",
  identity_status: "prefer_not_to_say",
  curriculum: "dse",
  interests: ["technology", "business"],
  family_goal: "education_direction",
  language: "zh-CN",
};

describe("validateAssessmentInput", () => {
  it("accepts the stable v1 assessment contract", () => {
    expect(validateAssessmentInput(validInput)).toEqual({ success: true, data: validInput });
  });

  it("rejects extra fields that could carry PII", () => {
    const result = validateAssessmentInput({ ...validInput, child_name: "不应提交" });
    expect(result.success).toBe(false);
  });

  it("rejects more than two interests", () => {
    const result = validateAssessmentInput({
      ...validInput,
      interests: ["technology", "business", "art"],
    });
    expect(result.success).toBe(false);
  });

  it("keeps 'exploring' mutually exclusive", () => {
    const result = validateAssessmentInput({
      ...validInput,
      interests: ["exploring", "technology"],
    });
    expect(result.success).toBe(false);
  });

  it("sanitizes restored drafts before they reach the assessment UI", () => {
    expect(
      normalizeAssessmentDraft({
        age_band: "15_18",
        curriculum: "not-a-curriculum",
        interests: ["technology", "technology"],
        child_name: "不应恢复",
      }),
    ).toEqual({ age_band: "15_18", interests: ["technology"] });
  });
});

describe("validateGrowthSnapshot", () => {
  it("rejects fields outside the free result contract", () => {
    const result = validateGrowthSnapshot({
      ...createSafeFallback(validInput),
      purchase_url: "https://example.com/checkout",
    });

    expect(result.success).toBe(false);
  });

  it("rejects nested fields outside the free result contract", () => {
    const fallback = createSafeFallback(validInput);
    const result = validateGrowthSnapshot({
      ...fallback,
      growth_type: { ...fallback.growth_type, diagnosis: "not allowed" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects oversized raw text even when trimming would make it short", () => {
    const fallback = createSafeFallback(validInput);
    const result = validateGrowthSnapshot({
      ...fallback,
      growth_type: { ...fallback.growth_type, title: `${" ".repeat(10_000)}成长型` },
    });

    expect(result.success).toBe(false);
  });

  it("enforces the same minimum text lengths as the structured-output schema", () => {
    const fallback = createSafeFallback(validInput);
    const result = validateGrowthSnapshot({
      ...fallback,
      growth_type: { ...fallback.growth_type, summary: "太短" },
    });

    expect(result.success).toBe(false);
  });

  it("validates the complete result envelope", () => {
    const fallback = createSafeFallback(validInput);
    expect(validateGrowthSnapshotResponse({ result: fallback, generation_status: "ai" }).success).toBe(true);
    expect(validateGrowthSnapshotResponse({ result: fallback, generation_status: "unknown" }).success).toBe(false);
  });
});
