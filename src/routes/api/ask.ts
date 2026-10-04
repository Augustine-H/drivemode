import { createFileRoute } from "@tanstack/react-router";
import { PERSONA_INSTRUCTIONS_LIMIT } from "@/lib/persona-memory";
import { imageInput } from "@/lib/ask-prompt";

import { buildGrokContext } from "@/lib/grok-context";
import { voiceResponse } from "@/lib/voice-formatter";

function deltaOf(event: unknown) {
  if (!event || typeof event !== "object") return "";
  const row = event as {
    type?: string;
    delta?: unknown;
    choices?: { delta?: { content?: unknown } }[];
  };
  if (row.type === "response.output_text.delta" && typeof row.delta === "string") return row.delta;
  const content = row.choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : "";
}

async function streamAnswer(
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
  persona: string,
  memory: string,
  image?: string,
  signal?: AbortSignal,
  frames?: string[],
  summary = "",
  recentBudget = 6000,
  memoriesRetrieved = 0,
) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return Response.json({ error: "그록에게 물어볼 수 없습니다." }, { status: 503 });
  const context = buildGrokContext({
    message,
    history,
    persona,
    memory,
    summary,
    memoriesRetrieved,
    budgets: { recent: recentBudget },
  });
  const facts = context.facts;
  const upstream = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(35000)])
      : AbortSignal.timeout(35000),
    body: JSON.stringify({
      model: "grok-4.5",
      store: false,
      stream: true,
      max_output_tokens: context.maxOutputTokens,
      ...(facts ? { max_tool_calls: 1, tools: [{ type: "web_search" }] } : {}),
      input: [
        ...context.input.slice(0, -1),
        { role: "user", content: imageInput(context.input.at(-1)!.content, image, frames) },
      ],
    }),
  });
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: "그록이 대답하지 못했습니다." }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let raw = "";
      let sent = "";
      let responseTokens: number | undefined;
      try {
        while (true) {
          const step = await reader.read();
          if (step.done) break;
          buf += decoder.decode(step.value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const event = JSON.parse(payload);
              raw += deltaOf(event);
              if (typeof event.response?.usage?.output_tokens === "number")
                responseTokens = event.response.usage.output_tokens;
            } catch {
              continue;
            }
            const text = raw.trim();
            if (text && text !== sent) {
              sent = text;
              send({ text, voiceText: voiceResponse(text, false) });
            }
          }
        }
        const text = raw.trim();
        send({
          text,
          voiceText: voiceResponse(text, true),
          done: true,
          metrics: {
            ...context.metrics,
            responseTokens,
            fullLength: text.length,
            voiceLength: voiceResponse(text, true).length,
          },
        });
      } catch {
        send({ error: "그록에게 연결하지 못했습니다." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}

export const Route = createFileRoute("/api/ask")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: {
          message?: unknown;
          history?: unknown;
          persona?: unknown;
          memory?: unknown;
          summary?: unknown;
          recentBudget?: unknown;
          memoriesRetrieved?: unknown;
          image?: unknown;
          frames?: unknown;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "물어볼 말이 없습니다." }, { status: 400 });
        }
        const message = String(body.message ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 6000);
        if (!message) return Response.json({ error: "물어볼 말이 없습니다." }, { status: 400 });
        const history = (Array.isArray(body.history) ? body.history : [])
          .map((item) => {
            const row = item as { role?: unknown; content?: unknown };
            return {
              role: row?.role === "assistant" ? ("assistant" as const) : ("user" as const),
              content: String(row?.content ?? ""),
            };
          })
          .filter((item) => item.content);
        const persona = String(body.persona ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, PERSONA_INSTRUCTIONS_LIMIT);
        try {
          return await streamAnswer(
            message,
            history,
            persona,
            String(body.memory ?? "")
              .trim()
              .slice(0, 12000),
            typeof body.image === "string" ? body.image.slice(0, 4000) : undefined,
            request.signal,
            Array.isArray(body.frames)
              ? body.frames
                  .filter((f): f is string => typeof f === "string" && f.length <= 500000)
                  .slice(0, 3)
              : undefined,
            String(body.summary ?? "").slice(0, 16000),
            typeof body.recentBudget === "number" ? body.recentBudget : 6000,
            typeof body.memoriesRetrieved === "number" ? body.memoriesRetrieved : 0,
          );
        } catch {
          return Response.json({ error: "그록에게 연결하지 못했습니다." }, { status: 502 });
        }
      },
    },
  },
});
