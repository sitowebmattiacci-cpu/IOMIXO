import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { getStorage, connectStorageEmulator, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc, where } from 'firebase/firestore'
import { newClient, closeClient, denied, type TestClient } from './helpers'
import { seedSet, seedUpdate, eventFields } from './seed'

/**
 * MIOLOVE "Galleria condivisa" (guestConfig.shared_gallery): the SERVER decides whether guests may see the media of others. With the switch off (the initial
 * value of every album) a guest can still UPLOAD but cannot read the photo documents (get, list, the same query the gallery runs) nor resolve any file in
 * Storage; the owner always reads everything; the switch is per album and only its owner can flip it. Real emulators (Auth, Firestore, Functions, Storage
 * with their rules); nothing is mocked and no UI is involved, so hiding the interface can never be what these tests rely on.
 */
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
async function storageFails(p: Promise<unknown>) { try { await p } catch (e: any) { return String(e.code) } assert.fail('expected a Storage rejection') }
const bytes = (n: number, seed: number) => { const b = Buffer.alloc(n); let x = seed >>> 0 || 1; for (let i = 0; i < n; i++) { x = (x * 1664525 + 1013904223) >>> 0; b[i] = x >>> 24 } return b }
const putObj = (g: TestClient, path: string, data: Uint8Array, contentType: string) => new Promise<void>((resolve, reject) => {
  const task = uploadBytesResumable(ref(stor(g), path), data, { contentType }); task.on('state_changed', undefined, reject, () => resolve())
})
let n = 0

/** The exact query the guest gallery runs (lib/firebase/repositories/photoRepository.ts → listApprovedPage). */
const galleryQuery = (c: TestClient, eventId: string) => getDocs(query(collection(c.db, 'events', eventId, 'photos'), where('status', '==', 'approved'), orderBy('createdAt', 'desc'), limit(24)))

