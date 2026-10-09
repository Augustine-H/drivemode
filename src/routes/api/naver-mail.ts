import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/naver-mail")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/naver-mail.server")).naverMail(request),
      POST: async ({ request }) => (await import("@/lib/naver-mail.server")).naverMail(request),
      OPTIONS: async ({ request }) => (await import("@/lib/naver-mail.server")).naverMail(request),
    },
  },
});
