import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { getStorage, connectStorageEmulator, ref, uploadBytes } from 'firebase/storage'
import { newClient, closeClient, type TestClient } from './helpers'
import { seedSet, eventFields } from './seed'

/**
 * MIOLOVE album, guest side: a trial / activated album is NOT gated by the owner's DJ plan or by the event date (a future date was the reported
 * "available soon" case), and the 7-day trial is measured by the SERVER clock (trialExpiresAt written by createEvent) and only closes new uploads.
 */
const BUCKET = 'gs://demo-iomixo.firebasestorage.app'
const clients: TestClient[] = []
after(async () => { await Promise.all(clients.map(closeClient)) })
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }
const callAs = <O = any>(c: TestClient, name: string, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, O>(f, name)(data as any).then((r) => r.data)
}
const stor = (c: TestClient) => { const s = getStorage(c.app, BUCKET); try { connectStorageEmulator(s, '127.0.0.1', 9199) } catch { /* connected */ } return s }
async function fails(p: Promise<unknown>) { try { await p } catch (e: any) { return `${String(e.code).replace('functions/', '')}:${e.details?.reason ?? ''}` } assert.fail('expected rejection') }
const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
let n = 0

async function album(over: Record<string, unknown>, tier: 'free' | 'wedding' = 'free') {
  const owner = await mk(); const id = `alb${Date.now()}${n++}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, accountType: 'couple', plan: { tier, source: tier === 'free' ? 'default' : 'legacy' } })
  await seedSet(`events/${id}`, eventFields(owner.uid, `s${id}`, { type: 'wedding', brand: 'miolove', occasionType: 'birthday', ...over })); await seedSet(`eventSlugs/s${id}`, { eventId: id })
  return { owner, id, slug: `s${id}` }
}
const future = () => new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10)
const pub = async (slug: string) => callAs<any>(await mk('anonymous'), 'getPublicEvent', { slug })

test('G1. FUTURE date: a trial album serves guests at once (photo album + screen on, occasion and trial info exposed, not "available soon")', async () => {
  const { slug } = await album({ accessMode: 'trial', trialPhotoCount: 0, trialPhotoLimit: 50, weddingDate: future(), guestConfig: null, trialExpiresAt: new Date(Date.now() + 5 * 86_400_000) })
  const p = await pub(slug)
  assert.equal(p.features.guestPhotoAlbum, true); assert.equal(p.features.screenMode, true)
  assert.deepEqual([p.features.weddingDedications, p.features.weddingGames, p.features.livePolls], [false, false, false], 'DJ-only interactions never exist on an album')
  assert.deepEqual([p.session.occasion_type, p.session.access_mode, p.session.trial_expired, p.session.is_active], ['birthday', 'trial', false, true])
  assert.ok(p.session.trial_expires_at)
})

test('G2. activated album with a future date: same, no trial info', async () => {
  const { slug } = await album({ accessMode: 'activated', weddingDate: future() })
  const p = await pub(slug)
  assert.equal(p.features.guestPhotoAlbum, true); assert.equal(p.features.screenMode, true)
  assert.deepEqual([p.session.access_mode, p.session.trial_expires_at, p.session.trial_expired], ['activated', null, false])
})

test('G3. IOMIXO is unchanged: a DJ Free wedding event keeps the plan-based features (no photo album, no screen)', async () => {
  const owner = await mk(); const id = `dj${Date.now()}${n++}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, plan: { tier: 'free', source: 'default' } })
  await seedSet(`events/${id}`, eventFields(owner.uid, `s${id}`, { type: 'wedding', brand: 'iomixo' })); await seedSet(`eventSlugs/s${id}`, { eventId: id })
  const p = await pub(`s${id}`)
  assert.deepEqual([p.features.guestPhotoAlbum, p.features.screenMode], [false, false])
})

