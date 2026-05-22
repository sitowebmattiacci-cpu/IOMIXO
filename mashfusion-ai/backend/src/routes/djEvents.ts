import { Router } from 'express'
import { supabaseAdmin } from '../config/supabase'
import { requireAuth } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'

export const djEventsRouter = Router()

const FIELDS = ['title', 'event_date', 'venue_name', 'city', 'ticket_url', 'is_public'] as const

djEventsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const uid = (req as any).user.sub
    const { data, error } = await supabaseAdmin
      .from('dj_events').select('*').eq('user_id', uid)
      .order('event_date', { ascending: true, nullsFirst: false })
    if (error) throw new AppError(error.message, 500)
    res.json({ data: data ?? [] })
  } catch (e) { next(e) }
})

djEventsRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const uid = (req as any).user.sub
    const { title } = req.body ?? {}
    if (!title || typeof title !== 'string') throw new AppError('Titolo evento obbligatorio', 400)

    const payload: Record<string, unknown> = { user_id: uid }
    for (const k of FIELDS) if (k in (req.body ?? {})) payload[k] = req.body[k]

    const { data, error } = await supabaseAdmin
      .from('dj_events').insert(payload).select('*').single()
    if (error) throw new AppError(error.message, 500)
    res.status(201).json({ data })
  } catch (e) { next(e) }
})

djEventsRouter.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const uid = (req as any).user.sub
    const patch: Record<string, unknown> = {}
    for (const k of FIELDS) if (k in (req.body ?? {})) patch[k] = req.body[k]

    const { data, error } = await supabaseAdmin
      .from('dj_events').update(patch).eq('id', req.params.id).eq('user_id', uid)
      .select('*').maybeSingle()
    if (error) throw new AppError(error.message, 500)
    if (!data) throw new AppError('Evento non trovato', 404)
    res.json({ data })
  } catch (e) { next(e) }
})

djEventsRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const uid = (req as any).user.sub
    const { error } = await supabaseAdmin
      .from('dj_events').delete().eq('id', req.params.id).eq('user_id', uid)
    if (error) throw new AppError(error.message, 500)
    res.status(204).end()
  } catch (e) { next(e) }
})
