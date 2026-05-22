import { Router } from 'express'
import { supabaseAdmin } from '../config/supabase'
import { AppError } from '../middleware/errorHandler'
import { canAcceptRequest } from '../services/liveLimits'
import { hashClient, rateLimitOk } from '../utils/ipHash'
import { markPresent } from '../services/livePresence'
import { PLAN_LIMITS } from '../config/plans'
import { getUserPlan } from '../services/plan'
import { createWeddingPhotoSignedUrl } from '../services/storage'

export const livePublicRouter = Router()

// ── GET /api/live/public/:slug ─────────────────────────────────
// Public read: returns session info + DJ profile (social) + upcoming events.
livePublicRouter.get('/:slug', async (req, res, next) => {
  try {
    const { data: session, error } = await supabaseAdmin
      .from('live_sessions')
      .select('id, dj_id, event_name, dj_name, description, is_active, public_slug, created_at, session_type, couple_names, wedding_date, venue_name, screen_mode_enabled')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (error) throw new AppError(error.message, 500)
    if (!session) throw new AppError('Sessione non trovata', 404)

    const [profileRes, eventsRes, requestsRes, planTier] = await Promise.all([
      supabaseAdmin.from('dj_profiles')
        .select('display_name, bio, avatar_url, instagram_url, tiktok_url, spotify_url, soundcloud_url, website_url')
        .eq('user_id', session.dj_id).maybeSingle(),
      supabaseAdmin.from('dj_events')
        .select('id, title, event_date, venue_name, city, ticket_url')
        .eq('user_id', session.dj_id).eq('is_public', true)
        .gte('event_date', new Date().toISOString().slice(0, 10))
        .order('event_date', { ascending: true }).limit(10),
      supabaseAdmin.from('live_requests')
        .select('id', { count: 'exact', head: true }).eq('session_id', session.id),
      getUserPlan(session.dj_id),
    ])

    const limits = PLAN_LIMITS[planTier]
    const used   = requestsRes.count ?? 0
    const remaining = isFinite(limits.maxRequestsPerSession)
      ? Math.max(0, limits.maxRequestsPerSession - used)
      : null

    // Strip plan-locked fields. Free DJs get only avatar + display_name + bio;
    // socials and upcoming-events sections are hidden until they upgrade.
    const rawProfile = profileRes.data
    const profile = rawProfile ? {
      display_name:    rawProfile.display_name,
      bio:             rawProfile.bio,
      avatar_url:      rawProfile.avatar_url,
      instagram_url:   limits.profileSocials ? rawProfile.instagram_url   : null,
      tiktok_url:      limits.profileSocials ? rawProfile.tiktok_url      : null,
      spotify_url:     limits.profileSocials ? rawProfile.spotify_url     : null,
      soundcloud_url:  limits.profileSocials ? rawProfile.soundcloud_url  : null,
      website_url:     limits.profileSocials ? rawProfile.website_url     : null,
    } : null
    const events = limits.upcomingEvents ? (eventsRes.data ?? []) : []

    res.json({
      data: {
        session: {
          id:                   session.id,
          event_name:           session.event_name,
          dj_name:              session.dj_name,
          description:          session.description,
          is_active:            session.is_active,
          session_type:         session.session_type ?? 'standard',
          couple_names:         session.couple_names ?? null,
          wedding_date:         session.wedding_date ?? null,
          venue_name:           session.venue_name ?? null,
          screen_mode_enabled:  session.screen_mode_enabled ?? false,
        },
        profile,
        events,
        plan:    planTier,
        branding: limits.customBranding,
        features: {
          weddingDedications: limits.weddingDedications,
          weddingGames:       limits.weddingGames,
          livePolls:          limits.livePolls,
          guestPhotoAlbum:    limits.guestPhotoAlbum,
          screenMode:         limits.screenMode,
        },
        requestsRemaining: remaining,
      },
    })
  } catch (e) { next(e) }
})

