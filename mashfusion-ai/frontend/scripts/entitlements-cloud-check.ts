// @ts-nocheck -- dev-only script: imports firebase-admin, backend and Functions sources outside the frontend type graph
/**
 * Cloud check of plans / Event Passes on iomixo-494817. TEST DATA ONLY, no deploy, no Supabase.
 *
 *   NODE_PATH=../backend/node_modules FIREBASE_PROJECT_ID=iomixo-494817 npx tsx scripts/entitlements-cloud-check.ts            run + cleanup
 *   … scripts/entitlements-cloud-check.ts cleanup                                                                             cleanup only
 *   … scripts/entitlements-cloud-check.ts owner --email <owner email>     REAL owner leg (hidden password prompt, read-only)
 *
 * Creates firebase-test-ent-* events, users/{uid} documents + Auth users (@example.invalid) that it deletes at the end.
 * The projection flags are set inside THIS process only. The rules deployed today do NOT yet contain the eventPasses
 * rule (deploying needs your explicit authorization): the script reports that case as "denied by default" and never deploys.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { initializeApp as initAdmin } from 'firebase-admin/app'
import { getFirestore as adminDb, Timestamp, FieldValue } from 'firebase-admin/firestore'
const FieldDelete = () => FieldValue.delete()
import { getAuth as adminAuth } from 'firebase-admin/auth'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, collectionGroup } from 'firebase/firestore'

const PROJECT = 'iomixo-494817', OWNER_UID = 'z5EDSZrgFDXMjCrRCB4cMEidoaL2', PREFIX = 'firebase-test-ent-'
const STATE = __dirname + '/.ent-cloud-state.json', ENV = __dirname + '/../.env.production.local'
if (process.env.FIREBASE_PROJECT_ID !== PROJECT) throw new Error('set FIREBASE_PROJECT_ID=' + PROJECT)
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('emulator env set: refusing')
if (Object.keys(process.env).some((k) => k.startsWith('SUPABASE'))) throw new Error('SUPABASE_* env present: refusing')
process.env.FIRESTORE_EVENT_PROJECTION = 'on'; process.env.FIRESTORE_ENTITLEMENTS_PROJECTION = 'on'   // this process only

const fetched: string[] = []; const realFetch = globalThis.fetch
globalThis.fetch = ((i: any, o?: any) => { fetched.push(String(i?.url ?? i)); return realFetch(i, o) }) as typeof fetch

const env = Object.fromEntries(readFileSync(ENV, 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const webConfig = { apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, appId: env.NEXT_PUBLIC_FIREBASE_APP_ID }
initAdmin({ projectId: PROJECT }); const db = adminDb(), auth = adminAuth()
// The Functions package has its own firebase-admin copy (its Timestamp class differs from the backend's): the loaders get THEIR instance.
const fnReq = createRequire(__dirname + '/../../../firebase/functions/package.json')
const fnApp = fnReq('firebase-admin/app').initializeApp({ projectId: PROJECT }, 'fn')
const fdb = fnReq('firebase-admin/firestore').getFirestore(fnApp)
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { events: [], users: [] }
const save = () => writeFileSync(STATE, JSON.stringify(state))
const results: boolean[] = []
const check = (name: string, ok: boolean, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const denied = async (p: Promise<unknown>) => { try { await p; return false } catch (e) { return (e as { code?: string }).code === 'permission-denied' } }
const H = 3600_000, future = (h: number) => new Date(Date.now() + h * H)
let n = 0
const ver = (k: number) => `2026-04-01T10:00:00.${String(100000 + k).padStart(6, '0')}+00:00`

async function testAccount(tier: string, legacy = `mock-user-${Date.now().toString(36)}-${n++}`) {
  const email = `ent-${Date.now().toString(36)}-${n++}@example.invalid`, password = 'T-' + Math.random().toString(36).slice(2) + 'Aa1!'
  const u = await auth.createUser({ email, password }); state.users.push(u.uid); save()
  await db.doc(`users/${u.uid}`).set({ uid: u.uid, email, plan: { tier, source: 'default' }, legacySupabaseId: legacy, testData: true, createdAt: new Date(), updatedAt: new Date() })
  return { uid: u.uid, email, password, legacy }
}
async function signedIn(a: { email: string; password: string }) {
  const app = initializeApp(webConfig, `c${Date.now()}-${n++}`)
  await signInWithEmailAndPassword(getAuth(app), a.email, a.password)
  return { app, db: getFirestore(app) }
}
async function seedEvent(ownerUid: string) {
  const id = `${PREFIX}${Date.now().toString(36)}-${n++}`, legacy = `mock-session-${id}`
  await db.doc(`events/${id}`).set({ ownerUid, slug: id, legacySupabaseId: legacy, title: 'TEST ENT EVENT', type: 'wedding', status: 'live', testData: true, createdAt: new Date(), updatedAt: new Date() })
  state.events.push(id); save(); return { id, legacy }
}

async function run() {
  const repo = await import('../../backend/src/repositories/entitlementRepository')
  const proj = await import('../../backend/src/services/eventProjection')
  const { loadEntitlements, requireEventAccess, hasEventAccess } = await import('../../../firebase/functions/src/entitlements/load')
  const ownerBefore = await db.doc(`users/${OWNER_UID}`).get()
  const usersBefore = (await db.collection('users').listDocuments()).length

  // ── projection (real backend code, synthetic legacy rows) ──
  const free = await testAccount('free'), pro = await testAccount('free')
  const E = await seedEvent(free.uid)
  const pass = (uid: string, over: Record<string, unknown> = {}) => ({ id: `ep-${Date.now()}-${n++}`, user_id: uid, session_id: null, stripe_payment_intent_id: `pi_test_${Date.now().toString(36)}${n++}`,
    amount_cents: 799, currency: 'eur', valid_until: future(24).toISOString(), status: 'active', created_at: ver(0), updated_at: ver(0), ...over })

  check('plan projection: legacy "advance" → wedding/legacy', (await repo.projectLegacyPlan({ id: pro.legacy, plan: 'pro', updated_at: ver(1) })) === 'applied'
    && (await db.doc(`users/${pro.uid}`).get()).data().plan.tier === 'pro')
  check('plan upgrade pro → wedding then downgrade → free (newer versions)', (await repo.projectLegacyPlan({ id: pro.legacy, plan: 'advance', updated_at: ver(2) })) === 'applied'
    && (await loadEntitlements(fdb, { uid: pro.uid })).eventAccess === true
    && (await repo.projectLegacyPlan({ id: pro.legacy, plan: 'free', updated_at: ver(3) })) === 'applied' && (await loadEntitlements(fdb, { uid: pro.uid })).eventAccess === false)
  check('stale plan (older version) ignored', (await repo.projectLegacyPlan({ id: pro.legacy, plan: 'wedding', updated_at: ver(1) })) === 'stale_ignored' && (await db.doc(`users/${pro.uid}`).get()).data().plan.tier === 'free')

  const p1 = pass(free.legacy, { session_id: E.legacy })
  await proj.projectEventPass(p1)
  const d1 = (await db.doc(`users/${free.uid}/eventPasses/${p1.stripe_payment_intent_id}`).get()).data()
  check('Event Pass projected (flag-gated wrapper), keyed by payment intent, legacy ids kept', d1?.status === 'active' && d1.legacySessionId === E.legacy && d1.legacySupabaseId === p1.id && d1.source === 'legacy')
  const ent = await requireEventAccess(fdb, E.id)
  check('server-side entitlement for the event: eventAccess + wedding limits + all gates', ent.eventAccess && ent.effectiveTier === 'wedding' && ent.limits.maxRequestsPerSession === Infinity
    && Object.values(ent.gates).every(Boolean), `ownerUid ok=${ent.ownerUid === free.uid}`)
  const E2 = await seedEvent(free.uid)
  check('pass scoped to event 1 does NOT open event 2 of the same DJ', (await loadEntitlements(fdb, { uid: free.uid }, { id: E2.id, legacySessionId: E2.legacy })).eventAccess === false)
  check('legacy user id lookup (transition) gives the same verdict', await hasEventAccess(fdb, { legacyUserId: free.legacy }, { id: E.id, legacySessionId: E.legacy }) === true)
  await proj.projectEventPass({ ...p1, status: 'refunded', updated_at: ver(5) })
  check('refund (newer version) revokes access', (await loadEntitlements(fdb, { uid: free.uid }, { id: E.id, legacySessionId: E.legacy })).eventAccess === false)
  const warns: string[] = []; const rw = console.warn; console.warn = (...a) => { warns.push(String(a[0])) }
  const stale = await repo.projectEventPass({ ...p1, status: 'active', updated_at: ver(2) }); console.warn = rw
  check('stale re-activation ignored + structured log', stale === 'stale_ignored' && warns.some((l) => l.includes('"result":"stale_ignored"') && l.includes('eventPasses')))
  const expired = pass(free.legacy, { valid_until: future(-1).toISOString() })
  await repo.projectEventPass(expired)
  check('expired pass projected but never grants access', (await loadEntitlements(fdb, { uid: free.uid }, { id: E.id, legacySessionId: E.legacy })).eventAccess === false)
  const gone = await repo.projectEventPass(pass('no-such-legacy-user'))
  check('pass of an unknown legacy user is not projected', gone === 'no_user')

  const out = await Promise.all(Array.from({ length: 50 }, async () => {
    const p = pass(free.legacy); await repo.projectEventPass(p)
    const pair = [{ ...p, status: 'active', updated_at: ver(1) }, { ...p, status: 'refunded', updated_at: ver(2) }]
    await Promise.all((Math.random() < 0.5 ? pair : pair.reverse()).map((r) => repo.projectEventPass(r)))
    return (await db.doc(`users/${free.uid}/eventPasses/${p.stripe_payment_intent_id}`).get()).data().status
  }))
  check('50 concurrent activation/refund pairs → 0 regressions', out.every((s) => s === 'refunded'))

  // ── source selection used by the callables (real Firestore documents) ──
  const { selectEventEntitlements } = await import('../../../firebase/functions/src/entitlements/source')
  const fresh = await testAccount('free')                                   // client-created style: plan.source 'default'
  const Ef = await seedEvent(fresh.uid); const evDoc = async (id: string) => (await db.doc(`events/${id}`).get()).data()
  const sel0 = await selectEventEntitlements(fdb, Ef.id, await evDoc(Ef.id))
  check('legacy-backed event + owner without server plan → legacy_projected_fallback (Firestore cannot remove access)', sel0.source === 'legacy_projected_fallback' && sel0.ent === null)
  await repo.projectLegacyPlan({ id: fresh.legacy, plan: 'pro', updated_at: ver(1) })
  const sel1 = await selectEventEntitlements(fdb, Ef.id, await evDoc(Ef.id))
  check('owner plan written by the server (legacy projection) → firestore entitlements, final', sel1.source === 'firestore' && sel1.ent.accountTier === 'pro' && sel1.ent.gates.dedications === false)
  await repo.projectEventPass(pass(fresh.legacy, { session_id: Ef.legacy }))
  const sel2 = await selectEventEntitlements(fdb, Ef.id, await evDoc(Ef.id))
  check('pro owner + pass for THIS event → firestore, dedications/polls open, effective tier stays pro (legacy quirk)', sel2.source === 'firestore' && sel2.ent.gates.dedications && sel2.ent.gates.polls && sel2.ent.effectiveTier === 'pro' && !sel2.ent.gates.remoteGames)
  await db.doc(`events/${Ef.id}`).update({ legacySupabaseId: FieldDelete() })
  const noLegacy = await selectEventEntitlements(fdb, Ef.id, await evDoc(Ef.id))
  check('fully-Firebase event (no legacy id) always uses firestore entitlements', noLegacy.source === 'firestore')
  const lone = await testAccount('free'); const El = await seedEvent(lone.uid); await db.doc(`events/${El.id}`).update({ legacySupabaseId: FieldDelete() })
  const sel4 = await selectEventEntitlements(fdb, El.id, await evDoc(El.id))
  check('fully-Firebase event, owner with default plan → firestore says free (no legacy field to fall back to)', sel4.source === 'firestore' && sel4.ent.eventAccess === false)

  // ── rules on the cloud (client SDK, real users) ──
  const me = await signedIn(free), other = await signedIn(await testAccount('free'))
  check('client reads its own user document and plan', (await getDoc(doc(me.db, 'users', free.uid))).data()?.plan.tier === 'free')
  for (const [label, patch] of [['plan.tier', { 'plan.tier': 'wedding' }], ['plan object', { plan: { tier: 'wedding', source: 'legacy' } }], ['plan.validUntil', { 'plan.validUntil': future(999) }],
                                ['plan.source', { 'plan.source': 'stripe' }], ['legacySupabaseId', { legacySupabaseId: 'victim' }]] as const) {
    check(`client cannot update ${label}`, await denied(updateDoc(doc(me.db, 'users', free.uid), patch as any)))
  }
  check('client cannot overwrite its user doc with a wedding plan', await denied(setDoc(doc(me.db, 'users', free.uid), { uid: free.uid, email: free.email, plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })))
  check("another account cannot read someone else's user document", await denied(getDoc(doc(other.db, 'users', free.uid))))
  const passId = p1.stripe_payment_intent_id
  check('client cannot create / update / delete Event Passes', (await denied(addDoc(collection(me.db, 'users', free.uid, 'eventPasses'), { status: 'active', validUntil: future(99) })))
    && (await denied(updateDoc(doc(me.db, 'users', free.uid, 'eventPasses', passId), { status: 'active', validUntil: future(99) }))) && (await denied(deleteDoc(doc(me.db, 'users', free.uid, 'eventPasses', passId)))))
  check("collectionGroup('eventPasses') denied", await denied(getDocs(collectionGroup(me.db, 'eventPasses'))))
  check('pass holder CAN get its own Event Pass', (await getDoc(doc(me.db, 'users', free.uid, 'eventPasses', passId))).data()?.status === 'refunded')
  check('pass holder CAN list its own Event Passes', (await getDocs(collection(me.db, 'users', free.uid, 'eventPasses'))).size >= 2)
  check('other account cannot get / list the passes of someone else', (await denied(getDoc(doc(other.db, 'users', free.uid, 'eventPasses', passId)))) && (await denied(getDocs(collection(other.db, 'users', free.uid, 'eventPasses')))))
  const out0 = initializeApp(webConfig, `signedout-${Date.now()}`); const odb = getFirestore(out0)
  check('unauthenticated cannot get / list Event Passes', (await denied(getDoc(doc(odb, 'users', free.uid, 'eventPasses', passId)))) && (await denied(getDocs(collection(odb, 'users', free.uid, 'eventPasses')))))
  await deleteApp(out0)
  check('after all spoof attempts the server verdict is unchanged', (await db.doc(`users/${free.uid}`).get()).data().plan.tier === 'free')
  await deleteApp(me.app); await deleteApp(other.app)

  check('zero Supabase: no SUPABASE env, 0 fetch to *supabase*, no Supabase module', fetched.every((u) => !/supabase/i.test(u)) && !Object.keys(require.cache ?? {}).some((k) => /supabase/i.test(k) && !/node_modules/.test(k)), `fetch calls=${fetched.length}`)
  return { ownerBefore, usersBefore }
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt); const stdin = process.stdin
    if (!stdin.isTTY) { let d = ''; stdin.on('data', (c) => (d += c)); stdin.on('end', () => resolve(d.trim())); return }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8'); let buf = ''
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); resolve(buf) }
      else if (ch === '\u0003') process.exit(130); else if (ch === '\u007f') buf = buf.slice(0, -1); else buf += ch
    }
    stdin.on('data', onData)
  })
}
/** REAL owner: read-only. Nothing is written to the owner's documents; every write attempt must be denied. */
async function ownerMode() {
  const i = process.argv.indexOf('--email'); const email = i > 0 ? process.argv[i + 1] : undefined
  if (!email) throw new Error('usage: entitlements-cloud-check.ts owner --email <owner email>')
  const before = await db.doc(`users/${OWNER_UID}`).get()
  const password = await askHidden(`Password for ${email} (hidden): `)
  const app = initializeApp(webConfig, `owner-${Date.now()}`)
  const cred = await signInWithEmailAndPassword(getAuth(app), email, password); assert.equal(cred.user.uid, OWNER_UID, 'not the owner uid')
  const cdb = getFirestore(app), u = doc(cdb, 'users', OWNER_UID)
  const mine = (await getDoc(u)).data()
  check('OWNER reads own user document and plan', !!mine?.plan?.tier, `tier=${mine?.plan?.tier} source=${mine?.plan?.source}`)
  for (const [label, patch] of [['plan.tier', { 'plan.tier': 'free' }], ['plan.validUntil', { 'plan.validUntil': future(1) }], ['plan.source', { 'plan.source': 'stripe' }], ['legacySupabaseId', { legacySupabaseId: 'x' }]] as const) {
    check(`OWNER cannot update ${label}`, await denied(updateDoc(u, patch as any)))
  }
  check('OWNER cannot create an Event Pass', await denied(addDoc(collection(cdb, 'users', OWNER_UID, 'eventPasses'), { status: 'active', validUntil: future(99) })))
  check('OWNER can list own eventPasses (rule deployed)', await getDocs(collection(cdb, 'users', OWNER_UID, 'eventPasses')).then(() => true, () => false))
  check("OWNER collectionGroup('eventPasses') denied", await denied(getDocs(collectionGroup(cdb, 'eventPasses'))))
  const after = await db.doc(`users/${OWNER_UID}`).get()
  check('owner document untouched (data + updateTime)', JSON.stringify(after.data()) === JSON.stringify(before.data()) && after.updateTime.isEqual(before.updateTime))
  await deleteApp(app)
}

