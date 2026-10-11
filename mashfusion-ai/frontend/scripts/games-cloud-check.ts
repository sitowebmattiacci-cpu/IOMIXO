// @ts-nocheck -- dev-only script: imports firebase-admin and backend sources that are not part of the frontend type graph
/**
 * Cloud check of the live_game_rounds → Firestore projection on iomixo-494817. TEST DATA ONLY.
 *
 *   FIREBASE_PROJECT_ID=iomixo-494817 npx tsx scripts/games-cloud-check.ts            (run, always cleans up)
 *   FIREBASE_PROJECT_ID=iomixo-494817 npx tsx scripts/games-cloud-check.ts cleanup    (cleanup + verification only)
 *   FIREBASE_PROJECT_ID=iomixo-494817 NODE_PATH=../backend/node_modules npx tsx scripts/games-cloud-check.ts owner --email <owner email>
 *       real OWNER login (email + password typed at a HIDDEN prompt, never printed/stored); read-only checks on a throw-away test event.
 *
 * - Uses the REAL backend projection code (flag-gated wrappers in services/eventProjection + repositories/gameRoundRepository)
 *   fed with synthetic rows shaped like live_game_rounds. The two projection flags are set inside THIS process only.
 * - Never touches Supabase: no SUPABASE_* env, no config/supabase module loaded, every outgoing fetch URL is recorded and checked.
 * - Events `firebase-test-games-*` (testData:true). Cleanup removes them recursively, plus every Auth user the run created.
 * - Admin access through Application Default Credentials; client access through the PUBLIC web config in .env.production.local.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import { initializeApp as initAdmin } from 'firebase-admin/app'
import { getFirestore as adminDb, Timestamp } from 'firebase-admin/firestore'
import { getAuth as adminAuth } from 'firebase-admin/auth'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { getAuth, signInAnonymously, signInWithCustomToken, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, collectionGroup, type Firestore } from 'firebase/firestore'
import { subscribeLatestGame } from '../lib/firebase/repositories/gameRepository'
import type { GameRoundDoc, GameType } from '../lib/firebase/models'

const PROJECT = 'iomixo-494817'
const OWNER_UID = 'z5EDSZrgFDXMjCrRCB4cMEidoaL2'
const PREFIX = 'firebase-test-games-'
const STATE = __dirname + '/.games-cloud-state.json'
const ENV = __dirname + '/../.env.production.local'

if (process.env.FIREBASE_PROJECT_ID !== PROJECT) throw new Error('set FIREBASE_PROJECT_ID=' + PROJECT)
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('emulator env set: refusing')
if (Object.keys(process.env).some((k) => k.startsWith('SUPABASE'))) throw new Error('SUPABASE_* env present: refusing')

// Flags live ONLY in this process (read by the backend at call time).
process.env.FIRESTORE_EVENT_PROJECTION = 'on'
process.env.FIRESTORE_GAMES_PROJECTION = 'on'

// Zero-Supabase evidence: record every outgoing fetch URL.
const fetched: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = ((input: any, init?: any) => { fetched.push(String(input?.url ?? input)); return realFetch(input, init) }) as typeof fetch

const env = Object.fromEntries(readFileSync(ENV, 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const webConfig = {
  apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
}
assert.equal(webConfig.projectId, PROJECT)

initAdmin({ projectId: PROJECT })
const db = adminDb(), auth = adminAuth()
type State = { events: string[]; users: string[] }
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { events: [], users: [] }
const save = () => writeFileSync(STATE, JSON.stringify(state))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const results: boolean[] = []
const check = (name: string, ok: boolean, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const same = (a: unknown, b: unknown) => { try { assert.deepStrictEqual(a, b); return true } catch { return false } } // Firestore returns map keys sorted: compare structurally
const denied = async (p: Promise<unknown>) => { try { await p; return false } catch (e) { return (e as { code?: string }).code === 'permission-denied' } }

interface Client { app: FirebaseApp; db: Firestore; uid: string | null }
let n = 0
async function client(kind: 'anonymous' | 'owner' | 'account' | 'none'): Promise<Client> {
  const app = initializeApp(webConfig, `c${Date.now()}-${n++}`)
  const cdb = getFirestore(app)
  if (kind === 'none') return { app, db: cdb, uid: null }
  const a = getAuth(app)
  if (kind === 'anonymous') { const c = await signInAnonymously(a); state.users.push(c.user.uid); save(); return { app, db: cdb, uid: c.user.uid } }
  if (kind === 'owner') {
    // Needs iam.serviceAccounts.signBlob on the ADC identity. We do NOT escalate (no impersonation): if it is missing the owner leg is SKIPPED and reported.
    try { const c = await signInWithCustomToken(a, await auth.createCustomToken(OWNER_UID)); assert.equal(c.user.uid, OWNER_UID); return { app, db: cdb, uid: OWNER_UID } }
    catch (e) { console.log(`SKIP  owner sign-in unavailable (${(e as { code?: string }).code ?? 'error'}): no custom-token signing permission and no owner password in this environment`); await deleteApp(app); return null as any }
  }
  const c = await createUserWithEmailAndPassword(a, `games-test-${Date.now()}-${n}@example.invalid`, 'Test-' + Math.random().toString(36).slice(2) + 'Aa1!')
  state.users.push(c.user.uid); save(); return { app, db: cdb, uid: c.user.uid }
}

async function seedEvent(): Promise<{ id: string; legacy: string }> {
  const id = `${PREFIX}${Date.now().toString(36)}-${n++}`, legacy = `mock-session-${id}`
  await db.doc(`events/${id}`).set({
    ownerUid: OWNER_UID, slug: id, legacySupabaseId: legacy, title: 'TEST GAMES EVENT', djName: 'test', description: null,
    type: 'wedding', status: 'live', screenModeEnabled: false, guestConfig: { requests: true }, requestLimit: 30,
    dedicationsEnabled: true, testData: true, createdAt: new Date(), updatedAt: new Date(),
  })
  state.events.push(id); save()
  return { id, legacy }
}

/** Synthetic live_game_rounds row. Versions are Postgres-style microsecond timestamps: ver(n) is strictly increasing in n. */
let seq = 0
const BASE_MS = Date.parse('2026-03-01T10:00:00Z')
const ver = (n: number) => `2026-03-01T10:00:00.${String(100000 + n).padStart(6, '0')}+00:00`
const row = (session_id: string, game_type: 'wedding_roulette' | 'shoe_game', over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(Date.now()).slice(-8)}${String(seq++).padStart(4, '0')}`, session_id, game_type,
  status: 'idle' as 'idle' | 'running' | 'completed', config: null as any, result: null as any,
  created_at: '2026-03-01T09:59:58.654321+00:00', updated_at: ver(0), ...over,
})
const shuffle = <T,>(a: T[]) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]] } return r }

/** Listener recorder: waits for a condition on the latest round of one type. */
function watch(c: Client, eventId: string, type: GameType) {
  const seen: Array<GameRoundDoc | null> = []
  const errors: Error[] = []
  const stop = subscribeLatestGame(c.db, eventId, type, (r) => seen.push(r), (e) => errors.push(e))
  const until = async (pred: (r: GameRoundDoc | null) => boolean, ms = 8000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) { if (seen.length && pred(seen.at(-1)!)) return Date.now() - t0; if (errors.length) return -1; await sleep(50) }
    return -1
  }
  return { seen, errors, stop, until, last: () => seen.at(-1) ?? null }
}

async function run() {
  const proj = await import('../../backend/src/services/eventProjection')
  const repo = await import('../../backend/src/repositories/gameRoundRepository')
  const ownerBefore = await db.doc(`users/${OWNER_UID}`).get()
  const eventsBefore = (await db.collection('events').listDocuments()).filter((r) => !r.id.startsWith(PREFIX)).length

  const E = await seedEvent(), E2 = await seedEvent()
  console.log(`# events: ${E.id}, ${E2.id}`)
  const gamesOf = async (id: string) => (await db.collection(`events/${id}/games`).get()).docs
  const guest = await client('anonymous'), owner = await client('owner'), other = await client('account'), anon0 = await client('none')

  const srcOf = async (eventId: string, id: string) => (await db.doc(`events/${eventId}/games/${id}`).get()).data()!
  const micros = (t: Timestamp) => t.seconds * 1e6 + Math.round(t.nanoseconds / 1000)
  const warns: string[] = []
  const realWarn = console.warn; console.warn = (...a: unknown[]) => { warns.push(String(a[0])); realWarn(...a) }

  // ───────── ROULETTE (DJ route semantics) ─────────
  const w = watch(guest, E.id, 'wedding_roulette')
  const penit = [{ label: 'Brindisi agli sposi', category: 'soft', enabled: true }, { label: 'Ballo di gruppo', category: 'party', enabled: true }, { label: 'Shot misterioso', category: 'wild', enabled: false }]
  const cfg = { penitenze: penit, categories: ['soft', 'party'] }
  const r1 = row(E.legacy, 'wedding_roulette', { status: 'idle', config: cfg, updated_at: ver(1) })
  await proj.projectGameRounds([] as any) // DJ start: nothing to close yet
  await proj.projectGameRound(r1 as any)
  const ms1 = await w.until((r) => r?.id === r1.id)
  const d1 = await srcOf(E.id, r1.id)
  check('roulette create: Firestore id == legacy id, legacySupabaseId set', d1.legacySupabaseId === r1.id && (await gamesOf(E.id)).length === 1)
  check('roulette create: type/status idle/result null, config identical', d1.type === 'wedding_roulette' && d1.status === 'idle' && d1.result === null && same(d1.config, cfg))
  check('createdAt == DB created_at (µs exact); sourceUpdatedAt == DB updated_at (µs exact)',
    micros(d1.createdAt) === Math.floor(Date.parse('2026-03-01T09:59:58Z') / 1000) * 1e6 + 654321 && micros(d1.sourceUpdatedAt) === Math.floor(BASE_MS / 1000) * 1e6 + 100001)
  check('roulette create → realtime listener', ms1 >= 0, `${ms1}ms`)

  const picked = { slot_index: 1, slot_label: 'Ballo di gruppo', category: 'party', picked_at: '2026-03-01T10:00:00.2Z' }
  await proj.projectGameRound({ ...r1, status: 'completed', result: picked, updated_at: ver(2) } as any) // DJ spin → completed
  check('roulette DJ spin (completed+result) → listener', (await w.until((r) => r?.status === 'completed' && r.result?.slot_label === 'Ballo di gruppo')) >= 0)
  const d2 = await srcOf(E.id, r1.id)
  check('result preserved verbatim, createdAt unchanged, sourceUpdatedAt advanced', same(d2.result, picked) && micros(d2.createdAt) === micros(d1.createdAt) && micros(d2.sourceUpdatedAt) === micros(d1.sourceUpdatedAt) + 1)

  // remote semantics: start → idle (config.slots), spin → running+result, reset → idle/result null
  const r2 = row(E.legacy, 'wedding_roulette', { status: 'idle', config: { slots: ['A', 'B', 'C'] }, created_at: '2026-03-01T10:00:00.050000+00:00', updated_at: ver(10) })
  await proj.projectGameRound(r2 as any)
  check('remote start: newest round (by DB created_at) → listener switches id; createdAt is the DB value', (await w.until((r) => r?.id === r2.id)) >= 0 && micros((await srcOf(E.id, r2.id)).createdAt) === Math.floor(BASE_MS / 1000) * 1e6 + 50000)
  await proj.projectGameRound({ ...r2, status: 'running', result: { slot_index: 2, slot_label: 'C', picked_at: 'x' }, updated_at: ver(11) } as any)
  check('remote spin (running+result) → listener', (await w.until((r) => r?.status === 'running' && r.result?.slot_label === 'C')) >= 0)
  await proj.projectGameRound({ ...r2, status: 'idle', result: null, updated_at: ver(12) } as any)
  check('remote reset (idle/result null) → listener, config.slots intact', (await w.until((r) => r?.status === 'idle' && r.result === null && r.id === r2.id)) >= 0 && same(w.last()?.config, { slots: ['A', 'B', 'C'] }))
  // DJ reset: the rows returned by the bulk update (idle/running → completed, result null) are projected one by one
  await proj.projectGameRound({ ...r2, status: 'running', result: { slot_label: 'A' }, updated_at: ver(13) } as any)
  await proj.projectGameRounds([{ ...r2, status: 'completed', result: null, updated_at: ver(14) }] as any)
  check('DJ reset bulk rows → completed, result null → listener', (await w.until((r) => r?.id === r2.id && r.status === 'completed' && r.result === null)) >= 0)
  check('unknown game type / unprojected session / row without versions never projected',
    (await repo.projectGameRound(row(E.legacy, 'stand_up' as any) as any)) === 'invalid' && (await repo.projectGameRound(row('no-such-session', 'shoe_game') as any)) === 'no_event'
    && (await repo.projectGameRound({ ...row(E.legacy, 'shoe_game'), updated_at: undefined } as any)) === 'invalid' && (await gamesOf(E.id)).length === 2)

  // ───────── SHOE GAME ─────────
  const s = watch(guest, E.id, 'shoe_game')
  const questions = ['Chi ha fatto il primo passo?', 'Chi è più geloso?', "Chi ama di più l'altro? ❤️"]
  const sh = row(E.legacy, 'shoe_game', { status: 'running', config: { questions, current_index: 0, is_active: true }, updated_at: ver(20) })
  await proj.projectGameRound(sh as any)
  check('shoe start → listener; questions (accents, emoji) identical', (await s.until((r) => r?.id === sh.id)) >= 0 && same(s.last()?.config, sh.config))
  await proj.projectGameRound({ ...sh, config: { ...sh.config, current_index: 1 }, updated_at: ver(21) } as any)
  check('shoe next (current_index 1) → listener', (await s.until((r) => (r?.config as any)?.current_index === 1)) >= 0)
  await proj.projectGameRound({ ...sh, status: 'completed', config: { questions, current_index: 2, is_active: false }, result: { finished_at: '2026-03-01T10:00:01Z', total: 3 }, updated_at: ver(22) } as any)
  check('shoe finished (completed + result.total) → listener', (await s.until((r) => r?.status === 'completed' && (r.result as any)?.total === 3)) >= 0)
  await proj.projectGameRound({ ...sh, status: 'idle', config: { questions: [], current_index: 0, is_active: false }, result: null, updated_at: ver(23) } as any)
  check('shoe remote reset (idle, empty config) → listener', (await s.until((r) => r?.status === 'idle' && (r.config as any)?.questions.length === 0)) >= 0)
  const sh2 = row(E.legacy, 'shoe_game', { status: 'running', config: { questions, current_index: 0, is_active: true }, created_at: '2026-03-01T10:00:05.000001+00:00', updated_at: ver(30) })
  await proj.projectGameRounds([{ ...sh, status: 'completed', updated_at: ver(29) }] as any) // DJ start closes the previous idle/running round
  await proj.projectGameRound(sh2 as any)
  check('shoe DJ start: previous round closed, new one is latest', (await s.until((r) => r?.id === sh2.id)) >= 0 && (await srcOf(E.id, sh.id)).status === 'completed')
  await proj.projectGameRounds([{ ...sh2, status: 'completed', result: null, updated_at: ver(31) }] as any)
  check('shoe DJ reset bulk → completed → listener', (await s.until((r) => r?.id === sh2.id && r.status === 'completed')) >= 0)
  check('roulette listener never saw shoe docs and vice versa', w.seen.every((r) => r === null || r.type === 'wedding_roulette') && s.seen.every((r) => r === null || r.type === 'shoe_game'))
  check('no listener error (index + rules OK on cloud)', w.errors.length === 0 && s.errors.length === 0)
  w.stop(); s.stop()

  // ───────── RULES (real SDK) ─────────
  const target = (await gamesOf(E.id))[0].id
  for (const [label, c] of ([['owner', owner], ['anonymous guest', guest]] as const).filter(([, c]) => c)) {
    check(`${label} can get a game`, (await getDoc(doc(c.db, 'events', E.id, 'games', target))).exists())
    check(`${label} can list games of the event`, (await getDocs(collection(c.db, 'events', E.id, 'games'))).size === (await gamesOf(E.id)).length)
  }
  check('unauthenticated get denied', await denied(getDoc(doc(anon0.db, 'events', E.id, 'games', target))))
  check('unauthenticated list denied', await denied(getDocs(collection(anon0.db, 'events', E.id, 'games'))))
  for (const [label, c] of ([['owner', owner], ['guest', guest], ['other account', other]] as const).filter(([, c]) => c)) {
    check(`${label}: create denied`, await denied(addDoc(collection(c.db, 'events', E.id, 'games'), { type: 'shoe_game', status: 'running' })))
    check(`${label}: set denied`, await denied(setDoc(doc(c.db, 'events', E.id, 'games', 'evil'), { type: 'wedding_roulette', status: 'idle' })))
    check(`${label}: update denied`, await denied(updateDoc(doc(c.db, 'events', E.id, 'games', target), { status: 'completed', result: { slot_label: 'EVIL' }, sourceUpdatedAt: new Date() })))
    check(`${label}: delete denied`, await denied(deleteDoc(doc(c.db, 'events', E.id, 'games', target))))
  }
  await proj.projectGameRound(row(E2.legacy, 'shoe_game', { status: 'running', config: { questions: ['x'], current_index: 0, is_active: true } }) as any)
  for (const [label, c] of ([['owner', owner], ['guest', guest], ['other', other], ['unauthenticated', anon0]] as const).filter(([, c]) => c)) {
    check(`${label}: collectionGroup('games') denied (no cross-event enumeration)`, await denied(getDocs(collectionGroup(c.db, 'games'))))
  }
  check('no game was modified/created by the denied writes', (await gamesOf(E.id)).every((d) => d.id !== 'evil') && (await srcOf(E.id, target)).result?.slot_label !== 'EVIL')

  // ───────── ORDERING / CONCURRENCY ─────────
  // (a) idempotency: the same DB version replayed N times is a no-op (no write, updatedAt untouched)
  const idem = row(E.legacy, 'shoe_game', { status: 'running', config: { questions, current_index: 1, is_active: true }, updated_at: ver(40) })
  const first = await repo.projectGameRound(idem as any); const upd0 = (await srcOf(E.id, idem.id)).updatedAt
  const again = await Promise.all([1, 2, 3, 4, 5].map(() => repo.projectGameRound(idem as any)))
  check('idempotency: same updated_at replayed 5x → 1 create + 5 duplicate, document not rewritten', first === 'created' && again.every((x) => x === 'duplicate') && (await srcOf(E.id, idem.id)).updatedAt.isEqual(upd0))
  // (b) deterministic reversed order: NEW then OLD
  const rev = row(E.legacy, 'shoe_game', { status: 'running', config: { questions, current_index: 0, is_active: true }, updated_at: ver(50) })
  await repo.projectGameRound(rev as any)
  await repo.projectGameRound({ ...rev, config: { ...rev.config, current_index: 2 }, updated_at: ver(52) } as any)
  const warnsBefore = warns.length
  const staleRes = await repo.projectGameRound({ ...rev, config: { ...rev.config, current_index: 1 }, updated_at: ver(51) } as any)
  check('reversed order (v52 applied, then v51 arrives) → stale_ignored, state stays at index 2', staleRes === 'stale_ignored' && (await srcOf(E.id, rev.id)).config.current_index === 2)
  const logLine = warns.slice(warnsBefore).find((l) => l.includes('stale_ignored'))
  check('structured stale log: projection=games result=stale_ignored eventId roundId, no payload',
    !!logLine && same(JSON.parse(logLine!), { projection: 'games', result: 'stale_ignored', eventId: E.id, roundId: rev.id }))
  // (c) 50 concurrent old/new pairs on 50 rounds, random issue order
  const t0 = Date.now()
  const finals = await Promise.all(Array.from({ length: 50 }, async () => {
    const r = row(E.legacy, 'shoe_game', { status: 'running', config: { questions, current_index: 0, is_active: true }, updated_at: ver(60) })
    await repo.projectGameRound(r as any)
    const oldU = { ...r, config: { ...r.config, current_index: 1 }, updated_at: ver(61) }, newU = { ...r, config: { ...r.config, current_index: 2 }, updated_at: ver(62) }
    await Promise.all(shuffle([oldU, newU]).map((u) => repo.projectGameRound(u as any)))
    return (await srcOf(E.id, r.id)).config.current_index
  }))
  const regress = finals.filter((i) => i !== 2).length
  console.log(`# concurrency: 50 old/new pairs, regressions to the older state = ${regress} (${Date.now() - t0} ms total)`)
  check('50 concurrent old/new pairs → 0 regressions (always the NEW state)', regress === 0 && finals.length === 50)
  // (d) many consecutive "next" presses on the SAME round, any arrival order
  const nx = row(E.legacy, 'shoe_game', { status: 'running', config: { questions, current_index: 0, is_active: true }, updated_at: ver(70) })
  await repo.projectGameRound(nx as any)
  const t1 = Date.now()
  await Promise.all(shuffle(Array.from({ length: 8 }, (_, i) => ({ ...nx, config: { ...nx.config, current_index: i + 1 }, updated_at: ver(71 + i) }))).map((u) => repo.projectGameRound(u as any)))
  console.log(`# 8 contended writers on ONE document took ${Date.now() - t1} ms`)
  check('8 racing "next" updates on one round → highest version wins (index 8)', (await srcOf(E.id, nx.id)).config.current_index === 8)
  // (e) spin vs reset racing
  const sp = row(E.legacy, 'wedding_roulette', { config: cfg, updated_at: ver(80) }); await repo.projectGameRound(sp as any)
  await Promise.all(shuffle([{ ...sp, status: 'running', result: { slot_label: 'S' }, updated_at: ver(81) }, { ...sp, status: 'idle', result: null, updated_at: ver(82) }]).map((u) => repo.projectGameRound(u as any)))
  const spf = await srcOf(E.id, sp.id)
  check('spin(v81) vs reset(v82) racing → reset (newer) wins', spf.status === 'idle' && spf.result === null)
  // (f) bulk with a stale row cannot overwrite a newer projection
  const bk = row(E.legacy, 'shoe_game', { status: 'running', config: { questions, current_index: 0, is_active: true }, updated_at: ver(90) })
  await repo.projectGameRound({ ...bk, status: 'completed', updated_at: ver(95) } as any)
  const bulk = await repo.projectGameRounds([{ ...bk, status: 'completed', result: null, updated_at: ver(93) }] as any)
  check('stale bulk row (v93 < v95) ignored', bulk[0] === 'stale_ignored')
  console.warn = realWarn

  // ───────── ZERO SUPABASE ─────────
  const loaded = Object.keys(require.cache ?? {}).filter((k) => /supabase/i.test(k) && !/node_modules/.test(k))
  check('zero Supabase: no outgoing fetch to *supabase*, no SUPABASE env, no backend supabase module loaded',
    fetched.every((u) => !/supabase/i.test(u)) && !Object.keys(process.env).some((k) => k.startsWith('SUPABASE')) && loaded.length === 0, `fetch calls=${fetched.length}`)

  for (const c of [guest, owner, other, anon0].filter(Boolean)) await deleteApp(c.app)
  return { ownerBefore, eventsBefore }
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt)
    const stdin = process.stdin
    if (!stdin.isTTY) { let d = ''; stdin.on('data', (c) => (d += c)); stdin.on('end', () => resolve(d.trim())); return }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8')
    let buf = ''
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); resolve(buf) }
      else if (ch === '\u0003') process.exit(130)
      else if (ch === '\u007f') buf = buf.slice(0, -1)
      else buf += ch
    }
    stdin.on('data', onData)
  })
}

