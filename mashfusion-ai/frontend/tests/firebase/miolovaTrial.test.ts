import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { newClient, closeClient, denied, type TestClient } from './helpers'
import { seedSet, eventFields } from './seed'
import { fromEventDoc } from '../../lib/firebase/repositories/eventRepository'

/**
 * MIOLOVE free trial: a couple account (accountType 'couple') gets exactly ONE free trial (its first album, accessMode 'trial'); every later album is 'pending' until paid.
 * Everything else (DJ Free, Party, legacy accounts, paid accounts, events without the field) behaves exactly as before.
 */
const clients: TestClient[] = []
after(async () => { await Promise.all(clients.map(closeClient)) })
const mk = async () => { const c = await newClient('account'); clients.push(c); return c }
const callAs = <O = any>(c: TestClient, name: string, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, O>(f, name)(data as any).then((r) => r.data)
}
async function fails(p: Promise<unknown>) { try { await p } catch (e: any) { return `${String(e.code).replace('functions/', '')}:${e.details?.reason ?? ''}` } assert.fail('expected rejection') }
const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
const ownerEvents = async (uid: string) => (((await fsGet('events?pageSize=1000')).documents ?? []) as any[]).filter((d) => d.fields.ownerUid?.stringValue === uid)
let n = 0
const rid = () => `trial${Date.now()}${n++}`

type Tier = 'free' | 'pro' | 'wedding'
const account = async (type: 'dj' | 'couple' | undefined, tier: Tier = 'free', withDoc = true) => {
  const c = await mk()
  if (withDoc) await seedSet(`users/${c.uid}`, { uid: c.uid, email: c.email, ...(type ? { accountType: type } : {}), plan: { tier, source: tier === 'free' ? 'default' : 'legacy' } })
  return c
}
const giveEventPass = (uid: string, scope: 'iomixo' | 'miolove' = 'iomixo') => seedSet(`users/${uid}/eventPasses/pass${Date.now()}`, { status: 'active', validUntil: new Date(Date.now() + 3_600_000), createdAt: new Date(), productScope: scope })
const create = (c: TestClient, over: Record<string, unknown> = {}) => callAs<{ eventId: string; slug: string; created: boolean }>(c, 'createEvent', { requestId: rid(), title: 'Album', type: 'wedding', occasionType: 'birthday', ...over })
const eventOf = async (c: TestClient, id: string) => (await getDoc(doc(c.db, 'events', id))).data()!
const reservation = async (uid: string) => (await fsGet(`trialAlbums/${uid}`)).fields

test('A. couple + Free + no album: the first Wedding album is created and marked trial (type stays wedding, occasion kept, reservation written)', async () => {
  const c = await account('couple')
  const requestId = rid()
  const r = await create(c, { requestId })
  assert.equal(r.created, true)
  const e = await eventOf(c, r.eventId)
  assert.deepEqual([e.type, e.occasionType, e.accessMode, e.ownerUid], ['wedding', 'birthday', 'trial', c.uid])
  assert.equal((await reservation(c.uid)).eventId.stringValue, r.eventId, 'the reservation points at the trial album')
  assert.ok(await denied(getDoc(doc(c.db, 'trialAlbums', c.uid))), 'no client can read or write the reservation')
  // a retried / double-clicked create of the SAME request returns the same album: it is not a second trial and not an error
  const replay = await create(c, { requestId })
  assert.deepEqual([replay.eventId, replay.created], [r.eventId, false]); assert.equal((await ownerEvents(c.uid)).length, 1)
})

test('B. a second album is CREATED (no more "one album" limit) but is pending: no second trial, no trial fields; deleting the trial album does not hand out another trial', async () => {
  const c = await account('couple'); const first = await create(c)
  const second = await create(c)
  assert.notEqual(second.eventId, first.eventId); assert.equal(second.created, true)
  const e2 = await eventOf(c, second.eventId)
  assert.deepEqual([e2.accessMode, e2.type, e2.brand], ['pending', 'wedding', 'miolove'])
  for (const f of ['trialExpiresAt', 'trialStartsAt', 'trialPhotoCount', 'trialPhotoLimit', 'purgeAfter', 'activatedAt', 'expiresAt']) assert.equal((e2 as any)[f], undefined, `a pending album has no ${f}`)
  assert.equal((await reservation(c.uid)).eventId.stringValue, first.eventId, 'the reservation still points at the ONE trial album')
  assert.equal((await ownerEvents(c.uid)).length, 2)
  await callAs(c, 'deleteEvent', { eventId: first.eventId })
  const third = await create(c)
  assert.equal((await eventOf(c, third.eventId)).accessMode, 'pending', 'the trial is one per account, not one per live album')
  assert.equal((await ownerEvents(c.uid)).length, 3, 'soft-deleted ones are still documents (restorable)')
  assert.equal((await callAs(c, 'restoreEvent', { eventId: first.eventId })).restored, true)
  assert.equal((await eventOf(c, first.eventId)).accessMode, 'trial', 'restoring gives back the trial album itself, not a new one')
})

test('C. race: concurrent createEvent calls of the same Free couple create ALL their albums but exactly ONE trial (the others are pending)', async () => {
  const c = await account('couple')
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => create(c)))
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 6, 'every album is created')
  const evs = await ownerEvents(c.uid)
  assert.equal(evs.length, 6, 'six documents in Firestore')
  const modes = evs.map((e) => e.fields.accessMode.stringValue).sort()
  assert.deepEqual(modes, ['pending', 'pending', 'pending', 'pending', 'pending', 'trial'], 'exactly one trial')
})

