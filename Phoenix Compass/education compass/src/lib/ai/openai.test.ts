import { afterEach, describe, expect, it, vi } from "vitest";

import { generateWithOpenAI } from "@/lib/ai/openai";
import { createSafeFallback } from "@/lib/compass/result";
import { ASSESSMENT_VERSION, type AssessmentInput } from "@/lib/compass/types";

const input: AssessmentInput = {
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

describe("OpenAI Growth Snapshot request", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("disables Responses API storage for assessment answers", async () => {
    const snapshot = createSafeFallback(input);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: JSON.stringify(snapshot) }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubEnv("OPENAI_API_KEY", "test-api-key");
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateWithOpenAI(input)).resolves.toEqual(snapshot);

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const requestBody = JSON.parse(String(calls[0][1].body)) as Record<string, unknown>;
    expect(requestBody.store).toBe(false);
  });

  it("falls back without parsing an oversized provider response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ output: [], padding: "x".repeat(70_000) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubEnv("OPENAI_API_KEY", "test-api-key");
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateWithOpenAI(input)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    "http://api.openai.com/v1",
    "https://user:pass@example.com/v1",
    "https://example.com/v1?tenant=unsafe",
    "https://example.com/v1#unsafe",
  ])("does not send the API key to an unsafe base URL: %s", async (baseUrl) => {
    const fetchMock = vi.fn();
    vi.stubEnv("OPENAI_API_KEY", "test-api-key");
    vi.stubEnv("OPENAI_BASE_URL", baseUrl);
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateWithOpenAI(input)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
