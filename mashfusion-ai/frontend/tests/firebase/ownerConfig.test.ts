import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc } from 'firebase/firestore'
import { deleteApp } from 'firebase/app'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { seedSet, eventFields } from './seed'
import { getFirebaseAuth, getFirebaseApp, getFirebaseDb } from '../../lib/firebase/client'

/** updateSession through lib/api.ts: Firestore is the only authority; there is no HTTP backend to call. */
let uid = '', legacy = '', eventId = ''
let live: typeof import('../../lib/api').live

before(async () => {
  const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), `cfg${Date.now()}@example.com`, 'password123')
  uid = cred.user.uid; legacy = `legacy-cfg-${Date.now()}`; eventId = `cfgev${Date.now()}`
  await seedSet(`users/${uid}`, { uid, plan: { tier: 'wedding', source: 'legacy' } })
  await seedSet(`events/${eventId}`, eventFields(uid, `cfg${eventId}`, { type: 'wedding', legacySupabaseId: legacy, screenConfig: { show_polls: false } }))
  live = (await import('../../lib/api')).live
})
after(async () => { await deleteApp(getFirebaseApp()) })

const ev = async () => (await getDoc(doc(getFirebaseDb(), 'events', eventId))).data()!

test('G1. config patch → Firestore; getSession shows it', async () => {
  await live.updateSession(legacy, { screen_config: { show_polls: true, show_dedications: true } as any })
  await live.updateSession(legacy, { guest_config: { requests: false } as any, screen_mode_enabled: true })
  const e = await ev()
  assert.deepEqual(e.screenConfig, { show_polls: true, show_dedications: true }); assert.deepEqual(e.guestConfig, { requests: false }); assert.equal(e.screenModeEnabled, true)
  const s = await live.getSession(legacy)
  assert.deepEqual(s.screen_config, { show_polls: true, show_dedications: true }); assert.deepEqual(s.guest_config, { requests: false }); assert.equal(s.screen_mode_enabled, true)
})

test('G2. core fields and the owner-private games config are written in Firestore too', async () => {
  await live.updateSession(legacy, { event_name: 'Nuovo nome', is_active: false, screen_config: { show_polls: false } as any })
  const e = await ev()
  assert.equal(e.title, 'Nuovo nome'); assert.equal(e.status, 'ended'); assert.deepEqual(e.screenConfig, { show_polls: false })
  await live.updateSession(legacy, { shoe_game_questions: ['q'] })
  assert.deepEqual((await live.getSession(legacy)).shoe_game_questions, ['q'])
})

test('G3. winner announcement is stored as its own field and survives later toggles', async () => {
  const winner = { enabled: true, groom_photo_path: null, bride_photo_path: null }
  await live.updateSession(legacy, { screen_config: { show_polls: true, winner_announcement: winner } as any })
  assert.deepEqual((await ev()).screenConfig, { show_polls: true, winner_announcement: winner })
  await live.updateSession(legacy, { screen_config: { show_polls: false } as any })
  assert.deepEqual((await ev()).screenConfig, { show_polls: false, winner_announcement: winner })
  await live.updateSession(legacy, { screen_config: { winner_announcement: null } as any })
  assert.equal((await ev()).screenConfig.winner_announcement, null)
})

test('G4. an unknown session is an error, not a fallback', async () => {
  await assert.rejects(live.updateSession('not-migrated-session', { screen_config: { show_polls: true } as any, event_name: 'x' }), /Sessione non trovata/)
})
