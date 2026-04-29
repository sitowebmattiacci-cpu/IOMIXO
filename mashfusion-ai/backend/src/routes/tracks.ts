import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { AppError } from '../middleware/errorHandler'
import { supabaseAdmin } from '../config/supabase'
import { createPresignedUploadUrl, deleteStorageObject } from '../services/storage'

export const tracksRouter = Router()
tracksRouter.use(requireAuth)

const requestUploadSchema = z.object({
  project_id: z.string().uuid(),
  role:       z.enum(['track_a', 'track_b']),
  filename:   z.string().min(1).max(255),
  mime_type:  z.string().min(1).max(100),
})

const confirmUploadSchema = z.object({
  duration_seconds: z.number().positive().max(7200).optional(),
  file_size_bytes:  z.number().int().positive().max(2_147_483_647).optional(),
})

// ── POST /tracks/request-upload ────────────────────────────────
tracksRouter.post('/request-upload', validate(requestUploadSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { project_id, role, filename, mime_type } = req.body as z.infer<typeof requestUploadSchema>

    // Verify project belongs to user
    const { data: proj } = await supabaseAdmin
      .from('projects').select('id').eq('id', project_id).eq('user_id', userId).single()
    if (!proj) throw new AppError('Project not found', 404)

    const trackId = uuid()
    const ext       = filename.split('.').pop()?.toLowerCase() ?? 'mp3'
    const storagePath = `${userId}/${project_id}/${role}/${trackId}.${ext}`

    const uploadUrl = await createPresignedUploadUrl(storagePath, mime_type, 15 * 60)

    await supabaseAdmin.from('uploaded_tracks').insert({
      id:              trackId,
      user_id:         userId,
      project_id,
      role,
      original_filename: filename,
      s3_key:          storagePath,
      mime_type,
      upload_status:   'uploading',
    })

    res.json({ upload_url: uploadUrl, track_id: trackId, storage_path: storagePath })
  } catch (err) { next(err) }
})

// ── POST /tracks/:id/confirm ───────────────────────────────────
tracksRouter.post('/:id/confirm', validate(confirmUploadSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId  = (req as any).user.sub
    const trackId = req.params.id
    const { duration_seconds, file_size_bytes } = req.body as z.infer<typeof confirmUploadSchema>

    const supabaseStorageBase = `${process.env.SUPABASE_URL}/storage/v1/object/public/track-uploads`

    const { data: track, error: updateErr } = await supabaseAdmin
      .from('uploaded_tracks')
      .update({
        upload_status:    'ready',
        duration_seconds: duration_seconds ?? null,
        file_size_bytes:  file_size_bytes  ?? null,
      })
      .eq('id', trackId).eq('user_id', userId)
      .select().single()
    if (updateErr || !track) throw new AppError('Track not found', 404)

    // Set s3_url
    await supabaseAdmin.from('uploaded_tracks')
      .update({ s3_url: `${supabaseStorageBase}/${track.s3_key}` })
      .eq('id', trackId)

    // Link track to project
    const col = track.role === 'track_a' ? 'track_a_id' : 'track_b_id'
    await supabaseAdmin.from('projects')
      .update({ [col]: trackId })
      .eq('id', track.project_id).eq('user_id', userId)

    res.json({ data: track, error: null })
  } catch (err) { next(err) }
})

// ── DELETE /tracks/:id ─────────────────────────────────────────
tracksRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId  = (req as any).user.sub
    const trackId = req.params.id

    const { data: trackRow } = await supabaseAdmin
      .from('uploaded_tracks').select('s3_key').eq('id', trackId).eq('user_id', userId).single()
    if (!trackRow) throw new AppError('Track not found', 404)

    await deleteStorageObject(trackRow.s3_key)
    await supabaseAdmin.from('uploaded_tracks').delete().eq('id', trackId).eq('user_id', userId)

    res.json({ message: 'Track deleted' })
  } catch (err) { next(err) }
})
