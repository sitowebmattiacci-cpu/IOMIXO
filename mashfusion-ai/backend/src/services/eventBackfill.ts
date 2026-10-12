import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { parseSourceTimestamp } from '../repositories/gameRoundRepository'
import { toEventFields, type LegacySessionRow } from '../repositories/eventRepository'
import { maskId, ser, de, BackfillRefused } from './entitlementBackfill'

/**
 * Backfill of legacy Supabase `live_sessions` into Firestore events/{eventId} + eventSlugs/{slug}.
 * Library (testable on the emulator); the CLI is scripts/backfill-events.ts. It never reads Supabase: it receives rows.
 *
 *  - DRY RUN is the default; nothing is written unless `apply: true` (guards re-checked before the first write).
 *  - Owner: dj_id → Firebase uid ONLY through users/{uid}.legacySupabaseId. No email fallback exists in this tool.
 *    Unmapped owner → session skipped (reported). Ambiguous owner mapping → blocker.
 *  - Correlation: events.legacySupabaseId (same key the transitional projection uses → both can coexist; no duplicates).
 *  - Version: events.sourceUpdatedAt = Supabase updated_at (never overwritten by an older snapshot). An existing event with no
 *    sourceUpdatedAt (created by the projection) is never overwritten unless identical ("unversioned", reported).
 *  - Slug: eventSlugs/{slug} is created in the same transaction as the event; a slug already pointing elsewhere is a collision (skipped, blocker).
 *  - Fields written = exactly the projection's toEventFields + ownerUid/slug/legacySupabaseId/createdAt/sourceUpdatedAt. requestLimit /
 *    dedicationsEnabled (server bridge values) are NOT touched. screen_config / roulette_penitenze / shoe_game_questions are carried in the
 *    snapshot but not written (no Firestore schema/consumer yet).
 *  - Nothing is ever deleted by a backfill run. The rollback (explicit, separate) removes only documents this run created and only if unchanged.
 */
export interface LegacySessionSnapshotRow extends LegacySessionRow {
  dj_id: string
  updated_at?: string | null
  screen_config?: unknown
  roulette_penitenze?: unknown
  shoe_game_questions?: unknown
}
export interface EventBackfillOptions {
  apply: boolean
  projectId: string
  yesProduction?: boolean
  limit?: number
  /** Supabase users.id of the owner: restrict to that DJ's sessions. */
  legacyUserId?: string
}
export interface EventRollbackEntry { path: string; kind: 'event' | 'slug' | 'child' | 'tally' | 'vote' | 'counter'; before: unknown; after: unknown }
export interface EventBackfillReport {
  mode: 'dry-run' | 'apply'
  project: string
  sessions: { read: number; selected: number; invalid: number; duplicateLegacyId: number; duplicateSlug: number; unmappedOwner: number; ambiguousOwner: number
              slugCollision: number; ownerConflict: number; slugMismatch: number; ambiguousExisting: number }
  events: { wouldCreate: number; wouldUpdate: number; wouldRepairSlug: number; wouldNoop: number; stale: number; unversioned: number; drift: number }
  inventory: EventInventory
  blockers: string[]
  samples: Array<Record<string, unknown>>
  applied?: { written: number; skipped: number }
  rollbackEntries?: EventRollbackEntry[]
}
export interface EventInventory {
  total: number; byType: Record<string, number>; byStatus: Record<string, number>; distinctOwners: number
  duplicateIds: number; duplicateSlugs: number; invalidSlugs: number; missingRequired: number; missingUpdatedAt: number; invalidTimestamps: number
  withScreenConfig: number; withRoulette: number; withShoeQuestions: number; withGuestConfig: number
}

const SLUG_OK = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 200 && !s.includes('/') && s !== '.' && s !== '..' && !/^__.*__$/.test(s)
const versionOf = (r: LegacySessionSnapshotRow) => parseSourceTimestamp(r.updated_at ?? r.created_at)
const cmp = (a: Timestamp, b: Timestamp) => (a.seconds - b.seconds) || (a.nanoseconds - b.nanoseconds)
const required = (r: LegacySessionSnapshotRow) => Boolean(r.id && r.dj_id && r.public_slug && typeof r.event_name === 'string' && r.event_name !== '')

