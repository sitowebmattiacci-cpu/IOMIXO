import crypto from 'crypto'
import type { Request } from 'express'

const SALT = process.env.IP_HASH_SALT ?? 'iomixo-live-hub-default-salt'

/** Best-effort client IP extraction; respects X-Forwarded-For when present. */
function clientIp(req: Request): string {
  const xff = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
  return xff || req.ip || req.socket?.remoteAddress || 'unknown'
}

/** Stable, anonymised hash of (ip + UA + salt). Used for anti-spam rate-limit only. */
export function hashClient(req: Request): string {
  const ip = clientIp(req)
  const ua = (req.headers['user-agent'] as string | undefined) ?? ''
  return crypto.createHash('sha256').update(`${SALT}|${ip}|${ua}`).digest('hex')
}

// ── In-memory rate limit per (key, hash). 20s default window. ───────────────
// TODO: move to Redis if traffic grows past a single Node instance.
const buckets = new Map<string, number>()

export function rateLimitOk(key: string, hash: string, windowMs = 20_000): boolean {
  const k = `${key}:${hash}`
  const now = Date.now()
  const last = buckets.get(k) ?? 0
  if (now - last < windowMs) return false
  buckets.set(k, now)
  // Opportunistic cleanup
  if (buckets.size > 5000) {
    for (const [bk, ts] of buckets) if (now - ts > windowMs * 4) buckets.delete(bk)
  }
  return true
}
