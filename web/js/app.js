// Avvio dell'app e routing a hash: #/calendario, #/risultati, #/risultati/<raceId>, #/coppa
import { api } from './api.js';
import { ago } from './format.js';
import { renderCalendar } from './views/calendar.js';
import { renderResults, renderResultDetail } from './views/results.js';
import { renderStandings } from './views/standings.js';

const view = document.getElementById('view');
const sync = document.getElementById('sync');
const toastEl = document.getElementById('toast');

export const store = {
  calendar: null,        // risposta di /calendar
  calendarAt: 0,
  offline: false,
  filters: loadFilters(),
  calendarMode: loadPref('mode', 'next'),
};

function loadPref(k, def) {
  try { return localStorage.getItem(`ws:${k}`) ?? def; } catch { return def; }
}
export function savePref(k, v) {
  try { localStorage.setItem(`ws:${k}`, v); } catch { /* ignore */ }
}
function loadFilters() {
  try {
    const f = JSON.parse(localStorage.getItem('ws:filters'));
    if (f && Array.isArray(f.sports) && Array.isArray(f.genders)) return f;
  } catch { /* ignore */ }
  return { sports: ['biathlon', 'alpine', 'crosscountry', 'jumping'], genders: ['M', 'F', 'X'] };
}
export function saveFilters() {
  savePref('filters', JSON.stringify(store.filters));
}

export function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

function renderSync() {
  if (!store.calendarAt) { sync.textContent = ''; return; }
  sync.className = `sync${store.offline ? ' offline' : ''}`;
  sync.textContent = store.offline ? `Offline · dati ${ago(store.calendarAt)}` : `Aggiornato ${ago(store.calendarAt)}`;
}

export async function loadCalendar(force = false) {
  if (store.calendar && !force && Date.now() - store.calendarAt < 60e3) return store.calendar;
  const r = await api.calendar();
  store.calendar = r.data;
  store.calendarAt = r.savedAt;
  store.offline = !!r.offline;
  renderSync();
  return store.calendar;
}

export function raceById(id) {
  return store.calendar?.races.find((r) => r.id === id) || null;
}

async function route() {
  const hash = location.hash || '#/calendario';
  const [, section, param] = hash.split('/');
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === section));
  try {
    await loadCalendar();
  } catch (e) {
    view.innerHTML = `<div class="empty">⚠️ Impossibile caricare i dati.<br><small>${e.message}</small><br><button class="btn" id="retry">Riprova</button></div>`;
    document.getElementById('retry').onclick = () => route();
    return;
  }
  if (section === 'risultati' && param) return renderResultDetail(view, decodeURIComponent(param));
  if (section === 'risultati') return renderResults(view);
  if (section === 'coppa') return renderStandings(view);
  return renderCalendar(view);
}

window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
// Ricarica i dati quando l'app torna in primo piano o ogni 5 minuti se resta aperta
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadCalendar(true).then(route).catch(() => {});
});
setInterval(() => { if (document.visibilityState === 'visible') loadCalendar(true).then(route).catch(() => {}); }, 5 * 60e3);
setInterval(renderSync, 30e3);

route();
