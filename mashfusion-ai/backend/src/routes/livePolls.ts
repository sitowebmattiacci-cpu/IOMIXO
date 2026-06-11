import { Router, Request } from 'express'
import { supabaseAdmin } from '../config/supabase'
import { requireAuth } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { hashClient, rateLimitOk } from '../utils/ipHash'
import { hasEventAccess } from '../services/plan'
import { isEventSession } from '../utils/sessionType'

export const livePollsRouter = Router()

const userId = (req: Request) => (req as any).user.sub as string

async function ownedSession(sessionId: string, djId: string) {
  const { data } = await supabaseAdmin
    .from('live_sessions')
    .select('id, dj_id, session_type, is_active')
    .eq('id', sessionId).eq('dj_id', djId).maybeSingle()
  if (!data) throw new AppError('Sessione non trovata', 404)
  return data
}

async function requireLivePolls(djId: string, sessionId?: string) {
  const hasAccess = await hasEventAccess(djId, sessionId)
  if (!hasAccess) {
    throw new AppError('Sondaggi disponibili con il piano Advance o un Event Pass 24H.', 402)
  }
}

// ── DJ: create a poll ──────────────────────────────────────────
livePollsRouter.post('/sessions/:id/polls', requireAuth, async (req, res, next) => {
  try {
    const { question, options } = req.body ?? {}
    if (!question || typeof question !== 'string') throw new AppError('Domanda obbligatoria', 400)
    if (!Array.isArray(options) || options.length < 2 || options.length > 4) {
      throw new AppError('Servono 2-4 opzioni', 400)
    }

    const session = await ownedSession(req.params.id, userId(req))
    if (!isEventSession(session.session_type)) {
      throw new AppError('Sondaggi disponibili solo per sessioni Party Mode o Wedding Edition.', 400)
    }
    await requireLivePolls(userId(req), session.id)

    const normalised = options.map((o: unknown) => String(o).slice(0, 80))

    // Deactivate previous polls for this session
    await supabaseAdmin.from('live_polls')
      .update({ is_active: false }).eq('session_id', session.id).eq('is_active', true)

    const { data, error } = await supabaseAdmin.from('live_polls').insert({
      session_id: session.id,
      question:   question.slice(0, 200),
      options:    normalised,
      is_active:  true,
    }).select('*').single()
    if (error) throw new AppError(error.message, 500)
    res.status(201).json({ data })
  } catch (e) { next(e) }
})

// ── DJ: list polls ─────────────────────────────────────────────
livePollsRouter.get('/sessions/:id/polls', requireAuth, async (req, res, next) => {
  try {
    await ownedSession(req.params.id, userId(req))
    const { data: polls, error } = await supabaseAdmin
      .from('live_polls').select('*').eq('session_id', req.params.id)
      .order('created_at', { ascending: false })
    if (error) throw new AppError(error.message, 500)

    // Attach vote tallies per option
    const ids = (polls ?? []).map((p) => p.id)
    let tallies: Record<string, number[]> = {}
    if (ids.length) {
      const { data: votes } = await supabaseAdmin
        .from('live_poll_votes').select('poll_id, option_index').in('poll_id', ids)
      for (const p of polls ?? []) {
        const buckets = new Array((p.options as unknown[]).length).fill(0)
        for (const v of votes ?? []) if (v.poll_id === p.id) buckets[v.option_index] = (buckets[v.option_index] ?? 0) + 1
        tallies[p.id] = buckets
      }
    }
    res.json({ data: (polls ?? []).map((p) => ({ ...p, tally: tallies[p.id] ?? [] })) })
  } catch (e) { next(e) }
})

// ── DJ: update poll (close it, etc.) ───────────────────────────
livePollsRouter.patch('/polls/:id', requireAuth, async (req, res, next) => {
  try {
    const { is_active } = req.body ?? {}
    const { data: existing } = await supabaseAdmin
      .from('live_polls').select('id, session_id, live_sessions!inner(dj_id)')
      .eq('id', req.params.id).maybeSingle()
    if (!existing || (existing as any).live_sessions?.dj_id !== userId(req)) {
      throw new AppError('Sondaggio non trovato', 404)
    }
    await requireLivePolls(userId(req), (existing as any).session_id)
    const patch: Record<string, unknown> = {}
    if (typeof is_active === 'boolean') patch.is_active = is_active
    const { data, error } = await supabaseAdmin.from('live_polls')
      .update(patch).eq('id', req.params.id).select('*').single()
    if (error) throw new AppError(error.message, 500)
    res.json({ data })
  } catch (e) { next(e) }
})

// ── PUBLIC: get the currently-active poll ──────────────────────
livePollsRouter.get('/public/:slug/polls/active', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id, session_type')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)
    if (!isEventSession(session.session_type)) return res.json({ data: null })

    const { data: poll } = await supabaseAdmin
      .from('live_polls').select('id, question, options, created_at')
      .eq('session_id', session.id).eq('is_active', true)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!poll) return res.json({ data: null })

    const { data: votes } = await supabaseAdmin
      .from('live_poll_votes').select('option_index').eq('poll_id', poll.id)
    const tally = new Array((poll.options as unknown[]).length).fill(0)
    for (const v of votes ?? []) tally[v.option_index] = (tally[v.option_index] ?? 0) + 1

    res.json({ data: { ...poll, tally } })
  } catch (e) { next(e) }
})

// ── PUBLIC: vote ───────────────────────────────────────────────
livePollsRouter.post('/public/:slug/polls/:pollId/vote', async (req, res, next) => {
  try {
    const { option_index } = req.body ?? {}
    const idx = Number(option_index)
    if (!Number.isInteger(idx) || idx < 0 || idx > 10) throw new AppError('Opzione non valida', 400)

    const { data: poll } = await supabaseAdmin
      .from('live_polls').select('id, options, is_active, session_id, live_sessions!inner(public_slug, is_active)')
      .eq('id', req.params.pollId).maybeSingle()
    if (!poll || (poll as any).live_sessions?.public_slug !== req.params.slug) {
      throw new AppError('Sondaggio non trovato', 404)
    }
    if (!poll.is_active) throw new AppError('Sondaggio chiuso.', 410)
    if (idx >= (poll.options as unknown[]).length) throw new AppError('Opzione non valida', 400)

    const ipHash = hashClient(req)
    if (!rateLimitOk(`poll:${poll.id}`, ipHash, 5_000)) {
      throw new AppError('Riprova tra qualche secondo.', 429)
    }

    const { error } = await supabaseAdmin.from('live_poll_votes').insert({
      poll_id: poll.id, option_index: idx, ip_hash: ipHash,
    })
    if (error && !/duplicate|unique/i.test(error.message)) throw new AppError(error.message, 500)
    res.status(201).json({ ok: true })
  } catch (e) { next(e) }
})
