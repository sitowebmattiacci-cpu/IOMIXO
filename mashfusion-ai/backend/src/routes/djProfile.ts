import { Router } from 'express'
import multer from 'multer'
import { supabaseAdmin } from '../config/supabase'
import { requireAuth } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { slugify, uniqueSlug } from '../utils/slug'
import { uploadAvatar, deleteAvatar } from '../services/storage'

export const djProfileRouter = Router()

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    ALLOWED_MIME.has(file.mimetype) ? cb(null, true) : cb(new Error('Solo JPEG, PNG o WEBP'))
  },
})

const PROFILE_FIELDS = [
  'display_name', 'bio',
  'instagram_url', 'tiktok_url', 'spotify_url', 'soundcloud_url', 'website_url',
  'avatar_url',
  'public_slug',
] as const

// ── GET /api/dj/profile ────────────────────────────────────────
djProfileRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const uid = (req as any).user.sub
    const { data, error } = await supabaseAdmin
      .from('dj_profiles').select('*').eq('user_id', uid).maybeSingle()
    if (error) throw new AppError(error.message, 500)
    res.json({ data: data ?? null })
  } catch (e) { next(e) }
})

// ── PATCH /api/dj/profile ──────────────────────────────────────
djProfileRouter.patch('/', requireAuth, async (req, res, next) => {
  try {
    const uid = (req as any).user.sub
    const patch: Record<string, unknown> = {}
    for (const k of PROFILE_FIELDS) {
      if (k in (req.body ?? {})) patch[k] = req.body[k]
    }

    // Normalise slug if provided
    if (typeof patch.public_slug === 'string' && patch.public_slug.length > 0) {
      const normalised = slugify(patch.public_slug as string)
      if (!normalised) throw new AppError('Slug non valido', 400)
      patch.public_slug = normalised

      // Conflict check (allow same user's existing slug)
      const { data: clash } = await supabaseAdmin
        .from('dj_profiles').select('user_id').eq('public_slug', normalised).maybeSingle()
      if (clash && clash.user_id !== uid) throw new AppError('Slug già in uso', 409)
    } else if (patch.public_slug === '') {
      patch.public_slug = null
    }

    // Upsert (one row per user)
    const { data: existing } = await supabaseAdmin
      .from('dj_profiles').select('id').eq('user_id', uid).maybeSingle()

    let result
    if (existing) {
      result = await supabaseAdmin
        .from('dj_profiles').update(patch).eq('user_id', uid).select('*').single()
    } else {
      // Auto-generate a slug if not provided on first save
      if (!patch.public_slug) {
        patch.public_slug = await uniqueSlug(async (s) => {
          const { data } = await supabaseAdmin.from('dj_profiles').select('user_id').eq('public_slug', s).maybeSingle()
          return !!data
        })
      }
      result = await supabaseAdmin
        .from('dj_profiles').insert({ user_id: uid, ...patch }).select('*').single()
    }
    if (result.error) throw new AppError(result.error.message, 500)
    res.json({ data: result.data })
  } catch (e) { next(e) }
})

// ── PUT /api/dj/profile/avatar ─────────────────────────────────
djProfileRouter.put('/avatar', requireAuth, upload.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('Nessun file caricato', 400)
    const uid = (req as any).user.sub
    const ext = req.file.mimetype === 'image/png' ? 'png'
              : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg'

    const { data: prev } = await supabaseAdmin
      .from('dj_profiles').select('id, avatar_url').eq('user_id', uid).maybeSingle()
    const oldUrl: string | null = prev?.avatar_url ?? null

    const newUrl = await uploadAvatar(uid, req.file.buffer, req.file.mimetype, ext)

    let result
    if (prev) {
      result = await supabaseAdmin
        .from('dj_profiles').update({ avatar_url: newUrl }).eq('user_id', uid).select('*').single()
    } else {
      const slug = await uniqueSlug(async (s) => {
        const { data } = await supabaseAdmin.from('dj_profiles').select('user_id').eq('public_slug', s).maybeSingle()
        return !!data
      })
      result = await supabaseAdmin
        .from('dj_profiles').insert({ user_id: uid, avatar_url: newUrl, public_slug: slug }).select('*').single()
    }

    if (oldUrl) deleteAvatar(oldUrl).catch(() => {})
    if (result.error) throw new AppError(result.error.message, 500)
    res.json({ data: result.data })
  } catch (e) { next(e) }
})
