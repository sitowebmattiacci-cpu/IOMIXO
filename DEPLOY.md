# 🚀 DEPLOY IOMIXO LIVE HUB

Deploy minimo ed economico: **$7/mese**

---

## 📋 PREREQUISITI

Assicurati di avere:
- ✅ Account GitHub (già fatto)
- ✅ Account Supabase con progetto creato
- ✅ Account Stripe configurato
- 🆕 Account Vercel (da creare)
- 🆕 Account Render (da creare)

---

## STEP 1: Deploy Frontend su Vercel (GRATIS)

### 1.1 Crea account Vercel
1. Vai su **https://vercel.com/signup**
2. Clicca **"Continue with GitHub"**
3. Autorizza Vercel ad accedere ai tuoi repository

### 1.2 Importa progetto
1. Click **"Add New Project"**
2. Seleziona repository: **`IOMIXO`**
3. **IMPORTANTE**: Configura root directory:
   - Root Directory: `mashfusion-ai/frontend`
   - Framework: Next.js (auto-rilevato)
   - Build Command: `npm run build`
   - Output Directory: `.next`

### 1.3 Configura variabili ambiente
Nella sezione **Environment Variables**, aggiungi:

```bash
NEXT_PUBLIC_API_URL=https://[INSERISCI-POI-URL-BACKEND]
NEXT_PUBLIC_SUPABASE_URL=https://zrayvqvxadjgfpupwhky.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[ANON-KEY-PROGETTO-zrayvqvxadjgfpupwhky]
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=[TUA-CHIAVE-PUBLISHABLE]
NEXT_PUBLIC_STRIPE_PRO_PRICE_ID=[TUO-PRICE-ID-PRO]
NEXT_PUBLIC_STRIPE_STUDIO_PRICE_ID=[TUO-PRICE-ID-STUDIO]
NEXT_PUBLIC_PUBLIC_BASE_URL=https://[NOME-APP].vercel.app
```

**⚠️ NOTA**: Lascia `NEXT_PUBLIC_API_URL` vuoto per ora, lo aggiornerai dopo aver deployato il backend.

### 1.4 Deploy
1. Click **"Deploy"**
2. Aspetta 2-3 minuti
3. **Salva l'URL**: `https://[nome-app].vercel.app`

---

## STEP 2: Deploy Backend su Render ($7/mese)

### 2.1 Crea account Render
1. Vai su **https://render.com/register**
2. Clicca **"Continue with GitHub"**
3. Autorizza Render

### 2.2 Crea nuovo Web Service
1. Click **"New +"** → **"Web Service"**
2. Seleziona repository: **`IOMIXO`**
3. Click **"Connect"**

### 2.3 Configura servizio
**Nome**: `iomixo-backend` (o quello che preferisci)
**Region**: Frankfurt (EU) - più vicino all'Italia
**Branch**: `main`
**Root Directory**: `mashfusion-ai/backend`
**Runtime**: Node
**Build Command**: `npm install && npm run build`
**Start Command**: `npm start`

**Instance Type**: Starter ($7/mese) ✅

### 2.4 Configura variabili ambiente
Nella sezione **Environment**, aggiungi:

```bash
NODE_ENV=production
PORT=4000

# Supabase
SUPABASE_URL=https://zrayvqvxadjgfpupwhky.supabase.co
SUPABASE_SERVICE_ROLE_KEY=[TUA-SERVICE-ROLE-KEY]
SUPABASE_ANON_KEY=[ANON-KEY-PROGETTO-zrayvqvxadjgfpupwhky]
DATABASE_URL=[TUA-SUPABASE-CONNECTION-STRING]

# Stripe
STRIPE_SECRET_KEY=[TUA-SECRET-KEY]
STRIPE_WEBHOOK_SECRET=[TUO-WEBHOOK-SECRET]
STRIPE_PRO_PRICE_ID=[TUO-PRICE-ID]
STRIPE_STUDIO_PRICE_ID=[TUO-PRICE-ID]

# Security
JWT_SECRET=[GENERA-STRINGA-CASUALE-32-CARATTERI]

# CORS
ALLOWED_ORIGINS=https://[tuo-frontend].vercel.app

# App URLs
NEXT_PUBLIC_APP_URL=https://[tuo-frontend].vercel.app
APP_URL=https://[tuo-frontend].vercel.app

# Logging
LOG_LEVEL=info
```

