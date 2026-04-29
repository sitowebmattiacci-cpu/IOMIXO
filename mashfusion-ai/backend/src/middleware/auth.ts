import { Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import { AppError } from './errorHandler'

// Service-role client — used only for server-side token verification
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export interface AuthUser {
  sub:       string   // Supabase user UUID
  email:     string
  plan:      string   // read from public.users table via metadata or DB
  full_name: string
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  // Accept token from Authorization header or ?token= query param (needed for EventSource/SSE)
  const header = req.headers.authorization
  const rawToken = header?.startsWith('Bearer ')
    ? header.slice(7)
    : typeof req.query.token === 'string' ? req.query.token : null

  if (!rawToken) return next(new AppError('Missing authorization token', 401))

  const { data, error } = await supabaseAdmin.auth.getUser(rawToken)

  if (error || !data.user) {
    return next(new AppError('Invalid or expired token', 401))
  }

  ;(req as any).user = {
    sub:       data.user.id,
    email:     data.user.email ?? '',
    plan:      (data.user.user_metadata?.plan as string)      ?? 'free',
    full_name: (data.user.user_metadata?.full_name as string) ?? '',
  } satisfies AuthUser

  next()
}
