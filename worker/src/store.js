// Accesso a Cloudflare KV con scrittura "solo se cambiato" (per restare
// sotto le 1.000 scritture/giorno del piano gratuito).

const VOLATILE = new Set(['updatedAt', 'generatedAt']);

/** JSON canonico senza i campi volatili, per confrontare due versioni. */
export function canonical(value) {
  return JSON.stringify(value, (k, v) => (VOLATILE.has(k) ? undefined : v));
}

export async function getJson(kv, key, fallback = null) {
  const v = await kv.get(key, 'json');
  return v ?? fallback;
}

/**
 * Scrive `value` solo se diverso da quanto già salvato (ignorando updatedAt).
 * Ritorna true se ha scritto.
 */
export async function putIfChanged(kv, key, value, existing) {
  const prev = existing === undefined ? await kv.get(key, 'json') : existing;
  if (prev && canonical(prev) === canonical(value)) return false;
  await kv.put(key, JSON.stringify(value));
  return true;
}
