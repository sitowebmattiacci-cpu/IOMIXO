import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { getStorage, connectStorageEmulator, ref, uploadBytes } from 'firebase/storage'
import { newClient, closeClient, type TestClient } from './helpers'
import { seedSet, eventFields } from './seed'

/**
 * MIOLOVE free trial: the photo flow works on a trial / activated Wedding album without the professional entitlement,
 * and a trial album holds at most MIOLOVE_TRIAL_PHOTO_LIMIT approved photos (checked in finalizePhoto, atomically).
 */
const LIMIT = 50
const BUCKET = 'gs://demo-iomixo.firebasestorage.app'
const clients: TestClient[] = []
after(async () => { await Promise.all(clients.map(closeClient)) })
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }
const callAs = <O = any>(c: TestClient, name: string, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, O>(f, name)(data as any).then((r) => r.data)
}
const stor = (c: TestClient) => { const s = getStorage(c.app, BUCKET); try { connectStorageEmulator(s, '127.0.0.1', 9199) } catch { /* already connected */ } return s }
async function fails(p: Promise<unknown>) { try { await p } catch (e: any) { return `${String(e.code).replace('functions/', '')}:${e.details?.reason ?? ''}` } assert.fail('expected rejection') }
const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
const objExists = async (path: string) => (await fetch(`http://127.0.0.1:9199/v0/b/demo-iomixo.firebasestorage.app/o/${encodeURIComponent(path)}`, { headers: { authorization: 'Bearer owner' } })).ok
const countOf = async (id: string) => Number((await fsGet(`events/${id}`)).fields.trialPhotoCount?.integerValue ?? -1)
const LIMIT_ERR = 'resource-exhausted:miolove_trial_photo_limit_reached'
let n = 0

