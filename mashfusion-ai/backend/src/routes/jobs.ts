import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { AppError } from '../middleware/errorHandler'
import { supabaseAdmin } from '../config/supabase'
import { queueMashupJob } from '../services/queue'
import { createPresignedDownloadUrl } from '../services/storage'
import { addSseClient } from '../services/sse'
import { interpretRemixPrompt } from '../services/remixDirector'

export const jobsRouter = Router()
jobsRouter.use(requireAuth)

const startRemixSchema = z.object({
  project_id:     z.string().uuid(),
  remix_style:    z.enum(['none','edm_festival','house_club','afro_house','deep_emotional','pop_radio','cinematic','chill_sunset']),
  output_quality: z.enum(['standard','hd','professional']),
  remix_prompt:   z.string().max(500).optional(),
})

// ── POST /jobs/start-remix ─────────────────────────────────────
jobsRouter.post('/start-remix', validate(startRemixSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { project_id, remix_style, output_quality, remix_prompt } = req.body as z.infer<typeof startRemixSchema>

    // Interpret free-text remix vision → structured params
    const directorParams = await interpretRemixPrompt(remix_prompt)

    // Verify project + both tracks exist
    const { data: project, error: projErr } = await supabaseAdmin
      .from('projects')
      .select('*, track_a:uploaded_tracks!track_a_id(s3_key, upload_status), track_b:uploaded_tracks!track_b_id(s3_key, upload_status)')
      .eq('id', project_id).eq('user_id', userId).single()
    if (projErr || !project) throw new AppError('Project not found', 404)
    const taKey = (project.track_a as any)?.upload_status === 'ready' ? (project.track_a as any)?.s3_key : null
    const tbKey = (project.track_b as any)?.upload_status === 'ready' ? (project.track_b as any)?.s3_key : null
    if (!taKey || !tbKey) throw new AppError('Both tracks must be uploaded and ready', 400)

    // Verify credits
    const { data: userRow } = await supabaseAdmin
      .from('users').select('credits_remaining, plan').eq('id', userId).single()
    if (!userRow || userRow.credits_remaining < 1) throw new AppError('Insufficient credits', 402)

    // Deduct credit
    await supabaseAdmin
      .from('users').update({ credits_remaining: userRow.credits_remaining - 1 }).eq('id', userId)

    // Create job
    const jobId = uuid()
    const initialStageProgress = JSON.stringify({
      stem_separation:     { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
      music_analysis:      { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
      harmonic_matching:   { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
      mashup_composition:  { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
      sound_modernization: { status: remix_style === 'none' ? 'skipped' : 'pending', progress: 0, started_at: null, completed_at: null, message: null },
      mastering:           { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
      rendering:           { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
    })

    await supabaseAdmin.from('render_jobs').insert({
      id:             jobId,
      project_id,
      user_id:        userId,
      status:         'queued',
      progress:       0,
      current_stage:  'Queued for processing',
      stage_progress: JSON.parse(initialStageProgress),
      remix_style,
      output_quality,
    })

    await supabaseAdmin.from('projects').update({
      remix_style,
      output_quality,
    }).eq('id', project_id)

    // Enqueue to AI engine via Bull
    await queueMashupJob({
      job_id:         jobId,
      project_id,
      user_id:        userId,
      user_plan:      userRow.plan ?? 'free',
      track_a_s3_key: taKey,
      track_b_s3_key: tbKey,
      remix_style,
      output_quality,
      remix_prompt:   remix_prompt ?? undefined,
    })

    const { data: jobRow } = await supabaseAdmin.from('render_jobs').select('*').eq('id', jobId).single()
    res.status(202).json({ data: jobRow, error: null })
  } catch (err) { next(err) }
})

// ── GET /jobs/:id/stream (SSE) ────────────────────────────────
jobsRouter.get('/:id/stream', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const jobId  = req.params.id

    // Verify job belongs to user
    const { data: jobCheck } = await supabaseAdmin
      .from('render_jobs').select('id').eq('id', jobId).eq('user_id', userId).single()
    if (!jobCheck) throw new AppError('Job not found', 404)

    res.setHeader('Content-Type',  'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection',    'keep-alive')
    res.flushHeaders()

    // Send a heartbeat every 25s to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n')
    }, 25_000)

    res.on('close', () => clearInterval(heartbeat))

    addSseClient(jobId, res)
  } catch (err) { next(err) }
})

// ── GET /jobs/:id/status ───────────────────────────────────────
jobsRouter.get('/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { data: job } = await supabaseAdmin
      .from('render_jobs')
      .select('*, final_outputs(preview_mp3_url, full_wav_url, full_mp3_url, duration_seconds, loudness_lufs)')
      .eq('id', req.params.id).eq('user_id', userId).single()
    if (!job) throw new AppError('Job not found', 404)

    res.json({ data: job, error: null })
  } catch (err) { next(err) }
})

