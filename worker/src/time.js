// Utilità per il fuso orario italiano (Europe/Rome).

const romeDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Data "YYYY-MM-DD" in ora italiana per un istante (ms o ISO). */
export function romeDateKey(t) {
  const d = typeof t === 'number' ? new Date(t) : new Date(Date.parse(t));
  return romeDay.format(d);
}

/** Converte un orario locale con offset/ISO in ISO UTC ("...Z"). */
export function toUtcIso(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