/** Snapshot statistics: pure (no Firestore), safe on any export. Contains no identifiers. */
export function inventoryEvents(rows: LegacySessionSnapshotRow[]): EventInventory {
  const inc = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1 }
  const inv: EventInventory = { total: rows.length, byType: {}, byStatus: {}, distinctOwners: 0, duplicateIds: 0, duplicateSlugs: 0, invalidSlugs: 0, missingRequired: 0,
    missingUpdatedAt: 0, invalidTimestamps: 0, withScreenConfig: 0, withRoulette: 0, withShoeQuestions: 0, withGuestConfig: 0 }
  const ids = new Set<string>(), slugs = new Set<string>(), owners = new Set<string>()
  for (const r of rows) {
    inc(inv.byType, String(r.session_type ?? '∅')); inc(inv.byStatus, r.is_active ? 'live' : 'ended')
    if (r.dj_id) owners.add(r.dj_id)
    if (ids.has(r.id)) inv.duplicateIds++; ids.add(r.id)
    if (slugs.has(r.public_slug)) inv.duplicateSlugs++; slugs.add(r.public_slug)
    if (!SLUG_OK(r.public_slug)) inv.invalidSlugs++
    if (!required(r)) inv.missingRequired++
    if (!r.updated_at) inv.missingUpdatedAt++
    if (!versionOf(r) || (r.created_at && !parseSourceTimestamp(r.created_at))) inv.invalidTimestamps++
    if (r.screen_config) inv.withScreenConfig++
    if (r.roulette_penitenze) inv.withRoulette++
    if (r.shoe_game_questions) inv.withShoeQuestions++
    if (r.guest_config) inv.withGuestConfig++
  }
  inv.distinctOwners = owners.size
  return inv
}

/** The fields this backfill owns on an event document (used for equality and for the rollback pre-image). */
const contentOf = (r: LegacySessionSnapshotRow) => ({ ...toEventFields(r), screenConfig: (r.screen_config ?? null) as unknown })
const sameValue = (a: unknown, b: unknown) => JSON.stringify(ser(a ?? null)) === JSON.stringify(ser(b ?? null))

type Decision = 'create' | 'update' | 'repair_slug' | 'noop' | 'stale' | 'unversioned' | 'drift'
/**
 * Fields that older runs did not write: when the stored doc LACKS the key entirely (not "has a different value"), the value is filled in
 * even at an equal version. Everything else follows the version rules; a differing existing value is never overwritten at equal/lower version.
 */
const ADDITIVE_KEYS = ['screenConfig'] as const
export function decideEvent(stored: { version: Timestamp | null; content: Record<string, unknown> } | null, incoming: { version: Timestamp; fields: Record<string, unknown> }): Decision {
  if (!stored) return 'create'
  const keys = Object.keys(incoming.fields)
  const missing = keys.filter((k) => (ADDITIVE_KEYS as readonly string[]).includes(k) && !(k in stored.content) && incoming.fields[k] != null)
  const differing = keys.filter((k) => !missing.includes(k) && !sameValue(stored.content[k], incoming.fields[k]))
  const equal = differing.length === 0
  if (!stored.version) return equal && missing.length === 0 ? 'noop' : 'unversioned'
  const c = cmp(incoming.version, stored.version)
  if (c < 0) return 'stale'
  if (c === 0) return equal ? (missing.length ? 'update' : 'noop') : 'drift'
  return equal && missing.length === 0 ? 'noop' : 'update'
}

