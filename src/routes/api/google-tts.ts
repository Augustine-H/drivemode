import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/google-tts')({
  server: { handlers: {
    GET: async ({ request }) => (await import('@/lib/google-tts-proxy.server')).googleTtsProxy(request, '/status'),
    POST: async ({ request }) => (await import('@/lib/google-tts-proxy.server')).googleTtsProxy(request, new URL(request.url).searchParams.get('action') === 'settings' ? '/settings' : '/synthesize'),
  } },
});
