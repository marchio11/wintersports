// Salto con gli sci (FIS sector JP): mappe specifiche e conversione nel formato comune.
// Nota: le pagine FIS non riportano l'HS (hill size); si mostra il tipo di trampolino.
import { SPORTS } from '../../schema.js';
import { urls, startOf, resultRows, headerInfo, decode, cupPointsFor } from './common.js';
import { statusOf } from './alpine.js';

export const SECTOR = 'JP';
export const SPORT = SPORTS.JUMPING;
export const SEASON_CODE = '2027';
export const CATEGORIES = ['WC', 'WSC'];

const HILLS = [
  [/flying hill|ski flying/i, 'FH', 'trampolino per il volo'],
  [/large hill/i, 'LH', 'trampolino grande'],
  [/normal hill/i, 'NH', 'trampolino normale'],
];

export function mapDiscipline(text, gender) {
  const hill = HILLS.find(([re]) => re.test(text)) || [null, '', ''];
  const [, hillCode, hillName] = hill;
  if (/super ?team/i.test(text)) return { discipline: `SUPERTEAM${hillCode}`, disciplineName: `Super team, ${hillName}`.replace(/, $/, '') };
  if (/team/i.test(text)) {
    const label = gender === 'X' ? 'Gara a squadre mista' : 'Gara a squadre';
    return { discipline: `TEAM${hillCode}`, disciplineName: `${label}, ${hillName}`.replace(/, $/, '') };
  }
  if (hillCode === 'FH') return { discipline: 'FH', disciplineName: 'Volo' };
  if (hillCode) return { discipline: hillCode, disciplineName: hillName.charAt(0).toUpperCase() + hillName.slice(1) };
  return { discipline: text.toUpperCase().slice(0, 8), disciplineName: text };
}

/** Qualificazioni, prove e serie di allenamento non sono gare. */
export function isRealRace(r) {
  return !/qualification|training|trial/i.test(r.discipline) &&
    (!r.category || ['WC', 'WSC', 'OWG'].includes(r.category));
}

/** La "tappa" Four Hills Tournament (nazione FIS) è solo la classifica del torneo. */
export function isRealEvent(e) {
  return e.nation !== 'FIS';
}

const PLACE_NAMES = {
  'Wisla': 'Wisła',
  'Zao': 'Zaō',
  'Oslo': 'Oslo Holmenkollen',
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
  const { discipline, disciplineName } = mapDiscipline(d.discipline, gender);
  const { startUtc, timeTbc } = startOf(d);
  const status = statusOf({ ...d, startIso: timeTbc ? null : d.startIso }, now);
  return {
    id: `fis-jp-${d.raceId}`,
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
}

const num = (s) => {
  const v = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

/** Salti di una riga: [{ round, distance, points, roundRank }] */
function jumpsOf(r) {
  const jumps = [];
  const items = r.split(/<div class="split-row__item reset-padding[^"]*">/).slice(1);
  for (const it of items) {
    const vals = [...it.matchAll(/style="text-align: right">\s*([^<]*?)\s*<\/div>/g)].map((m) => decode(m[1]));
    if (vals.length < 3) continue;
    jumps.push({ round: vals[0], distance: num(vals[1]), points: num(vals[2]), roundRank: vals[3] ? parseInt(vals[3], 10) || null : null });
  }
  return jumps;
}

/** Pagina risultati del salto (individuale o a squadre). */
export function parseJumpResults(html) {
  const list = resultRows(html);
  if (!list) return null;
  const rows = [];
  let team = null;
  const isTeam = list.some((x) => x.basics.team);
  for (const { html: r, status, statusDetail, basics } of list) {
    const tail = r.slice(r.indexOf('country__'));
    const total = num(tail.match(/justify-right blue bold[^"]*">\s*([\d.,]+)\s*</)?.[1]);
    const diffTxt = decode(tail.match(/g-xs-5 justify-right bold">\s*(?:<span[^>]*>)?\s*([^<]*?)\s*</)?.[1] || '');
    const jumps = jumpsOf(r);
    if (isTeam && basics.member) {
      if (team) team.members.push({ leg: basics.bib, name: basics.name, nation: team.nation, jumps, shooting: null });
      continue;
    }
    const row = {
      rank: status ? null : basics.rank,
      bib: basics.bib,
      athleteId: basics.athleteId,
      name: basics.name,
      nation: basics.nation,
      time: null,
      gap: !status && /^-\d/.test(diffTxt) ? diffTxt : null,
      points: status ? null : total,
      cupPoints: null,
      status,
      statusDetail,
      extra: { jumps },
    };
    if (isTeam) { row.members = []; team = row; }
    rows.push(row);
  }
  if (!rows.length) return null;
  // gap per le gare a squadre (non pubblicato): calcolato dal punteggio
  const best = rows[0]?.points;
  for (const r of rows) {
    if (r.gap == null && r.points != null && best != null && r.points !== best) r.gap = `-${(best - r.points).toFixed(1)}`;
  }
  return { ...headerInfo(html), isTeam, rows };
}

export function toResult(parsed, race, now = Date.now()) {
  const individualWc = race.competition === 'WC' && !parsed.isTeam;
  return {
    race,
    final: race.status === 'finished',
    resultType: 'points',
    columns: ['jumps'],
    isRelay: parsed.isTeam,
    rows: parsed.rows.map((r) => ({ ...r, cupPoints: individualWc && !r.status ? cupPointsFor(r.rank) : null })),
    updatedAt: new Date(now).toISOString(),
  };
}

// il parser dei risultati è specifico del salto (punti e distanze, non tempi)
export const parseResultsFor = parseJumpResults;