export async function runEventBackfill(
  input: { sessions: LegacySessionSnapshotRow[] },
  opts: EventBackfillOptions,
  deps: { db: Firestore; onBeforeApply?: (preImage: Array<{ path: string; kind: 'event' | 'slug'; before: unknown }>) => Promise<void> },
): Promise<EventBackfillReport> {
  const guard = (bag: string[]) => {
    if (!opts.projectId) bag.push('project id not explicit')
    if (!(opts.projectId.startsWith('demo-') || opts.yesProduction === true)) bag.push('non-emulator project requires --yes-production')
  }
  if (opts.apply) { const early: string[] = []; guard(early); if (early.length) throw new BackfillRefused(early) }   // before any Firestore access

  const { db } = deps
  const report: EventBackfillReport = {
    mode: opts.apply ? 'apply' : 'dry-run', project: opts.projectId,
    sessions: { read: input.sessions.length, selected: 0, invalid: 0, duplicateLegacyId: 0, duplicateSlug: 0, unmappedOwner: 0, ambiguousOwner: 0, slugCollision: 0, ownerConflict: 0, slugMismatch: 0, ambiguousExisting: 0 },
    events: { wouldCreate: 0, wouldUpdate: 0, wouldRepairSlug: 0, wouldNoop: 0, stale: 0, unversioned: 0, drift: 0 },
    inventory: inventoryEvents(input.sessions), blockers: [], samples: [],
  }

  // ── selection ──
  let rows = input.sessions
  if (opts.legacyUserId) rows = rows.filter((r) => r.dj_id === opts.legacyUserId)
  if (opts.limit !== undefined) rows = rows.slice(0, opts.limit)
  report.sessions.selected = rows.length

  // ── input sanity: duplicates make the correlation unsafe → excluded AND blocking ──
  // Duplicates are detected on the full input so --limit/--legacy-user-id cannot hide a collision with an unselected row.
  const idCount = new Map<string, number>(), slugCount = new Map<string, number>()
  for (const r of input.sessions) { idCount.set(r.id, (idCount.get(r.id) ?? 0) + 1); slugCount.set(r.public_slug, (slugCount.get(r.public_slug) ?? 0) + 1) }
  const usable: LegacySessionSnapshotRow[] = []
  for (const r of rows) {
    if (!required(r) || !SLUG_OK(r.public_slug) || !versionOf(r) || (r.created_at && !parseSourceTimestamp(r.created_at))) { report.sessions.invalid++; continue }
    if ((idCount.get(r.id) ?? 0) > 1) { report.sessions.duplicateLegacyId++; continue }
    if ((slugCount.get(r.public_slug) ?? 0) > 1) { report.sessions.duplicateSlug++; continue }
    usable.push(r)
  }
  if (report.sessions.duplicateLegacyId) report.blockers.push(`${report.sessions.duplicateLegacyId} session(s) with a duplicate legacy id in the input`)
  if (report.sessions.duplicateSlug) report.blockers.push(`${report.sessions.duplicateSlug} session(s) with a duplicate slug in the input`)

  // ── owner mapping: users/{uid}.legacySupabaseId only ──
  const ownerCache = new Map<string, string | 'unmapped' | 'ambiguous'>()
  const ownerOf = async (djId: string) => {
    if (!ownerCache.has(djId)) {
      const q = await db.collection('users').where('legacySupabaseId', '==', djId).limit(2).get()
      ownerCache.set(djId, q.size === 0 ? 'unmapped' : q.size > 1 ? 'ambiguous' : q.docs[0].id)
    }
    return ownerCache.get(djId)!
  }

  const planned: Array<() => Promise<'written' | 'skipped'>> = []
  const entries: EventRollbackEntry[] = []
  const preImage: Array<{ path: string; kind: 'event' | 'slug'; before: unknown }> = []
  const events = db.collection('events'), slugs = db.collection('eventSlugs')

  for (const r of usable) {
    const owner = await ownerOf(r.dj_id)
    if (owner === 'unmapped') { report.sessions.unmappedOwner++; continue }
    if (owner === 'ambiguous') { report.sessions.ambiguousOwner++; continue }
    const fields = contentOf(r) as Record<string, unknown>
    const version = versionOf(r)!, created = parseSourceTimestamp(r.created_at)
    const ex = await events.where('legacySupabaseId', '==', r.id).limit(2).get()
    if (ex.size > 1) { report.sessions.ambiguousExisting++; continue }
    const slugSnap = await slugs.doc(r.public_slug).get()
    let decision: Decision

    if (ex.size === 1) {
      const doc = ex.docs[0], d = doc.data()
      if (d.ownerUid !== owner) { report.sessions.ownerConflict++; continue }
      if (d.slug !== r.public_slug) { report.sessions.slugMismatch++; continue }
      if (slugSnap.exists && slugSnap.data()!.eventId !== doc.id) { report.sessions.slugCollision++; continue }
      decision = decideEvent({ version: (d.sourceUpdatedAt as Timestamp | undefined) ?? null, content: d }, { version, fields })
      if (!slugSnap.exists && (decision === 'noop' || decision === 'update')) decision = decision === 'update' ? 'update' : 'repair_slug'
    } else {
      if (slugSnap.exists) { report.sessions.slugCollision++; continue }
      decision = 'create'
    }

    const bucket = ({ create: 'wouldCreate', update: 'wouldUpdate', repair_slug: 'wouldRepairSlug', noop: 'wouldNoop', stale: 'stale', unversioned: 'unversioned', drift: 'drift' } as const)[decision]
    report.events[bucket]++
    if (report.samples.length < 20) report.samples.push({ session: maskId(r.id), slug: maskId(r.public_slug), owner: maskId(owner), type: fields.type, status: fields.status, decision })
    if (decision === 'noop' || decision === 'stale' || decision === 'unversioned' || decision === 'drift') continue

    if (decision === 'create') {
      const ref = events.doc(), sref = slugs.doc(r.public_slug)
      const doc = { ownerUid: owner, legacySupabaseId: r.id, slug: r.public_slug, ...fields, createdAt: created ?? version, sourceUpdatedAt: version }
      preImage.push({ path: ref.path, kind: 'event', before: null }, { path: sref.path, kind: 'slug', before: null })
      planned.push(() => db.runTransaction(async (tx) => {
        const [again, s2] = [await tx.get(events.where('legacySupabaseId', '==', r.id).limit(1)), await tx.get(sref)]
        if (!again.empty || s2.exists) return 'skipped' as const             // raced with the projection or another run: never overwrite
        tx.create(sref, { eventId: ref.id })
        tx.create(ref, { ...doc, updatedAt: FieldValue.serverTimestamp() })
        entries.push({ path: sref.path, kind: 'slug', before: null, after: { eventId: ref.id } }, { path: ref.path, kind: 'event', before: null, after: ser(doc) })
        return 'written' as const
      }))
    } else {
      const doc = ex.docs[0], sref = slugs.doc(r.public_slug)
      const patch = { ...fields, sourceUpdatedAt: version }
      const keys = Object.keys(patch)
      const beforeOf = (d: Record<string, unknown>) => ({ ...Object.fromEntries(keys.map((k) => [k, d[k] ?? null])), updatedAt: d.updatedAt ?? null })
      if (decision === 'update') {
        preImage.push({ path: doc.ref.path, kind: 'event', before: ser(beforeOf(doc.data())) })
      }
      if (!slugSnap.exists) preImage.push({ path: sref.path, kind: 'slug', before: null })
      planned.push(() => db.runTransaction(async (tx) => {
        const cur = await tx.get(doc.ref); if (!cur.exists) return 'skipped' as const
        const c = cur.data()!, s2 = await tx.get(sref)
        if (s2.exists && s2.data()!.eventId !== doc.id) return 'skipped' as const
        let wrote = false
        if (decision === 'update') {
          const d2 = decideEvent({ version: (c.sourceUpdatedAt as Timestamp | undefined) ?? null, content: c }, { version, fields })
          if (d2 === 'update') {
            tx.update(doc.ref, { ...patch, updatedAt: FieldValue.serverTimestamp() })
            entries.push({ path: doc.ref.path, kind: 'event', before: ser(beforeOf(c)), after: ser(patch) }); wrote = true
          }
        }
        if (!s2.exists) { tx.create(sref, { eventId: doc.id }); entries.push({ path: sref.path, kind: 'slug', before: null, after: { eventId: doc.id } }); wrote = true }
        return wrote ? 'written' as const : 'skipped' as const
      }))
    }
  }

  // blockers that make an apply unsafe
  const s = report.sessions
  if (s.ambiguousOwner) report.blockers.push(`${s.ambiguousOwner} session(s) with an ambiguous owner mapping`)
  if (s.ownerConflict) report.blockers.push(`${s.ownerConflict} existing event(s) belong to a different owner`)
  if (s.slugCollision) report.blockers.push(`${s.slugCollision} slug collision(s) with events of another legacy id`)
  if (s.slugMismatch) report.blockers.push(`${s.slugMismatch} existing event(s) have a different slug`)
  if (s.ambiguousExisting) report.blockers.push(`${s.ambiguousExisting} legacy id(s) match more than one event`)

  if (opts.apply) {
    const reasons = [...report.blockers]; guard(reasons)
    if (reasons.length) throw new BackfillRefused(reasons)
    await deps.onBeforeApply?.(preImage)           // the rollback file exists on disk before the first write
    let written = 0, skipped = 0
    for (const w of planned) { (await w()) === 'written' ? written++ : skipped++ }
    report.applied = { written, skipped }; report.rollbackEntries = entries
  }
  return report
}

