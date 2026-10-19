import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc, getDocs, collection } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { newClient, closeClient, denied, type TestClient } from './helpers'
import { seedSet, eventFields } from './seed'

/**
 * ONE Firebase identity, TWO products. The identity (uid) may own IOMIXO events and MIOLOVE albums at once; what an event is comes from its own
 * `brand` (written by createEvent from the portal), never from users/{uid}.accountType. Authorization stays per resource: owner + brand + entitlement.
 */
const clients: TestClient[] = []
after(async () => { await Promise.all(clients.map(closeClient)) })
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }
const callAs = <O = any>(c: TestClient, name: string, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, O>(f, name)(data as any).then((r) => r.data)
}
async function fails(p: Promise<unknown>) { try { await p } catch (e: any) { return `${String(e.code).replace('functions/', '')}:${e.details?.reason ?? ''}` } assert.fail('expected rejection') }
let n = 0
const rid = () => `dual${Date.now()}${n++}`
type Type = 'dj' | 'couple' | undefined
const TYPES: Type[] = ['dj', 'couple', undefined]
const label = (t: Type) => t ?? 'missing'

const account = async (type: Type, tier: 'free' | 'wedding' = 'wedding') => {
  const c = await mk()
  await seedSet(`users/${c.uid}`, { uid: c.uid, email: c.email, ...(type ? { accountType: type } : {}), plan: { tier, source: tier === 'free' ? 'default' : 'legacy' } })
  return c
}
const create = (c: TestClient, over: Record<string, unknown> = {}) =>
  callAs<{ eventId: string; slug: string }>(c, 'createEvent', { requestId: rid(), title: 'Evento', type: 'wedding', ...over })
const eventOf = async (c: TestClient, id: string) => (await getDoc(doc(c.db, 'events', id))).data()!

for (const type of TYPES) {
  test(`DP1 [accountType ${label(type)}]. the same uid creates IOMIXO events AND a MIOLOVE album, each carrying its own brand`, async () => {
    const u = await account(type)
    const party = await create(u, { type: 'party', brand: 'iomixo' })
    const djWedding = await create(u, { type: 'wedding', brand: 'iomixo' })
    const album = await create(u, { type: 'wedding', brand: 'miolove', occasionType: 'birthday' })
    const [p, w, a] = await Promise.all([eventOf(u, party.eventId), eventOf(u, djWedding.eventId), eventOf(u, album.eventId)])
    assert.deepEqual([p.brand, w.brand, a.brand], ['iomixo', 'iomixo', 'miolove'])
    assert.deepEqual([p.ownerUid, w.ownerUid, a.ownerUid], [u.uid, u.uid, u.uid], 'one identity owns all three')
    assert.deepEqual([p.accessMode, w.accessMode, a.accessMode], [undefined, undefined, 'activated'], 'MIOLOVE access is a property of the album, never of the IOMIXO events')
  })

  test(`DP2 [accountType ${label(type)}]. DJ live control works on the IOMIXO event and is refused on the MIOLOVE album of the SAME uid`, async () => {
    const u = await account(type)
    const dj = await create(u, { type: 'wedding', brand: 'iomixo' })
    const album = await create(u, { type: 'wedding', brand: 'miolove' })
    assert.ok(await callAs(u, 'createPoll', { eventId: dj.eventId, question: 'Q?', options: ['A', 'B'] }))
    await callAs(u, 'updateEventConfig', { eventId: dj.eventId, screenConfig: { show_photos: true }, screenModeEnabled: true })
    const deny = 'permission-denied:dj_account_required'
    assert.equal(await fails(callAs(u, 'createPoll', { eventId: album.eventId, question: 'Q?', options: ['A', 'B'] })), deny)
    assert.equal(await fails(callAs(u, 'ownerGameAction', { eventId: album.eventId, game: 'roulette', action: 'start' })), deny)
    assert.equal(await fails(callAs(u, 'updateEventConfig', { eventId: album.eventId, screenConfig: { show_photos: true } })), deny)
    // the album owner still manages the album itself
    await callAs(u, 'updateEventConfig', { eventId: album.eventId, eventFields: { title: 'Il nostro album' } })
  })

  test(`DP3 [accountType ${label(type)}]. rules: the uid reads DJ data of its IOMIXO event and NOT of its own MIOLOVE album`, async () => {
    const u = await account(type); const guest = await mk('anonymous')
    const dj = await create(u, { type: 'wedding', brand: 'iomixo' }), album = await create(u, { type: 'wedding', brand: 'miolove' })
    for (const id of [dj.eventId, album.eventId]) {
      await seedSet(`events/${id}/requests/r1`, { guestUid: guest.uid, songTitle: 'S', status: 'pending' })
      await seedSet(`events/${id}/private/gameConfig`, { roulettePenitenze: [] })
    }
    assert.equal((await getDocs(collection(u.db, 'events', dj.eventId, 'requests'))).size, 1)
    assert.ok((await getDoc(doc(u.db, 'events', dj.eventId, 'private', 'gameConfig'))).exists())
    assert.ok(await denied(getDocs(collection(u.db, 'events', album.eventId, 'requests'))))
    assert.ok(await denied(getDoc(doc(u.db, 'events', album.eventId, 'private', 'gameConfig'))))
  })
}

