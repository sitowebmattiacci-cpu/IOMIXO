import { Router, Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../config/supabase'
import { requireAuth } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { uniqueSlug } from '../utils/slug'
import { canCreateSession } from '../services/liveLimits'
import { countOnline } from '../services/livePresence'
import { getUserPlan, hasEventAccess, requireEventAccess } from '../services/plan'
import { PLAN_LIMITS } from '../config/plans'
import { deleteWeddingPhoto } from '../services/storage'

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

    // Wedding · Proclamazione Vincitore: gate specifico applicato SOLO se
    // il payload contiene esplicitamente la chiave `screen_config.winner_announcement`.
    // Non modifica la policy generale di screen_config per gli altri campi
    // (roulette, shoe_game, polls, video_live, stand_up_guess, ecc.).
    //
    // Distinzione dei 3 casi:
    //   (a) chiave assente          → nessun gate, comportamento invariato
    //   (b) oggetto { … }           → gate + validazione path + cleanup file sostituiti
    //   (c) valore `null` esplicito → gate + cleanup TOTALE (reset feature: cancella
    //                                 entrambe le foto vecchie dal bucket)
    //
    // Il check è basato su `'winner_announcement' in screen_config`, non su
    // `typeof … === 'object'`, perché in JS `typeof null === 'object'` e non
    // distingue tra (a) e (c).
    //
    // Regole del gate (identiche a photos/init upload):
    //   1. ownership: la sessione appartiene al DJ autenticato → `.eq('dj_id', userId)`.
    //   2. session_type === 'wedding' → 403 altrimenti.
    //   3. hasEventAccess(userId, sessionId) → 402 altrimenti. Copre già:
    //      - plan Advance (`profile.plan === 'wedding'`)
    //      - Event Pass 24H attivo per la sessione o globale
    //   4. path scope (solo caso b): groom_photo_path e bride_photo_path
    //      devono essere null OR string che inizia con `${sessionId}/` → 400.
    //
    // Cleanup file: eseguito DOPO l'UPDATE, fire-and-forget, mai bloccante.
    let staleWinnerPhotos: string[] = []
    const hasWinnerKey =
      typeof screen_config === 'object' &&
      screen_config !== null &&
      Object.prototype.hasOwnProperty.call(screen_config, 'winner_announcement')

    if (hasWinnerKey) {
      const nextWinner = (screen_config as any).winner_announcement

      // Tipo consentito: object non-array oppure null. Qualsiasi altra cosa → 400.
      const isObject = typeof nextWinner === 'object' && nextWinner !== null && !Array.isArray(nextWinner)
      const isNullReset = nextWinner === null
      if (!isObject && !isNullReset) {
        throw new AppError('winner_announcement deve essere object o null', 400)
      }

      // (4) Path scope: solo se stiamo aggiornando l'oggetto. Il reset (null)
      // non contiene path da validare.
      if (isObject) {
        for (const key of ['groom_photo_path', 'bride_photo_path'] as const) {
          const p = nextWinner[key]
          if (p !== null && p !== undefined) {
            if (typeof p !== 'string' || !p.startsWith(`${req.params.id}/`)) {
              throw new AppError(`${key} non valido per questa sessione`, 400)
            }
          }
        }
      }

      // (1) + (2): SELECT con dj_id (ownership) + session_type + screen_config
      // (necessario anche per il cleanup dei file sostituiti/rimossi). Una sola query.
      const { data: current } = await supabaseAdmin
        .from('live_sessions')
        .select('session_type, screen_config')
        .eq('id', req.params.id)
        .eq('dj_id', userId(req))
        .maybeSingle()
      if (!current) throw new AppError('Sessione non trovata', 404)
      if (current.session_type !== 'wedding') {
        throw new AppError('Proclamazione vincitore disponibile solo in Wedding Edition.', 403)
      }

      // (3) Advance plan OR Event Pass 24H attivo. Riusa la stessa logica
      // usata da photos/init e dagli altri gate Wedding/Event.
      await requireEventAccess(userId(req), req.params.id)

      // Cleanup: raccogli le foto sostituite/rimosse. Nel caso "null reset"
      // il newPath è implicitamente null → entrambe le foto precedenti (se
      // presenti e appartenenti alla sessione) vengono cancellate.
      const prevWinner = (current.screen_config as any)?.winner_announcement
      if (prevWinner && typeof prevWinner === 'object') {
        for (const key of ['groom_photo_path', 'bride_photo_path'] as const) {
          const oldPath = prevWinner[key]
          const newPath = isNullReset ? null : nextWinner[key]
          if (
            typeof oldPath === 'string' &&
            oldPath.length > 0 &&
            oldPath !== newPath &&
            // safety ridondante: il path deve appartenere alla sessione
            oldPath.startsWith(`${req.params.id}/`)
          ) {
            staleWinnerPhotos.push(oldPath)
          }
        }
      }
    }

    const { data, error } = await supabaseAdmin
      .from('live_sessions').update(patch).eq('id', req.params.id).eq('dj_id', userId(req))
      .select('*').maybeSingle()
    if (error) throw new AppError(error.message, 500)
    if (!data) throw new AppError('Sessione non trovata', 404)

    // Cleanup fire-and-forget dopo il commit (mai bloccante).
    for (const path of staleWinnerPhotos) {
      deleteWeddingPhoto(path).catch(() => {})
    }

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
