import { Router, Request } from 'express'
import { supabaseAdmin } from '../config/supabase'
import { requireAuth } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { hashClient, rateLimitOk } from '../utils/ipHash'
import { hasEventAccess } from '../services/plan'
import { isEventSession } from '../utils/sessionType'
import {
  createWeddingPhotoUploadUrl,
  createWeddingPhotoSignedUrl,
  deleteWeddingPhoto,
} from '../services/storage'

export const livePhotosRouter = Router()

const userId = (req: Request) => (req as any).user.sub as string
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp'])
const MAX_BYTES = 8 * 1024 * 1024

async function ownedWeddingSession(sessionId: string, djId: string) {
  const { data } = await supabaseAdmin
    .from('live_sessions')
    .select('id, dj_id, session_type')
    .eq('id', sessionId).eq('dj_id', djId).maybeSingle()
  if (!data) throw new AppError('Sessione non trovata', 404)
  if (!isEventSession(data.session_type)) {
    throw new AppError('Album foto disponibile solo per sessioni Party Mode o Wedding Edition.', 400)
  }
  return data
}

async function requireEventAccess(djId: string, sessionId?: string) {
  const hasAccess = await hasEventAccess(djId, sessionId)
  if (!hasAccess) {
    throw new AppError('Funzione disponibile con il piano Advance o un Event Pass 24H.', 402)
  }
}

// ── PUBLIC: Live Booth photo (direct upload + confirm in one step) ────────
livePhotosRouter.post('/public/:slug/booth-photo', async (req, res, next) => {
  try {
    const { storage_path, guest_name, caption } = req.body ?? {}
    if (!storage_path || typeof storage_path !== 'string') throw new AppError('storage_path obbligatorio', 400)

    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id, dj_id, is_active, session_type')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)
    if (!session.is_active) throw new AppError('Questa sessione live è terminata.', 410)
    if (!isEventSession(session.session_type)) {
      throw new AppError('Live Booth disponibile solo per sessioni Party Mode o Wedding Edition.', 400)
    }
    if (!(await hasEventAccess(session.dj_id, session.id))) {
      throw new AppError('Funzione disponibile con il piano Advance o un Event Pass 24H.', 402)
    }
    if (!storage_path.startsWith(`${session.id}/`)) throw new AppError('storage_path non valido', 400)

    const ipHash = hashClient(req)
    if (!rateLimitOk(`booth:${session.id}`, ipHash, 15_000)) {
      throw new AppError('Riprova tra qualche secondo.', 429)
    }

    const { data, error } = await supabaseAdmin.from('live_photos').insert({
      session_id:   session.id,
      guest_name:   guest_name ? String(guest_name).slice(0, 80) : null,
      storage_path,
      caption:      caption ? String(caption).slice(0, 200) : null,
      source:       'live_booth',
      ip_hash:      ipHash,
    }).select('id, status, created_at').single()
    if (error) throw new AppError(error.message, 500)
    res.status(201).json({ data })
  } catch (e) { next(e) }
})

// ── PUBLIC: request a signed upload URL ────────────────────────
// Two-step upload: client requests URL, then PUTs the file directly to Supabase,
// then calls confirm to persist the row.
livePhotosRouter.post('/public/:slug/photos/init', async (req, res, next) => {
  try {
    const ext = String(req.body?.ext ?? 'jpg').toLowerCase().replace(/^\./, '')
    if (!ALLOWED_EXT.has(ext)) throw new AppError('Formato non supportato (jpg/png/webp).', 400)
    const size = Number(req.body?.size ?? 0)
    if (size && size > MAX_BYTES) throw new AppError('File troppo grande (max 8 MB).', 413)

    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id, dj_id, is_active, session_type')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)
    if (!session.is_active) throw new AppError('Questa sessione live è terminata.', 410)
    if (!isEventSession(session.session_type)) {
      throw new AppError('Album foto disponibile solo per sessioni Party Mode o Wedding Edition.', 400)
    }
    if (!(await hasEventAccess(session.dj_id, session.id))) {
      throw new AppError('Funzione disponibile con il piano Advance o un Event Pass 24H.', 402)
    }

    const ipHash = hashClient(req)
    if (!rateLimitOk(`photo:${session.id}`, ipHash, 30_000)) {
      throw new AppError('Riprova tra qualche secondo.', 429)
    }

    const { path, url } = await createWeddingPhotoUploadUrl(session.id, ext)
    res.status(201).json({ data: { upload_url: url, storage_path: path } })
  } catch (e) { next(e) }
})

// ── PUBLIC: confirm an uploaded photo ──────────────────────────
livePhotosRouter.post('/public/:slug/photos', async (req, res, next) => {
  try {
    const { storage_path, guest_name, caption } = req.body ?? {}
    if (!storage_path || typeof storage_path !== 'string') throw new AppError('storage_path obbligatorio', 400)

    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id, dj_id, is_active, session_type')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)
    if (!session.is_active) throw new AppError('Questa sessione live è terminata.', 410)
    if (!isEventSession(session.session_type)) {
      throw new AppError('Album foto disponibile solo per sessioni Party Mode o Wedding Edition.', 400)
    }
    if (!storage_path.startsWith(`${session.id}/`)) throw new AppError('storage_path non valido', 400)

    const { data, error } = await supabaseAdmin.from('live_photos').insert({
      session_id:   session.id,
      guest_name:   guest_name ? String(guest_name).slice(0, 80) : null,
      storage_path,
      caption:      caption ? String(caption).slice(0, 200) : null,
      ip_hash:      hashClient(req),
    }).select('id, status, created_at').single()
    if (error) throw new AppError(error.message, 500)
    res.status(201).json({ data })
  } catch (e) { next(e) }
})

