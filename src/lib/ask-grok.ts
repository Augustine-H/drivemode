import { createServerFn } from "@tanstack/react-start";
import { PERSONA_INSTRUCTIONS_LIMIT } from "@/lib/persona-memory";
import { imageInput, askInstructions, askTurns, needsFacts, type AskTurn } from "@/lib/ask-prompt";

export type AskResult = { ok: true; text: string } | { ok: false; error: string };

function spoken(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/[#>*_`[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

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
      ack?: boolean;
      image?: string;
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
        image: typeof input.image === "string" ? input.image.slice(0, 4000) : undefined,
        memory,
        history: askTurns(history.filter((item) => item.content.trim())),
        persona,
        ack: input?.ack === true,
      };
    },
  )
  .handler(async ({ data }): Promise<AskResult> => {
    if (!data.message) return { ok: false, error: "물어볼 말이 없습니다." };
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "그록에게 물어볼 수 없습니다." };
    const facts = !data.ack && needsFacts(data.message);

    try {
      const res = await fetch("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          model: "grok-4.5",
          store: false,
          max_output_tokens: data.ack ? 40 : facts ? 140 : 90,
          ...(facts ? { max_tool_calls: 1, tools: [{ type: "web_search" }] } : {}),
          input: [
            {
              role: "system",
              content: askInstructions(data.persona, data.ack, facts, data.memory),
            },
            ...(data.ack
              ? []
              : data.history.map((item) => ({ role: item.role, content: item.content }))),
            { role: "user", content: imageInput(data.message, data.image) },
          ],
        }),
      });
      if (!res.ok) return { ok: false, error: "그록이 대답하지 못했습니다." };
      const text = spoken(answerText(await res.json()));
      if (!text) return { ok: false, error: "그록이 빈 답을 보냈습니다." };
      return { ok: true, text };
    } catch {
      return { ok: false, error: "그록에게 연결하지 못했습니다." };
    }
  });
