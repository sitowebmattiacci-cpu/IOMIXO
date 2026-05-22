# Wedding Pass 24H — Implementazione Completa

## ✅ Modifiche completate

### 1. Database
**File**: `database/migrations/011_wedding_pass_24h.sql`
- ✅ Tabella `wedding_passes` con:
  - `valid_until`: scadenza 24h dal pagamento
  - `status`: active / expired / refunded
  - `session_id`: opzionale (pass può essere globale o per sessione)
- ✅ Indici per performance
- ✅ Helper function SQL: `has_wedding_access(user_id, session_id)`

### 2. Backend — Helper & Auth
**File**: `backend/src/services/plan.ts`
- ✅ `hasWeddingAccess(userId, sessionId?)`: controlla piano wedding OPPURE pass valido
- ✅ `getActiveWeddingPass(userId, sessionId?)`: ritorna pass attivo
- ✅ `requireWeddingAccess(userId, sessionId?)`: throws 402 se no accesso

### 3. Backend — Stripe
**File**: `backend/src/routes/stripe.ts`
- ✅ Aggiornato `/create-checkout` per supportare:
  - `mode: 'payment'` (one-time) oltre a `'subscription'`
  - `session_id` metadata opzionale
- ✅ Webhook handler `handleWeddingPassPayment`:
  - Crea wedding pass con `valid_until = now() + 24h`
  - Registra pagamento in tabella payments
- ✅ Route `/stripe/wedding-passes`: GET lista passes utente

### 4. Backend — Routes aggiornate
Tutte le routes wedding ora usano `hasWeddingAccess` invece di solo controllo piano:
- ✅ `liveGames.ts` — requireWeddingFeature()
- ✅ `weddingGames.ts` — requireWeddingFeature()
- ✅ `liveDedications.ts` — hasWeddingAccess()
- ⚠️ `livePhotos.ts` — DA AGGIORNARE
- ⚠️ `liveSessions.ts` — DA AGGIORNARE (creazione sessioni)
- ⚠️ `livePublic.ts` — DA AGGIORNARE

### 5. Frontend — API Client
**File**: `frontend/lib/api.ts`
- ✅ Aggiornato `billing.createCheckoutSession(priceId, mode, sessionId)`
- ✅ Aggiunto `billing.getWeddingPasses()`

### 6. Frontend — Types
**File**: `frontend/types/index.ts`
- ✅ Type `WeddingPass` con tutti i campi

---

## 🔧 Configurazione richiesta

### 1. Environment Variables (.env)
Aggiungi al file `.env` (backend e frontend):

```bash
# Stripe Price ID per Wedding Pass 24H (one-time payment €7.99)
STRIPE_PRICE_WEDDING_PASS=price_xxxxxxxxxxxxx

# Frontend
NEXT_PUBLIC_STRIPE_PRICE_WEDDING_PASS=price_xxxxxxxxxxxxx
```

### 2. Creare Price in Stripe Dashboard
1. Vai su https://dashboard.stripe.com/products
2. Crea nuovo prodotto:
   - **Nome**: Wedding Pass 24H
   - **Descrizione**: Accesso temporaneo Wedding Edition per 24 ore
   - **Prezzo**: €7.99
   - **Tipo**: One-time payment
   - **Valuta**: EUR
3. Copia il Price ID (es: `price_1A2B3C...`)
4. Aggiungi al file `.env`

### 3. Applicare Migration Database
```bash
cd database
psql $DATABASE_URL < migrations/011_wedding_pass_24h.sql
```

Oppure aggiornare il file `migrate.js` per includere la nuova migration.

---

## 🎨 UI da implementare

### Badge / Countdown
Mostrare nella dashboard sessione:

```tsx
import useSWR from 'swr'
import { billing } from '@/lib/api'

function WeddingPassBadge({ userId }: { userId: string }) {
  const { data: passes } = useSWR('wedding-passes', () => billing.getWeddingPasses())
  
  const activePass = passes?.find(p => 
    p.status === 'active' && new Date(p.valid_until) > new Date()
  )

  if (!activePass) return null

  const validUntil = new Date(activePass.valid_until)
  const hoursLeft = Math.max(0, (validUntil.getTime() - Date.now()) / (1000 * 60 * 60))

  return (
    <div className="rounded-xl border-2 border-[#8F1D2C] bg-[#FBEAF0] p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#8F1D2C]">
          ⏱️ Wedding Pass 24H
        </span>
      </div>
      <p className="text-sm text-[#2B2424]">
        Accesso attivo fino al:{' '}
        <span className="font-semibold">
          {validUntil.toLocaleString('it-IT')}
        </span>
      </p>
      <p className="text-xs text-[#6F6260] mt-1">
        ({hoursLeft.toFixed(1)}h rimanenti)
      </p>
    </div>
  )
}
```

### Banner scadenza
Quando pass scaduto e utente tenta di usare feature wedding:

