import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { normalizePlan, type PlanTier } from '../config/plans'
import { parseSourceTimestamp } from '../repositories/gameRoundRepository'
import { passFields, passContentEqual, passKey, type LegacyEventPassRow } from '../repositories/entitlementRepository'
import { decidePass, decidePlan, type PassStatus } from '../repositories/entitlementPolicy'

/**
 * Backfill of legacy plans + Event Passes into Firestore (users/{uid}.plan, users/{uid}/eventPasses/{key}).
 * Library (testable on the emulator); the CLI is scripts/backfill-entitlements.ts. It never reads Supabase itself: it receives rows.
 *
 *  - DRY RUN is the default. Nothing can be written unless `apply: true` (the writer checks it again).
 *  - Identity: Supabase user id → Firebase uid ONLY through users/{uid}.legacySupabaseId (never creates users). Optional, explicit
 *    `emailFallback`: exactly one Firestore user with that email AND a verified Firebase Auth email. Otherwise UNMAPPED / AMBIGUOUS.
 *  - Order of writes per account: passes FIRST, plan LAST. The plan write is what flips an account to "Firestore entitlements are
 *    final" (plan.source 'legacy', see functions/src/entitlements/source.ts); doing it last means the account never switches before
 *    its passes are in place.
 *  - Pass key = stripe_payment_intent_id (UNIQUE in legacy; the checkout-session id for 0€ checkouts) else legacy-<id>. Scoped passes keep
 *    `legacySessionId` and `eventId: null` (events are not in Firestore yet; the resolver matches legacySessionId ↔ event.legacySupabaseId).
 *  - Ordering/overwrite rules: entitlementPolicy.ts (stripe-sourced plans never touched, no pass resurrection, hand-set plans not downgraded).
 *  - Every touched document is recorded (before/after) for a precise rollback.
 */
