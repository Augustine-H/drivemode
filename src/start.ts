import { createStart } from '@tanstack/react-start';
import { networkConfigured, networkFetch } from './lib/network';
export const startInstance = createStart(() => ({ serverFns: { fetch: async (input, init) => {
  if (typeof window === 'undefined' || !networkConfigured()) return fetch(input, init);
  const request = new Request(input instanceof Request ? input : new URL(String(input), window.location.origin), init);
  const url = new URL(request.url);
  return networkFetch(url.pathname + url.search, {
    method: request.method, headers: request.headers, signal: request.signal,
    body: ['GET','HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
  });
} } }));
