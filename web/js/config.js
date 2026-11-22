// URL base delle API (il Worker con cron e dati). La PWA è pubblicata su Cloudflare Pages
// (wintersports-marchio11.pages.dev) e legge i dati dal Worker, che ha i CORS abilitati.
export const API_BASE = location.hostname.endsWith('.workers.dev') || location.hostname === 'localhost'
  ? ''
  : 'https://wintersports.andrea-marchionni11.workers.dev';
