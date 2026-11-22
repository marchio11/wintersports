# ❄️ Neve 26/27

PWA personale per seguire la Coppa del Mondo 2026/27 di **biathlon**, sci alpino, sci di fondo e salto con gli sci.
Interfaccia in italiano, orari sempre in **ora italiana**.

- **Backend + sito**: un unico Cloudflare Worker (piano gratuito) che
  - ogni 10 minuti scarica i dati dalle fonti, li normalizza e li salva in **KV**;
  - espone le API JSON `GET /calendar`, `GET /results/:raceId`, `GET /standings/:sport`, `GET /health` (con CORS);
  - serve i file statici della PWA (cartella `web/`) con **Workers Static Assets**.
- **Frontend**: HTML/CSS/JavaScript puro, senza build (cartella `web/`).

Piano completo, schema JSON e fonti dati: [PIANO.md](PIANO.md).

## Struttura

```
worker/        Cloudflare Worker (API + cron)
  src/sources/ parser isolati per fonte (biathlon = sito ufficiale IBU)
  src/updaters aggiornamento incrementale per sport
  test/        test dei parser su pagine reali salvate (npm test)
web/           PWA servita dal Worker
```

## Configurazione di Cloudflare (passo passo)

> Se mi dai un API token Cloudflare posso fare io tutti questi passaggi. Ecco comunque come farli a mano.

### 1. Crea l'API token (solo se vuoi che il deploy lo faccia Claude)
1. Vai su **dash.cloudflare.com → icona profilo → My Profile → API Tokens → Create Token**.
2. Scegli il modello **"Edit Cloudflare Workers"** → *Use template*.
3. In *Account Resources* seleziona il tuo account, in *Zone Resources* puoi lasciare "All zones" (non usiamo domini).
4. *Continue to summary* → *Create Token* e copia il token (si vede una volta sola).

### 2. Dal tuo computer (se fai tu)
Serve Node.js 20 o più recente.
```bash
cd worker
npm install
npx wrangler login                      # apre il browser per autorizzare
npx wrangler kv namespace create KV     # stampa un id: copialo in wrangler.toml al posto di REPLACE_WITH_KV_ID
npx wrangler deploy                     # pubblica Worker + PWA + cron
```
Alla fine wrangler stampa l'indirizzo, tipo `https://wintersports.<tuo-sottodominio>.workers.dev`.
Aprilo dal telefono: è già l'app.

### 3. Token per l'aggiornamento manuale (facoltativo)
```bash
npx wrangler secret put ADMIN_TOKEN     # inventa una password lunga
curl -X POST -H "Authorization: Bearer <password>" https://wintersports.<sottodominio>.workers.dev/admin/run
```
Forza subito un aggiornamento senza aspettare il cron.

### 4. Controllare che funzioni
- `https://…workers.dev/health` → stato delle fonti e ora dell'ultimo aggiornamento.
- `npx wrangler tail` → log in tempo reale del cron (una riga `tick` ogni 10 minuti).
- Dashboard Cloudflare → *Workers & Pages → wintersports → Settings → Triggers*: c'è il cron `*/10 * * * *`.

### Limiti del piano gratuito (rispettati)
| Limite | Uso previsto |
|---|---|
| 100.000 richieste/giorno al Worker | ~150 tick cron + le tue aperture dell'app |
| 10 ms CPU per invocazione | parsing ~0,5 ms per pagina, max ~17 pagine per tick |
| KV: 1.000 scritture/giorno | si scrive solo quando i dati cambiano |
| 50 sotto-richieste per invocazione | max 17 per tick |

## Installare l'app sul telefono
- **iPhone (Safari)**: Condividi → *Aggiungi alla schermata Home*.
- **Android (Chrome)**: menu ⋮ → *Installa app*.

## Sviluppo
```bash
cd worker
npm test                 # test dei parser
npx wrangler dev         # Worker + PWA in locale su http://localhost:8787
```
