# MIOLOVE — chiusura delle criticità commerciali/legali prima della pubblicazione SEO

Data 2026-11-02 · ramo `feat/miolove-seo-occasion-pages` (HEAD `c06be13`) · **tutto in sola lettura: nessuna modifica a codice, Stripe, Functions, regole, DNS, IAM; nessun push/deploy.** Le proposte sono testo, non applicato.

## 1. Prezzi e Stripe — dal display all'addebito
**Percorso (verificato nel codice)**
1. *Mostrato*: `lib/miolove/plans.ts:12-21` (`ALBUM_PRICING.current = { eur: 19.99, usd: 19.99 }`) → `formatAlbumPrice(locale)` (`plans.ts:104`), valuta scelta da `lib/pricing.ts:14-16` (lingua che inizia per "en" → USD, altrimenti EUR). Fa fede la **lingua** della pagina, non il paese del visitatore.
2. *Avvio checkout*: il client invia solo `eventId` e `locale` (`firebase/functions/src/billing/albumCheckout.ts:30-35`; qualsiasi `priceId`/`amount`/`currency` viene ignorato).
3. *Valuta addebitata*: `albumCurrencyFor(locale)` (`albumCheckout.ts:27`): `en` → `usd`, `it/fr/es` → `eur`, coerente con il display.
4. *Prezzo addebitato*: `albumActivationPrice(prices, currency)` (`billing/prices.ts:73-76`) sceglie il **Price ID Stripe** letto dall'ambiente (`STRIPE_PRICE_MIOLOVE_ALBUM_EUR` / `_USD`, `prices.ts:66-70`) e crea la Checkout Session `mode: 'payment'`, `line_items: [{ price, quantity: 1 }]`, carta e PayPal, `allow_promotion_codes: true` (`albumCheckout.ts:61-66`). **L'importo non viene mai preso da `plans.ts`: lo decide l'oggetto Price in Stripe.** Senza il Price della valuta → `checkout_unavailable`.
5. *Registrazione*: il webhook firmato salva l'importo realmente pagato (`billing/mioloveWebhook.ts:72-75,107`: `amount_total`, `currency`).
**Cosa risulta configurato** (file di ambiente di produzione tracciato `firebase/functions/.env.iomixo-494817`, righe 30-33): esistono entrambe le variabili `STRIPE_PRICE_MIOLOVE_ALBUM_EUR` e `_USD` (id che iniziano con `price_1UTHF6…`), con commento «account Stripe LIVE, 19.99 EUR / 19.99 USD». I test unit (`tests/unit/miolovaStripe.test.ts`, STRIPE-U1) fissano: EN → USD, IT/FR/ES → EUR, entrambi 19,99.
**Cosa NON posso confermare e perché**
| Prova mancante | Perché serve | Come ottenerla (senza modificare nulla) |
|---|---|---|
| Che i due Price esistano nell'account Stripe LIVE di MIOLOVE con `unit_amount = 1999`, `currency = eur` / `usd`, `type = one_time`, `active = true` | **Nessun test o codice confronta l'importo Stripe con `plans.ts`**: se differisce, il sito mostra 19,99 e Stripe addebita altro | Dashboard Stripe (MIOLOVE) → Prodotti → «Album completo» → i due prezzi; oppure GET di sola lettura `/v1/prices/{id}` con chiave ristretta di sola lettura (non ho accesso alle chiavi, restano in Secret Manager) |
| Che la Function **già deployata** abbia le due variabili | Il file nel repo non prova lo stato in produzione | `gcloud run services describe createalbumcheckoutsession` (solo nomi variabili). **Il mio tentativo è stato negato dal sistema di autorizzazioni (lettura di produzione): non l'ho aggirato**; serve la tua autorizzazione esplicita |
| Che il prezzo sia IVA inclusa o esclusa e come si comportino le imposte (USD/UE) | La sessione non imposta `automatic_tax` né raccolta partita IVA; dipende da `tax_behavior` del Price | Dashboard Stripe → Price → «Tax behavior» + impostazioni Stripe Tax; decisione fiscale tua |
| Un pagamento di prova end-to-end | Vietato qui (nessuna transazione) | Account Stripe in modalità test + carta 4242… su un album di prova, solo con tua autorizzazione |
`.env.local` (locale) contiene altri id (`price_1UTG2u…`, `price_1UTG3j…`): sono i prezzi di sviluppo, non di produzione.
**Rischi distinti (mostrato ≠ addebitato)**
- Un visitatore negli Stati Uniti che usa la pagina italiana/spagnola/francese vede **€19,99 e paga in euro**: la valuta segue la lingua, non il paese. «Stati Uniti: 19.99 USD» è vero solo per chi usa il sito in inglese. Da accettare o da cambiare (decisione di prodotto).
- `allow_promotion_codes: true`: un codice può ridurre l'importo addebitato; condizioni dei codici non definite.
- Il JSON-LD dell'offerta gratuita della home dichiara `priceCurrency: 'EUR'` anche nella versione inglese (trascurabile: prezzo 0).
**Correzione minima consigliata (non applicata):** un controllo pre-deploy in sola lettura che confronti `plans.ts` con i due Price di Stripe (importo, valuta, attivo) e fallisca se differiscono.

