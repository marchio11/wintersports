// Vista Risultati: gare concluse per sport (dalla più recente), podio e classifica completa.
import { store, raceById } from '../app.js';
import { api } from '../api.js';
import { SPORTS, SPORT_ORDER, GENDERS, dayShort, time, flag, esc, athleteName, teamName } from '../format.js';
import { statusBadge } from './common.js';

const cache = new Map(); // raceId → risultato
export function clearResultsCache() { cache.clear(); }
const PAGE = 8;
const ui = { sport: null, shown: PAGE };

async function loadResult(id) {
  if (cache.has(id)) return cache.get(id);
  const r = await api.result(id);
  if (r.notFound) return null;
  cache.set(id, r.data);
  return r.data;
}

const isIta = (row) => row.nation === 'ITA' || row.members?.some((m) => m.nation === 'ITA');

function podium(res) {
  const top = res.rows.filter((r) => r.rank && r.rank <= 3).slice(0, 3);
  if (!top.length) return '<p class="empty small">Podio non disponibile</p>';
  return `<ol class="podium">${top.map((r) => `
    <li class="p${r.rank} ${isIta(r) ? 'ita' : ''}">
      <span class="medal">${['🥇', '🥈', '🥉'][r.rank - 1]}</span>
      <span class="who">${flag(r.nation)} ${esc(res.isRelay ? teamName(r) : athleteName(r.name))}</span>
      <span class="res">${res.resultType === 'points' ? (r.points != null ? `${fmtNum(r.points)} pt` : '') : esc(r.gap || r.time || '')}</span>
    </li>`).join('')}</ol>`;
}

const fmtNum = (n) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const jumpsText = (jumps) => jumps.filter((j) => j.distance != null)
  .map((j) => `${fmtNum(j.distance)} m${j.points != null ? ` (${fmtNum(j.points)})` : ''}`).join(' · ');

const STATUS_IT = { DNF: 'Non arrivato', DNS: 'Non partito', DSQ: 'Squalificato', DNQ: 'Non qualificato', LAP: 'Doppiato', NC: 'Non classificato' };

function statusLabel(r) {
  const run = /1st run/i.test(r.statusDetail || '') ? ' (1ª manche)' : /2nd run/i.test(r.statusDetail || '') ? ' (2ª manche)' : '';
  return (STATUS_IT[r.status] || r.status || '') + run;
}

