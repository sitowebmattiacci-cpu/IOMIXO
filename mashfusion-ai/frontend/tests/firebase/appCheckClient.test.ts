import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp, getApp } from 'firebase/app'
import { initializeAppCheck, CustomProvider } from 'firebase/app-check'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { seedSet, eventFields } from './seed'
import { getFirebaseAuth } from '../../lib/firebase/client'

/**
 * App Check on the client side, against the REAL client code path (lib/events/*): the default Firebase app is created with an App Check provider
 * (a custom provider returning a fake token: the emulators do not verify tokens, production does with reCAPTCHA Enterprise — same SDK code path),
 * every outbound call to the Functions emulator is recorded, and each NEW callable must carry the `X-Firebase-AppCheck` header.
 * No bypass: nothing here sends the header by hand and the server-side options (enforceAppCheck) are not touched.
 */
const FAKE = 'fake-app-check-token-for-header-test'
const seen: Array<{ fn: string; header: string | null }> = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input)
  const m = /127\.0\.0\.1:5001\/[^/]+\/[^/]+\/([A-Za-z]+)/.exec(url)
  if (m) {
    const h = new Headers(init?.headers ?? (typeof input === 'object' ? input.headers : undefined))
    seen.push({ fn: m[1], header: h.get('x-firebase-appcheck') })
  }
  return realFetch(input, init)
}) as typeof fetch
after(async () => { globalThis.fetch = realFetch; await deleteApp(getApp()) })

test('every NEW callable goes out with an App Check token through the standard client path', async () => {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: 'demo-iomixo', appId: 'demo-app-id' })
  initializeAppCheck(app, { provider: new CustomProvider({ getToken: async () => ({ token: FAKE, expireTimeMillis: Date.now() + 3600_000 }) }), isTokenAutoRefreshEnabled: false })

  const { ownerOps } = await import('../../lib/events/ownerService')
  const { fetchPublicEvent } = await import('../../lib/events/publicEventService')
  process.env.NEXT_PUBLIC_FIRESTORE_OWNER_OPS = 'true'
  const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), `ac${Date.now()}@example.com`, 'password123')
  const uid = cred.user.uid, legacy = `legacy-ac-${Date.now()}`, id = `acev${Date.now()}`, slug = `acslug${Date.now()}`
  await seedSet(`users/${uid}`, { uid, plan: { tier: 'wedding', source: 'legacy' } })
  await seedSet(`events/${id}`, eventFields(uid, slug, { type: 'party', legacySupabaseId: legacy }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  await seedSet(`events/${id}/requests/r1`, { guestUid: 'g', songTitle: 'S', artist: null, message: null, status: 'pending', createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${id}/dedications/d1`, { senderName: 'Z', message: 'm', status: 'pending', createdAt: new Date(), updatedAt: new Date() })

  await ownerOps.requests.list(legacy); await ownerOps.dedications.list(legacy)
  assert.ok(await ownerOps.requests.setStatus('r1', 'approved'))                               // moderateRequest
  assert.ok(await ownerOps.dedications.setStatus('d1', 'approved'))                            // moderateDedication
  const poll = await ownerOps.polls.create(legacy, { question: 'Q?', options: ['A', 'B'] })     // createPoll
  assert.ok(await ownerOps.polls.setActive(poll!.id, false))                                   // setPollStatus
  assert.ok(await ownerOps.config.update(legacy, { screen_config: { show_polls: true } }))      // updateEventConfig
  assert.equal((await fetchPublicEvent(slug)).eventId, id)                                      // getPublicEvent

  const byFn = new Map<string, Array<string | null>>()
  for (const s of seen) byFn.set(s.fn, [...(byFn.get(s.fn) ?? []), s.header])
  for (const fn of ['moderateRequest', 'moderateDedication', 'createPoll', 'setPollStatus', 'updateEventConfig', 'getPublicEvent']) {
    const headers = byFn.get(fn) ?? []
    assert.ok(headers.length >= 1, `${fn} was called`)
    assert.ok(headers.every((h) => h === FAKE), `${fn}: every request carries X-Firebase-AppCheck (got ${JSON.stringify(headers)})`)
  }
})
