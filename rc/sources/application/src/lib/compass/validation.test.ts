import { describe, expect, it } from "vitest";

import { createSafeFallback } from "@/lib/compass/result";
import { ASSESSMENT_VERSION, type AssessmentInput } from "@/lib/compass/types";
import { validateAssessmentInput, validateGrowthSnapshot } from "@/lib/compass/validation";

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
});

describe("validateGrowthSnapshot", () => {
  it("rejects fields outside the free result contract", () => {
    const result = validateGrowthSnapshot({
      ...createSafeFallback(validInput),
      purchase_url: "https://example.com/checkout",
    });

    expect(result.success).toBe(false);
  });
});
