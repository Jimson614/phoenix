import { generateWithOpenAI } from "@/lib/ai/openai";
import { createSafeFallback } from "@/lib/compass/result";
import { validateAssessmentInput } from "@/lib/compass/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求格式无效。" }, { status: 400 });
  }

  const validation = validateAssessmentInput(body);
  if (!validation.success) {
    return Response.json({ error: "回答不完整或包含未允许字段。", details: validation.errors }, { status: 400 });
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
