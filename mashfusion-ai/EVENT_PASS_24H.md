# Event Pass 24H — Rebrand di "Wedding Pass 24H"

## 📦 Cosa è cambiato

Il prodotto **Wedding Pass 24H** è stato rinominato in **Event Pass 24H** ed esteso:
ora sblocca le funzionalità premium sia di **Party Mode** sia di **Wedding Edition**
per un singolo evento.

> **EVENT PASS 24H — €7,99 una tantum**
> Accesso completo alle funzionalità premium per un singolo evento.
> Valido per: 🎉 Party Mode · 💍 Wedding Edition
> Durata: 24 ore dall'attivazione.
> Perfetto per matrimoni, compleanni, feste private, eventi aziendali e serate speciali.

## 🔧 Stripe

**Nessuna nuova configurazione richiesta.** Il pass riusa il Price ID già esistente:

```bash
# Backend
STRIPE_PRICE_WEDDING_PASS=price_xxxxxxxxxxxxx

# Frontend (legacy, ancora supportata)
NEXT_PUBLIC_STRIPE_PRICE_WEDDING_PASS=price_xxxxxxxxxxxxx

# Frontend (nuovo nome, opzionale — ha priorità se presente)
NEXT_PUBLIC_STRIPE_PRICE_EVENT_PASS=price_xxxxxxxxxxxxx
```

## 🗄️ Database — migration 016

`database/migrations/016_event_pass_rebrand.sql`:

- `wedding_passes` → `event_passes` (rename tabella, indici)
- `has_wedding_access()` → `has_event_access()` (rename funzione SQL)
- `auto_expire_wedding_passes()` → `auto_expire_event_passes()`
- Le vecchie funzioni vengono droppate; i dati esistenti restano nella tabella
  rinominata (zero perdita).

Applicare con:

```bash
node database/migrate.js
```

## 🖥️ Backend

`backend/src/services/plan.ts`:

- Nuovi helper: `hasEventAccess`, `getActiveEventPass`, `requireEventAccess`
- Vecchi nomi (`hasWeddingAccess`, `getActiveWeddingPass`, `requireWeddingAccess`)
  mantenuti come alias `@deprecated` per back-compat
- Tabella interrogata: `event_passes`

`backend/src/routes/stripe.ts`:

- Webhook one-time payment → `handleEventPassPayment` (insert su `event_passes`)
- Endpoint REST: `GET /stripe/event-passes` (nuovo) e `GET /stripe/wedding-passes`
  (alias back-compat, stesso handler)

Route che richiedono accesso evento (Party Mode + Wedding Edition):
`liveGames.ts`, `weddingGames.ts`, `livePhotos.ts`, `livePolls.ts`,
`liveScreen.ts`, `liveDedications.ts` — tutte aggiornate a `hasEventAccess`.

## 🎨 Frontend

- `types/index.ts`: `EventPass` (con `WeddingPass` come alias `@deprecated`)
- `lib/api.ts`: `billing.getEventPasses()` (e `getWeddingPasses()` delega al nuovo)
- `app/(dashboard)/billing/page.tsx`: card e CTA usano i nuovi label
  `billing.eventPass*`
- `app/page.tsx`: landing pricing card usa `landing.pricing.eventPass*`
- Locali `it/en/fr/es.json`: chiavi rinominate + copy aggiornata per riflettere
  Party Mode + Wedding Edition

## ✅ Back-compat

- Endpoint `GET /stripe/wedding-passes` continua a funzionare (stesso handler)
- Env var `NEXT_PUBLIC_STRIPE_PRICE_WEDDING_PASS` continua a funzionare (fallback
  se `NEXT_PUBLIC_STRIPE_PRICE_EVENT_PASS` non impostata)
- Funzioni TS `hasWeddingAccess` / `getActiveWeddingPass` / `requireWeddingAccess`
  esportate come alias `@deprecated`
- Tipo TS `WeddingPass` esportato come alias di `EventPass`

## 🚀 Deploy

1. Applica la migration: `node database/migrate.js`
2. Deploy backend (le funzioni vecchie SQL vengono droppate dalla migration)
3. Deploy frontend
4. (Opzionale) Aggiorna il nome del prodotto in Stripe Dashboard:
   "Wedding Pass 24H" → "Event Pass 24H"
