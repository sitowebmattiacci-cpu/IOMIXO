import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { supabaseAdmin } from '../config/supabase'
import {
  createSignedUrlForBucket,
  createUserSampleUploadUrl,
  SOUNDBANK_BUCKET,
  USER_SAMPLES_BUCKET,
} from '../services/storage'

// ─────────────────────────────────────────────────────────────
//  Soundbank + user samples
//
//  Phase 5 stub: catalog rows are likely empty in production until
//  IOMIXO ingests real content. The shape is final — when samples
//  land, the listing endpoint already speaks the right contract.
// ─────────────────────────────────────────────────────────────

export const SOUNDBANK_CATEGORIES = [
  'afro_house',
  'deep_house',
  'edm',
  'chill',
  'fx',
] as const

type SoundbankCategory = typeof SOUNDBANK_CATEGORIES[number]

export const soundbankRouter = Router()
soundbankRouter.use(requireAuth)

// ── GET /soundbank ─────────────────────────────────────────────
// Returns the catalog grouped by category. Empty categories are
// included so the frontend can render placeholders.
const listQuerySchema = z.object({
  category: z.enum(SOUNDBANK_CATEGORIES).optional(),
  bpm:      z.coerce.number().positive().optional(),
  key:      z.string().min(1).max(8).optional(),
  limit:    z.coerce.number().int().min(1).max(200).default(100),
})

soundbankRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) throw new AppError('Invalid query', 400)
    const { category, bpm, key, limit } = parsed.data

    let query = supabaseAdmin
      .from('soundbank_samples')
      .select('id, category, name, s3_key, duration_sec, bpm, musical_key, style, energy, tags')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (category) query = query.eq('category', category)
    if (key)      query = query.eq('musical_key', key)
    if (bpm)      query = query.gte('bpm', bpm - 4).lte('bpm', bpm + 4)

    const { data: rows, error } = await query
    if (error) throw new AppError('Database error', 500)

    const samples = await Promise.all(
      (rows ?? []).map(async (r) => ({
        ...r,
        signed_url: await createSignedUrlForBucket(SOUNDBANK_BUCKET, r.s3_key, 3600),
      })),
    )

    // Always return the full category set so the UI can show empty states.
    const categories: Record<SoundbankCategory, typeof samples> = {
      afro_house: [], deep_house: [], edm: [], chill: [], fx: [],
    }
    for (const s of samples) {
      const cat = s.category as SoundbankCategory
      if (cat in categories) categories[cat].push(s)
    }

    res.json({ data: { categories, total: samples.length }, error: null })
  } catch (err) { next(err) }
})

// ── GET /soundbank/categories ──────────────────────────────────
// Static list of supported categories with display labels. Used by
// the frontend to render the panel even before any samples exist.
soundbankRouter.get('/categories', (_req, res) => {
  res.json({
    data: SOUNDBANK_CATEGORIES.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
    error: null,
  })
})

// ─────────────────────────────────────────────────────────────
//  User samples — per-user library
// ─────────────────────────────────────────────────────────────

export const samplesRouter = Router()
samplesRouter.use(requireAuth)

// ── GET /samples ────────────────────────────────────────────────
samplesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { data: rows, error } = await supabaseAdmin
      .from('user_samples')
      .select('id, name, s3_key, duration_sec, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) throw new AppError('Database error', 500)

    const samples = await Promise.all(
      (rows ?? []).map(async (r) => ({
        ...r,
        signed_url: await createSignedUrlForBucket(USER_SAMPLES_BUCKET, r.s3_key, 3600),
      })),
    )
    res.json({ data: samples, error: null })
  } catch (err) { next(err) }
})

// ── POST /samples/upload-url ────────────────────────────────────
// Two-step upload: client requests a presigned PUT URL, uploads,
// then POSTs to /samples to register the row. Mirrors the track
// upload flow.
// Hard cap matches the frontend guard. Mirrors source-track limits but
// scoped tighter — user samples are short loops, not full songs.
const MAX_USER_SAMPLE_BYTES = 25 * 1024 * 1024
const ALLOWED_SAMPLE_MIME = new Set([
  'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/mpeg', 'audio/mp3', 'audio/mpeg3',
])

const uploadUrlSchema = z.object({
  filename:     z.string().min(1).max(200),
  content_type: z.string().min(1).max(100),
  size_bytes:   z.number().int().positive().max(MAX_USER_SAMPLE_BYTES),
})

samplesRouter.post('/upload-url', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const parsed = uploadUrlSchema.safeParse(req.body)
    if (!parsed.success) throw new AppError('Invalid request', 400)
    if (!ALLOWED_SAMPLE_MIME.has(parsed.data.content_type.toLowerCase())) {
      throw new AppError('Only WAV or MP3 files are supported', 400)
    }
    const slug = parsed.data.filename.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)
    const { path, url } = await createUserSampleUploadUrl(userId, slug)
    res.json({ data: { upload_url: url, s3_key: path }, error: null })
  } catch (err) { next(err) }
})

// ── POST /samples ───────────────────────────────────────────────
// Registers an uploaded sample after the client PUT completes.
const registerSchema = z.object({
  name:         z.string().min(1).max(200),
  s3_key:       z.string().min(1),
  duration_sec: z.number().positive().nullable().optional(),
})

samplesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) throw new AppError('Invalid request', 400)

    const { data, error } = await supabaseAdmin
      .from('user_samples')
      .insert({
        user_id:      userId,
        name:         parsed.data.name,
        s3_key:       parsed.data.s3_key,
        duration_sec: parsed.data.duration_sec ?? null,
      })
      .select('id, name, s3_key, duration_sec, created_at')
      .single()
    if (error || !data) throw new AppError('Failed to register sample', 500)

    const signed_url = await createSignedUrlForBucket(USER_SAMPLES_BUCKET, data.s3_key, 3600)
    res.status(201).json({ data: { ...data, signed_url }, error: null })
  } catch (err) { next(err) }
})

const CATEGORY_LABELS: Record<SoundbankCategory, string> = {
  afro_house: 'Afro House',
  deep_house: 'Deep House',
  edm:        'Festival EDM',
  chill:      'Chill / Cinematic',
  fx:         'FX / Risers',
}