// ── rollback: removes/restores ONLY what this backfill wrote, and only if unchanged since; never touches events with children ──
export interface EventRollbackResult { restored: number; deleted: number; skippedChanged: number; skippedHasChildren: number }
export async function runEventRollback(db: Firestore, file: { entries: EventRollbackEntry[] }, opts: { apply: boolean; projectId: string; yesProduction?: boolean }): Promise<EventRollbackResult> {
  if (opts.apply && !(opts.projectId.startsWith('demo-') || opts.yesProduction === true)) throw new BackfillRefused(['non-emulator project requires --yes-production'])
  const out: EventRollbackResult = { restored: 0, deleted: 0, skippedChanged: 0, skippedHasChildren: 0 }
  const same = (a: unknown, b: unknown) => JSON.stringify(ser(a)) === JSON.stringify(ser(b))
  const kept = new Map<string, 'skippedChanged' | 'skippedHasChildren'>()      // events that stay → their slug mapping must stay too
  for (const e of [...file.entries].reverse()) {                               // slug docs were recorded first → event doc handled first
    const ref = db.doc(e.path)
    const keptBy = e.kind === 'slug' ? kept.get((e.after as { eventId?: string })?.eventId ?? '') : undefined
    if (keptBy) { out[keptBy]++; continue }
    const hasChildren = e.before === null ? (await ref.listCollections()).length > 0 : false
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref), cur = snap.exists ? snap.data()! : null
      const after = de(e.after as never) as Record<string, unknown>
      if (!cur || !Object.keys(after).every((k) => same(cur[k], after[k]))) { out.skippedChanged++; if (e.kind === 'event') kept.set(ref.id, 'skippedChanged'); return }
      if (hasChildren) { out.skippedHasChildren++; kept.set(ref.id, 'skippedHasChildren'); return }
      if (!opts.apply) { e.before === null ? out.deleted++ : out.restored++; return }
      if (e.before === null) { tx.delete(ref); out.deleted++; return }
      const b = de(e.before as never) as Record<string, unknown>
      tx.update(ref, Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v === null && k === 'sourceUpdatedAt' ? FieldValue.delete() : v])))
      out.restored++
    })
  }
  return out
}