test('DP4. commercial rules stay per product: the free MIOLOVE trial is one per uid and IOMIXO events never consume it (nor the reverse)', async () => {
  const u = await account('dj', 'free')
  const standard = await create(u, { type: 'standard', brand: 'iomixo' })
  const trial = await create(u, { type: 'wedding', brand: 'miolove' })
  assert.deepEqual([(await eventOf(u, standard.eventId)).accessMode, (await eventOf(u, trial.eventId)).accessMode], [undefined, 'trial'])
  assert.deepEqual([(await eventOf(u, trial.eventId)).trialPhotoLimit], [50])
  assert.equal(await fails(create(u, { type: 'wedding', brand: 'miolove' })), 'already-exists:miolove_trial_album_exists', 'second free album refused')
  // a MIOLOVE trial grants nothing on IOMIXO: Party / Wedding DJ still need Advance or an Event Pass, and the IOMIXO free slot is its own
  assert.equal(await fails(create(u, { type: 'party', brand: 'iomixo' })), 'permission-denied:event_access_required')
  assert.equal(await fails(create(u, { type: 'wedding', brand: 'iomixo' })), 'permission-denied:event_access_required')
  assert.equal(await fails(create(u, { type: 'standard', brand: 'iomixo' })), 'resource-exhausted:session_limit', 'the free IOMIXO slot is taken by the standard event, not by the album')
})

test('DP5. a couple-typed uid with only IOMIXO events still gets its free MIOLOVE trial; a dj-typed uid with only an album can still run IOMIXO', async () => {
  const c = await account('couple', 'free')
  await seedSet(`events/seedstd${n}`, eventFields(c.uid, `seedstd${n}`, { type: 'standard', brand: 'iomixo' }))
  const trial = await create(c, { type: 'wedding', brand: 'miolove' })
  assert.equal((await eventOf(c, trial.eventId)).accessMode, 'trial')

  const d = await account('dj', 'free')
  await create(d, { type: 'wedding', brand: 'miolove' })
  const std = await create(d, { type: 'standard', brand: 'iomixo' })
  assert.equal((await eventOf(d, std.eventId)).brand, 'iomixo')
})

test('DP6. MIOLOVE only has albums; a couple-typed uid may create a Party on IOMIXO when it holds the entitlement', async () => {
  const c = await account('couple')
  assert.equal(await fails(create(c, { type: 'party', brand: 'miolove' })), 'permission-denied:wedding_only')
  assert.equal(await fails(create(c, { type: 'standard', brand: 'miolove' })), 'permission-denied:wedding_only')
  const party = await create(c, { type: 'party', brand: 'iomixo' })
  assert.equal((await eventOf(c, party.eventId)).brand, 'iomixo')
})

test('DP7. legacy clients / events: no brand sent → the account type decides; events without a stored brand keep their old classification', async () => {
  const couple = await account('couple'), dj = await account('dj'), bare = await account(undefined)
  assert.equal((await eventOf(couple, (await create(couple)).eventId)).brand, 'miolove')
  assert.equal((await eventOf(dj, (await create(dj)).eventId)).brand, 'iomixo')
  assert.equal((await eventOf(bare, (await create(bare)).eventId)).brand, 'iomixo')

  // historic events (no brand field): couple-owned Wedding = MIOLOVE, DJ / legacy Wedding = IOMIXO, accessMode alone is conclusive
  const seedEvent = async (owner: TestClient, extra: Record<string, unknown> = {}) => {
    const id = rid(); await seedSet(`events/${id}`, eventFields(owner.uid, `s${id}`, { type: 'wedding', ...extra })); return id
  }
  const deny = 'permission-denied:dj_account_required'
  const poll = (c: TestClient, id: string) => callAs(c, 'createPoll', { eventId: id, question: 'Q?', options: ['A', 'B'] })
  assert.equal(await fails(poll(couple, await seedEvent(couple))), deny, 'historic couple album')
  assert.equal(await fails(poll(dj, await seedEvent(dj, { accessMode: 'trial' }))), deny, 'accessMode is conclusive')
  assert.ok(await poll(dj, await seedEvent(dj)), 'historic Wedding DJ')
  assert.ok(await poll(bare, await seedEvent(bare)), 'historic Wedding of a legacy account')
  assert.ok(await poll(couple, await seedEvent(couple, { brand: 'iomixo' })), 'explicit brand beats the couple account type')
})

test('DP8. no cross-account access: another uid cannot run owner callables on an event, whatever its brand', async () => {
  const owner = await account('dj'), other = await account('couple')
  for (const brand of ['iomixo', 'miolove'] as const) {
    const e = await create(owner, { type: 'wedding', brand })
    assert.equal(await fails(callAs(other, 'createPoll', { eventId: e.eventId, question: 'Q?', options: ['A', 'B'] })), 'not-found:event_not_found')
    assert.equal(await fails(callAs(other, 'deleteEvent', { eventId: e.eventId })), 'not-found:event_not_found')
    assert.ok(await denied(getDocs(collection(other.db, 'events', e.eventId, 'requests'))))
  }
})

test('DP9. the public payload exposes the explicit brand (null for historic events) so a guest link of a dj-typed uid\'s album stays MIOLOVE', async () => {
  const u = await account('dj'); const guest = await mk('anonymous')
  const album = await create(u, { type: 'wedding', brand: 'miolove' }), dj = await create(u, { type: 'wedding', brand: 'iomixo' })
  const pub = async (slug: string) => (await callAs(guest, 'getPublicEvent', { slug })).session
  const a = await pub(album.slug), d = await pub(dj.slug)
  assert.deepEqual([a.event_brand, a.access_mode, a.owner_account_type], ['miolove', 'activated', 'dj'])
  assert.deepEqual([d.event_brand, d.access_mode], ['iomixo', null])
  const id = rid(); await seedSet(`events/${id}`, eventFields(u.uid, `s${id}`, { type: 'wedding' })); await seedSet(`eventSlugs/s${id}`, { eventId: id })
  assert.equal((await pub(`s${id}`)).event_brand, null)
})
