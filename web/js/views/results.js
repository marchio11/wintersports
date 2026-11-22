// Vista Risultati: gare concluse per sport (dalla più recente), podio e classifica completa.
import { store, raceById } from '../app.js';
import { api } from '../api.js';
import { SPORTS, SPORT_ORDER, GENDERS, dayShort, time, flag, esc, athleteName } from '../format.js';
import { statusBadge } from './common.js';

const cache = new Map(); // raceId → risultato
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
      <span class="who">${flag(r.nation)} ${esc(res.isRelay ? r.name : athleteName(r.name))}</span>
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
  const cols = 4 + (showShoot ? 1 : 0);
  const rows = res.rows.map((r) => {
    const members = res.isRelay && r.members?.length
      ? `<div class="members">${r.members.map((m) => `<span class="${m.nation === 'ITA' ? 'ita-txt' : ''}">${typeof m.leg === 'number' ? `${m.leg}. ` : ''}${esc(athleteName(m.name))}${m.shooting ? ` <small>(${esc(m.shooting)})</small>` : ''}${m.jumps?.length ? ` <small>${jumpsText(m.jumps)}</small>` : ''}</span>`).join('')}</div>`
      : '';
    const jumps = !res.isRelay && r.extra?.jumps?.length ? `<div class="runs">${jumpsText(r.extra.jumps)}</div>` : '';
    const runs = showRuns && (r.extra?.run1 || r.extra?.run2)
      ? `<div class="runs">${r.extra.run1 ? `1ª ${esc(r.extra.run1)}` : ''}${r.extra.run2 ? ` · 2ª ${esc(r.extra.run2)}` : ''}</div>`
      : '';
    const divider = !r.rank && r.status && !shownDivider
      ? ((shownDivider = true), `<tr class="divider"><td colspan="${cols}">Non classificati</td></tr>`)
      : '';
    return `${divider}<tr class="${isIta(r) ? 'ita' : ''}">
      <td class="pos">${r.rank ?? `<small title="${esc(statusLabel(r))}">${esc(r.status || '')}</small>`}</td>
      <td class="ath">${flag(r.nation)} <b>${esc(res.isRelay ? r.name : athleteName(r.name))}</b> <small class="nat">${esc(r.nation)}</small>${members}${runs}${jumps}${!r.rank && r.status ? `<div class="runs">${esc(statusLabel(r))}</div>` : ''}</td>
      ${showShoot ? `<td class="sh"><small>${esc(r.extra?.shooting || '')}</small></td>` : ''}
      <td class="tm">${points ? `${r.points != null ? fmtNum(r.points) : ''}${r.gap ? `<div class="runs">${esc(r.gap.replace('.', ','))}</div>` : ''}` : (r.rank === 1 ? esc(r.time || '') : esc(r.gap || r.time || ''))}</td>
      <td class="pts">${r.cupPoints ?? ''}</td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="results">
    <thead><tr><th>#</th><th>Atleta</th>${showShoot ? '<th>Tiro</th>' : ''}<th>${res.resultType === 'points' ? 'Punti' : 'Tempo'}</th><th title="Punti Coppa del Mondo">Pt</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function cardHead(race) {
  return `<header class="rc-head sport-${race.sport}">
    <div><b>${esc(race.disciplineName)}</b> <span class="g g-${race.gender}">${GENDERS[race.gender]}</span></div>
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
    body.innerHTML = `${podium(res)}
      <button class="btn wide toggle" aria-expanded="${expanded}">${expanded ? 'Nascondi classifica' : `Classifica completa (${res.rows.length})`}${itaCount ? ` · 🇮🇹 ${itaCount}` : ''}</button>
      <div class="full" ${expanded ? '' : 'hidden'}>${fullTable(res)}
        ${res.final ? '' : '<p class="note">Risultati provvisori</p>'}
        <p class="note"><a href="${esc(res.race.source?.url)}" target="_blank" rel="noopener">Fonte ufficiale ↗</a></p></div>`;
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
