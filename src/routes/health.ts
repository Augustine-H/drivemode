import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/health')({ server: { handlers: { GET: async ({ request }) => {
  const { nasAccess } = await import('@/lib/nas-access');
  const access = nasAccess(request.headers);
  if (!access.allowed && !import.meta.env.DEV) return Response.json({ error: 'DEVICE_AUTH_REQUIRED' }, { status: 401 });
  return Response.json({ status: 'ok', service: 'voice-grok' }, { headers: { 'cache-control': 'no-store' } });
} } } });