// ── POST /api/live/public/:slug/requests ───────────────────────
livePublicRouter.post('/:slug/requests', async (req, res, next) => {
  try {
    const { track_title, artist, message } = req.body ?? {}
    if (!track_title || typeof track_title !== 'string') {
      throw new AppError('Titolo canzone obbligatorio', 400)
    }

    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id, dj_id, is_active, public_slug')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)
    if (!session.is_active) throw new AppError('Questa sessione live è terminata.', 410)

    const ipHash = hashClient(req)
    if (!rateLimitOk(`req:${session.id}`, ipHash)) {
      throw new AppError('Puoi inviare una richiesta ogni 20 secondi.', 429)
    }

    const limit = await canAcceptRequest(session.id, session.dj_id)
    if (!limit.ok) throw new AppError(limit.reason ?? 'Limite raggiunto', 402)

    const { data, error } = await supabaseAdmin.from('live_requests').insert({
      session_id:   session.id,
      track_title:  track_title.slice(0, 200),
      artist:       artist  ? String(artist).slice(0, 200)  : null,
      message:      message ? String(message).slice(0, 500) : null,
      ip_hash:      ipHash,
    }).select('id, track_title, artist, status, created_at').single()
    if (error) throw new AppError(error.message, 500)

    res.status(201).json({ data })
  } catch (e) { next(e) }
})

// ── GET /api/live/public/:slug/my-requests?ids=… ───────────────
// Public read for the audience: lets a phone poll the status of its own
// previously-submitted requests (ids stored client-side in localStorage).
livePublicRouter.get('/:slug/my-requests', async (req, res, next) => {
  try {
    const idsParam = String(req.query.ids ?? '').trim()
    if (!idsParam) return res.json({ data: [] })
    const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20)
    if (ids.length === 0) return res.json({ data: [] })

    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const { data, error } = await supabaseAdmin
      .from('live_requests')
      .select('id, track_title, artist, status, created_at')
      .eq('session_id', session.id)
      .in('id', ids)
      .order('created_at', { ascending: false })
    if (error) throw new AppError(error.message, 500)

    res.json({ data: data ?? [] })
  } catch (e) { next(e) }
})

// ── POST /api/live/public/:slug/heartbeat ──────────────────────
// Audience presence ping. Called every ~10s by the public page.
livePublicRouter.post('/:slug/heartbeat', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id, is_active')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session || !session.is_active) return res.json({ ok: false })
    markPresent(session.id, hashClient(req))
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// ══════════════════════════════════════════════════════════════
// REMOTE CONTROL ENDPOINTS (DJ/Entertainer public access via QR)
// ══════════════════════════════════════════════════════════════

// ── GET /api/live/public/:slug/requests ────────────────────────
// List ALL requests for DJ remote control
livePublicRouter.get('/:slug/requests', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const { data, error } = await supabaseAdmin
      .from('live_requests')
      .select('id, track_title, artist, message, status, guest_name, created_at')
      .eq('session_id', session.id)
      .order('created_at', { ascending: false })
    if (error) throw new AppError(error.message, 500)

    res.json({ data: data ?? [] })
  } catch (e) { next(e) }
})

// ── PATCH /api/live/public/:slug/requests/:id ──────────────────
// Update request status (DJ remote control)
livePublicRouter.patch('/:slug/requests/:id', async (req, res, next) => {
  try {
    const { status } = req.body ?? {}
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      throw new AppError('Status non valido', 400)
    }

    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const { data, error } = await supabaseAdmin
      .from('live_requests')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('session_id', session.id)
      .select('id, status')
      .maybeSingle()
    if (error) throw new AppError(error.message, 500)
    if (!data) throw new AppError('Richiesta non trovata', 404)

    res.json({ data })
  } catch (e) { next(e) }
})

// ── GET /api/live/public/:slug/dedications ─────────────────────
// List dedications (DJ remote control)
livePublicRouter.get('/:slug/dedications', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const { data, error } = await supabaseAdmin
      .from('live_dedications')
      .select('id, guest_name, message, status, created_at')
      .eq('session_id', session.id)
      .order('created_at', { ascending: false })
    if (error) throw new AppError(error.message, 500)

    res.json({ data: data ?? [] })
  } catch (e) { next(e) }
})

// ── PATCH /api/live/public/:slug/dedications/:id ───────────────
// Update dedication status (DJ remote control)
livePublicRouter.patch('/:slug/dedications/:id', async (req, res, next) => {
  try {
    const { status } = req.body ?? {}
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      throw new AppError('Status non valido', 400)
    }

    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const { data, error } = await supabaseAdmin
      .from('live_dedications')
      .update({ status })
      .eq('id', req.params.id)
      .eq('session_id', session.id)
      .select('id, status')
      .maybeSingle()
    if (error) throw new AppError(error.message, 500)
    if (!data) throw new AppError('Dedica non trovata', 404)

    res.json({ data })
  } catch (e) { next(e) }
})