test('D. DJ + Free: Wedding and Party stay refused (event_access_required), no trial state, no reservation', async () => {
  const dj = await account('dj')
  assert.equal(await fails(create(dj)), 'permission-denied:event_access_required')
  assert.equal(await fails(create(dj, { type: 'party' })), 'permission-denied:event_access_required')
  assert.equal((await ownerEvents(dj.uid)).length, 0); assert.equal((await reservation(dj.uid)), undefined)
})

test('E. DJ + Advance: unchanged (Wedding and Party created, NO accessMode)', async () => {
  const dj = await account('dj', 'wedding')
  for (const type of ['wedding', 'party']) { const r = await create(dj, { type }); const e = await eventOf(dj, r.eventId); assert.equal(e.accessMode, undefined, type); assert.equal(e.type, type) }
  assert.equal((await reservation(dj.uid)), undefined)
})

test('F. DJ + Free + Event Pass: unchanged (Wedding created, NO accessMode)', async () => {
  const dj = await account('dj'); await giveEventPass(dj.uid)
  const r = await create(dj); assert.equal((await eventOf(dj, r.eventId)).accessMode, undefined); assert.equal((await reservation(dj.uid)), undefined)
})

test('G. there is no account-level premium: a MIOLOVE plan / MIOLOVE Event Pass on the account does not activate any album at creation (first = trial, later = pending)', async () => {
  const adv = await account('couple', 'wedding')
  await seedSet(`users/${adv.uid}`, { uid: adv.uid, email: adv.email, accountType: 'couple', plan: { tier: 'free', source: 'default' }, miolovePlan: { tier: 'wedding', source: 'stripe' } })
  const a1 = await create(adv), a2 = await create(adv)
  assert.deepEqual([(await eventOf(adv, a1.eventId)).accessMode, (await eventOf(adv, a2.eventId)).accessMode], ['trial', 'pending'])
  const pass = await account('couple'); await giveEventPass(pass.uid, 'miolove')
  const p = await create(pass); assert.equal((await eventOf(pass, p.eventId)).accessMode, 'trial')
  // an IOMIXO plan / pass is not a MIOLOVE one either
  const io = await account('couple', 'wedding'); await giveEventPass(io.uid, 'iomixo')
  const i1 = await create(io), i2 = await create(io)
  assert.deepEqual([(await eventOf(io, i1.eventId)).accessMode, (await eventOf(io, i2.eventId)).accessMode], ['trial', 'pending'])
})

test('H. legacy accounts (no accountType, or no users document at all) keep the DJ behaviour: Free Wedding is refused', async () => {
  const noField = await account(undefined), noDoc = await account(undefined, 'free', false)
  for (const c of [noField, noDoc]) { assert.equal(await fails(create(c)), 'permission-denied:event_access_required'); assert.equal((await ownerEvents(c.uid)).length, 0); assert.equal((await reservation(c.uid)), undefined) }
})

test('I. Party is unchanged: a couple still cannot create it (wedding_only), a Free couple\'s refused Party does not consume the trial', async () => {
  const c = await account('couple')
  assert.equal(await fails(create(c, { type: 'party' })), 'permission-denied:wedding_only')
  assert.equal(await fails(create(c, { type: 'standard' })), 'permission-denied:wedding_only')
  assert.equal((await reservation(c.uid)), undefined, 'a refused request never reserves the trial')
  assert.equal((await create(c)).created, true, 'the trial is still available afterwards')
})

test('J. backward compatible: an event without accessMode is NOT a trial; an account that already owns an album gets no trial for the next one; invalid input reserves nothing', async () => {
  // reading: absent field → null (never "trial")
  assert.equal(fromEventDoc('x', { type: 'wedding', ownerUid: 'u', slug: 's', title: 't' }).accessMode, null)
  assert.equal(fromEventDoc('x', { type: 'wedding', accessMode: 'trial', ownerUid: 'u', slug: 's', title: 't' }).accessMode, 'trial')
  assert.equal(fromEventDoc('x', { type: 'wedding', accessMode: 'pending', ownerUid: 'u', slug: 's', title: 't' }).accessMode, 'pending')
  assert.equal(fromEventDoc('x', { type: 'wedding', accessMode: 'free', ownerUid: 'u', slug: 's', title: 't' }).accessMode, null, 'unknown values are not trial either')
  // a couple that already has an album (created before the field existed, now on the Free plan): this is not its first album
  const c = await account('couple'); const slug = `old${Date.now()}`
  await seedSet(`events/${slug}`, eventFields(c.uid, slug, { type: 'wedding', legacySupabaseId: undefined })); await seedSet(`eventSlugs/${slug}`, { eventId: slug })
  const next = await create(c)
  assert.equal((await eventOf(c, next.eventId)).accessMode, 'pending', 'it already has an album: no trial for the new one')
  assert.equal((await reservation(c.uid)), undefined, 'and no reservation was consumed')
  const fresh = await account('couple')
  assert.equal(await fails(create(fresh, { occasionType: 'funeral' })), 'invalid-argument:invalid_payload')
  assert.equal((await reservation(fresh.uid)), undefined)
  // the existing event keeps its (missing) state after all of this
  assert.equal((await fsGet(`events/${slug}`)).fields.accessMode, undefined)
})
