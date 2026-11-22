// Sci alpino (FIS sector AL): mappe specifiche e conversione nel formato comune.
import { SPORTS } from '../../schema.js';
import { urls, startOf } from './common.js';

export const SECTOR = 'AL';
export const SPORT = SPORTS.ALPINE;
export const SEASON_CODE = '2027';
export const CATEGORIES = ['WC', 'WSC'];
export const STANDING_LABELS = {
  ALL: 'Generale', DH: 'Discesa libera', SG: 'Super-G', GS: 'Slalom gigante', SL: 'Slalom',
  AC: 'Combinata', SC: 'Combinata', PAR: 'Parallelo', PGS: 'Parallelo',
};

const DISCIPLINES = [
  [/^downhill$/i, 'DH', 'Discesa libera'],
  [/^super[ -]?g$/i, 'SG', 'Super-G'],
  [/^giant slalom$/i, 'GS', 'Slalom gigante'],
  [/^slalom$/i, 'SL', 'Slalom'],
  [/team combined/i, 'TC', 'Combinata a squadre'],
  [/combined/i, 'AC', 'Combinata'],
  [/team parallel|mixed team|team event/i, 'TP', 'Gara a squadre mista'],
  [/parallel giant/i, 'PGS', 'Gigante parallelo'],
  [/parallel/i, 'PSL', 'Slalom parallelo'],
];

export function mapDiscipline(text) {
  for (const [re, code, name] of DISCIPLINES) if (re.test(text)) return { discipline: code, disciplineName: name };
  return { discipline: text.toUpperCase().slice(0, 6), disciplineName: text };
}

/** Le prove cronometrate non sono gare. */
export function isRealRace(r) {
  return !/training/i.test(r.discipline) && (!r.category || ['WC', 'WSC', 'OWG'].includes(r.category));
}

const PLACE_NAMES = {
  'Soelden': 'Sölden',
  'Kitzbuehel': 'Kitzbühel',
  "Val d'Isere": "Val d'Isère",
  'Val Gardena-Groeden Südtirol': 'Val Gardena',
  'Val Gardena-Groeden': 'Val Gardena',
  'Copper Mountain, CO': 'Copper Mountain',
  'Kronplatz': 'Plan de Corones',
  'Are': 'Åre',
  'Jasna': 'Jasná',
  'Dachstein West / Gosau': 'Gosau',
  'Crans Montana': 'Crans-Montana',
  'Semmering': 'Semmering',
};

export function placeName(raw) {
  const p = (raw || '').replace(/\s*\([A-Z]{3}\)\s*$/, '').trim();
  return PLACE_NAMES[p] || p;
}

function genderOf(genders) {
  if (genders.length === 1) return genders[0] === 'W' ? 'F' : genders[0] === 'M' ? 'M' : 'X';
  return 'X';
}

const isoUtc = (s) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** Stato di una gara FIS dai dati della pagina tappa. */
export function statusOf(d, now = Date.now()) {
  if (d.cancelled || /cancel/i.test(d.comments)) return 'cancelled';
  if (/postpon|rescheduled/i.test(d.comments)) return 'postponed';
  const runStatuses = d.runs.map((r) => r.status.toLowerCase());
  if (runStatuses.some((s) => s.includes('cancel'))) {
    // una manche annullata con le altre concluse → gara annullata/interrotta
    if (!runStatuses.some((s) => s.includes('result'))) return 'cancelled';
  }
  const allDone = runStatuses.length > 0 && runStatuses.every((s) => /official|unofficial|results/.test(s));
  if (allDone && d.dataAvailable) return 'finished';
  const start = d.startIso ? Date.parse(d.startIso) : NaN;
  if (Number.isFinite(start) && now >= start) {
    if (d.dataAvailable && now - start > 6 * 3600e3) return 'finished';
    return 'live';
  }
  return 'scheduled';
}

/** Dettaglio gara FIS + tappa → Race comune. */
export function toRace(d, event, competition, now = Date.now()) {
  const { discipline, disciplineName } = mapDiscipline(d.discipline);
  const status = statusOf(d, now);
  const { startUtc, timeTbc } = startOf(d);
  return {
    id: `fis-al-${d.raceId}`,
    sport: SPORT,
    source: { name: 'fis', raceId: d.raceId, eventId: event.eventId, url: urls.results(SECTOR, d.raceId) },
    competition: d.category === 'WSC' || competition === 'WSC' ? 'WSC' : (d.category === 'OWG' ? 'OWG' : 'WC'),
    discipline,
    disciplineName,
    gender: genderOf(d.genders),
    location: placeName(event.place),
    country: event.nation || null,
    startUtc,
    localTimezone: d.timezone,
    timeTbc,
    status,
    hasResults: false, // diventa true quando la classifica è salvata in KV
    resultsAvailable: d.dataAvailable,
    runs: d.runs.length > 1
      ? d.runs.map((r, i) => ({ label: `${i + 1}ª manche`, startUtc: r.startIso ? isoUtc(r.startIso) : null }))
      : [],
    updatedAt: new Date(now).toISOString(),
  };
}

/** Risultato FIS → formato comune. */
export function toResult(parsed, race, now = Date.now()) {
  const twoRuns = parsed.rows.some((r) => r.extra.runs.length >= 2);
  return {
    race,
    final: race.status === 'finished',
    resultType: 'time',
    columns: twoRuns ? ['run1', 'run2'] : [],
    isRelay: false,
    rows: parsed.rows.map((r) => ({
      ...r,
      extra: twoRuns ? { run1: r.extra.runs[0] || null, run2: r.extra.runs[1] || null } : {},
    })),
    updatedAt: new Date(now).toISOString(),
  };
}
