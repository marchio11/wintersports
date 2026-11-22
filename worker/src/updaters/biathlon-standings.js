// Classifiche di Coppa del Mondo del biathlon, calcolate sommando i punti WC delle singole gare
// (il sito IBU non le include nelle pagine pubbliche). Contano solo le gare individuali di Coppa.
import { KEYS, SPORTS } from '../schema.js';
import { getJson } from '../store.js';

const CUPS = [
  { code: 'ALL', label: 'Generale', disciplines: ['IN', 'SI', 'SP', 'PU', 'MS'] },
  { code: 'SP', label: 'Sprint', disciplines: ['SP'] },
  { code: 'PU', label: 'Inseguimento', disciplines: ['PU'] },
  { code: 'IN', label: 'Individuale', disciplines: ['IN', 'SI'] },
  { code: 'MS', label: 'Mass start', disciplines: ['MS'] },
];
const GENDERS = [['M', 'Uomini'], ['F', 'Donne']];

export async function computeBiathlonStandings(kv, races, now) {
  const counted = races.filter((r) => r.competition === 'WC' && r.hasResults && r.status === 'finished' &&
    ['IN', 'SI', 'SP', 'PU', 'MS'].includes(r.discipline) && (r.gender === 'M' || r.gender === 'F'));
  const results = await Promise.all(counted.map((r) => getJson(kv, KEYS.result(r.id))));
  const standings = [];
  for (const [g, gLabel] of GENDERS) {
    for (const cup of CUPS) {
      const totals = new Map();
      let races = 0;
      counted.forEach((r, i) => {
        if (r.gender !== g || !cup.disciplines.includes(r.discipline) || !results[i]) return;
        races++;
        for (const row of results[i].rows) {
          if (!row.cupPoints) continue;
          const id = row.athleteId || row.name;
          const t = totals.get(id) || { athleteId: row.athleteId, name: row.name, nation: row.nation, points: 0 };
          t.points += row.cupPoints;
          totals.set(id, t);
        }
      });
      const rows = [...totals.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
      let rank = 0;
      rows.forEach((r, i) => {
        rank = i > 0 && rows[i - 1].points === r.points ? rank : i + 1;
        r.rank = rank;
        r.gap = rank > 1 ? rows[0].points - r.points : null;
      });
      standings.push({ id: `${cup.code}-${g}`, label: cup.label, gender: g, genderLabel: gLabel, discipline: cup.code, races, rows });
    }
  }
  return { sport: SPORTS.BIATHLON, source: 'calcolata', updatedAt: new Date(now).toISOString(), standings };
}
