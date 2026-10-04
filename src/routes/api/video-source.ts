import { createFileRoute } from "@tanstack/react-router";
import { allowedVideoSource } from "@/lib/video-source";

export const Route = createFileRoute("/api/video-source")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url).searchParams.get("url") ?? "";
        if (!allowedVideoSource(url))
          return new Response("지원하지 않는 영상 주소입니다.", { status: 400 });
        const abort = new AbortController();
        const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(15000)]);
        try {
          // Only public xAI video hosts; never forward credentials or follow redirects.
          const upstream = await fetch(url, { redirect: "manual", signal });
          const type = upstream.headers.get("content-type") ?? "";
          const limit = 12 * 1024 * 1024;
          if (
            !upstream.ok ||
            !upstream.body ||
            !/^(video\/(mp4|webm)|application\/octet-stream)/i.test(type) ||
            Number(upstream.headers.get("content-length")) > limit
          ) {
            abort.abort();
            return new Response("영상을 읽을 수 없거나 너무 큽니다.", { status: 422 });
          }
          const chunks: Uint8Array[] = [];
          let size = 0;
          const reader = upstream.body.getReader();
          while (true) {
            const item = await reader.read();
            if (item.done) break;
            size += item.value.length;
            if (size > limit) {
              abort.abort();
              return new Response("영상은 12MB 이내여야 합니다.", { status: 413 });
            }
            chunks.push(item.value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          return new Response(bytes, {
            headers: {
              "content-type": type.startsWith("video/") ? type : "video/mp4",
              "cache-control": "private, no-store",
              "x-content-type-options": "nosniff",
            },
          });
        } catch {
          return new Response("영상 주소가 만료되었거나 연결할 수 없습니다.", { status: 502 });
        }
      },
    },
  },
});
