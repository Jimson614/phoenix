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

const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;

function extractOutputText(payload: ResponsesApiPayload): string | null {
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
      if (content.type === "refusal") return null;
    }
  }
  return null;
}

function parseOpenAIBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.hostname
    ) {
      return null;
    }

    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function readResponsesPayload(response: Response): Promise<ResponsesApiPayload | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_PROVIDER_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const payload = JSON.parse(text) as unknown;
    return typeof payload === "object" && payload !== null ? (payload as ResponsesApiPayload) : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function requestSnapshot(input: AssessmentInput, attempt: number): Promise<GrowthSnapshot | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = parseOpenAIBaseUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1");
  if (!baseUrl) return null;
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
        store: false,
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
    const payload = await readResponsesPayload(response);
    if (!payload) return null;
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
