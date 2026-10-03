import { createServerFn } from "@tanstack/react-start";
import { API_VOICES } from "@/lib/voices";

export type SpeakResult =
  | { ok: true; audio: string }
  | { ok: false; error: string };

function clampSpeed(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.5, Math.max(0.7, Math.round(n * 100) / 100));
}

export const speakLine = createServerFn({ method: "POST" })
  .validator((input: { text: string; voiceId: string; speed: number }) => {
    const text = String(input?.text ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    const voiceId = API_VOICES.has(String(input?.voiceId)) ? String(input.voiceId) : "ara";
    return { text, voiceId, speed: clampSpeed(input?.speed) };
  })
  .handler(async ({ data }): Promise<SpeakResult> => {
    if (!data.text) return { ok: false, error: "읽을 문장이 없습니다." };
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "음성 기능을 쓸 수 없습니다." };

    try {
      const res = await fetch("https://api.x.ai/v1/tts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: data.text,
          voice_id: data.voiceId,
          language: "ko",
          speed: data.speed,
        }),
      });
      if (!res.ok) return { ok: false, error: "음성을 만들지 못했습니다." };
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength < 64 || bytes.byteLength > 1_500_000) {
        return { ok: false, error: "음성이 비어 있거나 너무 깁니다." };
      }
      let binary = "";
      const step = 0x2000;
      for (let i = 0; i < bytes.length; i += step) {
        binary += String.fromCharCode(...bytes.subarray(i, i + step));
      }
      return { ok: true, audio: btoa(binary) };
    } catch {
      return { ok: false, error: "음성 서버에 연결하지 못했습니다." };
    }
  });