function fullTable(res) {
  const showShoot = res.race.sport === 'biathlon';
  const showRuns = (res.columns || []).includes('run1');
  const points = res.resultType === 'points';
  let shownDivider = false;
  let lastPhase = null;
  const cols = 4 + (showShoot ? 1 : 0);
  const rows = res.rows.map((r) => {
    const members = res.isRelay && r.members?.length
      ? `<div class="members">${r.members.map((m) => `<span class="${m.nation === 'ITA' ? 'ita-txt' : ''}">${typeof m.leg === 'number' ? `${m.leg}. ` : ''}${esc(athleteName(m.name))}${m.shooting ? ` <small>(${esc(m.shooting)})</small>` : ''}${m.jumps?.length ? `<div class="runs">${jumpsText(m.jumps)}</div>` : ''}</span>`).join('')}</div>`
      : '';
    const jumps = !res.isRelay && r.extra?.jumps?.length ? `<div class="runs">${jumpsText(r.extra.jumps)}</div>` : '';
    const runs = showRuns && (r.extra?.run1 || r.extra?.run2)
      ? `<div class="runs">${r.extra.run1 ? `1ª ${esc(r.extra.run1)}` : ''}${r.extra.run2 ? ` · 2ª ${esc(r.extra.run2)}` : ''}</div>`
      : '';
    let divider = '';
    if (!r.rank && r.status && !shownDivider) {
      shownDivider = true;
      divider = `<tr class="divider"><td colspan="${cols}">Non classificati</td></tr>`;
    } else if (r.extra?.phase && r.extra.phase !== lastPhase) {
      divider = `<tr class="divider"><td colspan="${cols}">${esc(r.extra.phase)}</td></tr>`;
    }
    if (r.extra?.phase) lastPhase = r.extra.phase;
    return `${divider}<tr class="${isIta(r) ? 'ita' : ''}">
      <td class="pos">${r.rank ?? `<small title="${esc(statusLabel(r))}">${esc(r.status || '')}</small>`}</td>
      <td class="ath">${flag(r.nation)} <b>${esc(res.isRelay ? teamName(r) : athleteName(r.name))}</b> <small class="nat">${esc(r.nation)}</small>${members}${runs}${jumps}${!r.rank && r.status ? `<div class="runs">${esc(statusLabel(r))}</div>` : ''}</td>
      ${showShoot ? `<td class="sh"><small>${esc(r.extra?.shooting || '')}</small></td>` : ''}
      <td class="tm">${points ? `${r.points != null ? fmtNum(r.points) : ''}${r.gap ? `<div class="runs">${esc(r.gap.replace('.', ','))}</div>` : ''}` : (r.rank === 1 ? esc(r.time || '') : esc(r.gap || r.time || ''))}</td>
      <td class="pts">${r.cupPoints ?? ''}</td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="results">
    <thead><tr><th>#</th><th>Atleta</th>${showShoot ? '<th>Tiro</th>' : ''}<th>${res.resultType === 'points' ? 'Punti' : 'Tempo'}</th><th title="Punti Coppa del Mondo">Pt</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// ---- Classifiche parziali (1ª/2ª manche nello sci, 1ª/2ª serie nel salto), ricavate dalla classifica finale ----

/** "1:02.34" o "53.65" → secondi */
function toSec(t) {
  if (!t) return null;
  const m = String(t).trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  return m ? (m[1] ? parseInt(m[1], 10) * 60 : 0) + parseFloat(m[2]) : null;
}

function fmtGap(sec) {
  const cents = Math.round(sec * 100);
  const m = Math.floor(cents / 6000);
  const rest = (cents % 6000) / 100;
  return `+${m ? `${m}:${rest.toFixed(2).padStart(5, '0')}` : rest.toFixed(2)}`;
}

function rankBy(list, better) {
  list.sort(better);
  let rank = 0;
  list.forEach((x, i) => { rank = i > 0 && better(list[i - 1], x) === 0 ? rank : i + 1; x.rank = rank; });
  return list;
}

/** Quali tab parziali offrire per questo risultato: [{ key, label }] */
function partialTabs(res) {
  if (res.isRelay) return [];
  const tabs = [];
  if ((res.columns || []).includes('run1')) {
    for (const n of [1, 2]) if (res.rows.some((r) => toSec(r.extra?.[`run${n}`]) != null)) tabs.push({ key: `run${n}`, label: `${n}ª manche` });
  } else if (res.resultType === 'points') {
    for (const n of [1, 2]) if (res.rows.some((r) => r.extra?.jumps?.[n - 1]?.points != null)) tabs.push({ key: `jump${n}`, label: `${n}ª serie` });
  }
  return tabs;
}

function partialTable(res, key) {
  const n = Number(key.slice(-1));
  let list;
  if (key.startsWith('run')) {
    list = res.rows.map((r) => ({ r, t: toSec(r.extra?.[`run${n}`]), txt: r.extra?.[`run${n}`] })).filter((x) => x.t != null);
    rankBy(list, (a, b) => a.t - b.t);
    const best = list[0]?.t;
    list.forEach((x) => { x.main = x.rank === 1 ? x.txt : fmtGap(x.t - best); x.sub = x.rank === 1 ? '' : x.txt; });
  } else {
    list = res.rows.map((r) => ({ r, j: r.extra?.jumps?.[n - 1] })).filter((x) => x.j?.points != null);
    rankBy(list, (a, b) => b.j.points - a.j.points);
    const best = list[0]?.j.points;
    list.forEach((x) => {
      x.main = fmtNum(x.j.points);
      x.sub = `${x.j.distance != null ? `${fmtNum(x.j.distance)} m` : ''}${x.rank > 1 ? ` · -${fmtNum(best - x.j.points)}` : ''}`;
    });
  }
  if (!list.length) return '<p class="empty small">Dati non disponibili.</p>';
  const note = key.startsWith('run')
    ? `Tempi della ${n}ª manche${n === 2 ? ' (solo chi l\'ha disputata)' : ''}, ricavati dalla classifica finale.`
    : `Punteggi della ${n}ª serie${n === 2 ? ' (solo chi l\'ha disputata)' : ''}, ricavati dalla classifica finale.`;
  return `<div class="table-wrap"><table class="results">
    <thead><tr><th>#</th><th>Atleta</th><th>${key.startsWith('run') ? 'Tempo' : 'Punti'}</th></tr></thead>
    <tbody>${list.map((x) => `<tr class="${isIta(x.r) ? 'ita' : ''}">
      <td class="pos">${x.rank}</td>
      <td class="ath">${flag(x.r.nation)} <b>${esc(athleteName(x.r.name))}</b> <small class="nat">${esc(x.r.nation)}</small>${x.r.rank ? '' : `<div class="runs">${esc(statusLabel(x.r))}</div>`}</td>
      <td class="tm">${esc(x.main)}${x.sub ? `<div class="runs">${esc(x.sub)}</div>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>
    <p class="note">${note}</p>`;
}

function cardHead(race) {
  return `<header class="rc-head sport-${race.sport}">
    <div><b>${esc(race.disciplineName)}</b> <span class="g g-${race.gender}">${GENDERS[race.gender]}</span>${race.series ? ` <span class="badge comp">${esc(race.series)}</span>` : ''}${race.competition === 'WSC' ? ' <span class="badge comp">Mondiali</span>' : ''}</div>
    <div class="race-sub">${dayShort(race.startUtc)} · ${time(race.startUtc)} · ${flag(race.country)} ${esc(race.location)}</div>
    ${race.status === 'live' ? statusBadge('live') : ''}
  </header>`;
}

async function fillCard(card, race, { expanded = false } = {}) {
  const body = card.querySelector('.rc-body');
  try {
    const res = await loadResult(race.id);
    if (!res) { body.innerHTML = '<p class="empty small">Risultati non ancora disponibili.</p>'; return; }
    const itaCount = res.rows.filter(isIta).length;
    const tabs = partialTabs(res);
    body.innerHTML = `${podium(res)}
      <button class="btn wide toggle" aria-expanded="${expanded}">${expanded ? 'Nascondi classifica' : `Classifica completa (${res.rows.length})`}${itaCount ? ` · 🇮🇹 ${itaCount}` : ''}</button>
      <div class="full" ${expanded ? '' : 'hidden'}>
        ${tabs.length ? `<div class="segmented small" role="tablist">${[{ key: 'final', label: 'Finale' }, ...tabs].map((t, i) =>
          `<button role="tab" class="${i === 0 ? 'on' : ''}" aria-selected="${i === 0}" data-tab="${t.key}">${t.label}</button>`).join('')}</div>` : ''}
        <div class="tab-body">${fullTable(res)}</div>
        ${res.final ? '' : '<p class="note">Risultati provvisori</p>'}
        <p class="note"><a href="${esc(res.race.source?.url)}" target="_blank" rel="noopener">Fonte ufficiale ↗</a></p></div>`;
    body.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      body.querySelectorAll('[data-tab]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
      body.querySelector('.tab-body').innerHTML = b.dataset.tab === 'final' ? fullTable(res) : partialTable(res, b.dataset.tab);
    }));
    const btn = body.querySelector('.toggle');
    const full = body.querySelector('.full');
    btn.addEventListener('click', () => {
      full.hidden = !full.hidden;
      btn.setAttribute('aria-expanded', String(!full.hidden));
      btn.textContent = full.hidden ? `Classifica completa (${res.rows.length})${itaCount ? ` · 🇮🇹 ${itaCount}` : ''}` : 'Nascondi classifica';
    });
  } catch (e) {
    body.innerHTML = `<p class="empty small">Errore nel caricamento (${esc(e.message)}).</p>`;
  }
}

export function renderResults(view) {
  const all = store.calendar.races.filter((r) => r.hasResults || r.status === 'finished' || r.status === 'live')
    .sort((a, b) => Date.parse(b.startUtc) - Date.parse(a.startUtc));
  const sportsWith = SPORT_ORDER.filter((s) => all.some((r) => r.sport === s));
  if (!ui.sport) {
    let saved = null;
    try { saved = localStorage.getItem('ws:resSport'); } catch { /* ignore */ }
    ui.sport = saved || sportsWith[0] || 'biathlon';
  }
  const races = all.filter((r) => r.sport === ui.sport);

  view.innerHTML = `
    <div class="segmented sports" role="tablist">${SPORT_ORDER.map((s) => `
      <button role="tab" class="sport-${s} ${s === ui.sport ? 'on' : ''}" aria-selected="${s === ui.sport}" data-s="${s}">${SPORTS[s].icon} ${SPORTS[s].short}</button>`).join('')}</div>
    <div id="cards">${races.length ? '' : `<p class="empty">Nessun risultato per ${SPORTS[ui.sport].name}.<br><small>I risultati compaiono qui appena le gare si concludono.</small></p>`}</div>
    ${races.length > ui.shown ? `<button class="btn wide" id="more">Gare precedenti</button>` : ''}`;

  view.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
    ui.sport = b.dataset.s; ui.shown = PAGE;
    try { localStorage.setItem('ws:resSport', ui.sport); } catch { /* ignore */ }
    renderResults(view);
  }));
  view.querySelector('#more')?.addEventListener('click', () => { ui.shown += PAGE; renderResults(view); });

  const box = view.querySelector('#cards');
  for (const race of races.slice(0, ui.shown)) {
    const card = document.createElement('article');
    card.className = 'result-card';
    card.innerHTML = `<a class="rc-link" href="#/risultati/${encodeURIComponent(race.id)}">${cardHead(race)}</a><div class="rc-body"><p class="loading small">…</p></div>`;
    box.appendChild(card);
    fillCard(card, race);
  }
}

export async function renderResultDetail(view, id) {
  let race = raceById(id);
  view.innerHTML = `<a class="back" href="#/risultati">‹ Tutti i risultati</a><article class="result-card detail"><div class="rc-top"></div><div class="rc-body"><p class="loading small">Caricamento…</p></div></article>`;
  const card = view.querySelector('.result-card');
  if (!race) {
    const res = await loadResult(id).catch(() => null);
    race = res?.race;
  }
  if (!race) { card.querySelector('.rc-body').innerHTML = '<p class="empty">Gara non trovata.</p>'; return; }
  card.querySelector('.rc-top').innerHTML = cardHead(race);
  await fillCard(card, race, { expanded: true });
}
