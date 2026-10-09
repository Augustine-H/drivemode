import { createFileRoute } from '@tanstack/react-router';
const handle = async (request: Request) => {
  const { publicBoundary } = await import('@/lib/public-boundary.server');
  return await publicBoundary(request) || Response.json({ public: false, authenticated: false }, { headers: { 'cache-control': 'no-store' } });
};
export const Route = createFileRoute('/api/network/$')({ server: { handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) } } });
