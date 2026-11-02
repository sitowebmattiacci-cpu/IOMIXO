# MIOLOVE — revisione finale pre-deploy delle 12 landing SEO

Data: 2026-11-02 · worktree `/Users/macbookpro/Desktop/IOMIXO-seo` · ramo `feat/miolove-seo-occasion-pages` · base di produzione `479804e` · **nessun push, nessun deploy**.
Legenda: **[V]** verificato con evidenza · **[M]** valutazione · **[T]** richiede intervento o autorizzazione umana.
Tutte le misure sono **di laboratorio, su build di produzione locale** (`next build` + `next start`, indirizzi `miolovealbum.com:3112` mappati a 127.0.0.1 nel browser, nessuna richiesta al dominio reale): non sono dati reali degli utenti.

## 1. Stato del ramo
`00a9c18` (HEAD precedente) + un commit di correzioni (v. §5). Base `479804e`. Il worktree contiene solo modifiche MIOLOVE (locales, componenti occasion, registro, seo, test, docs, 3 card social e il suo script).

## 2. Revisione linguistica
Letti per intero i testi delle 12 pagine e i relativi metadata (title, description, OG, H1, passi, momenti, FAQ, prezzo, CTA). **Non è una revisione madrelingua.** Errori dimostrabili trovati e corretti (3):
| Lingua | Dove | Prima → Dopo |
|---|---|---|
| FR | compleanno, `why.p1` | «trop occupé» (concordanza con «celui ou celle») → «trop occupé(e)» |
| EN | christening, FAQ q3 | "the dressing of the baby" (non idiomatico) → "the baby getting dressed" |
| IT | battesimo, FAQ q3 | «della vestizione» (termine ecclesiastico, ambiguo) → «dei preparativi in casa» |
Verificato e lasciato invariato: coerenza title/H1/contenuto in ogni lingua; terminologia (matrimonio/tableau/ricevimento; mariage/vin d'honneur/dragées/goûter; boda/novios/recuerditos/XV años; wedding/reception/order of service/party favors); ES neutro (nessun *vosotros, móvil, vídeo, ordenador, computadora*); typografia francese con spazi non separabili. Residui [M, non errori]: EN usa ortografia statunitense ("guest of honor", "program", "favors"): comprensibile nel Regno Unito ma non britannica; ES «tele/televisor/pastel (torta, tarta)»: scelta di compromesso.

## 3. Audit SEO tecnico (build di produzione locale) [V]
| Controllo | Esito |
|---|---|
| 12 route | tutte 200 (24 caricamenti: 12 × mobile 390 px, 12 × desktop 1280 px); URL non pubblicate (`/es/bodas`, `/en/baptism`, `/en/weddings`, `/es/quinceaneras`, `/de/…`, `/pt-br/…`) → 404 |
| H1 | uno per pagina; nessun salto di livello nei titoli |
| Title / description | presenti, unici, 48-58 e 152-160 caratteri |
| Canonical / hreflang | canonical = URL della pagina; set hreflang identico nelle 4 lingue di ogni occasione, autoreferenziale, x-default = italiano |
| Sitemap / robots | 22 URL (4 home, 4 guide, 12 occasioni, privacy, terms) con 80 alternate; robots `Allow /`, `Disallow /api/`; tutte le pagine `index, follow` |
| JSON-LD | `WebPage` + `BreadcrumbList` + `FAQPage`, parsabile, 5 FAQ identiche alle visibili; nessun rating/review/offerta. **Non validato con il Rich Results Test di Google** [T] |
| Link interni | nessuna pagina orfana: home (carte), guida (blocchi), footer, occasioni tra loro; 24 link interni distinti raccolti dalle pagine → tutti 200 |
| Duplicati | 12 testi con sovrapposizione di frasi tra occasioni ≤ 0,065 (soglia 0,08) e lessico condiviso < 0,3 (test OCC-8/8b) |
| Regressioni sulle home | namespace `home`, `ideas`, `servicePages` **byte-identici a 479804e in tutte e 4 le lingue** (hash pinnati nel nuovo test OCC-12); `middleware.ts`, `sitemap.ts`, `robots.ts`, `indexing.ts`, `layout.tsx` non modificati; title/H1/canonical/hreflang delle 4 home e 4 guide, e `/privacy`, `/terms`, `/login`, `/register` verificati (200, un H1, link a `/register` e `/login` presenti) |
| Immagini social | 3 card JPEG 1200×630, 61-70 KB, servite `200 image/jpeg`; `og:image` e `twitter:summary_large_image` puntano ad esse (test OCC-3b). Lingua-neutrali (foto + logo, nessun testo) |

## 4. Test browser e prestazioni
| Misura | Risultato |
|---|---|
| **axe-core** (WCAG 2.0/2.1 A+AA) su 20 pagine (12 landing + 4 home + 4 guide) × 390 e 1280 px = 40 scansioni | **0 violazioni**; 0 overflow orizzontale; 0 errori in console |
| Responsive | nessun overflow a 390 e 1280 px su tutte le 24 viste landing; nessuna immagine rotta/senza alt/senza dimensioni |
| **Lighthouse 12.2.1** (mobile = Slow 4G simulato + CPU 4×; desktop), 12 landing + home, solo locale | **Accessibilità 100** su tutte le landing (home mobile 96: contrasto, preesistente); **SEO 100** su tutte; **Best practices 79** su tutte *incluso la home*: dovuto a http locale (`is-on-https`, `redirects-http`) e a `bf-cache`, non a difetti delle landing; **Performance desktop 97-98**, **mobile 77-79** (home mobile 83) |
| LCP / CLS (Lighthouse) | **desktop LCP 1,1-1,2 s, CLS ≤ 0,033**; **mobile LCP 5,5-6,1 s** (home mobile 4,7 s), CLS ≤ 0,032, TBT ≤ 55 ms. **Le landing mobile NON rispettano LCP ≤ 2,5 s in questa simulazione severa** (la home, già online, neppure). Elemento LCP: il titolo H1 a ~1,4 s, poi l'immagine di copertina a ~3,5 s con throttling Chrome (Slow 4G, CPU 4×) |
| INP | **non misurato**: Lighthouse lab non lo misura e non c'è una misura attendibile (richiede interazioni reali/CrUX) |
| Dati reali | **nessuno**: la proprietà Search Console non fornisce ancora Core Web Vitals di campo per queste URL |
| Collegamenti visivi nella home e nel footer | verificato con screenshot (carte «Matrimonio / Compleanno / Battesimo» cliccabili, layout invariato; footer con 3 nuove voci a 390 px); clic su una carta → `/matrimonio` |
| Emulatori Firebase / test `tests/browser`, `tests/firebase` | **non eseguiti**: richiedono emulatori e credenziali di test; nessun risultato simulato |

## 5. Modifiche effettuate in questa revisione (solo ambito landing)
1. Tre correzioni linguistiche (§2).
2. **Ripristinata la parte francese di home e guida**: in un passo precedente un mio replace su tutto `fr.json` aveva cambiato 4 stringhe esistenti (spazi dentro le virgolette «»). Ripristinate a come in produzione; nuovo test `OCC-12` che fissa per hash `home`/`ideas`/`servicePages` di tutte le lingue.
Nessun'altra modifica. Nessun file fuori da `locales/`, `tests/` e `docs/`.

## 6. Audit commerciale in sola lettura (nessuna modifica)
| # | Criticità | File : posizione | Testo attuale | Correzione proposta |
|---|---|---|---|---|
| C1 | "Illimitato" non coerente con i limiti tecnici (500 contenuti per invitato anti-abuso; video ≤ 150 MB, foto ≤ 50 MB) | `locales/miolove/{it,en,fr,es}.json` righe 104, 114, 115 (`albumPlan.f.guests`, `.albumMediaPhotos`, `.albumMedia`); `locales/miolove/public/{it,en,fr,es}.json` riga 62 (`home.features.guests.title`) | "Invitati illimitati", "Foto e video illimitati", "Unlimited guests"… | "Nessun limite agli invitati" / "Foto e video senza tetto sull'album" + nota con i limiti reali (come nelle nuove landing); da fare sulla home solo dopo tua approvazione |
| C2 | Prezzo barrato 39,99 | `components/miolove/PlanCards.tsx:52` (`<s>` con `formatAlbumListPrice`); `components/miolove/home/MioloveHome.tsx:328` (sostituisce `{list}` nelle FAQ); `locales/miolove/public/*.json:204` (`home.faq.q4`: «costa {price} (invece di {list})»); `lib/miolove/plans.ts:3,13,21,111` (`ALBUM_LIST_PRICE_EUR`, `ALBUM_PRICING.list`, `formatAlbumListPrice`) | €39,99 barrato accanto a €19,99 | Decisione tua: toglierlo finché la conformità Omnibus (storico del prezzo più basso negli ultimi 30 giorni, uso reale del prezzo di listino) non è verificata. **Le 12 landing non lo mostrano** (test OCC-6) |
| C3 | USD = cifra in euro, senza conversione | `lib/miolove/plans.ts:20-21` (`current: { eur: 19.99, usd: 19.99 }`; commento "DECISION PENDING (owner)"); `lib/pricing.ts:14-16` (inglese → USD); `firebase/functions/src/billing/prices.ts:66` (price id `STRIPE_PRICE_MIOLOVE_ALBUM_USD`) | EN mostra $19.99; il server addebita in USD solo se l'env del price USD esiste | Conferma del prezzo in dollari e **verifica che il Price USD esista in Stripe** (non verificabile da qui: richiede la dashboard/chiavi). Se manca, il checkout EN fallisce |
| C4 | Durata prova / album / conservazione | `home.faq.q3` (7 giorni + 30 giorni di conservazione dopo la prova); `firebase/functions/src/albums/purge.ts:13` (`trialExpiresAt + 30 days`); `lib/miolove/plans.ts` (`TRIAL_DAYS=7`, `TRIAL_MEDIA_LIMIT=50`, 365 giorni) | coerenti con le landing (7 gg, 50 contenuti, 365 gg, +30 gg dopo la prova) | nessuna; da citare anche nelle landing la regola dei +30 giorni solo se vuoi (oggi non è scritta nelle 12 pagine: dicono che "i nuovi caricamenti si fermano") |
| C5 | Nome interno `months12` | `lib/miolove/plans.ts` (`FeatureId 'months12'`, 365 giorni) | solo nome interno, nessun testo pubblico | opzionale: rinominare per chiarezza |
| C6 | Informazioni legali nel ramo | `lib/legal/terms.ts:49,55` ("pagamenti non rimborsabili…"), `lib/legal/privacy.ts` | Il testo di privacy/termini in questo ramo è quello di produzione a `479804e`; le bozze riviste con identificazione del venditore stanno su un altro ramo (`feat/miolove-de-functions`, commit `127179b`, `MIOLOVE_LEGAL_REVIEWED=false`) e **non sono in questa build** | Decisione/revisione legale: quale testo vale al momento della pubblicazione, diritto di recesso per i consumatori UE, dati del venditore. **Non inventati** |
Verifica del checkout (sola lettura): il prezzo e la valuta li decide il server (`albumCheckout.ts`: il client invia solo evento e lingua), l'importo realmente pagato viene letto dal webhook firmato; le pagine mostrano il prezzo da `plans.ts`, quindi l'allineamento con Stripe dipende dai due Price id in ambiente, **non verificabili qui**.

## 7. Criticità
**Bloccanti per la pubblicazione tecnica: nessuna.**
**Condizioni da risolvere con una decisione umana prima di pubblicare** (non difetti del codice):
- revisione madrelingua FR/ES (e consigliata EN) — richiesta esplicita tua per FR/ES;
- C3: esistenza del Price USD in Stripe e conferma 19,99 $ (se la pagina EN va online);
- C6: quale testo legale/identificazione venditore è valido a quella data.
**Non bloccanti (miglioramenti):**
- Performance mobile: LCP simulato 5,5-6,1 s (home 4,7 s). Proposte: precaricare l'immagine di copertina prima del JavaScript; servire a ≤ 430 px una variante AVIF più leggera; ridurre l'hydration. Da misurare in campo dopo il rilascio.
- C1/C2 (testi "illimitato" e prezzo barrato su home e checkout) — richiedono la tua approvazione per toccare la home.
- Pulsante lingua dell'header: Lighthouse segnala `label-content-name-mismatch` (nome accessibile ≠ testo visibile) su **tutte** le pagine incluse home e guida (componente condiviso, preesistente).
- Contrasto su un elemento della home mobile (Lighthouse 96, preesistente).
- Rich Results Test e Search Console URL inspection dopo il deploy.

## 8. Valutazione per la sola pubblicazione SEO
**READY dal punto di vista tecnico** (build, routing, sitemap, canonical/hreflang, dati strutturati, accessibilità axe 0 violazioni, nessuna regressione sulle home). **Pubblicazione subordinata** ai tre punti umani del §7 e alla tua autorizzazione esplicita (ES/FR solo dopo revisione). Le prestazioni mobile sono in laboratorio sotto l'obiettivo LCP ma non peggiori della home già in produzione: da verificare con dati di campo.

## 9. Checklist umana / autorizzazioni
- [ ] Revisione madrelingua FR, ES (e EN) dei testi elencati in `seo-occasion-pages-report.md` §5.
- [ ] Decisione prezzo USD + verifica del Price USD in Stripe (EN).
- [ ] Decisione sul prezzo barrato 39,99 (home/checkout) e allineamento "illimitato" (home) — richiede il tuo OK a toccare la home.
- [ ] Testo legale valido e identificazione del venditore alla data di pubblicazione.
- [ ] Autorizzazione al deploy (procedura già verificata: export pulito del commit, solo backend `iomixo-web`) e al push del ramo.
- [ ] Dopo il deploy: controllo HTTP delle 12 URL e della sitemap a 22 URL; ispezione URL campione in Search Console; Rich Results Test; richiesta di indicizzazione; misura Core Web Vitals di campo.
- [ ] Facoltativo: test browser/Firebase con emulatori (`npm run test:browser`) prima del deploy.
