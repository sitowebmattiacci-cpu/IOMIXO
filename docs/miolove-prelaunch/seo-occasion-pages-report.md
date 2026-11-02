# MIOLOVE — 12 pagine per occasione: report di consegna (locale, nulla pubblicato)

Data: 2026-11-02 · Ramo `feat/miolove-seo-occasion-pages` · base di produzione `479804e` · **nessun push, nessun deploy**.
Legenda: **[V]** fatto verificato · **[M]** valutazione motivata · **[I]** ipotesi · **[T]** verifica ancora necessaria.

## 1. Audit iniziale (fase A)
| Area | Esito | Tipo |
|---|---|---|
| Registro pagine (`pages.ts`), routing, middleware | Una voce per pagina; sitemap, canonical, hreflang, 404 delle bozze derivano dal registro. Le URL non pubblicate non sono riscritte dal middleware e rispondono 404 (incl. `/es/bodas`, `/en/baptism`, `/de/…`) | [V] |
| Canonical / hreflang / x-default | Autoreferenziali, set identico e reciproco in tutte le lingue di una pagina, x-default = italiano; `og:locale:alternate` solo per le lingue in cui la pagina esiste | [V] |
| Sitemap / robots | 22 URL (4 home, 4 guide, 12 occasioni, privacy, terms), 80 alternate `xhtml:link`; robots: `Allow /`, `Disallow /api/`, nessun album privato | [V] su build di produzione locale |
| HTML lato server | I testi SEO sono nell'HTML della risposta; `<html lang>` coerente con URL e testo in tutte le 12 pagine; un solo H1; gerarchia titoli senza salti | [V] |
| Dipendenze JS | Un visitatore nuovo non avvia Firebase/App Check/reCAPTCHA (0 richieste esterne su 24 caricamenti); First Load JS delle 3 route = 258 kB contro 261 kB della home | [V] |
| `/matrimonio` (57ce845) | Coerente con il prodotto. Correzione trovata e fatta: il testo diceva "illimitati" ma il server limita a 500 contenuti per invitato (anti-abuso) e a 150 MB per video → ora si dichiara il limite reale, letto dalla configurazione | [V] |
| Sovrapposizione con la home | I title delle 4 home contengono già "matrimoni e feste" (IT/FR/ES) e "wedding & event" (EN): stesso campo semantico del matrimonio. **Non modificati** (richiesta). | [M] rischio |
| Copy esistente "foto e video illimitati" / "invitati illimitati" nelle schede piano della home e della pagina pagamenti | Non ho toccato: va allineato in una decisione separata (stessa imprecisione che ho corretto nelle nuove pagine) | [M] da decidere |
| Prezzo barrato 39,99 nella home e nel checkout | Fuori perimetro; **non compare** nelle 12 pagine (test). Conformità Omnibus ancora aperta | [T] |
| Valuta EN | 19,99 **dollari**: `plans.ts` replica la cifra in euro senza conversione, decisione del titolare ancora in sospeso (dichiarata nel file) | [T] |

## 2. Ricerca competitiva
Vedi `seo-wedding-international-research.md` (fonti, query, data, limiti). In sintesi: nessuna SERP geolocalizzata disponibile, nessun volume, nessuna posizione. Concorrenti effettivamente letti: Wedibox, Knipsmig, WedShoots/Bodas.net, Event Memories (matrimonio.com), ABC Salles. Lazoo, Piktura e Medley: nessun risultato pertinente, **non analizzati**.