/** REAL owner leg. Read-only on the cloud: a throw-away test event + one test game are seeded with Admin, the owner only reads / tries to write. */
async function ownerMode() {
  const i = process.argv.indexOf('--email'); const email = i > 0 ? process.argv[i + 1] : undefined
  if (!email) throw new Error('usage: games-cloud-check.ts owner --email <owner email>')
  const proj = await import('../../backend/src/services/eventProjection')
  const E = await seedEvent(); const r = row(E.legacy, 'wedding_roulette', { config: { penitenze: [{ label: 'A', category: 'soft', enabled: true }] }, updated_at: ver(1) })
  await proj.projectGameRound(r as any)
  const password = await askHidden(`Password for ${email} (hidden): `)
  const app = initializeApp(webConfig, `owner-${Date.now()}`)
  const cred = await signInWithEmailAndPassword(getAuth(app), email, password)
  assert.equal(cred.user.uid, OWNER_UID, 'signed-in account is not the owner uid')
  const cdb = getFirestore(app)
  check('OWNER get game of own event', (await getDoc(doc(cdb, 'events', E.id, 'games', r.id))).exists())
  check('OWNER list games of own event', (await getDocs(collection(cdb, 'events', E.id, 'games'))).size === 1)
  check('OWNER create denied', await denied(addDoc(collection(cdb, 'events', E.id, 'games'), { type: 'shoe_game', status: 'running' })))
  check('OWNER update denied', await denied(updateDoc(doc(cdb, 'events', E.id, 'games', r.id), { status: 'completed' })))
  check('OWNER delete denied', await denied(deleteDoc(doc(cdb, 'events', E.id, 'games', r.id))))
  check("OWNER collectionGroup('games') denied", await denied(getDocs(collectionGroup(cdb, 'games'))))
  check('game untouched by the denied writes', (await db.doc(`events/${E.id}/games/${r.id}`).get()).data()?.status === 'idle')
  await deleteApp(app)
}