test('T7. createEvent stamps trialStartsAt / trialExpiresAt = +7 days (server clock); activated albums get none', async () => {
  const c = await mk(); await seedSet(`users/${c.uid}`, { uid: c.uid, email: c.email, accountType: 'couple', plan: { tier: 'free', source: 'default' } })
  const before = Date.now()
  const r = await callAs<{ eventId: string }>(c, 'createEvent', { requestId: `t7${Date.now()}`, title: 'Album', type: 'wedding', occasionType: 'baptism', weddingDate: future() })
  const f = (await fsGet(`events/${r.eventId}`)).fields
  const start = Date.parse(f.trialStartsAt.timestampValue), end = Date.parse(f.trialExpiresAt.timestampValue)
  assert.ok(start >= before - 2000 && start <= Date.now() + 2000)
  assert.equal(Math.round((end - start) / 86_400_000), 7)
  assert.equal(f.screenModeEnabled.booleanValue, true)
  const paid = await mk(); await seedSet(`users/${paid.uid}`, { uid: paid.uid, email: paid.email, accountType: 'couple', plan: { tier: 'free', source: 'default' }, miolovePlan: { tier: 'wedding', source: 'stripe' } })
  const p = await callAs<{ eventId: string }>(paid, 'createEvent', { requestId: `t7p${Date.now()}`, title: 'Album', type: 'wedding' })
  const pf = (await fsGet(`events/${p.eventId}`)).fields
  assert.deepEqual([pf.trialStartsAt, pf.trialExpiresAt], [undefined, undefined])
})

test('T8. expired trial: reading works, the public payload says expired, new uploads are refused with miolove_trial_expired; nothing is deleted', async () => {
  const { id, slug } = await album({ accessMode: 'trial', trialPhotoCount: 3, trialPhotoLimit: 50, trialExpiresAt: new Date(Date.now() - 60_000), trialStartsAt: new Date(Date.now() - 7 * 86_400_000) })
  const p = await pub(slug)
  assert.equal(p.session.trial_expired, true); assert.equal(p.features.guestPhotoAlbum, true)
  const g = await mk('anonymous')
  assert.equal(await fails(callAs(g, 'createPhotoUpload', { eventId: id, ext: 'jpg', source: 'live_booth' })), 'failed-precondition:miolove_trial_expired')
  assert.equal(Number((await fsGet(`events/${id}`)).fields.trialPhotoCount.integerValue), 3, 'the counter and the media are untouched')
})

test('T9. an upload started before the end and finalized after it is refused and cleaned up', async () => {
  const { id } = await album({ accessMode: 'trial', trialPhotoCount: 0, trialPhotoLimit: 50, trialExpiresAt: new Date(Date.now() + 120_000) })
  const g = await mk('anonymous')
  const u = await callAs<{ photoId: string; storagePath: string; contentType: string }>(g, 'createPhotoUpload', { eventId: id, ext: 'jpg', source: 'live_booth' })
  await uploadBytes(ref(stor(g), u.storagePath), new Uint8Array(2048).fill(7), { contentType: u.contentType })
  await seedSet(`events/${id}`, eventFields((await fsGet(`events/${id}`)).fields.ownerUid.stringValue, `s${id}`, { type: 'wedding', brand: 'miolove', accessMode: 'trial', trialPhotoCount: 0, trialPhotoLimit: 50, trialExpiresAt: new Date(Date.now() - 1000) }))
  assert.equal(await fails(callAs(g, 'finalizePhoto', { eventId: id, photoId: u.photoId })), 'failed-precondition:miolove_trial_expired')
  assert.equal(Number((await fsGet(`events/${id}`)).fields.trialPhotoCount.integerValue), 0)
})

test('T10. a trial album WITHOUT trialExpiresAt (created before the field) never expires; an activated album is never trial-expired', async () => {
  const old = await album({ accessMode: 'trial', trialPhotoCount: 0, trialPhotoLimit: 50 })
  const g = await mk('anonymous')
  assert.ok((await callAs(g, 'createPhotoUpload', { eventId: old.id, ext: 'jpg', source: 'live_booth' })).photoId)
  assert.equal((await pub(old.slug)).session.trial_expired, false)
  const act = await album({ accessMode: 'activated', trialExpiresAt: new Date(Date.now() - 1000) })
  assert.ok((await callAs(await mk('anonymous'), 'createPhotoUpload', { eventId: act.id, ext: 'jpg', source: 'live_booth' })).photoId)
})
