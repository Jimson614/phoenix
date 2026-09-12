import { beforeEach, describe, expect, it, vi } from "vitest";

import { durationBucket, trackCompassEvent } from "@/lib/analytics";

describe("Compass analytics adapter", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.dataLayer = [];
  });

  it("emits a typed event once per flow key", () => {
    trackCompassEvent("free_compass_started", { device: "mobile" }, "started");
    trackCompassEvent("free_compass_started", { device: "mobile" }, "started");

    expect(window.dataLayer).toHaveLength(1);
    expect(window.dataLayer?.[0]).toMatchObject({
      event: "free_compass_started",
      assessment_version: "free-mvp-v1.0",
      device: "mobile",
    });
  });

  it("uses privacy-safe duration buckets", () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    expect(durationBucket(80_000)).toBe("0-30s");
    expect(durationBucket(50_000)).toBe("31-60s");
    expect(durationBucket(1_000)).toBe("61s+");
  });

  it("collects a feedback rating without assessment answers", () => {
    trackCompassEvent(
      "result_helpfulness_submitted",
      { rating: 5, result_version: "growth-snapshot-v1.0" },
      "feedback-submitted",
    );

    expect(window.dataLayer?.[0]).toEqual({
      event: "result_helpfulness_submitted",
      assessment_version: "free-mvp-v1.0",
      rating: 5,
      result_version: "growth-snapshot-v1.0",
    });
  });
});