export interface LegacyUserRow { id: string; email?: string | null; plan?: string | null; stripe_customer_id?: string | null; created_at?: string | null; updated_at?: string | null }
export interface BackfillOptions {
  apply: boolean
  projectId: string
  /** Required with --apply on any project that is not an emulator (demo-*) project. */
  yesProduction?: boolean
  emailFallback?: boolean
  limit?: number
  userEmail?: string
  legacyUserId?: string
  allowUnversionedDowngrade?: boolean
}
export interface Report {
  mode: 'dry-run' | 'apply'
  project: string
  users: { read: number; selected: number; mapped: number; mappedByEmail: number; unmapped: number; ambiguous: number; skipped: number; duplicates: number }
  plans: { wouldUpdate: number; wouldNoop: number; stale: number; protectedStripe: number; protectedDowngrade: number }
  passes: { read: number; global: number; scoped: number; wouldCreate: number; wouldUpdate: number; wouldNoop: number; stale: number
            duplicatesCollapsed: number; orphan: number; invalid: number; byStatus: Record<string, number> }
  inventory: Inventory
  blockers: string[]
  samples: Array<Record<string, unknown>>
  applied?: { written: number; skipped: number }
  rollbackEntries?: RollbackEntry[]
}
export interface RollbackEntry { path: string; kind: 'plan' | 'pass'; before: unknown; after: unknown }
/** Snapshot statistics: pure (no Firestore), safe to compute on any export. Contains no identifiers. */
export interface Inventory {
  users: { total: number; planRaw: Record<string, number>; planNormalized: Record<string, number>; unknownPlanValues: number; noEmail: number; duplicateIds: number; duplicateEmails: number
           missingUpdatedAt: number; invalidTimestamps: number; withStripeCustomer: number }
  passes: { total: number; byStatus: Record<string, number>; unknownStatus: number; global: number; scoped: number; activeButPastValidUntil: number; missingUpdatedAt: number
            invalidTimestamps: number; withoutPaymentKey: number; zeroEuro: number; duplicateKeysSameUser: number; keyCollisionsAcrossUsers: number
            usersWithPasses: number; usersWithMultiplePasses: number; maxPassesPerUser: number; orphanPasses: number }
}
export function inventorySnapshot(users: LegacyUserRow[], passes: LegacyEventPassRow[], now: Date = new Date()): Inventory {
  const inc = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1 }
  const iu: Inventory['users'] = { total: users.length, planRaw: {}, planNormalized: {}, unknownPlanValues: 0, noEmail: 0, duplicateIds: 0, duplicateEmails: 0, missingUpdatedAt: 0, invalidTimestamps: 0, withStripeCustomer: 0 }
  const ids = new Set<string>(), emails = new Set<string>(), known = ['free', 'pro', 'wedding', 'advance', 'pro_plus', 'premium_wedding', 'wedding_edition_plan', 'club', 'studio']
  for (const u of users) {
    inc(iu.planRaw, String(u.plan ?? '∅')); inc(iu.planNormalized, normalizePlan(u.plan))
    if (!known.includes(String(u.plan))) iu.unknownPlanValues++
    const em = (u.email ?? '').toLowerCase(); if (!em) iu.noEmail++; else { if (emails.has(em)) iu.duplicateEmails++; emails.add(em) }
    if (ids.has(u.id)) iu.duplicateIds++; ids.add(u.id)
    if (!u.updated_at) iu.missingUpdatedAt++
    if (!parseSourceTimestamp(u.updated_at ?? u.created_at) || (u.created_at && !parseSourceTimestamp(u.created_at))) iu.invalidTimestamps++
    if (u.stripe_customer_id) iu.withStripeCustomer++
  }
  const ip: Inventory['passes'] = { total: passes.length, byStatus: {}, unknownStatus: 0, global: 0, scoped: 0, activeButPastValidUntil: 0, missingUpdatedAt: 0, invalidTimestamps: 0, withoutPaymentKey: 0, zeroEuro: 0,
    duplicateKeysSameUser: 0, keyCollisionsAcrossUsers: 0, usersWithPasses: 0, usersWithMultiplePasses: 0, maxPassesPerUser: 0, orphanPasses: 0 }
  const perUser = new Map<string, number>(), keyOwner = new Map<string, string>(), seenKey = new Set<string>()
  for (const p of passes) {
    inc(ip.byStatus, String(p.status ?? '∅')); if (!['active', 'expired', 'refunded'].includes(String(p.status))) ip.unknownStatus++
    p.session_id ? ip.scoped++ : ip.global++
    const until = parseSourceTimestamp(p.valid_until)
    if (p.status === 'active' && until && until.toMillis() < now.getTime()) ip.activeButPastValidUntil++
    if (!p.updated_at) ip.missingUpdatedAt++
    if (!until || !parseSourceTimestamp(p.created_at)) ip.invalidTimestamps++
    if (!p.stripe_payment_intent_id) ip.withoutPaymentKey++
    if ((p.amount_cents ?? 0) === 0) ip.zeroEuro++
    const key = passKey(p), uk = `${p.user_id}|${key}`
    if (seenKey.has(uk)) ip.duplicateKeysSameUser++; seenKey.add(uk)
    if (keyOwner.has(key) && keyOwner.get(key) !== p.user_id) ip.keyCollisionsAcrossUsers++
    keyOwner.set(key, p.user_id)
    perUser.set(p.user_id, (perUser.get(p.user_id) ?? 0) + 1)
    if (!ids.has(p.user_id)) ip.orphanPasses++
  }
  perUser.forEach((c) => { ip.usersWithPasses++; if (c > 1) ip.usersWithMultiplePasses++; ip.maxPassesPerUser = Math.max(ip.maxPassesPerUser, c) })
  return { users: iu, passes: ip }
}

export class BackfillRefused extends Error { constructor(public reasons: string[]) { super('backfill refused: ' + reasons.join('; ')) } }

