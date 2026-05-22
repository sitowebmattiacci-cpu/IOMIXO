import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import axios from 'axios'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { AppError } from '../middleware/errorHandler'
import { supabaseAdmin } from '../config/supabase'
import { arrangementSchema } from '../schemas/arrangement'
import { createSignedUrlForBucket, STEMS_BUCKET } from '../services/storage'

export const projectsRouter = Router()
projectsRouter.use(requireAuth)

function normalizeArrangementDoc<T extends { tracks: any[]; lanes?: any[] }>(doc: T): T {
  const lanes = Array.isArray(doc.lanes) ? doc.lanes : []
  const tracks = Array.isArray(doc.tracks) ? doc.tracks : []
  if (lanes.length > 0 && tracks.length === 0) {
    return { ...doc, tracks: lanes } as T
  }
  if (tracks.length > 0 && lanes.length === 0) {
    return { ...doc, lanes: tracks } as T
  }
  return doc
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  mode:  z.enum(['remix', 'mashup']).default('mashup'),
})

// ── POST /projects ─────────────────────────────────────────────
projectsRouter.post('/', validate(createSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { title, mode } = req.body as z.infer<typeof createSchema>
    const id = uuid()

    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({ id, user_id: userId, title, mode })
      .select()
      .single()

    if (error) throw new AppError('Failed to create project', 500)
    res.status(201).json({ data, error: null })
  } catch (err) { next(err) }
})

// ── GET /projects ──────────────────────────────────────────────
projectsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const page   = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit  = Math.min(50, parseInt(req.query.limit as string) || 20)
    const offset = (page - 1) * limit

    const { data: projects, error, count } = await supabaseAdmin
      .from('projects')
      .select(
        'id, user_id, title, mode, track_a_id, track_b_id, remix_style, output_quality, created_at, updated_at',
        { count: 'exact' }
      )
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw new AppError('Database error', 500)

    const total = count ?? 0

    res.json({
      data:     (projects ?? []).map(p => ({ ...p, track_a: null, track_b: null, latest_job: null })),
      total,
      page,
      limit,
      has_more: offset + limit < total,
    })
  } catch (err) { next(err) }
})

// ── GET /projects/:id ──────────────────────────────────────────
projectsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { data: project, error } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .maybeSingle()

    if (error) throw new AppError('Database error', 500)
    if (!project) throw new AppError('Project not found', 404)
    res.json({ data: project, error: null })
  } catch (err) { next(err) }
})

// ── DELETE /projects/:id ───────────────────────────────────────
projectsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { data, error } = await supabaseAdmin
      .from('projects')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle()
    if (error) throw new AppError('Database error', 500)
    if (!data) throw new AppError('Project not found', 404)
    res.json({ message: 'Project deleted' })
  } catch (err) { next(err) }
})

// ═══════════════════════════════════════════════════════════════════
// Remix Workstation routes (Phase 1)
//
// Project-scoped endpoints that back the browser DAW: list stems,
// load/save the arrangement JSON, and trigger a render-from-arrangement.
// Authentication is enforced by the router-level requireAuth above; each
// handler additionally scopes queries by user_id.
// ═══════════════════════════════════════════════════════════════════

async function loadOwnedProject(req: Request): Promise<{ id: string; user_id: string }> {
  const userId = (req as any).user.sub
  const { data: project, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id')
    .eq('id', req.params.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new AppError('Database error', 500)
  if (!project) throw new AppError('Project not found', 404)
  return project as { id: string; user_id: string }
}

// ── GET /projects/:id/stems ──────────────────────────────────────
// Lists the persisted Demucs stems for the project, with short-lived
// signed URLs the browser can drag into the timeline.
projectsRouter.get('/:id/stems', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await loadOwnedProject(req)
    const { data: rows, error } = await supabaseAdmin
      .from('stems')
      .select('id, side, stem_name, s3_key, duration_sec, sample_rate')
      .eq('project_id', project.id)
      .order('side').order('stem_name')
    if (error) throw new AppError('Database error', 500)

    const stems = await Promise.all(
      (rows ?? []).map(async (r) => ({
        ...r,
        signed_url: await createSignedUrlForBucket(STEMS_BUCKET, r.s3_key, 3600),
      })),
    )
    res.json({ data: stems, error: null })
  } catch (err) { next(err) }
})

