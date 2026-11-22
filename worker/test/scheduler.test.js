import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inRaceWindow, runTick } from '../src/scheduler.js';
import worker from '../src/index.js';
import { computeBiathlonStandings } from '../src/updaters/biathlon-standings.js';

const H = 3600e3;
const race = (start, extra = {}) => ({ id: 'x', startUtc: new Date(start).toISOString(), timeTbc: false, status: 'scheduled', hasResults: false, ...extra });

test('finestra di gara: da 15 minuti prima a risultati salvati (max 4 ore)', () => {
  const t = Date.parse('2026-11-26T15:15:00Z');
  assert.equal(inRaceWindow([race(t)], t - 30 * 60e3), false);
  assert.equal(inRaceWindow([race(t)], t - 10 * 60e3), true);
  assert.equal(inRaceWindow([race(t, { status: 'live' })], t + H), true);
  assert.equal(inRaceWindow([race(t, { status: 'finished', hasResults: true })], t + H), false);
  assert.equal(inRaceWindow([race(t, { status: 'finished' })], t + 2 * H), true); // risultati non ancora arrivati
  assert.equal(inRaceWindow([race(t)], t + 5 * H), false);
  assert.equal(inRaceWindow([race(t, { timeTbc: true })], t), false);
  assert.equal(inRaceWindow([race(t, { status: 'cancelled' })], t), false);
});

function memoryKv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)]));
  return { m, async get(k, t) { const v = m.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); } };
}

test('fuori dalle gare il cron lavora solo ogni ~3 ore', async () => {
  const now = Date.parse('2026-11-23T10:00:00Z');
  const state = { lastWorkAt: now - H, biathlon: { sweepDoneAt: now - H }, pending: {} };
  const kv = memoryKv({ 'meta:state': state });
  const r = await runTick({ KV: kv }, { now, log: () => {} });
  assert.equal(r.skipped, true);
});

test('pulsante Aggiorna: al massimo ogni 5 minuti', async () => {
  const kv = memoryKv({ 'meta:state': { lastWorkAt: Date.now() - 60e3 } });
  const res = await worker.fetch(new Request('https://x/refresh', { method: 'POST' }), { KV: kv }, {});
  const body = await res.json();
  assert.equal(body.refreshed, false);
  assert.ok(body.retryAfterSec > 0 && body.retryAfterSec <= 300);
});

test('classifiche biathlon calcolate dai punti WC (solo gare individuali di Coppa)', async () => {
  const mk = (id, discipline, gender, competition = 'WC') => ({ id, discipline, gender, competition, hasResults: true, status: 'finished' });
  const races = [mk('a', 'SP', 'F'), mk('b', 'PU', 'F'), mk('c', 'RL', 'F'), mk('d', 'SP', 'F', 'WSC')];
  const row = (name, nation, cupPoints) => ({ athleteId: `ibu-${name}`, name, nation, cupPoints });
  const kv = memoryKv({
    'res:a': { rows: [row('WIERER Dorothea', 'ITA', 90), row('OEBERG Elvira', 'SWE', 75)] },
    'res:b': { rows: [row('OEBERG Elvira', 'SWE', 90), row('WIERER Dorothea', 'ITA', 65)] },
    'res:c': { rows: [row('ITALY', 'ITA', 90)] },
    'res:d': { rows: [row('OEBERG Elvira', 'SWE', 90)] },
  });
  const std = await computeBiathlonStandings(kv, races, Date.now());
  const overall = std.standings.find((s) => s.id === 'ALL-F');
  assert.deepEqual(overall.rows.map((r) => [r.rank, r.name, r.points, r.gap]),
    [[1, 'OEBERG Elvira', 165, null], [2, 'WIERER Dorothea', 155, 10]]);
  assert.equal(overall.races, 2);
  const sprint = std.standings.find((s) => s.id === 'SP-F');
  assert.equal(sprint.rows[0].name, 'WIERER Dorothea');
});
