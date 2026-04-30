import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import Stripe from 'stripe'
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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', { apiVersion: '2024-04-10' })

const startRemixSchema = z.object({
  project_id:     z.string().uuid(),
  remix_style:    z.enum(['none','edm_festival','house_club','afro_house','deep_emotional','pop_radio','cinematic','chill_sunset']),
  output_quality: z.enum(['standard','hd','professional']),
  remix_prompt:   z.string().max(500).optional(),
})

// All new generations start in preview mode. The full render is gated behind
// the upgrade endpoint (Stripe checkout). This is a deliberate cost control:
// preview pipelines skip style injection, mastering, and HQ export.
const DEFAULT_MODE: 'preview' = 'preview'
const PREVIEW_DURATION_SEC = 30

const initialStageProgress = (mode: 'preview' | 'full', remix_style: string) => ({
  stem_separation:     { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
  music_analysis:      { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
  harmonic_matching:   { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
  mashup_composition:  { status: mode === 'preview' ? 'skipped' : 'pending', progress: 0, started_at: null, completed_at: null, message: null },
  sound_modernization: { status: mode === 'preview' || remix_style === 'none' ? 'skipped' : 'pending', progress: 0, started_at: null, completed_at: null, message: null },
  mastering:           { status: mode === 'preview' ? 'skipped' : 'pending', progress: 0, started_at: null, completed_at: null, message: null },
  rendering:           { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
})

function makeIdempotencyKey(req: Request, scope: string, parts: string[]): string {
  const headerKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
  if (headerKey) return `${scope}:${headerKey}`
  // Fallback: deterministic key from logical parts (window-less, server-side decision)
  return `${scope}:${parts.join('|')}`
}

// ── POST /jobs/start-remix ─────────────────────────────────────
//
// Always creates a `mode='preview'` job. No credit deduction. Idempotent on
// header `Idempotency-Key` or, as fallback, on (user_id, project_id, remix_style).
jobsRouter.post('/start-remix', validate(startRemixSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { project_id, remix_style, output_quality, remix_prompt } = req.body as z.infer<typeof startRemixSchema>

    const directorParams = await interpretRemixPrompt(remix_prompt)

    const { data: project, error: projErr } = await supabaseAdmin
      .from('projects')
      .select('*, track_a:uploaded_tracks!track_a_id(s3_key, upload_status), track_b:uploaded_tracks!track_b_id(s3_key, upload_status)')
      .eq('id', project_id).eq('user_id', userId).single()
    if (projErr || !project) throw new AppError('Project not found', 404)
    const taKey = (project.track_a as any)?.upload_status === 'ready' ? (project.track_a as any)?.s3_key : null
    const tbKey = (project.track_b as any)?.upload_status === 'ready' ? (project.track_b as any)?.s3_key : null
    if (!taKey || !tbKey) throw new AppError('Both tracks must be uploaded and ready', 400)

    const { data: userRow } = await supabaseAdmin
      .from('users').select('credits_remaining, plan').eq('id', userId).single()
    if (!userRow) throw new AppError('User not found', 404)

    const idempotencyKey = makeIdempotencyKey(req, 'preview', [userId, project_id, remix_style, output_quality])

    // Idempotency: if a job with this key already exists, return it
    const { data: existing } = await supabaseAdmin
      .from('render_jobs').select('*').eq('idempotency_key', idempotencyKey).maybeSingle()
    if (existing) {
      res.status(202).json({ data: existing, error: null })
      return
    }

    const jobId = uuid()
    const mode = DEFAULT_MODE

    const { error: insErr } = await supabaseAdmin.from('render_jobs').insert({
      id:                    jobId,
      project_id,
      user_id:               userId,
      status:                'queued',
      progress:              0,
      current_stage:         'Queued for preview',
      stage_progress:        initialStageProgress(mode, remix_style),
      remix_style,
      output_quality,
      mode,
      preview_duration_sec:  PREVIEW_DURATION_SEC,
      idempotency_key:       idempotencyKey,
    })
    if (insErr) {
      // Race on the unique idempotency_key — return the winner
      const { data: winner } = await supabaseAdmin
        .from('render_jobs').select('*').eq('idempotency_key', idempotencyKey).maybeSingle()
      if (winner) { res.status(202).json({ data: winner, error: null }); return }
      throw new AppError('Failed to create job', 500)
    }

    await supabaseAdmin.from('projects').update({
      remix_style,
      output_quality,
    }).eq('id', project_id)

    await queueMashupJob({
      job_id:               jobId,
      project_id,
      user_id:              userId,
      user_plan:            userRow.plan ?? 'free',
      track_a_s3_key:       taKey,
      track_b_s3_key:       tbKey,
      remix_style,
      output_quality,
      remix_prompt:         remix_prompt ?? undefined,
      remix_director_params: directorParams ? (directorParams as unknown as Record<string, unknown>) : undefined,
      mode,
      preview_duration_sec: PREVIEW_DURATION_SEC,
    })

    const { data: jobRow } = await supabaseAdmin.from('render_jobs').select('*').eq('id', jobId).single()
    res.status(202).json({ data: jobRow, error: null })
  } catch (err) { next(err) }
})

// ── POST /jobs/:id/upgrade-to-full ────────────────────────────
//
// Always returns a Stripe Checkout URL. Stripe webhook (`checkout.session.completed`
// with metadata.kind=upgrade_full) is responsible for actually queuing the
// full-mode child job. No credits path here per product decision.
jobsRouter.post('/:id/upgrade-to-full', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId   = (req as any).user.sub
    const previewJobId = req.params.id

    const { data: previewJob } = await supabaseAdmin
      .from('render_jobs')
      .select('id, user_id, mode, status, project_id, remix_style, output_quality, cached_analysis_json')
      .eq('id', previewJobId).eq('user_id', userId).maybeSingle()
    if (!previewJob)                        throw new AppError('Preview job not found', 404)
    if (previewJob.mode !== 'preview')       throw new AppError('Job is not a preview', 400)
    if (previewJob.status !== 'complete')    throw new AppError('Preview not finished yet', 409)

    // Idempotency: if a child full-mode job already exists for this preview, return it
    const { data: existingChild } = await supabaseAdmin
      .from('render_jobs')
      .select('*')
      .eq('parent_job_id', previewJobId)
      .eq('mode', 'full')
      .maybeSingle()
    if (existingChild) {
      res.json({ data: { full_job: existingChild, requires_payment: false }, error: null })
      return
    }

    const { data: userRow } = await supabaseAdmin
      .from('users').select('email, stripe_customer_id').eq('id', userId).single()
    if (!userRow) throw new AppError('User not found', 404)

    const priceId = process.env.STRIPE_FULL_UPGRADE_PRICE_ID
    if (!priceId) throw new AppError('Stripe upgrade price not configured', 500)

    let customerId = userRow.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userRow.email,
        metadata: { user_id: userId },
      })
      customerId = customer.id
      await supabaseAdmin.from('users').update({ stripe_customer_id: customerId }).eq('id', userId)
    }

    const successUrl = req.body?.success_url ?? `${process.env.APP_URL}/studio/${previewJobId}?upgraded=1`
    const cancelUrl  = req.body?.cancel_url  ?? `${process.env.APP_URL}/studio/${previewJobId}`

    const session = await stripe.checkout.sessions.create({
      customer:    customerId,
      mode:        'payment',
      line_items:  [{ price: priceId, quantity: 1 }],
      success_url: `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancelUrl,
      metadata: {
        kind:            'upgrade_full',
        user_id:         userId,
        preview_job_id:  previewJobId,
      },
      payment_intent_data: {
        metadata: {
          kind:            'upgrade_full',
          user_id:         userId,
          preview_job_id:  previewJobId,
        },
      },
    })

    res.json({
      data: { requires_payment: true, checkout_url: session.url },
      error: null,
    })
  } catch (err) { next(err) }
})

// ── GET /jobs/:id/stream (SSE) ────────────────────────────────
jobsRouter.get('/:id/stream', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const jobId  = req.params.id

    const { data: jobCheck } = await supabaseAdmin
      .from('render_jobs').select('id').eq('id', jobId).eq('user_id', userId).single()
    if (!jobCheck) throw new AppError('Job not found', 404)

    res.setHeader('Content-Type',  'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection',    'keep-alive')
    res.flushHeaders()

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
      .select('*, final_outputs(preview_mp3_url, full_wav_url, full_mp3_url, is_preview, preview_a_url, preview_b_url, preview_c_url, duration_seconds, loudness_lufs)')
      .eq('id', req.params.id).eq('user_id', userId).single()
    if (!job) throw new AppError('Job not found', 404)

    res.json({ data: job, error: null })
  } catch (err) { next(err) }
})

// ── GET /jobs/:id/preview ──────────────────────────────────────
jobsRouter.get('/:id/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
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
//
// Refuses downloads for preview jobs — there is nothing to download until the
// user upgrades and the full-mode child completes.
jobsRouter.get('/:id/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { data: jobRow } = await supabaseAdmin
      .from('render_jobs').select('output_quality, status, mode').eq('id', req.params.id).eq('user_id', userId).single()
    if (!jobRow || jobRow.status !== 'complete') throw new AppError('Download not available', 404)
    if (jobRow.mode === 'preview') throw new AppError('Upgrade required to download', 402)
    const { data: outputRow } = await supabaseAdmin
      .from('final_outputs').select('*').eq('job_id', req.params.id).single()
    if (!outputRow || outputRow.is_preview) throw new AppError('Download not available', 404)

    const expires = 60 * 60  // 1 hour signed URL

    const mp3Url = outputRow.full_mp3_url
      ? await createPresignedDownloadUrl(outputRow.full_mp3_url, expires)
      : outputRow.preview_mp3_url
        ? await createPresignedDownloadUrl(outputRow.preview_mp3_url, expires)
        : null

    const wavUrl = outputRow.full_wav_url
      ? await createPresignedDownloadUrl(outputRow.full_wav_url, expires)
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
