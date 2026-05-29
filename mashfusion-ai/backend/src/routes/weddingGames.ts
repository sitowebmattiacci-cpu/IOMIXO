import { Router, Request } from 'express'
import { supabaseAdmin } from '../config/supabase'
import { requireAuth } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { hashClient, rateLimitOk } from '../utils/ipHash'
import { getUserPlan, hasEventAccess } from '../services/plan'
import { PLAN_LIMITS } from '../config/plans'

export const weddingGamesRouter = Router()

const userId = (req: Request) => (req as any).user.sub as string

async function ownedWeddingSession(sessionId: string, djId: string) {
  const { data } = await supabaseAdmin
    .from('live_sessions')
    .select('id, dj_id, session_type, is_active')
    .eq('id', sessionId).eq('dj_id', djId).maybeSingle()
  if (!data) throw new AppError('Sessione non trovata', 404)
  if (data.session_type !== 'wedding') {
    throw new AppError('Funzione disponibile solo per sessioni Wedding Edition.', 400)
  }
  return data
}

async function requireWeddingFeature(djId: string) {
  const hasAccess = await hasEventAccess(djId)
  if (!hasAccess) {
    throw new AppError('Funzione disponibile con il piano Advance o un Event Pass 24H.', 402)
  }
}

// ════════════════════════════════════════════════════════════════
// FUTURE MESSAGES
// ════════════════════════════════════════════════════════════════

// ── PUBLIC: submit a future message ────────────────────────────
weddingGamesRouter.post('/public/:slug/future-messages', async (req, res, next) => {
  try {
    const { guest_name, message, delivery_year } = req.body ?? {}
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      throw new AppError('Messaggio obbligatorio', 400)
    }

    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id, session_type, is_active')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)
    if (session.session_type !== 'wedding') {
      throw new AppError('Funzione disponibile solo per Wedding Edition.', 400)
    }
    if (!session.is_active) throw new AppError('Sessione chiusa.', 410)

    const ipHash = hashClient(req)
    if (!rateLimitOk('future-msg', ipHash, 10_000)) {
      throw new AppError('Riprova tra 10 secondi.', 429)
    }

    const { data, error } = await supabaseAdmin.from('live_future_messages').insert({
      session_id: session.id,
      guest_name: guest_name?.slice(0, 100) || null,
      message: message.slice(0, 500),
      delivery_year: delivery_year?.slice(0, 20) || null,
    }).select('*').single()
    if (error) throw new AppError(error.message, 500)
    res.status(201).json({ data })
  } catch (e) { next(e) }
})

// ── DJ: list all future messages ───────────────────────────────
weddingGamesRouter.get('/sessions/:id/future-messages', requireAuth, async (req, res, next) => {
  try {
    await ownedWeddingSession(req.params.id, userId(req))
    const { data, error } = await supabaseAdmin
      .from('live_future_messages').select('*')
      .eq('session_id', req.params.id)
      .order('created_at', { ascending: false })
    if (error) throw new AppError(error.message, 500)
    res.json({ data: data ?? [] })
  } catch (e) { next(e) }
})

// ── DJ: toggle selected ─────────────────────────────────────────
weddingGamesRouter.patch('/future-messages/:id', requireAuth, async (req, res, next) => {
  try {
    const { is_selected } = req.body ?? {}
    const { data: existing } = await supabaseAdmin
      .from('live_future_messages').select('id, live_sessions!inner(dj_id)')
      .eq('id', req.params.id).maybeSingle()
    if (!existing || (existing as any).live_sessions?.dj_id !== userId(req)) {
      throw new AppError('Messaggio non trovato', 404)
    }
    const { data, error } = await supabaseAdmin.from('live_future_messages')
      .update({ is_selected: !!is_selected })
      .eq('id', req.params.id).select('*').single()
    if (error) throw new AppError(error.message, 500)
    res.json({ data })
  } catch (e) { next(e) }
})

// ── DJ: delete message ──────────────────────────────────────────
weddingGamesRouter.delete('/future-messages/:id', requireAuth, async (req, res, next) => {
  try {
    const { data: existing } = await supabaseAdmin
      .from('live_future_messages').select('id, live_sessions!inner(dj_id)')
      .eq('id', req.params.id).maybeSingle()
    if (!existing || (existing as any).live_sessions?.dj_id !== userId(req)) {
      throw new AppError('Messaggio non trovato', 404)
    }
    const { error } = await supabaseAdmin.from('live_future_messages')
      .delete().eq('id', req.params.id)
    if (error) throw new AppError(error.message, 500)
    res.status(204).end()
  } catch (e) { next(e) }
})