## 2. Proposta minima — prezzo barrato e «illimitato» (NON applicata)
### 2a. Eliminare il prezzo barrato 39,99 (mostrare solo il prezzo reale)
| File | Intervento minimo |
|---|---|
| `components/miolove/PlanCards.tsx:52` | rimuovere l'elemento `<s … data-testid="album-list-price">` e l'import `formatAlbumListPrice` (riga 7); resta `<span … data-testid="album-price">` |
| `components/miolove/home/MioloveHome.tsx:15, 328` | togliere `.replace('{list}', formatAlbumListPrice(locale))` e l'import |
| `locales/miolove/public/{it,en,fr,es}.json:204` (`home.faq.q4.a`) | togliere la parentesi con `{list}`: |
| | IT «…costa {price} per ogni album, in un unico pagamento: dura 365 giorni dall'attivazione. Non è un abbonamento, non si paga al mese e non si paga per invitato.» |
| | EN «…costs {price} for each album, in a single payment: it lasts 365 days from activation. It is not a subscription, it is not billed monthly and it is not charged per guest.» |
| | FR «…coûte {price} pour chaque album, en un seul paiement : il dure 365 jours à partir de l'activation. Ce n'est pas un abonnement, il ne se paie pas au mois ni par invité.» |
| | ES «…cuesta {price} por cada álbum, en un único pago: dura 365 días desde la activación. No es una suscripción, no se paga al mes ni por invitado.» |
| `locales/miolove/{it,en,fr,es}.json:124` (`albumPlan.listPrice`) | chiave non più usata (rimovibile) |
| `lib/miolove/plans.ts:3,13,21,111-112` | opzionale: rimuovere `ALBUM_LIST_PRICE_EUR`, `ALBUM_PRICING.list`, `formatAlbumListPrice` e la frase del commento |
| Test da aggiornare | `tests/unit/miolove.test.ts:6,24` (formato del prezzo di listino), `tests/unit/miolovaStripe.test.ts:14` (asserzione `list.eur`), `tests/browser/miolovaGoLive.test.ts:76` (`album-list-price`); aggiungere un test «nessun `<s>` né `{list}` in MIOLOVE» |
Effetto sul prezzo addebitato: **nessuno** (lo decide il Price di Stripe).
### 2b. Diciture «illimitato»
Elenco completo (nelle 4 lingue, esclusi i testi delle landing già corretti):
| Chiave | Testo attuale (IT / EN / FR / ES) | Giudizio |
|---|---|---|
| `albumPlan.f.guests` (`locales/miolove/*.json:104`) e `home.features.guests.title` (`public/*.json:62`) | Invitati illimitati / Unlimited guests / Invités illimités / Invitados ilimitados | **Accurato**: nessun tetto al numero di invitati (il tetto di 500 è per invitato) → può restare; testo di dettaglio già corretto («Nessun limite al numero di persone…») |
| `albumPlan.f.albumMedia` (`:115`) | Foto e video illimitati / Unlimited photos and videos / Photos et vidéos illimitées / Fotos y videos ilimitados | **Impreciso**: ogni invitato è limitato a 500 contenuti, video ≤ 150 MB, foto ≤ 50 MB |
| `albumPlan.f.albumMediaPhotos` (`:114`, variante «solo foto», oggi nascosta) | Foto illimitate / Unlimited photos / Photos illimitées / Fotos ilimitadas | idem |
Formulazioni proposte:
| Chiave | IT | EN | FR | ES |
|---|---|---|---|---|
| `albumPlan.f.albumMedia` | Foto e video senza tetto per album | No cap on photos and videos per album | Aucun plafond de photos et de vidéos par album | Sin tope de fotos y videos por álbum |
| `albumPlan.f.albumMediaPhotos` | Foto senza tetto per album | No cap on photos per album | Aucun plafond de photos par album | Sin tope de fotos por álbum |
| nuova `albumPlan.limitsNote` (riga sotto l'elenco, valori da `GUEST_UPLOAD_CAP` e `MEDIA_LIMITS`) | Per evitare abusi: fino a {guestCap} contenuti per invitato, video fino a {videoMax} MB, foto fino a {photoMax} MB. | To prevent abuse: up to {guestCap} files per guest, videos up to {videoMax} MB, photos up to {photoMax} MB. | Pour éviter les abus : jusqu'à {guestCap} fichiers par invité, vidéos jusqu'à {videoMax} Mo, photos jusqu'à {photoMax} Mo. | Para evitar abusos: hasta {guestCap} archivos por invitado, videos de hasta {videoMax} MB, fotos de hasta {photoMax} MB. |
Il riempimento dei segnaposto esiste già (`occasionText`, `lib/miolove/occasions.ts`). Test da aggiungere: nessuna voce MIOLOVE contiene «illimitat/unlimited/illimité/ilimitad» riferita a foto/video; la nota usa i valori di configurazione.

## 3. Informazioni legali (sola lettura; nessuna copia dall'altro ramo)
**Stato in questo ramo (= produzione `479804e`)**: `lib/legal/privacy.ts` e `terms.ts` sono testi generici condivisi con IOMIXO. Incoerenze con MIOLOVE: privacy.ts:12/69/126/183 «piano, stato dell'abbonamento» (MIOLOVE non ha abbonamenti); terms.ts:49,55 «pagamenti non rimborsabili salvo quanto previsto dalla legge. IVA… aggiunta ove richiesta» (in contrasto col recesso di 14 giorni per i consumatori e ambiguo sul prezzo); nessuna identificazione del venditore MIOLOVE.
**Bozze nell'altro ramo** (`feat/miolove-de-functions`, `lib/legal/miolove.ts` + dossier `docs/miolove-prelaunch/legal-review.md`, letti con `git show`, non copiati): testi per MIOLOVE in 4 lingue, `MIOLOVE_LEGAL_REVIEWED = false`; venditore indicato «Enrico Mattia Curzi» (decisione del titolare), `address` e `vatId` **nulli**; recesso: oggi 14 giorni pieni (eccezione per esecuzione anticipata non invocata); ODR UE non citata.
**Da confermare prima della vendita (non inventare)**
1. Identità del venditore: denominazione/nome, **indirizzo geografico**, recapito rapido oltre a `info@miolovealbum.com`; **P. IVA o regime fiscale** (forfettario?); eventuale registro.
2. **IVA**: il 19,99 è IVA inclusa? aliquota? IVA per consumatori UE fuori Italia (OSS), imposte per vendite in USD a non-UE; Stripe Tax; ricevuta/fattura.
3. **Recesso (consumatori)**: scelta fra 14 giorni pieni e servizio digitale con inizio immediato (richiesta espressa + presa d'atto della perdita del recesso nel checkout, prima di Stripe — oggi non presente per IT/FR/ES/EN), modulo tipo di recesso, indirizzo per inviarlo, email di conferma con le informazioni precontrattuali. Verificare con il legale l'obbligo di **pulsante di recesso elettronico** (Dir. 2023/2673, dal 19/06/2026) e il pulsante «ordine con obbligo di pagare».
4. **Prezzo barrato / Omnibus**: finché esiste, il prezzo di riferimento va documentato come il più basso degli ultimi 30 giorni; la proposta §2a lo elimina.
5. **Promozioni**: condizioni dei codici (`allow_promotion_codes`), rimborsi oltre il recesso (errore tecnico, doppio addebito).
6. **Privacy (art. 13 GDPR)**: titolare e contatti completi, DPO (se necessario), ruoli sulle foto degli ospiti (titolare = organizzatore, noi responsabile? contitolarità?), basi giuridiche, tempi di conservazione (incl. periodo fiscale e log tecnici), **trasferimenti extra-SEE** (Google, Stripe, Resend: DPF/SCC), foto di **minori** (battesimi e feste di bambini: le landing li citano), età minima (16 vs 14 in Italia), autorità di controllo, consenso per reCAPTCHA/App Check e cookie, regione dei dati (non verificabile dal repository).
7. **Segnalazione di contenuti illeciti** (DSA art. 16): l'email basta come meccanismo? Da confermare.
8. Quale versione dei testi vale al momento della pubblicazione e portare `MIOLOVE_LEGAL_REVIEWED` a `true` solo dopo la revisione.

## 4. Performance mobile — verifica mirata
**Diagnosi (misurata, rete Slow 4G + CPU 4×, build di produzione locale, solo loopback)**: l'LCP di `/matrimonio` è l'immagine di copertina, che finisce di scaricarsi a ~3,45 s perché **condivide la banda** con ~600 KB caricati insieme: 6 file font preloaded (~225 KB), logo (36 KB), CSS e JS (~200 KB). Le pagine con LCP testuale (es. `/en/christening`) sono a ~1,4 s.
**Esperimenti (in un worktree temporaneo, poi rimosso; il ramo SEO non è stato toccato)**
| Variante | LCP `/matrimonio` | LCP `/en/christening` |
|---|---|---|
| Base | 3,43-3,50 s | 1,34-1,38 s |
| Precaricare l'immagine hero con `fetchpriority="high"` (`preload` di `react-dom`, solo nelle landing) | **3,46-3,50 s (nessun beneficio)** | — |
| `preload: false` ai 6 font non usati dalle pagine MIOLOVE (Cormorant, Playfair, Great Vibes, Dancing Script, Cinzel, Tangerine) in `app/layout.tsx` | **2,54-2,57 s (−0,9 s, −26 %)** | **0,97-0,99 s (−0,4 s)** |
**Conclusione**: la modifica efficace è in `app/layout.tsx` (6 righe `preload: false`), ma il layout è **condiviso con IOMIXO**: quei font sono suoi, e non precaricarli può causare un lampo di testo (FOUT) sulle sue pagine. Non è «piccola e isolata alle landing»: **non applicata**. Alternativa isolata ma di beneficio modesto: servire a ≤ 430 px la variante AVIF da 540 px (56 KB invece di 88 KB, ~−0,15 s stimati, qualità leggermente ridotta). Il precaricamento dell'immagine non serve. Test per verificare: stesso profilo di throttling prima/dopo; Lighthouse mobile; controllo visivo di IOMIXO (desktop/mobile) per il FOUT; dati di campo (CrUX/Search Console) dopo il deploy.
