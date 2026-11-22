// Decide a ogni tick del cron (ogni 10 minuti) se e cosa aggiornare.

import { KEYS, ALL_SPORTS, SPORTS } from './schema.js';
import { getJson } from './store.js';
import { romeDateKey } from './time.js';
import { updateBiathlon } from './updaters/biathlon.js';

const UPDATERS = {
  [SPORTS.BIATHLON]: updateBiathlon,
};

const QUIET_INTERVAL_MS = 30 * 60e3 - 60e3; // ~30 minuti nei giorni senza gare

/** True se oggi (ora italiana) c'è almeno una gara o una gara è in corso. */
export function isRaceDay(races, now) {
  const today = romeDateKey(now);
  return races.some((r) => r.status === 'live' ||
    (r.startUtc && r.status !== 'cancelled' && romeDateKey(r.startUtc) === today));
}

export async function runTick(env, { now = Date.now(), force = false, log = console.log } = {}) {
  const kv = env.KV;
  const state = await getJson(kv, KEYS.state, {});
  const calendars = await Promise.all(ALL_SPORTS.map((s) => getJson(kv, KEYS.calendar(s), [])));
  const raceDay = isRaceDay(calendars.flat(), now);

  // finché la prima scansione completa del calendario non è finita, lavora a ogni tick
  const bootstrapping = !state.biathlon?.sweepDoneAt;
  if (!force && !raceDay && !bootstrapping && state.lastWorkAt && now - state.lastWorkAt < QUIET_INTERVAL_MS) {
    return { skipped: true, raceDay };
  }

  const budget = {
    results: Number(env.BUDGET_RESULTS || 4),
    probes: Number(env.BUDGET_PROBES || 12),
  };
  const health = await getJson(kv, KEYS.health, {});
  const report = {};

  for (const [sport, update] of Object.entries(UPDATERS)) {
    try {
      const r = await update({ kv, now, state, budget, log });
      report[sport] = r;
      const prev = health[sport] || {};
      health[sport] = r.ok
        ? { ok: true, updatedAt: new Date(now).toISOString(), lastError: r.error || null }
        : { ok: false, updatedAt: prev.updatedAt || null, error: r.error, errorAt: new Date(now).toISOString() };
    } catch (e) {
      // un errore imprevisto non deve mai cancellare l'ultimo dato valido
      report[sport] = { ok: false, error: e.message };
      health[sport] = { ...(health[sport] || {}), ok: false, error: e.message, errorAt: new Date(now).toISOString() };
      log(`update ${sport} failed`, e.stack || e.message);
    }
  }

  state.lastWorkAt = now;
  await kv.put(KEYS.state, JSON.stringify(state));
  await kv.put(KEYS.health, JSON.stringify(health));
  return { skipped: false, raceDay, report };
}