// ── PUBLIC: approved photos (for live page + screen) ───────────
livePhotosRouter.get('/public/:slug/photos', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id, session_type')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)
    if (!isEventSession(session.session_type)) return res.json({ data: [] })

    const { data: rows } = await supabaseAdmin
      .from('live_photos')
      .select('id, guest_name, caption, storage_path, created_at')
      .eq('session_id', session.id).eq('status', 'approved')
      .order('created_at', { ascending: false }).limit(50)

    const data = await Promise.all((rows ?? []).map(async (r) => ({
      id: r.id,
      guest_name: r.guest_name,
      caption: r.caption,
      created_at: r.created_at,
      url: await createWeddingPhotoSignedUrl(r.storage_path, 3600).catch(() => null),
    })))
    res.json({ data })
  } catch (e) { next(e) }
})

// ── DJ: list all photos (pending + approved) ───────────────────
livePhotosRouter.get('/sessions/:id/photos', requireAuth, async (req, res, next) => {
  try {
    await ownedWeddingSession(req.params.id, userId(req))
    const { data: rows, error } = await supabaseAdmin
      .from('live_photos').select('*').eq('session_id', req.params.id)
      .order('created_at', { ascending: false })
    if (error) throw new AppError(error.message, 500)

    const data = await Promise.all((rows ?? []).map(async (r) => ({
      ...r,
      url: await createWeddingPhotoSignedUrl(r.storage_path, 3600).catch(() => null),
    })))
    res.json({ data })
  } catch (e) { next(e) }
})

// ── DJ: PATCH status ───────────────────────────────────────────
livePhotosRouter.patch('/photos/:id', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body ?? {}
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      throw new AppError('status non valido', 400)
    }
    const { data: existing } = await supabaseAdmin
      .from('live_photos').select('id, live_sessions!inner(dj_id)')
      .eq('id', req.params.id).maybeSingle()
    if (!existing || (existing as any).live_sessions?.dj_id !== userId(req)) {
      throw new AppError('Foto non trovata', 404)
    }
    await requireEventAccess(userId(req))
    const { data, error } = await supabaseAdmin
      .from('live_photos').update({ status }).eq('id', req.params.id)
      .select('*').single()
    if (error) throw new AppError(error.message, 500)
    res.json({ data })
  } catch (e) { next(e) }
})

// ── DJ: PATCH feature (evidenzia foto) ────────────────────────
livePhotosRouter.patch('/photos/:id/feature', requireAuth, async (req, res, next) => {
  try {
    const { is_featured } = req.body ?? {}
    if (typeof is_featured !== 'boolean') throw new AppError('is_featured richiesto', 400)

    const { data: existing } = await supabaseAdmin
      .from('live_photos').select('id, live_sessions!inner(dj_id)')
      .eq('id', req.params.id).maybeSingle()
    if (!existing || (existing as any).live_sessions?.dj_id !== userId(req)) {
      throw new AppError('Foto non trovata', 404)
    }
    await requireEventAccess(userId(req))
    const { data, error } = await supabaseAdmin
      .from('live_photos').update({ is_featured }).eq('id', req.params.id)
      .select('*').single()
    if (error) throw new AppError(error.message, 500)
    res.json({ data })
  } catch (e) { next(e) }
})

// ── DJ: approve photo (shortcut) ───────────────────────────────
livePhotosRouter.patch('/photos/:id/approve', requireAuth, async (req, res, next) => {
  try {
    const { data: existing } = await supabaseAdmin
      .from('live_photos').select('id, live_sessions!inner(dj_id)')
      .eq('id', req.params.id).maybeSingle()
    if (!existing || (existing as any).live_sessions?.dj_id !== userId(req)) {
      throw new AppError('Foto non trovata', 404)
    }
    await requireEventAccess(userId(req))
    const { data, error } = await supabaseAdmin
      .from('live_photos').update({ status: 'approved' }).eq('id', req.params.id)
      .select('*').single()
    if (error) throw new AppError(error.message, 500)
    res.json({ data })
  } catch (e) { next(e) }
})

// ── DJ: list booth photos only ─────────────────────────────────
livePhotosRouter.get('/sessions/:id/booth/photos', requireAuth, async (req, res, next) => {
  try {
    await ownedWeddingSession(req.params.id, userId(req))
    const { data: rows, error } = await supabaseAdmin
      .from('live_photos').select('*')
      .eq('session_id', req.params.id).eq('source', 'live_booth')
      .order('created_at', { ascending: false })
    if (error) throw new AppError(error.message, 500)

    const data = await Promise.all((rows ?? []).map(async (r) => ({
      ...r,
      url: await createWeddingPhotoSignedUrl(r.storage_path, 3600).catch(() => null),
    })))
    res.json({ data })
  } catch (e) { next(e) }
})

// ── DJ: DELETE photo ───────────────────────────────────────────
livePhotosRouter.delete('/photos/:id', requireAuth, async (req, res, next) => {
  try {
    const { data: existing } = await supabaseAdmin
      .from('live_photos').select('id, storage_path, live_sessions!inner(dj_id)')
      .eq('id', req.params.id).maybeSingle()
    if (!existing || (existing as any).live_sessions?.dj_id !== userId(req)) {
      throw new AppError('Foto non trovata', 404)
    }
    await deleteWeddingPhoto(existing.storage_path).catch(() => {})
    const { error } = await supabaseAdmin
      .from('live_photos').delete().eq('id', req.params.id)
    if (error) throw new AppError(error.message, 500)
    res.status(204).end()
  } catch (e) { next(e) }
})
