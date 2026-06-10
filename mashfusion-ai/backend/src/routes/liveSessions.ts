import { Router, Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../config/supabase'
import { requireAuth } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { uniqueSlug } from '../utils/slug'
import { canCreateSession } from '../services/liveLimits'
import { countOnline } from '../services/livePresence'
import { getUserPlan, hasEventAccess } from '../services/plan'
import { PLAN_LIMITS } from '../config/plans'

export const liveSessionsRouter = Router()

const userId = (req: Request) => (req as any).user.sub as string

// ── POST /api/live/sessions ────────────────────────────────────
liveSessionsRouter.post('/sessions', requireAuth, async (req, res, next) => {
  try {
    const {
      event_name, dj_name, description,
      session_type, couple_names, wedding_date, venue_name, screen_mode_enabled,
    } = req.body ?? {}
    if (!event_name || typeof event_name !== 'string') throw new AppError('event_name richiesto', 400)

    // Session type can be 'standard' | 'party' | 'wedding'.
    // Both 'party' and 'wedding' require Advance access: piano Advance reale
    // OPPURE un Event Pass 24H attivo (accesso premium temporaneo).
    const type: 'standard' | 'party' | 'wedding' =
      session_type === 'wedding' ? 'wedding'
      : session_type === 'party' ? 'party'
      : 'standard'

    if (type === 'wedding' || type === 'party') {
      const hasAccess = await hasEventAccess(userId(req))
      if (!hasAccess) {
        throw new AppError(
          'Questa modalità è disponibile con il piano Advance o un Event Pass 24H.',
          402,
        )
      }
    }

    const limit = await canCreateSession(userId(req))
    if (!limit.ok) throw new AppError(limit.reason ?? 'Limite raggiunto', 402)

    const slug = await uniqueSlug(async (s) => {
      const { data } = await supabaseAdmin.from('live_sessions').select('id').eq('public_slug', s).maybeSingle()
      return !!data
    })

    const insertPayload: Record<string, unknown> = {
      dj_id:        userId(req),
      event_name,
      dj_name:      dj_name ?? null,
      description:  description ?? null,
      public_slug:  slug,
      is_active:    true,
      session_type: type,
    }
    if (type === 'wedding') {
      if (typeof couple_names === 'string')      insertPayload.couple_names = couple_names
      if (typeof wedding_date === 'string')      insertPayload.wedding_date = wedding_date
      if (typeof venue_name === 'string')        insertPayload.venue_name = venue_name
      if (typeof screen_mode_enabled === 'boolean') insertPayload.screen_mode_enabled = screen_mode_enabled
    }

    const { data, error } = await supabaseAdmin.from('live_sessions')
      .insert(insertPayload).select('*').single()
    if (error) throw new AppError(error.message, 500)

    res.status(201).json({ data })
  } catch (e) { next(e) }
})

// ── GET /api/live/sessions ─────────────────────────────────────
liveSessionsRouter.get('/sessions', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('live_sessions').select('*').eq('dj_id', userId(req))
      .order('created_at', { ascending: false })
    if (error) throw new AppError(error.message, 500)
    res.json({ data: data ?? [] })
  } catch (e) { next(e) }
})

// ── GET /api/live/sessions/:id ─────────────────────────────────
liveSessionsRouter.get('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('live_sessions').select('*').eq('id', req.params.id).eq('dj_id', userId(req)).maybeSingle()
    if (error) throw new AppError(error.message, 500)
    if (!data) throw new AppError('Sessione non trovata', 404)
    const plan = await getUserPlan(userId(req))
    const online_count = plan === 'free' ? null : countOnline(data.id)
    res.json({ data: { ...data, online_count } })
  } catch (e) { next(e) }
})