// ── GET /projects/:id/seed-job ───────────────────────────────────
// Returns the latest render_job for this project so the workstation can
// show a real failure state (with error_message) instead of polling
// the arrangement endpoint forever when the AI engine crashed mid-seed.
projectsRouter.get('/:id/seed-job', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await loadOwnedProject(req)
    const { data, error } = await supabaseAdmin
      .from('render_jobs')
      .select('id, status, current_stage, progress, error_message, created_at, updated_at')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new AppError('Database error', 500)

    // Watchdog: a job that has been "queued" with 0 progress for >5 minutes
    // means dispatch silently dropped it (AI engine crashed/unreachable and
    // we never got a fail callback). Mark it failed so the workstation
    // surfaces an error instead of polling forever.
    if (data && data.status === 'queued' && (data.progress ?? 0) === 0) {
      const ageMs = Date.now() - new Date(data.created_at).getTime()
      if (ageMs > 5 * 60_000) {
        const msg = 'AI engine never picked up this job. Restart the engine and retry.'
        await supabaseAdmin.from('render_jobs').update({
          status:        'failed',
          error_message: msg,
          completed_at:  new Date().toISOString(),
        }).eq('id', data.id)
        data.status        = 'failed'
        data.error_message = msg
      }
    }

    res.json({ data: data ?? null, error: null })
  } catch (err) { next(err) }
})

// ── GET /projects/:id/arrangement ────────────────────────────────
// Returns the highest-version arrangement for the project, or null if
// none exists yet (the AI seed stage will create the first row). We
// deliberately return 200 + null instead of 404 so the workstation
// doesn't flood the console with errors while polling for the seed.
projectsRouter.get('/:id/arrangement', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await loadOwnedProject(req)
    const { data, error } = await supabaseAdmin
      .from('arrangements')
      .select('id, version, source, doc, created_at, updated_at')
      .eq('project_id', project.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new AppError('Database error', 500)
    res.json({ data: data ?? null, error: null })
  } catch (err) { next(err) }
})

// ── PUT /projects/:id/arrangement ────────────────────────────────
// Upserts the latest arrangement (frontend autosave). Body is the
// arrangement JSON; we validate against the shared schema before
// writing. New rows get version=max+1 with source='user'.
projectsRouter.put('/:id/arrangement', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await loadOwnedProject(req)
    const parsed = arrangementSchema.safeParse({ ...req.body, project_id: project.id })
    if (!parsed.success) throw new AppError(`Invalid arrangement: ${parsed.error.message}`, 400)
    const normalizedDoc = normalizeArrangementDoc(parsed.data)

    const { data: latest } = await supabaseAdmin
      .from('arrangements')
      .select('id, version')
      .eq('project_id', project.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextVersion = (latest?.version ?? 0) + 1
    const { data, error } = await supabaseAdmin
      .from('arrangements')
      .insert({
        project_id: project.id,
        version:    nextVersion,
        source:     'user',
        doc:        normalizedDoc,
      })
      .select()
      .single()
    if (error) throw new AppError('Failed to save arrangement', 500)
    res.json({ data, error: null })
  } catch (err) { next(err) }
})

// ── POST /projects/:id/render ────────────────────────────────────
// Creates a render_job and fires the AI engine /render/arrangement.
// Renders the latest saved arrangement, NOT whatever is in the request
// body — this prevents the browser from triggering renders on
// unsaved/unvalidated documents.
const renderSchema = z.object({
  output_quality: z.enum(['standard', 'hd', 'professional']).default('standard'),
})

