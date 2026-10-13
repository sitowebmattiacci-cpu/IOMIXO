import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { parseSourceTimestamp } from '../repositories/gameRoundRepository'
import { passKey } from '../repositories/entitlementRepository'
import { maskId, BackfillRefused } from './entitlementBackfill'
import { normalizePlan } from '../config/plans'

/**
 * Backfill of the legacy BILLING HISTORY into Firestore. AUDIT / HISTORY ONLY: it derives NO entitlement and never calls Stripe.
 *
 *   users.stripe_customer_id      → users/{uid}.stripeCustomerId                      (set only when absent)
 *   (reverse mapping)             → stripeCustomers/{customerId} { uid, legacySupabaseId }   (create-only; server-only collection)
 *   subscriptions                 → users/{uid}/subscriptions/{stripeSubscriptionId}   historical snapshot, `legacyStatus` (NOT `status`), `stale` when the
 *                                   legacy "active/trialing" period already ended at snapshot time. The legacy status is never used to update the plan.
 *   payments                      → users/{uid}/payments/{stripePaymentIntentId | legacy-<row id>}   ledger; a 0 € checkout keeps its cs_… id as the checkout
 *                                   session id, a subscription invoice without payment intent keeps its legacy row id.
 *   event_passes                  → NOT written: already migrated (users/{uid}/eventPasses, entitlement backfill). Only cross-checked and reported.
 *
 *  - NEVER touches users/{uid}.plan (nor updatedAt / planSourceUpdatedAt) and never touches eventPasses.
 *  - DRY RUN is the default; nothing is written unless `apply: true` (demo project or --yes-production; guards re-checked before the first write).
 *  - Identity: Supabase user id → Firebase uid ONLY through users/{uid}.legacySupabaseId (never creates users).
 *  - A legacy user whose Stripe ids are incoherent (users.stripe_customer_id ≠ the customer of its subscriptions) is NOT migrated: reported, skipped.
 *  - Existing docs are never overwritten (a differing one is reported as `drift`). Nothing is ever deleted by a run; the rollback removes only what this run created.
 */
export interface BillingUserRow { id: string; email?: string | null; plan?: string | null; stripe_customer_id?: string | null }
export interface BillingSubRow {
  id: string; user_id: string; stripe_subscription_id: string; stripe_customer_id?: string | null; plan?: string | null; status: string
  current_period_start?: string | null; current_period_end?: string | null; cancel_at_period_end?: boolean | null; canceled_at?: string | null
  created_at?: string | null; updated_at?: string | null
}
export interface BillingPaymentRow {
  id: string; user_id: string; stripe_payment_intent_id?: string | null; amount_cents?: number | null; currency?: string | null
  status?: string | null; description?: string | null; created_at?: string | null
}
export interface BillingPassRow { id: string; user_id: string; stripe_payment_intent_id?: string | null; status?: string | null }
export interface BillingSnapshot { generatedAt: string; users: BillingUserRow[]; subscriptions: BillingSubRow[]; payments: BillingPaymentRow[]; eventPasses: BillingPassRow[] }

const LIVE = ['active', 'trialing', 'past_due']
const paymentDocId = (p: Pick<BillingPaymentRow, 'id' | 'stripe_payment_intent_id'>) => p.stripe_payment_intent_id || `legacy-${p.id}`
const paymentKind = (d?: string | null) => (/^Event Pass/i.test(d ?? '') ? 'event_pass' : /^Subscription/i.test(d ?? '') ? 'subscription' : 'other')
const isCheckoutSessionId = (v?: string | null) => typeof v === 'string' && v.startsWith('cs_')
const isStripeId = (v: unknown, prefix: string) => typeof v === 'string' && v.startsWith(prefix) && /^[A-Za-z0-9_]+$/.test(v) && v.length <= 120

