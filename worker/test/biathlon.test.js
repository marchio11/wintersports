import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseCalendarPage, parseResultPage, mapStatus, disciplineInfo, extractNextData,
} from '../src/sources/biathlon.js';
import { mergeRace, raceIdsNeedingResults, updateBiathlon } from '../src/updaters/biathlon.js';
import { isRaceDay } from '../src/scheduler.js';
import { romeDateKey } from '../src/time.js';

const fx = (n) => readFileSync(new URL(`./fixtures/biathlon/${n}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-22T14:00:00Z');

test('calendario: tappe della stagione e gare della tappa corrente', () => {
  const { season, events, races } = parseCalendarPage(fx('calendar.html'), NOW);
  assert.equal(season, '2627');
  assert.equal(events.length, 11);
  assert.equal(events[0].location, 'Kontiolahti');
  const wch = events.find((e) => e.competition === 'WSC');
  assert.equal(wch.location, 'Otepää');
  assert.equal(events.find((e) => e.eventId === 'BT2627SWRLCP06').location, 'Anterselva');
  assert.equal(races.length, 6);
  const r = races[0];
  assert.equal(r.id, 'ibu-BT2627SWRLCP01SMIN');
  assert.equal(r.sport, 'biathlon');
  assert.equal(r.gender, 'M');
  assert.equal(r.discipline, 'IN');
  assert.equal(r.disciplineName, 'Individuale 20 km');
  assert.equal(r.startUtc, '2026-11-26T15:15:00.000Z');
  assert.equal(r.status, 'scheduled');
  assert.equal(r.competition, 'WC');
  assert.equal(races.find((x) => x.source.raceId.endsWith('MXSR')).disciplineName, 'Single mixed relay');
  assert.equal(races.find((x) => x.source.raceId.endsWith('MXRL')).gender, 'X');
});

test('orario in ora italiana', () => {
  // 15:15 UTC a fine novembre = 16:15 a Roma
  const t = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })
    .format(new Date('2026-11-26T15:15:00Z'));
  assert.equal(t, '16:15');
  assert.equal(romeDateKey('2026-11-26T23:30:00Z'), '2026-11-27');
});

test('risultato individuale (inseguimento)', () => {
  const { race, result } = parseResultPage(fx('result-pursuit.html'), NOW);
  assert.equal(race.status, 'finished');
  assert.equal(race.location, 'Oslo Holmenkollen');
  assert.equal(race.disciplineName, 'Inseguimento 12,5 km');
  assert.equal(result.isRelay, false);
  assert.equal(result.rows.length, 60);
  const [first, second, third] = result.rows;
  assert.deepEqual([first.rank, first.name, first.nation, first.time, first.gap, first.cupPoints],
    [1, 'LAEGREID Sturla Holm', 'NOR', '30:31.4', null, 90]);
  assert.equal(first.extra.shooting, '0+0+0+0');
  assert.equal(second.rank, 2);
  assert.equal(third.gap, '+1:11.2');
  assert.equal(third.extra.penalties, '2');
});

test('risultato staffetta: squadre con frazionisti', () => {
  const { result } = parseResultPage(fx('result-relay.html'), NOW);
  assert.equal(result.isRelay, true);
  const swe = result.rows[0];
  assert.equal(swe.name, 'SWEDEN');
  assert.equal(swe.members.length, 4);
  assert.equal(swe.members[2].name, 'OEBERG Hanna');
  assert.equal(result.rows[1].gap, '+40.6');
  const dns = result.rows.find((r) => r.status === 'DNS');
  assert.ok(dns);
  assert.equal(dns.rank, null);
});

test('gara futura: orario senza classifica', () => {
  const { race, result } = parseResultPage(fx('result-scheduled.html'), NOW);
  assert.equal(result, null);
  assert.equal(race.location, 'Anterselva');
  assert.equal(race.gender, 'F');
  assert.equal(race.startUtc, '2027-01-17T14:00:00.000Z');
});

test('stati', () => {
  const base = { StartTime: '2026-11-26T15:15:00Z' };
  assert.equal(mapStatus({ ...base, StatusText: 'Scheduled' }, NOW), 'scheduled');
  assert.equal(mapStatus({ ...base, StatusText: 'Cancelled' }, NOW), 'cancelled');
  assert.equal(mapStatus({ ...base, StatusId: 11, StatusText: 'Final' }, NOW), 'finished');
  assert.equal(mapStatus({ ...base, IsLive: true }, NOW), 'live');
  assert.equal(mapStatus({ ...base, StatusText: 'Scheduled' }, Date.parse('2026-11-26T16:00:00Z')), 'live');
  assert.equal(disciplineInfo('BT2627SWRLCP01SWRL').disciplineName, 'Staffetta');
});

test('pagina non valida → errore (si mantiene l\'ultimo dato valido)', () => {
  assert.throws(() => extractNextData('<html>manutenzione</html>'));
  assert.throws(() => parseCalendarPage('<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"eventInitialState":{"events":[]}}}}</script>'));
});

test('merge e priorità dei risultati', () => {
  const { races } = parseCalendarPage(fx('calendar.html'), NOW);
  const old = { ...races[0], hasResults: true, status: 'finished' };
  const merged = mergeRace(old, { ...races[0], status: 'live' });
  assert.equal(merged.status, 'finished');
  assert.equal(merged.hasResults, true);
  const later = Date.parse('2026-11-27T18:00:00Z');
  const ids = raceIdsNeedingResults(races, later);
  assert.deepEqual(ids, ['BT2627SWRLCP01SWIN', 'BT2627SWRLCP01SMIN']);
  assert.equal(isRaceDay(races, Date.parse('2026-11-26T08:00:00Z')), true);
  assert.equal(isRaceDay(races, NOW), false);
});

// KV finta in memoria
function memoryKv() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
  };
}

test('updater: in caso di errore della fonte non cancella i dati salvati', async () => {
  const kv = memoryKv();
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url.endsWith('/calendar')) return new Response(fx('calendar.html'), { status: 200 });
      return new Response('', { status: 500 });
    };
    const ctx = { kv, now: NOW, state: {}, budget: { results: 4, probes: 14 } };
    const r1 = await updateBiathlon(ctx);
    assert.equal(r1.stats.calendarWritten, true);
    const saved = JSON.parse(kv.m.get('cal:biathlon'));
    assert.equal(saved.length, 6);

    // la fonte ora è "rotta": il calendario salvato resta intatto
    globalThis.fetch = async () => new Response('<html>errore</html>', { status: 200 });
    const r2 = await updateBiathlon({ ...ctx, state: ctx.state });
    assert.ok(r2.error);
    assert.equal(JSON.parse(kv.m.get('cal:biathlon')).length, 6);
  } finally {
    globalThis.fetch = realFetch;
  }
});