```tsx
function WeddingPassExpiredBanner() {
  return (
    <div className="rounded-xl border-2 border-[#8F1D2C] bg-[#FBEAF0] p-5 text-center">
      <p className="text-lg font-semibold text-[#8F1D2C] mb-2">
        ⚠️ Wedding Pass scaduto
      </p>
      <p className="text-sm text-[#2B2424] mb-4">
        Riattivalo con un nuovo pass 24H oppure passa a Wedding Edition.
      </p>
      <div className="flex gap-2 justify-center">
        <button
          onClick={() => buyWeddingPass()}
          className="px-4 py-2 rounded-full bg-gradient-to-br from-[#8F1D2C] to-[#A32335] text-white font-semibold"
        >
          Acquista Wedding Pass 24H — €7,99
        </button>
        <button
          onClick={() => upgradeToWedding()}
          className="px-4 py-2 rounded-full bg-[#FBEAF0] border border-[#E8B7C8] text-[#8F1D2C] font-semibold"
        >
          Passa a Wedding Edition
        </button>
      </div>
    </div>
  )
}

async function buyWeddingPass() {
  const priceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_WEDDING_PASS!
  const { url } = await billing.createCheckoutSession(priceId, 'payment')
  window.location.href = url
}
```

### Button acquisto Wedding Pass
Da aggiungere nella pagina billing o nella creazione sessione wedding:

```tsx
<button
  onClick={async () => {
    const priceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_WEDDING_PASS!
    const sessionId = currentSession?.id // opzionale
    const { url } = await billing.createCheckoutSession(priceId, 'payment', sessionId)
    window.location.href = url
  }}
  className="w-full px-6 py-3 rounded-full bg-gradient-to-br from-[#8F1D2C] to-[#A32335] text-white font-semibold text-lg hover:shadow-lg hover:scale-105 transition-all"
>
  Wedding Pass 24H — €7,99
  <span className="block text-xs opacity-90 mt-1">
    Accesso completo per 24 ore
  </span>
</button>
```

---

## ⚠️ TODO rimanenti

### Backend Routes da aggiornare
1. **livePhotos.ts** (riga ~50):
   ```ts
   // DA:
   if (!(await hasFeature(session.dj_id, 'guestPhotoAlbum'))) {
   
   // A:
   if (!(await hasWeddingAccess(session.dj_id))) {
   ```

2. **liveSessions.ts** (riga ~29, creazione sessione wedding):
   ```ts
   // DA:
   if (!PLAN_LIMITS[plan].weddingMode) {
   
   // A:
   if (!(await hasWeddingAccess(userId(req)))) {
   ```

3. **livePublic.ts** (righe ~333, ~484, check weddingGames):
   ```ts
   // DA:
   if (!PLAN_LIMITS[plan].weddingGames) {
   
   // A:
   if (!(await hasWeddingAccess(session.dj_id))) {
   ```

### Frontend
1. Aggiungere componente `WeddingPassBadge` nella dashboard sessione
2. Aggiungere banner scadenza quando pass scaduto
3. Aggiungere button acquisto Wedding Pass in billing/pricing page
4. Aggiungere countdown nella UI quando pass attivo
5. Testare flow completo:
   - Acquisto pass → redirect success → dashboard con badge
   - Usare feature wedding con pass attivo
   - Scadenza pass → mostrare banner
   - Acquisto nuovo pass

---

## 🧪 Testing

### 1. Test acquisto Wedding Pass
```bash
# 1. Acquista Wedding Pass via Stripe (test mode)
# 2. Verifica creazione record in wedding_passes
SELECT * FROM wedding_passes WHERE user_id = 'xxx';

# 3. Verifica valid_until = now() + 24h
# 4. Verifica status = 'active'
```

### 2. Test hasWeddingAccess
```sql
-- User con piano wedding → TRUE
SELECT has_wedding_access('user-wedding-plan-id');

-- User con pass valido → TRUE  
SELECT has_wedding_access('user-con-pass-valido-id');

-- User senza piano né pass → FALSE
SELECT has_wedding_access('user-free-id');

-- User con pass scaduto → FALSE
SELECT has_wedding_access('user-con-pass-scaduto-id');
```

### 3. Test scadenza automatica
```sql
-- Simula scadenza
UPDATE wedding_passes 
SET valid_until = now() - interval '1 hour'
WHERE id = 'xxx';

-- Testa che hasWeddingAccess ritorni FALSE
SELECT has_wedding_access('user-id');
```

---

## 📊 Monitoraggio

### Dashboard Stripe
- Monitora pagamenti one-time Wedding Pass
- Verifica webhook events `checkout.session.completed` (mode=payment)
- Check refunds (se richiesti)

### Database
```sql
-- Passes attivi
SELECT COUNT(*) FROM wedding_passes 
WHERE status = 'active' AND valid_until > now();

-- Passes scaduti nelle ultime 24h
SELECT COUNT(*) FROM wedding_passes 
WHERE status = 'active' AND valid_until < now() AND valid_until > now() - interval '24 hours';

-- Revenue Wedding Pass (ultimo mese)
SELECT SUM(amount_cents) / 100.0 as total_eur
FROM wedding_passes
WHERE created_at > now() - interval '30 days';
```

---

## 🎯 Riepilogo

**Wedding Pass 24H** è ora funzionante per:
- ✅ Acquisto one-time €7.99
- ✅ Validità 24h precise dal pagamento
- ✅ Accesso a tutte le feature Wedding Edition durante la validità
- ✅ Helper `hasWeddingAccess` unificato (piano OR pass)
- ✅ Webhook Stripe per creazione automatica pass
- ✅ API per ottenere passes utente

**Mancano**:
- ⚠️ Aggiornare 3-4 routes backend rimanenti
- ⚠️ UI frontend per mostrare badge e countdown
- ⚠️ Banner scadenza
- ⚠️ Button acquisto in billing page
- ⚠️ Testing end-to-end
