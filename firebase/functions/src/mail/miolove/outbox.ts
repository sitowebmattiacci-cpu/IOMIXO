import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'
import { eventBrandOf } from '../../owner/brand'
import { trialExpiresAt } from '../../photos/trialQuota'
import { MailError, type MailTransport } from '../transport'
import { DEFAULT_MAIL_LOCALE, DEFAULT_MIOLOVE_BASE_URL, MAIL_KINDS, MIOLOVE_REPLY_TO, MIOLOVE_SENDER, parseMailLocale, renderMiolovaMail, type MailKind, type MailVars } from './templates'

/**
 * MIOLOVE e-mail outbox. Every e-mail is ONE document `mioloveMailOutbox/{kind}_{eventId}` (server-only: firestore.rules deny every client).
 *
 *  - Idempotent: the document id IS the e-mail. Queuing twice (a webhook replay, two scheduler runs, a retried function) creates it once; a `sent` one is never sent again.
 *  - Reliable: sending is claimed with a lease (a crashed worker's claim expires and is retried), failures back off (5 min → 15 min → 1 h → 6 h → 24 h, 6 attempts) and the
 *    provider gets the document id as Idempotency-Key, so a crash between "delivered" and "marked sent" cannot produce a duplicate.
 *  - Never blocks the business flow: callers use enqueueMioloveMailSafe (errors are logged, never thrown). The checkout / activation / purge are unaffected by the mail.
 *  - Per album: the key carries the event id and the text carries that album's title and dates. Two albums = two independent e-mails.
 *  - Fresh at send time: the album is re-read and an e-mail that no longer applies (trial paid meanwhile, album deleted by the owner...) is dropped as `skipped`.
 * No e-mail address is stored: it is read from Firebase Auth when sending. The language is users/{uid}.locale (it when unknown).
 */
export const OUTBOX = 'mioloveMailOutbox'
export const LEASE_MS = 5 * 60_000
export const MAX_ATTEMPTS = 6
/** An e-mail whose recipient is not (yet) allowed to receive mail is left untouched and looked at again after this long. */
export const HOLD_MS = 60 * 60_000
export const BACKOFF_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 3_600_000, 24 * 3_600_000]
const DAY = 86_400_000
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'skipped' | 'failed'
export const outboxKey = (kind: MailKind, eventId: string) => `${kind}_${eventId}`

const ms = (v: unknown): number | undefined => (v instanceof Timestamp ? v.toMillis() : undefined)
const cleanTitle = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120) : '') || 'MIOLOVE Album'

/** The dates / title the e-mail will talk about, frozen when it is queued. */
export function varsOfAlbum(ev: DocumentData): MailVars {
  const v: MailVars = { title: cleanTitle(ev.title) }
  const t = ms(ev.trialExpiresAt), e = ms(ev.expiresAt), p = ms(ev.purgeAfter)
  if (t !== undefined) v.trialEndsAtMs = t
  if (e !== undefined) v.expiresAtMs = e
  if (p !== undefined) v.purgeAtMs = p
  return v
}

export interface EnqueueInput { kind: MailKind; eventId: string; ownerUid: string; vars: MailVars; now?: Date }
/** 'queued' = created now, 'exists' = it was already queued / sent (nothing changes). */
export async function enqueueMioloveMail(db: Firestore, i: EnqueueInput): Promise<'queued' | 'exists'> {
  if (!SAFE_ID.test(i.eventId) || !i.ownerUid || !(MAIL_KINDS as readonly string[]).includes(i.kind)) throw new Error('invalid_mail_input')
  const now = i.now ?? new Date()
  try {
    await db.collection(OUTBOX).doc(outboxKey(i.kind, i.eventId)).create({
      kind: i.kind, eventId: i.eventId, ownerUid: i.ownerUid, vars: i.vars, status: 'pending', attempts: 0,
      nextAttemptAt: Timestamp.fromDate(now), createdAt: Timestamp.fromDate(now),
    })
    return 'queued'
  } catch (e) {
    if ((e as { code?: number }).code === 6) return 'exists'                                                    // ALREADY_EXISTS
    throw e
  }
}

/** Queue an e-mail about an album read from Firestore (MIOLOVE albums only). Used by the webhook / createEvent; `ev` may be passed when the doc is already known. */
export async function enqueueMioloveMailSafe(db: Firestore, kind: MailKind, eventId: string, opts: { ev?: DocumentData; now?: Date } = {}): Promise<'queued' | 'exists' | 'ignored' | 'error'> {
  try {
    const ev = opts.ev ?? (await db.doc(`events/${eventId}`).get()).data()
    if (!ev || typeof ev.ownerUid !== 'string' || (await eventBrandOf(db, ev)) !== 'miolove') return 'ignored'      // an IOMIXO event never gets a MIOLOVE e-mail
    return await enqueueMioloveMail(db, { kind, eventId, ownerUid: ev.ownerUid, vars: varsOfAlbum(ev), now: opts.now })
  } catch (e) {
    logger.error('miolove_mail_enqueue_failed', { kind, eventId, code: String((e as { code?: unknown })?.code ?? (e as Error)?.message ?? 'error').slice(0, 80) })
    return 'error'
  }
}