// ── masking (reports must not leak identifiers) ──
export const maskId = (v: string | null | undefined) => (!v ? '-' : v.length <= 10 ? `${v.slice(0, 2)}…` : `${v.slice(0, 4)}…${v.slice(-4)}`)
export const maskEmail = (v: string | null | undefined) => { if (!v || !v.includes('@')) return '-'; const [a, d] = v.split('@'); return `${a[0]}***@${d[0]}***${d.slice(d.lastIndexOf('.'))}` }
export const maskStripe = (v: string | null | undefined) => (!v ? '-' : `${v.slice(0, 3)}${v.startsWith('pi_') || v.startsWith('cs_') ? '' : '…'}…${v.slice(-4)}`)

// ── Timestamp (de)serialisation for the rollback file ──
type Ser = { _ts: [number, number] } | string | number | boolean | null | Ser[] | { [k: string]: Ser }
export function ser(v: unknown): Ser {
  if (v instanceof Timestamp) return { _ts: [v.seconds, v.nanoseconds] }
  if (Array.isArray(v)) return v.map(ser)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as object).filter(([, x]) => x !== undefined && !(x && typeof x === 'object' && (x as { constructor?: { name?: string } }).constructor?.name === 'ServerTimestampTransform')).map(([k, x]) => [k, ser(x)]))
  return (v ?? null) as Ser
}
export function de(v: Ser): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && '_ts' in v) { const [s, n] = (v as { _ts: [number, number] })._ts; return new Timestamp(s, n) }
  if (Array.isArray(v)) return v.map(de)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, de(x as Ser)]))
  return v
}

const CHECK = (cond: unknown, msg: string, bag: string[]) => { if (!cond) bag.push(msg) }

interface Resolved { legacyId: string; uid: string; via: 'legacy_id' | 'email'; user: LegacyUserRow }

async function mapUsers(db: Firestore, users: LegacyUserRow[], opts: BackfillOptions, auth?: { getUser(uid: string): Promise<{ emailVerified: boolean }> }) {
  const mapped: Resolved[] = []; let unmapped = 0, ambiguous = 0
  for (const u of users) {
    const q = await db.collection('users').where('legacySupabaseId', '==', u.id).limit(2).get()
    if (q.size > 1) { ambiguous++; continue }
    if (q.size === 1) { mapped.push({ legacyId: u.id, uid: q.docs[0].id, via: 'legacy_id', user: u }); continue }
    if (opts.emailFallback && u.email) {
      const e = await db.collection('users').where('email', '==', u.email).limit(2).get()
      if (e.size > 1) { ambiguous++; continue }
      if (e.size === 1 && auth && (await auth.getUser(e.docs[0].id).catch(() => null))?.emailVerified === true) { mapped.push({ legacyId: u.id, uid: e.docs[0].id, via: 'email', user: u }); continue }
    }
    unmapped++
  }
  return { mapped, unmapped, ambiguous }
}

