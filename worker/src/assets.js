// Serve i file statici della PWA incorporati nel Worker.
import files from './static-assets.js';

const decoded = new Map();

function body(f) {
  if (f.text !== undefined) return f.text;
  if (!decoded.has(f.etag)) decoded.set(f.etag, Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)));
  return decoded.get(f.etag);
}

export function serveStatic(request) {
  let p = new URL(request.url).pathname;
  if (p.endsWith('/')) p += 'index.html';
  const f = files[p];
  if (!f) return null;
  const isHtml = p.endsWith('.html') || p.endsWith('.webmanifest') || p === '/sw.js';
  const headers = {
    'Content-Type': f.type,
    'ETag': f.etag,
    // l'HTML va sempre ricontrollato; il resto può stare in cache ma si riconvalida
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=300, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
  };
  if (request.headers.get('If-None-Match') === f.etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : body(f), { headers });
}