// ── PATCH /api/live/sessions/:id ───────────────────────────────
liveSessionsRouter.patch('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const {
      event_name, dj_name, description, is_active,
      couple_names, wedding_date, venue_name, screen_mode_enabled, screen_config, guest_config, roulette_penitenze, shoe_game_questions,
    } = req.body ?? {}
    const patch: Record<string, unknown> = {}
    if (typeof event_name  === 'string')  patch.event_name  = event_name
    if (typeof dj_name     === 'string')  patch.dj_name     = dj_name
    if (typeof description === 'string')  patch.description = description
    if (typeof is_active   === 'boolean') patch.is_active   = is_active
    if (typeof couple_names         === 'string')  patch.couple_names         = couple_names
    if (typeof wedding_date         === 'string')  patch.wedding_date         = wedding_date
    if (typeof venue_name           === 'string')  patch.venue_name           = venue_name
    if (typeof screen_mode_enabled  === 'boolean') patch.screen_mode_enabled  = screen_mode_enabled
    if (typeof screen_config        === 'object')  patch.screen_config        = screen_config
    if (typeof guest_config         === 'object')  patch.guest_config         = guest_config
    if (roulette_penitenze !== undefined)          patch.roulette_penitenze   = roulette_penitenze
    if (shoe_game_questions !== undefined)         patch.shoe_game_questions  = shoe_game_questions

    const { data, error } = await supabaseAdmin
      .from('live_sessions').update(patch).eq('id', req.params.id).eq('dj_id', userId(req))
      .select('*').maybeSingle()
    if (error) throw new AppError(error.message, 500)
    if (!data) throw new AppError('Sessione non trovata', 404)
    res.json({ data })
  } catch (e) { next(e) }
})

// ── DELETE /api/live/sessions/:id ──────────────────────────────
liveSessionsRouter.delete('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('live_sessions').delete().eq('id', req.params.id).eq('dj_id', userId(req))
    if (error) throw new AppError(error.message, 500)
    res.status(204).end()
  } catch (e) { next(e) }
})

// ── GET /api/live/sessions/:id/requests ────────────────────────
liveSessionsRouter.get('/sessions/:id/requests', requireAuth, async (req, res, next) => {
  try {
    // ownership check
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id').eq('id', req.params.id).eq('dj_id', userId(req)).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)

    const { data, error } = await supabaseAdmin
      .from('live_requests').select('*').eq('session_id', req.params.id)
      .order('created_at', { ascending: false })
    if (error) throw new AppError(error.message, 500)
    res.json({ data: data ?? [] })
  } catch (e) { next(e) }
})

// ── PATCH /api/live/requests/:requestId ────────────────────────
liveSessionsRouter.patch('/requests/:requestId', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body ?? {}
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      throw new AppError('status non valido', 400)
    }

    const plan = await getUserPlan(userId(req))
    if (!PLAN_LIMITS[plan].approveRequests) {
      throw new AppError('Approva/rifiuta non disponibile per il tuo piano', 402)
    }

    // Ensure the request belongs to a session owned by the caller
    const { data: existing } = await supabaseAdmin
      .from('live_requests')
      .select('id, session_id, live_sessions!inner(dj_id)')
      .eq('id', req.params.requestId)
      .maybeSingle()
    if (!existing || (existing as any).live_sessions?.dj_id !== userId(req)) {
      throw new AppError('Richiesta non trovata', 404)
    }

    const { data, error } = await supabaseAdmin
      .from('live_requests').update({ status }).eq('id', req.params.requestId)
      .select('*').single()
    if (error) throw new AppError(error.message, 500)
    res.json({ data })
  } catch (e) { next(e) }
})

// ── DELETE /api/live/requests/:requestId ───────────────────────
liveSessionsRouter.delete('/requests/:requestId', requireAuth, async (req, res, next) => {
  try {
    const { data: existing } = await supabaseAdmin
      .from('live_requests')
      .select('id, live_sessions!inner(dj_id)')
      .eq('id', req.params.requestId)
      .maybeSingle()
    if (!existing || (existing as any).live_sessions?.dj_id !== userId(req)) {
      throw new AppError('Richiesta non trovata', 404)
    }
    const { error } = await supabaseAdmin
      .from('live_requests').delete().eq('id', req.params.requestId)
    if (error) throw new AppError(error.message, 500)
    res.status(204).end()
  } catch (e) { next(e) }
})