## 3. Mappa keyword (qualitativa: nessun volume/difficoltà inventati)
| Pagina | Keyword principale | Secondarie | Intento | Rischio di cannibalizzazione |
|---|---|---|---|---|
| IT matrimonio | album foto matrimonio QR code | raccogliere foto invitati matrimonio · condividere foto matrimonio senza app | commerciale (confronto) → transazionale | medio con la home (titolo "matrimoni e feste") |
| EN wedding | wedding photo album QR code | wedding photo sharing · collect wedding guest photos · no app | commerciale | medio con home EN |
| FR mariage | album photo de mariage QR code | partager les photos de mariage avec les invités · QR code mariage | informativo + commerciale | medio con home FR |
| ES boda | álbum de fotos de boda código QR | compartir fotos de boda invitados · fotos de casamiento QR | informativo + commerciale | medio con home ES ("bodas y fiestas") |
| IT compleanno | album foto compleanno QR code | album condiviso compleanno · foto festa invitati | informativo → commerciale | basso |
| EN birthday | birthday photo sharing QR code | birthday party photo album | informativo → commerciale | basso |
| FR anniversaire | album photo d'anniversaire QR code | partager photos anniversaire · goûter d'anniversaire | informativo | basso |
| ES cumpleaños | álbum de fotos de cumpleaños código QR | álbum compartido cumpleaños · fiesta infantil · XV años (solo nominato) | informativo | basso |
| IT battesimo | album foto battesimo QR code | foto battesimo condivise · album famiglia battesimo | informativo/di nicchia | basso |
| EN christening | christening photo album QR code | baptism photo sharing | informativo/di nicchia | basso |
| FR baptême | album photo de baptême QR code | partager photos baptême | informativo/di nicchia | basso |
| ES bautizo | álbum de fotos de bautizo código QR | fotos del bautizo compartidas | informativo/di nicchia | basso |
Pagine in relazione con la guida "Idee" (intento: giochi fotografici): diverso; le due si collegano a vicenda.

## 4. Schede delle 12 pagine
Title/H1/description effettivi: tabella in §5 del messaggio di consegna e nei file `locales/miolove/public/*.json`. Per ogni pagina: URL (v. sotto), canonical = URL, hreflang = le altre 3 lingue della stessa occasione + x-default italiano, dati strutturati = `WebPage` + `BreadcrumbList` + `FAQPage` (5 FAQ visibili e identiche al markup), immagine = foto di copertina dell'occasione già nel progetto (AVIF/WebP responsive esistenti, dimensioni esplicite) + card social 1200×630 dedicata (60-70 KB), link in ingresso da home (carta occasione), guida Idee (blocco occasione), footer di ogni pagina pubblica e dalle altre due occasioni, link in uscita alla sezione della guida e alle altre occasioni.
| Occasione | IT | EN | FR | ES |
|---|---|---|---|---|
| Matrimonio | `/matrimonio` | `/en/wedding` | `/fr/mariage` | `/es/boda` |
| Compleanno | `/compleanno` | `/en/birthday` | `/fr/anniversaire` | `/es/cumpleanos` |
| Battesimo | `/battesimo` | `/en/christening` | `/fr/bapteme` | `/es/bautizo` |

## 5. Elenco prioritario per la revisione madrelingua (FR/ES; EN consigliata)
Non è stata fatta nessuna revisione madrelingua: **da fare prima della pubblicazione**. Cosa far controllare, in ordine:
1. H1, title, description e CTA delle 12 pagine (`occasions.*.meta`, `hero`, `cta`).
2. FR: «vin d'honneur», «goûter d'anniversaire», «dragées», «livret de cérémonie», registro (vous), tipografia (spazi non separabili già inseriti), «appli» vs «application».
3. ES: neutralità (tú; "video", "teléfono", "tomar fotos"; evitati *vosotros, móvil, vídeo, ordenador, computadora*), «pastel (la torta o la tarta)», «recuerditos», «XV años / quinceañera», «casamiento», «tele/televisor», «boda» come unico URL.
4. EN: "christening & baptism", "unplugged ceremony", "sweet sixteen", "order of service", "party favors", spelling statunitense.
5. Frasi con limiti (anti-abuso 500, 150 MB, 50 MB) e prezzo: devono restare esattamente quelle del prodotto.

