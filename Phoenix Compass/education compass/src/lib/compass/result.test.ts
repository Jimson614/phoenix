import { describe, expect, it } from "vitest";

import { createSafeFallback, normalizeGrowthSnapshot, RESULT_DISCLAIMER } from "@/lib/compass/result";
import {
  AGE_BANDS,
  ASSESSMENT_VERSION,
  CURRICULA,
  FAMILY_GOALS,
  INTERESTS,
  type AssessmentInput,
  type Interest,
} from "@/lib/compass/types";
import { validateGrowthSnapshot } from "@/lib/compass/validation";

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
    const fallback = createSafeFallback(input);
    const resultWithExtraField = {
      ...fallback,
      growth_type: { ...fallback.growth_type, diagnosis: "not allowed" },
      strength_signals: fallback.strength_signals.map((signal) => ({ ...signal, confidence: 1 })),
      possible_directions: fallback.possible_directions.map((direction) => ({ ...direction, purchase_url: "/pay" })),
      commerce: { offer: "not allowed" },
    } as unknown as ReturnType<typeof createSafeFallback>;
    const result = normalizeGrowthSnapshot(resultWithExtraField);
    expect(result).not.toHaveProperty("commerce");
    expect(result.growth_type).not.toHaveProperty("diagnosis");
    expect(result.strength_signals[0]).not.toHaveProperty("confidence");
    expect(result.possible_directions[0]).not.toHaveProperty("purchase_url");
    expect(Object.keys(result)).toEqual([
      "result_version",
      "growth_type",
      "strength_signals",
      "possible_directions",
      "today_action",
      "disclaimer",
    ]);
  });

  it("keeps every supported fallback combination inside the response contract", () => {
    const interestSets: readonly (readonly Interest[])[] = [
      ...INTERESTS.map((interest) => [interest] as const),
      ...INTERESTS.filter((interest) => interest !== "exploring").flatMap((interest, index, values) =>
        values.slice(index + 1).map((second) => [interest, second] as const),
      ),
    ];

    for (const ageBand of AGE_BANDS) {
      for (const curriculum of CURRICULA) {
        for (const familyGoal of FAMILY_GOALS) {
          for (const interests of interestSets) {
            const result = createSafeFallback({
              ...input,
              age_band: ageBand,
              curriculum,
              family_goal: familyGoal,
              interests,
            });
            expect(validateGrowthSnapshot(result).success).toBe(true);
          }
        }
      }
    }
  });
});
