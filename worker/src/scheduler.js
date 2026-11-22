// Decide a ogni tick del cron (ogni 30 minuti) se e cosa aggiornare.

import { KEYS, ALL_SPORTS, SPORTS } from './schema.js';
import { getJson } from './store.js';
import { romeDateKey } from './time.js';
import { updateBiathlon } from './updaters/biathlon.js';
import { makeFisUpdater } from './updaters/fis.js';
import * as alpine from './sources/fis/alpine.js';
import * as jumping from './sources/fis/jumping.js';
import * as crosscountry from './sources/fis/crosscountry.js';

const UPDATERS = {
  [SPORTS.BIATHLON]: updateBiathlon,
  [SPORTS.ALPINE]: makeFisUpdater(alpine),
  [SPORTS.JUMPING]: makeFisUpdater(jumping),
  [SPORTS.CROSSCOUNTRY]: makeFisUpdater(crosscountry),
};

const QUIET_INTERVAL_MS = 3 * 3600e3 - 5 * 60e3; // fuori dalle gare: ogni ~3 ore
export const MANUAL_MIN_INTERVAL_MS = 5 * 60e3;   // pulsante "Aggiorna": al massimo ogni 5 minuti

/**
 * True se siamo in una "finestra di gara": da 15 minuti prima della partenza
 * fino a quando i risultati sono salvati (al massimo 4 ore dopo la partenza).
 */
export function inRaceWindow(races, now) {
  return races.some((r) => {
    if (!r.startUtc || r.timeTbc || r.status === 'cancelled' || r.status === 'postponed') return false;
    if (r.status === 'finished' && r.hasResults) return false;
    const start = Date.parse(r.startUtc);
    return now >= start - 15 * 60e3 && now <= start + 4 * 3600e3;
  });
}

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
  const all = calendars.flat();
  const raceDay = isRaceDay(all, now);
  const raceWindow = inRaceWindow(all, now);

  // finché uno sport ha lavoro arretrato (es. primo scaricamento del calendario), lavora a ogni tick
  const bootstrapping = Object.values(state.pending || {}).some(Boolean) || !state.biathlon?.sweepDoneAt;
  if (!force && !raceWindow && !bootstrapping && state.lastWorkAt && now - state.lastWorkAt < QUIET_INTERVAL_MS) {
    return { skipped: true, raceDay, raceWindow };
  }

  const budget = {
    results: Number(env.BUDGET_RESULTS || 4),
    probes: Number(env.BUDGET_PROBES || 12),
    fis: { details: Number(env.FIS_DETAILS || 3), results: Number(env.FIS_RESULTS || 3) },
  };
  state.pending ||= {};
  const health = await getJson(kv, KEYS.health, {});
  const report = {};

  for (const [sport, update] of Object.entries(UPDATERS)) {
    try {
      const r = await update({ kv, now, state, budget, log });
      report[sport] = r;
      state.pending[sport] = !!r.stats?.pending;
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
  return { skipped: false, raceDay, raceWindow, report };
}
