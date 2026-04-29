import { Router, Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../config/supabase'
import { logger } from '../config/logger'
import { AppError } from '../middleware/errorHandler'
import { publishJobUpdate } from '../services/sse'

// Internal webhook endpoint — only reachable from AI engine
// In production, enforce via INTERNAL_API_KEY or VPC-only network
export const internalRouter = Router()

function requireInternalKey(req: Request, _res: Response, next: NextFunction) {
  const key = req.headers['x-internal-api-key']
  if (key !== process.env.AI_ENGINE_API_KEY) {
    next(new AppError('Unauthorized', 401))
    return
  }
  next()
}

internalRouter.use(requireInternalKey)

// ── POST /internal/job-update ──────────────────────────────────
// Called by Python Celery workers to push progress updates
internalRouter.post('/job-update', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      job_id,
      status,
      progress,
      current_stage,
      stage_progress,
      error_message,
      output,
    } = req.body

    if (!job_id) throw new AppError('job_id required', 400)

    logger.info(`Job update: ${job_id} → ${status} (${progress}%)`)

    await supabaseAdmin.from('render_jobs').update({
      status:         status        ?? undefined,
      progress:       progress      ?? undefined,
      current_stage:  current_stage ?? undefined,
      stage_progress: stage_progress ?? undefined,
      error_message:  error_message  ?? undefined,
      ...(status && status !== 'queued' ? { started_at: new Date().toISOString() } : {}),
      ...((status === 'complete' || status === 'failed') ? { completed_at: new Date().toISOString() } : {}),
    }).eq('id', job_id)

    // Insert final output record if job is complete
    if (status === 'complete' && output) {
      const { data: jobRow } = await supabaseAdmin
        .from('render_jobs').select('project_id').eq('id', job_id).single()

      await supabaseAdmin.from('final_outputs').upsert({
        job_id,
        project_id:       jobRow?.project_id ?? null,
        preview_mp3_url:  output.preview_mp3_url,
        full_wav_url:     output.full_wav_url    ?? null,
        full_mp3_url:     output.full_mp3_url    ?? null,
        duration_seconds: output.duration_seconds ?? null,
        loudness_lufs:    output.loudness_lufs   ?? null,
        sample_rate:      output.sample_rate     ?? 44100,
        bit_depth:        output.bit_depth       ?? 16,
        file_size_bytes:  output.file_size_bytes ?? null,
        expires_at:       new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'job_id' })
    }

    // Store analysis results
    if (req.body.analysis_a) {
      const { data: projRow } = await supabaseAdmin
        .from('render_jobs').select('project_id').eq('id', job_id).single()
      if (projRow) {
        const { data: projData } = await supabaseAdmin
          .from('projects').select('track_a_id, track_b_id').eq('id', projRow.project_id).single()
        if (projData) {
          if (projData.track_a_id) await upsertAnalysis(projData.track_a_id, req.body.analysis_a)
          if (projData.track_b_id) await upsertAnalysis(projData.track_b_id, req.body.analysis_b)
        }
      }
    }

    res.json({ ok: true })

    // Notify SSE clients after responding to avoid blocking the webhook
    publishJobUpdate(job_id, {
      status,
      progress,
      current_stage,
      stage_progress,
      error_message,
    }).catch(() => {/* non-critical */})
  } catch (err) { next(err) }
})

async function upsertAnalysis(trackId: string, data: any) {
  await supabaseAdmin.from('analysis_results').upsert({
    track_id:         trackId,
    bpm:              data.bpm,
    bpm_confidence:   data.bpm_confidence,
    musical_key:      data.musical_key,
    key_confidence:   data.key_confidence,
    time_signature:   data.time_signature ?? '4/4',
    sections:         data.sections          ?? [],
    beat_timestamps:  data.beat_timestamps   ?? [],
    energy_map:       data.energy_map        ?? [],
    analyzed_at:      new Date().toISOString(),
  }, { onConflict: 'track_id' })
}

// ── POST /internal/cleanup-complete ───────────────────────────
internalRouter.post('/cleanup-complete', async (_req: Request, res: Response) => {
  // job_temp_files table not in schema — stub OK
  res.json({ ok: true })
})

// ── GET /internal/expired-temp-files ──────────────────────────
internalRouter.get('/expired-temp-files', async (_req: Request, res: Response) => {
  res.json({ items: [] })
})

// ── POST /internal/mark-files-deleted ────────────────────────
internalRouter.post('/mark-files-deleted', async (_req: Request, res: Response) => {
  res.json({ ok: true, deleted: 0 })
})

// ── GET /internal/expired-outputs ────────────────────────────
internalRouter.get('/expired-outputs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 200)
    const { data } = await supabaseAdmin
      .from('final_outputs')
      .select('job_id, preview_mp3_url, full_wav_url, full_mp3_url')
      .lt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: true })
      .limit(limit)
    res.json({ outputs: data ?? [] })
  } catch (err) { next(err) }
})

// ── POST /internal/mark-outputs-expired ──────────────────────
internalRouter.post('/mark-outputs-expired', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { job_ids } = req.body
    if (!Array.isArray(job_ids) || job_ids.length === 0) return res.json({ ok: true })
    await supabaseAdmin.from('final_outputs')
      .update({ preview_mp3_url: null, full_wav_url: null, full_mp3_url: null })
      .in('job_id', job_ids)
    await supabaseAdmin.from('render_jobs')
      .update({ status: 'canceled' })
      .in('id', job_ids).eq('status', 'complete')
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// ── POST /internal/record-job-cost ───────────────────────────
internalRouter.post('/record-job-cost', async (_req: Request, res: Response) => {
  // job_cost_tracking table not in schema — stub OK
  res.json({ ok: true })
})

// ── POST /internal/worker-heartbeat ──────────────────────────
internalRouter.post('/worker-heartbeat', async (_req: Request, res: Response) => {
  // worker_nodes table not in schema — stub OK
  res.json({ ok: true })
})

// ── POST /internal/prune-stale-workers ───────────────────────
internalRouter.post('/prune-stale-workers', async (_req: Request, res: Response) => {
  // worker_nodes table not in schema — stub OK
  res.json({ ok: true, pruned: 0 })
})

// ── POST /internal/send-completion-email ─────────────────────
internalRouter.post('/send-completion-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { job_id, user_email, user_name, preview_url, plan } = req.body
    if (!user_email) throw new AppError('user_email required', 400)

    // Import the mailer service (already exists in services/mailer.ts)
    const { sendJobCompleteEmail } = await import('../services/mailer')
    await sendJobCompleteEmail({ to: user_email, userName: user_name, previewUrl: preview_url, plan })

    logger.info(`Completion email sent for job ${job_id} to ${user_email}`)
    res.json({ ok: true })
  } catch (err) { next(err) }
})
