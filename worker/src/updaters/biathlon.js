// Aggiornamento incrementale dei dati del biathlon (eseguito a ogni tick del cron).

import { KEYS, SPORTS, sortRaces, isValidRace } from '../schema.js';
import { getJson, putIfChanged, canonical } from '../store.js';
import { fetchText } from '../http.js';
import { BASE, parseCalendarPage, parseResultPage, candidateRaceIds } from '../sources/biathlon.js';

const SPORT = SPORTS.BIATHLON;
const SWEEP_EVERY_MS = 20 * 3600e3; // una scansione completa delle tappe al giorno

/** Unisce la versione nuova di una gara a quella salvata. */
export function mergeRace(old, next) {
  if (!old) return next;
  const merged = { ...old, ...next };
  merged.hasResults = !!(old.hasResults || next.hasResults);
  if (merged.hasResults && merged.status === 'live' && old.status === 'finished') merged.status = 'finished';
  if (!next.startUtc && old.startUtc) { merged.startUtc = old.startUtc; merged.timeTbc = old.timeTbc; }
  merged.updatedAt = canonical(old) === canonical(merged) ? old.updatedAt : next.updatedAt;
  return merged;
}

/** Gare di cui (ri)scaricare i risultati, in ordine di priorità. */
export function raceIdsNeedingResults(races, now) {
  const WEEK = 7 * 24 * 3600e3;
  return races
    .filter((r) => r.startUtc && r.status !== 'cancelled' && r.status !== 'postponed')
    .filter((r) => {
      const start = Date.parse(r.startUtc);
      if (start > now || now - start > WEEK) return false;
      if (!r.hasResults || r.status !== 'finished') return true;
      return now - start < 6 * 3600e3; // per qualche ora ricontrolla (risultati ufficiali/correzioni)
    })
    .sort((a, b) => Date.parse(b.startUtc) - Date.parse(a.startUtc))
    .map((r) => r.source.raceId);
}

/**
 * @param {object} ctx { kv, now, state, budget: { results, probes }, log }
 * @returns {Promise<{ok:boolean, error?:string, stats:object}>}
 */
export async function updateBiathlon(ctx) {
  const { kv, now, log = () => {} } = ctx;
  const st = (ctx.state.biathlon ||= {});
  const stats = { fetched: 0, resultsWritten: 0, probed: 0, discovered: 0, calendarWritten: false };
  const errors = [];

  const stored = await getJson(kv, KEYS.calendar(SPORT), []);
  const byId = new Map(stored.map((r) => [r.id, r]));
  const upsert = (race) => {
    if (!isValidRace(race)) return;
    if (!byId.has(race.id)) stats.discovered++;
    byId.set(race.id, mergeRace(byId.get(race.id), race));
  };

  // 1) Pagina calendario: elenco tappe + gare della tappa corrente
  let events = st.events || [];
  try {
    const res = await fetchText(`${BASE}/calendar`);
    stats.fetched++;
    if (!res.ok) throw new Error(`calendar HTTP ${res.status}`);
    const cal = parseCalendarPage(res.text, now);
    events = cal.events.map(({ raw, ...e }) => e);
    st.events = events;
    st.season = cal.season;
    cal.races.forEach(upsert);
  } catch (e) {
    errors.push(`calendario: ${e.message}`);
    log('biathlon calendar error', e.message);
  }

  // 2) Risultati delle gare iniziate di recente
  const toFetch = raceIdsNeedingResults([...byId.values()], now).slice(0, ctx.budget.results);
  for (const raceId of toFetch) {
    try {
      const res = await fetchText(`${BASE}/results/${raceId}`);
      stats.fetched++;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { race, result } = parseResultPage(res.text, now);
      upsert(race);
      if (result) {
        result.race = byId.get(race.id);
        if (await putIfChanged(kv, KEYS.result(race.id), result)) stats.resultsWritten++;
      }
    } catch (e) {
      errors.push(`risultati ${raceId}: ${e.message}`);
    }
  }

  // 3) Scoperta anticipata delle gare delle tappe future (a rotazione, una volta al giorno)
  const pairs = events
    .filter((e) => Date.parse(e.endUtc) > now - 24 * 3600e3)
    .flatMap((e) => candidateRaceIds(e.eventId));
  const sweepDue = !st.sweepDoneAt || now - st.sweepDoneAt > SWEEP_EVERY_MS;
  if (pairs.length && (sweepDue || st.sweepCursor)) {
    let cursor = st.sweepCursor || 0;
    let n = 0;
    while (n < ctx.budget.probes && cursor < pairs.length) {
      const raceId = pairs[cursor++];
      n++;
      try {
        const res = await fetchText(`${BASE}/results/${raceId}`);
        stats.fetched++; stats.probed++;
        if (res.status === 500 || res.status === 404) continue; // gara inesistente
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { race, result } = parseResultPage(res.text, now);
        upsert(race);
        if (result) await putIfChanged(kv, KEYS.result(race.id), { ...result, race: byId.get(race.id) });
      } catch (e) {
        errors.push(`scoperta ${raceId}: ${e.message}`);
      }
    }
    if (cursor >= pairs.length) { st.sweepCursor = 0; st.sweepDoneAt = now; }
    else st.sweepCursor = cursor;
  }

  // 4) Salva il calendario solo se è cambiato
  const races = sortRaces([...byId.values()]);
  if (races.length) stats.calendarWritten = await putIfChanged(kv, KEYS.calendar(SPORT), races, stored);

  const ok = errors.length === 0 || (stats.fetched > errors.length);
  return { ok, error: errors.slice(0, 5).join(' | ') || undefined, stats };
}
