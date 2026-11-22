// Accesso alle API con copia locale dell'ultimo dato (funziona anche offline).
import { API_BASE } from './config.js';

const PREFIX = 'ws:cache:';

function readCache(path) {
  try {
    const raw = localStorage.getItem(PREFIX + path);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(path, data) {
  try {
    localStorage.setItem(PREFIX + path, JSON.stringify({ savedAt: Date.now(), data }));
  } catch { /* spazio pieno o storage bloccato: pazienza */ }
}

/**
 * Ritorna { data, savedAt, offline, notFound }.
 * Se la rete non risponde usa l'ultima copia salvata.
 */
export async function getJson(path) {
  try {
    const res = await fetch(API_BASE + path, { headers: { Accept: 'application/json' }, cache: 'no-cache' });
    if (res.status === 404) return { data: null, notFound: true };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    writeCache(path, data);
    return { data, savedAt: Date.now(), offline: false };
  } catch (e) {
    const cached = readCache(path);
    if (cached) return { data: cached.data, savedAt: cached.savedAt, offline: true };
    throw e;
  }
}

/** Chiede al server un aggiornamento immediato dalle fonti (max ogni 5 minuti). */
async function refresh() {
  const res = await fetch(API_BASE + '/refresh', { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  refresh,
  calendar: () => getJson('/calendar'),
  result: (raceId) => getJson(`/results/${encodeURIComponent(raceId)}`),
  standings: (sport) => getJson(`/standings/${sport}`),
};