async function cleanup(ctx?: Awaited<ReturnType<typeof run>>) {
  const ids = new Set(state.events)
  for (const ref of await db.collection('events').listDocuments()) if (ref.id.startsWith(PREFIX)) ids.add(ref.id)
  for (const id of ids) await db.recursiveDelete(db.doc(`events/${id}`))
  for (const uid of state.users) { await db.recursiveDelete(db.doc(`users/${uid}`)); await auth.deleteUser(uid).catch((e) => { if (e.code !== 'auth/user-not-found') throw e }) }
  const strays = (await auth.listUsers(1000)).users.filter((u) => u.email?.endsWith('@example.invalid')); for (const u of strays) { await db.recursiveDelete(db.doc(`users/${u.uid}`)); await auth.deleteUser(u.uid) }
  state.events = []; state.users = []; save()
  const left = (await db.collection('events').listDocuments()).filter((r) => r.id.startsWith(PREFIX)).length
  const passesLeft = (await db.collectionGroup('eventPasses').count().get()).data().count
  const testUsersLeft = (await auth.listUsers(1000)).users.filter((u) => u.email?.endsWith('@example.invalid')).length
  const owner = await db.doc(`users/${OWNER_UID}`).get(), usersNow = (await db.collection('users').listDocuments()).length
  const ownerOk = owner.exists && owner.data()?.plan?.tier === 'wedding' && (!ctx || (JSON.stringify(owner.data()) === JSON.stringify(ctx.ownerBefore.data()) && owner.updateTime.isEqual(ctx.ownerBefore.updateTime)))
  console.log(JSON.stringify({ testEventsLeft: left, eventPassDocsLeftInProject: passesLeft, testAuthUsersLeft: testUsersLeft, ownerDocIntact: ownerOk, usersDocsNow: usersNow, usersDocsBefore: ctx?.usersBefore ?? 'n/a' }))
  check('cleanup: 0 test events, 0 eventPasses docs, 0 test Auth users, owner intact, user docs count back to baseline',
    left === 0 && passesLeft === 0 && testUsersLeft === 0 && ownerOk && (!ctx || usersNow === ctx.usersBefore))
}

void (async () => {
  let ctx
  try { if (process.argv[2] === 'owner') await ownerMode(); else if (process.argv[2] !== 'cleanup') ctx = await run() }
  catch (e) { results.push(false); console.error('FATAL', e) }
  finally { if (process.argv[2] !== 'owner') await cleanup(ctx) }
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1)
})()
