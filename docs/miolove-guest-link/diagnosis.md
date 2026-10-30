# MIOLOVE — link invitati / QR code: diagnosi tecnica (2026-10-29)

Stato: **solo locale**. Nessun deploy, push, commit; nessuna modifica a Stripe, scadenze, Firebase di produzione, App Check o album dei clienti.

## Sintesi onesta

- **Il guasto del Xiaomi 14T NON è riprodotto.** Né in produzione (richieste HTTP con UA Android), né in locale (Chromium con UA Xiaomi, WhatsApp WebView, Facebook in-app, iPhone Safari). Non è stata trovata una causa dimostrata e non ne viene dichiarata una.
- Il percorso lato piattaforma è **pulito**: nessun redirect nascosto, nessuna navigazione ripetuta, nessun `history.back/replace` nel codice della pagina `/live`.
- Sono stati trovati e corretti **tre punti reali di fragilità** (sotto) e una **ipotesi concreta non provata** (manifest PWA). Sono stati preparati strumenti per catturare il guasto sul telefono vero (`/diag`).

## Percorso analizzato (QR/link → rendering)

| Passo | Evidenza | Esito |
|---|---|---|
| DNS/hosting | `curl` su `miolovealbum.com/live/<slug>` con UA Xiaomi: HTTP/2 200, 0 redirect, `no-store`, `x-robots-tag: noindex` | ok |
| `http://` | 301 → `https://miolovealbum.com:443/live/<slug>` (redirect del bilanciatore Google; l'URL ha `:443` esplicito, innocuo ma non canonico) | nota |
| `www.` | 308 → apex, path e query conservati (middleware) | ok |
| Slash finale | 308 → senza slash | ok |
| `?utm=` | 200, query conservata | ok |
| Middleware | solo redirect `www` e header robots; nessuna logica per User-Agent/cookie | ok |
| `useEventBrand` / `portalRedirect` | `window.location.replace` solo se il dato dell'evento dice che appartiene all'altro portale; decisione dal dato dell'evento, mai dall'host → nessun ciclo. Un album MIOLOVE su `miolovealbum.com` non reindirizza | ok |
| HTML iniziale | solo "Caricamento…": la pagina è interamente client-rendered (JS → sign-in anonimo → callable `getPublicEvent` → render) | fragile (vedi 1) |
| App Check | token exchange 403 in headless, ma lato Firebase è **non enforced** su Auth/Firestore/Storage; `getPublicEvent` e le callable foto hanno ENFORCE=false. Non blocca l'album | ok |
| Cookie/Storage | niente cookie necessari per `/live`; Auth usa IndexedDB con fallback. Test GU4: album + upload funzionano con storage, IndexedDB, cookie e service worker negati | ok |
| Service worker | non esiste (`/sw.js` 404) | ok |
| assetlinks / deep link Android | `/.well-known/assetlinks.json` 404: nessuna app nativa che possa catturare il link | ok |
| **Manifest PWA** | ogni pagina, **guest incluse**, dichiarava `<link rel=manifest>` con `display: standalone`, `start_url: /`, scope implicito `/` | **ipotesi (vedi 4)** |

## Problemi reali trovati e corretti (con test)

1. **Caricamento senza uscita.** Se una richiesta restava appesa (rete filtrata, browser integrato), l'invitato vedeva "Caricamento…" per sempre. Ora dopo 12 s compare "La connessione è lenta" + pulsante **Riprova** (`components/live/GuestLoadState.tsx`, usato da `/live` e `/booth`). Test GU6.
2. **Errore di rete = "Sessione non trovata".** Qualsiasi errore (503, rete, App Check) mostrava "non trovata", che per l'invitato equivale a un QR rotto. Ora solo `event_not_found` dice "non trovata"; gli altri errori mostrano un messaggio di caricamento fallito con Riprova (`isEventNotFound`). `/booth` mostrava inoltre "non trovata" già durante il caricamento normale: ora mostra il caricamento. Test GU6, GU7.
3. **Firestore senza fallback di trasporto.** Il canale streaming di default è bloccato da alcuni browser integrati/proxy; l'upload dipende da una lettura Firestore (slug → evento). Ora `experimentalAutoDetectLongPolling: true` (non con gli emulatori): dove lo streaming funziona non cambia nulla, altrimenti passa a long polling. **Hardening di prassi Firebase, non una causa dimostrata del guasto.**
4. **Manifest PWA sulle pagine invitato** (`/live`, `/booth`, `/screen`): rimosso (`manifest: null`, `lib/guestPageMetadata.ts`). **Ipotesi, non prova:** "si apre e torna indietro" è il comportamento tipico di Chrome Android quando un link nello scope di una PWA installata/installabile viene passato alla web-app (link capturing) e questa non lo gestisce. La home e l'area dei proprietari mantengono il manifest. Se l'ipotesi è falsa il cambiamento è comunque corretto (un link invitato non deve essere installabile). Test GU1, GU3.

## Strumento diagnostico per il telefono vero: `/diag`

Pagina `miolovealbum.com/diag?slug=<slug>` (noindex, nessun invio di dati: il report resta a schermo). Nel report lo slug, query e hash sono mascherati (`/live/<slug>`), il referrer è ridotto al solo dominio, e non vengono letti cookie, token, contenuto degli storage né dati di account/album: solo user-agent, esito dei test e indirizzi senza slug. Registra: user-agent, referrer, tipo di navigazione e `redirectCount`, `history.length`, display-mode (standalone = aperta come app), cookie/localStorage/IndexedDB/service worker, raggiungibilità di Identity Toolkit, Firestore, App Check, reCAPTCHA, Functions, Storage con tempi, eventi `pageshow/pagehide/visibilitychange/popstate/beforeunload`, e — con `?slug=` — carica la vera pagina `/live/<slug>` in un frame e registra ogni indirizzo attraversato e se ha disegnato contenuto.

**Istruzioni (serve un deploy per renderlo raggiungibile; non fatto):**
1. Sul Xiaomi apri `https://miolovealbum.com/diag?slug=<slug album>` **dal punto in cui fallisce**: incollandolo in un messaggio WhatsApp a sé stessi e toccandolo; poi scansionandolo come QR da fotocamera/Google Lens; poi da Chrome.
2. Aspetta 30 s, tocca **Copia report**, incolla nel messaggio. Un report per ogni canale (WhatsApp, QR, Chrome).
3. Cosa cercare: `displayMode: standalone` (aperto come app → conferma l'ipotesi manifest); `frame url` che cambia o `frame non leggibile`; `pagehide`/`beforeunload` subito dopo l'apertura; endpoint "NON raggiungibili"; `indexedDB ERRORE`.
4. Se `/diag` stessa "si apre e torna indietro", il problema è prima dell'app (handler del link di MIUI/WhatsApp/DNS): allora raccogliere `adb logcat` (sotto).

**Cattura dal cavo (opzionale):** Chrome sul PC → `chrome://inspect/#devices`, debug USB attivo sul 14T, aprire il link dal telefono e guardare Network con "Preserve log" (redirect e richieste annullate). Per WhatsApp: `adb logcat -v time | grep -iE "ActivityTaskManager|START u0|miolove|chrome"` mostra quale activity prende l'intent e se viene richiusa.

## Controlli da fare sul telefono (nessuna modifica alle impostazioni dell'utente)

Solo per diagnosi: Chrome → Impostazioni sito → miolovealbum.com; Android → App → "Apri link supportati" (se compare MIOLOVE come app installata, conferma l'ipotesi 4).

## Test

- Unitari: `npm run test:unit` → 207/207 (incluso il guard "nessuna fetch raw alle callable", che `/diag` rispetta).
- Browser (emulatori Firebase 15.34.2 + Next): `tests/browser/miolovaGuestUniversal.test.ts` (vedi risultati nel report di consegna).

## Fuori ambito / non fatto

Deploy, push, commit, modifiche a Stripe/scadenze/App Check/regole, dati dei clienti, nuove lingue (il tedesco resta draft: aggiunte solo 3 chiavi a `de-shared.json` per parità).