export type UserIssue = 'customer_mismatch' | 'multiple_live_subscriptions' | 'plan_without_customer' | 'customer_without_billing_rows' | 'invalid_stripe_id'
/** Per-user coherence of the legacy Stripe ids (pure). */
export function userIssues(u: BillingUserRow, subs: BillingSubRow[], payments: BillingPaymentRow[]): UserIssue[] {
  const out: UserIssue[] = []
  const custs = new Set(subs.map((s) => s.stripe_customer_id).filter(Boolean) as string[])
  if (u.stripe_customer_id && custs.size && !(custs.size === 1 && custs.has(u.stripe_customer_id))) out.push('customer_mismatch')
  if (!u.stripe_customer_id && custs.size) out.push('customer_mismatch')
  if (subs.filter((s) => LIVE.includes(s.status)).length > 1) out.push('multiple_live_subscriptions')
  if (normalizePlan(u.plan) !== 'free' && !u.stripe_customer_id) out.push('plan_without_customer')
  if (u.stripe_customer_id && !subs.length && !payments.length) out.push('customer_without_billing_rows')
  if ((u.stripe_customer_id && !isStripeId(u.stripe_customer_id, 'cus_')) || subs.some((s) => !isStripeId(s.stripe_subscription_id, 'sub_'))) out.push('invalid_stripe_id')
  return out
}

export interface BillingInventory {
  users: number; usersWithCustomer: number; subscriptions: number; payments: number; eventPasses: number
  subsByStatus: Record<string, number>; paymentsByKind: Record<string, number>; paymentsWithoutIntent: number; paymentsCheckoutSessionIds: number
  duplicateSubscriptionIds: number; duplicatePaymentDocIds: number; duplicateCustomerIds: number
  usersWithIssues: Record<UserIssue, number>
}
export function inventoryBilling(s: BillingSnapshot): BillingInventory {
  const inc = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1 }
  const inv: BillingInventory = { users: s.users.length, usersWithCustomer: s.users.filter((u) => u.stripe_customer_id).length, subscriptions: s.subscriptions.length, payments: s.payments.length,
    eventPasses: s.eventPasses.length, subsByStatus: {}, paymentsByKind: {}, paymentsWithoutIntent: 0, paymentsCheckoutSessionIds: 0, duplicateSubscriptionIds: 0, duplicatePaymentDocIds: 0, duplicateCustomerIds: 0,
    usersWithIssues: { customer_mismatch: 0, multiple_live_subscriptions: 0, plan_without_customer: 0, customer_without_billing_rows: 0, invalid_stripe_id: 0 } }
  for (const x of s.subscriptions) inc(inv.subsByStatus, x.status)
  for (const p of s.payments) { inc(inv.paymentsByKind, paymentKind(p.description)); if (!p.stripe_payment_intent_id) inv.paymentsWithoutIntent++; if (isCheckoutSessionId(p.stripe_payment_intent_id)) inv.paymentsCheckoutSessionIds++ }
  const subIds = new Set<string>(), payIds = new Set<string>(), custIds = new Set<string>()
  for (const x of s.subscriptions) { if (subIds.has(x.stripe_subscription_id)) inv.duplicateSubscriptionIds++; subIds.add(x.stripe_subscription_id) }
  for (const p of s.payments) { const k = paymentDocId(p); if (payIds.has(`${p.user_id}/${k}`)) inv.duplicatePaymentDocIds++; payIds.add(`${p.user_id}/${k}`) }
  for (const u of s.users) if (u.stripe_customer_id) { if (custIds.has(u.stripe_customer_id)) inv.duplicateCustomerIds++; custIds.add(u.stripe_customer_id) }
  for (const u of s.users) for (const i of new Set(userIssues(u, s.subscriptions.filter((x) => x.user_id === u.id), s.payments.filter((p) => p.user_id === u.id)))) inv.usersWithIssues[i]++
  return inv
}

