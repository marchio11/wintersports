// Formattazione in italiano e in ora italiana (Europe/Rome).

const TZ = 'Europe/Rome';

export const SPORTS = {
  biathlon: { name: 'Biathlon', short: 'Biathlon', icon: '🎯' },
  alpine: { name: 'Sci alpino', short: 'Alpino', icon: '⛷️' },
  crosscountry: { name: 'Sci di fondo', short: 'Fondo', icon: '🎿' },
  jumping: { name: 'Salto con gli sci', short: 'Salto', icon: '🪂' },
};
export const SPORT_ORDER = ['biathlon', 'alpine', 'crosscountry', 'jumping'];

export const GENDERS = { M: 'Uomini', F: 'Donne', X: 'Mista' };
export const GENDER_SHORT = { M: 'M', F: 'F', X: 'MX' };

export const STATUS = {
  scheduled: 'In programma',
  live: 'In corso',
  finished: 'Conclusa',
  cancelled: 'Annullata',
  postponed: 'Rinviata',
};

export const COMPETITIONS = { WC: 'Coppa del Mondo', WSC: 'Mondiali', OWG: 'Olimpiadi' };

const fTime = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fDayLong = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const fDayShort = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const fMonth = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, month: 'long', year: 'numeric' });
const fKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const time = (iso) => (iso ? fTime.format(new Date(iso)) : '--:--');
export const dayLong = (d) => cap(fDayLong.format(d instanceof Date ? d : new Date(d)));
export const dayShort = (d) => fDayShort.format(d instanceof Date ? d : new Date(d));
export const monthLabel = (d) => cap(fMonth.format(d));

/** "YYYY-MM-DD" del giorno in ora italiana. */
export const dayKey = (d) => fKey.format(d instanceof Date ? d : new Date(d));

/** Date "a mezzogiorno UTC" per un dayKey: comoda per iterare sui giorni senza problemi di fuso. */
export const keyToDate = (key) => new Date(`${key}T12:00:00Z`);
export const addDays = (key, n) => {
  const d = keyToDate(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const todayKey = () => dayKey(new Date());

export function relativeDay(key) {
  const t = todayKey();
  if (key === t) return 'Oggi';
  if (key === addDays(t, 1)) return 'Domani';
  if (key === addDays(t, -1)) return 'Ieri';
  return null;
}

// Bandiere: codici IOC/FIS → ISO 3166 alpha-2
const IOC_TO_ISO = {
  ITA: 'IT', AUT: 'AT', SUI: 'CH', GER: 'DE', FRA: 'FR', NOR: 'NO', SWE: 'SE', FIN: 'FI', USA: 'US',
  CAN: 'CA', SLO: 'SI', CZE: 'CZ', SVK: 'SK', POL: 'PL', EST: 'EE', LAT: 'LV', LTU: 'LT', UKR: 'UA',
  BLR: 'BY', RUS: 'RU', KAZ: 'KZ', BUL: 'BG', ROU: 'RO', JPN: 'JP', CHN: 'CN', KOR: 'KR', AND: 'AD',
  ESP: 'ES', BEL: 'BE', NED: 'NL', GBR: 'GB', IRL: 'IE', DEN: 'DK', ISL: 'IS', CRO: 'HR', BIH: 'BA',
  SRB: 'RS', MNE: 'ME', MKD: 'MK', GRE: 'GR', TUR: 'TR', HUN: 'HU', LIE: 'LI', MON: 'MC', AUS: 'AU',
  NZL: 'NZ', ARG: 'AR', CHI: 'CL', BRA: 'BR', MEX: 'MX', ALB: 'AL', MDA: 'MD', GEO: 'GE', ARM: 'AM',
  ISR: 'IL', LUX: 'LU', POR: 'PT', MGL: 'MN',
};

export function flag(ioc) {
  const iso = IOC_TO_ISO[ioc];
  if (!iso) return '';
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** "LAEGREID Sturla Holm" → "Sturla Holm Laegreid" */
export function athleteName(name) {
  if (!name) return '';
  const parts = name.split(' ');
  const family = [];
  while (parts.length && parts[0] === parts[0].toUpperCase() && /[A-ZÀ-Ý]/.test(parts[0])) family.push(parts.shift());
  if (!family.length || !parts.length) return name;
  const fam = family.map((p) => (p.charAt(0) + p.slice(1).toLowerCase())
    .replace(/([-'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/^(Mc)(\p{L})/u, (m, a, b) => a + b.toUpperCase())).join(' ');
  return `${parts.join(' ')} ${fam}`;
}

export function ago(ts) {
  if (!ts) return '';
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'adesso';
  if (min < 60) return `${min} min fa`;
  return `alle ${time(new Date(ts).toISOString())}`;
}
