// @ts-nocheck -- dev-only script: imports firebase-admin, backend and Functions sources outside the frontend type graph
/**
 * Cloud check of the entitlement BACKFILL on iomixo-494817 with SYNTHETIC data only (no Supabase, no real account touched).
 *
 *   NODE_PATH=../backend/node_modules FIREBASE_PROJECT_ID=iomixo-494817 npx tsx scripts/backfill-cloud-check.ts [cleanup]
 *
 * Input rows are fabricated here; users/{bf-test-*} documents and firebase-test-bf-* events are created and removed.
 * `yesProduction: true` is passed ONLY because the synthetic users live in the real project; nothing else is ever written.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const PROJECT = 'iomixo-494817', OWNER_UID = 'z5EDSZrgFDXMjCrRCB4cMEidoaL2', UPFX = 'bf-test-', EPFX = 'firebase-test-bf-'
const STATE = __dirname + '/.bf-cloud-state.json'
if (process.env.FIREBASE_PROJECT_ID !== PROJECT) throw new Error('set FIREBASE_PROJECT_ID=' + PROJECT)
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator env set: refusing')
if (Object.keys(process.env).some((k) => k.startsWith('SUPABASE'))) throw new Error('SUPABASE_* env present: refusing')
const fetched: string[] = []; const rf = globalThis.fetch; globalThis.fetch = ((i: any, o?: any) => { fetched.push(String(i?.url ?? i)); return rf(i, o) }) as typeof fetch

initializeApp({ projectId: PROJECT }); const db = getFirestore()
const fnReq = createRequire(__dirname + '/../../../firebase/functions/package.json')   // the Functions package has its own firebase-admin copy
const fdb = fnReq('firebase-admin/firestore').getFirestore(fnReq('firebase-admin/app').initializeApp({ projectId: PROJECT }, 'fn'))
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { users: [], events: [] }
const save = () => writeFileSync(STATE, JSON.stringify(state))
const results: boolean[] = []
const check = (name: string, ok: boolean, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const H = 3600_000, stamp = Date.now().toString(36); let n = 0
const v = (k: number) => `2026-05-01T10:00:00.${String(100000 + k).padStart(6, '0')}+00:00`

async function run() {
  const bf = await import('../../backend/src/services/entitlementBackfill')
  const { loadEntitlements } = await import('../../../firebase/functions/src/entitlements/load')
  const { selectEventEntitlements } = await import('../../../firebase/functions/src/entitlements/source')
  const ownerBefore = await db.doc(`users/${OWNER_UID}`).get(), usersBefore = (await db.collection('users').listDocuments()).length
  const OPTS = { projectId: PROJECT, yesProduction: true }

  const mk = async (tier: string, legacyPlan: string, plan: Record<string, unknown> = { tier: 'free', source: 'default' }) => {
    const fb = `${UPFX}${stamp}-${n++}`, legacy = `mock-user-${fb}`
    await db.doc(`users/${fb}`).set({ uid: fb, email: `${fb}@example.invalid`, plan, legacySupabaseId: legacy, testData: true, createdAt: new Date(), updatedAt: new Date() })
    state.users.push(fb); save()
    return { fb, legacy, row: { id: legacy, email: `${fb}@example.invalid`, plan: legacyPlan, stripe_customer_id: 'cus_TESTSYNTHETIC0001', created_at: v(0), updated_at: v(1) } }
  }
  const pass = (user_id: string, over = {}) => ({ id: `ep-${stamp}-${n++}`, user_id, session_id: null, stripe_payment_intent_id: `pi_TESTSYNTH${stamp}${n}`, amount_cents: 799, currency: 'eur',
    valid_until: new Date(Date.now() + 5 * H).toISOString(), status: 'active', created_at: v(0), updated_at: v(0), ...over })
  const mkEvent = async (ownerUid: string, name: string, legacy: string) => {
    const id = `${EPFX}${stamp}-${name}`
    await db.doc(`events/${id}`).set({ ownerUid, slug: id, legacySupabaseId: legacy, title: 'TEST BF', type: 'party', status: 'live', testData: true, createdAt: new Date(), updatedAt: new Date() })
    state.events.push(id); save(); return { id, legacy }
  }

  const free = await mk('free', 'free'), pro = await mk('pro', 'pro'), wed = await mk('wedding', 'advance'), unknown = await mk('free', 'platinum')
  const withGlobal = await mk('free', 'free'), withScoped = await mk('free', 'free'), withExpired = await mk('free', 'free'), withRefunded = await mk('free', 'free')
  const stripe = await mk('wedding', 'free', { tier: 'wedding', source: 'stripe' })
  const unmapped = { id: `mock-user-unmapped-${stamp}`, email: 'ghost@example.invalid', plan: 'wedding', created_at: v(0), updated_at: v(1) }
  const E = await mkEvent(withScoped.fb, 'scoped', 'mock-session-scoped-' + stamp), E2 = await mkEvent(withScoped.fb, 'other', 'mock-session-other-' + stamp)
  const Ef = await mkEvent(free.fb, 'free', 'mock-session-free-' + stamp)
  const users = [free, pro, wed, unknown, withGlobal, withScoped, withExpired, withRefunded, stripe].map((u) => u.row).concat([unmapped])
  const passes = [pass(withGlobal.legacy), pass(withScoped.legacy, { session_id: E.legacy }),
    pass(withExpired.legacy, { status: 'expired', valid_until: new Date(Date.now() - H).toISOString() }), pass(withRefunded.legacy, { status: 'refunded' }), pass(stripe.legacy)]
  const input = { users, passes }
  const ev = async (e) => (await db.doc(`events/${e.id}`).get()).data()

  // before: legacy-backed events of accounts without a server plan → fallback
  check('BEFORE: owner without server plan → legacy_projected_fallback', (await selectEventEntitlements(fdb, Ef.id, await ev(Ef))).source === 'legacy_projected_fallback')

  const dry = await bf.runBackfill(input, { ...OPTS, apply: false }, { db })
  check('dry-run: mode, counts (9 mapped, 1 unmapped), nothing written', dry.mode === 'dry-run' && dry.users.mapped === 9 && dry.users.unmapped === 1 && !dry.applied
    && (await db.doc(`users/${withGlobal.fb}`).get()).data().plan.source === 'default' && (await db.collectionGroup('eventPasses').count().get()).data().count === 0)
  check('dry-run report masked (no full email / Stripe key / legacy id)', !JSON.stringify(dry).includes('@example.invalid') && !JSON.stringify(dry).includes(passes[0].stripe_payment_intent_id) && !JSON.stringify(dry).includes(free.legacy))
  check('dry-run: plan 8 would change, stripe plan protected; passes 5 would be created', dry.plans.wouldUpdate === 8 && dry.plans.protectedStripe === 1 && dry.passes.wouldCreate === 5)

  let pre = []
  const applied = await bf.runBackfill(input, { ...OPTS, apply: true }, { db, onBeforeApply: async (x) => { pre = x } })
  check('apply: pre-image handed over before the writes; 13 documents written (8 plans + 5 passes)', pre.length === 13 && applied.applied.written === 13, `written=${applied.applied.written}`)
  check('apply: unmapped user created nothing, stripe plan untouched', (await db.doc(`users/${stripe.fb}`).get()).data().plan.source === 'stripe' && !(await db.collection('users').where('legacySupabaseId', '==', unmapped.id).get()).size)

  // resolver view
  const ent = (u, e = null) => loadEntitlements(fdb, { uid: u.fb }, e && { id: e.id, legacySessionId: e.legacy })
  const [eFree, ePro, eWed, eUnk, eGlob, eScoped, eExp, eRef] = await Promise.all([ent(free), ent(pro), ent(wed), ent(unknown), ent(withGlobal), ent(withScoped, E), ent(withExpired), ent(withRefunded)])
  check('resolver after backfill: free / pro / advance / unknown→free', eFree.accountTier === 'free' && !eFree.eventAccess && ePro.accountTier === 'pro' && !ePro.eventAccess && eWed.accountTier === 'wedding' && eWed.eventAccess && eUnk.accountTier === 'free')
  check('resolver: global pass grants access; expired and refunded do not', eGlob.eventAccess && eGlob.effectiveTier === 'wedding' && !eExp.eventAccess && !eRef.eventAccess)
  check('resolver: scoped pass opens ITS event only', eScoped.eventAccess && !(await ent(withScoped, E2)).eventAccess && !(await ent(withScoped)).eventAccess)
  check('callable logic: owner now has a server plan → source firestore (final)', (await selectEventEntitlements(fdb, Ef.id, await ev(Ef))).source === 'firestore'
    && (await selectEventEntitlements(fdb, E.id, await ev(E))).ent.eventAccess === true && (await selectEventEntitlements(fdb, E2.id, await ev(E2))).ent.eventAccess === false)

  const again = await bf.runBackfill(input, { ...OPTS, apply: true }, { db })
  const dry2 = await bf.runBackfill(input, { ...OPTS, apply: false }, { db })
  check('second apply → NOOP (0 written); second dry-run → 0 pending changes', again.applied.written === 0 && dry2.plans.wouldUpdate === 0 && dry2.passes.wouldCreate === 0 && dry2.passes.wouldUpdate === 0)

  // newer / older legacy data
  const newer = await bf.runBackfill({ users: [{ ...pro.row, plan: 'wedding', updated_at: v(9) }], passes: [] }, { ...OPTS, apply: true }, { db })
  const older = await bf.runBackfill({ users: [{ ...pro.row, plan: 'free', updated_at: v(2) }], passes: [] }, { ...OPTS, apply: true }, { db })
  check('newer legacy update applied, older ignored', newer.applied.written === 1 && older.plans.stale === 1 && (await db.doc(`users/${pro.fb}`).get()).data().plan.tier === 'wedding')
  const refund = await bf.runBackfill({ users: [], passes: [{ ...passes[0], status: 'refunded' }] }, { ...OPTS, apply: true, legacyUserId: undefined }, { db })
  void refund

  // rollback
  const rb = await bf.runRollback(db, { entries: applied.rollbackEntries }, { apply: true, ...OPTS })
  check('rollback: plans restored to default, created passes deleted; the one changed since (pro: newer update) is left alone',
    (await db.doc(`users/${withGlobal.fb}`).get()).data().plan.source === 'default' && (await db.collection(`users/${withGlobal.fb}/eventPasses`).get()).size === 0
    && (await db.doc(`users/${pro.fb}`).get()).data().plan.tier === 'wedding' && rb.skippedChanged >= 1, JSON.stringify(rb))
  check('after rollback the owner is back on the legacy fallback', (await selectEventEntitlements(fdb, Ef.id, await ev(Ef))).source === 'legacy_projected_fallback')

  // scale: 30 more users, rerun
  const many = []; for (let i = 0; i < 30; i++) many.push(await mk('free', ['free', 'pro', 'advance'][i % 3]))
  const mi = { users: many.map((m) => m.row), passes: many.filter((_, i) => i % 3 === 0).map((m) => pass(m.legacy)) }
  const m1 = await bf.runBackfill(mi, { ...OPTS, apply: true }, { db }), m2 = await bf.runBackfill(mi, { ...OPTS, apply: true }, { db })
  check('30 synthetic users: apply then re-run → 0 changes', m1.applied.written === 30 + 10 && m2.applied.written === 0, `first=${m1.applied.written}`)

  check('zero Supabase: no SUPABASE env, 0 fetch to *supabase*', fetched.every((u) => !/supabase/i.test(u)), `fetch calls=${fetched.length}`)
  return { ownerBefore, usersBefore }
}

async function cleanup(ctx?) {
  const ids = new Set(state.events); for (const r of await db.collection('events').listDocuments()) if (r.id.startsWith(EPFX)) ids.add(r.id)
  for (const id of ids) await db.recursiveDelete(db.doc(`events/${id}`))
  const users = new Set(state.users); for (const r of await db.collection('users').listDocuments()) if (r.id.startsWith(UPFX)) users.add(r.id)
  for (const id of users) await db.recursiveDelete(db.doc(`users/${id}`))
  state.users = []; state.events = []; save()
  const evLeft = (await db.collection('events').listDocuments()).filter((r) => r.id.startsWith(EPFX)).length
  const usersLeft = (await db.collection('users').listDocuments()).filter((r) => r.id.startsWith(UPFX)).length
  const passDocs = (await db.collectionGroup('eventPasses').count().get()).data().count
  const owner = await db.doc(`users/${OWNER_UID}`).get(), usersNow = (await db.collection('users').listDocuments()).length
  const ownerOk = owner.exists && owner.data().plan.tier === 'wedding' && (!ctx || (JSON.stringify(owner.data()) === JSON.stringify(ctx.ownerBefore.data()) && owner.updateTime.isEqual(ctx.ownerBefore.updateTime)))
  console.log(JSON.stringify({ testEventsLeft: evLeft, testUserDocsLeft: usersLeft, eventPassDocsInProject: passDocs, ownerIntact: ownerOk, usersDocsNow: usersNow, usersDocsBefore: ctx?.usersBefore ?? 'n/a' }))
  check('cleanup: 0 test events, 0 test user docs, 0 eventPasses docs, owner intact, users count back to baseline', evLeft === 0 && usersLeft === 0 && passDocs === 0 && ownerOk && (!ctx || usersNow === ctx.usersBefore))
}

void (async () => {
  let ctx
  try { if (process.argv[2] !== 'cleanup') ctx = await run() } catch (e) { results.push(false); console.error('FATAL', e) } finally { await cleanup(ctx) }
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1)
})()
