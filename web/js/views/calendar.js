// Vista Calendario: "Oggi in gara", prossime gare, settimana, mese.
import { store, savePref, toast } from '../app.js';
import { SPORTS, dayKey, dayLong, dayShort, monthLabel, todayKey, addDays, keyToDate, relativeDay, esc } from '../format.js';
import { filtersBar, bindFilters, applyFilters, raceRow } from './common.js';

const MODES = { next: 'Prossime', week: 'Settimana', month: 'Mese' };
const ui = { weekStart: null, month: null, selectedDay: null, showAll: false };

function groupByDay(races) {
  const map = new Map();
  for (const r of races) {
    const k = r.startUtc ? dayKey(r.startUtc) : 'tbd';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

function dayHeader(key) {
  const rel = relativeDay(key);
  return `<h3 class="day">${rel ? `<b>${rel}</b> · ` : ''}${dayLong(keyToDate(key))}</h3>`;
}

function dayList(races, empty = 'Nessuna gara') {
  if (!races.length) return `<p class="empty small">${empty}</p>`;
  let html = '';
  for (const [k, rs] of groupByDay(races)) html += dayHeader(k) + `<div class="list">${rs.map(raceRow).join('')}</div>`;
  return html;
}

function todayBox(races) {
  const t = todayKey();
  const today = races.filter((r) => r.startUtc && dayKey(r.startUtc) === t);
  const live = races.filter((r) => r.status === 'live' && !today.includes(r));
  const list = [...live, ...today];
  if (!list.length) {
    const next = races.find((r) => r.startUtc && dayKey(r.startUtc) > t && r.status !== 'cancelled');
    return `<section class="today empty-today">
      <h2>Oggi in gara</h2>
      <p>Nessuna gara oggi.${next ? ` Prossima: <b>${esc(next.disciplineName)}</b> a ${esc(next.location)}, ${dayShort(next.startUtc)}.` : ''}</p>
    </section>`;
  }
  return `<section class="today"><h2>Oggi in gara <span class="count">${list.length}</span></h2>
    <div class="list">${list.map(raceRow).join('')}</div></section>`;
}

function nextView(races) {
  const t = todayKey();
  const upcoming = races.filter((r) => !r.startUtc || dayKey(r.startUtc) > t);
  const limit = ui.showAll ? upcoming.length : 30;
  return dayList(upcoming.slice(0, limit), 'Nessuna gara in programma') +
    (upcoming.length > limit ? `<button class="btn wide" id="more">Mostra tutte (${upcoming.length})</button>` : '');
}

function mondayOf(key) {
  const d = keyToDate(key);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunedì
  return addDays(key, -dow);
}

function weekView(races) {
  ui.weekStart ||= mondayOf(todayKey());
  const days = Array.from({ length: 7 }, (_, i) => addDays(ui.weekStart, i));
  const byDay = groupByDay(races);
  const label = `${dayShort(keyToDate(days[0]))} – ${dayShort(keyToDate(days[6]))}`;
  let html = `<div class="pager"><button class="btn icon" data-nav="-1" aria-label="Settimana precedente">‹</button>
    <span>${label}</span><button class="btn icon" data-nav="1" aria-label="Settimana successiva">›</button></div>`;
  for (const k of days) {
    const rs = byDay.get(k) || [];
    html += `<div class="week-day ${k === todayKey() ? 'is-today' : ''}">${dayHeader(k)}
      ${rs.length ? `<div class="list">${rs.map(raceRow).join('')}</div>` : '<p class="empty small">—</p>'}</div>`;
  }
  return html;
}

function monthView(races) {
  const t = todayKey();
  ui.month ||= t.slice(0, 7);
  const first = `${ui.month}-01`;
  const byDay = groupByDay(races);
  const start = mondayOf(first);
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const k = addDays(start, i);
    if (i >= 35 && k.slice(0, 7) !== ui.month) break;
    const rs = byDay.get(k) || [];
    const sports = [...new Set(rs.map((r) => r.sport))];
    cells += `<button class="cell ${k.slice(0, 7) !== ui.month ? 'out' : ''} ${k === t ? 'is-today' : ''} ${k === ui.selectedDay ? 'sel' : ''}" data-day="${k}" ${rs.length ? '' : 'disabled'}>
      <span class="n">${Number(k.slice(8))}</span>
      <span class="dots">${sports.map((s) => `<i class="dot-${s}"></i>`).join('')}</span></button>`;
  }
  const sel = ui.selectedDay && byDay.get(ui.selectedDay);
  return `<div class="pager"><button class="btn icon" data-mnav="-1" aria-label="Mese precedente">‹</button>
      <span>${monthLabel(keyToDate(first))}</span><button class="btn icon" data-mnav="1" aria-label="Mese successivo">›</button></div>
    <div class="month"><div class="dow">${['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="grid">${cells}</div></div>
    <div class="legend">${Object.entries(SPORTS).map(([k, s]) => `<span><i class="dot-${k}"></i>${s.short}</span>`).join('')}</div>
    ${sel ? dayHeader(ui.selectedDay) + `<div class="list">${sel.map(raceRow).join('')}</div>` : '<p class="empty small">Tocca un giorno per vedere le gare.</p>'}`;
}

function sourceWarnings(cal) {
  const bad = Object.entries(cal.sources || {}).filter(([s, v]) => v && v.ok === false && v.updatedAt);
  if (!bad.length) return '';
  return `<p class="warn">⚠️ Aggiornamento non riuscito per ${bad.map(([s]) => SPORTS[s]?.name || s).join(', ')}: mostro l'ultimo dato valido.</p>`;
}

export function renderCalendar(view) {
  const cal = store.calendar;
  const races = applyFilters(cal.races);
  const mode = MODES[store.calendarMode] ? store.calendarMode : 'next';
  const body = mode === 'week' ? weekView(races) : mode === 'month' ? monthView(races) : nextView(races);

  view.innerHTML = `
    ${filtersBar()}
    ${sourceWarnings(cal)}
    ${todayBox(races)}
    <div class="segmented" role="tablist">${Object.entries(MODES).map(([k, v]) =>
      `<button role="tab" aria-selected="${k === mode}" class="${k === mode ? 'on' : ''}" data-mode="${k}">${v}</button>`).join('')}</div>
    <section class="cal-body">${body}</section>`;

  const rerender = () => renderCalendar(view);
  bindFilters(view, rerender);
  view.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    store.calendarMode = b.dataset.mode; savePref('mode', b.dataset.mode); rerender();
  }));
  view.querySelector('#more')?.addEventListener('click', () => { ui.showAll = true; rerender(); });
  view.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    ui.weekStart = addDays(ui.weekStart, 7 * Number(b.dataset.nav)); rerender();
  }));
  view.querySelectorAll('[data-mnav]').forEach((b) => b.addEventListener('click', () => {
    const d = keyToDate(`${ui.month}-01`);
    d.setUTCMonth(d.getUTCMonth() + Number(b.dataset.mnav));
    ui.month = d.toISOString().slice(0, 7); ui.selectedDay = null; rerender();
  }));
  view.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
    ui.selectedDay = b.dataset.day; rerender();
  }));
  // Gare senza risultati: niente navigazione, solo un avviso
  view.querySelectorAll('a.race.noresult').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    toast('Risultati disponibili a gara conclusa');
  }));
}