// ── GET /api/live/public/:slug/photos ──────────────────────────
// List photos (DJ remote control)
livePublicRouter.get('/:slug/photos', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const { data, error } = await supabaseAdmin
      .from('live_photos')
      .select('id, guest_name, caption, status, storage_path, created_at')
      .eq('session_id', session.id)
      .order('created_at', { ascending: false })
    if (error) throw new AppError(error.message, 500)

    const photos = await Promise.all((data ?? []).map(async (p: any) => ({
      id: p.id,
      guest_name: p.guest_name,
      caption: p.caption,
      status: p.status,
      created_at: p.created_at,
      url: await createWeddingPhotoSignedUrl(p.storage_path, 3600).catch(() => null),
    })))

    res.json({ data: photos })
  } catch (e) { next(e) }
})

// ── PATCH /api/live/public/:slug/photos/:id ────────────────────
// Update photo status (DJ remote control)
livePublicRouter.patch('/:slug/photos/:id', async (req, res, next) => {
  try {
    const { status } = req.body ?? {}
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      throw new AppError('Status non valido', 400)
    }

    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const { data, error } = await supabaseAdmin
      .from('live_photos')
      .update({ status })
      .eq('id', req.params.id)
      .eq('session_id', session.id)
      .select('id, status')
      .maybeSingle()
    if (error) throw new AppError(error.message, 500)
    if (!data) throw new AppError('Foto non trovata', 404)

    res.json({ data })
  } catch (e) { next(e) }
})

// ── POST /api/live/public/:slug/games/roulette/start ───────────
// Start roulette (DJ remote control)
livePublicRouter.post('/:slug/games/roulette/start', async (req, res, next) => {
  try {
    const { categories } = req.body ?? {}
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id, dj_id, roulette_penitenze')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const plan = await getUserPlan(session.dj_id)
    if (!PLAN_LIMITS[plan].weddingGames) {
      throw new AppError('Giochi Wedding non disponibili', 402)
    }

    const customPenitenze = session.roulette_penitenze ?? null
    let slots: string[] = []

    if (customPenitenze && Array.isArray(customPenitenze) && customPenitenze.length > 0) {
      slots = customPenitenze
        .filter((p: any) => p.enabled !== false && categories?.includes?.(p.category))
        .map((p: any) => p.label)
    } else {
      const DEFAULT_PENITENZE = [
        { label: 'Brindisi agli sposi 🥂', category: 'soft' },
        { label: 'Foto di gruppo 📸', category: 'soft' },
        { label: 'Discorso romantico 💌', category: 'soft' },
        { label: 'Ballo di gruppo 🕺', category: 'party' },
        { label: 'Discorso ubriaco 😂', category: 'party' },
        { label: 'Servi da bere 🍾', category: 'party' },
        { label: 'Fai cantare il tavolo 🎤', category: 'party' },
        { label: 'Corri dagli sposi 🏃', category: 'wild' },
        { label: 'Shot misterioso 🎯', category: 'wild' },
      ]
      slots = DEFAULT_PENITENZE
        .filter((p) => categories?.includes?.(p.category))
        .map((p) => p.label)
    }

    if (slots.length === 0) {
      throw new AppError('Nessuna penitenza disponibile per le categorie selezionate', 400)
    }

    const { data, error } = await supabaseAdmin
      .from('live_game_rounds')
      .insert({
        session_id: session.id,
        game_type: 'wedding_roulette',
        status: 'idle',
        config: { slots },
      })
      .select('id, game_type, status, config')
      .single()
    if (error) throw new AppError(error.message, 500)

    res.json({ data })
  } catch (e) { next(e) }
})

// ── POST /api/live/public/:slug/games/roulette/spin ────────────
// Spin roulette (DJ remote control)
livePublicRouter.post('/:slug/games/roulette/spin', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const { data: round } = await supabaseAdmin
      .from('live_game_rounds')
      .select('*')
      .eq('session_id', session.id)
      .eq('game_type', 'wedding_roulette')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!round) throw new AppError('Nessuna roulette attiva', 404)

    const slots = (round.config as any)?.slots ?? []
    if (slots.length === 0) throw new AppError('Nessuna penitenza configurata', 400)

    const slotIndex = Math.floor(Math.random() * slots.length)
    const slotLabel = slots[slotIndex]
    const pickedAt = new Date().toISOString()

    const { data, error } = await supabaseAdmin
      .from('live_game_rounds')
      .update({
        status: 'running',
        result: { slot_index: slotIndex, slot_label: slotLabel, picked_at: pickedAt },
        updated_at: pickedAt,
      })
      .eq('id', round.id)
      .select('*')
      .single()
    if (error) throw new AppError(error.message, 500)

    res.json({ data })
  } catch (e) { next(e) }
})