/** Does this e-mail still apply to the album as it is now? null = yes, otherwise the reason it is dropped. */
export function skipReason(kind: MailKind, ev: DocumentData | undefined, now: Date): string | null {
  if (kind === 'album_deleted' || kind === 'trial_deleted') return null                    // about a deletion that already happened: the tombstone is all there is
  if (!ev || ev.deletedAt) return 'album_gone'
  const mode = ev.accessMode, t = trialExpiresAt(ev)?.getTime(), e = ev.expiresAt instanceof Timestamp ? ev.expiresAt.toMillis() : undefined
  switch (kind) {
    case 'trial_started': return mode === 'trial' || mode === 'activated' ? null : 'state_changed'
    case 'trial_ending': return mode === 'trial' && (t === undefined || t > now.getTime()) ? null : 'state_changed'
    case 'trial_ended': case 'trial_purge_soon': return mode === 'trial' ? null : 'state_changed'
    case 'album_activated': return mode === 'activated' ? null : 'state_changed'
    default: return mode === 'activated' && (e === undefined || e > now.getTime()) ? null : 'state_changed'          // album_expiry_30 / 7 / 1
  }
}

export interface OutboxDeps {
  db: Firestore
  transport: MailTransport
  /** The account's e-mail address (Firebase Auth), or null. */
  resolveRecipient: (uid: string) => Promise<string | null>
  /** Staging filter (MIOLOVE_MAIL_ALLOWLIST). A recipient it refuses is HELD: the e-mail stays queued exactly as it was (not sent, not skipped, no attempt used) until the filter lets it through. */
  allowRecipient?: (email: string) => boolean
  baseUrl?: string
  now?: () => Date
}
export type ItemResult = 'sent' | 'skipped' | 'retry' | 'failed' | 'busy' | 'held' | 'noop'

/** Sends ONE queued e-mail. Safe to call concurrently / repeatedly for the same key: only one caller wins the claim, a finished e-mail is a no-op. */
export async function processOutboxItem(deps: OutboxDeps, key: string): Promise<ItemResult> {
  const now = (deps.now ?? (() => new Date()))()
  const ref = deps.db.collection(OUTBOX).doc(key)
  const claimed = await deps.db.runTransaction(async (tx) => {
    const s = await tx.get(ref), d = s.data()
    if (!s.exists || (d!.status !== 'pending' && d!.status !== 'sending')) return 'noop' as const
    if (!(d!.nextAttemptAt instanceof Timestamp) || d!.nextAttemptAt.toMillis() > now.getTime()) return d!.status === 'sending' ? ('busy' as const) : ('noop' as const)
    tx.update(ref, { status: 'sending', attempts: (d!.attempts ?? 0) + 1, nextAttemptAt: Timestamp.fromMillis(now.getTime() + LEASE_MS) })   // the lease: until then nobody else sends it
    return { ...d!, attempts: (d!.attempts ?? 0) + 1 }
  })
  if (typeof claimed === 'string') return claimed
  const item = claimed as DocumentData, kind = item.kind as MailKind
  const done = (status: 'sent' | 'skipped' | 'failed', extra: Record<string, unknown> = {}) =>
    ref.update({ status, nextAttemptAt: FieldValue.delete(), finishedAt: Timestamp.fromDate(now), lastError: FieldValue.delete(), heldReason: FieldValue.delete(), ...extra })

  try {
    const ev = (await deps.db.doc(`events/${item.eventId}`).get()).data()
    const to = await deps.resolveRecipient(item.ownerUid)
    if (to && deps.allowRecipient && !deps.allowRecipient(to)) {                          // checked FIRST: a held e-mail must not be dropped / consumed while the filter is on
      await ref.update({ status: 'pending', attempts: item.attempts - 1, nextAttemptAt: Timestamp.fromMillis(now.getTime() + HOLD_MS), heldReason: 'recipient_not_allowed' })
      return 'held'
    }
    const why = skipReason(kind, ev, now)
    if (why) { await done('skipped', { skipReason: why }); return 'skipped' }
    if (!to) { await done('skipped', { skipReason: 'no_email' }); return 'skipped' }
    const userSnap = await deps.db.doc(`users/${item.ownerUid}`).get()
    const locale = parseMailLocale(userSnap.data()?.locale) ?? DEFAULT_MAIL_LOCALE
    const mail = renderMiolovaMail({ kind, locale, vars: item.vars as MailVars, eventId: item.eventId, baseUrl: deps.baseUrl ?? DEFAULT_MIOLOVE_BASE_URL })
    const sent = await deps.transport.send({
      to, from: MIOLOVE_SENDER, replyTo: MIOLOVE_REPLY_TO, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: key,
      tags: [{ name: 'brand', value: 'miolove' }, { name: 'kind', value: kind }],
    })
    await done('sent', { providerId: sent.id ?? null, locale, sentAt: Timestamp.fromDate(now) })
    return 'sent'
  } catch (e) {
    const code = e instanceof MailError ? e.code : String((e as { code?: unknown })?.code ?? (e as Error)?.message ?? 'error').slice(0, 80)
    const retryable = e instanceof MailError ? e.retryable : true                                       // an unexpected error (Firestore, Auth) is worth another try
    if (!retryable || item.attempts >= MAX_ATTEMPTS) {
      logger.error('miolove_mail_failed', { key, code, attempts: item.attempts })
      await done('failed', { lastError: code }).catch(() => {})
      return 'failed'
    }
    const wait = BACKOFF_MS[Math.min(item.attempts - 1, BACKOFF_MS.length - 1)]
    logger.warn('miolove_mail_retry', { key, code, attempts: item.attempts, inMs: wait })
    await ref.update({ status: 'pending', nextAttemptAt: Timestamp.fromMillis(now.getTime() + wait), lastError: code }).catch(() => {})
    return 'retry'
  }
}

