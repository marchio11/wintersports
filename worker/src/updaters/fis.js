// Aggiornamento incrementale generico per gli sport FIS (alpino, fondo, salto).
// Ogni sport fornisce un "modulo" con: SECTOR, SPORT, SEASON_CODE, CATEGORIES,
// isRealRace(detail), toRace(detail, event, competition, now), toResult(parsed, race, now).

import { KEYS, sortRaces, isValidRace } from '../schema.js';
import { getJson, putIfChanged } from '../store.js';
import { fetchText } from '../http.js';
import { urls, parseCalendar, parseEventDetails, parseResults } from '../sources/fis/common.js';
import { mergeRace, raceIdsNeedingResults } from './common.js';

const DAY = 24 * 3600e3;
const CALENDAR_EVERY = 6 * 3600e3;   // il calendario cambia raramente
const HOT_EVERY = 9 * 60e3;          // tappe in corso / imminenti: a ogni tick
const COLD_EVERY = DAY;              // tutte le altre: una volta al giorno

const dayMs = (iso) => (iso ? Date.parse(`${iso}T12:00:00Z`) : NaN);

/** Tappe di cui aggiornare il dettaglio in questo tick, in ordine di priorità. */
export function pickEvents(events, detailsAt, now, max) {
  const hot = [];
  const cold = [];
  for (const e of events) {
    if (e.cancelled) continue;
    const start = dayMs(e.start);
    const end = dayMs(e.end || e.start);
    const last = detailsAt[e.eventId] || 0;
    const isHot = Number.isFinite(start) && now >= start - 7 * DAY && now <= end + 1.5 * DAY;
    if (isHot && now - last >= HOT_EVERY) hot.push([start, e]);
    else if (!isHot && now - last >= COLD_EVERY) cold.push([last, e]);
  }
  hot.sort((a, b) => a[0] - b[0]);
  cold.sort((a, b) => a[0] - b[0]); // prima le tappe mai/meno recentemente aggiornate
  return [...hot, ...cold].slice(0, max).map(([, e]) => e);
}

export function makeFisUpdater(mod) {
  return async function updateFis(ctx) {
    const { kv, now, log = () => {} } = ctx;
    const st = (ctx.state[mod.SPORT] ||= {});
    st.detailsAt ||= {};
    const budget = ctx.budget.fis || { details: 3, results: 3 };
    const stats = { fetched: 0, events: 0, details: 0, resultsWritten: 0, discovered: 0, calendarWritten: false };
    const errors = [];

    const key = KEYS.calendar(mod.SPORT);
    const stored = await getJson(kv, key, []);
    const byId = new Map(stored.map((r) => [r.id, r]));

    // 1) Calendario (tappe) per ogni categoria: WC, WSC…
    if (!st.events || !st.calendarAt || now - st.calendarAt > CALENDAR_EVERY) {
      const merged = new Map((st.events || []).map((e) => [e.eventId, e]));
      let okCount = 0;
      for (const cat of mod.CATEGORIES) {
        try {
          const res = await fetchText(urls.calendar(mod.SECTOR, mod.SEASON_CODE, cat));
          stats.fetched++;
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          let events;
          try { events = parseCalendar(res.text); } catch (e) {
            if (cat !== 'WC' && /vuoto|non trovata/.test(e.message)) continue; // es. nessun Mondiale quest'anno
            throw e;
          }
          for (const e of events) merged.set(e.eventId, { ...e, competition: cat });
          okCount++;
        } catch (e) {
          errors.push(`calendario ${cat}: ${e.message}`);
        }
      }
      if (okCount) {
        st.events = [...merged.values()].sort((a, b) => (a.start || '').localeCompare(b.start || ''));
        st.calendarAt = now;
      }
    }
    const events = st.events || [];
    stats.events = events.length;

    // 2) Dettaglio delle tappe (gare, orari, stato)
    for (const ev of pickEvents(events, st.detailsAt, now, budget.details)) {
      try {
        const res = await fetchText(urls.event(mod.SECTOR, ev.eventId, mod.SEASON_CODE));
        stats.fetched++;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const details = parseEventDetails(res.text);
        const races = details.races.filter(mod.isRealRace).map((d) => mod.toRace(d, ev, ev.competition, now));
        st.detailsAt[ev.eventId] = now;
        stats.details++;
        if (!races.length) continue;
        // gare sparite dalla tappa (es. riprogrammate altrove): rimosse
        const ids = new Set(races.map((r) => r.id));
        for (const [id, r] of byId) if (r.source.eventId === ev.eventId && !ids.has(id)) byId.delete(id);
        for (const r of races) {
          if (!isValidRace(r)) continue;
          if (!byId.has(r.id)) stats.discovered++;
          byId.set(r.id, mergeRace(byId.get(r.id), r));
        }
      } catch (e) {
        errors.push(`tappa ${ev.eventId}: ${e.message}`);
      }
    }
    // tappe annullate per intero
    for (const ev of events.filter((e) => e.cancelled)) {
      for (const r of byId.values()) if (r.source.eventId === ev.eventId) r.status = 'cancelled';
    }

    // 3) Risultati delle gare iniziate di recente
    for (const raceId of raceIdsNeedingResults([...byId.values()], now).slice(0, budget.results)) {
      const id = `fis-${mod.SECTOR.toLowerCase()}-${raceId}`;
      try {
        const res = await fetchText(urls.results(mod.SECTOR, raceId));
        stats.fetched++;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseResults(res.text);
        if (!parsed) continue; // classifica non ancora pubblicata
        const race = { ...byId.get(id), hasResults: true };
        byId.set(id, race);
        const result = mod.toResult(parsed, race, now);
        if (await putIfChanged(kv, KEYS.result(id), result)) stats.resultsWritten++;
      } catch (e) {
        errors.push(`risultati ${raceId}: ${e.message}`);
      }
    }

    // 4) Salva il calendario solo se cambiato
    const races = sortRaces([...byId.values()]);
    if (races.length) stats.calendarWritten = await putIfChanged(kv, key, races, stored);
    if (errors.length) log(`${mod.SPORT} errors`, errors.join(' | '));

    stats.pending = events.some((e) => !e.cancelled && !st.detailsAt[e.eventId]) ||
      races.some((r) => r.resultsAvailable && !r.hasResults && r.status !== 'cancelled');
    const ok = errors.length === 0 || stats.fetched > errors.length;
    return { ok, error: errors.slice(0, 5).join(' | ') || undefined, stats };
  };
}
