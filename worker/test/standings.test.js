import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseCupStandings, withGaps } from '../src/sources/fis/common.js';
import { parseJumpResults } from '../src/sources/fis/jumping.js';

const fx = (n) => gunzipSync(readFileSync(new URL(`./fixtures/standings/${n}.gz`, import.meta.url))).toString('utf8');

test('classifica di Coppa alpina femminile (con la leader evidenziata da FIS)', () => {
  const s = parseCupStandings(fx('alpine-women.html'));
  assert.deepEqual(Object.keys(s).sort(), ['ALL', 'GS', 'SL']);
  assert.deepEqual(s.ALL.slice(0, 2).map((r) => [r.rank, r.name, r.nation, r.points]), [[1, 'COLTURI Lara', 'ALB', 260], [2, 'AICHER Emma', 'GER', 192]]);
  assert.deepEqual(withGaps(s.ALL).slice(0, 2).map((r) => r.gap), [null, 68]);
});

test('se la Coppa del Mondo non ha ancora classifica, FIS mostra un\'altra coppa: ignorata', () => {
  assert.deepEqual(parseCupStandings(fx('crosscountry-not-wc.html')), {});
});

test('classifica della Tournée dei 4 trampolini (stagione scorsa)', () => {
  const p = parseJumpResults(fx('fourhills-2026-men.html'));
  assert.match(p.title, /Overall Standings/);
  assert.ok(p.rows.length > 30);
  assert.equal(p.rows[1].name, 'HOERL Jan');
  assert.equal(p.rows[1].points, 1153.3);
  assert.equal(p.rows[1].gap, '-42.3');
});
