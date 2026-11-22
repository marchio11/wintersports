import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseCalendar, parseEventDetails, parseResults, parseDateRange, decode } from '../src/sources/fis/common.js';
import * as alpine from '../src/sources/fis/alpine.js';
import { makeFisUpdater, pickEvents } from '../src/updaters/fis.js';

const fx = (n) => gunzipSync(readFileSync(new URL(`./fixtures/alpine/${n}.gz`, import.meta.url))).toString('utf8');
const NOW = Date.parse('2026-11-22T15:00:00Z');

test('date delle tappe FIS', () => {
  assert.deepEqual(parseDateRange('24-25 Oct 2026'), { start: '2026-10-24', end: '2026-10-25' });
  assert.deepEqual(parseDateRange('22 Dec 2026'), { start: '2026-12-22', end: '2026-12-22' });
  assert.deepEqual(parseDateRange('30 Nov-01 Dec 2026'), { start: '2026-11-30', end: '2026-12-01' });
  assert.deepEqual(parseDateRange('28 Dec 2026-02 Jan 2027'), { start: '2026-12-28', end: '2027-01-02' });
  assert.equal(decode('Val d&#39;Isere'), "Val d'Isere");
});

test('calendario Coppa del Mondo e Mondiali', () => {
  const wc = parseCalendar(fx('calendar-wc.html'));
  assert.equal(wc.length, 37);
  assert.deepEqual(wc[0], { eventId: '62771', place: 'Soelden', nation: 'AUT', start: '2026-10-24', end: '2026-10-25', cancelled: false });
  assert.equal(wc.find((e) => e.eventId === '62941').place, 'Val Gardena-Groeden Südtirol');
  const wsc = parseCalendar(fx('calendar-wsc.html'));
  assert.equal(wsc.length, 1);
  assert.equal(alpine.placeName(wsc[0].place), 'Crans-Montana');
  assert.equal(wsc[0].start, '2027-02-01');
});

test('tappa conclusa (Gurgl): due slalom con orari e manche', () => {
  const d = parseEventDetails(fx('event-gurgl.html'));
  assert.equal(d.races.length, 2);
  const men = d.races[1];
  assert.equal(men.raceId, '131582');
  assert.equal(men.discipline, 'Slalom');
  assert.equal(men.category, 'WC');
  assert.deepEqual(men.genders, ['M']);
  assert.equal(men.timezone, 'Europe/Vienna');
  assert.equal(men.runs.length, 2);
  assert.equal(men.runs[1].status, 'Official results');
  assert.equal(men.dataAvailable, true);

  const ev = { eventId: '62773', place: 'Gurgl', nation: 'AUT' };
  const race = alpine.toRace(men, ev, 'WC', NOW);
  assert.equal(race.id, 'fis-al-131582');
  assert.equal(race.disciplineName, 'Slalom');
  assert.equal(race.gender, 'M');
  assert.equal(race.startUtc, '2026-11-22T09:30:00.000Z'); // 10:30 locali (UTC+1)
  assert.equal(race.status, 'finished');
  assert.equal(race.hasResults, false);
  assert.equal(race.resultsAvailable, true);
  assert.equal(race.runs[1].startUtc, '2026-11-22T12:30:00.000Z');
});

test('tappa futura (Beaver Creek): prove escluse, fuso di Denver', () => {
  const d = parseEventDetails(fx('event-beaver-creek.html'));
  assert.equal(d.races.length, 6);
  const real = d.races.filter(alpine.isRealRace);
  assert.equal(real.length, 4);
  const ev = { eventId: '62939', place: 'Beaver Creek', nation: 'USA' };
  const races = real.map((x) => alpine.toRace(x, ev, 'WC', NOW));
  assert.deepEqual(races.map((r) => r.discipline), ['DH', 'DH', 'SG', 'GS']);
  // 11:00 a Denver (UTC-7) = 18:00 UTC = 19:00 in Italia
  assert.equal(races[0].startUtc, '2026-12-03T18:00:00.000Z');
  assert.equal(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })
    .format(new Date(races[0].startUtc)), '19:00');
  assert.ok(races.every((r) => r.status === 'scheduled' && !r.hasResults));
});

