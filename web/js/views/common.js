// Componenti condivisi tra le viste.
import { SPORTS, SPORT_ORDER, GENDER_SHORT, STATUS, COMPETITIONS, esc, flag, time } from '../format.js';
import { store, saveFilters } from '../app.js';

// Filtri a scelta singola: toccando uno sport si vedono solo le sue gare;
// toccandolo di nuovo (o "Tutti") si torna a vedere tutto. Idem per il genere.
export function filtersBar() {
  const f = store.filters;
  const chip = (attr, val, label, on, cls = '') =>
    `<button class="chip ${cls} ${on ? 'on' : ''}" data-${attr}="${val}" aria-pressed="${on}">${label}</button>`;
  const sportChips = chip('sport', 'all', 'Tutti', f.sport === 'all') +
    SPORT_ORDER.map((s) => chip('sport', s, `${SPORTS[s].icon} ${SPORTS[s].short}`, f.sport === s, `sport-${s}`)).join('');
  const genderChips = chip('gender', 'all', 'Tutti', f.gender === 'all', 'gender') +
    [['M', 'Uomini'], ['F', 'Donne'], ['X', 'Miste']].map(([g, l]) => chip('gender', g, l, f.gender === g, 'gender')).join('');
  return `<div class="filters"><div class="chips">${sportChips}</div><div class="chips">${genderChips}</div></div>`;
}

export function bindFilters(root, onChange) {
  root.querySelectorAll('[data-sport]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.sport;
    store.filters.sport = v === store.filters.sport ? 'all' : v;
    saveFilters(); onChange();
  }));
  root.querySelectorAll('[data-gender]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.gender;
    store.filters.gender = v === store.filters.gender ? 'all' : v;
    saveFilters(); onChange();
  }));
}

export function applyFilters(races) {
  const { sport, gender } = store.filters;
  return races.filter((r) => (sport === 'all' || r.sport === sport) &&
    (gender === 'all' || r.gender === gender || (gender !== 'X' && r.gender === 'X')));
}

export function statusBadge(status) {
  return `<span class="badge st-${status}">${status === 'live' ? '<i class="dot"></i>' : ''}${STATUS[status] || status}</span>`;
}

export function raceRow(r) {
  const clickable = r.hasResults || r.status === 'finished' || r.status === 'live';
  const comp = r.competition !== 'WC'
    ? `<span class="badge comp">${COMPETITIONS[r.competition] || r.competition}</span>`
    : (r.series ? `<span class="badge comp">${esc(r.series)}</span>` : '');
  return `
  <a class="race sport-${r.sport} ${r.status} ${clickable ? '' : 'noresult'}" href="#/risultati/${encodeURIComponent(r.id)}" data-id="${esc(r.id)}">
    <div class="race-time${r.timeTbc ? ' tbc' : ''}">${r.timeTbc ? 'ora<br>da def.' : time(r.startUtc)}</div>
    <div class="race-main">
      <div class="race-title">
        <span class="g g-${r.gender}">${GENDER_SHORT[r.gender]}</span>
        ${esc(r.disciplineName)}
      </div>
      <div class="race-sub">${SPORTS[r.sport].icon} ${SPORTS[r.sport].short} · ${flag(r.country)} ${esc(r.location)} ${comp}</div>
      ${r.runs?.length > 1 && r.runs[1].startUtc ? `<div class="race-sub">2ª manche ${time(r.runs[1].startUtc)}</div>` : ''}
    </div>
    <div class="race-status">${statusBadge(r.status)}</div>
  </a>`;
}
