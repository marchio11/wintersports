// Fetch verso le fonti esterne, con timeout e User-Agent generico.

const UA = 'Mozilla/5.0 (compatible; wintersports-pwa/1.0; uso personale)';

export async function fetchText(url, { timeoutMs = 15000 } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json;q=0.9' },
    signal: AbortSignal.timeout(timeoutMs),
    cf: { cacheTtl: 0 },
  });
  const text = res.ok ? await res.text() : '';
  if (!res.ok && res.body) await res.body.cancel?.();
  return { status: res.status, ok: res.ok, text };
}
