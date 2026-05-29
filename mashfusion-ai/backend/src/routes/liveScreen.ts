import { Router } from 'express'
import { supabaseAdmin } from '../config/supabase'
import { AppError } from '../middleware/errorHandler'
import { hasEventAccess } from '../services/plan'
import { isEventSession } from '../utils/sessionType'
import { createWeddingPhotoSignedUrl } from '../services/storage'

export const liveScreenRouter = Router()

// ── PUBLIC: aggregated payload for the TV/projector screen ─────
// GET /api/live/public/:slug/screen
liveScreenRouter.get('/public/:slug/screen', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions')
      .select('id, dj_id, event_name, dj_name, session_type, couple_names, wedding_date, venue_name, screen_mode_enabled, screen_config, is_active')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)
    if (!isEventSession(session.session_type)) {
      throw new AppError('Schermo live disponibile solo per sessioni Party Mode o Wedding Edition.', 400)
    }

    if (!(await hasEventAccess(session.dj_id, session.id))) {
      throw new AppError('Funzione disponibile con il piano Advance o un Event Pass 24H.', 402)
    }

    const [roundRes, shoeRes, pollRes, dedRes, photoRes] = await Promise.all([
      supabaseAdmin.from('live_game_rounds')
        .select('id, game_type, status, result, config, created_at')
        .eq('session_id', session.id).eq('game_type', 'wedding_roulette')
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from('live_game_rounds')
        .select('id, game_type, status, result, config, created_at')
        .eq('session_id', session.id).eq('game_type', 'shoe_game')
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from('live_polls')
        .select('id, question, options, created_at')
        .eq('session_id', session.id).eq('is_active', true)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from('live_dedications')
        .select('id, guest_name, message, created_at')
        .eq('session_id', session.id).eq('status', 'approved')
        .order('created_at', { ascending: false }).limit(6),
      supabaseAdmin.from('live_photos')
        .select('id, guest_name, caption, storage_path, created_at')
        .eq('session_id', session.id).eq('status', 'approved')
        .order('created_at', { ascending: false }).limit(12),
    ])

    let pollPayload: any = null
    if (pollRes.data) {
      const { data: votes } = await supabaseAdmin
        .from('live_poll_votes').select('option_index').eq('poll_id', pollRes.data.id)
      const tally = new Array((pollRes.data.options as unknown[]).length).fill(0)
      for (const v of votes ?? []) tally[v.option_index] = (tally[v.option_index] ?? 0) + 1
      pollPayload = { ...pollRes.data, tally }
    }

    const photos = await Promise.all((photoRes.data ?? []).map(async (p) => ({
      id: p.id, guest_name: p.guest_name, caption: p.caption, created_at: p.created_at,
      url: await createWeddingPhotoSignedUrl(p.storage_path, 3600).catch(() => null),
    })))

    // Apply screen_config filters (show only if explicitly enabled)
    // @ts-ignore - screen_config might not exist in DB yet
    const config = session.screen_config ?? {}
    console.log('🔍 Screen config:', JSON.stringify(config))
    const showPhotos = config.show_photos === true
    const showDedications = config.show_dedications === true
    const showRoulette = config.show_roulette === true
    const showShoeGame = config.show_shoe_game === true
    const showPolls = config.show_polls === true
    console.log('✓ Visibility:', { showPhotos, showDedications, showRoulette, showShoeGame, showPolls })

    res.json({
      data: {
        session: {
          event_name:    session.event_name,
          dj_name:       session.dj_name,
          couple_names:  session.couple_names,
          wedding_date:  session.wedding_date,
          venue_name:    session.venue_name,
          is_active:     session.is_active,
          screen_config: session.screen_config,
        },
        roulette:    showRoulette && roundRes.data?.result ? roundRes.data : null,
        shoe_game:   showShoeGame ? (shoeRes.data ?? null) : null,
        active_poll: showPolls ? pollPayload : null,
        dedications: showDedications ? (dedRes.data ?? []) : [],
        photos:      showPhotos ? photos : [],
      },
    })
  } catch (e) { next(e) }
})