const ts = (v?: string | null): Timestamp | null => (v ? parseSourceTimestamp(v) : null)
/** subscriptions row → doc fields. `stale`: the legacy snapshot says live, but its period had already ended when the snapshot was taken. */
export function subscriptionFields(r: BillingSubRow, uid: string, snapshotAt: Date) {
  const end = ts(r.current_period_end)
  return {
    stripeSubscriptionId: r.stripe_subscription_id, stripeCustomerId: r.stripe_customer_id ?? null,
    tier: normalizePlan(r.plan), legacyPlan: r.plan ?? null, legacyStatus: r.status,
    currentPeriodStart: ts(r.current_period_start), currentPeriodEnd: end, cancelAtPeriodEnd: r.cancel_at_period_end === true, canceledAt: ts(r.canceled_at),
    historical: true, stale: LIVE.includes(r.status) && (!end || end.toMillis() < snapshotAt.getTime()),
    snapshotAt: Timestamp.fromDate(snapshotAt), source: 'legacy', legacySupabaseId: r.id, uid,
  }
}
export function paymentFields(r: BillingPaymentRow, uid: string) {
  return {
    stripePaymentIntentId: r.stripe_payment_intent_id && !isCheckoutSessionId(r.stripe_payment_intent_id) ? r.stripe_payment_intent_id : null,
    stripeCheckoutSessionId: isCheckoutSessionId(r.stripe_payment_intent_id) ? r.stripe_payment_intent_id : null,
    amountCents: r.amount_cents ?? 0, currency: r.currency ?? 'eur', status: r.status ?? 'succeeded', description: r.description ?? null, kind: paymentKind(r.description),
    historical: true, source: 'legacy', legacySupabaseId: r.id, uid,
  }
}
const DRIFT_SUB = ['stripeCustomerId', 'tier', 'legacyStatus', 'cancelAtPeriodEnd', 'legacySupabaseId'] as const
const DRIFT_PAY = ['stripePaymentIntentId', 'stripeCheckoutSessionId', 'amountCents', 'currency', 'status', 'legacySupabaseId'] as const
const same = (stored: FirebaseFirestore.DocumentData, next: Record<string, unknown>, keys: readonly string[]) => keys.every((k) => (stored[k] ?? null) === (next[k] ?? null))

export interface BillingBackfillOptions { apply: boolean; projectId: string; yesProduction?: boolean; legacyUserId?: string }
export interface BillingRollbackEntry { path: string; kind: 'customerField' | 'reverseMapping' | 'subscription' | 'payment'; after?: string }
type Tally = { selected: number; wouldCreate: number; noop: number; drift: number }
export interface BillingBackfillReport {
  mode: 'dry-run' | 'apply'; project: string; inventory: BillingInventory; snapshotAt: string
  scope: { legacyUsersSelected: number; mapped: number; unmapped: number; ambiguous: number; skippedIncoherent: number }
  customer: { selected: number; wouldSet: number; noop: number; drift: number }
  reverseMapping: Omit<Tally, 'selected'> & { selected: number; conflicts: number }
  subscriptions: Tally & { stale: number; liveStatusInLegacy: number }
  payments: Tally & { byKind: Record<string, number> }
  eventPasses: { inSnapshot: number; skippedAlreadyMigrated: number; missingInFirestore: number; written: 0 }
  planUntouched: { users: number; planChanged: 0 }
  userIssues: Array<{ user: string; issues: UserIssue[]; migrated: false }>
  blockers: string[]; samples: Array<Record<string, unknown>>
  applied?: { written: number; skipped: number }; entries?: BillingRollbackEntry[]
}

