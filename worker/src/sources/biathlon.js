// Fonte biathlon: sito ufficiale IBU (www.biathlonworld.com).
// Le pagine sono Next.js e incorporano i dati nel tag <script id="__NEXT_DATA__">.
//  - /calendar          → tutte le tappe di Coppa (Level 1) + gare della tappa corrente
//  - /results/<RaceId>  → dati della gara (orario, stato) e, se disponibile, la classifica
// Gli orari IBU sono già in UTC ("...Z").

import { SPORTS } from '../schema.js';

export const BASE = 'https://www.biathlonworld.com';
const SPORT = SPORTS.BIATHLON;

// Codici gara noti (categoria + disciplina) usati per "scoprire" in anticipo
// le gare delle tappe future: /results/<EventId><code> risponde 500 se la gara non esiste.
export const RACE_CODES = [
  'SMIN', 'SWIN', 'SMSI', 'SWSI', 'SMSP', 'SWSP', 'SMPU', 'SWPU',
  'SMMS', 'SWMS', 'SMRL', 'SWRL', 'MXRL', 'MXSR',
];

const DISCIPLINES = {
  IN: { code: 'IN', name: 'Individuale' },
  SI: { code: 'SI', name: 'Individuale breve' },
  SP: { code: 'SP', name: 'Sprint' },
  PU: { code: 'PU', name: 'Inseguimento' },
  MS: { code: 'MS', name: 'Mass start' },
  RL: { code: 'RL', name: 'Staffetta' },
};

const LOCATION_NAMES = {
  'Antholz-Anterselva': 'Anterselva',
  'Oestersund': 'Östersund',
  'Otepaa': 'Otepää',
  'Nove Mesto na Morave': 'Nové Město',
  'Oslo Holmenkollen': 'Oslo Holmenkollen',
  'Le Grand Bornand': 'Le Grand-Bornand',
};

/** Estrae e fa il parse del JSON __NEXT_DATA__ da una pagina HTML. */
export function extractNextData(html) {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('IBU: __NEXT_DATA__ non trovato');
  const from = start + marker.length;
  const end = html.indexOf('</script>', from);
  if (end < 0) throw new Error('IBU: __NEXT_DATA__ non terminato');
  const data = JSON.parse(html.slice(from, end));
  const pageProps = data?.props?.pageProps;
  if (!pageProps) throw new Error('IBU: pageProps mancante');
  return pageProps;
}

export function competitionFromEventId(eventId) {
  if (/SWRLCH/.test(eventId)) return 'WSC';
  if (/SWRLOG/.test(eventId)) return 'OWG';
  return 'WC';
}

function genderFromCat(catId, raceId) {
  const c = catId || raceId.slice(-4, -2);
  if (c === 'SM') return 'M';
  if (c === 'SW') return 'F';
  return 'X';
}

function formatKm(km) {
  if (!km) return '';
  return String(km).replace('.', ',') + ' km';
}

export function disciplineInfo(raceId, km) {
  const tail = raceId.slice(-4); // es. SWSP, MXRL, MXSR
  const disc = tail.slice(2);
  if (tail === 'MXSR') return { discipline: 'SMRL', disciplineName: 'Single mixed relay' };
  if (tail === 'MXRL') return { discipline: 'MRL', disciplineName: 'Staffetta mista' };
  const d = DISCIPLINES[disc];
  if (!d) return { discipline: disc, disciplineName: disc };
  const kmLabel = disc === 'RL' ? '' : formatKm(km);
  return { discipline: d.code, disciplineName: kmLabel ? `${d.name} ${kmLabel}` : d.name };
}

export function locationName(raw) {
  if (!raw) return '';
  return LOCATION_NAMES[raw] || raw;
}

/**
 * Stato normalizzato. `now` serve per dedurre "in corso" quando l'IBU
 * non lo segnala esplicitamente.
 */
export function mapStatus(comp, now = Date.now(), hasResults = false) {
  const text = `${comp.StatusText || ''} ${comp.ScheduleStatus || ''}`.toUpperCase();
  if (text.includes('CANCEL')) return 'cancelled';
  if (text.includes('POSTPON')) return 'postponed';
  if (comp.StatusId === 11 || text.includes('FINAL') || text.includes('FINISHED') ||
      comp.ResultStatus === 'OFFICIAL' || comp.ResultStatus === 'UNOFFICIAL') return 'finished';
  if (comp.IsLive) return 'live';
  const start = Date.parse(comp.StartTime);
  if (Number.isFinite(start) && now >= start) {
    // partita ma non ancora "final": in corso per qualche ora, poi la consideriamo conclusa se ha risultati
    if (now - start < 4 * 3600e3) return 'live';
    return hasResults ? 'finished' : 'live';
  }
  return 'scheduled';
}

