// Parser HTML condivisi per le pagine FIS (www.fis-ski.com).
// Sono volutamente "difensivi": lavorano su porzioni di pagina individuate da marcatori
// stabili (id e classi) e lanciano un errore se la struttura non è quella attesa,
// così l'updater mantiene l'ultimo dato valido.

export const FIS = 'https://www.fis-ski.com/DB';

const SECTOR_PATH = { AL: 'alpine-skiing', CC: 'cross-country', JP: 'ski-jumping' };

export const urls = {
  calendar: (sector, season, category) =>
    `${FIS}/${SECTOR_PATH[sector]}/calendar-results.html?sectorcode=${sector}&seasoncode=${season}&categorycode=${category}`,
  event: (sector, eventId, season) =>
    `${FIS}/general/event-details.html?sectorcode=${sector}&eventid=${eventId}&seasoncode=${season}`,
  results: (sector, raceId) => `${FIS}/general/results.html?sectorcode=${sector}&raceid=${raceId}`,
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
export function decode(s) {
  return String(s ?? '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function between(html, startMarker, endMarker) {
  const i = html.indexOf(startMarker);
  if (i < 0) return null;
  const j = endMarker ? html.indexOf(endMarker, i) : -1;
  return html.slice(i, j > i ? j : undefined);
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/**
 * Intervallo di date di una tappa dal testo FIS:
 * "24-25 Oct 2026", "22 Dec 2026", "30 Nov-01 Dec 2026", "28 Dec 2026-02 Jan 2027".
 * Ritorna { start, end } come "YYYY-MM-DD" (approssimate, servono solo per pianificare).
 */
export function parseDateRange(text) {
  const t = decode(text);
  const parts = t.split('-').map((p) => p.trim());
  const parsed = parts.map((p) => {
    const m = p.match(/^(\d{1,2})(?:\s+([A-Z][a-z]{2}))?(?:\s+(\d{4}))?$/);
    return m ? { d: +m[1], m: m[2] ? MONTHS[m[2]] : undefined, y: m[3] ? +m[3] : undefined } : null;
  });
  if (!parsed.length || parsed.some((p) => !p)) return null;
  const last = parsed[parsed.length - 1];
  if (last.m === undefined || last.y === undefined) return null;
  const first = parsed[0];
  const fm = first.m ?? last.m;
  let fy = first.y ?? last.y;
  if (first.y === undefined && fm > last.m) fy = last.y - 1;
  const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { start: iso(fy, fm, first.d), end: iso(last.y, last.m, last.d) };
}

/** Pagina calendario: elenco delle tappe. */
export function parseCalendar(html) {
  const body = between(html, 'id="calendardata"');
  if (!body) throw new Error('FIS: tabella calendario non trovata');
  const rows = body.split('<div class="table-row reset-padding"').slice(1);
  const events = [];
  for (const r of rows) {
    const id = r.match(/^[^>]*\bid="(\d+)"/)?.[1];
    if (!id) continue;
    const dateText = r.match(/target="_self">\s*([^<]*\d{4})\s*<\/a>/)?.[1];
    const place = r.match(/<div class="clip bold font_md_large font_lg_large">([^<]+)<\/div>/)?.[1]
      || r.match(/<span class="bold clip-xs">([^<]+)<\/span>/)?.[1];
    const nation = r.match(/country__name-short">([A-Z]{3})</)?.[1] || null;
    const cancelled = /title="Cancelled"/.test(r);
    const range = dateText ? parseDateRange(dateText) : null;
    if (!place) continue;
    events.push({
      eventId: id,
      place: decode(place),
      nation,
      start: range?.start || null,
      end: range?.end || null,
      cancelled,
    });
  }
  if (!events.length) throw new Error('FIS: calendario vuoto');
  return events;
}

/** Pagina dettaglio tappa: elenco gare con orari e stato. */
export function parseEventDetails(html) {
  const body = between(html, 'id="eventdetailscontent"');
  if (!body) throw new Error('FIS: dettaglio tappa non trovato');
  const header = html.match(/<h1 class="heading[^"]*">([^<]+)<\/h1>/)?.[1];
  const rows = body.split('<div class="table-row reset-padding').slice(1);
  const races = [];
  for (const r of rows) {
    const raceId = r.match(/raceid=(\d+)/)?.[1];
    if (!raceId) continue;
    const titles = [...r.matchAll(/title="([^"]+)">[A-Z]<\/span>/g)].map((m) => m[1]);
    const discipline = decode(r.match(/<div class="clip">\s*([^<]+?)\s*<\/div>/)?.[1] || '');
    const category = r.match(/justify-center hidden-sm-down"\s+href="[^"]*"\s+target="_self">\s*([A-Z]{2,5})\s*<\/a>/)?.[1]
      || r.match(/<div class="g-xs-12 justify-left">\s*([A-Z]{2,5})\s*<\/div>/)?.[1] || null;
    const genders = [...new Set([...r.matchAll(/gender__item gender__item_\w">(\w)<\/div>/g)].map((m) => m[1]))];
    const startIso = r.match(/data-iso-date="([^"]+)"/)?.[1] || null;
    const timezone = r.match(/data-timezone="([^"]+)"/)?.[1] || null;
    const runs = [...r.matchAll(
      /justify-left">\s*([\w.]+)\s*<\/div>\s*<div class="g-lg g-md g-sm g-xs justify-left">\s*(?:<div class="timezone-time"[^>]*data-iso-date="([^"]*)"[^>]*>[^<]*<\/div>)?\s*<\/div>\s*<div class="g-lg-5 g-md-9 justify-left hidden-sm-down">\s*([^<]*?)\s*<\/div>/g,
    )].map((m) => ({ label: m[1], startIso: m[2] || null, status: decode(m[3]) }));
    const comments = decode(r.match(/<a class="hidden-xs px-1[^"]*"[^>]*>\s*([^<]*?)\s*<\/a>/)?.[1] || '');
    races.push({
      raceId,
      discipline,
      category,
      genders,
      startIso,
      timezone,
      runs,
      dataAvailable: titles.includes('Data available'),
      cancelled: titles.includes('Cancelled'),
      changed: titles.some((t) => /^Changes?$/.test(t) || t === 'Changed'),
      comments,
    });
  }
  return { place: header ? decode(header) : null, races };
}

const SECTION_STATUS = [
  [/did not start/i, 'DNS'],
  [/did not finish/i, 'DNF'],
  [/disqualified/i, 'DSQ'],
  [/did not qualify/i, 'DNQ'],
  [/not permitted to start/i, 'DNS'],
  [/lapped/i, 'LAP'],
];

function sectionStatus(title) {
  for (const [re, st] of SECTION_STATUS) if (re.test(title)) return st;
  return 'NC';
}

/**
 * Pagina risultati FIS. Le colonne si riconoscono dalla classe CSS:
 *  - "g-sm-2 justify-right bold hidden-xs"      → tempi delle manche/frazioni
 *  - "justify-right blue bold"                  → tempo totale (desktop)
 *  - "g-sm-3 g-xs-5 justify-right bold"         → tempo (vincitore) o distacco
 *  - "g-sm-2 justify-right hidden-xs"           → punti Coppa (ultima colonna)
 */
export function parseResults(html) {
  const start = html.indexOf('id="events-info-results"');
  if (start < 0) return null; // nessuna classifica pubblicata
  const body = html.slice(start);
  const title = decode(html.match(/event-header__kind">([\s\S]*?)<\/div>/)?.[1] || '');
  const raceIso = html.match(/event-header__date[\s\S]*?data-iso-date="([^"]+)"/)?.[1] || null;

  // le sezioni (Did not finish…) sono intestazioni "thead_slave" tra un blocco e l'altro
  const chunks = body.split(/<div class="thead thead_slave">/);
  const rows = [];
  let status = null;
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    if (ci > 0) {
      const t = decode(chunk.match(/<div class="g-xs-24 bold">([^<]+)<\/div>/)?.[1] || '');
      status = t ? sectionStatus(t) : status;
    }
    for (const r of chunk.split('<a class="table-row"').slice(1)) {
      // nome: con marca degli sci (".athlete-name") oppure direttamente nella colonna "Athlete"
      const name = r.match(/athlete-name">([^<]+)</)?.[1]
        || r.match(/<div class="g-lg-\d+ g-md-\d+ g-sm-\d+ g-xs-\d+ justify-left bold">\s*([^<]+?)\s*<\/div>/)?.[1];
      if (!name) continue;
      const nation = r.match(/country__name-short">([A-Z]{3})</)?.[1] || null;
      const rankTxt = r.match(/justify-right pr-1 bold">\s*(\d*)\s*</)?.[1];
      const bib = r.match(/justify-center hidden-sm-down gray">\s*(\d+)\s*</)?.[1];
      const fisCode = r.match(/hidden-xs justify-right gray">\s*(\d+)\s*</)?.[1];
      const tail = r.slice(r.indexOf('country__name-short'));
      const runs = [...tail.matchAll(/<div class="[^"]*g-sm-2 justify-right bold hidden-xs">\s*([^<]*?)\s*<\/div>/g)].map((m) => m[1]);
      const total = tail.match(/justify-right blue bold[^"]*">\s*([^<]*?)\s*<\/div>/)?.[1] || '';
      const timeOrGap = decode(tail.match(/g-xs-5 justify-right bold">\s*(?:<span[^>]*>)?\s*([^<]*?)\s*</)?.[1] || '');
      const cup = [...tail.matchAll(/<div class="g-lg-2 g-md-2 g-sm-2 justify-right hidden-xs">\s*([^<]*?)\s*<\/div>/g)].map((m) => m[1]).pop();
      const rank = status ? null : (rankTxt ? parseInt(rankTxt, 10) : null);
      rows.push({
        rank,
        bib: bib ? parseInt(bib, 10) : null,
        athleteId: fisCode ? `fis-${fisCode}` : null,
        name: decode(name),
        nation,
        time: status ? null : (total || (timeOrGap.startsWith('+') ? null : timeOrGap) || null),
        gap: status || !timeOrGap.startsWith('+') ? null : timeOrGap,
        points: null,
        cupPoints: cup && /^\d+$/.test(cup) ? parseInt(cup, 10) : null,
        status,
        statusDetail: status && ci > 0 ? decode(chunk.match(/<div class="g-xs-24 bold">([^<]+)<\/div>/)?.[1] || '') : null,
        extra: { runs: runs.filter((x) => x !== '') },
      });
    }
  }
  if (!rows.length) return null;
  return { title, raceIso, rows };
}
