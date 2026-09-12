import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { ASSESSMENT_VERSION, type AssessmentInput } from "@/lib/compass/types";

const validInput: AssessmentInput = {
  assessment_version: ASSESSMENT_VERSION,
  age_band: "12_14",
  grade_band: "junior_secondary",
  location: "mainland_china",
  identity_status: "prefer_not_to_say",
  curriculum: "mainland",
  interests: ["technology"],
  family_goal: "discover_strengths",
  language: "zh-CN",
};

function jsonRequest(body: string, headers: HeadersInit = {}): Request {
  return new Request("https://example.test/api/growth-snapshot", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("growth snapshot route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a validated fallback envelope when AI is disabled", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    const response = await POST(jsonRequest(JSON.stringify(validInput)));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      generation_status: "fallback",
      result: { result_version: "growth-snapshot-v1.0" },
    });
  });

  it("rejects unsupported media types before parsing", async () => {
    const request = new Request("https://example.test/api/growth-snapshot", {
      method: "POST",
      body: JSON.stringify(validInput),
      headers: { "Content-Type": "text/plain" },
    });

    const response = await POST(request);

    expect(response.status).toBe(415);
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(jsonRequest("{"));

    expect(response.status).toBe(400);
  });

  it("rejects oversized bodies even when Content-Length is absent", async () => {
    const response = await POST(jsonRequest(JSON.stringify({ payload: "x".repeat(20_000) })));

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a declared oversized body without reading it", async () => {
    const response = await POST(jsonRequest("{}", { "Content-Length": "20000" }));

    expect(response.status).toBe(413);
  });
});