// ── game customisation: live_sessions.roulette_penitenze / shoe_game_questions → events/{id}/private/gameConfig (owner-private) ──
export interface GameConfigBackfillReport {
  mode: 'dry-run' | 'apply'; project: string
  sessions: { read: number; withCustomConfig: number; noEvent: number; ambiguousEvent: number; invalid: number }
  config: { wouldCreate: number; wouldFill: number; wouldNoop: number; keptExisting: number }
  blockers: string[]
  applied?: { written: number; skipped: number }
  /** Documents created / fields added, for a manual rollback (delete the listed fields). */
  entries?: Array<{ path: string; fieldsAdded: string[]; created: boolean }>
}
const PEN_CATEGORIES = ['soft', 'party', 'wild']
const cleanPen = (raw: unknown) => Array.isArray(raw) && raw.length > 0 && raw.length <= 60 && raw.every((p: any) => p && typeof p.label === 'string' && p.label.trim() && PEN_CATEGORIES.includes(p.category))
  ? (raw as any[]).map((p) => ({ label: String(p.label).trim().slice(0, 120), category: p.category as string, enabled: p.enabled !== false })) : null
const cleanQs = (raw: unknown) => Array.isArray(raw) && raw.length > 0 && raw.length <= 60
  ? (raw as unknown[]).map((q) => String(q).trim().slice(0, 200)).filter(Boolean) : null

