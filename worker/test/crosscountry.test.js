import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseCalendar, parseEventDetails } from '../src/sources/fis/common.js';
import * as cc from '../src/sources/fis/crosscountry.js';
import { makeFisUpdater } from '../src/updaters/fis.js';

const fx = (n) => gunzipSync(readFileSync(new URL(`./fixtures/crosscountry/${n}.gz`, import.meta.url))).toString('utf8');
const NOW = Date.parse('2026-11-22T16:30:00Z');

test('nomi delle gare in italiano', () => {
  const m = (t, c, g) => cc.mapDiscipline(t, c, g).disciplineName;
  assert.equal(m('10km Interval Start Classic'), '10 km individuale, tecnica classica');
  assert.equal(m('20km Mass Start Free'), '20 km mass start, tecnica libera');
  assert.equal(m('20km Skiathlon Classic/Free'), 'Skiathlon 20 km');
  assert.equal(m('1.2km Sprint Final Classic'), 'Sprint, tecnica classica');
  assert.equal(m('2x4.5km Team Sprint Classic'), 'Team sprint, tecnica classica');
  assert.equal(m('4x7.5km Relay Classic/Free'), 'Staffetta 4×7,5 km');
  assert.equal(m('4x5km Relay Classic/Free', '', 'X'), 'Staffetta mista 4×5 km');
  assert.equal(m('10km Mass Start Free', 'Final Climb'), '10 km mass start, tecnica libera – Final Climb');
  assert.equal(m('10km Pursuit Free'), '10 km inseguimento, tecnica libera');
});

test('calendario fondo: Tour de Ski (classifica) escluso, Mondiali di Falun', () => {
  const ev = parseCalendar(fx('calendar-wc.html'));
  assert.equal(ev.length, 13);
  assert.equal(ev.filter(cc.isRealEvent).length, 12);
  assert.equal(cc.placeName(ev.find((e) => e.eventId === '63008').place), 'Dobbiaco');
  const wsc = parseCalendar(fx('calendar-wsc.html'));
  assert.deepEqual([wsc[0].place, wsc[0].start, wsc[0].end], ['Falun', '2027-02-24', '2027-03-08']);
});

test('tappa Ruka: qualificazioni sprint escluse', () => {
  const d = parseEventDetails(fx('event-ruka-2025.html'));
  const real = d.races.filter(cc.isRealRace);
  assert.equal(d.races.length, 8);
  assert.equal(real.length, 6);
  const ev = { eventId: '58060', place: 'Ruka', nation: 'FIN' };
  const races = real.map((x) => cc.toRace(x, ev, 'WC', NOW));
  assert.deepEqual(races.map((r) => r.discipline), ['IND', 'IND', 'SPR', 'SPR', 'MS', 'MS']);
  // 11:30 a Ruka (UTC+2) = 09:30 UTC = 10:30 in Italia
  assert.equal(races[0].startUtc, '2025-11-28T09:30:00.000Z');
});

test('Tour de Ski: tappe con badge e punti dedicati', () => {
  const d = parseEventDetails(fx('event-fiemme-2026.html'));
  const ev = { eventId: '58074', place: 'Val Di Fiemme', nation: 'ITA' };
  const races = d.races.filter(cc.isRealRace).map((x) => cc.toRace(x, ev, 'WC', NOW));
  assert.equal(races.length, 4);
  assert.ok(races.every((r) => r.series === 'Tour de Ski' && r.competition === 'WC' && r.location === 'Val di Fiemme'));
  assert.ok(races.some((r) => r.disciplineName.endsWith('Final Climb')));
  const p = cc.parseCcResults(fx('result-mass-start.html'));
  const res = cc.toResult(p, { competition: 'WC', series: 'Tour de Ski', status: 'finished' }, NOW);
  assert.deepEqual(res.rows.slice(0, 3).map((r) => r.cupPoints), [50, 46, 43]);
});

test('Mondiali: gare con data e orario da definire', () => {
  const d = parseEventDetails(fx('event-falun-wsc.html'));
  const ev = { eventId: '63107', place: 'Falun', nation: 'SWE' };
  const races = d.races.filter(cc.isRealRace).map((x) => cc.toRace(x, ev, 'WSC', NOW));
  assert.equal(races.length, 14);
  assert.ok(races.every((r) => r.competition === 'WSC' && r.timeTbc));
});

test('risultato sprint: batterie come classificati', () => {
  const p = cc.parseCcResults(fx('result-sprint.html'));
  assert.deepEqual(p.rows.slice(0, 2).map((r) => [r.rank, r.name, r.extra.phase]),
    [[1, 'SKISTAD Kristine Stavaas', 'Finale'], [2, 'SUNDLING Jonna', 'Finale']]);
  assert.equal(p.rows[6].extra.phase, 'Semifinale');
  assert.ok(p.rows.filter((r) => r.rank).length > 60);
  assert.ok(p.rows.some((r) => r.status === 'DSQ'));
  const res = cc.toResult(p, { competition: 'WC', status: 'finished' }, NOW);
  assert.deepEqual(res.rows.slice(0, 3).map((r) => r.cupPoints), [100, 80, 60]);
  assert.deepEqual(res.columns, ['phase']);
});

test('risultato individuale e mass start', () => {
  const p = cc.parseCcResults(fx('result-interval.html'));
  assert.deepEqual([p.rows[0].rank, p.rows[0].name, p.rows[0].time, p.rows[0].gap], [1, 'KARLSSON Frida', '25:31.8', null]);
  assert.deepEqual([p.rows[1].time, p.rows[1].gap], ['25:42.3', '+10.5']);
  const m = cc.parseCcResults(fx('result-mass-start.html'));
  assert.equal(m.rows.filter((r) => r.status === 'DNF').length > 0, true);
});

test('team sprint e staffetta mista con i frazionisti', () => {
  const t = cc.parseCcResults(fx('result-team-sprint.html'));
  assert.equal(t.isTeam, true);
  assert.deepEqual([t.rows[0].name, t.rows[0].time, t.rows[0].members.length], ['SWEDEN I', '15:34.77', 2]);
  assert.equal(t.rows[1].gap, '+3.26');
  const r = cc.parseCcResults(fx('result-mixed-relay.html'));
  assert.deepEqual(r.rows[0].members.map((m) => m.name), ['BURMAN Jens', 'RIBOM Emma', 'ANGER Edvin', 'ILAR Moa']);
  const res = cc.toResult(r, { competition: 'WC', status: 'finished' }, NOW);
  assert.ok(res.rows.every((x) => x.cupPoints === null));
  assert.equal(res.isRelay, true);
});

function memoryKv() {
  const m = new Map();
  return { m, async get(k, t) { const v = m.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); } };
}

test('updater fondo end-to-end', async () => {
  const kv = memoryKv();
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url.includes('calendar-results') && url.includes('categorycode=WC')) return new Response(fx('calendar-wc.html'));
      if (url.includes('calendar-results')) return new Response(fx('calendar-wsc.html'));
      if (url.includes('event-details')) return new Response('<html></html>');
      return new Response('', { status: 404 });
    };
    const r = await makeFisUpdater(cc)({ kv, now: NOW, state: {}, budget: { fis: { details: 3, results: 3 } } });
    assert.equal(r.stats.events, 13); // 12 tappe + Falun
    assert.equal(r.stats.pending, true);
  } finally {
    globalThis.fetch = real;
  }
});
