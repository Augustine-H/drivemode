import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/naver-mail")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await import("@/lib/naver-mail.server")).naverMailEndpoint(request),
      OPTIONS: async ({ request }) =>
        (await import("@/lib/naver-mail.server")).naverMailEndpoint(request),
    },
  },
});
