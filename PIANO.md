# Winter Sports 2026/27 — Piano di progetto

PWA personale (mobile-first, in italiano) per seguire la Coppa del Mondo 2026/27 (+ Mondiali)
di **sci alpino, biathlon, sci di fondo e salto con gli sci**, maschile e femminile.

---

## 1. Verifica delle fonti dati (22/11/2026)

| Fonte | Esito | Note |
|---|---|---|
| FIS `calendar-results.html` (AL / CC / JP, `seasoncode=2027`, `categorycode=WC`) | ✅ OK | HTML server-side. AL: 37 tappe, CC: 13, JP: 23. Ogni riga ha `id="<eventid>"`, date, località, nazione, disciplina, genere, stato "cancelled". |
| FIS `event-details.html?eventid=…` | ✅ OK | Elenco gare della tappa con `raceid`, specialità, genere e **orario con fuso esplicito**: `data-iso-date="2026-10-24T10:30:00+02:00"` + `data-timezone="Europe/Vienna"`. |
| FIS `results.html?raceid=…` | ✅ OK | Tabella `#events-info-results`: posizione, pettorale, codice FIS, nome (`.athlete-name`), anno, nazione (`.country__name-short`), tempi manche, totale, distacco, punti Coppa. |
| FIS `cup-standings.html` | ✅ OK | Classifica generale di Coppa per settore/genere. |
| biathlonresults.com `…/sportapi/api/…` | ❌ **401 Unauthorized** | Da novembre 2026 richiede autorizzazione. Non usata. |
| **biathlonworld.com** (sito ufficiale IBU) | ✅ **Fonte biathlon scelta** | Pagine Next.js con i dati in `__NEXT_DATA__`: `/calendar` = tutte le tappe + gare della tappa corrente; `/results/<RaceId>` = orario UTC, stato e classifica completa (tempo, distacco, poligoni, punti WC, staffette con frazionisti). Le gare delle tappe future si scoprono provando gli id `<EventId><codice>` (es. `BT2627SWRLCP06SWMS`); un id inesistente risponde 500. |

**Fuso orario FIS:** l'orario è quello locale della località di gara, ma la pagina espone già
l'istante assoluto (ISO con offset). Il Worker salva sempre l'istante in **UTC**
(`startUtc`), il frontend lo mostra con `Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome' })`.
Così gare in Nord America, Asia o Scandinavia risultano corrette anche col cambio ora legale.

---

## 2. Architettura

```
            ┌──────────────── Cloudflare (piano gratuito) ────────────────┐
 FIS  ───►  │  Worker  ── Cron "*/10 * * * *" ──► scraper per sport ──► KV │
 IBU  ───►  │     │                                   (normalizza)        │
            │     ├── GET /calendar /results/:id /standings/:s (JSON+CORS)│
            │     └── file statici della PWA (Workers Static Assets)      │
            └─────────────────────────────────────────────────────────────┘

Hosting: tutto su Cloudflare (come le altre webapp), un solo deploy, stesso dominio.
```

### Vincoli del piano gratuito e come li rispettiamo
| Limite free | Strategia |
|---|---|
| 10 ms di CPU per invocazione | Parsing con **HTMLRewriter** (nativo, in streaming) invece di regex/DOM su tutta la pagina; lavoro **incrementale**: ogni tick cron fa solo una porzione (vedi sotto). L'attesa di rete non conta come CPU. |
| 50 sotto-richieste per invocazione | Max ~20 fetch per tick. |
| KV: 1.000 scritture/giorno, 100.000 letture/giorno | Si scrive **solo se il contenuto è cambiato** (hash confrontato). 144 tick/giorno × poche chiavi = ampio margine. Le letture del frontend passano dalla Cache API del Worker (60 s). |
| Cron trigger: max 5 per account | **Un solo** cron ogni 10 min; il Worker decide da sé se lavorare. |

