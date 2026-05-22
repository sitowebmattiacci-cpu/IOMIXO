import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { AppError } from '../middleware/errorHandler'
import { supabaseAdmin } from '../config/supabase'
import { createSoundbankUploadUrl } from '../services/storage'
import { SOUNDBANK_CATEGORIES } from './soundbank'

// ─────────────────────────────────────────────────────────────
//  Admin ingestion (Phase 7)
//
//  Internal-only endpoints for IOMIXO operators to register the
//  proprietary soundbank library. Auth is a static admin API key
//  carried in the `x-admin-api-key` header — separate from the
//  AI engine's internal key so we can revoke each independently.
//  No public marketplace, no premium tier yet.
// ─────────────────────────────────────────────────────────────

export const adminRouter = Router()

function requireAdminKey(req: Request, _res: Response, next: NextFunction) {
  const expected = process.env.ADMIN_API_KEY
  if (!expected) return next(new AppError('Admin API not configured', 503))
  const provided = req.headers['x-admin-api-key']
  if (provided !== expected) return next(new AppError('Unauthorized', 401))
  next()
}

adminRouter.use(requireAdminKey)

// ── POST /admin/soundbank/upload-url ──────────────────────────
// Step 1: presigned PUT URL into the private soundbank bucket.
const uploadUrlSchema = z.object({
  category:     z.enum(SOUNDBANK_CATEGORIES),
  filename:     z.string().min(1).max(200),
  content_type: z.string().min(1).max(100),
})

const ALLOWED_MIME = new Set([
  'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/mpeg', 'audio/mp3', 'audio/mpeg3',
])

adminRouter.post('/soundbank/upload-url', async (req, res, next) => {
  try {
    const parsed = uploadUrlSchema.safeParse(req.body)
    if (!parsed.success) throw new AppError('Invalid request', 400)
    if (!ALLOWED_MIME.has(parsed.data.content_type.toLowerCase())) {
      throw new AppError('Only WAV or MP3 files are supported', 400)
    }
    const slug = parsed.data.filename.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)
    const { path, url } = await createSoundbankUploadUrl(parsed.data.category, slug)
    res.json({ data: { upload_url: url, s3_key: path }, error: null })
  } catch (err) { next(err) }
})

// ── POST /admin/soundbank ─────────────────────────────────────
// Step 2: register a soundbank row after the PUT completes.
const registerSchema = z.object({
  category:     z.enum(SOUNDBANK_CATEGORIES),
  name:         z.string().min(1).max(200),
  s3_key:       z.string().min(1),
  style:        z.string().min(1).max(80).nullable().optional(),
  bpm:          z.number().positive().max(400).nullable().optional(),
  musical_key:  z.string().min(1).max(8).nullable().optional(),
  energy:       z.string().min(1).max(40).nullable().optional(),
  duration_sec: z.number().positive().nullable().optional(),
  tags:         z.array(z.string().min(1).max(40)).max(20).optional(),
})

adminRouter.post('/soundbank', async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) throw new AppError('Invalid request', 400)

    const { data, error } = await supabaseAdmin
      .from('soundbank_samples')
      .insert({
        category:     parsed.data.category,
        name:         parsed.data.name,
        s3_key:       parsed.data.s3_key,
        style:        parsed.data.style ?? null,
        bpm:          parsed.data.bpm ?? null,
        musical_key:  parsed.data.musical_key ?? null,
        energy:       parsed.data.energy ?? null,
        duration_sec: parsed.data.duration_sec ?? null,
        tags:         parsed.data.tags ?? [],
      })
      .select('id, category, name, s3_key, style, bpm, musical_key, energy, duration_sec, tags, created_at')
      .single()
    if (error || !data) throw new AppError(`Failed to register soundbank sample: ${error?.message ?? 'unknown'}`, 500)

    res.status(201).json({ data, error: null })
  } catch (err) { next(err) }
})

// ── DELETE /admin/soundbank/:id ───────────────────────────────
// Removes the catalog row. Storage bucket cleanup is left manual
// for the MVP — operators can rely on the audit trail in `created_at`.
adminRouter.delete('/soundbank/:id', async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('soundbank_samples')
      .delete()
      .eq('id', req.params.id)
    if (error) throw new AppError('Database error', 500)
    res.json({ data: { ok: true }, error: null })
  } catch (err) { next(err) }
})
