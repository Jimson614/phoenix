import {
  GROWTH_SNAPSHOT_SYSTEM_PROMPT,
  buildGrowthSnapshotInput,
  growthSnapshotJsonSchema,
} from "@/lib/ai/prompt";
import { normalizeGrowthSnapshot } from "@/lib/compass/result";
import type { AssessmentInput, GrowthSnapshot } from "@/lib/compass/types";
import { validateGrowthSnapshot } from "@/lib/compass/validation";

type ResponsesApiPayload = Readonly<{
  output?: readonly Readonly<{
    type?: string;
    content?: readonly Readonly<{
      type?: string;
      text?: string;
      refusal?: string;
    }>[];
  }>[];
}>;

function extractOutputText(payload: ResponsesApiPayload): string | null {
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
      if (content.type === "refusal") return null;
    }
  }
  return null;
}
async function requestSnapshot(input: AssessmentInput, attempt: number): Promise<GrowthSnapshot | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_200);

  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions:
          attempt === 0
            ? GROWTH_SNAPSHOT_SYSTEM_PROMPT
            : `${GROWTH_SNAPSHOT_SYSTEM_PROMPT}\n再次确认：只返回合法 JSON，不添加任何额外文字。`,
        input: buildGrowthSnapshotInput(input),
        text: {
          format: {
            type: "json_schema",
            name: "phoenix_compass_growth_snapshot",
            strict: true,
            schema: growthSnapshotJsonSchema,
          },
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as ResponsesApiPayload;
    const outputText = extractOutputText(payload);
    if (!outputText) return null;
    const validation = validateGrowthSnapshot(JSON.parse(outputText));
    return validation.success ? normalizeGrowthSnapshot(validation.data) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateWithOpenAI(input: AssessmentInput): Promise<GrowthSnapshot | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await requestSnapshot(input, attempt);
    if (result) return result;
  }
  return null;
}
