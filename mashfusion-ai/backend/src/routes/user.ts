import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { supabaseAdmin } from '../config/supabase'
import { uploadAvatar, deleteAvatar } from '../services/storage'

export const userRouter = Router()
userRouter.use(requireAuth)

// ── Multer: memoria, max 5 MB, solo immagini ───────────────────
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    ALLOWED_MIME.has(file.mimetype) ? cb(null, true) : cb(new Error('Only JPEG, PNG and WEBP images are allowed'))
  },
})

// ── GET /user/me ───────────────────────────────────────────────
userRouter.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authUser = (req as any).user as { sub: string; email: string; full_name?: string }
    const userId = authUser.sub

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, avatar_url, plan, credits_remaining, credits_reset_at, created_at')
      .eq('id', userId)
      .maybeSingle()

    if (error) throw new AppError('Database error', 500)

    if (!user) {
      // Auto-provision: first login via Supabase Auth (no backend register called)
      const { data: created, error: createErr } = await supabaseAdmin
        .from('users')
        .insert({
          id:                userId,
          email:             authUser.email,
          full_name:         authUser.full_name ?? '',
          plan:              'free',
          credits_remaining: 1,
          email_verified:    true,
          credits_reset_at:  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select('id, email, full_name, avatar_url, plan, credits_remaining, credits_reset_at, created_at')
        .single()
      if (createErr) throw new AppError('Failed to create user profile', 500)
      return res.json({ data: created, error: null })
    }

    res.json({ data: user, error: null })
  } catch (err) { next(err) }
})

// ── GET /user/credits ──────────────────────────────────────────
userRouter.get('/credits', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { data: u, error } = await supabaseAdmin
      .from('users')
      .select('credits_remaining, plan, credits_reset_at')
      .eq('id', userId)
      .maybeSingle()
    if (error) throw new AppError('Database error', 500)
    if (!u) throw new AppError('User not found', 404)
    res.json({ remaining: u.credits_remaining, plan: u.plan, resets_at: u.credits_reset_at })
  } catch (err) { next(err) }
})

// ── PATCH /user/profile ────────────────────────────────────────
userRouter.patch('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { full_name, avatar_url } = req.body

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (full_name  !== undefined) updates.full_name  = full_name
    if (avatar_url !== undefined) updates.avatar_url = avatar_url

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select('id, email, full_name, avatar_url, plan, credits_remaining, created_at')
      .maybeSingle()

    if (error) throw new AppError('Database error', 500)
    if (!data) throw new AppError('User not found', 404)
    res.json({ data, error: null })
  } catch (err) { next(err) }
})

// ── PUT /user/avatar ───────────────────────────────────────────
userRouter.put(
  '/avatar',
  upload.single('avatar'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw new AppError('No file uploaded', 400)

      const userId = (req as any).user.sub
      const ext    = req.file.mimetype === 'image/png' ? 'png' : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg'

      // 1. Fetch old avatar URL for cleanup
      const { data: prev } = await supabaseAdmin
        .from('users')
        .select('avatar_url')
        .eq('id', userId)
        .maybeSingle()
      const oldUrl: string | null = prev?.avatar_url ?? null

      // 2. Upload new avatar to Supabase Storage
      const newUrl = await uploadAvatar(userId, req.file.buffer, req.file.mimetype, ext)

      // 3. Update DB
      const { data, error } = await supabaseAdmin
        .from('users')
        .update({ avatar_url: newUrl, updated_at: new Date().toISOString() })
        .eq('id', userId)
        .select('id, email, full_name, avatar_url, plan, credits_remaining, created_at')
        .single()

      // 4. Delete old file (fire-and-forget)
      if (oldUrl) deleteAvatar(oldUrl).catch(() => {})

      if (error) throw new AppError('Update failed', 500)
      res.json({ data, error: null })
    } catch (err) { next(err) }
  }
)
