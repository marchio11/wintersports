// Costanti e utilità condivise del formato JSON comune (vedi PIANO.md §4).

export const SEASON = '2026/27';

export const SPORTS = Object.freeze({
  ALPINE: 'alpine',
  BIATHLON: 'biathlon',
  CROSSCOUNTRY: 'crosscountry',
  JUMPING: 'jumping',
});

export const ALL_SPORTS = Object.values(SPORTS);

export const STATUSES = ['scheduled', 'live', 'finished', 'cancelled', 'postponed'];

export const KEYS = {
  calendar: (sport) => `cal:${sport}`,
  result: (raceId) => `res:${raceId}`,
  standings: (sport) => `std:${sport}`,
  state: 'meta:state',
  health: 'meta:health',
};

/** Controllo minimo che una gara rispetti lo schema (scarta dati corrotti). */
export function isValidRace(r) {
  return !!r && typeof r.id === 'string' && ALL_SPORTS.includes(r.sport) &&
    ['M', 'F', 'X'].includes(r.gender) && STATUSES.includes(r.status) &&
    (r.startUtc === null || !Number.isNaN(Date.parse(r.startUtc)));
}

/** Ordina le gare per orario di partenza (le gare senza orario in fondo). */
export function sortRaces(races) {
  return races.slice().sort((a, b) => {
    const ta = a.startUtc ? Date.parse(a.startUtc) : Infinity;
    const tb = b.startUtc ? Date.parse(b.startUtc) : Infinity;
    return ta - tb || a.id.localeCompare(b.id);
  });
}