type Over = Record<string, unknown>
/** An event owned by a Free account (no Advance, no Event Pass) unless `tier` says otherwise. */
async function setup(over: Over = {}, tier: 'free' | 'wedding' = 'free', accountType: 'couple' | 'dj' = 'couple') {
  const owner = await mk(); const id = `tph${Date.now()}${n++}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, accountType, plan: { tier, source: tier === 'free' ? 'default' : 'legacy' } })
  await seedSet(`events/${id}`, eventFields(owner.uid, `tp${id}`, { type: 'wedding', ...over })); await seedSet(`eventSlugs/tp${id}`, { eventId: id })
  return { owner, id }
}
const trial = (count: number, over: Over = {}) => ({ accessMode: 'trial', trialPhotoCount: count, trialPhotoLimit: LIMIT, ...over })
const slot = (g: TestClient, eventId: string) => callAs<{ photoId: string; storagePath: string; contentType: string }>(g, 'createPhotoUpload', { eventId, ext: 'jpg', source: 'guest_upload', guestName: 'Zia' })
const put = async (g: TestClient, u: { storagePath: string; contentType: string }) => { await uploadBytes(ref(stor(g), u.storagePath), new Uint8Array(2048).fill(7), { contentType: u.contentType }) }
const finalize = (g: TestClient, eventId: string, photoId: string) => callAs<{ photoId: string; status: string }>(g, 'finalizePhoto', { eventId, photoId })
/** A fresh anonymous guest each time: the per-guest cooldown is not what these tests are about. */
async function photo(eventId: string) {
  const g = await mk('anonymous'); const u = await slot(g, eventId); await put(g, u)
  return { g, u, done: () => finalize(g, eventId, u.photoId) }
}
const status = async (id: string, photoId: string) => (await fsGet(`events/${id}/photos/${photoId}`)).fields?.status?.stringValue

test('T0. createEvent initialises the trial counter (0 / limit) for a new trial album only', async () => {
  const c = await mk(); await seedSet(`users/${c.uid}`, { uid: c.uid, email: c.email, accountType: 'couple', plan: { tier: 'free', source: 'default' } })
  const r = await callAs<{ eventId: string }>(c, 'createEvent', { requestId: `t0${Date.now()}`, title: 'Album', type: 'wedding', occasionType: 'wedding' })
  const f = (await fsGet(`events/${r.eventId}`)).fields
  assert.deepEqual([f.accessMode.stringValue, Number(f.trialPhotoCount.integerValue), Number(f.trialPhotoLimit.integerValue)], ['trial', 0, LIMIT])
  const paid = await mk(); await seedSet(`users/${paid.uid}`, { uid: paid.uid, email: paid.email, accountType: 'couple', plan: { tier: 'wedding', source: 'legacy' } })
  const p = await callAs<{ eventId: string }>(paid, 'createEvent', { requestId: `t0p${Date.now()}`, title: 'Album', type: 'wedding', occasionType: 'wedding' })
  const pf = (await fsGet(`events/${p.eventId}`)).fields
  assert.equal(pf.accessMode.stringValue, 'activated'); assert.equal(pf.trialPhotoCount, undefined, 'activated albums carry no trial counter')
})

test('A. trial album: the first photo (Free owner, no entitlement) is accepted, approved, and takes slot 1', async () => {
  const { id } = await setup(trial(0))
  const p = await photo(id)
  assert.deepEqual(await p.done(), { photoId: p.u.photoId, status: 'approved' })
  assert.equal(await countOf(id), 1)
  assert.deepEqual(await p.done(), { photoId: p.u.photoId, status: 'approved' }, 'idempotent: a replay does not take a second slot'); assert.equal(await countOf(id), 1)
})

test('B/C/D. photo 49 and the 50th are accepted, the 51st is refused (no slot, no generic error)', async () => {
  const { id } = await setup(trial(LIMIT - 2))
  assert.equal((await (await photo(id)).done()).status, 'approved'); assert.equal(await countOf(id), LIMIT - 1)   // 49th
  assert.equal((await (await photo(id)).done()).status, 'approved'); assert.equal(await countOf(id), LIMIT)       // 50th
  const g = await mk('anonymous')
  assert.equal(await fails(slot(g, id)), LIMIT_ERR, '51st: refused at the slot, before any byte is uploaded')
  assert.equal(await countOf(id), LIMIT)
})

test('E. two finalizes racing from 49: exactly one takes the 50th slot, the other is refused and cleaned up; never 51', async () => {
  const { id } = await setup(trial(LIMIT - 1))
  const [a, b] = [await photo(id), await photo(id)]      // both slots were issued while 49 / 50
  const out = await Promise.allSettled([a.done(), b.done()])
  const ok = out.filter((o) => o.status === 'fulfilled'), no = out.filter((o) => o.status === 'rejected') as PromiseRejectedResult[]
  assert.equal(ok.length, 1); assert.equal(no.length, 1)
  assert.equal(`${String(no[0].reason.code).replace('functions/', '')}:${no[0].reason.details?.reason}`, LIMIT_ERR)
  assert.equal(await countOf(id), LIMIT)
  const loser = out[0].status === 'rejected' ? a : b, winner = loser === a ? b : a
  assert.equal(await status(id, loser.u.photoId), undefined, 'the refused upload leaves no document')
  assert.equal(await objExists(loser.u.storagePath), false, 'nor a file in Storage')
  assert.equal(await status(id, winner.u.photoId), 'approved'); assert.equal(await objExists(winner.u.storagePath), true)
})

test('F. a failed upload never takes a slot: no bytes, a rejected file, or an abandoned slot leave the counter unchanged', async () => {
  const { id } = await setup(trial(7))
  const g = await mk('anonymous'); const u = await slot(g, id)
  assert.equal(await fails(finalize(g, id, u.photoId)), 'failed-precondition:upload_missing')
  assert.equal(await status(id, u.photoId), 'uploading'); assert.equal(await countOf(id), 7, 'an `uploading` photo holds no slot')
  await put(g, u); await finalize(g, id, u.photoId); assert.equal(await countOf(id), 8, 'and it takes one only once finalized')
})

test('G. deleting an approved photo frees its slot (50 → 49) and a new photo is accepted again; the counter never goes below zero', async () => {
  const { owner, id } = await setup(trial(LIMIT - 1)); const p = await photo(id); await p.done(); assert.equal(await countOf(id), LIMIT)
  assert.equal(await fails(slot(await mk('anonymous'), id)), LIMIT_ERR)
  assert.deepEqual(await callAs(owner, 'moderatePhoto', { eventId: id, photoId: p.u.photoId, action: 'delete' }), { changed: true, deleted: true })
  assert.equal(await countOf(id), LIMIT - 1); assert.equal(await objExists(p.u.storagePath), false)
  assert.equal((await (await photo(id)).done()).status, 'approved'); assert.equal(await countOf(id), LIMIT)

  const z = await setup(trial(0)); const q = await photo(z.id); await q.done()
  await seedSet(`events/${z.id}`, eventFields(z.owner.uid, `tp${z.id}`, { type: 'wedding', ...trial(0) }))   // counter drifted to 0 while the photo is approved
  await callAs(z.owner, 'moderatePhoto', { eventId: z.id, photoId: q.u.photoId, action: 'delete' })
  assert.equal(await countOf(z.id), 0, 'clamped at zero')
})

test('H. deleting a photo that held no slot (uploading / pending / rejected) does not touch the counter', async () => {
  const { owner, id } = await setup(trial(5))
  const g = await mk('anonymous'); const u = await slot(g, id)                       // uploading
  await seedSet(`events/${id}/photos/pend1`, { guestUid: g.uid, status: 'pending', storagePath: `events/${id}/photos/pend1/original.jpg`, contentType: 'image/jpeg', createdAt: new Date() })
  await seedSet(`events/${id}/photos/rej1`, { guestUid: g.uid, status: 'rejected', storagePath: `events/${id}/photos/rej1/original.jpg`, contentType: 'image/jpeg', createdAt: new Date() })
  for (const photoId of [u.photoId, 'pend1', 'rej1']) { await callAs(owner, 'moderatePhoto', { eventId: id, photoId, action: 'delete' }); assert.equal(await countOf(id), 5, photoId) }
})

test('H2. the owner of a trial album can feature a photo, but status changes keep the professional gate', async () => {
  const { owner, id } = await setup(trial(0)); const p = await photo(id); await p.done()
  assert.deepEqual(await callAs(owner, 'moderatePhoto', { eventId: id, photoId: p.u.photoId, action: 'set_featured', isFeatured: true }), { changed: true, isFeatured: true })
  assert.equal((await fails(callAs(owner, 'moderatePhoto', { eventId: id, photoId: p.u.photoId, action: 'set_status', status: 'rejected' }))).split(':')[0], 'permission-denied')
  assert.equal(await countOf(id), 1)
})

test('I. activated album: no trial limit and no trial counter, even past 50 and even with a stale counter', async () => {
  const { id } = await setup({ accessMode: 'activated', trialPhotoCount: LIMIT, trialPhotoLimit: LIMIT })
  const p = await photo(id); assert.equal((await p.done()).status, 'approved')
  assert.equal(await countOf(id), LIMIT, 'untouched')
})

test('J. DJ Wedding (Advance, no accessMode): previous behaviour, no counter', async () => {
  const { id } = await setup({}, 'wedding', 'dj')
  const p = await photo(id); assert.equal((await p.done()).status, 'approved'); assert.equal(await countOf(id), -1)
})

test('K. Party: Free is still refused, Advance still moderates (pending) with no counter', async () => {
  const free = await setup({ type: 'party' }, 'free', 'dj')
  assert.equal(await fails(slot(await mk('anonymous'), free.id)), 'permission-denied:photos_unavailable')
  const adv = await setup({ type: 'party' }, 'wedding', 'dj'); const p = await photo(adv.id)
  assert.equal((await p.done()).status, 'pending'); assert.equal(await countOf(adv.id), -1)
  const mislabeled = await setup({ type: 'party', accessMode: 'trial' }, 'free', 'dj')
  assert.equal(await fails(slot(await mk('anonymous'), mislabeled.id)), 'permission-denied:photos_unavailable', 'accessMode alone never opens a non-wedding event')
})

test('L. legacy Wedding without accessMode on a Free owner: still refused (absence of the field is not a trial)', async () => {
  const { id } = await setup({}, 'free', 'dj')
  assert.equal(await fails(slot(await mk('anonymous'), id)), 'permission-denied:photos_unavailable')
  const legacyCouple = await setup({}, 'free', 'couple')
  assert.equal(await fails(slot(await mk('anonymous'), legacyCouple.id)), 'permission-denied:photos_unavailable')
})

test('M. a trial album created before the counter existed recomputes it from its approved photos', async () => {
  const { id, owner } = await setup({ accessMode: 'trial' })
  for (let i = 0; i < 3; i++) await seedSet(`events/${id}/photos/old${i}`, { guestUid: owner.uid, status: 'approved', storagePath: `events/${id}/photos/old${i}/original.jpg`, contentType: 'image/jpeg', createdAt: new Date() })
  const p = await photo(id); await p.done(); assert.equal(await countOf(id), 4)
})
