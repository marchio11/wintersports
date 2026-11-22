// Vista Coppa: classifiche generali e di specialità per sport, più la Tournée dei 4 trampolini.
import { api } from '../api.js';
import { SPORTS, SPORT_ORDER, flag, esc, athleteName, dayShort, keyToDate } from '../format.js';
import { savePref } from '../app.js';

const cache = new Map(); // sport → dati
const PAGE = 30;
const ui = { sport: null, gender: null, cup: {}, showAll: false };

function pref(k, def) {
  try { return localStorage.getItem(`ws:std:${k}`) || def; } catch { return def; }
}

export function clearStandingsCache() { cache.clear(); }

async function load(sport) {
  if (cache.has(sport)) return cache.get(sport);
  const r = await api.standings(sport);
  const data = r.notFound ? null : r.data;
  cache.set(sport, data);
  return data;
}

const fmt = (n) => (n == null ? '' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1 }));

function table(st) {
  const rows = ui.showAll ? st.rows : st.rows.slice(0, PAGE);
  const medal = (r) => (r <= 3 ? ['🥇', '🥈', '🥉'][r - 1] : r);
  return `<div class="table-wrap"><table class="results standings">
    <thead><tr><th>#</th><th>Atleta</th><th>Punti</th><th>Dist.</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="${r.nation === 'ITA' ? 'ita' : ''}">
      <td class="pos">${medal(r.rank)}</td>
      <td class="ath">${flag(r.nation)} <b>${esc(athleteName(r.name))}</b> <small class="nat">${esc(r.nation || '')}</small></td>
      <td class="tm"><b>${fmt(r.points)}</b></td>
      <td class="pts">${r.gap ? `-${fmt(r.gap)}` : ''}</td>
    </tr>`).join('')}</tbody></table></div>
    ${st.rows.length > PAGE && !ui.showAll ? `<button class="btn wide" id="all">Mostra tutti (${st.rows.length})</button>` : ''}`;
}

function emptyMessage(st, data) {
  if (st.group === 'fourhills') {
    const when = st.start && st.end ? ` dal ${dayShort(keyToDate(st.start))} al ${dayShort(keyToDate(st.end))}` : '';
    return `🏔️ La Tournée dei 4 trampolini si disputa${when} (Oberstdorf, Garmisch-Partenkirchen, Innsbruck, Bischofshofen).<br><small>La classifica comparirà qui dopo la prima gara.</small>`;
  }
  if (data.source === 'calcolata') return 'La classifica comparirà dopo le prime gare individuali di Coppa.';
  return 'Classifica non ancora disponibile.';
}

export async function renderStandings(view) {
  if (!ui.sport) ui.sport = pref('sport', 'biathlon');
  if (!ui.gender) ui.gender = pref('gender', 'M');
  view.innerHTML = `
    <div class="segmented sports" role="tablist">${SPORT_ORDER.map((s) => `
      <button role="tab" class="sport-${s} ${s === ui.sport ? 'on' : ''}" aria-selected="${s === ui.sport}" data-s="${s}">${SPORTS[s].icon} ${SPORTS[s].short}</button>`).join('')}</div>
    <div class="segmented" role="tablist">${[['M', 'Uomini'], ['F', 'Donne']].map(([g, l]) => `
      <button role="tab" class="${g === ui.gender ? 'on' : ''}" aria-selected="${g === ui.gender}" data-g="${g}">${l}</button>`).join('')}</div>
    <div id="std"><p class="loading small">Caricamento…</p></div>`;

  view.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
    ui.sport = b.dataset.s; ui.showAll = false; savePref('std:sport', ui.sport); renderStandings(view);
  }));
  view.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => {
    ui.gender = b.dataset.g; ui.showAll = false; savePref('std:gender', ui.gender); renderStandings(view);
  }));

  const box = view.querySelector('#std');
  let data;
  try { data = await load(ui.sport); } catch (e) {
    box.innerHTML = `<p class="empty">Impossibile caricare le classifiche.<br><small>${esc(e.message)}</small></p>`;
    return;
  }
  if (!data || !data.standings?.length) {
    box.innerHTML = `<p class="empty">🏆 Classifiche di ${SPORTS[ui.sport].name} non ancora disponibili.<br><small>Compariranno dopo le prime gare.</small></p>`;
    return;
  }
  const list = data.standings.filter((s) => s.gender === ui.gender);
  const key = `${ui.sport}-${ui.gender}`;
  let cur = list.find((s) => s.id === ui.cup[key]) || list.find((s) => s.discipline === 'ALL') || list[0];
  if (!cur) { box.innerHTML = '<p class="empty">Nessuna classifica.</p>'; return; }
  ui.cup[key] = cur.id;

  const chips = list.map((s) => `<button class="chip sport-${ui.sport} ${s.id === cur.id ? 'on' : ''} ${s.group === 'fourhills' ? 'special' : ''}" data-cup="${esc(s.id)}">
    ${s.group === 'fourhills' ? '🏔️ 4 Trampolini' : esc(s.label)}</button>`).join('');
  const source = data.source === 'calcolata'
    ? `Calcolata sommando i punti di Coppa delle gare individuali${cur.races != null ? ` (${cur.races} gare)` : ''}.`
    : (cur.group === 'fourhills' ? 'Classifica ufficiale FIS della Tournée (somma dei punti delle 4 gare).' : 'Classifica ufficiale FIS.');

  box.innerHTML = `<div class="filters"><div class="chips">${chips}</div></div>
    <article class="result-card">
      <header class="rc-head sport-${ui.sport}">
        <div><b>${esc(cur.group === 'fourhills' ? cur.label : `Coppa del Mondo – ${cur.label}`)}</b> <span class="g g-${cur.gender}">${esc(cur.genderLabel || '')}</span></div>
        <div class="race-sub">${esc(source)}</div>
      </header>
      <div class="rc-body">${cur.rows.length ? table(cur) : `<p class="empty small">${emptyMessage(cur, data)}</p>`}</div>
    </article>`;

  box.querySelectorAll('[data-cup]').forEach((b) => b.addEventListener('click', () => {
    ui.cup[key] = b.dataset.cup; ui.showAll = false; renderStandings(view);
  }));
  box.querySelector('#all')?.addEventListener('click', () => { ui.showAll = true; renderStandings(view); });
}