projectsRouter.post('/:id/render', validate(renderSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await loadOwnedProject(req)
    const { output_quality } = req.body as z.infer<typeof renderSchema>

    const { data: arrangement, error: arrErr } = await supabaseAdmin
      .from('arrangements')
      .select('doc, version')
      .eq('project_id', project.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (arrErr) throw new AppError('Database error', 500)
    if (!arrangement) throw new AppError('No arrangement to render', 404)

    const { data: userRow } = await supabaseAdmin
      .from('users').select('plan').eq('id', project.user_id).single()
    const userPlan = userRow?.plan ?? 'free'

    const jobId = uuid()
    const { error: insErr } = await supabaseAdmin.from('render_jobs').insert({
      id:             jobId,
      project_id:     project.id,
      user_id:        project.user_id,
      status:         'queued',
      progress:       0,
      current_stage:  'Queued for arrangement render',
      stage_progress: { rendering: { status: 'pending', progress: 0 } },
      mode:           'full',
    })
    if (insErr) throw new AppError('Failed to create render job', 500)

    // Fire-and-forget to AI engine — pipeline reports back via /internal/job-update.
    axios.post(
      `${process.env.AI_ENGINE_URL}/render/arrangement`,
      {
        job_id:         jobId,
        project_id:     project.id,
        user_id:        project.user_id,
        arrangement:    arrangement.doc,
        user_plan:      userPlan,
        output_quality,
      },
      {
        headers: { 'X-Internal-API-Key': process.env.AI_ENGINE_API_KEY },
        timeout: 3_600_000,
      },
    ).catch((err) => {
      // Logged only — job will surface as 'failed' via webhook on the engine side.
      console.warn(`Arrangement render dispatch failed for job ${jobId}: ${err?.message}`)
    })

    const { data: jobRow } = await supabaseAdmin.from('render_jobs').select('*').eq('id', jobId).single()
    res.status(202).json({ data: jobRow, error: null })
  } catch (err) { next(err) }
})

// ── POST /projects/:id/clips/sync-to-beat ────────────────────────
// Runs librosa beat/onset analysis on the selected clips' source audio
// and returns suggested edits (offset, start snap, time_stretch, fade_in).
// The frontend applies + persists the suggestions via the existing
// PUT /arrangement endpoint. Source audio is never modified.
const syncToBeatSchema = z.object({
  grid:     z.enum(['bar', 'beat', 'half']),
  clip_ids: z.array(z.string().min(1)).min(1).max(64),
})

projectsRouter.post('/:id/clips/sync-to-beat', validate(syncToBeatSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await loadOwnedProject(req)
    const { grid, clip_ids } = req.body as z.infer<typeof syncToBeatSchema>

    const { data: arrangement, error: arrErr } = await supabaseAdmin
      .from('arrangements')
      .select('doc')
      .eq('project_id', project.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (arrErr) throw new AppError('Database error', 500)
    if (!arrangement) throw new AppError('No arrangement to sync', 404)

    const doc = arrangement.doc as z.infer<typeof arrangementSchema>
    const wantedIds = new Set(clip_ids)
    const clips: Array<{
      clip_id: string; asset_kind: string; asset_ref: string;
      start_sec: number; end_sec: number; offset_sec: number;
    }> = []
    for (const track of doc.tracks ?? []) {
      for (const clip of track.clips ?? []) {
        if (!wantedIds.has(clip.id)) continue
        clips.push({
          clip_id:    clip.id,
          asset_kind: clip.asset_kind,
          asset_ref:  clip.asset_ref,
          start_sec:  clip.start_sec,
          end_sec:    clip.end_sec,
          offset_sec: clip.offset_sec,
        })
      }
    }
    if (clips.length === 0) throw new AppError('Selected clips not found in arrangement', 404)

    const aiResp = await axios.post(
      `${process.env.AI_ENGINE_URL}/ai-tools/sync-to-beat`,
      { project_bpm: doc.bpm, grid, clips },
      {
        headers: { 'X-Internal-API-Key': process.env.AI_ENGINE_API_KEY },
        timeout: 120_000,
      },
    )

    res.json({ data: { suggestions: aiResp.data?.suggestions ?? [] }, error: null })
  } catch (err) {
    if (axios.isAxiosError(err)) {
      return next(new AppError(`AI engine sync failed: ${err.message}`, 502))
    }
    next(err)
  }
})
