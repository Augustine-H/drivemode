import { createFileRoute } from "@tanstack/react-router";
import { allowedMediaSource } from "@/lib/media-source";
export const Route = createFileRoute("/api/media-source")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url).searchParams.get("url") ?? "";
        if (!allowedMediaSource(url))
          return new Response("허용되지 않은 원본 주소", { status: 400 });
        try {
          const upstream = await fetch(url, {
            headers: request.headers.has('range') ? { Range: request.headers.get('range')!, ...(request.headers.get('if-range') ? { 'If-Range': request.headers.get('if-range')! } : {}) } : undefined,
            redirect: "manual",
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
          });
          const type = upstream.headers.get("content-type")?.split(";")[0] ?? "";
          if (upstream.status === 416) { await upstream.body?.cancel(); return new Response(null, { status: 416, headers: { 'content-range': upstream.headers.get('content-range') || 'bytes */*', 'cache-control': 'no-store' } }); }
          const limit = 200 * 1024 * 1024;
          if (
            !upstream.ok ||
            !upstream.body ||
            !/^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm)|audio\/(mpeg|mp4|webm|wav|ogg))$/.test(
              type,
            ) ||
            Number(upstream.headers.get("content-length")) > limit
          )
            return new Response("미디어 원본을 읽을 수 없습니다.", { status: 422 });
          const reader = upstream.body.getReader();
          let size = 0;
          const body = new ReadableStream({
            async pull(controller) {
              try {
                const step = await reader.read();
                if (step.done) {
                  controller.close();
                  return;
                }
                size += step.value.byteLength;
                if (size > limit) {
                  await reader.cancel();
                  controller.error(new Error("원본 크기 제한 초과"));
                  return;
                }
                controller.enqueue(step.value);
              } catch (e) {
                controller.error(e);
              }
            },
            cancel() {
              return reader.cancel();
            },
          });
          return new Response(body, {
            status: upstream.status,
            headers: {
              ...(upstream.headers.get('content-range') ? { 'content-range': upstream.headers.get('content-range')! } : {}),
              ...(upstream.headers.get('accept-ranges') ? { 'accept-ranges': upstream.headers.get('accept-ranges')! } : {}),
              ...(upstream.headers.get('etag') ? { etag: upstream.headers.get('etag')! } : {}),
              "content-type": type,
              "cache-control": "private, no-store",
              "x-content-type-options": "nosniff",
            },
          });
        } catch {
          return new Response("원본 주소가 만료되었거나 연결할 수 없습니다.", { status: 502 });
        }
      },
    },
  },
});
