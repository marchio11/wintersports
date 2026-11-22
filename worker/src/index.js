// Worker: API JSON + cron di aggiornamento + file statici della PWA (cartella web/,
// incorporati a ogni build da scripts/build-static.mjs).

import { KEYS, ALL_SPORTS, SEASON, sortRaces } from './schema.js';
import { getJson } from './store.js';
import { runTick } from './scheduler.js';
import { serveStatic } from './assets.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(body, status = 200, maxAge = 60) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? `public, max-age=${maxAge}` : 'no-store',
    },
  });
}

async function calendar(env) {
  const [health, ...cals] = await Promise.all([
    getJson(env.KV, KEYS.health, {}),
    ...ALL_SPORTS.map((s) => getJson(env.KV, KEYS.calendar(s), [])),
  ]);
  const sources = {};
  ALL_SPORTS.forEach((s, i) => {
    sources[s] = health[s]
      ? { ok: health[s].ok, updatedAt: health[s].updatedAt || null, error: health[s].error || undefined }
      : { ok: false, updatedAt: null, error: cals[i].length ? undefined : 'non ancora disponibile' };
  });
  return {
    season: SEASON,
    generatedAt: new Date().toISOString(),
    sources,
    races: sortRaces(cals.flat()),
  };
}

function authorized(request, env) {
  const h = request.headers.get('Authorization') || '';
  return !!env.ADMIN_TOKEN && h === `Bearer ${env.ADMIN_TOKEN}`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // Avvio manuale di un aggiornamento (protetto da token)
    if (path === '/admin/run' && request.method === 'POST') {
      if (!authorized(request, env)) return json({ error: 'non autorizzato' }, 401);
      const result = await runTick(env, { force: true });
      return json(result, 200, 0);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'metodo non consentito' }, 405);

    if (path === '/calendar' || path === '/api/calendar') {
      return json(await calendar(env));
    }

    let m = path.match(/^\/(?:api\/)?results\/([\w-]+)$/);
    if (m) {
      const res = await getJson(env.KV, KEYS.result(m[1]));
      return res ? json(res) : json({ error: 'risultato non disponibile', raceId: m[1] }, 404);
    }

    m = path.match(/^\/(?:api\/)?standings\/(\w+)$/);
    if (m) {
      if (!ALL_SPORTS.includes(m[1])) return json({ error: 'sport sconosciuto' }, 404);
      const std = await getJson(env.KV, KEYS.standings(m[1]));
      return std ? json(std) : json({ error: 'classifica non ancora disponibile', sport: m[1] }, 404);
    }

    if (path === '/health' || path === '/api/health') {
      const [health, state] = await Promise.all([getJson(env.KV, KEYS.health, {}), getJson(env.KV, KEYS.state, {})]);
      return json({ health, lastWorkAt: state.lastWorkAt ? new Date(state.lastWorkAt).toISOString() : null }, 200, 0);
    }

    // Tutto il resto: file statici della PWA
    return serveStatic(request) || new Response('Pagina non trovata', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTick(env, { now: event.scheduledTime }).then((r) => {
      console.log('tick', JSON.stringify({ skipped: r.skipped, raceDay: r.raceDay,
        report: r.report && Object.fromEntries(Object.entries(r.report).map(([k, v]) => [k, { ok: v.ok, error: v.error, stats: v.stats }])) }));
    }));
  },
};
