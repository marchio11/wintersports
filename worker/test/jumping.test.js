import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseCalendar, parseEventDetails } from '../src/sources/fis/common.js';
import * as jumping from '../src/sources/fis/jumping.js';
import { makeFisUpdater } from '../src/updaters/fis.js';

const fx = (n) => gunzipSync(readFileSync(new URL(`./fixtures/jumping/${n}.gz`, import.meta.url))).toString('utf8');
const NOW = Date.parse('2026-11-22T16:30:00Z');

test('calendario salto: date con a capo, Four Hills esclusa', () => {
  const ev = parseCalendar(fx('calendar-wc.html'));
  assert.equal(ev.length, 23);
  const gap = ev.find((e) => e.eventId === '63031');
  assert.deepEqual([gap.start, gap.end], ['2026-12-31', '2027-01-01']);
  assert.equal(ev.filter(jumping.isRealEvent).length, 22);
  const wsc = parseCalendar(fx('calendar-wsc.html'));
  assert.equal(wsc[0].place, 'Falun');
});

test('tappa Lillehammer: qualificazioni escluse, gara mista, gara in corso', () => {
  const d = parseEventDetails(fx('event-lillehammer.html'));
  assert.equal(d.races.length, 9);
  const real = d.races.filter(jumping.isRealRace);
  assert.equal(real.length, 5);
  const ev = { eventId: '63024', place: 'Lillehammer', nation: 'NOR' };
  const races = real.map((x) => jumping.toRace(x, ev, 'WC', NOW));
  const mixed = races.find((r) => r.source.raceId === '7794');
  assert.equal(mixed.gender, 'X');
  assert.equal(mixed.disciplineName, 'Gara a squadre mista, trampolino grande HS140');
  const w = races.find((r) => r.source.raceId === '7799');
  assert.equal(w.disciplineName, 'Trampolino grande HS140');
  assert.equal(w.hillSize, 140);
  assert.equal(w.discipline, 'LH');
  assert.equal(w.startUtc, '2026-11-21T13:35:00.000Z');
  assert.equal(w.status, 'finished');
  const live = races.find((r) => r.source.raceId === '7797');
  assert.equal(live.status, 'live'); // "In progress"
});

test('gare senza orario: data nota, orario da definire', () => {
  const d = parseEventDetails(fx('event-garmisch.html'));
  const ev = { eventId: '63031', place: 'Garmisch-Partenkirchen', nation: 'GER' };
  const races = d.races.filter(jumping.isRealRace).map((x) => jumping.toRace(x, ev, 'WC', NOW));
  assert.equal(races.length, 2);
  assert.ok(races.every((r) => r.timeTbc && r.status === 'scheduled'));
  assert.equal(races[0].startUtc.slice(0, 10), '2026-12-31');
});

test('risultato individuale: punti, distanze, punti Coppa calcolati', () => {
  const p = jumping.parseJumpResults(fx('result-individual.html'));
  const [a, b] = p.rows;
  assert.deepEqual([a.rank, a.name, a.nation, a.points, a.gap], [1, 'KVANDAL Eirin Maria', 'NOR', 281.5, null]);
  assert.deepEqual(a.extra.jumps.map((j) => j.distance), [135.5, 130]);
  assert.deepEqual(a.extra.jumps.map((j) => j.points), [149.3, 132.2]);
  assert.deepEqual([b.rank, b.points, b.gap], [2, 263.8, '-17.7']);
  const res = jumping.toResult(p, { competition: 'WC', status: 'finished' }, NOW);
  assert.equal(res.resultType, 'points');
  assert.deepEqual(res.rows.slice(0, 3).map((r) => r.cupPoints), [100, 80, 60]);
});

test('risultato gara a squadre mista', () => {
  const p = jumping.parseJumpResults(fx('result-mixed-team.html'));
  assert.equal(p.isTeam, true);
  const nor = p.rows[0];
  assert.deepEqual([nor.rank, nor.name, nor.nation, nor.points], [1, 'NORWAY', 'NOR', 1012.4]);
  assert.equal(nor.members.length, 4);
  assert.equal(nor.members[0].name, 'HANSEN Gyda Westvold');
  assert.deepEqual(nor.members[0].jumps.map((j) => j.distance), [141, 126]);
  assert.match(p.rows[1].gap, /^-\d/);
  const res = jumping.toResult(p, { competition: 'WC', status: 'finished' }, NOW);
  assert.ok(res.rows.every((r) => r.cupPoints === null)); // le gare a squadre non danno punti individuali
});

test('lista di partenza (gara in corso) → nessuna classifica', () => {
  assert.equal(jumping.parseJumpResults(fx('result-startlist.html')), null);
});

function memoryKv() {
  const m = new Map();
  return { m, async get(k, t) { const v = m.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); } };
}

test('updater salto end-to-end', async () => {
  const kv = memoryKv();
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url.includes('calendar-results') && url.includes('categorycode=WC')) return new Response(fx('calendar-wc.html'));
      if (url.includes('calendar-results')) return new Response(fx('calendar-wsc.html'));
      if (url.includes('eventid=63024')) return new Response(fx('event-lillehammer.html'));
      if (url.includes('event-details')) return new Response('<html></html>');
      if (url.includes('raceid=7799') || url.includes('raceid=7795') || url.includes('raceid=7800')) return new Response(fx('result-individual.html'));
      if (url.includes('raceid=7794')) return new Response(fx('result-mixed-team.html'));
      if (url.includes('raceid=7797')) return new Response(fx('result-startlist.html'));
      return new Response('', { status: 404 });
    };
    const update = makeFisUpdater(jumping);
    const state = {};
    const r = await update({ kv, now: NOW, state, budget: { fis: { details: 3, results: 5 } } });
    assert.equal(r.stats.events, 23); // 22 tappe + Falun
    const cal = JSON.parse(kv.m.get('cal:jumping'));
    assert.equal(cal.filter((x) => x.source.eventId === '63024').length, 5);
    assert.ok(kv.m.has('res:fis-jp-7794'));
    assert.ok(!kv.m.has('res:fis-jp-7797')); // in corso: solo lista di partenza
    assert.equal(cal.find((x) => x.id === 'fis-jp-7797').status, 'live');
  } finally {
    globalThis.fetch = real;
  }
});