// ── GET /jobs/:id/preview ──────────────────────────────────────
jobsRouter.get('/:id/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    // Verify job belongs to user, then get output
    const { data: jobCheck } = await supabaseAdmin
      .from('render_jobs').select('id').eq('id', req.params.id).eq('user_id', userId).single()
    if (!jobCheck) throw new AppError('Preview not ready yet', 404)
    const { data: output } = await supabaseAdmin
      .from('final_outputs').select('*').eq('job_id', req.params.id).single()
    if (!output) throw new AppError('Preview not ready yet', 404)
    res.json({ data: output, error: null })
  } catch (err) { next(err) }
})

// ── GET /jobs/:id/download ─────────────────────────────────────
jobsRouter.get('/:id/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { data: jobRow } = await supabaseAdmin
      .from('render_jobs').select('output_quality, status').eq('id', req.params.id).eq('user_id', userId).single()
    if (!jobRow || jobRow.status !== 'complete') throw new AppError('Download not available', 404)
    const { data: outputRow } = await supabaseAdmin
      .from('final_outputs').select('*').eq('job_id', req.params.id).single()
    if (!outputRow) throw new AppError('Download not available', 404)

    const output = { ...outputRow, output_quality: jobRow.output_quality }
    const expires = 60 * 60  // 1 hour signed URL

    const mp3Url = output.preview_mp3_url
      ? await createPresignedDownloadUrl(output.preview_mp3_url, expires)
      : null

    const wavUrl = output.full_wav_url
      ? await createPresignedDownloadUrl(output.full_wav_url, expires)
      : null

    const expiresAt = new Date(Date.now() + expires * 1000).toISOString()

    res.json({
      data: { mp3_url: mp3Url, wav_url: wavUrl, expires_at: expiresAt },
      error: null,
    })
  } catch (err) { next(err) }
})

// ── GET /jobs/analysis/:projectId ─────────────────────────────
jobsRouter.get('/analysis/:projectId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { data: proj } = await supabaseAdmin
      .from('projects').select('track_a_id, track_b_id').eq('id', req.params.projectId).eq('user_id', userId).single()
    if (!proj) throw new AppError('Project not found', 404)

    const trackIds = [proj.track_a_id, proj.track_b_id].filter(Boolean)
    const { data: tracks } = await supabaseAdmin
      .from('uploaded_tracks').select('id, role').in('id', trackIds)
    const { data: analyses } = await supabaseAdmin
      .from('analysis_results').select('*').in('track_id', trackIds)

    const trackRoleMap = Object.fromEntries((tracks ?? []).map(t => [t.id, t.role]))
    const a = (analyses ?? []).find(ar => trackRoleMap[ar.track_id] === 'track_a')
    const b = (analyses ?? []).find(ar => trackRoleMap[ar.track_id] === 'track_b')

    if (!a || !b) throw new AppError('Analysis not complete yet', 404)
    res.json({ data: { a, b }, error: null })
  } catch (err) { next(err) }
})