async function album(guestConfig: Record<string, unknown> | null | undefined, over: Record<string, unknown> = {}) {
  const owner = await mk(); const id = `sg${Date.now()}${n++}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, accountType: 'couple', plan: { tier: 'free', source: 'default' } })
  await seedSet(`events/${id}`, eventFields(owner.uid, `s${id}`, { type: 'wedding', brand: 'miolove', accessMode: 'activated', occasionType: 'wedding', guestConfig, screenConfig: null, ...over }))
  await seedSet(`eventSlugs/s${id}`, { eventId: id })
  return { owner, id }
}
/** One approved photo and one approved video, sent exactly as the browser does (derivatives, the original last, finalize). */
async function addMedia(eventId: string, kind: 'photo' | 'video') {
  const g = await mk('anonymous')
  const photo = kind === 'photo'
  const s = await callAs<any>(g, 'createPhotoUpload', { eventId, ext: photo ? 'jpg' : 'mp4', size: 5000, source: 'live_booth', guestName: 'Guest', withOptimized: photo, withThumb: true, originalFilename: photo ? 'a.jpg' : 'v.mp4', width: 400, height: 300, durationSec: photo ? undefined : 4 })
  if (s.optimizedPath) await putObj(g, s.optimizedPath, bytes(2000, 2), 'image/jpeg')
  await putObj(g, s.thumbPath, bytes(900, 3), 'image/jpeg')
  await putObj(g, s.storagePath, bytes(5000, 1), s.contentType)
  await callAs(g, 'finalizePhoto', { eventId, photoId: s.photoId })
  return s as { photoId: string; storagePath: string; optimizedPath: string | null; thumbPath: string }
}
const readAll = async (c: TestClient, id: string, p: { photoId: string; storagePath: string; optimizedPath: string | null; thumbPath: string }) => {
  const out: string[] = []
  out.push((await galleryQuery(c, id)).size > 0 ? 'list:ok' : 'list:empty')
  out.push((await getDoc(doc(c.db, 'events', id, 'photos', p.photoId))).exists() ? 'get:ok' : 'get:missing')
  await getDownloadURL(ref(stor(c), p.optimizedPath ?? p.storagePath)); out.push('file:ok')
  await getDownloadURL(ref(stor(c), p.thumbPath)); out.push('thumb:ok')
  return out
}

test('SG1. the initial value is OFF: a guest uploads but cannot read — not the document, not the gallery query, not the thumbnail, the image or the video file', async () => {
  for (const cfg of [null, undefined, { requests: false, live_booth: true }, { shared_gallery: false }, { shared_gallery: 'true' }, { shared_gallery: 1 }]) {
    const { owner, id } = await album(cfg as any)
    const ph = await addMedia(id, 'photo'), vid = await addMedia(id, 'video')            // uploading keeps working with the gallery off
    const g = await mk('anonymous')
    assert.equal(await denied(galleryQuery(g, id)), true, `list refused (${JSON.stringify(cfg)})`)
    assert.equal(await denied(getDoc(doc(g.db, 'events', id, 'photos', ph.photoId))), true, 'get refused')
    assert.equal(await denied(getDocs(collection(g.db, 'events', id, 'photos'))), true, 'unfiltered list refused')
    for (const path of [ph.optimizedPath!, ph.thumbPath, vid.storagePath, vid.thumbPath]) assert.equal(await storageFails(getDownloadURL(ref(stor(g), path))), 'storage/unauthorized', path)
    // a signed-in account that is NOT the owner is a guest too
    const stranger = await mk()
    assert.equal(await denied(galleryQuery(stranger, id)), true); assert.equal(await storageFails(getDownloadURL(ref(stor(stranger), ph.optimizedPath!))), 'storage/unauthorized')
    // the owner sees everything, whatever the switch says
    assert.deepEqual(await readAll(owner, id, ph), ['list:ok', 'get:ok', 'file:ok', 'thumb:ok'])
    assert.match(await getDownloadURL(ref(stor(owner), vid.storagePath)), /original\.mp4/); assert.match(await getDownloadURL(ref(stor(owner), ph.storagePath)), /original\.jpg/)
  }
})

test('SG2. the owner switches it ON through the callable: guests list the approved media and resolve thumbnail / image / video; the ORIGINAL photo stays closed; pending stays hidden', async () => {
  const { owner, id } = await album({ requests: false, live_booth: true })
  const ph = await addMedia(id, 'photo'), vid = await addMedia(id, 'video')
  const g = await mk('anonymous')
  assert.equal(await denied(galleryQuery(g, id)), true, 'closed before')
  assert.deepEqual((await callAs(owner, 'updateEventConfig', { eventId: id, guestConfig: { requests: false, live_booth: true, shared_gallery: true } })).updated, ['guestConfig'])
  const snap = await galleryQuery(g, id)
  assert.equal(snap.size, 2); assert.deepEqual(snap.docs.map((d) => d.data().status), ['approved', 'approved'])
  assert.deepEqual(await readAll(g, id, ph), ['list:ok', 'get:ok', 'file:ok', 'thumb:ok'])
  assert.match(await getDownloadURL(ref(stor(g), vid.storagePath)), /original\.mp4/, 'a video plays from its own file')
  assert.equal(await storageFails(getDownloadURL(ref(stor(g), ph.storagePath))), 'storage/unauthorized', 'the original photo is never a guest read')
  // an upload still in progress (not approved) is not part of the gallery
  const up = await mk('anonymous'); await callAs(up, 'createPhotoUpload', { eventId: id, ext: 'jpg', size: 10, source: 'live_booth' })
  assert.equal((await galleryQuery(g, id)).size, 2, 'unfinished upload not listed')
})

test('SG3. switching it back OFF closes the server again at once (documents and files); the owner still reads everything', async () => {
  const { owner, id } = await album({ shared_gallery: true })
  const ph = await addMedia(id, 'photo'); const g = await mk('anonymous')
  assert.deepEqual(await readAll(g, id, ph), ['list:ok', 'get:ok', 'file:ok', 'thumb:ok'])
  await callAs(owner, 'updateEventConfig', { eventId: id, guestConfig: { shared_gallery: false } })
  assert.equal(await denied(galleryQuery(g, id)), true); assert.equal(await denied(getDoc(doc(g.db, 'events', id, 'photos', ph.photoId))), true)
  assert.equal(await storageFails(getDownloadURL(ref(stor(g), ph.optimizedPath!))), 'storage/unauthorized')
  assert.deepEqual(await readAll(owner, id, ph), ['list:ok', 'get:ok', 'file:ok', 'thumb:ok'])
})

test('SG4. the setting is per album: one album shared, another not, neither affects the other', async () => {
  const a = await album({ shared_gallery: true }), b = await album({ shared_gallery: false })
  await addMedia(a.id, 'photo'); await addMedia(b.id, 'photo')
  const g = await mk('anonymous')
  assert.equal((await galleryQuery(g, a.id)).size, 1); assert.equal(await denied(galleryQuery(g, b.id)), true)
  await callAs(b.owner, 'updateEventConfig', { eventId: b.id, guestConfig: { shared_gallery: true } })
  assert.equal((await galleryQuery(g, b.id)).size, 1)
  await callAs(a.owner, 'updateEventConfig', { eventId: a.id, guestConfig: { shared_gallery: false } })
  assert.equal(await denied(galleryQuery(g, a.id)), true); assert.equal((await galleryQuery(g, b.id)).size, 1, 'B untouched')
  // an owner cannot flip the switch of another owner's album
  assert.match(await fails(callAs(a.owner, 'updateEventConfig', { eventId: b.id, guestConfig: { shared_gallery: false } })), /^(permission-denied|not-found)/)
  assert.equal((await galleryQuery(g, b.id)).size, 1, 'B still shared')
})

test('SG5. only the album owner flips it: a guest, a stranger account and a signed-out caller are refused; a non-boolean value is refused and nothing is stored', async () => {
  const { owner, id } = await album({ live_booth: true })
  const guest = await mk('anonymous'), stranger = await mk()
  for (const c of [guest, stranger]) assert.match(await fails(callAs(c, 'updateEventConfig', { eventId: id, guestConfig: { shared_gallery: true } })), /^(permission-denied|unauthenticated|not-found)/)
  for (const bad of ['true', 1, null, {}, []]) assert.equal(await fails(callAs(owner, 'updateEventConfig', { eventId: id, guestConfig: { shared_gallery: bad } })), 'invalid-argument:invalid_payload', JSON.stringify(bad))
  assert.equal((await getDoc(doc(owner.db, 'events', id))).data()!.guestConfig.shared_gallery, undefined, 'nothing stored (also not by the refused guest / stranger)')
  assert.equal(await denied(galleryQuery(await mk('anonymous'), id)), true)
})

test('SG6. a guest cannot open the gallery by writing the switch themselves (Firestore client writes to the event are refused)', async () => {
  const { id } = await album({ live_booth: true }); const g = await mk('anonymous')
  assert.equal(await denied(updateDoc(doc(g.db, 'events', id), { 'guestConfig.shared_gallery': true })), true)
  assert.equal(await denied(galleryQuery(g, id)), true)
})

test('SG7. the public page payload carries the setting for the interface, but the media stay closed without it', async () => {
  const { id } = await album({ requests: false, live_booth: true }); await addMedia(id, 'photo')
  const g = await mk('anonymous')
  const off = await callAs<any>(g, 'getPublicEvent', { slug: `s${id}` })
  assert.equal(off.session.guest_config.shared_gallery, undefined); assert.equal(await denied(galleryQuery(g, id)), true)
  await seedUpdate(`events/${id}`, { guestConfig: { requests: false, live_booth: true, shared_gallery: true } })
  const on = await callAs<any>(g, 'getPublicEvent', { slug: `s${id}` })
  assert.equal(on.session.guest_config.shared_gallery, true); assert.equal((await galleryQuery(g, id)).size, 1)
})

test('SG8. IOMIXO is not touched: a DJ party / wedding event keeps its guest reads whatever guestConfig.shared_gallery holds', async () => {
  const owner = await mk(); const id = `sgd${Date.now()}${n++}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, accountType: 'dj', plan: { tier: 'advance', source: 'legacy' } })
  await seedSet(`events/${id}`, eventFields(owner.uid, `s${id}`, { type: 'party', brand: 'iomixo', guestConfig: { requests: true } }))
  await seedSet(`events/${id}/photos/p1`, { guestUid: 'x', status: 'approved', source: 'guest_upload', storagePath: `events/${id}/photos/p1/original.jpg`, contentType: 'image/jpeg', createdAt: new Date(), updatedAt: new Date(), isFeatured: false })
  const g = await mk('anonymous')
  assert.equal((await galleryQuery(g, id)).size, 1, 'no switch on an IOMIXO event: reads as before')
})

