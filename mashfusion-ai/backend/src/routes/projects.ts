import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { AppError } from '../middleware/errorHandler'
import { supabaseAdmin } from '../config/supabase'

export const projectsRouter = Router()
projectsRouter.use(requireAuth)

const createSchema = z.object({ title: z.string().min(1).max(200) })

// ── POST /projects ─────────────────────────────────────────────
projectsRouter.post('/', validate(createSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { title } = req.body as z.infer<typeof createSchema>
    const id = uuid()

    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({ id, user_id: userId, title })
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
        'id, user_id, title, track_a_id, track_b_id, remix_style, output_quality, created_at, updated_at',
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
