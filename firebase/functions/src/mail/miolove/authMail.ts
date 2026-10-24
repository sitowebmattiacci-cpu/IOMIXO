import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'
import { fail } from '../../shared/guard'
import { MailError, type MailTransport } from '../transport'
import { renderAuthMail, type AuthMailKind } from './authTemplates'
import { DEFAULT_MAIL_LOCALE, DEFAULT_MIOLOVE_BASE_URL, MIOLOVE_REPLY_TO, MIOLOVE_SENDER, parseMailLocale, type MailLocale } from './templates'

/**
 * MIOLOVE account e-mails: address verification (signed-in caller) and password reset (public caller), generated with the Admin SDK and sent with Resend.
 *
 *  - The one-time code (oobCode) is taken from the link Firebase generates and put in a link on OUR domain (`/auth/action`, the page that already consumes it). The link is
 *    never stored (no Firestore, no outbox) and never logged: it exists only in memory between "generate" and "send". Nothing here touches the Firebase Auth templates, which
 *    are project-wide and belong to IOMIXO as well.
 *  - Abuse: a server-only counter per target (`mioloveAuthMail/{key}`: only timestamps, no e-mail address) caps the sends; a rejected send is still counted.
 *  - The password reset answers the same for any address (known, unknown, not a MIOLOVE account, disabled, throttled, provider down) and takes a fixed minimum time,
 *    so neither the response nor its latency tells whether an account exists.
 */
export const AUTH_MAIL_COLLECTION = 'mioloveAuthMail'
export const VERIFY_LIMITS = { minGapMs: 60_000, maxPerHour: 5 }
export const RESET_EMAIL_LIMITS = { minGapMs: 60_000, maxPerHour: 3 }
export const RESET_IP_LIMITS = { minGapMs: 0, maxPerHour: 20 }
/**
 * Every reset e-mail that really goes out, all customers together. It protects the Resend quota (and with it the album e-mails and the verification) from someone who knows many
 * real addresses. Normal use is a handful a day; the numbers leave 10x room and keep one hour of abuse well below a free-plan day.
 */
export const RESET_GLOBAL_LIMITS = { minGapMs: 0, maxPerHour: 30, maxPerDay: 200 }
export const RESET_MIN_DURATION_MS = 1_200
const HOUR = 3_600_000, DAY = 24 * HOUR