// ── POST /api/live/public/:slug/games/roulette/reset ───────────
// Reset roulette (DJ remote control)
livePublicRouter.post('/:slug/games/roulette/reset', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const { data: round } = await supabaseAdmin
      .from('live_game_rounds')
      .select('id')
      .eq('session_id', session.id)
      .eq('game_type', 'wedding_roulette')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!round) throw new AppError('Nessuna roulette trovata', 404)

    const { error } = await supabaseAdmin
      .from('live_game_rounds')
      .update({ status: 'idle', result: null, updated_at: new Date().toISOString() })
      .eq('id', round.id)
    if (error) throw new AppError(error.message, 500)

    res.json({ data: { ok: true } })
  } catch (e) { next(e) }
})

// ── GET /api/live/public/:slug/games/shoe ──────────────────────
// Get shoe game state (DJ remote control)
livePublicRouter.get('/:slug/games/shoe', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const { data: round } = await supabaseAdmin
      .from('live_game_rounds')
      .select('*')
      .eq('session_id', session.id)
      .eq('game_type', 'shoe_game')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    res.json({ data: round ?? null })
  } catch (e) { next(e) }
})

// ── POST /api/live/public/:slug/games/shoe/start ───────────────
// Start shoe game (DJ remote control)
livePublicRouter.post('/:slug/games/shoe/start', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id, dj_id, shoe_game_questions')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const plan = await getUserPlan(session.dj_id)
    if (!PLAN_LIMITS[plan].weddingGames) {
      throw new AppError('Giochi Wedding non disponibili', 402)
    }

    const questions = session.shoe_game_questions ?? [
      'Chi ha fatto il primo passo?',
      'Chi è più geloso?',
      'Chi ha sempre ragione?',
      'Chi è più romantico?',
      'Chi cucina meglio?',
      'Chi spende più soldi?',
      'Chi è più disordinato?',
      'Chi guida meglio?',
      'Chi è più puntuale?',
      'Chi dorme di più?',
      'Chi è più social?',
      'Chi ha più pazienza?',
      'Chi decide cosa guardare in TV?',
      'Chi ha scelto questa musica?',
      'Chi ama di più l\'altro? ❤️',
    ]

    const { data, error } = await supabaseAdmin
      .from('live_game_rounds')
      .insert({
        session_id: session.id,
        game_type: 'shoe_game',
        status: 'running',
        config: { questions, current_index: 0, is_active: true },
      })
      .select('*')
      .single()
    if (error) throw new AppError(error.message, 500)

    res.json({ data })
  } catch (e) { next(e) }
})

// ── POST /api/live/public/:slug/games/shoe/next ────────────────
// Next shoe game question (DJ remote control)
livePublicRouter.post('/:slug/games/shoe/next', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const { data: round } = await supabaseAdmin
      .from('live_game_rounds')
      .select('*')
      .eq('session_id', session.id)
      .eq('game_type', 'shoe_game')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!round) throw new AppError('Nessun gioco della scarpa attivo', 404)

    const config = (round.config as any) ?? {}
    const questions = config.questions ?? []
    const currentIndex = config.current_index ?? 0
    const nextIndex = Math.min(currentIndex + 1, questions.length - 1)

    const { data, error } = await supabaseAdmin
      .from('live_game_rounds')
      .update({
        config: { ...config, current_index: nextIndex },
        updated_at: new Date().toISOString(),
      })
      .eq('id', round.id)
      .select('*')
      .single()
    if (error) throw new AppError(error.message, 500)

    res.json({ data })
  } catch (e) { next(e) }
})

// ── POST /api/live/public/:slug/games/shoe/reset ───────────────
// Reset shoe game (DJ remote control)
livePublicRouter.post('/:slug/games/shoe/reset', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const { data: round } = await supabaseAdmin
      .from('live_game_rounds')
      .select('id')
      .eq('session_id', session.id)
      .eq('game_type', 'shoe_game')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!round) throw new AppError('Nessun gioco trovato', 404)

    const { error } = await supabaseAdmin
      .from('live_game_rounds')
      .update({
        status: 'idle',
        config: { questions: [], current_index: 0, is_active: false },
        updated_at: new Date().toISOString(),
      })
      .eq('id', round.id)
    if (error) throw new AppError(error.message, 500)

    res.json({ data: { ok: true } })
  } catch (e) { next(e) }
})