export async function runBackfill(
  input: { users: LegacyUserRow[]; passes: LegacyEventPassRow[] },
  opts: BackfillOptions,
  deps: { db: Firestore; auth?: { getUser(uid: string): Promise<{ emailVerified: boolean }> };
          /** Called after the guards pass and BEFORE the first write, with the pre-image of every document that is about to change (persist it!). */
          onBeforeApply?: (preImage: Array<{ path: string; kind: 'plan' | 'pass'; before: unknown }>) => Promise<void> },
): Promise<Report> {
  // Guards that need no data run FIRST, before any Firestore access.
  if (opts.apply) {
    const early: string[] = []
    CHECK(opts.projectId, 'project id not explicit', early)
    CHECK(opts.projectId.startsWith('demo-') || opts.yesProduction === true, 'non-emulator project requires --yes-production', early)
    if (early.length) throw new BackfillRefused(early)
  }
  const { db } = deps
  const report: Report = {
    mode: opts.apply ? 'apply' : 'dry-run', project: opts.projectId,
    users: { read: input.users.length, selected: 0, mapped: 0, mappedByEmail: 0, unmapped: 0, ambiguous: 0, skipped: 0, duplicates: 0 },
    plans: { wouldUpdate: 0, wouldNoop: 0, stale: 0, protectedStripe: 0, protectedDowngrade: 0 },
    passes: { read: input.passes.length, global: 0, scoped: 0, wouldCreate: 0, wouldUpdate: 0, wouldNoop: 0, stale: 0, duplicatesCollapsed: 0, orphan: 0, invalid: 0, byStatus: {} },
    inventory: inventorySnapshot(input.users, input.passes), blockers: [], samples: [],
  }

  // ── selection ──
  let users = input.users
  if (opts.legacyUserId) users = users.filter((u) => u.id === opts.legacyUserId)
  if (opts.userEmail) users = users.filter((u) => (u.email ?? '').toLowerCase() === opts.userEmail!.toLowerCase())
  if (opts.limit !== undefined) users = users.slice(0, opts.limit)
  report.users.selected = users.length

  // ── input sanity: duplicate users make the identity mapping unsafe ──
  const seenId = new Set<string>(), seenEmail = new Set<string>(), dup = new Set<string>()
  for (const u of users) {
    const em = (u.email ?? '').toLowerCase()
    if (seenId.has(u.id) || (em && seenEmail.has(em))) dup.add(u.id)
    seenId.add(u.id); if (em) seenEmail.add(em)
  }
  report.users.duplicates = dup.size
  const clean = users.filter((u) => !dup.has(u.id))
  const bad = clean.filter((u) => !u.id || !parseSourceTimestamp(u.updated_at ?? u.created_at))
  report.users.skipped = bad.length
  const usable = clean.filter((u) => !bad.includes(u))

  const m = await mapUsers(db, usable, opts, deps.auth)
  report.users.mapped = m.mapped.length; report.users.mappedByEmail = m.mapped.filter((x) => x.via === 'email').length
  report.users.unmapped = m.unmapped; report.users.ambiguous = m.ambiguous
  CHECK(report.users.ambiguous === 0, `${report.users.ambiguous} ambiguous identity mapping(s)`, report.blockers)
  CHECK(report.users.duplicates === 0, `${report.users.duplicates} duplicate user(s) in the input`, report.blockers)
  const uidSeen = new Map<string, string>()
  for (const r of m.mapped) { if (uidSeen.has(r.uid) && uidSeen.get(r.uid) !== r.legacyId) report.blockers.push('one Firebase uid mapped from several legacy ids'); uidSeen.set(r.uid, r.legacyId) }

  // ── passes → per mapped user ──
  const byUser = new Map<string, LegacyEventPassRow[]>()
  const selectedIds = new Set(usable.map((u) => u.id))
  const piOwner = new Map<string, string>()
  for (const p of input.passes) {
    if (!selectedIds.has(p.user_id)) { if (!opts.legacyUserId && !opts.userEmail && opts.limit === undefined) report.passes.orphan++; continue }
    const key = passKey(p)
    if (piOwner.has(key) && piOwner.get(key) !== p.user_id) report.blockers.push('the same payment key appears on passes of different users')
    piOwner.set(key, p.user_id)
    byUser.set(p.user_id, [...(byUser.get(p.user_id) ?? []), p])
  }

  const plannedWrites: Array<() => Promise<'written' | 'skipped'>> = []
  const entries: RollbackEntry[] = []
  const preImage: Array<{ path: string; kind: 'plan' | 'pass'; before: unknown }> = []

  for (const r of m.mapped) {
    const uref = db.collection('users').doc(r.uid)
    const userSnap = await uref.get()
    const stored = userSnap.data() ?? {}
    // passes (deduplicated by key: best rank, then newest version)
    const best = new Map<string, LegacyEventPassRow>()
    for (const p of byUser.get(r.legacyId) ?? []) {
      const created = parseSourceTimestamp(p.created_at), until = parseSourceTimestamp(p.valid_until)
      if (!created || !until || !['active', 'expired', 'refunded'].includes(p.status)) { report.passes.invalid++; continue }
      const key = passKey(p), cur = best.get(key)
      if (!cur) { best.set(key, p); continue }
      report.passes.duplicatesCollapsed++
      const rank = (s: PassStatus) => ({ active: 0, expired: 1, refunded: 2 }[s])
      const v = (x: LegacyEventPassRow) => parseSourceTimestamp(x.updated_at ?? x.created_at)!
      const better = rank(p.status) > rank(cur.status) || (rank(p.status) === rank(cur.status) && (v(p).seconds - v(cur).seconds || v(p).nanoseconds - v(cur).nanoseconds) > 0)
      if (better) best.set(key, p)
    }
    let passCount = 0
    for (const [key, p] of Array.from(best.entries())) {
      const created = parseSourceTimestamp(p.created_at)!, until = parseSourceTimestamp(p.valid_until)!, version = parseSourceTimestamp(p.updated_at ?? p.created_at)!
      const fields = passFields(p, until, version, created)
      const pref = uref.collection('eventPasses').doc(key)
      const snap = await pref.get(), st = snap.exists ? snap.data()! : null
      const decision = decidePass(st ? { status: st.status as PassStatus, version: (st.sourceUpdatedAt as Timestamp | undefined) ?? null } : null,
        { status: p.status, version, sameContent: st ? passContentEqual(st, fields) : false })
      passCount++
      report.passes[p.session_id ? 'scoped' : 'global']++
      report.passes.byStatus[p.status] = (report.passes.byStatus[p.status] ?? 0) + 1
      if (decision === 'create') report.passes.wouldCreate++; else if (decision === 'apply') report.passes.wouldUpdate++
      else if (decision === 'noop') report.passes.wouldNoop++; else report.passes.stale++
      if (decision === 'create' || decision === 'apply') {
        preImage.push({ path: pref.path, kind: 'pass', before: st ? ser(st) : null })
        plannedWrites.push(() => db.runTransaction(async (tx) => {
          const cur = await tx.get(pref), c = cur.exists ? cur.data()! : null
          const d2 = decidePass(c ? { status: c.status as PassStatus, version: (c.sourceUpdatedAt as Timestamp | undefined) ?? null } : null,
            { status: p.status, version, sameContent: c ? passContentEqual(c, fields) : false })
          if (d2 === 'noop' || d2 === 'stale') return 'skipped' as const
          tx.set(pref, { ...fields, updatedAt: FieldValue.serverTimestamp() })
          entries.push({ path: pref.path, kind: 'pass', before: c ? ser(c) : null, after: ser(fields) })
          return 'written' as const
        }))
      }
    }
    // plan (LAST)
    const tier: PlanTier = normalizePlan(r.user.plan)
    const version = parseSourceTimestamp(r.user.updated_at ?? r.user.created_at)!
    const storedPlan = stored.plan ? { tier: normalizePlan(stored.plan.tier), source: (stored.plan.source ?? null) as string | null, version: (stored.planSourceUpdatedAt as Timestamp | undefined) ?? null } : null
    const pd = decidePlan(storedPlan, { tier, version }, { allowUnversionedDowngrade: opts.allowUnversionedDowngrade })
    if (pd === 'apply') report.plans.wouldUpdate++; else if (pd === 'noop') report.plans.wouldNoop++; else if (pd === 'stale') report.plans.stale++
    else if (pd === 'protected_stripe') report.plans.protectedStripe++; else report.plans.protectedDowngrade++
    if (report.samples.length < 20) report.samples.push({
      user: maskId(r.legacyId), email: maskEmail(r.user.email), via: r.via, firebaseUid: maskId(r.uid),
      plan: { before: storedPlan ? `${storedPlan.tier}/${storedPlan.source}` : 'none', after: `${tier}/legacy`, decision: pd },
      passes: passCount, stripeKeys: Array.from(best.keys()).slice(0, 3).map(maskStripe),
    })
    if (pd === 'apply') {
      preImage.push({ path: uref.path, kind: 'plan', before: ser({ plan: stored.plan ?? null, planSourceUpdatedAt: stored.planSourceUpdatedAt ?? null }) })
      plannedWrites.push(() => db.runTransaction(async (tx) => {
        const cur = await tx.get(uref); if (!cur.exists) return 'skipped' as const
        const c = cur.data()!
        const sp = c.plan ? { tier: normalizePlan(c.plan.tier), source: (c.plan.source ?? null) as string | null, version: (c.planSourceUpdatedAt as Timestamp | undefined) ?? null } : null
        if (decidePlan(sp, { tier, version }, { allowUnversionedDowngrade: opts.allowUnversionedDowngrade }) !== 'apply') return 'skipped' as const
        tx.update(uref, { plan: { tier, source: 'legacy' }, planSourceUpdatedAt: version, updatedAt: FieldValue.serverTimestamp() })
        entries.push({ path: uref.path, kind: 'plan', before: ser({ plan: c.plan ?? null, planSourceUpdatedAt: c.planSourceUpdatedAt ?? null }), after: ser({ plan: { tier, source: 'legacy' }, planSourceUpdatedAt: version }) })
        return 'written' as const
      }))
    }
  }

  // ── apply (guards first) ──
  if (opts.apply) {
    const reasons = [...report.blockers]
    CHECK(opts.projectId, 'project id not explicit', reasons)
    CHECK(opts.projectId.startsWith('demo-') || opts.yesProduction === true, 'non-emulator project requires --yes-production', reasons)
    if (reasons.length) throw new BackfillRefused(reasons)
    await deps.onBeforeApply?.(preImage)          // the rollback file exists on disk before the first write
    let written = 0, skipped = 0
    for (const w of plannedWrites) { (await w()) === 'written' ? written++ : skipped++ }     // sequential: passes of an account precede its plan
    report.applied = { written, skipped }; report.rollbackEntries = entries
  }
  return report
}