export async function runBillingBackfill(input: BillingSnapshot, opts: BillingBackfillOptions, deps: { db: Firestore }): Promise<BillingBackfillReport> {
  const guard = (bag: string[]) => {
    if (!opts.projectId) bag.push('project id not explicit')
    if (!(opts.projectId.startsWith('demo-') || opts.yesProduction === true)) bag.push('non-emulator project requires --yes-production')
  }
  if (opts.apply) { const early: string[] = []; guard(early); if (early.length) throw new BackfillRefused(early) }
  const { db } = deps
  const snapshotAt = new Date(input.generatedAt)
  const report: BillingBackfillReport = {
    mode: opts.apply ? 'apply' : 'dry-run', project: opts.projectId, inventory: inventoryBilling(input), snapshotAt: snapshotAt.toISOString(),
    scope: { legacyUsersSelected: 0, mapped: 0, unmapped: 0, ambiguous: 0, skippedIncoherent: 0 },
    customer: { selected: 0, wouldSet: 0, noop: 0, drift: 0 },
    reverseMapping: { selected: 0, wouldCreate: 0, noop: 0, drift: 0, conflicts: 0 },
    subscriptions: { selected: 0, wouldCreate: 0, noop: 0, drift: 0, stale: 0, liveStatusInLegacy: 0 },
    payments: { selected: 0, wouldCreate: 0, noop: 0, drift: 0, byKind: {} },
    eventPasses: { inSnapshot: 0, skippedAlreadyMigrated: 0, missingInFirestore: 0, written: 0 },
    planUntouched: { users: 0, planChanged: 0 }, userIssues: [], blockers: [], samples: [],
  }
  if (!Number.isFinite(snapshotAt.getTime())) throw new BackfillRefused(['snapshot.generatedAt is not a valid date'])
  const users = input.users.filter((u) => !opts.legacyUserId || u.id === opts.legacyUserId)
  report.scope.legacyUsersSelected = users.length
  if (report.inventory.duplicateSubscriptionIds) report.blockers.push(`${report.inventory.duplicateSubscriptionIds} duplicate stripe_subscription_id in the input`)
  if (report.inventory.duplicatePaymentDocIds) report.blockers.push(`${report.inventory.duplicatePaymentDocIds} duplicate payment doc id in the input`)
  if (report.inventory.duplicateCustomerIds) report.blockers.push(`${report.inventory.duplicateCustomerIds} Stripe customer shared by more than one legacy user`)

  const planned: Array<() => Promise<'written' | 'skipped'>> = [], entries: BillingRollbackEntry[] = []
  for (const u of users) {
    const subs = input.subscriptions.filter((s) => s.user_id === u.id), pays = input.payments.filter((p) => p.user_id === u.id), passes = input.eventPasses.filter((p) => p.user_id === u.id)
    const q = await db.collection('users').where('legacySupabaseId', '==', u.id).limit(2).get()
    if (q.empty) { report.scope.unmapped++; continue }
    if (q.size > 1) { report.scope.ambiguous++; continue }
    const uref = q.docs[0].ref, udata = q.docs[0].data(), uid = uref.id
    report.scope.mapped++; report.planUntouched.users++
    const issues = userIssues(u, subs, pays)
    const blocking = issues.filter((i) => i === 'customer_mismatch' || i === 'invalid_stripe_id')
    if (issues.length) report.userIssues.push({ user: maskId(u.id), issues, migrated: false })
    // Event Passes: cross-check only (they are migrated already; never written here)
    report.eventPasses.inSnapshot += passes.length
    for (const p of passes) { if ((await uref.collection('eventPasses').doc(passKey(p as any)).get()).exists) report.eventPasses.skippedAlreadyMigrated++; else report.eventPasses.missingInFirestore++ }
    if (blocking.length) { report.scope.skippedIncoherent++; continue }          // incoherent Stripe ids: reported, NOT migrated

    // 1+2. customer on the user doc, reverse mapping
    const cust = u.stripe_customer_id
    if (cust) {
      report.customer.selected++; report.reverseMapping.selected++
      const cur = udata.stripeCustomerId
      if (cur === cust) report.customer.noop++; else if (cur) report.customer.drift++
      else {
        report.customer.wouldSet++
        planned.push(async () => {
          const s = await uref.get(); if (!s.exists || s.data()!.stripeCustomerId) return 'skipped' as const
          await uref.update({ stripeCustomerId: cust }); entries.push({ path: uref.path, kind: 'customerField', after: cust }); return 'written' as const
        })
      }
      const rref = db.collection('stripeCustomers').doc(cust), rcur = await rref.get()
      if (rcur.exists) { if (rcur.data()!.uid === uid && rcur.data()!.legacySupabaseId === u.id) report.reverseMapping.noop++; else { report.reverseMapping.drift++; report.reverseMapping.conflicts++ } }
      else {
        report.reverseMapping.wouldCreate++
        planned.push(async () => {
          try { await rref.create({ uid, legacySupabaseId: u.id, backfilled: true, source: 'legacy', createdAt: FieldValue.serverTimestamp() }) } catch { return 'skipped' as const }
          entries.push({ path: rref.path, kind: 'reverseMapping' }); return 'written' as const
        })
      }
      if (report.samples.length < 10) report.samples.push({ kind: 'customer', user: maskId(u.id), uid: maskId(uid), customer: maskId(cust), reverseMapping: !rcur.exists })
    }

    // 3. subscriptions (historical snapshot)
    for (const s of subs) {
      report.subscriptions.selected++
      const fields = subscriptionFields(s, uid, snapshotAt)
      if (LIVE.includes(s.status)) report.subscriptions.liveStatusInLegacy++
      if (fields.stale) report.subscriptions.stale++
      const ref = uref.collection('subscriptions').doc(s.stripe_subscription_id), cur = await ref.get()
      if (cur.exists) { if (same(cur.data()!, fields, DRIFT_SUB)) report.subscriptions.noop++; else report.subscriptions.drift++; continue }
      report.subscriptions.wouldCreate++
      if (report.samples.length < 10) report.samples.push({ kind: 'subscription', sub: maskId(s.stripe_subscription_id), tier: fields.tier, legacyStatus: s.status, stale: fields.stale, cancelAtPeriodEnd: fields.cancelAtPeriodEnd })
      planned.push(async () => {
        try { await ref.create({ ...fields, backfilled: true, createdAt: ts(s.created_at) ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }) } catch { return 'skipped' as const }
        entries.push({ path: ref.path, kind: 'subscription' }); return 'written' as const
      })
    }

    // 4. payments (ledger)
    for (const p of pays) {
      report.payments.selected++
      const fields = paymentFields(p, uid); report.payments.byKind[fields.kind] = (report.payments.byKind[fields.kind] ?? 0) + 1
      const ref = uref.collection('payments').doc(paymentDocId(p)), cur = await ref.get()
      if (cur.exists) { if (same(cur.data()!, fields, DRIFT_PAY)) report.payments.noop++; else report.payments.drift++; continue }
      report.payments.wouldCreate++
      if (report.samples.length < 10) report.samples.push({ kind: 'payment', doc: maskId(paymentDocId(p)), type: fields.kind, amountCents: fields.amountCents, currency: fields.currency })
      planned.push(async () => {
        try { await ref.create({ ...fields, backfilled: true, createdAt: ts(p.created_at) ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }) } catch { return 'skipped' as const }
        entries.push({ path: ref.path, kind: 'payment' }); return 'written' as const
      })
    }
  }

  if (report.scope.unmapped) report.blockers.push(`${report.scope.unmapped} selected legacy user(s) have no users/{uid}.legacySupabaseId (not migrated: skipped, never created)`)
  if (report.scope.ambiguous) report.blockers.push(`${report.scope.ambiguous} legacy user(s) match more than one Firebase account`)
  if (report.reverseMapping.conflicts) report.blockers.push(`${report.reverseMapping.conflicts} stripeCustomers/{id} already maps to a different account`)
  if (report.customer.drift) report.blockers.push(`${report.customer.drift} users/{uid}.stripeCustomerId differs from the legacy customer`)
  if (opts.apply) {
    const reasons = [...report.blockers]; guard(reasons)
    if (reasons.length) throw new BackfillRefused(reasons)
    let written = 0, skipped = 0
    for (const w of planned) { (await w()) === 'written' ? written++ : skipped++ }
    report.applied = { written, skipped }; report.entries = entries
  }
  return report
}

/** Removes ONLY what an apply created. users/{uid}.stripeCustomerId is cleared only while it still holds the value this run wrote. plan is never touched. */
export async function runBillingRollback(db: Firestore, entries: BillingRollbackEntry[], opts: { apply: boolean; projectId: string; yesProduction?: boolean }) {
  if (opts.apply && !(opts.projectId.startsWith('demo-') || opts.yesProduction === true)) throw new BackfillRefused(['non-emulator project requires --yes-production'])
  const out = { removed: 0, cleared: 0, skippedChanged: 0 }
  for (const e of entries) {
    const ref = db.doc(e.path), snap = await ref.get()
    if (!snap.exists) continue
    const d = snap.data()!
    if (e.kind === 'customerField') {
      if (d.stripeCustomerId !== e.after) { out.skippedChanged++; continue }
      if (opts.apply) await ref.update({ stripeCustomerId: FieldValue.delete() }); out.cleared++
    } else {
      if (d.backfilled !== true) { out.skippedChanged++; continue }
      if (opts.apply) await ref.delete(); out.removed++
    }
  }
  return out
}
