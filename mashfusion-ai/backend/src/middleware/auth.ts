import { Request, Response, NextFunction } from 'express'
import type { DecodedIdToken } from 'firebase-admin/auth'
import { AppError } from './errorHandler'
import { firebaseAuth, isFirebaseAuthConfigured } from '../lib/firebaseAdmin'

/**
 * Authenticated identity attached to `req.user`.
 *
 * Built ONLY from a verified token — never from request body/query/headers
 * other than the token itself.
 */
export interface AuthUser {
  /** Firebase UID (or Supabase UUID for legacy-fallback tokens). */
  uid:           string
  /**
   * ID used by the existing Supabase-backed routes as `users.id` / foreign key.
   * TODO(firebase-migration): remove once the data layer is on Firestore keyed
   * by Firebase UID. Until then:
   *  - legacy Supabase token      → Supabase UUID (== uid)
   *  - Firebase token with the server-set custom claim `legacyUserId`
   *                               → that Supabase UUID (owner account bridge)
   *  - any other Firebase token   → Firebase UID (no Supabase row exists)
   */
  sub:           string
  email:         string
  emailVerified: boolean
  isAnonymous:   boolean
  provider:      'firebase' | 'supabase'
  plan:          string   // legacy field (Supabase user_metadata); routes read the real plan from the DB
  full_name:     string
}

export function firebaseTokenToAuthUser(t: DecodedIdToken): AuthUser {
  const isAnonymous = t.firebase?.sign_in_provider === 'anonymous'
  // `legacyUserId` can only be set with the Admin SDK (custom claims), never by the client.
  const legacy = typeof t.legacyUserId === 'string' ? t.legacyUserId : undefined
  return {
    uid:           t.uid,
    sub:           legacy ?? t.uid,
    email:         t.email ?? '',
    emailVerified: t.email_verified ?? false,
    isAnonymous,
    provider:      'firebase',
    plan:          'free',
    full_name:     (t.name as string | undefined) ?? '',
  }
}

// ── TODO(firebase-migration): legacy Supabase fallback — delete with Supabase Auth ──
async function verifySupabaseToken(token: string): Promise<AuthUser | null> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  const { supabaseAdmin } = await import('../config/supabase')
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) return null
  return {
    uid:           data.user.id,
    sub:           data.user.id,
    email:         data.user.email ?? '',
    emailVerified: Boolean(data.user.email_confirmed_at),
    isAnonymous:   false,
    provider:      'supabase',
    plan:          (data.user.user_metadata?.plan as string)      ?? 'free',
    full_name:     (data.user.user_metadata?.full_name as string) ?? '',
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7)
  // ?token= is needed for EventSource/SSE
  return typeof req.query.token === 'string' ? req.query.token : null
}

async function authenticate(req: Request): Promise<AuthUser> {
  const token = extractToken(req)
  if (!token) throw new AppError('Missing authorization token', 401)

  // 1) Firebase — primary path
  if (isFirebaseAuthConfigured()) {
    try {
      return firebaseTokenToAuthUser(await firebaseAuth().verifyIdToken(token))
    } catch {
      /* not a valid Firebase token → try legacy below */
    }
  }
  // 2) Supabase — transitional fallback
  const legacy = await verifySupabaseToken(token).catch(() => null)
  if (legacy) return legacy

  throw new AppError('Invalid or expired token', 401)
}

/**
 * Requires a signed-in, NON-anonymous account (DJ / organiser routes).
 * Anonymous guests are rejected with 403; use `requireAnyAuth` for guest-capable routes.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await authenticate(req)
    if (user.isAnonymous) throw new AppError('Account required', 403)
    ;(req as any).user = user
    next()
  } catch (err) { next(err) }
}

/** Accepts any verified identity, including Firebase anonymous (guest / TV / remote). */
export async function requireAnyAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    ;(req as any).user = await authenticate(req)
    next()
  } catch (err) { next(err) }
}