## 6. Strategia dei link interni [V implementata] e collegamenti esterni [piano]
- Interni: home → 3 carte occasione (anchor `<a>`, intera carta cliccabile); guida Idee → blocco occasione con link «Scopri l'album per questa occasione»; footer → 3 occasioni; occasione → guida (sezione dell'occasione) e → le altre due; breadcrumb visibile. Test: `OCC-11`, più verifica sulla build (24 pagine, 24 link interni, tutti 200).
- Esterni (piano, nulla attivato): contenuti realmente utili per fotografi, wedding planner, location e organizzatori (guide "dove mettere il QR code", checklist stampabile); presentazioni a wedding planner con prova gratuita; valutazione di collegamenti editoriali da Wedding Day Event e Nozze360 **solo** se hanno un contenuto in cui MIOLOVE è realmente utile e senza contropartita economica; nessun acquisto di link, nessuna rete di siti.
- Fiducia [piano]: screenshot reali di un album (con consenso), spiegazione chiara di prezzi e limiti (già nelle pagine), testimonianze solo autentiche e autorizzate (oggi nessuna: `aggregateRating` non usato).

## 7. Search Console e crescita a 90 giorni (piano, nulla attivato)
Stato iniziale noto: proprietà verificata, sitemap con 10 URL letta, home IT indicizzata, richieste inviate per le home EN/FR/ES, 7 impressioni e 2 clic, query "mio love" (brand). Le richieste di indicizzazione non equivalgono all'indicizzazione.
- **Dopo un deploy autorizzato**: controllo HTTP delle 12 URL; sitemap a 22 URL; ispezione URL di un campione per lingua (canonical scelto da Google = dichiarato?); verifica hreflang senza errori di conferma; monitor impressioni/clic separando query brand ("miolove", "mio love") da non-brand; analisi per paese, pagina, query.
- **Giorni 1-30**: indicizzazione, errori tecnici, pagine non scoperte, distribuzione per lingua.
- **Giorni 31-60**: query emergenti, CTR e title, contenuti con impressioni pertinenti, collaborazioni editoriali autentiche, materiali dimostrativi reali.
- **Giorni 61-90**: visibilità non-brand, pagine con più potenziale, sovrapposizioni con la home (e decisione sul title delle home), nuove occasioni **solo se** i dati lo giustificano (anniversari, lauree, XV años/quinceañera, eventi aziendali).
- Nessuna promessa di traffico o vendite.

## 8. Verifiche eseguite / non eseguite
| Verifica | Esito |
|---|---|
| Suite unit completa (`tests/unit/*.test.ts`) | **198/198 passati** (14 test nuovi in `miolovaOccasions.test.ts`) |
| Build di produzione (`next build`) | **riuscita** (nel worktree servono i `node_modules` del backend: collegati con symlink non committati) |
| Audit su `next start` (12 URL × mobile 390 px e desktop 1280 px) | 24/24: 200, un H1, nessun overflow, nessuna immagine rotta o senza alt/dimensioni, JSON-LD valido, canonical/hreflang/x-default corretti, 0 richieste Firebase/Google, breadcrumb, link alla guida e alle altre occasioni presenti, 5 FAQ visibili |
| URL non pubblicate | 404 su `/es/bodas`, `/en/baptism`, `/en/weddings`, `/es/quinceaneras`, `/de/…`, `/pt-br/…` |
| LCP/CLS in laboratorio (build locale, loopback, senza throttling) | LCP 88-192 ms, CLS ≤ 0,034 — **misura di laboratorio non rappresentativa**: non è un dato di campo e non dimostra il rispetto delle soglie (LCP ≤ 2,5 s, CLS ≤ 0,1) su rete reale |
| INP | **non misurato** |
| Lighthouse | **non eseguito** |
| Test browser (`tests/browser`) e Firebase (`tests/firebase`) | **non eseguiti**: richiedono gli emulatori Firebase e Chrome con il loro harness; i test unit coprono le regressioni sul registro, routing, sitemap e testi, ma la regressione visiva della home (che ora ha link nelle carte e nel footer) non è stata verificata dalla suite browser |
| Accessibilità | controlli di base (alt, nomi di link/pulsanti, gerarchia titoli) superati; **nessun audit axe/screen reader** |
| Dati strutturati | JSON-LD analizzato e coerente con le FAQ visibili; **non validato con il Rich Results Test di Google** (non raggiungibile da qui) |

## 9. Problemi aperti (legali/commerciali, non risolti qui)
Prezzo barrato 39,99 e regole Omnibus · valuta USD per EN · testi "illimitati" delle schede piano · revisione legale di privacy/termini (bozze) · dati fiscali del venditore · Stripe/checkout: **non toccati**.
