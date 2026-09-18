import { generateWithOpenAI } from "@/lib/ai/openai";
import { createSafeFallback } from "@/lib/compass/result";
import { validateAssessmentInput } from "@/lib/compass/validation";

export const runtime = "nodejs";

const MAX_REQUEST_BODY_BYTES = 16 * 1024;

type JsonBodyResult =
  | Readonly<{ success: true; value: unknown }>
  | Readonly<{ success: false; status: 400 | 413 | 415; message: string }>;

async function readJsonBody(request: Request): Promise<JsonBodyResult> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return { success: false, status: 415, message: "请求必须使用 application/json。" };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    if (!/^\d+$/.test(contentLength)) {
      return { success: false, status: 400, message: "Content-Length 无效。" };
    }
    if (Number(contentLength) > MAX_REQUEST_BODY_BYTES) {
      return { success: false, status: 413, message: "请求内容过大。" };
    }
  }

  if (!request.body) return { success: false, status: 400, message: "请求格式无效。" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { success: false, status: 413, message: "请求内容过大。" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { success: true, value: JSON.parse(text) as unknown };
  } catch {
    return { success: false, status: 400, message: "请求格式无效。" };
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.success) {
    return Response.json(
      { error: bodyResult.message },
      { status: bodyResult.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const validation = validateAssessmentInput(bodyResult.value);
  if (!validation.success) {
    return Response.json(
      { error: "回答不完整或包含未允许字段。", details: validation.errors },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const generated = await generateWithOpenAI(validation.data);
  const result = generated ?? createSafeFallback(validation.data);

  return Response.json(
    {
      result,
      generation_status: generated ? "ai" : "fallback",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
