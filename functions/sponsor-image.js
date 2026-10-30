const ALLOWED = /^\/(?:storage|images)\/[a-zA-Z0-9_./%()-]+$/;
export async function onRequestGet({ request, waitUntil }) {
  const path = new URL(request.url).searchParams.get('path') || '';
  if (!ALLOWED.test(path) || path.includes('..') || /%2e|%2f|%5c/i.test(path)) return new Response(null, { status: 400 });
  const key = new Request(request.url);
  const cached = await caches.default.match(key);
  if (cached) return cached;
  try {
    const remote = await fetch('https://theatre118.com' + path, { redirect: 'manual', signal: AbortSignal.timeout(6000) });
    const type = remote.headers.get('Content-Type')?.split(';')[0];
    if (!remote.ok || !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(type)) return new Response(null, { status: 404 });
    if (Number(remote.headers.get('Content-Length')) > 3_000_000) return new Response(null, { status: 413 });
    const data = await remote.arrayBuffer();
    if (data.byteLength > 3_000_000) return new Response(null, { status: 413 });
    const response = new Response(data, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
    waitUntil(caches.default.put(key, response.clone()));
    return response;
  } catch { return new Response(null, { status: 502 }); }
}
