import { createServerFn } from "@tanstack/react-start";

export type SttResult = { ok: true; text: string } | { ok: false; error: string };

const MAX_AUDIO = 1_500_000;

function extFor(mime: string) {
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "mp4";
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "webm";
}

export const transcribeSpeech = createServerFn({ method: "POST" })
  .validator((input: { audio: string; mime: string }) => {
    const audio = String(input?.audio ?? "").replace(/^data:[^,]+,/, "");
    const mime = String(input?.mime ?? "audio/wav")
      .split(";")[0]
      .trim()
      .slice(0, 40);
    return { audio, mime: mime || "audio/wav" };
  })
  .handler(async ({ data }): Promise<SttResult> => {
    if (!data.audio) return { ok: false, error: "녹음이 비어 있습니다." };
    if (data.audio.length > MAX_AUDIO) return { ok: false, error: "녹음이 너무 깁니다. 짧게 말해 주세요." };
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "받아쓰기를 쓸 수 없습니다." };

    try {
      const bytes = Buffer.from(data.audio, "base64");
      if (bytes.length < 800) return { ok: false, error: "녹음이 너무 짧습니다." };
      const form = new FormData();
      form.append("model", "grok-voice-transcribe-2.0");
      form.append("language", "ko");
      form.append("format", "true");
      form.append("file", new Blob([bytes], { type: data.mime }), `speech.${extFor(data.mime)}`);
      const res = await fetch("https://api.x.ai/v1/stt", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!res.ok) return { ok: false, error: "받아쓰기에 실패했습니다." };
      const body = (await res.json()) as { text?: string };
      const text = String(body.text ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) return { ok: false, error: "말을 알아듣지 못했습니다." };
      return { ok: true, text };
    } catch {
      return { ok: false, error: "받아쓰기에 연결하지 못했습니다." };
    }
  });