export interface AuthPort {
  getUser(uid: string): Promise<{ email?: string | null; emailVerified: boolean; disabled?: boolean }>
  getUserByEmail(email: string): Promise<{ uid: string; email?: string | null; disabled?: boolean }>
  generateEmailVerificationLink(email: string): Promise<string>
  generatePasswordResetLink(email: string): Promise<string>
}
export interface AuthMailDeps {
  db: Firestore
  auth: AuthPort
  transport: MailTransport
  /** false when MIOLOVE_MAIL_MODE is not live / dry: nothing may be sent, and nothing falls back to the Firebase templates. */
  enabled: boolean
  allowRecipient?: (email: string) => boolean
  baseUrl?: string
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

const sha = (s: string) => createHash('sha256').update(`miolove-auth-mail:${s}`).digest('hex').slice(0, 40)
const OOB = /^[A-Za-z0-9_-]{8,256}$/

/** The one-time code of a Firebase action link (null when the link has none, which would be a provider change we must not paper over). */
export function oobCodeOf(firebaseLink: string): string | null {
  try { const c = new URL(firebaseLink).searchParams.get('oobCode'); return c && OOB.test(c) ? c : null } catch { return null }
}

/** The link the customer clicks: our domain, the existing action page, the language of the e-mail. */
export function actionLinkOf(base: string, kind: AuthMailKind, oobCode: string, locale: MailLocale): string {
  const mode = kind === 'verify_email' ? 'verifyEmail' : 'resetPassword'
  return `${base.replace(/\/+$/, '')}/auth/action?mode=${mode}&oobCode=${encodeURIComponent(oobCode)}&lang=${locale}`
}

export type Slot = 'ok' | 'too_soon' | 'too_many'
export interface SlotLimits { minGapMs: number; maxPerHour: number; maxPerDay?: number }
/** Counts one send against `key`; refuses (without counting) when the last one was too recent or the hour (or the day, when capped) is full. Atomic. */
export async function reserveSlot(db: Firestore, key: string, now: Date, lim: SlotLimits): Promise<Slot> {
  const ref = db.collection(AUTH_MAIL_COLLECTION).doc(key), t = now.getTime(), keep = lim.maxPerDay ? DAY : HOUR
  return db.runTransaction(async (tx) => {
    const hits = (((await tx.get(ref)).data()?.hits as number[] | undefined) ?? []).filter((h) => typeof h === 'number' && t - h < keep)
    if (lim.minGapMs && hits.length && t - Math.max(...hits) < lim.minGapMs) return 'too_soon' as const
    if (hits.filter((h) => t - h < HOUR).length >= lim.maxPerHour || (lim.maxPerDay !== undefined && hits.length >= lim.maxPerDay)) return 'too_many' as const
    tx.set(ref, { hits: [...hits, t], expireAt: Timestamp.fromMillis(t + keep + HOUR) })
    return 'ok' as const
  })
}

/** Gives back the slot taken by a send that failed, so a provider outage never costs the customer their resend. Best effort. */
export async function releaseSlot(db: Firestore, key: string, now: Date): Promise<void> {
  const ref = db.collection(AUTH_MAIL_COLLECTION).doc(key), t = now.getTime()
  await db.runTransaction(async (tx) => {
    const hits = ((await tx.get(ref)).data()?.hits as number[] | undefined) ?? []
    const i = hits.lastIndexOf(t)
    if (i >= 0) tx.update(ref, { hits: hits.filter((_, j) => j !== i) })
  }).catch(() => {})
}

/**
 * The caller's address for the per-IP limit. Cloud Run appends the REAL client address as the LAST X-Forwarded-For entry (earlier ones are whatever the client wrote, so they are
 * never trusted); the Express `req.ip` would be the Google proxy, the same for every customer, and one shared bucket would throttle everybody. null = unknown: no IP limit
 * is applied (the per-address limit still is) rather than a shared one.
 */
export function clientIpOf(req: { headers?: Record<string, unknown> } | undefined): string | null {
  const raw = req?.headers?.['x-forwarded-for']
  const last = (Array.isArray(raw) ? raw.join(',') : typeof raw === 'string' ? raw : '').split(',').map((x) => x.trim()).filter(Boolean).pop()
  return last && isIP(last) ? last : null
}

/**
 * The key the per-IP limit counts against. An IPv6 customer owns a whole /64 (a household can rotate through billions of addresses inside it), so the limit counts the /64;
 * an IPv4-mapped IPv6 address counts as the IPv4 it carries. Different /64s and different IPv4s never share a bucket.
 */
export function ipBucketOf(ip: string): string {
  const addr = ip.split('%')[0]
  if (isIP(addr) !== 6) return addr
  const groupsOf = (x: string | undefined): string[] => {
    if (!x) return []
    const g = x.split(':'), last = g[g.length - 1]
    if (last.includes('.')) { const [a, b, c, d] = last.split('.').map(Number); g.splice(-1, 1, ((a << 8) | b).toString(16), ((c << 8) | d).toString(16)) }       // dotted tail = 2 groups
    return g
  }
  const [head, tail] = addr.split('::'), h = groupsOf(head), t = groupsOf(tail)
  const g = (addr.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h).map((x) => x.toLowerCase().padStart(4, '0'))
  if (g.slice(0, 5).every((x) => x === '0000') && g[5] === 'ffff') {                                  // IPv4-mapped (::ffff:a.b.c.d): it IS that IPv4
    const n = (x: string) => parseInt(x, 16)
    return `${n(g[6]) >> 8}.${n(g[6]) & 255}.${n(g[7]) >> 8}.${n(g[7]) & 255}`
  }
  return `${g.slice(0, 4).join(':')}::/64`
}

const localeOf = async (db: Firestore, uid: string, asked: unknown): Promise<MailLocale> =>
  parseMailLocale(asked) ?? parseMailLocale((await db.doc(`users/${uid}`).get()).data()?.locale) ?? DEFAULT_MAIL_LOCALE
const isCouple = async (db: Firestore, uid: string) => (await db.doc(`users/${uid}`).get()).data()?.accountType === 'couple'

async function deliver(deps: AuthMailDeps, kind: AuthMailKind, to: string, firebaseLink: string, locale: MailLocale, idem: string): Promise<void> {
  const code = oobCodeOf(firebaseLink)
  if (!code) throw new MailError('no_oob_code', false, 'no_oob_code')
  const base = deps.baseUrl ?? DEFAULT_MIOLOVE_BASE_URL
  const mail = renderAuthMail({ kind, locale, link: actionLinkOf(base, kind, code, locale), baseUrl: base })
  await deps.transport.send({
    to, from: MIOLOVE_SENDER, replyTo: MIOLOVE_REPLY_TO, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: idem,
    tags: [{ name: 'brand', value: 'miolove' }, { name: 'kind', value: kind }],
  })
}

export type VerifyResult = 'sent' | 'already_verified'
/** Signed-in MIOLOVE account → verification e-mail. Errors carry `details.reason` for the client. */
export async function sendMioloveVerification(deps: AuthMailDeps, uid: string, askedLocale: unknown): Promise<{ result: VerifyResult }> {
  const now = (deps.now ?? (() => new Date()))()
  if (!deps.enabled) throw fail('failed-precondition', 'Mail disabled', 'mail_disabled')
  if (!(await isCouple(deps.db, uid))) throw fail('permission-denied', 'MIOLOVE account required', 'miolove_account_required')   // an IOMIXO account never gets a MIOLOVE e-mail
  let user: Awaited<ReturnType<AuthPort['getUser']>>
  try { user = await deps.auth.getUser(uid) } catch { throw fail('unavailable', 'Try again later', 'auth_unavailable') }
  if (user.emailVerified) return { result: 'already_verified' }
  const to = user.email?.toLowerCase()
  if (!to || user.disabled) throw fail('failed-precondition', 'No e-mail address', 'no_email')
  if (deps.allowRecipient && !deps.allowRecipient(to)) throw fail('failed-precondition', 'Recipient not allowed', 'recipient_not_allowed')
  const slot = await reserveSlot(deps.db, `v_${uid}`, now, VERIFY_LIMITS)
  if (slot !== 'ok') throw fail('resource-exhausted', 'Too many requests', slot)
  try {
    await deliver(deps, 'verify_email', to, await deps.auth.generateEmailVerificationLink(to), await localeOf(deps.db, uid, askedLocale), `verify_${uid}_${Math.floor(now.getTime() / 60_000)}`)
  } catch (e) {
    const code = e instanceof MailError ? e.code : String((e as { code?: unknown })?.code ?? 'error').slice(0, 80)
    logger.error('miolove_auth_mail_failed', { kind: 'verify_email', uid, code })
    await releaseSlot(deps.db, `v_${uid}`, now)
    throw fail('unavailable', 'Could not send the e-mail', 'send_failed')
  }
  logger.info('miolove_auth_mail', { kind: 'verify_email', uid, result: 'sent' })
  return { result: 'sent' }
}

export interface ResetInput { email: unknown; locale?: unknown; ip?: string | null }
/** Public password reset. NEVER throws and never differs in what it returns: the caller always gets the same answer (see the file header). */
export async function sendMioloveReset(deps: AuthMailDeps, input: ResetInput): Promise<{ ok: true }> {
  const started = Date.now()
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  try { await resetWork(deps, input) } catch (e) {
    logger.error('miolove_auth_mail_failed', { kind: 'reset_password', code: String((e as { code?: unknown })?.code ?? (e as Error)?.message ?? 'error').slice(0, 80) })
  }
  await sleep(Math.max(0, RESET_MIN_DURATION_MS - (Date.now() - started)))
  return { ok: true }
}

async function resetWork(deps: AuthMailDeps, input: ResetInput): Promise<void> {
  const now = (deps.now ?? (() => new Date()))()
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (!deps.enabled || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
  if (input.ip && (await reserveSlot(deps.db, `i_${sha(ipBucketOf(input.ip))}`, now, RESET_IP_LIMITS)) !== 'ok') return
  if ((await reserveSlot(deps.db, `r_${sha(email)}`, now, RESET_EMAIL_LIMITS)) !== 'ok') return        // counted for unknown addresses too: the counter does not reveal them
  let user: Awaited<ReturnType<AuthPort['getUserByEmail']>>
  try { user = await deps.auth.getUserByEmail(email) } catch (e) {
    if ((e as { code?: unknown })?.code === 'auth/user-not-found') return
    throw e
  }
  if (user.disabled || !user.email || !(await isCouple(deps.db, user.uid))) return                       // only MIOLOVE accounts: the IOMIXO reset is a different flow
  const to = user.email.toLowerCase()
  if (deps.allowRecipient && !deps.allowRecipient(to)) return
  if ((await reserveSlot(deps.db, 'g_reset', now, RESET_GLOBAL_LIMITS)) !== 'ok') { logger.warn('miolove_auth_mail_global_cap', { kind: 'reset_password' }); return }   // only real sends count: strangers cannot fill it with made-up addresses
  await deliver(deps, 'reset_password', to, await deps.auth.generatePasswordResetLink(to), await localeOf(deps.db, user.uid, input.locale), `reset_${sha(to)}_${Math.floor(now.getTime() / 60_000)}`)
  logger.info('miolove_auth_mail', { kind: 'reset_password', result: 'sent' })
}

export const parseVerifyInput = (data: unknown): { locale: unknown } => ({ locale: data && typeof data === 'object' ? (data as Record<string, unknown>).locale : undefined })
export const parseResetInput = (data: unknown): { email: unknown; locale: unknown } => {
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  return { email: d.email, locale: d.locale }
}