/** Converte una "Competition" IBU (+ tappa) nel formato Race comune. */
export function toRace(comp, evt, now = Date.now(), extra = {}) {
  const raceId = comp.RaceId;
  const eventId = evt?.EventId || raceId.slice(0, 14);
  const { discipline, disciplineName } = disciplineInfo(raceId, comp.km);
  return {
    id: `ibu-${raceId}`,
    sport: SPORT,
    source: { name: 'ibu', raceId, eventId, url: `${BASE}/results/${raceId}` },
    competition: competitionFromEventId(eventId),
    discipline,
    disciplineName,
    gender: genderFromCat(comp.catId, raceId),
    location: locationName(evt?.ShortDescription || evt?.Organizer || comp.Location),
    country: evt?.Nat || null,
    startUtc: comp.StartTime ? new Date(comp.StartTime).toISOString() : null,
    localTimezone: null,
    timeTbc: !comp.StartTime,
    status: mapStatus(comp, now, !!extra.hasResults),
    hasResults: !!extra.hasResults,
    runs: [],
    updatedAt: new Date(now).toISOString(),
  };
}

/** Tappa IBU → oggetto "event" usato internamente per la scoperta delle gare. */
function toEvent(e) {
  return {
    eventId: e.EventId,
    location: locationName(e.ShortDescription || e.Organizer),
    country: e.Nat,
    startUtc: e.StartDate,
    endUtc: e.EndDate,
    competition: competitionFromEventId(e.EventId),
    raw: { EventId: e.EventId, ShortDescription: e.ShortDescription, Organizer: e.Organizer, Nat: e.Nat },
  };
}

/** Parse della pagina /calendar: tappe della stagione + gare della tappa corrente. */
export function parseCalendarPage(html, now = Date.now()) {
  const pp = extractNextData(html);
  const events = pp.eventInitialState?.events;
  if (!Array.isArray(events) || events.length === 0) throw new Error('IBU: nessuna tappa nel calendario');
  const season = pp.seasonInitialState?.selectedSeason?.SeasonId || pp.seasonInitialState?.currentSeason?.SeasonId;
  const selected = pp.eventInitialState?.selectedEvent;
  const comps = Array.isArray(pp.competitionsInitialState) ? pp.competitionsInitialState : [];
  const races = selected ? comps.filter((c) => c?.RaceId).map((c) => toRace(c, selected, now)) : [];
  return { season, events: events.map(toEvent), races };
}

const IRM_STATUSES = new Set(['DNF', 'DNS', 'DSQ', 'LAP', 'DNQ', 'RNK']);

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function cleanBehind(b) {
  if (!b || b === '0.0' || b === '0') return null;
  return b.startsWith('+') ? b : `+${b}`;
}

/** Parse di /results/<RaceId>. Ritorna { race, result|null }. */
export function parseResultPage(html, now = Date.now()) {
  const pp = extractNextData(html);
  const st = pp.resultsInitialState;
  if (!st || !st.Competition || !st.Competition.RaceId) throw new Error('IBU: pagina risultati senza Competition');
  const rows = Array.isArray(st.Results) ? st.Results : [];
  const isResult = !!st.IsResult && rows.length > 0;
  const race = toRace(st.Competition, st.SportEvt, now, { hasResults: isResult });
  if (!isResult) return { race, result: null };

  const relay = rows.some((r) => r.IsTeam);
  const out = [];
  let current = null;
  for (const r of rows) {
    if (relay && !r.IsTeam) {
      // frazionista della staffetta: lo aggiungiamo alla squadra corrente
      if (current) {
        current.members.push({
          leg: r.Leg, name: r.Name, nation: r.Nat,
          shooting: r.Shootings || null, legRank: toInt(r.LegRank),
        });
      }
      continue;
    }
    const irm = r.IRM && IRM_STATUSES.has(r.IRM) ? r.IRM : (r.IRM || null);
    const row = {
      rank: irm ? null : toInt(r.Rank),
      bib: toInt(r.Bib),
      athleteId: r.IBUId ? `ibu-${r.IBUId}` : null,
      name: r.Name,
      nation: r.Nat,
      time: irm ? null : (r.TotalTime || null),
      gap: irm ? null : cleanBehind(r.Behind),
      points: null,
      cupPoints: toInt(r.WC),
      status: irm,
      extra: {
        shooting: r.Shootings || null,
        penalties: r.ShootingTotal ?? null,
      },
    };
    if (relay) { row.members = []; current = row; }
    out.push(row);
  }
  if (out.length === 0) throw new Error('IBU: risultati vuoti');

  const result = {
    race,
    final: race.status === 'finished',
    resultType: 'time',
    columns: ['shooting'],
    isRelay: relay,
    rows: out,
    updatedAt: new Date(now).toISOString(),
  };
  return { race, result };
}

/** Elenco degli id gara candidati per una tappa (per la scoperta anticipata). */
export function candidateRaceIds(eventId) {
  return RACE_CODES.map((c) => `${eventId}${c}`);
}