// ── PUBLIC: get selected messages ───────────────────────────────
weddingGamesRouter.get('/public/:slug/future-messages/selected', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id, session_type')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)
    if (session.session_type !== 'wedding') return res.json({ data: [] })

    const { data, error } = await supabaseAdmin
      .from('live_future_messages').select('id, guest_name, message, delivery_year, created_at')
      .eq('session_id', session.id).eq('is_selected', true)
      .order('created_at', { ascending: false }).limit(10)
    if (error) throw new AppError(error.message, 500)
    res.json({ data: data ?? [] })
  } catch (e) { next(e) }
})

// ════════════════════════════════════════════════════════════════
// BEST PHOTO CONTEST
// ════════════════════════════════════════════════════════════════

// ── PUBLIC: vote for a photo ────────────────────────────────────
weddingGamesRouter.post('/public/:slug/photos/:photoId/vote', async (req, res, next) => {
  try {
    const { data: photo } = await supabaseAdmin
      .from('live_photos').select('id, session_id, status, live_sessions!inner(public_slug, is_active, session_type)')
      .eq('id', req.params.photoId).maybeSingle()
    if (!photo || (photo as any).live_sessions?.public_slug !== req.params.slug) {
      throw new AppError('Foto non trovata', 404)
    }
    if ((photo as any).live_sessions?.session_type !== 'wedding') {
      throw new AppError('Funzione disponibile solo per Wedding Edition.', 400)
    }
    if (photo.status !== 'approved') throw new AppError('Foto non approvata.', 400)

    const ipHash = hashClient(req)
    if (!rateLimitOk(`photo-vote:${photo.id}`, ipHash, 5_000)) {
      throw new AppError('Riprova tra qualche secondo.', 429)
    }

    const { error } = await supabaseAdmin.from('live_photo_votes').insert({
      photo_id: photo.id, ip_hash: ipHash,
    })
    if (error && !/duplicate|unique/i.test(error.message)) {
      throw new AppError(error.message, 500)
    }
    res.status(201).json({ ok: true })
  } catch (e) { next(e) }
})

// ── DJ: get photo votes count ───────────────────────────────────
weddingGamesRouter.get('/sessions/:id/photos/votes', requireAuth, async (req, res, next) => {
  try {
    await ownedWeddingSession(req.params.id, userId(req))

    // Get all approved photos for this session
    const { data: photos } = await supabaseAdmin
      .from('live_photos').select('id, url, guest_name, caption')
      .eq('session_id', req.params.id).eq('status', 'approved')
      .order('created_at', { ascending: false })

    const photoIds = (photos ?? []).map((p) => p.id)
    let voteCounts: Record<string, number> = {}

    if (photoIds.length > 0) {
      const { data: votes } = await supabaseAdmin
        .from('live_photo_votes').select('photo_id').in('photo_id', photoIds)
      for (const p of photos ?? []) {
        const count = (votes ?? []).filter((v) => v.photo_id === p.id).length
        voteCounts[p.id] = count
      }
    }

    res.json({
      data: (photos ?? []).map((p) => ({ ...p, votes: voteCounts[p.id] ?? 0 }))
    })
  } catch (e) { next(e) }
})

// ── PUBLIC: get photos with vote counts ────────────────────────
weddingGamesRouter.get('/public/:slug/photos/votes', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id, session_type')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)
    if (session.session_type !== 'wedding') return res.json({ data: [] })

    const { data: photos } = await supabaseAdmin
      .from('live_photos').select('id, url, guest_name, caption, created_at')
      .eq('session_id', session.id).eq('status', 'approved')
      .order('created_at', { ascending: false })

    const photoIds = (photos ?? []).map((p) => p.id)
    let voteCounts: Record<string, number> = {}

    if (photoIds.length > 0) {
      const { data: votes } = await supabaseAdmin
        .from('live_photo_votes').select('photo_id').in('photo_id', photoIds)
      for (const p of photos ?? []) {
        const count = (votes ?? []).filter((v) => v.photo_id === p.id).length
        voteCounts[p.id] = count
      }
    }

    res.json({
      data: (photos ?? []).map((p) => ({ ...p, votes: voteCounts[p.id] ?? 0 }))
    })
  } catch (e) { next(e) }
})
