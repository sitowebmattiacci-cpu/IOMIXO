import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { newClient, closeClient, type TestClient } from './helpers'
import { seedSet, eventFields } from './seed'

/**
 * MIOLOVE album privacy switches ("Invio foto degli ospiti" = guestConfig.live_booth, "Foto sullo schermo" = screenConfig.show_photos): the album OWNER sets them
 * (no DJ account, no IOMIXO plan); a stranger, a guest and an owner of ANOTHER album cannot. IOMIXO keeps its own rules.
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
const album = async (accessMode: 'trial' | 'activated', over: Record<string, unknown> = {}) => {
  const owner = await mk(); const id = `prv${Date.now()}${n++}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, accountType: 'couple', plan: { tier: 'free', source: 'default' } })
  await seedSet(`events/${id}`, eventFields(owner.uid, `s${id}`, { type: 'wedding', brand: 'miolove', accessMode, ...(accessMode === 'trial' ? { trialPhotoCount: 0, trialPhotoLimit: 50 } : {}), guestConfig: null, screenConfig: null, ...over }))
  return { owner, id }
}
const ev = async (c: TestClient, id: string) => (await getDoc(doc(c.db, 'events', id))).data()!
const upload = (g: TestClient, eventId: string) => callAs(g, 'createPhotoUpload', { eventId, ext: 'jpg', source: 'live_booth' })

for (const mode of ['trial', 'activated'] as const) {
  test(`PRV1 [${mode}]. MIOLOVE owner sets "photos on the screen" ON/OFF and "guest uploads" ON/OFF; both persist`, async () => {
    const { owner, id } = await album(mode)
    assert.deepEqual((await callAs(owner, 'updateEventConfig', { eventId: id, screenConfig: { show_photos: false } })).updated, ['screenConfig'])
    assert.deepEqual((await ev(owner, id)).screenConfig, { show_photos: false })
    await callAs(owner, 'updateEventConfig', { eventId: id, screenConfig: { show_photos: true } })
    assert.deepEqual((await ev(owner, id)).screenConfig, { show_photos: true })
    await callAs(owner, 'updateEventConfig', { eventId: id, guestConfig: { requests: false, live_booth: false } })
    assert.deepEqual((await ev(owner, id)).guestConfig, { requests: false, live_booth: false })
    await callAs(owner, 'updateEventConfig', { eventId: id, guestConfig: { requests: false, live_booth: true } })
    assert.equal((await ev(owner, id)).guestConfig.live_booth, true)
    // "reload": a fresh read through a new session of the same account sees the stored values
    assert.deepEqual([(await ev(owner, id)).screenConfig.show_photos, (await ev(owner, id)).guestConfig.live_booth], [true, true])
  })
}

test('PRV2. the album switch writes ONLY show_photos: other screen keys sent by a client are dropped, stored ones are kept; a non-boolean is refused', async () => {
  const { owner, id } = await album('activated', { screenConfig: { couple_font: 'cormorant' } })
  await callAs(owner, 'updateEventConfig', { eventId: id, screenConfig: { show_photos: false, show_polls: true, show_roulette: true } })
  assert.deepEqual((await ev(owner, id)).screenConfig, { couple_font: 'cormorant', show_photos: false })
  assert.equal(await fails(callAs(owner, 'updateEventConfig', { eventId: id, screenConfig: { show_photos: 'no' } })), 'invalid-argument:invalid_payload')
})

test('PRV3. everything else of the DJ screen stays refused on an album, even for its owner (no show_photos, null, winner, Screen Mode)', async () => {
  const { owner, id } = await album('activated'); const deny = 'permission-denied:dj_account_required'
  for (const data of [{ screenConfig: { show_polls: true } }, { screenConfig: null }, { screenConfig: {} }, { winnerAnnouncement: null }, { screenModeEnabled: false },
    { screenConfig: { show_photos: true }, screenModeEnabled: true }, { screenConfig: { show_photos: true }, winnerAnnouncement: null }]) {
    assert.equal(await fails(callAs(owner, 'updateEventConfig', { eventId: id, ...data })), deny, JSON.stringify(data))
  }
  assert.equal((await ev(owner, id)).screenConfig, null)
})

test('PRV4. denied: anonymous, a signed-in non-owner, the owner of ANOTHER album, an unknown event — for both switches', async () => {
  const { id } = await album('activated'); const other = await album('activated')
  const anon = await mk('anonymous'), stranger = await mk()
  for (const data of [{ screenConfig: { show_photos: false } }, { guestConfig: { live_booth: false } }]) {
    assert.equal(await fails(callAs(anon, 'updateEventConfig', { eventId: id, ...data })), 'permission-denied:account_required')
    assert.equal(await fails(callAs(stranger, 'updateEventConfig', { eventId: id, ...data })), 'not-found:event_not_found')
    assert.equal(await fails(callAs(other.owner, 'updateEventConfig', { eventId: id, ...data })), 'not-found:event_not_found')
    assert.equal(await fails(callAs(other.owner, 'updateEventConfig', { eventId: 'nope' + id, ...data })), 'not-found:event_not_found')
  }
  const o = await ev(other.owner, other.id); assert.equal(o.screenConfig, null)
})

test('PRV5. IOMIXO unchanged: a DJ event still takes the whole screen config + Screen Mode, and a MIOLOVE album of the same uid is not affected by it', async () => {
  const dj = await mk(); const id = `prvdj${Date.now()}${n++}`
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, email: dj.email, accountType: 'dj', plan: { tier: 'wedding', source: 'legacy' } })
  await seedSet(`events/${id}`, eventFields(dj.uid, `s${id}`, { type: 'wedding', brand: 'iomixo' }))
  const r = await callAs(dj, 'updateEventConfig', { eventId: id, screenConfig: { show_photos: true, show_polls: true }, screenModeEnabled: true })
  assert.deepEqual(r.updated.sort(), ['screenConfig', 'screenModeEnabled'])
  assert.deepEqual((await ev(dj, id)).screenConfig, { show_photos: true, show_polls: true })
})

test('PRV6. guest upload obeys "Invio foto degli ospiti": OFF is refused server-side, ON (or never set) works again; IOMIXO uploads ignore the album flag', async () => {
  const { owner, id } = await album('activated'); const g = await mk('anonymous')
  assert.ok((await upload(g, id)).photoId, 'never set = open')
  await callAs(owner, 'updateEventConfig', { eventId: id, guestConfig: { live_booth: false } })
  assert.equal(await fails(upload(await mk('anonymous'), id)), 'permission-denied:guest_uploads_disabled')
  await callAs(owner, 'updateEventConfig', { eventId: id, guestConfig: { live_booth: true } })
  assert.ok((await upload(await mk('anonymous'), id)).photoId, 'back ON')
  const t = await album('trial', { guestConfig: { live_booth: false } })
  assert.equal(await fails(upload(await mk('anonymous'), t.id)), 'permission-denied:guest_uploads_disabled')
})