// ── rollback: restores ONLY documents this backfill wrote, and only if they were not changed since ──
export interface RollbackResult { restored: number; deleted: number; skippedChanged: number }
export async function runRollback(db: Firestore, file: { entries: RollbackEntry[] }, opts: { apply: boolean; projectId: string; yesProduction?: boolean }): Promise<RollbackResult> {
  if (opts.apply && !(opts.projectId.startsWith('demo-') || opts.yesProduction === true)) throw new BackfillRefused(['non-emulator project requires --yes-production'])
  const out: RollbackResult = { restored: 0, deleted: 0, skippedChanged: 0 }
  const same = (a: unknown, b: unknown) => JSON.stringify(ser(a)) === JSON.stringify(ser(b))
  for (const e of [...file.entries].reverse()) {                           // plan first, then passes (reverse of the write order)
    const ref = db.doc(e.path)
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const cur = snap.exists ? snap.data()! : null
      const after = de(e.after as Ser) as Record<string, unknown>
      const unchanged = cur && Object.keys(after).every((k) => same(cur[k], after[k]))
      if (!unchanged) { out.skippedChanged++; return }
      if (!opts.apply) { e.before === null ? out.deleted++ : out.restored++; return }
      if (e.kind === 'pass') {
        if (e.before === null) { tx.delete(ref); out.deleted++ } else { tx.set(ref, de(e.before as Ser) as Record<string, unknown>); out.restored++ }
      } else {
        const b = de(e.before as Ser) as { plan: unknown; planSourceUpdatedAt: unknown }
        tx.update(ref, { plan: b.plan ?? FieldValue.delete(), planSourceUpdatedAt: b.planSourceUpdatedAt ?? FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() })
        out.restored++
      }
    })
  }
  return out
}
