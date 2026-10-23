import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { newClient, closeClient, type TestClient } from './helpers'
import { seedSet, eventFields } from './seed'
import { publicOwnerAccountType } from '../../../../firebase/functions/src/owner/publicEvent'

/**
 * getPublicEvent: read-only `owner_account_type` + `access_mode`, the source of the guest pages' brand (MIOLOVE album vs IOMIXO).
 * Covers historic events (no accessMode, legacy accounts without users doc / accountType) and the payload never leaking the owner.
 */
type Firestore = Parameters<typeof publicOwnerAccountType>[0]
const clients: TestClient[] = []
after(async () => { await Promise.all(clients.map(closeClient)) })
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }
const callAs = <O = any>(c: TestClient, name: string, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, O>(f, name)(data as any).then((r) => r.data)
}
let n = 0
const rid = () => `peb${Date.now()}${n++}`

/** Historic event seeded straight into Firestore (as migrated from Supabase / created before accessMode existed). */
async function historicEvent(ownerUid: string, extra: Record<string, unknown> = {}) {
  const id = rid(); const slug = `s${id}`
  await seedSet(`events/${id}`, eventFields(ownerUid, slug, extra)); await seedSet(`eventSlugs/${slug}`, { eventId: id })
  return slug
}
const brandOf = async (slug: string) => {
  const g = await mk('anonymous')
  const r = await callAs(g, 'getPublicEvent', { slug })
  return [r.session.owner_account_type, r.session.access_mode]
}

test('PB1. historic Wedding of a LEGACY account (no users doc) → dj, no accessMode', async () => {
  const a = await mk()
  assert.deepEqual(await brandOf(await historicEvent(a.uid)), ['dj', null])
})

test('PB2. historic Wedding of an account without accountType (legacy DJ) → dj', async () => {
  const a = await mk()
  await seedSet(`users/${a.uid}`, { uid: a.uid, plan: { tier: 'wedding', source: 'legacy' } })
  assert.deepEqual(await brandOf(await historicEvent(a.uid)), ['dj', null])
})

test('PB3. couple album created BEFORE accessMode existed → couple (the owner decides, not accessMode)', async () => {
  const a = await mk()
  await seedSet(`users/${a.uid}`, { uid: a.uid, accountType: 'couple', plan: { tier: 'free', source: 'default' } })
  assert.deepEqual(await brandOf(await historicEvent(a.uid)), ['couple', null])
})

test('PB4. new events: couple first album → couple/trial; couple second album → couple/pending; DJ Wedding and Party → dj/null', async () => {
  const free = await mk(); const paid = await mk(); const dj = await mk()
  await seedSet(`users/${free.uid}`, { uid: free.uid, accountType: 'couple', plan: { tier: 'free', source: 'default' } })
  await seedSet(`users/${paid.uid}`, { uid: paid.uid, accountType: 'couple', plan: { tier: 'free', source: 'default' }, miolovePlan: { tier: 'wedding', source: 'stripe' } })
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, accountType: 'dj', plan: { tier: 'wedding', source: 'legacy' } })
  const ev = (c: TestClient, type: string) => callAs<{ slug: string }>(c, 'createEvent', { requestId: rid(), title: 'Evento', type })
  assert.deepEqual(await brandOf((await ev(free, 'wedding')).slug), ['couple', 'trial'])
  await ev(paid, 'wedding')
  assert.deepEqual(await brandOf((await ev(paid, 'wedding')).slug), ['couple', 'pending'])
  assert.deepEqual(await brandOf((await ev(dj, 'wedding')).slug), ['dj', null])
  assert.deepEqual(await brandOf((await ev(dj, 'party')).slug), ['dj', null])
})

test('PB5. an unexpected accessMode value is never echoed; nothing else about the owner leaves the server', async () => {
  const a = await mk()
  await seedSet(`users/${a.uid}`, { uid: a.uid, email: 'secret@example.com', accountType: 'couple', plan: { tier: 'free', source: 'default' } })
  const g = await mk('anonymous')
  const r = await callAs(g, 'getPublicEvent', { slug: await historicEvent(a.uid, { accessMode: 'hacked' }) })
  assert.equal(r.session.access_mode, null)
  const json = JSON.stringify(r)
  assert.ok(!json.includes('secret@example.com') && !json.includes(a.uid), 'no owner email / uid in the public payload')
  assert.deepEqual(Object.keys(r.session).sort(), [
    'access_mode', 'couple_names', 'description', 'dj_name', 'event_brand', 'event_name', 'guest_config', 'id', 'is_active',
    'owner_account_type', 'screen_mode_enabled', 'session_type', 'venue_name', 'wedding_date',
  ])
})

test('PB6. publicOwnerAccountType: a failed read is "unknown" (null), never DJ; an empty owner is unknown too', async () => {
  const throwing = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('unavailable') } }) }) } as unknown as Firestore
  assert.equal(await publicOwnerAccountType(throwing, 'u1'), null)
  assert.equal(await publicOwnerAccountType(throwing, ''), null)
  const reading = (data: Record<string, unknown> | null) => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: data !== null, data: () => data }) }) }) }) as unknown as Firestore
  assert.equal(await publicOwnerAccountType(reading(null), 'u1'), 'dj', 'no users doc = legacy DJ account')
  assert.equal(await publicOwnerAccountType(reading({}), 'u1'), 'dj', 'no accountType = legacy DJ account')
  assert.equal(await publicOwnerAccountType(reading({ accountType: 'couple' }), 'u1'), 'couple')
})