### 2.5 Deploy
1. Click **"Create Web Service"**
2. Aspetta 3-5 minuti
3. **Salva l'URL**: `https://[nome-app].onrender.com`

---

## STEP 3: Collega Frontend e Backend

### 3.1 Aggiorna Frontend
1. Torna su **Vercel Dashboard**
2. Vai in **Settings** → **Environment Variables**
3. Modifica `NEXT_PUBLIC_API_URL`:
   ```
   https://[nome-backend].onrender.com
   ```
4. Click **"Redeploy"** per applicare

### 3.2 Aggiorna Backend
1. Torna su **Render Dashboard**
2. Vai in **Environment**
3. Verifica che `ALLOWED_ORIGINS` contenga l'URL Vercel corretto

---

## STEP 4: Configura Stripe Webhook

### 4.1 Crea webhook
1. Vai su **https://dashboard.stripe.com/webhooks**
2. Click **"Add endpoint"**
3. URL endpoint: `https://[backend].onrender.com/stripe/webhook`
4. Eventi da ascoltare:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`

### 4.2 Aggiorna secret
1. Copia il **Webhook signing secret** (inizia con `whsec_`)
2. Vai su **Render** → Environment
3. Aggiorna `STRIPE_WEBHOOK_SECRET` con il valore copiato
4. Click **"Save Changes"** (si riavvia automaticamente)

---

## STEP 5: Test finale

### 5.1 Testa autenticazione
1. Vai su `https://[tuo-frontend].vercel.app`
2. Click **"Registrati"**
3. Crea un account
4. Verifica email (se configurato Supabase email)

### 5.2 Testa Live Booth (HTTPS ✅)
1. Login
2. Crea una sessione live (tipo Wedding)
3. Copia link `/booth/[slug]`
4. Apri su smartphone
5. Click **"Apri fotocamera"**
6. ✅ **Dovrebbe funzionare!** (HTTPS attivo)

### 5.3 Testa Stripe
1. Vai su `/billing`
2. Click **"Passa a Pro"**
3. Completa checkout test (usa card `4242 4242 4242 4242`)

---

## 📊 COSTI MENSILI

| Servizio | Costo |
|----------|-------|
| Frontend (Vercel) | **Gratis** |
| Backend (Render Starter) | **$7** |
| Database (Supabase Free) | **Gratis** |
| Storage (Supabase) | **Gratis** |
| **TOTALE** | **$7/mese** |

---

## 🔧 COMANDI UTILI

### Vedere log backend
```bash
# Su Render Dashboard → Logs tab
```

### Redeploy manuale
```bash
# Vercel: vai su dashboard → Deployments → Redeploy
# Render: push su GitHub branch main (auto-deploy)
```

### Variabili ambiente mancanti

Se devi trovare le tue chiavi:

**Supabase**:
- URL: Dashboard → Project Settings → API
- Service Role Key: Dashboard → Project Settings → API → service_role
- Connection String: Dashboard → Project Settings → Database → Connection string

**Stripe**:
- Publishable Key: Dashboard → Developers → API keys → Publishable key
- Secret Key: Dashboard → Developers → API keys → Secret key
- Price IDs: Dashboard → Products → Copia ID prezzi

**JWT Secret**:
```bash
# Genera con:
openssl rand -base64 32
```

---

## ⚠️ TROUBLESHOOTING

**Backend non parte**:
- Controlla logs su Render
- Verifica tutte le variabili ambiente
- Assicurati che `DATABASE_URL` sia corretto

**Frontend non si connette al backend**:
- Verifica `NEXT_PUBLIC_API_URL` su Vercel
- Verifica CORS (`ALLOWED_ORIGINS`) su backend
- Controlla Network tab nel browser

**Fotocamera non si apre**:
- ✅ Ora funziona con HTTPS
- Verifica su smartphone (non desktop)
- Controlla permessi browser

**Stripe non funziona**:
- Verifica webhook endpoint configurato
- Controlla `STRIPE_WEBHOOK_SECRET` su backend
- Usa modalità test prima di andare live

---

## 🎉 DEPLOY COMPLETATO!

La tua app è online su:
- **Frontend**: https://[nome].vercel.app
- **Backend**: https://[nome].onrender.com
- **Database**: Supabase (già configurato)

**Costo**: $7/mese

**HTTPS**: ✅ Attivo (fotocamera funziona!)
