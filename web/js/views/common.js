// Componenti condivisi tra le viste.
import { SPORTS, SPORT_ORDER, GENDERS, GENDER_SHORT, STATUS, COMPETITIONS, esc, flag, time } from '../format.js';
import { store, saveFilters } from '../app.js';

export function filtersBar() {
  const f = store.filters;
  const sportChips = SPORT_ORDER.map((s) => `
    <button class="chip sport-${s} ${f.sports.includes(s) ? 'on' : ''}" data-sport="${s}" aria-pressed="${f.sports.includes(s)}">
      ${SPORTS[s].icon} ${SPORTS[s].short}</button>`).join('');
  const genderChips = ['M', 'F', 'X'].map((g) => `
    <button class="chip gender ${f.genders.includes(g) ? 'on' : ''}" data-gender="${g}" aria-pressed="${f.genders.includes(g)}">
      ${GENDERS[g]}</button>`).join('');
  return `<div class="filters"><div class="chips">${sportChips}</div><div class="chips">${genderChips}</div></div>`;
}

export function bindFilters(root, onChange) {
  root.querySelectorAll('[data-sport]').forEach((b) => b.addEventListener('click', () => {
    toggle(store.filters.sports, b.dataset.sport);
    saveFilters(); onChange();
  }));
  root.querySelectorAll('[data-gender]').forEach((b) => b.addEventListener('click', () => {
    toggle(store.filters.genders, b.dataset.gender);
    saveFilters(); onChange();
  }));
}

function toggle(arr, v) {
  const i = arr.indexOf(v);
  if (i >= 0) { if (arr.length > 1) arr.splice(i, 1); } else arr.push(v);
}

export function applyFilters(races) {
  const { sports, genders } = store.filters;
  return races.filter((r) => sports.includes(r.sport) && genders.includes(r.gender));
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
