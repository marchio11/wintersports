// Sci di fondo (FIS sector CC): mappe specifiche e conversione nel formato comune.
import { SPORTS } from '../../schema.js';
import { urls, startOf, resultRows, headerInfo, decode, cupPointsFor } from './common.js';
import { statusOf } from './alpine.js';

export const SECTOR = 'CC';
export const SPORT = SPORTS.CROSSCOUNTRY;
export const SEASON_CODE = '2027';
export const CATEGORIES = ['WC', 'WSC'];

const km = (s) => `${s.replace('.', ',')} km`;

function technique(text) {
  if (/classic\s*\/\s*free/i.test(text)) return '';
  if (/classic/i.test(text)) return 'tecnica classica';
  if (/free/i.test(text)) return 'tecnica libera';
  return '';
}

/** "10km Interval Start Classic" → { discipline: 'IND', disciplineName: '10 km individuale, tecnica classica' } */
export function mapDiscipline(text, comments = '', gender = 'M') {
  const tech = technique(text);
  const relayM = text.match(/(\d)x(\d+(?:\.\d+)?)\s*km/i);
  const distM = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*km/i);
  const with_ = (base) => [base, tech].filter(Boolean).join(', ');
  let out;
  if (/team sprint/i.test(text)) out = { discipline: 'TSP', disciplineName: with_('Team sprint') };
  else if (/sprint/i.test(text)) out = { discipline: 'SPR', disciplineName: with_('Sprint') };
  else if (/relay/i.test(text)) {
    const base = gender === 'X' || /mixed/i.test(text) ? 'Staffetta mista' : 'Staffetta';
    out = { discipline: 'REL', disciplineName: relayM ? `${base} ${relayM[1]}×${km(relayM[2])}` : base };
  } else if (/skiathlon/i.test(text)) out = { discipline: 'SKA', disciplineName: `Skiathlon${distM ? ` ${km(distM[1])}` : ''}` };
  else if (/pursuit/i.test(text)) out = { discipline: 'PUR', disciplineName: with_(`${distM ? `${km(distM[1])} ` : ''}inseguimento`) };
  else if (/mass start/i.test(text)) out = { discipline: 'MS', disciplineName: with_(`${distM ? `${km(distM[1])} ` : ''}mass start`) };
  else if (/interval|individual/i.test(text)) out = { discipline: 'IND', disciplineName: with_(`${distM ? `${km(distM[1])} ` : ''}individuale`) };
  else out = { discipline: text.toUpperCase().slice(0, 8), disciplineName: text };
  out.disciplineName = out.disciplineName.charAt(0).toUpperCase() + out.disciplineName.slice(1);
  if (/final climb/i.test(comments)) out.disciplineName += ' – Final Climb';
  return out;
}

/** Qualificazioni delle sprint e prove non sono gare a sé. */
export function isRealRace(r) {
  return !/qualification|training/i.test(r.discipline) &&
    (!r.category || ['WC', 'WSC', 'SWC', 'OWG'].includes(r.category));
}

/** La "tappa" Tour de Ski (nazione FIS) è solo la classifica del Tour. */
export function isRealEvent(e) {
  return e.nation !== 'FIS';
}

const PLACE_NAMES = {
  'Toblach/Dobbiaco': 'Dobbiaco',
  'Toblach': 'Dobbiaco',
  'Val Di Fiemme': 'Val di Fiemme',
  'Oslo': 'Oslo Holmenkollen',
  'Engadin': 'Engadina',
};

export function placeName(raw) {
  const p = (raw || '').replace(/\s*\([A-Z]{3}\)\s*$/, '').trim();
  return PLACE_NAMES[p] || p;
}

function genderOf(genders) {
  if (genders.length === 1) return genders[0] === 'W' ? 'F' : genders[0] === 'M' ? 'M' : 'X';
  return 'X';
}

export function toRace(d, event, competition, now = Date.now()) {
  const gender = genderOf(d.genders);
  const { discipline, disciplineName } = mapDiscipline(d.discipline, d.comments, gender);
  const { startUtc, timeTbc } = startOf(d);
  const status = statusOf({ ...d, startIso: timeTbc ? null : d.startIso }, now);
  const race = {
    id: `fis-cc-${d.raceId}`,
    sport: SPORT,
    source: { name: 'fis', raceId: d.raceId, eventId: event.eventId, url: urls.results(SECTOR, d.raceId) },
    competition: d.category === 'WSC' || competition === 'WSC' ? 'WSC' : (d.category === 'OWG' ? 'OWG' : 'WC'),
    discipline,
    disciplineName,
    gender,
    location: placeName(event.place),
    country: event.nation || null,
    startUtc,
    localTimezone: d.timezone,
    timeTbc,
    status,
    hasResults: false,
    resultsAvailable: d.dataAvailable,
    runs: [],
    updatedAt: new Date(now).toISOString(),
  };
  if (d.category === 'SWC') race.series = 'Tour de Ski';
  return race;
}

/** Pagina risultati del fondo (individuale, sprint con batterie, team sprint e staffette). */
export function parseCcResults(html) {
  const list = resultRows(html);
  if (!list) return null;
  const isTeam = list.some((x) => x.basics.team);
  const rows = [];
  let team = null;
  for (const { html: r, status, statusDetail, phase, basics } of list) {
    if (isTeam && basics.member) {
      if (team) team.members.push({ leg: team.members.length + 1, name: basics.name, nation: team.nation, shooting: null });
      continue;
    }
    const tail = r.slice(r.indexOf('country__'));
    const total = tail.match(/justify-right blue bold[^"]*">\s*([^<]*?)\s*<\/div>/)?.[1] || '';
    const timeOrGap = decode(tail.match(/g-xs-5 justify-right bold[^"]*">\s*(?:<span[^>]*>)?\s*([^<]*?)\s*</)?.[1] || '');
    const row = {
      rank: status ? null : basics.rank,
      bib: basics.bib,
      athleteId: basics.athleteId,
      name: basics.name,
      nation: basics.nation,
      time: status ? null : (total || (timeOrGap && !timeOrGap.startsWith('+') ? timeOrGap : null) || null),
      gap: status || !timeOrGap.startsWith('+') ? null : timeOrGap,
      points: null,
      cupPoints: null,
      status,
      statusDetail,
      extra: phase ? { phase } : {},
    };
    if (isTeam) { row.members = []; team = row; }
    rows.push(row);
  }
  if (!rows.length) return null;
  return { ...headerInfo(html), isTeam, rows };
}

// Punti Coppa per le tappe del Tour de Ski (stage World Cup)
const STAGE_POINTS = [50, 46, 43, 40, 37, 34, 32, 30, 28, 26, 24, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

export function toResult(parsed, race, now = Date.now()) {
  const individualWc = race.competition === 'WC' && !parsed.isTeam;
  const pts = (rank) => (race.series === 'Tour de Ski'
    ? (rank && rank <= 30 ? STAGE_POINTS[rank - 1] : null)
    : cupPointsFor(rank));
  const hasPhases = parsed.rows.some((r) => r.extra?.phase);
  return {
    race,
    final: race.status === 'finished',
    resultType: 'time',
    columns: hasPhases ? ['phase'] : [],
    isRelay: parsed.isTeam,
    rows: parsed.rows.map((r) => ({ ...r, cupPoints: individualWc && !r.status ? pts(r.rank) : null })),
    updatedAt: new Date(now).toISOString(),
  };
}

export const parseResultsFor = parseCcResults;