### Logica di aggiornamento (aggiornata: cron ogni 30 minuti)
- **Finestre di gara** (da 15' prima della partenza fino ai risultati salvati, max 4 ore): aggiornamento a ogni tick (30 min).
- **Fuori dalle gare**: un aggiornamento ogni ~3 ore.
- **Pulsante "Aggiorna"** nell'app (`POST /refresh`): aggiornamento immediato, al massimo ogni 5 minuti.

Logica originale (superata):
1. Legge `meta:state` da KV.
2. **Giorno di gara** (almeno una gara oggi in ora italiana, o una gara "in corso"): lavora a ogni tick (10 min).
   Altrimenti lavora solo se l'ultimo aggiornamento ha più di 30 min.
3. Priorità del lavoro di ogni tick:
   1. risultati delle gare iniziate e non ancora "concluse" (in corso / appena finite);
   2. dettagli delle tappe nei prossimi/ultimi 7 giorni (orari aggiornati, annullamenti);
   3. a rotazione, una piccola porzione del resto del calendario e una classifica di Coppa.
4. Se il parsing di una fonte fallisce o restituisce dati vuoti/sospetti → **non si sovrascrive**
   il dato in KV; si registra l'errore in `meta:health` e l'app continua a mostrare l'ultimo dato valido.

---

## 3. Struttura del progetto

```
wintersports/
├── PIANO.md                    ← questo file
├── README.md                   ← istruzioni di setup (Cloudflare)
├── worker/
│   ├── wrangler.toml           ← nome worker, binding KV, cron
│   ├── package.json            ← wrangler + vitest (solo dev)
│   ├── src/
│   │   ├── index.js            ← router HTTP (fetch) + handler cron (scheduled)
│   │   ├── schema.js           ← costanti, validazione del formato comune, id
│   │   ├── store.js            ← lettura/scrittura KV con hash e "ultimo dato valido"
│   │   ├── scheduler.js        ← decide cosa aggiornare a ogni tick
│   │   ├── time.js             ← conversioni fuso / "oggi in ora italiana"
│   │   └── sources/
│   │       ├── fis/
│   │       │   ├── common.js   ← parser HTML FIS condivisi (calendario, tappa, risultati, classifiche)
│   │       │   ├── alpine.js   ← mappe specialità AL (SL, GS, SG, DH, AC, PGS…)
│   │       │   ├── crosscountry.js
│   │       │   └── jumping.js
│   │       └── biathlon.js     ← (fonte da decidere, vedi §8)
│   └── test/
│       ├── fixtures/           ← pagine HTML/JSON reali salvate
│       └── *.test.js           ← test dei parser sulle fixture
└── web/                        ← PWA, servita dal Worker (Static Assets)
    ├── index.html
    ├── manifest.webmanifest
    ├── sw.js                   ← service worker (cache offline)
    ├── icons/
    ├── css/app.css
    └── js/
        ├── app.js              ← avvio, routing a hash (#/calendario, #/risultati/…)
        ├── api.js              ← fetch + cache dell'ultimo dato
        ├── config.js           ← URL del Worker
        ├── format.js           ← date/ore in Europe/Rome, nomi in italiano
        └── views/
            ├── calendar.js     ← "Oggi in gara", prossime gare, settimana/mese, filtri
            ├── results.js      ← podio + classifica espandibile
            └── standings.js    ← classifiche di Coppa
```

### Scelta del frontend: **HTML/CSS/JavaScript puro (moduli ES), senza build**
- Cloudflare serve i file così come sono: nessuna build e nessuna pipeline da mantenere.
- L'app ha 3 viste e pochi dati: un framework aggiungerebbe peso senza benefici reali.
- Prestazioni ottime su mobile (pochi KB), service worker semplice da scrivere a mano.
- Se in futuro servisse più interattività si può aggiungere **Preact + htm** da CDN senza cambiare struttura.

---

## 4. Schema JSON comune

Convenzioni: date/ore in **UTC ISO 8601** (`...Z`); il frontend converte in Europe/Rome.
Codici nazione IOC/FIS a 3 lettere (`ITA`). `sport` ∈ `alpine | biathlon | crosscountry | jumping`.
`gender` ∈ `M | F | X` (X = staffette/gare miste).

### Gara (`Race`) — elemento del calendario
```json
{
  "id": "fis-al-131577",
  "sport": "alpine",
  "source": { "name": "fis", "raceId": "131577", "eventId": "62771",
              "url": "https://www.fis-ski.com/DB/general/results.html?sectorcode=AL&raceid=131577" },
  "competition": "WC",
  "discipline": "GS",
  "disciplineName": "Slalom gigante",
  "gender": "F",
  "location": "Sölden",
  "country": "AUT",
  "startUtc": "2026-10-24T08:30:00Z",
  "localTimezone": "Europe/Vienna",
  "timeTbc": false,
  "status": "finished",
  "hasResults": true,
  "runs": [
    { "label": "1ª manche", "startUtc": "2026-10-24T08:30:00Z" },
    { "label": "2ª manche", "startUtc": "2026-10-24T11:30:00Z" }
  ],
  "updatedAt": "2026-10-24T13:10:00Z"
}
```
- `status`: `scheduled` (in programma) · `live` (in corso) · `finished` (conclusa) · `cancelled` (annullata) · `postponed` (rinviata).
- `competition`: `WC` (Coppa del Mondo) · `WSC` (Mondiali) · `OWG` (Olimpiadi, se presenti).
- `discipline`: codice breve normalizzato per sport (es. AL: `DH SG GS SL AC PSL`; CC: `SPR TSP DIST MS PUR REL SKIATHLON`; JP: `NH LH FH TEAM SUPERTEAM` con `hillSize: 140`; BT: `SP PU IN SI MS RL MRL SMRL`).
- `disciplineName`: etichetta già in italiano (es. "Sprint tecnica libera", "Trampolino HS140").

### `GET /calendar` → calendario completo
```json
{
  "season": "2026/27",
  "generatedAt": "2026-11-22T14:40:00Z",
  "sources": { "alpine": { "ok": true, "updatedAt": "…" }, "biathlon": { "ok": false, "error": "…", "updatedAt": "…" } },
  "races": [ Race, … ]
}
```

### `GET /results/:raceId` → risultato di una gara
```json
{
  "race": Race,
  "final": true,
  "resultType": "time",
  "columns": ["run1", "run2"],
  "rows": [
    { "rank": 1, "bib": 6, "athleteId": "fis-155859", "name": "MOLTZAN Paula", "nation": "USA",
      "time": "2:14.82", "gap": null, "points": null, "cupPoints": 100,
      "extra": { "run1": "1:07.86", "run2": "1:06.96" }, "status": null },
    { "rank": null, "name": "…", "nation": "ITA", "status": "DNF" }
  ],
  "updatedAt": "…"
}
```
- `resultType`: `time` (alpino, fondo, biathlon) o `points` (salto).
- `extra`: colonne specifiche per sport (manche; per il biathlon `shooting: "0+1+0+0"`, `penalties: 1`; per il salto `jump1Distance`, `jump2Distance`).
- `status` per non classificati: `DNF`, `DNS`, `DSQ`, `DNQ`, `LAP`.
- L'evidenziazione degli italiani la fa il frontend su `nation === "ITA"`.

### `GET /standings/:sport` → classifiche generali di Coppa
```json
{
  "sport": "alpine",
  "updatedAt": "…",
  "standings": [
    { "id": "overall-F", "label": "Generale femminile", "gender": "F", "discipline": "ALL",
      "rows": [ { "rank": 1, "athleteId": "fis-…", "name": "…", "nation": "ITA", "points": 450, "gap": 0 } ] }
  ]
}
```

### Chiavi KV
| Chiave | Contenuto |
|---|---|
| `cal:<sport>` | `Race[]` di quello sport (ultimo dato valido) |
| `res:<raceId>` | risultato della gara |
| `std:<sport>` | classifiche di Coppa |
| `meta:state` | cursori di rotazione, ultimo aggiornamento per fonte |
| `meta:health` | ultimi errori di parsing per fonte |

`/calendar` unisce i 4 `cal:<sport>` al volo (lettura economica, risposta in cache 60 s).

---

## 5. Frontend (anteprima)
- **Barra in basso** (pollice-friendly): Calendario · Risultati · Coppa.
- **Calendario**: in alto il riquadro *Oggi in gara* (con badge "IN CORSO"); sotto, la lista *Prossime gare*
  raggruppata per giorno; interruttore *Lista / Settimana / Mese*; chip di filtro per sport e M/F
  (ricordati in `localStorage`). Colori: alpino 🔴, biathlon 🟣, fondo 🟢, salto 🔵.
- Tocco su una gara conclusa → apre direttamente `#/risultati/<raceId>`.
- **Risultati**: schede per sport, gare dalla più recente; podio (oro/argento/bronzo) sempre visibile,
  "Mostra classifica completa" espandibile; righe ITA evidenziate con 🇮🇹.
- **Offline**: il service worker conserva l'app e l'ultima risposta JSON; banner "Dati aggiornati alle hh:mm".

---

## 6. Fasi
1. ✅ **Worker + biathlon + frontend base**
2. ✅ **Sci alpino** (anticipato su richiesta: Coppa del Mondo + Mondiali di Crans-Montana, prove escluse)
3. ✅ **Salto con gli sci** (WC + Mondiali di Falun; qualificazioni e Four Hills esclusi. Nota: FIS non pubblica l'HS nelle pagine HTML, si mostra il tipo di trampolino)
4. ✅ **Sci di fondo** (WC + Tour de Ski + Mondiali di Falun; qualificazioni sprint escluse, batterie della sprint mostrate)
5. ✅ **Classifiche di Coppa** (FIS ufficiali per alpino/fondo/salto, calcolate per il biathlon) + **Tournée dei 4 trampolini**, HS nel nome delle gare di salto, aggiornamenti calibrati sulle gare + pulsante "Aggiorna", service worker completa

Alla fine di ogni fase: commit sul branch, istruzioni per provarla, stop per i tuoi test.
Ogni parser ha test automatici su pagine reali salvate, così un cambio di layout FIS si nota subito.

---

## 7. Configurazione (riassunto; i passi dettagliati saranno nel README alla fine della fase 1)

**Cloudflare** (account gratuito)
1. `npm i -g wrangler` (o `npx wrangler`) → `wrangler login`.
2. `wrangler kv namespace create WINTER_KV` → copi l'`id` in `worker/wrangler.toml`.
3. Il cron è già dichiarato in `wrangler.toml` (`crons = ["*/10 * * * *"]`), si attiva col deploy.
4. `cd worker && npx wrangler deploy` → ottieni `https://wintersports.<tuo-sottodominio>.workers.dev`.
5. Log in tempo reale: `npx wrangler tail`.

**Frontend**: servito dallo stesso Worker (cartella `web/`), nessuna configurazione aggiuntiva.

**Chi lo fa**: Claude, con un *API token* Cloudflare (modello "Edit Cloudflare Workers") salvato in modo
sicuro nell'ambiente (mai in chat). Passi manuali alternativi nel README.

---

## 8. Decisioni prese
- **Biathlon**: fonte = sito ufficiale IBU biathlonworld.com (vedi §1). Se in futuro l'IBU concedesse una chiave API personale, basterà sostituire `worker/src/sources/biathlon.js`.
- **Hosting**: PWA su **Cloudflare Pages** (`wintersports-marchio11.pages.dev`, collegato a GitHub come le altre webapp); dati e cron sul Worker `wintersports`.
- **Deploy**: lo fa Claude con un API token Cloudflare fornito dall'utente.