/**
 * ADDITIVE and idempotent: creates events/{id}/private/gameConfig (or fills a MISSING field) from the legacy columns; an existing different value is
 * never overwritten (it was edited in Firestore after the cutover). Same guards as the events backfill (dry-run default; apply needs a demo project or
 * --yes-production). Events are matched by legacySupabaseId; sessions without an event are reported (run the events backfill first).
 */
export async function runGameConfigBackfill(
  input: { sessions: LegacySessionSnapshotRow[] }, opts: { apply: boolean; projectId: string; yesProduction?: boolean }, deps: { db: Firestore },
): Promise<GameConfigBackfillReport> {
  if (opts.apply && !(opts.projectId.startsWith('demo-') || opts.yesProduction === true)) throw new BackfillRefused(['non-emulator project requires --yes-production'])
  const { db } = deps
  const report: GameConfigBackfillReport = {
    mode: opts.apply ? 'apply' : 'dry-run', project: opts.projectId, blockers: [],
    sessions: { read: input.sessions.length, withCustomConfig: 0, noEvent: 0, ambiguousEvent: 0, invalid: 0 },
    config: { wouldCreate: 0, wouldFill: 0, wouldNoop: 0, keptExisting: 0 },
  }
  const planned: Array<() => Promise<'written' | 'skipped'>> = [], entries: NonNullable<GameConfigBackfillReport['entries']> = []
  for (const r of input.sessions) {
    if (r.roulette_penitenze == null && r.shoe_game_questions == null) continue
    const fields: Record<string, unknown> = {}
    const pen = r.roulette_penitenze == null ? undefined : cleanPen(r.roulette_penitenze), qs = r.shoe_game_questions == null ? undefined : cleanQs(r.shoe_game_questions)
    if ((r.roulette_penitenze != null && !pen) || (r.shoe_game_questions != null && !qs)) { report.sessions.invalid++ }
    if (pen) fields.roulettePenitenze = pen
    if (qs) fields.shoeGameQuestions = qs
    if (!Object.keys(fields).length) continue
    report.sessions.withCustomConfig++
    const ev = await db.collection('events').where('legacySupabaseId', '==', r.id).limit(2).get()
    if (ev.size === 0) { report.sessions.noEvent++; continue }
    if (ev.size > 1) { report.sessions.ambiguousEvent++; continue }
    const ref = ev.docs[0].ref.collection('private').doc('gameConfig')
    const cur = await ref.get(), stored = cur.exists ? cur.data()! : {}
    const missing = Object.keys(fields).filter((k) => !(k in stored))
    if (Object.keys(fields).some((k) => k in stored && !sameValue(stored[k], fields[k]))) report.config.keptExisting++
    if (!missing.length) { report.config.wouldNoop++; continue }
    cur.exists ? report.config.wouldFill++ : report.config.wouldCreate++
    planned.push(() => db.runTransaction(async (tx) => {
      const s2 = await tx.get(ref), c = s2.exists ? s2.data()! : {}
      const add = Object.fromEntries(missing.filter((k) => !(k in c)).map((k) => [k, fields[k]]))
      if (!Object.keys(add).length) return 'skipped' as const
      tx.set(ref, { ...add, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      entries.push({ path: ref.path, fieldsAdded: Object.keys(add), created: !s2.exists })
      return 'written' as const
    }))
  }
  if (opts.apply) {
    let written = 0, skipped = 0
    for (const w of planned) { (await w()) === 'written' ? written++ : skipped++ }
    report.applied = { written, skipped }; report.entries = entries
  }
  return report
}
