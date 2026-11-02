# Valuta e lingua — analisi e proposta (NON implementata)

## Situazione attuale (verificata nel codice)
- **Display**: `lib/pricing.ts:14-16` `currencyForLocale(locale)`: lingua che inizia per «en» → USD, qualsiasi altra → EUR; `plans.ts:formatAlbumPrice(locale)` formatta l'importo (€19,99 · $19.99 · 19,99 €).
- **Addebito**: `firebase/functions/src/billing/albumCheckout.ts:27` `albumCurrencyFor(locale)` (en → usd, altre → eur) → `albumActivationPrice(prices, currency)` sceglie il Price ID della valuta. Il client invia solo `eventId` e `locale`.
- **Dati strutturati**: l'offerta della home usa `currencyForLocale(lang)`.
## Il problema
La valuta segue la **lingua dell'interfaccia**, non la scelta o il paese dell'acquirente:
1. Un acquirente statunitense che naviga in italiano, spagnolo o francese vede e paga in **euro**; un italiano che legge il sito in inglese paga in **dollari**.
2. Lingua e valuta non sono indipendenti nel codice (`locale` è l'unico input anche del server).
3. Le imposte e la comunicazione dei prezzi dipendono dalla valuta/paese, non dalla lingua (legale: v. `legal-checklist-final.md`).
## Proposta semplice: due concetti distinti, due sole valute
1. **Valuta come scelta esplicita con default.** Nuovo tipo `Currency = 'eur' | 'usd'` già esistente; il **default** resta quello di oggi (en → USD, altre → EUR), così nulla cambia per chi non tocca niente.
2. **Selettore di valuta** (EUR | USD) accanto al prezzo nella scheda piano e nella pagina di attivazione, memorizzato in un cookie/`localStorage` (`ml_currency`). Nessun nuovo URL, nessuna pagina per valuta: **hreflang e sitemap non cambiano**; le landing mostrano il prezzo della valuta di default della lingua (indicizzazione stabile) e si aggiornano lato client se l'utente sceglie l'altra.
3. **Il checkout riceve la valuta come enum** (`'eur' | 'usd'`, validato; qualsiasi altro valore → default per lingua) accanto a `eventId` e `locale`; il server continua a scegliere il **Price ID** dalla tabella MIOLOVE (il client non invia mai importi o ID).
4. **Un solo punto di formato**: `formatAlbumPrice(locale, currency?)` (la lingua decide la forma «€19,99» o «19,99 €», la valuta decide il simbolo/importo).
5. **Facoltativo, dopo**: suggerire la valuta dal paese (intestazione di geolocalizzazione dell'hosting) solo come preselezione modificabile; mai bloccare.
## File coinvolti (quando verrà approvata)
`lib/pricing.ts`, `lib/miolove/plans.ts` (firma di `formatAlbumPrice`), `components/miolove/PlanCards.tsx` e `MioloveBilling.tsx` (selettore), il client che chiama il callable, e — **fuori dal perimetro frontend, richiede la tua autorizzazione** — `firebase/functions/src/billing/albumCheckout.ts` (accettare `currency`). Test: valuta di default per lingua invariata; enum rifiutato se non valido; USD su pagina italiana → Price USD; EUR su pagina inglese → Price EUR; nessuna variazione di sitemap/hreflang/JSON-LD.
## Prima di implementarla (decisioni umane)
Imposte per vendite in USD e per consumatori UE in USD; se il prezzo in USD resta 19,99 (oggi replica la cifra in euro, `plans.ts` «DECISION PENDING»); se mostrare entrambe le valute.
