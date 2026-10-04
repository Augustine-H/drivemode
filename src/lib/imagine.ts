import { createServerFn } from "@tanstack/react-start";

export type ImageResult = { ok: true; url: string } | { ok: false; error: string };

const MODELS = ["grok-imagine-image", "grok-imagine-image-2.0"];

function imageUrl(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const data = (body as { data?: unknown }).data;
  const first = Array.isArray(data) ? data[0] : null;
  if (!first || typeof first !== "object") return "";
  const row = first as { url?: unknown; file_output?: { public_url?: unknown } };
  const url = row.file_output?.public_url ?? row.url;
  return typeof url === "string" && url.startsWith("https://") ? url : "";
}

async function requestImage(apiKey: string, model: string, prompt: string) {
  const res = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      response_format: "url",
    }),
  });
  if (res.ok) return { url: imageUrl(await res.json()), retry: false };
  return { url: "", retry: res.status === 400 || res.status === 404 };
}

export const imagineImage = createServerFn({ method: "POST" })
  .validator((input: { prompt: string }) => {
    const prompt = String(input?.prompt ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);
    return { prompt };
  })
  .handler(async ({ data }): Promise<ImageResult> => {
    if (!data.prompt) return { ok: false, error: "그릴 내용을 말해 주세요." };
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "그림을 만들 수 없습니다." };
    try {
      for (const model of MODELS) {
        const result = await requestImage(apiKey, model, data.prompt);
        if (result.url) return { ok: true, url: result.url };
        if (!result.retry) break;
      }
      return { ok: false, error: "그림을 만들지 못했습니다." };
    } catch {
      return { ok: false, error: "그림 서버에 연결하지 못했습니다." };
    }
  });

export type VideoResult =
  | { ok: true; pending: true }
  | { ok: true; pending: false; url: string }
  | { ok: false; error: string };

const VIDEO_MODELS = ["grok-imagine-video-1.5", "grok-imagine-video"];

function videoUrl(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const data = body as { video?: { url?: unknown }; url?: unknown };
  const url = data.video?.url ?? data.url;
  return typeof url === "string" && url.startsWith("https://") ? url : "";
}

export const startVideo = createServerFn({ method: "POST" })
  .validator((input: { prompt: string; seconds?: number; image?: string }) => {
    const prompt = String(input?.prompt ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);
    const seconds = Math.min(8, Math.max(2, Math.round(Number(input?.seconds) || 5)));
    const image =
      typeof input?.image === "string" &&
      (input.image.startsWith("https://") ||
        (input.image.length <= 500000 &&
          /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(input.image)))
        ? input.image
        : "";
    return { prompt, seconds, image };
  })
  .handler(async ({ data }): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
    if (!data.prompt) return { ok: false, error: "어떤 영상인지 말해 주세요." };
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "영상을 만들 수 없습니다." };
    try {
      for (const model of VIDEO_MODELS) {
        const body: Record<string, unknown> = {
          model,
          prompt: data.prompt,
          duration: data.seconds,
        };
        if (data.image) body.image = { url: data.image };
        const res = await fetch("https://api.x.ai/v1/videos/generations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          if (res.status === 400 || res.status === 404) continue;
          return { ok: false, error: "영상을 시작하지 못했습니다." };
        }
        const payload = (await res.json()) as { request_id?: unknown };
        if (typeof payload.request_id === "string" && payload.request_id) {
          return { ok: true, id: payload.request_id };
        }
      }
      return { ok: false, error: "영상을 시작하지 못했습니다." };
    } catch {
      return { ok: false, error: "영상 서버에 연결하지 못했습니다." };
    }
  });

export const videoStatus = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => {
    const id = String(input?.id ?? "")
      .trim()
      .slice(0, 80);
    return { id };
  })
  .handler(async ({ data }): Promise<VideoResult> => {
    if (!/^[A-Za-z0-9_-]+$/.test(data.id))
      return { ok: false, error: "영상 요청을 찾지 못했습니다." };
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "영상을 만들 수 없습니다." };
    try {
      const res = await fetch(`https://api.x.ai/v1/videos/${data.id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 202) return { ok: true, pending: true };
      if (!res.ok) return { ok: false, error: "영상을 확인하지 못했습니다." };
      const body = (await res.json()) as { status?: string };
      if (body.status === "pending") return { ok: true, pending: true };
      if (body.status === "failed" || body.status === "expired") {
        return { ok: false, error: "영상을 만들지 못했습니다." };
      }
      const url = videoUrl(body);
      if (body.status === "done" && url) return { ok: true, pending: false, url };
      if (body.status === "done") return { ok: false, error: "영상 주소를 받지 못했습니다." };
      return { ok: true, pending: true };
    } catch {
      return { ok: false, error: "영상 서버에 연결하지 못했습니다." };
    }
  });
