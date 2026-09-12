import { describe, expect, it } from "vitest";

import { GROWTH_SNAPSHOT_SYSTEM_PROMPT, growthSnapshotJsonSchema } from "@/lib/ai/prompt";

describe("Growth Snapshot prompt", () => {
  it("contains grounding, free-scope, and safety boundaries", () => {
    expect(GROWTH_SNAPSHOT_SYSTEM_PROMPT).toContain("不得编造");
    expect(GROWTH_SNAPSHOT_SYSTEM_PROMPT).toContain("不得把地区、身份或课程体系解释为能力");
    expect(GROWTH_SNAPSHOT_SYSTEM_PROMPT).toContain("不得推荐、销售或引导购买");
  });

  it("uses a strict object schema with no additional properties", () => {
    expect(growthSnapshotJsonSchema.type).toBe("object");
    expect(growthSnapshotJsonSchema.additionalProperties).toBe(false);
    expect(growthSnapshotJsonSchema.required).toContain("possible_directions");
    expect(growthSnapshotJsonSchema.properties).not.toHaveProperty("next_step");
  });
});
