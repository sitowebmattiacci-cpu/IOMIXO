# IOMIXO Live Hub — Specifiche complete del portale

Documento di sintesi su funzionalità, piani e architettura del prodotto.
Aggiornato al 19 maggio 2026.

---

## 1. Che cos'è IOMIXO Live Hub

SaaS rivolto a **DJ professionisti, locali e agenzie eventi** che permette di:

- Creare una **sessione live** per ogni serata.
- Generare un **QR code** che il pubblico può scansionare dal telefono.
- Raccogliere **richieste musicali** in tempo reale.
- Gestire approva/rifiuta delle richieste dalla dashboard.
- Esporre un **profilo DJ pubblico** con bio, social, prossime date e foto.

L'esperienza pubblica è **mobile-first**, senza login richiesto.
L'esperienza DJ è una dashboard web (desktop e mobile responsive).

---

## 2. Funzionalità per il DJ (dashboard autenticata)

### Dashboard principale `/dashboard`
- Riepilogo del piano attivo.
- CTA "Crea sessione".
- Sessioni recenti con stato (attiva/chiusa).

### Sessioni Live `/sessions`
- Lista di tutte le sessioni del DJ.
- Filtri: attive vs storico chiuse.
- Creazione nuova sessione con: nome evento, dj_name, descrizione.

### Dettaglio sessione `/sessions/[id]`
- **QR code** dell'URL pubblico (con copia link + download PNG).
- **Persone online** in tempo reale (heartbeat ogni 10s, finestra 30s).
- **Statistiche card**: in attesa / approvate / rifiutate.
- **Lista richieste pubbliche** con polling ogni 5s:
  - Pending: bottoni Approva / Rifiuta / Elimina.
  - Approvate / Rifiutate: cronologia per audit.
- Toggle "Chiudi sessione" — blocca nuove richieste.
- Eliminazione sessione (cascade su richieste).

### Profilo DJ `/profile`
- Nome d'arte, bio, slug pubblico (univoco).
- **Foto profilo**: upload diretto da desktop (JPEG/PNG/WEBP, max 5 MB → Supabase Storage bucket `avatars`).
- Link social: Instagram, TikTok, Spotify, SoundCloud, sito web.

### Prossime date `/events`
- CRUD eventi pubblici: titolo, data, locale, città, ticket URL.
- Toggle pubblico/nascosto per singolo evento.

### Abbonamento `/billing`
- Card 3 piani (Free / Pro / Club) con feature list e prezzi.
- Checkout Stripe + portale clienti.
- Cronologia pagamenti.

---

## 3. Esperienza pubblica `/live/[slug]`

Pagina mobile-first **senza login**:

- Header: nome evento, nome DJ, descrizione, **foto profilo DJ**.
- Social del DJ (solo se piano Pro/Club).
- **Form richiesta**: titolo brano (obbligatorio), artista, messaggio.
- Anti-spam: 1 richiesta ogni 20s per `ip_hash` (SHA256 di IP+UA+salt).
- **"Le tue richieste"**: cronologia delle richieste inviate da quel dispositivo, con stato live (pending/approved/rejected). ID salvati in `localStorage` (`iomixo.publicReq.<slug>`), polling ogni 10s.
- **Prossime date** del DJ (solo se piano Pro/Club).
- Heartbeat ogni 10s al backend per il conteggio "persone online".
- Footer **branding IOMIXO** (visibile/ridotto/nascosto a seconda del piano DJ).

Stati:
- Sessione chiusa → form disabilitato, banner statico.
- Limite richieste raggiunto (solo Free) → form disabilitato.

---

## 4. Piani — caratteristiche effettive (enforcement reale)

### Free — Gratis
| Feature | Stato |
|---|---|
| 1 sessione live attiva | ✅ enforced backend |
| Max 30 richieste per sessione | ✅ enforced backend (402 al 31°) |
| QR Code base | ✅ |
| Pagina pubblica base | ✅ |
| Branding IOMIXO visibile | ✅ footer normale |
| ❌ Link social pubblici | nascosti dal backend |
| ❌ Prossime date pubbliche | nascoste dal backend |
| ❌ Approva/Rifiuta richieste | bottoni nascosti; API ritorna 402 |
| ❌ Persone online | non inviato dal backend |

### Pro — €9.99/mese
Tutto del Free **più**:
- Sessioni live illimitate.
- Richieste illimitate.
- QR Code personalizzato *(roadmap)*.
- **Persone online in tempo reale**.
- Link social pubblici (Instagram, TikTok, Spotify, SoundCloud, sito).
- Prossime date / eventi pubblici.
- Approva / rifiuta richieste.
- Branding IOMIXO ridotto (footer più piccolo).
- Statistiche base *(roadmap)*.

