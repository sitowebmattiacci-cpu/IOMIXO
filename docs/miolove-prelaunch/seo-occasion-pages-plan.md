# Piano di implementazione — 3 pagine per occasione × 4 lingue = 12 pagine SEO

Base: `479804e` (la versione distribuita, build-2026-11-01-001). Ramo: `feat/miolove-seo-occasion-pages`. **Nulla è implementato**: questo è il piano da approvare. Parte dalla proposta `seo-occasion-pages-proposal.md` (URL e contenuti) e dal registro pagine/lingue già in produzione (`lib/miolove/pages.ts`, `langs.ts`).

## URL (invariati rispetto alla proposta)
| Occasione | IT | EN | FR | ES |
|---|---|---|---|---|
| Matrimonio | `/matrimonio` | `/en/wedding` | `/fr/mariage` | `/es/bodas` |
| Compleanno | `/compleanno` | `/en/birthday` | `/fr/anniversaire` | `/es/cumpleanos` |
| Battesimo | `/battesimo` | `/en/baptism` | `/fr/bapteme` | `/es/bautizo` |

Italiano senza prefisso, le altre con prefisso di lingua (come home e guida). `x-default` = italiano. Il tedesco e le altre lingue in bozza restano 404 e fuori da sitemap e hreflang: il registro lo garantisce da solo.

## Architettura (nessun codice nuovo fuori dallo schema esistente)
1. **Registro** `lib/miolove/pages.ts`: `PageId` passa da `'home' | 'ideas'` a `+ 'wedding' | 'birthday' | 'baptism'`; ogni voce ha `route` (`/matrimonio`, `/compleanno`, `/battesimo`), gli slug delle 4 lingue (quelli sopra; gli slug delle lingue in bozza restano provvisori) e `langs: ['it','en','fr','es']`. Sitemap, hreflang, canonical, menu lingua e 404 delle bozze escono automaticamente dal registro (`resolvePublicPath`, `switchTarget`, `app/sitemap.ts`).
2. **Middleware**: riscrive già gli URL pubblici del registro verso la `route` e passa `x-ml-lang`; va solo verificato che le nuove 12 URL siano riconosciute (test).
3. **Route Next**: tre cartelle sottili `app/matrimonio`, `app/compleanno`, `app/battesimo`, ciascuna come `app/idee/page.tsx` (404 sugli altri portali, JSON-LD, `PublicTexts`) che rendono un solo componente `components/miolove/occasion/MioloveOccasion.tsx` con prop `occasion`. Nessun IOMIXO toccato.
4. **Testi**: una nuova sezione `occasions.{wedding,birthday,baptism}` in `locales/miolove/public/{it,en,fr,es}.json` (stessa struttura per le 3 occasioni: H1, intro, "come funziona in quell'occasione", cosa ricevi, 4–5 FAQ proprie, CTA, link incrociati). Testi originali 400–700 parole, **non** varianti della home. Il prezzo viene da `plans.ts` (19,99 €), mai ricopiato; **il prezzo barrato 39,99 € NON compare** nelle nuove pagine (questione Omnibus ancora aperta).
5. **Metadati** in `lib/miolove/seo.ts`: `mioloveOccasionMetadata(id, lang)` (title ≤ 60, description ≤ 160, canonical autoreferenziale, hreflang completo + x-default, OG), e `mioloveOccasionStructuredData` con `WebPage` + `BreadcrumbList` + `FAQPage` (solo FAQ visibili). **Nessun `aggregateRating`/recensione.**
6. **Link interni**: dalla home (sezione occasioni, già presente: i 4 `event-type` diventano link alle pagine, "Altro" resta senza), dalla guida Idee e tra le tre pagine; footer con le tre occasioni.
7. **Immagini**: una per occasione, formati AVIF/WebP con lo script già esistente (`scripts/optimize-miolove-images.mjs`), `alt` descrittivo, nessuna persona riconoscibile senza licenza. **Decisione da prendere**: foto fornite da te o generate/illustrate (oggi non ho immagini di stock con licenza).

## Strategia internazionale
- Le 4 lingue pubblicate non cambiano; una pagina compare in una lingua solo se **testo rivisto** esiste (voce in `langs`). Se una lingua non è pronta, la pagina esce solo nelle altre e il menu lingua rimanda alla home di quella lingua ("fallback", già implementato).
- **Non traduzione letterale**: ogni lingua ha parole di ricerca proprie (*album foto matrimonio QR code* / *wedding photo album QR code* / *album photo mariage QR code* / *álbum de fotos boda QR*). Spagnolo: una sola variante neutra (tú, "video", "teléfono", "tomar fotos"), parole *boda, cumpleaños, bautizo*. EN: "baptism" (non "christening"), mercato USD.
- Fuori scopo adesso: `/es/quinceaneras` (richiede decisione commerciale, valuta e imposte), pt-BR e altre lingue, tedesco.

## Ordine di lavoro e commit (tutti locali, uno per passo, con diff mostrato prima)
1. **Infrastruttura** (registro, route, componente, metadati, test) con la sola pagina **matrimonio** in IT → rivedi.
2. Matrimonio in EN/FR/ES (testi) → rivedi.
3. **Compleanno** ×4 → rivedi. 4. **Battesimo** ×4 → rivedi.
5. Link interni dalla home e dalla guida, sitemap e verifica finale.

## Test (estendere quelli esistenti, nessun test nuovo di infrastruttura)
- `miolovaI18nRegistry` / `miolovaSeo`: le 12 URL risolvono, i draft restano 404; la sitemap ha 10 + 12 voci, nessuna tedesca; hreflang completo.
- `miolovaMetaLatam`: title/description entro i limiti, unici tra le 12 pagine, senza prezzi nel title.
- **Nuovo test di unicità**: similarità tra pagine della stessa lingua sotto soglia (nessun contenuto duplicato) e nessuna FAQ ripetuta.
- Browser: ogni pagina risponde 200 con `<html lang>` giusto, un solo H1, JSON-LD valido, nessun overflow a 390 px, CTA verso `/register`; Firebase non si avvia per un visitatore nuovo (come la home).
- Lighthouse SEO/Performance sulle 12 pagine in lab; build di produzione da export pulito.

## Rischi e dipendenze
- **Revisione madrelingua** (FR e ES soprattutto): non disponibile a me; senza, ES/FR vanno online solo dopo tua approvazione esplicita.
- Contenuti legalmente sensibili: nessuna promessa non vera (es. "12 mesi", "illimitato" già vietati dai test della home); durata 365 giorni e ZIP come da prodotto reale.
- Ranking e indicizzazione non verificabili da qui: richiedono Search Console (oggi non verificata; DNS/TXT = decisione tua).
- Le pagine non cambiano checkout, prezzi, Functions, regole né tedesco; rilascio con la stessa procedura verificata (export pulito del commit, solo backend `iomixo-web`).

## Decisioni che mi servono prima di scrivere
1. Ordine: matrimonio → compleanno → battesimo (consigliato)?
2. Prezzo 19,99 € visibile nelle pagine (consigliato sì)?
3. Immagini: le fornisci tu o uso illustrazioni generate nello stile MIOLOVE?
4. FR/ES: puoi far rileggere i testi a un madrelingua prima della pubblicazione?