export interface DrainSummary { scanned: number; sent: number; skipped: number; retry: number; failed: number; busy: number; held: number }
/** One pass over everything due (new e-mails, retries, expired leases). Called by the scheduler; the Firestore trigger sends a new one at once. */
export async function drainOutbox(deps: OutboxDeps, limit = 100): Promise<DrainSummary> {
  const now = (deps.now ?? (() => new Date()))()
  const sum: DrainSummary = { scanned: 0, sent: 0, skipped: 0, retry: 0, failed: 0, busy: 0, held: 0 }
  const due = await deps.db.collection(OUTBOX).where('nextAttemptAt', '<=', Timestamp.fromDate(now)).orderBy('nextAttemptAt').limit(limit).get()
  for (const d of due.docs) {
    sum.scanned++
    const r = await processOutboxItem(deps, d.id)
    if (r === 'sent' || r === 'skipped' || r === 'retry' || r === 'failed' || r === 'busy' || r === 'held') sum[r]++
  }
  return sum
}

// ── Scheduled triggers ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const REMINDERS = [{ days: 1, kind: 'album_expiry_1', stamp: 'd1' }, { days: 7, kind: 'album_expiry_7', stamp: 'd7' }, { days: 30, kind: 'album_expiry_30', stamp: 'd30' }] as const

/** Which e-mail an album is due for RIGHT NOW (or null). Pure. A paid album: 30 / 7 / 1 days before expiresAt. A trial: 2 days before its end, when it ends, and 7 days before the deletion. */
export function dueMailKind(ev: DocumentData, now: Date): { kind: MailKind; stamp?: string } | null {
  const t = now.getTime()
  if (ev.deletedAt || ev.purgedAt) return null
  if (ev.accessMode === 'activated') {
    const end = ev.expiresAt instanceof Timestamp ? ev.expiresAt.toMillis() : NaN
    if (!(end > t)) return null
    const r = REMINDERS.find((x) => end - t <= x.days * DAY)
    return r ? { kind: r.kind, stamp: r.stamp } : null
  }
  if (ev.accessMode === 'trial') {
    const end = trialExpiresAt(ev)?.getTime(), purge = ev.purgeAfter instanceof Timestamp ? ev.purgeAfter.toMillis() : NaN
    if (end === undefined) return null                                                     // an older trial without an end date never lapses: nothing to announce
    if (t < end) return end - t <= 2 * DAY ? { kind: 'trial_ending' } : null
    if (!(purge > t)) return null
    return purge - t <= 7 * DAY ? { kind: 'trial_purge_soon' } : { kind: 'trial_ended' }
  }
  return null
}

export interface ScanSummary { scanned: number; queued: number; existing: number }
/** Daily: queues the due e-mail of every MIOLOVE album about to change state. One range query on `purgeAfter` (set on every trial / paid album); idempotent, so a rerun queues nothing new. */
export async function scanMailTriggers(db: Firestore, now: Date = new Date(), opts: { pageSize?: number; maxAlbums?: number } = {}): Promise<ScanSummary> {
  const pageSize = opts.pageSize ?? 200, maxAlbums = opts.maxAlbums ?? 5000
  const sum: ScanSummary = { scanned: 0, queued: 0, existing: 0 }
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null
  while (sum.scanned < maxAlbums) {
    let q = db.collection('events').where('purgeAfter', '>', Timestamp.fromDate(now)).where('purgeAfter', '<=', Timestamp.fromMillis(now.getTime() + 33 * DAY)).orderBy('purgeAfter')
    if (cursor) q = q.startAfter(cursor)
    const page = await q.limit(pageSize).get()
    if (page.empty) break
    for (const d of page.docs) {
      sum.scanned++
      const ev = d.data(), due = dueMailKind(ev, now)
      if (!due) continue
      const r = await enqueueMioloveMailSafe(db, due.kind, d.id, { ev, now })
      if (r === 'queued') {
        sum.queued++
        if (due.stamp) await d.ref.update({ [`retention.reminders.${due.stamp}`]: Timestamp.fromDate(now) }).catch(() => {})    // the data model the activation writes: one stamp per reminder
      } else if (r === 'exists') sum.existing++
    }
    cursor = page.docs[page.docs.length - 1]
    if (page.size < pageSize) break
  }
  return sum
}
