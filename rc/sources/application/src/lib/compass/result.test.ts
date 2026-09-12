import { describe, expect, it } from "vitest";

import { createSafeFallback, normalizeGrowthSnapshot, RESULT_DISCLAIMER } from "@/lib/compass/result";
import { ASSESSMENT_VERSION, type AssessmentInput } from "@/lib/compass/types";

const input: AssessmentInput = {
  assessment_version: ASSESSMENT_VERSION,
  age_band: "12_14",
  grade_band: "junior_secondary",
  location: "mainland_china",
  identity_status: "mainland_resident",
  curriculum: "mainland",
  interests: ["art"],
  family_goal: "discover_strengths",
  language: "zh-CN",
};

describe("safe Growth Snapshot", () => {
  it("returns the complete MVP result shape", () => {
    const result = createSafeFallback(input);
    expect(result.growth_type.title).toBe("创意表达型");
    expect(result.strength_signals).toHaveLength(3);
    expect(result.possible_directions).toHaveLength(2);
    expect(result.today_action.length).toBeGreaterThan(10);
    expect(result.disclaimer).toBe(RESULT_DISCLAIMER);
  });

  it("strips fields outside the free Growth Snapshot contract", () => {
    const resultWithExtraField = {
      ...createSafeFallback(input),
      commerce: { offer: "not allowed" },
    } as unknown as ReturnType<typeof createSafeFallback>;
    const result = normalizeGrowthSnapshot(resultWithExtraField);
    expect(result).not.toHaveProperty("commerce");
    expect(Object.keys(result)).toEqual([
      "result_version",
      "growth_type",
      "strength_signals",
      "possible_directions",
      "today_action",
      "disclaimer",
    ]);
  });
});
