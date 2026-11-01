# Fase 3 — SEO: correzioni e verifiche (4 lingue)

## Meta title e description (applicati nei dizionari pubblici, locali)
| Lingua | Title (prima → dopo) | Description (prima → dopo) |
|---|---|---|
| IT | `…Album fotografico digitale per i tuoi eventi` → **`MIOLOVE ALBUM — Album foto con QR code per matrimoni e feste`** (60) | 173 → **158** caratteri (era troncata) |
| EN | `…The digital photo album for your events` → **`MIOLOVE ALBUM — Wedding & event photo album with QR code`** (56) | 158 → **153**; "christening" (uso UK) → **"baptism"** (mercato USD) |
| FR | `…L’album photo numérique de vos événements` → **`MIOLOVE ALBUM — Album photo QR code pour mariage et fêtes`** (57) | 187 → **157** (era troncata) |
| ES | `…El álbum de fotos digital para tus eventos` → **`MIOLOVE ALBUM — Álbum de fotos con QR para bodas y fiestas`** (58) | 167 → **158** |
Motivo: il title ora contiene l'intento di ricerca (album + QR + matrimonio/feste) invece di una frase di brand; nessuna descrizione supera i 160 caratteri; nessun prezzo o parola da abbonamento. L'`ogTitle` (condivisioni social) resta emozionale e invariato. La guida "Idee" aveva già title ≤ 57; sistemata solo la description ES (162 → ≤160, ora in regola).
Test: `tests/unit/miolovaMetaLatam.test.ts` (lunghezze, intento, unicità, assenza di prezzi).

## Spagnolo naturale per l'America Latina (testi MIOLOVE e mail MIOLOVE; il dizionario IOMIXO non è toccato)
Una sola variante neutra: **"video"** (non "vídeo"), **"teléfono"** (non "móvil"), **"tomar fotos"** (non "hacer fotos"), **"su gran día"** (non "vuestro"), tú ovunque. Sostituzioni: oltre 80 in `locales/miolove/es.json`, `locales/miolove/public/es.json`, le 10 mail ES e i nuovi testi legali. Un test impedisce il ritorno di vocaboli solo peninsulari (vosotros, ordenador, coger, móvil, vídeo…). **Limite onesto:** non ho potuto far leggere i testi a un madrelingua latinoamericano; la correzione lessicale è sistematica ma serve una rilettura umana prima di investire in annunci in America Latina. Nota commerciale: la lingua spagnola vende oggi in **EUR**; chi è in Messico/Argentina/Colombia pagherebbe in euro.

## Verifiche tecniche (test automatici su dev server con host simulato + build di produzione locale)
| Controllo | Esito |
|---|---|
| `canonical` autoreferenziale su home e guida in ogni lingua; nessun canonical sulle pagine di servizio | OK (SEO1, I18nLoading) |
| `hreflang` it/en/fr/es + `x-default` (italiano), solo lingue pubblicate; il tedesco (bozza) non compare; URL tedeschi → 404 | OK |
| `sitemap.xml`: solo pagine pubbliche (home, guida, privacy, terms); nessun `/login /register /live /sessions`; nessuna URL tedesca | OK |
| `robots.txt`: solo `Disallow: /api/`; i `noindex` restano crawlabili | OK |
| `noindex` (header `X-Robots-Tag` + meta) su area privata, pagine ospite (`/live /booth /screen /remote`), login/registrazione (`noindex, follow`), handler auth | OK |
| Dati strutturati home: `Organization`, `WebSite`, `SoftwareApplication` con le due offerte reali (prova 0; album 19,99 EUR / 19.99 USD); nessun rating/recensione; guida: `Article`, `BreadcrumbList`, `ItemList`, `FAQPage` con testo visibile | OK |
| Resa HTML: la **prima risposta HTML è già nella lingua dell'URL** (`<html lang>`, titolo, testo); HTML identico qualunque cookie/lingua del browser per le pagine pubbliche | OK |
| Lighthouse SEO (home it/en/fr/es, guida) | 100 su tutte |
| IOMIXO: nessun cambiamento di canonical, keywords, header | OK (SEO1) |

## Segnalazioni (non modificate)
1. `/privacy` e `/terms` sono **indicizzabili con un solo URL** e metadati italiani, ma il testo cambia con la lingua del visitatore (la prima risposta è sempre italiana). Con i nuovi testi "in revisione" conviene valutare `noindex` finché non sono approvati (oggi un test richiede `index, follow`); proposta: decisione dopo la revisione legale.
2. Il **prezzo barrato 39,99 €/$** è nel sito IT/EN/FR/ES (in tedesco è stato tolto): per le norme sui prezzi di riferimento (Omnibus) va documentato o rimosso — vedi `legal-review.md`. Non l'ho modificato (è una decisione commerciale).
3. Non verificabile da qui: indicizzazione reale, Search Console, CrUX, Core Web Vitals su utenti veri (dopo la messa online).
4. Pagine per occasione (matrimonio, compleanno, battesimo): proposta in `seo-occasion-pages-proposal.md`, **non implementate**.