test('SG9. a deleted album stays closed to guests even with the switch on', async () => {
  const { id } = await album({ shared_gallery: true }); await addMedia(id, 'photo')
  await seedUpdate(`events/${id}`, { deletedAt: new Date() })
  assert.equal(await denied(galleryQuery(await mk('anonymous'), id)), true)
})

/**
 * Download URLs carry a token that works WITHOUT the rules, so switching the gallery off must replace the token of every approved file. The Storage EMULATOR cannot
 * show an old link dying: it appends a new token to the list instead of replacing the old one (firebase-tools metadata.js setDownloadTokensFromCustomMetadata), so
 * a revoked link keeps answering 200 there. What is proven here: the rotation runs exactly on ON → OFF of a MIOLOVE album, for every approved file (original,
 * optimized, thumbnail / poster) and no other, and a link issued afterwards works. Whether the old token really dies is GCS custom-metadata semantics (the key's
 * value is replaced) and is only checkable against the real bucket — see the release notes.
 */
const tokensOf = async (c: TestClient, path: string) => {
  const url = await getDownloadURL(ref(stor(c), path)); const m = await (await fetch(url.replace('alt=media', 'alt=json'))).json() as { downloadTokens?: string }
  return { url, tokens: String(m.downloadTokens ?? '').split(',').filter(Boolean) }
}
test('SG10. REVOCATION: ON → OFF rotates the download token of every approved file of that MIOLOVE album (and only then); ON again hands out a working link', async () => {
  const { owner, id } = await album({ shared_gallery: true })
  const ph = await addMedia(id, 'photo'), vid = await addMedia(id, 'video'); const other = await album({ shared_gallery: true }); const oph = await addMedia(other.id, 'photo')
  const g = await mk('anonymous')
  const paths = [ph.optimizedPath!, ph.thumbPath, vid.storagePath, vid.thumbPath]
  const before = new Map<string, string[]>(); for (const p of paths) before.set(p, (await tokensOf(g, p)).tokens)
  const otherBefore = (await tokensOf(g, oph.thumbPath)).tokens
  const lastOf = (a: string[]) => a[a.length - 1]
  await callAs(owner, 'updateEventConfig', { eventId: id, guestConfig: { shared_gallery: true, live_booth: true } })            // still ON: nothing is rotated
  for (const p of paths) assert.deepEqual((await tokensOf(owner, p)).tokens, before.get(p), `ON → ON leaves the token alone (${p})`)
  await callAs(owner, 'updateEventConfig', { eventId: id, guestConfig: { shared_gallery: false } })
  for (const p of paths) { const t = (await tokensOf(owner, p)).tokens; assert.notEqual(lastOf(t), lastOf(before.get(p)!), `a NEW token was issued on OFF (${p})`) }
  assert.deepEqual((await tokensOf(other.owner, oph.thumbPath)).tokens, otherBefore, 'another album is untouched')
  assert.equal(await storageFails(getDownloadURL(ref(stor(g), paths[0]))), 'storage/unauthorized', 'a guest gets no new link while OFF')
  await callAs(owner, 'updateEventConfig', { eventId: id, guestConfig: { shared_gallery: true } })
  const fresh = await getDownloadURL(ref(stor(g), paths[0])); assert.equal((await fetch(fresh)).status, 200, 'a link issued after ON again works')
})

test('SG11. IOMIXO is not touched by the revocation: a DJ event never rotates tokens when guestConfig changes', async () => {
  const owner = await mk(); const id = `sgd${Date.now()}${n++}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, accountType: 'dj', plan: { tier: 'advance', source: 'legacy' } })
  await seedSet(`events/${id}`, eventFields(owner.uid, `s${id}`, { type: 'party', brand: 'iomixo', guestConfig: { shared_gallery: true } }))
  await seedSet(`eventSlugs/s${id}`, { eventId: id })
  const up = await mk('anonymous')
  const sess = await callAs<any>(up, 'createPhotoUpload', { eventId: id, ext: 'jpg', size: 900, source: 'live_booth', guestName: 'G' })
  await putObj(up, sess.storagePath, bytes(900, 5), 'image/jpeg'); await callAs(up, 'finalizePhoto', { eventId: id, photoId: sess.photoId })
  const before = (await tokensOf(owner, sess.storagePath)).tokens
  await callAs(owner, 'updateEventConfig', { eventId: id, guestConfig: { shared_gallery: false } })
  assert.deepEqual((await tokensOf(owner, sess.storagePath)).tokens, before, 'DJ event: token untouched')
})
