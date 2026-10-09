import { createFileRoute } from '@tanstack/react-router';
const handle = async (request: Request) => (await import('@/lib/music-proxy.server')).musicProxy(request);
export const Route = createFileRoute('/api/music/$')({ server: { handlers: { GET: ({ request }) => handle(request), HEAD: ({ request }) => handle(request), POST: ({ request }) => handle(request) } } });