async function cleanup(ctx?: { ownerBefore: FirebaseFirestore.DocumentSnapshot; eventsBefore: number }) {
  const ids = new Set(state.events)
  for (const ref of await db.collection('events').listDocuments()) if (ref.id.startsWith(PREFIX)) ids.add(ref.id)
  for (const id of ids) await db.recursiveDelete(db.doc(`events/${id}`))
  for (const uid of state.users) await auth.deleteUser(uid).catch((e) => { if (e.code !== 'auth/user-not-found') throw e })
  state.events = []; state.users = []; save()
  const left = (await db.collection('events').listDocuments()).filter((r) => r.id.startsWith(PREFIX)).length
  const gamesLeft = (await db.collectionGroup('games').count().get()).data().count
  const stray = (await auth.listUsers(1000)).users.filter((u) => u.email?.endsWith('@example.invalid') || u.providerData.length === 0 && u.uid !== OWNER_UID).length
  const owner = await db.doc(`users/${OWNER_UID}`).get()
  const ownerOk = owner.exists && owner.data()?.plan?.tier === 'wedding' && (!ctx || (JSON.stringify(owner.data()) === JSON.stringify(ctx.ownerBefore.data()) && owner.updateTime!.isEqual(ctx.ownerBefore.updateTime!)))
  const evTotal = (await db.collection('events').listDocuments()).length
  console.log(JSON.stringify({ testEventsLeft: left, gamesDocsLeftInProject: gamesLeft, anonymousOrTestAuthUsersLeft: stray, ownerDocIntact: ownerOk, eventsTotal: evTotal, nonTestEventsUnchanged: ctx ? evTotal === ctx.eventsBefore : 'n/a' }))
  check('cleanup: 0 test events, 0 games docs, 0 anonymous/test users, owner intact, no real event touched',
    left === 0 && gamesLeft === 0 && stray === 0 && ownerOk && (!ctx || evTotal === ctx.eventsBefore))
}

void (async () => {
  let ctx: Awaited<ReturnType<typeof run>> | undefined
  try {
    if (process.argv[2] === 'owner') await ownerMode()
    else if (process.argv[2] !== 'cleanup') ctx = await run()
  } catch (e) { results.push(false); console.error('FATAL', e) }
  finally { await cleanup(ctx) }
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
  process.exit(results.every(Boolean) ? 0 : 1)
})()
