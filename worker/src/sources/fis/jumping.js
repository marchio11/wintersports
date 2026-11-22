// Salto con gli sci (FIS sector JP): mappe specifiche e conversione nel formato comune.
// Nota: le pagine FIS non riportano l'HS (hill size), che si prende dalla tabella HILL_SIZES.
import { SPORTS } from '../../schema.js';
import { urls, startOf, resultRows, headerInfo, decode, cupPointsFor, parseEventDetails } from './common.js';
import { fetchText } from '../../http.js';
import { statusOf } from './alpine.js';

export const SECTOR = 'JP';
export const SPORT = SPORTS.JUMPING;
export const SEASON_CODE = '2027';
export const CATEGORIES = ['WC', 'WSC'];
export const STANDING_LABELS = {
  ALL: 'Generale', SF: 'Volo', FL: 'Volo', RA: 'Raw Air', RAW: 'Raw Air', TNT: 'Two Nights Tour',
};

const HILLS = [
  [/flying hill|ski flying/i, 'FH', 'trampolino per il volo'],
  [/large hill/i, 'LH', 'trampolino grande'],
  [/normal hill/i, 'NH', 'trampolino normale'],
];

// Hill size dei trampolini della stagione 2026/27 (fonte: documenti FIS, via Wikipedia).
// Chiave: località (come mostrata nell'app) → { NH | LH | FH: HS }. Da aggiornare se cambia un trampolino.
export const HILL_SIZES = {
  'Lillehammer': { LH: 140 },
  'Ruka': { LH: 142 },
  'Hinzenbach': { NH: 90 },
  'Wisła': { LH: 134 },
  'Titisee-Neustadt': { LH: 142 },
  'Engelberg': { LH: 140 },
  'Oberstdorf': { LH: 137 },
  'Garmisch-Partenkirchen': { LH: 142 },
  'Innsbruck': { LH: 128 },
  'Bischofshofen': { LH: 142 },
  'Ljubno': { NH: 94, LH: 94 },
  'Zhangjiakou': { LH: 140 },
  'Zakopane': { LH: 140 },
  'Zaō': { NH: 102, LH: 102 },
  'Sapporo': { LH: 137 },
  'Willingen': { LH: 147 },
  'Lake Placid': { LH: 128 },
  'Lahti': { LH: 130 },
  'Vikersund': { FH: 240 },
  'Villach': { NH: 98 },
  'Oslo Holmenkollen': { LH: 134 },
  'Planica': { FH: 240 },
};

export function hillSize(place, hillCode) {
  return HILL_SIZES[place]?.[hillCode] ?? null;
}

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
  const mapped = mapDiscipline(d.discipline, gender);
  const location = placeName(event.place);
  const hillCode = HILLS.find(([re]) => re.test(d.discipline))?.[1];
  const hs = hillCode ? hillSize(location, hillCode) : null;
  const discipline = mapped.discipline;
  const disciplineName = hs ? `${mapped.disciplineName} HS${hs}` : mapped.disciplineName;
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
    hillSize: hs,
    location,
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

const DAY = 24 * 3600e3;
const FHT_LABEL = 'Tournée dei 4 trampolini';

/**
 * Classifica della Tournée dei 4 trampolini (Four Hills Tournament): FIS la pubblica
 * come "risultato" della pseudo-tappa "FIS Four Hills Tournament".
 */
export async function extraStandings({ now, st, stats, prev }) {
  const fht = Object.values(st.specialEvents || {}).find((e) => /four hills/i.test(e.place));
  if (!fht) return [];
  const old = [...prev.values()].filter((x) => x.group === 'fourhills');
  const start = Date.parse(`${fht.start}T00:00:00Z`);
  const end = Date.parse(`${fht.end}T23:59:59Z`);
  const meta = { group: 'fourhills', label: FHT_LABEL, start: fht.start, end: fht.end };
  const placeholder = (g, gl) => ({ id: `fourhills-${g}`, gender: g, genderLabel: gl, discipline: 'FHT', ...meta, rows: [] });
  const inWindow = now >= start - DAY && now <= end + 3 * DAY;
  if (!inWindow) {
    if (old.length) return old;
    return [placeholder('M', 'Uomini'), placeholder('F', 'Donne')];
  }
  const out = [];
  try {
    const ev = await fetchText(urls.event(SECTOR, fht.eventId, SEASON_CODE));
    stats.fetched++;
    const races = ev.ok ? parseEventDetails(ev.text).races : [];
    for (const [fisG, g, gl] of [['M', 'M', 'Uomini'], ['W', 'F', 'Donne']]) {
      const race = races.find((r) => r.genders.length === 1 && r.genders[0] === fisG);
      let rows = [];
      if (race) {
        const res = await fetchText(urls.results(SECTOR, race.raceId));
        stats.fetched++;
        const parsed = res.ok ? parseJumpResults(res.text) : null;
        if (parsed) {
          const best = parsed.rows[0]?.points;
          rows = parsed.rows.filter((r) => r.rank).map((r) => ({
            rank: r.rank, athleteId: r.athleteId, name: r.name, nation: r.nation, points: r.points,
            gap: r.rank > 1 && best != null && r.points != null ? Math.round((best - r.points) * 10) / 10 : null,
          }));
        }
      }
      const prevG = old.find((x) => x.gender === g);
      out.push(rows.length ? { ...placeholder(g, gl), rows } : (prevG || placeholder(g, gl)));
    }
  } catch {
    return old.length ? old : [placeholder('M', 'Uomini'), placeholder('F', 'Donne')];
  }
  return out;
}