test('risultato slalom: due manche, classificati e non classificati', () => {
  const p = parseResults(fx('result-slalom.html'));
  const classified = p.rows.filter((r) => r.rank);
  const first = p.rows[0];
  assert.deepEqual([first.rank, first.name, first.nation, first.time, first.gap, first.cupPoints],
    [1, 'HAUGAN Timon', 'NOR', '1:42.55', null, 100]);
  assert.deepEqual(first.extra.runs, ['53.65', '48.90']);
  assert.equal(p.rows[1].gap, '+0.60');
  assert.equal(p.rows[1].cupPoints, 80);
  const dnf = p.rows.filter((r) => r.status === 'DNF');
  assert.ok(dnf.length > 0);
  assert.ok(dnf.every((r) => r.rank === null && r.time === null));
  assert.ok(p.rows.some((r) => r.status === 'DSQ'));
  assert.ok(p.rows.some((r) => r.status === 'DNS'));
  assert.ok(classified.length >= 20);
  const res = alpine.toResult(p, { id: 'fis-al-131582', status: 'finished' }, NOW);
  assert.deepEqual(res.columns, ['run1', 'run2']);
  assert.deepEqual(res.rows[0].extra, { run1: '53.65', run2: '48.90' });
});

test('risultato discesa: una manche', () => {
  const p = parseResults(fx('result-downhill.html'));
  const [a, b] = p.rows;
  assert.deepEqual([a.rank, a.name, a.nation, a.time, a.gap, a.cupPoints], [1, 'FRANZONI Giovanni', 'ITA', '1:52.31', null, 100]);
  assert.deepEqual([b.rank, b.gap, b.cupPoints], [2, '+0.07', 80]);
  assert.deepEqual(alpine.toResult(p, { status: 'finished' }, NOW).columns, []);
});

test('pagina rotta → errore (si tiene l\'ultimo dato)', () => {
  assert.throws(() => parseCalendar('<html>manutenzione</html>'));
  assert.throws(() => parseEventDetails('<html></html>'));
  assert.equal(parseResults('<html>no results</html>'), null);
});

test('priorità delle tappe da aggiornare', () => {
  const events = parseCalendar(fx('calendar-wc.html'));
  const picked = pickEvents(events, {}, NOW, 3);
  // prima le tappe "calde" (in corso o nei prossimi 7 giorni): Gurgl, Killington, Copper
  assert.deepEqual(picked.map((e) => e.eventId), ['62773', '62774', '62938']);
  const later = pickEvents(events, { 62773: NOW, 62774: NOW, 62938: NOW }, NOW + 60e3, 2);
  assert.equal(later.length, 2);
  assert.ok(!later.some((e) => ['62773', '62774', '62938'].includes(e.eventId)));
});

function memoryKv() {
  const m = new Map();
  return { m, async get(k, t) { const v = m.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); } };
}

test('updater alpino end-to-end con pagine salvate', async () => {
  const kv = memoryKv();
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url.includes('calendar-results') && url.includes('categorycode=WC')) return new Response(fx('calendar-wc.html'));
      if (url.includes('calendar-results')) return new Response(fx('calendar-wsc.html'));
      if (url.includes('eventid=62773')) return new Response(fx('event-gurgl.html'));
      if (url.includes('eventid=62939')) return new Response(fx('event-beaver-creek.html'));
      if (url.includes('event-details')) return new Response('<html>vuota</html>');
      if (url.includes('raceid=131582') || url.includes('raceid=131581')) return new Response(fx('result-slalom.html'));
      return new Response('', { status: 404 });
    };
    const update = makeFisUpdater(alpine);
    const state = {};
    const r = await update({ kv, now: NOW, state, budget: { fis: { details: 3, results: 3 } } });
    assert.equal(r.stats.events, 38);
    assert.equal(r.stats.pending, true);
    const cal = JSON.parse(kv.m.get('cal:alpine'));
    assert.ok(cal.some((x) => x.id === 'fis-al-131582' && x.status === 'finished' && x.hasResults));
    assert.ok(kv.m.has('res:fis-al-131582'));
    const res = JSON.parse(kv.m.get('res:fis-al-131582'));
    assert.equal(res.race.location, 'Gurgl');
    assert.equal(res.rows[0].name, 'HAUGAN Timon');

    // se FIS si rompe, il calendario salvato resta
    globalThis.fetch = async () => new Response('<html>errore</html>');
    state.alpine.calendarAt = 0;
    const r2 = await update({ kv, now: NOW + 3600e3, state, budget: { fis: { details: 3, results: 3 } } });
    assert.ok(r2.error);
    assert.equal(JSON.parse(kv.m.get('cal:alpine')).length, cal.length);
  } finally {
    globalThis.fetch = real;
  }
});
