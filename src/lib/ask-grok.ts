import { createServerFn } from "@tanstack/react-start";
import { PERSONA_INSTRUCTIONS_LIMIT } from "@/lib/persona-memory";
import { imageInput, type AskTurn } from "@/lib/ask-prompt";

import { buildGrokContext, type ContextMetrics } from "./grok-context";
import { voiceResponse } from "./voice-formatter";
export type AskResult =
  | { ok: true; text: string; voiceText?: string; metrics?: ContextMetrics }
  | { ok: false; error: string };

function answerText(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const data = body as { output?: unknown; output_text?: unknown };
  if (typeof data.output_text === "string") return data.output_text;
  if (typeof data.output === "string") return data.output;
  if (!Array.isArray(data.output)) return "";
  const parts: string[] = [];
  for (const item of data.output) {
    if (!item || typeof item !== "object") continue;
    const message = item as { type?: string; content?: unknown };
    if (message.type !== "message" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        parts.push((part as { text: string }).text);
      }
    }
  }
  return parts.join(" ");
}

export const askGrok = createServerFn({ method: "POST" })
  .validator(
    (input: {
      message: string;
      history: AskTurn[];
      persona?: string;
      memory?: string;
      summary?: string;
      recentBudget?: number;
      memoriesRetrieved?: number;
      ack?: boolean;
      image?: string;
      frames?: string[];
    }) => {
      const message = String(input?.message ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 6000);
      const history = Array.isArray(input?.history)
        ? input.history.map((item) => ({
            role: item?.role === "assistant" ? ("assistant" as const) : ("user" as const),
            content: String(item?.content ?? ""),
          }))
        : [];
      const persona = String(input?.persona ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, PERSONA_INSTRUCTIONS_LIMIT);
      const memory = String(input?.memory ?? "")
        .trim()
        .slice(0, 12000);
      return {
        message,
        image:
          typeof input.image === "string" && input.image.length <= 500000 ? input.image : undefined,
        frames: Array.isArray(input.frames)
          ? input.frames.filter((f) => typeof f === "string" && f.length <= 500000).slice(0, 3)
          : undefined,
        memory,
        summary: String(input.summary ?? "").slice(0, 16000),
        recentBudget: input.recentBudget,
        memoriesRetrieved:
          typeof input.memoriesRetrieved === "number" ? input.memoriesRetrieved : 0,
        history: history.filter((item) => item.content.trim()),
        persona,
        ack: input?.ack === true,
      };
    },
  )
  .handler(async ({ data }): Promise<AskResult> => {
    if (!data.message) return { ok: false, error: "물어볼 말이 없습니다." };
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "그록에게 물어볼 수 없습니다." };
    const context = buildGrokContext({ ...data, budgets: { recent: data.recentBudget ?? 6000 } });
    const facts = context.facts;

    try {
      const res = await fetch("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(35000),
        body: JSON.stringify({
          model: "grok-4.5",
          store: false,
          max_output_tokens: context.maxOutputTokens,
          ...(facts ? { max_tool_calls: 1, tools: [{ type: "web_search" }] } : {}),
          input: [
            ...context.input.slice(0, -1),
            {
              role: "user",
              content: imageInput(context.input.at(-1)!.content, data.image, data.frames),
            },
          ],
        }),
      });
      if (!res.ok) return { ok: false, error: "그록이 대답하지 못했습니다." };
      const body = await res.json();
      const text = answerText(body).trim();
      if (!text) return { ok: false, error: "그록이 빈 답을 보냈습니다." };
      return {
        ok: true,
        text,
        voiceText: voiceResponse(text),
        metrics: {
          ...context.metrics,
          responseTokens: body.usage?.output_tokens,
          fullLength: text.length,
          voiceLength: voiceResponse(text).length,
        },
      };
    } catch {
      return { ok: false, error: "그록에게 연결하지 못했습니다." };
    }
  });
