// Funzioni condivise dagli updater dei vari sport.
import { canonical } from '../store.js';

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
      if (start > now) return false;
      // la fonte dice che i risultati ci sono ma non li abbiamo ancora (es. primo avvio): sempre
      if (r.resultsAvailable && !r.hasResults) return true;
      if (now - start > WEEK) return false;
      if (!r.hasResults || r.status !== 'finished') return true;
      return now - start < 6 * 3600e3; // per qualche ora ricontrolla (risultati ufficiali/correzioni)
    })
    .sort((a, b) => Date.parse(b.startUtc) - Date.parse(a.startUtc))
    .map((r) => r.source.raceId);
}