### Pro Plus Wedding Edition — €19.99/mese
Tutto del Pro **più**:
- Multi DJ / multi staff *(in arrivo)*.
- Pagina locale / agenzia *(roadmap)*.
- Più sessioni contemporanee (già nel Pro, qui senza cap).
- Storico eventi *(roadmap)*.
- Statistiche avanzate *(roadmap)*.
- Branding personalizzato (footer IOMIXO **nascosto**).

---

## 5. Sicurezza e anti-abuse

- **Auth**: Supabase Auth (JWT, email + password). Service-role key solo lato backend.
- **RLS**: tabelle live accedute via service role; il backend fa il gating su `dj_id` e piano.
- **Rate-limit**:
  - 1 richiesta ogni 20s per `(session_id, ip_hash)`.
  - Map in-memory; TODO migrazione a Redis quando si scala oltre 1 istanza.
- **ip_hash**: SHA256(`SALT | IP | User-Agent`) — anonimizzato, usato per anti-spam e presence.
- **Presence**: Map in-memory `sessionId → Map<ipHash, lastTs>`, window 30s.
- **CORS**: whitelist domini, include IP LAN per testing.
- **File upload**: limite 5 MB, whitelist MIME, validazione magic bytes.

---

## 6. Architettura tecnica

### Frontend `mashfusion-ai/frontend`
- **Next.js 14** App Router, TypeScript.
- **Tailwind CSS** + componenti UI custom (`Card`, `Button`, `Badge`).
- **SWR** per data fetching con polling.
- **react-hot-toast** per notifiche.
- **qrcode.react** per QR.
- **framer-motion** per micro-animazioni.

### Backend `mashfusion-ai/backend`
- **Express + TypeScript**.
- **Supabase JS SDK** lato server (service role).
- **Stripe SDK** per checkout, portal e webhook.
- **Multer** per upload immagini.
- Middleware: `requireAuth` (verify JWT), `errorHandler`.

### Database `mashfusion-ai/database`
- **PostgreSQL via Supabase**.
- Migration applicate via `node migrate.js` (bootstrap idempotente).
- Tabelle chiave:
  - `users` (id, email, plan, avatar_url, stripe_customer_id, …).
  - `live_sessions` (dj_id, event_name, dj_name, description, is_active, public_slug, …).
  - `live_requests` (session_id, track_title, artist, message, status, ip_hash, …).
  - `dj_profiles` (user_id, display_name, bio, avatar_url, instagram/tiktok/spotify/soundcloud/website_url, public_slug).
  - `dj_events` (user_id, title, event_date, venue_name, city, ticket_url, is_public).
  - `subscriptions` (plan, stripe_subscription_id, current_period_end, cancel_at_period_end).

### Storage Supabase
- Bucket `avatars` (pubblico, 5 MB, JPEG/PNG/WEBP).
- Bucket `track-uploads`, `generated-outputs`, `stems` (legacy AI-engine, mantenuti).

### Stripe
- `STRIPE_PRICE_PRO_MONTHLY` → piano `pro`.
- `STRIPE_PRICE_CLUB_MONTHLY` → piano `club`.
- Webhook gestisce: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Normalizza `studio` → `club`.

---

## 7. Endpoint API principali

### Pubblici (no auth)
- `GET  /api/live/public/:slug` — info sessione + profilo + eventi.
- `POST /api/live/public/:slug/requests` — invia richiesta.
- `GET  /api/live/public/:slug/my-requests?ids=…` — stato richieste del dispositivo.
- `POST /api/live/public/:slug/heartbeat` — ping presenza.

### Autenticati (DJ)
- `GET  /api/user/me`, `PATCH /api/user/profile`, `PUT /api/user/avatar`.
- `GET/POST /api/live/sessions`, `GET/PATCH/DELETE /api/live/sessions/:id`.
- `GET /api/live/sessions/:id/requests`, `PATCH/DELETE /api/live/requests/:requestId`.
- `GET/PATCH /api/dj/profile`, `PUT /api/dj/profile/avatar`.
- `GET/POST/PATCH/DELETE /api/dj/events`.
- `POST /api/stripe/create-checkout`, `POST /api/stripe/create-portal`, webhook `/api/stripe/webhook`.

---

## 8. Roadmap implementazione (cosa manca per coprire 100% pricing)

1. **QR Code personalizzato (Pro)** — color picker + logo opzionale.
2. **Statistiche base (Pro)** — approval rate, top brano richiesto, picco di richieste.
3. **Statistiche avanzate (Club)** — aggregato cross-sessione, esportazione CSV.
4. **Storico eventi (Club)** — vista archivio sessioni chiuse con filtri data.
5. **Pagina locale / agenzia (Club)** — landing brandizzata per venue con elenco serate.
6. **Multi DJ / staff (Club)** — tabella `dj_staff`, inviti via email, ruoli.
7. **Redis** per rate-limit e presence quando il traffico supera 1 istanza Node.

---

*Documento generato automaticamente sulla base del codice in `mashfusion-ai/`.*
