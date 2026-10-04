import test from "node:test";
import assert from "node:assert/strict";
import { streamAsk } from "../src/lib/ask-stream.ts";
test("SSE preserves the full Unicode answer, independent voice text and final usage", async () => {
  const original = globalThis.fetch;
  const full = "첫 문장입니다. " + "상세 기록을 남깁니다. ".repeat(80) + "주의하세요.";
  const voice = "첫 문장입니다. 핵심을 읽습니다. 주의하세요.";
  const events = [
    { text: "첫 문장입니다.", voiceText: "첫 문장입니다." },
    {
      text: full,
      voiceText: voice,
      done: true,
      metrics: {
        recentTokens: 5000,
        summaryTokens: 300,
        memoryTokens: 400,
        personaTokens: 80,
        totalTokens: 6000,
        responseTokens: 500,
        fullLength: full.length,
        voiceLength: voice.length,
      },
    },
  ];
  const encoded = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
  );
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < encoded.length; i += 17) controller.enqueue(encoded.slice(i, i + 17));
          controller.close();
        },
      }),
    );
  };
  try {
    const updates = [];
    const result = await streamAsk(
      { message: "설명해줘", history: [], summary: "프로젝트 결정", recentBudget: 6000 },
      (text, voiceText) => updates.push({ text, voiceText }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.text, full);
    assert.ok(result.text.length > 700);
    assert.equal(result.voiceText, voice);
    assert.equal(result.metrics.responseTokens, 500);
    assert.equal(request.summary, "프로젝트 결정");
    assert.equal(updates[0].voiceText, "첫 문장입니다.");
    assert.equal(updates.at(-1).text, full);
  } finally {
    globalThis.fetch = original;
  }
});
test("an SSE error still takes the existing connection failure path", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('data: {"error":"연결 실패"}\n\n');
  try {
    assert.deepEqual(await streamAsk({ message: "안녕", history: [] }, () => {}), {
      ok: false,
      error: "연결 실패",
    });
  } finally {
    globalThis.fetch = original;
  }
});
