import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { doc, getDoc } from 'firebase/firestore'
import { deleteApp } from 'firebase/app'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { seedSet, eventFields } from './seed'
import { getFirebaseAuth, getFirebaseApp, getFirebaseDb } from '../../lib/firebase/client'

/**
 * updateSession routing (NEXT_PUBLIC_FIRESTORE_OWNER_OPS): a fake "Render" records every legacy call, so the tests can prove which fields go
 * where and that no field is ever written to both authorities inconsistently.
 */
const calls: Array<{ method: string; url: string; body: any }> = []
let failLegacy = false
let server: http.Server
let uid = '', legacy = '', eventId = ''
let live: typeof import('../../lib/api').live

before(async () => {
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c })
    req.on('end', () => {
      calls.push({ method: req.method!, url: req.url!, body: raw ? JSON.parse(raw) : null })
      res.setHeader('content-type', 'application/json'); res.setHeader('access-control-allow-origin', '*')
      if (failLegacy) { res.statusCode = 503; res.end(JSON.stringify({ error: 'down' })); return }
      const id = req.url!.split('/').pop()
      const base = { id, event_name: 'Legacy name', screen_config: { show_polls: false, from_legacy: true }, guest_config: { requests: true }, screen_mode_enabled: false }
      res.end(JSON.stringify({ data: req.method === 'PATCH' ? { ...base, ...JSON.parse(raw) } : base }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  process.env.NEXT_PUBLIC_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.NEXT_PUBLIC_FIRESTORE_OWNER_OPS = 'true'                      // the spelling the task uses; 'on' works too
  const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), `cfg${Date.now()}@example.com`, 'password123')
  uid = cred.user.uid; legacy = `legacy-cfg-${Date.now()}`; eventId = `cfgev${Date.now()}`
  await seedSet(`users/${uid}`, { uid, plan: { tier: 'wedding', source: 'legacy' } })
  await seedSet(`events/${eventId}`, eventFields(uid, `cfg${eventId}`, { type: 'wedding', legacySupabaseId: legacy, screenConfig: { show_polls: false } }))
  live = (await import('../../lib/api')).live
})
after(async () => { await new Promise((r) => server.close(r)); await deleteApp(getFirebaseApp()) })

const ev = async () => (await getDoc(doc(getFirebaseDb(), 'events', eventId))).data()!
const reset = () => { calls.length = 0; failLegacy = false }

test('G1. config-only patch → Firestore only: zero legacy calls; getSession shows the Firestore config', async () => {
  reset()
  await live.updateSession(legacy, { screen_config: { show_polls: true, show_dedications: true } as any })
  await live.updateSession(legacy, { guest_config: { requests: false } as any, screen_mode_enabled: true })
  assert.equal(calls.length, 0, 'nothing may reach Render/Supabase')
  const e = await ev()
  assert.deepEqual(e.screenConfig, { show_polls: true, show_dedications: true }); assert.deepEqual(e.guestConfig, { requests: false }); assert.equal(e.screenModeEnabled, true)
  const s = await live.getSession(legacy)                                   // legacy GET (the session itself) + Firestore overlay
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET')
  assert.deepEqual(s.screen_config, { show_polls: true, show_dedications: true }); assert.deepEqual(s.guest_config, { requests: false }); assert.equal(s.screen_mode_enabled, true)
  assert.equal(s.event_name, 'Legacy name')
})

test('G2. legacy-only patch → legacy only, no Firestore write; mixed patch → legacy gets ONLY the legacy fields, simple event fields are mirrored', async () => {
  reset(); const before = await ev()
  await live.updateSession(legacy, { roulette_penitenze: ['a'] as any, shoe_game_questions: ['q'] as any })
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].body, { roulette_penitenze: ['a'], shoe_game_questions: ['q'] })
  assert.deepEqual((await ev()).updatedAt, before.updatedAt, 'nothing written to Firestore')

  reset()
  await live.updateSession(legacy, { event_name: 'Nuovo nome', is_active: false, screen_config: { show_polls: false } as any })
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].body, { event_name: 'Nuovo nome', is_active: false })      // config keys NOT sent to legacy
  const e = await ev()
  assert.equal(e.title, 'Nuovo nome'); assert.equal(e.status, 'ended'); assert.deepEqual(e.screenConfig, { show_polls: false })
})

test('G3. legacy failure → nothing is written to Firestore (no half-applied patch); a Firestore failure after a legacy write says so', async () => {
  reset(); failLegacy = true; const before = await ev()
  await assert.rejects(live.updateSession(legacy, { event_name: 'Mai applicato', screen_config: { show_polls: true } as any }))
  assert.equal((await ev()).title, before.title); assert.deepEqual((await ev()).screenConfig, before.screenConfig)
  reset()
  await assert.rejects(live.updateSession(legacy, { event_name: 'x', guest_config: 'not-an-object' as any }), /Salvato, ma la sincronizzazione/)   // callable rejects → explicit message
})

test('G4. winner announcement → legacy gets the WHOLE patch (it validates the photos); Firestore gets the config + the winner as a signal; toggles keep it', async () => {
  reset()
  const winner = { enabled: true, groom_photo_path: `${legacy}/g.jpg`, bride_photo_path: null }
  await live.updateSession(legacy, { screen_config: { show_polls: true, winner_announcement: winner } as any })
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].body.screen_config.winner_announcement, winner)
  assert.deepEqual((await ev()).screenConfig, { show_polls: true, winner_announcement: winner })
  reset()
  await live.updateSession(legacy, { screen_config: { show_polls: false } as any })                    // a later toggle: Firestore only, signal kept
  assert.equal(calls.length, 0); assert.deepEqual((await ev()).screenConfig, { show_polls: false, winner_announcement: winner })
  await live.updateSession(legacy, { screen_config: { winner_announcement: null } as any })              // reset
  assert.equal((await ev()).screenConfig.winner_announcement, null)
})

test('G5. a session that is NOT in Firestore (or another owner) keeps the old single legacy PATCH', async () => {
  reset()
  await live.updateSession('not-migrated-session', { screen_config: { show_polls: true } as any, event_name: 'x' })
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].body, { screen_config: { show_polls: true }, event_name: 'x' })
  delete process.env.NEXT_PUBLIC_FIRESTORE_OWNER_OPS
  reset(); await live.updateSession(legacy, { screen_config: { show_polls: true } as any })               // switch off → legacy even for a migrated session
  assert.equal(calls.length, 1); process.env.NEXT_PUBLIC_FIRESTORE_OWNER_OPS = 'true'
})
