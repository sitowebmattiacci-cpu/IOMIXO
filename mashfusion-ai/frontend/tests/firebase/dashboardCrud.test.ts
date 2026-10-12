import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { doc, getDoc } from 'firebase/firestore'
import { deleteApp } from 'firebase/app'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { seedSet } from './seed'
import { getFirebaseAuth, getFirebaseApp, getFirebaseDb } from '../../lib/firebase/client'

/**
 * Whole owner cycle through lib/api.ts with NEXT_PUBLIC_FIRESTORE_DASHBOARD on and a Render that answers 503 to everything and records every call:
 * create → list → detail → edit core fields / config → game customisation → roulette → shoe game → delete.
 * The proof of "no Render, no Supabase" is that the recorded call list stays EMPTY.
 */
const calls: Array<{ method: string; url: string }> = []
let server: http.Server
let uid = ''
let api: typeof import('../../lib/api')

before(async () => {
  server = http.createServer((req, res) => {
    calls.push({ method: req.method!, url: req.url! })
    res.setHeader('content-type', 'application/json'); res.setHeader('access-control-allow-origin', '*')
    res.statusCode = 503; res.end(JSON.stringify({ error: 'render suspended' }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  process.env.NEXT_PUBLIC_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.NEXT_PUBLIC_FIRESTORE_DASHBOARD = 'true'
  const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), `crud${Date.now()}@example.com`, 'password123')
  uid = cred.user.uid
  await seedSet(`users/${uid}`, { uid, email: cred.user.email, plan: { tier: 'wedding', source: 'legacy' } })
  api = await import('../../lib/api')
})
after(async () => { await new Promise((r) => server.close(r)); await deleteApp(getFirebaseApp()) })

const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any

test('C1. the whole owner cycle runs with Render at 503 and never calls it', async () => {
  const { live, liveGames } = api

  // create → appears in the list → detail
  const s = await live.createSession({ event_name: 'Matrimonio CRUD', dj_name: 'DJ Z', description: 'Desc', session_type: 'wedding', couple_names: 'Anna & Marco', wedding_date: '2026-09-12', venue_name: 'Villa', screen_mode_enabled: true })
  assert.ok(s.id && s.public_slug && s.dj_id === uid); assert.equal(s.session_type, 'wedding'); assert.equal(s.is_active, true)
  assert.equal((await fsGet(`eventSlugs/${s.public_slug}`)).fields.eventId.stringValue, s.id, 'slug maintained atomically')
  assert.ok((await live.listSessions()).some((x) => x.id === s.id && x.event_name === 'Matrimonio CRUD'))
  let d = await live.getSession(s.id)
  assert.deepEqual([d.event_name, d.dj_name, d.description, d.couple_names, d.wedding_date, d.venue_name, d.screen_mode_enabled, d.public_slug], ['Matrimonio CRUD', 'DJ Z', 'Desc', 'Anna & Marco', '2026-09-12', 'Villa', true, s.public_slug])
  assert.equal(d.roulette_penitenze, null); assert.equal(d.shoe_game_questions, null)

  // edit core fields + config in one patch, then close the session
  await live.updateSession(s.id, { event_name: 'Matrimonio Rinominato', dj_name: 'DJ Y', description: 'Nuova', couple_names: 'A & B', wedding_date: '2027-01-01', venue_name: 'Sala', screen_config: { show_polls: true } as any, guest_config: { requests: false } as any })
  await live.updateSession(s.id, { is_active: false })
  d = await live.getSession(s.id)
  assert.deepEqual([d.event_name, d.dj_name, d.couple_names, d.venue_name, d.is_active, d.public_slug], ['Matrimonio Rinominato', 'DJ Y', 'A & B', 'Sala', false, s.public_slug], 'the slug is stable across edits')
  assert.deepEqual(d.screen_config, { show_polls: true }); assert.deepEqual(d.guest_config, { requests: false })
  await live.updateSession(s.id, { is_active: true })

  // custom penalties / questions live in the owner-private doc and come back in getSession (no Render enrichment)
  const pen = [{ label: 'Solo questa', category: 'soft' as const, enabled: true }]
  await live.updateSession(s.id, { roulette_penitenze: pen, shoe_game_questions: ['Q1?', 'Q2?'] })
  d = await live.getSession(s.id); assert.deepEqual(d.roulette_penitenze, pen); assert.deepEqual(d.shoe_game_questions, ['Q1?', 'Q2?'])
  assert.deepEqual((await getDoc(doc(getFirebaseDb(), 'events', s.id, 'private', 'gameConfig'))).data()!.shoeGameQuestions, ['Q1?', 'Q2?'])

  // roulette
  assert.equal(await liveGames.getRouletteState(s.id, s.public_slug), null)
  const r = await liveGames.startRoulette(s.id, ['soft']); assert.equal(r.status, 'idle'); assert.deepEqual((r.config as any).penitenze.map((p: any) => p.label), ['Solo questa'])
  const spun = await liveGames.spinRoulette(s.id); assert.equal(spun.status, 'completed'); assert.equal(spun.result?.slot_label, 'Solo questa'); assert.equal(spun.id, r.id)
  assert.equal((await liveGames.getRouletteState(s.id, s.public_slug))?.result?.slot_label, 'Solo questa')
  await liveGames.resetRoulette(s.id)

  // shoe game
  assert.equal(await liveGames.getShoeState(s.id), null)
  const sh = await liveGames.startShoe(s.id); assert.equal(sh.status, 'running'); assert.deepEqual(sh.config?.questions, ['Q1?', 'Q2?'])
  assert.equal((await liveGames.nextShoe(s.id)).config?.current_index, 1)
  const done = await liveGames.nextShoe(s.id); assert.equal(done.status, 'completed'); assert.equal(done.result?.total, 2)
  assert.equal((await liveGames.getShoeState(s.id))?.status, 'completed')
  await liveGames.resetShoe(s.id)

  assert.deepEqual(calls, [], 'not a single request reached Render (and so nothing reached Supabase)')

  // delete → gone from the list, slug no longer resolvable, data kept (soft delete)
  await live.deleteSession(s.id)
  assert.ok(!(await live.listSessions()).some((x) => x.id === s.id), 'deleted events leave the dashboard')
  assert.equal((await fsGet(`eventSlugs/${s.public_slug}`)).fields, undefined, 'slug no longer resolves')
  assert.ok((await fsGet(`events/${s.id}`)).fields.deletedAt, 'soft delete: the document is kept for rollback')
  assert.equal((await fsGet(`events/${s.id}/games`)).documents?.length, 2, 'games kept')
  assert.deepEqual(calls, [], 'delete did not touch Render either')
})

test('C2. dashboard switch OFF-equivalent: events that are not in Firestore still fall back to the legacy route', async () => {
  calls.length = 0
  await assert.rejects(api.live.getSession('legacy-only-session'), /render suspended|503/)        // not an event of this owner → legacy GET (503 here)
  assert.equal(calls.filter((c) => c.method === 'GET' && c.url.endsWith('/api/live/sessions/legacy-only-session')).length, 1)
})
