import { Router, Request } from 'express'
import { supabaseAdmin } from '../config/supabase'
import { requireAuth } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { hashClient, rateLimitOk } from '../utils/ipHash'
import { getUserPlan, hasFeature, hasEventAccess } from '../services/plan'
import { PLAN_LIMITS } from '../config/plans'
import { isEventSession } from '../utils/sessionType'

export const liveDedicationsRouter = Router()

const userId = (req: Request) => (req as any).user.sub as string

// ── Helpers ────────────────────────────────────────────────────
async function getSessionByIdOwned(sessionId: string, djId: string) {
  const { data } = await supabaseAdmin
    .from('live_sessions')
    .select('id, dj_id, session_type')
    .eq('id', sessionId).eq('dj_id', djId).maybeSingle()
  return data
}

async function getSessionBySlug(slug: string) {
  const { data } = await supabaseAdmin
    .from('live_sessions')
    .select('id, dj_id, is_active, session_type')
    .eq('public_slug', slug).maybeSingle()
  return data
}

// ── PUBLIC: POST /api/live/public/:slug/dedications ───────────
liveDedicationsRouter.post('/public/:slug/dedications', async (req, res, next) => {
  try {
    const { guest_name, message } = req.body ?? {}
    if (!message || typeof message !== 'string') {
      throw new AppError('Messaggio obbligatorio', 400)
    }

    const session = await getSessionBySlug(req.params.slug)
    if (!session) throw new AppError('Sessione non trovata', 404)
    if (!isEventSession(session.session_type)) {
      throw new AppError('Dediche disponibili solo per sessioni Party Mode o Wedding Edition.', 400)
    }
    if (!(await hasEventAccess(session.dj_id, session.id))) {
      throw new AppError('Funzione disponibile con il piano Advance o un Event Pass 24H.', 402)
    }
    if (!session.is_active) throw new AppError('Questa sessione live è terminata.', 410)

    const ipHash = hashClient(req)
    if (!rateLimitOk(`ded:${session.id}`, ipHash, 30_000)) {
      throw new AppError('Riprova tra qualche secondo.', 429)
    }

    const { data, error } = await supabaseAdmin.from('live_dedications').insert({
      session_id: session.id,
      guest_name: guest_name ? String(guest_name).slice(0, 80) : null,
      message:    message.slice(0, 500),
      ip_hash:    ipHash,
    }).select('id, status, created_at').single()
    if (error) throw new AppError(error.message, 500)
    res.status(201).json({ data })
  } catch (e) { next(e) }
})

// ── PUBLIC: GET approved dedications (for live page + screen) ──
liveDedicationsRouter.get('/public/:slug/dedications', async (req, res, next) => {
  try {
    const session = await getSessionBySlug(req.params.slug)
    if (!session) throw new AppError('Sessione non trovata', 404)
    if (!isEventSession(session.session_type)) return res.json({ data: [] })

    const { data, error } = await supabaseAdmin
      .from('live_dedications')
      .select('id, guest_name, message, created_at')
      .eq('session_id', session.id).eq('status', 'approved')
      .order('created_at', { ascending: false }).limit(50)
    if (error) throw new AppError(error.message, 500)
    res.json({ data: data ?? [] })
  } catch (e) { next(e) }
})

// ── DJ: GET /api/live/sessions/:id/dedications ─────────────────
liveDedicationsRouter.get('/sessions/:id/dedications', requireAuth, async (req, res, next) => {
  try {
    const session = await getSessionByIdOwned(req.params.id, userId(req))
    if (!session) throw new AppError('Sessione non trovata', 404)
    const { data, error } = await supabaseAdmin
      .from('live_dedications').select('*')
      .eq('session_id', session.id).order('created_at', { ascending: false })
    if (error) throw new AppError(error.message, 500)
    res.json({ data: data ?? [] })
  } catch (e) { next(e) }
})

// ── DJ: PATCH dedication status ────────────────────────────────
liveDedicationsRouter.patch('/dedications/:id', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body ?? {}
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      throw new AppError('status non valido', 400)
    }
    const { data: existing } = await supabaseAdmin
      .from('live_dedications')
      .select('id, live_sessions!inner(dj_id, session_type)')
      .eq('id', req.params.id).maybeSingle()
    if (!existing || (existing as any).live_sessions?.dj_id !== userId(req)) {
      throw new AppError('Dedica non trovata', 404)
    }
    if (!(await hasEventAccess(userId(req)))) {
      throw new AppError('Funzione disponibile con il piano Advance o un Event Pass 24H.', 402)
    }

    const { data, error } = await supabaseAdmin
      .from('live_dedications').update({ status }).eq('id', req.params.id)
      .select('*').single()
    if (error) throw new AppError(error.message, 500)
    res.json({ data })
  } catch (e) { next(e) }
})

// ── DJ: DELETE ─────────────────────────────────────────────────
liveDedicationsRouter.delete('/dedications/:id', requireAuth, async (req, res, next) => {
  try {
    const { data: existing } = await supabaseAdmin
      .from('live_dedications')
      .select('id, live_sessions!inner(dj_id)')
      .eq('id', req.params.id).maybeSingle()
    if (!existing || (existing as any).live_sessions?.dj_id !== userId(req)) {
      throw new AppError('Dedica non trovata', 404)
    }
    const { error } = await supabaseAdmin
      .from('live_dedications').delete().eq('id', req.params.id)
    if (error) throw new AppError(error.message, 500)
    res.status(204).end()
  } catch (e) { next(e) }
})
