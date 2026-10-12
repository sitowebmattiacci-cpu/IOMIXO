import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc, collection, getDocs, query, where, orderBy, addDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { getStorage, connectStorageEmulator, ref, uploadBytes, getDownloadURL, getBytes, listAll, deleteObject } from 'firebase/storage'
import { newClient, closeClient, denied, type TestClient } from './helpers'
import { seedSet, seedUpdate, eventFields } from './seed'

/**
 * Photos: Functions (createPhotoUpload / finalizePhoto / moderatePhoto / winner paths in updateEventConfig) + storage.rules + firestore.rules,
 * all against the emulators (auth, firestore, functions, storage). Cross-service Storage rules read Firestore for real.
 */
const BUCKET = 'gs://demo-iomixo.firebasestorage.app', JPEG = { contentType: 'image/jpeg' }
const clients: TestClient[] = []
after(async () => { await Promise.all(clients.map(closeClient)) })
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }
const callAs = <O = any>(c: TestClient, name: string, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, O>(f, name)(data as any).then((r) => r.data)
}
const stor = (c: TestClient) => { const s = getStorage(c.app, BUCKET); try { connectStorageEmulator(s, '127.0.0.1', 9199) } catch { /* already connected */ } return s }
async function fails(p: Promise<unknown>) { try { await p } catch (e: any) { return `${String(e.code).replace('functions/', '')}:${e.details?.reason ?? ''}` } assert.fail('expected rejection') }
const sCode = async (p: Promise<unknown>) => { try { await p; return 'ok' } catch (e: any) { return String(e.code) } }
const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
const objMeta = async (path: string) => { const r = await fetch(`http://127.0.0.1:9199/v0/b/demo-iomixo.firebasestorage.app/o/${encodeURIComponent(path)}`, { headers: { authorization: 'Bearer owner' } }); return r.ok ? await r.json() : null }
const bytes = (n: number, v = 7) => new Uint8Array(n).fill(v)
let n = 0

async function setup(tier: 'wedding' | 'free' = 'wedding', over: Record<string, unknown> = {}) {
  const dj = await mk(); const id = `pev${Date.now()}${n++}`
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, plan: { tier, source: 'legacy' } })
  await seedSet(`events/${id}`, eventFields(dj.uid, `ps${id}`, { type: 'wedding', ...over })); await seedSet(`eventSlugs/ps${id}`, { eventId: id })
  return { dj, id }
}
const upload = (g: TestClient, eventId: string, over: Record<string, unknown> = {}) => callAs<{ photoId: string; storagePath: string; contentType: string }>(g, 'createPhotoUpload', { eventId, ext: 'jpg', source: 'guest_upload', guestName: 'Zia', caption: 'Che bella', size: 1000, ...over })
async function fullUpload(g: TestClient, eventId: string, over: Record<string, unknown> = {}) {
  const u = await upload(g, eventId, over)
  await uploadBytes(ref(stor(g), u.storagePath), bytes(2048), { contentType: u.contentType })
  const f = await callAs(g, 'finalizePhoto', { eventId, photoId: u.photoId })
  return { ...u, finalize: f }
}

test('P1. guest album flow: slot → direct upload → finalize → pending (invisible) → owner approves → guest can read; reject kills the old links', async () => {
  const { dj, id } = await setup(); const g = await mk('anonymous'), other = await mk('anonymous')
  const u = await upload(g, id, { source: 'live_booth' })
  assert.equal(u.storagePath, `events/${id}/photos/${u.photoId}/original.jpg`); assert.equal(u.contentType, 'image/jpeg')
  const d0 = (await fsGet(`events/${id}/photos/${u.photoId}`)).fields
  assert.deepEqual([d0.status.stringValue, d0.guestUid.stringValue, d0.source.stringValue, d0.guestName.stringValue, d0.isFeatured.booleanValue], ['uploading', g.uid, 'live_booth', 'Zia', false])
  assert.equal(await callAs(dj, 'moderatePhoto', { eventId: id, photoId: u.photoId, action: 'set_status', status: 'approved' }).then(() => 'ok', (e) => e.details?.reason), 'photo_not_ready', 'an unfinished upload cannot be approved')

  assert.equal(await fails(callAs(g, 'finalizePhoto', { eventId: id, photoId: u.photoId })), 'failed-precondition:upload_missing', 'nothing uploaded yet')
  await uploadBytes(ref(stor(g), u.storagePath), bytes(4096), { contentType: 'image/jpeg' })
  assert.deepEqual(await callAs(g, 'finalizePhoto', { eventId: id, photoId: u.photoId }), { photoId: u.photoId, status: 'pending' })
  assert.deepEqual(await callAs(g, 'finalizePhoto', { eventId: id, photoId: u.photoId }), { photoId: u.photoId, status: 'pending' }, 'idempotent')
  assert.equal(Number((await fsGet(`events/${id}/photos/${u.photoId}`)).fields.size.integerValue), 4096, 'the real size is recorded')

  // pending: neither the uploader nor other guests can read the bytes; the owner can
  assert.equal(await sCode(getDownloadURL(ref(stor(g), u.storagePath))), 'storage/unauthorized')
  assert.equal(await sCode(getDownloadURL(ref(stor(other), u.storagePath))), 'storage/unauthorized')
  assert.equal(await sCode(getBytes(ref(stor(dj), u.storagePath))), 'ok')
  const tokenBefore = (await objMeta(u.storagePath))?.downloadTokens

  assert.deepEqual(await callAs(dj, 'moderatePhoto', { eventId: id, photoId: u.photoId, action: 'set_status', status: 'approved' }), { changed: true, status: 'approved' })
  assert.deepEqual(await callAs(dj, 'moderatePhoto', { eventId: id, photoId: u.photoId, action: 'set_status', status: 'approved' }), { changed: false, status: 'approved' })
  const url = await getDownloadURL(ref(stor(other), u.storagePath))
  assert.equal((await (await fetch(url)).arrayBuffer()).byteLength, 4096, 'an approved photo is served to any signed-in guest / TV')

  await callAs(dj, 'moderatePhoto', { eventId: id, photoId: u.photoId, action: 'set_status', status: 'rejected' })
  assert.equal(await sCode(getDownloadURL(ref(stor(other), u.storagePath))), 'storage/unauthorized', 'rejected: not readable any more')
  const tokenAfter = (await objMeta(u.storagePath))?.downloadTokens
  assert.ok(tokenBefore && tokenAfter && tokenBefore !== tokenAfter, `the download token was rotated when the photo stopped being approved (${tokenBefore} -> ${tokenAfter})`)
})

test('P2. storage.rules: only the issued path, once, by its guest, image/* <= 8 MB, live event; no listing, no delete, no overwrite', async () => {
  const { dj, id } = await setup(); const g = await mk('anonymous'), thief = await mk('anonymous')
  const u = await upload(g, id)
  const at = (c: TestClient, p: string) => ref(stor(c), p)
  assert.equal(await sCode(uploadBytes(at(g, `events/${id}/photos/nodoc123/original.jpg`), bytes(10), JPEG)), 'storage/unauthorized', 'no photo doc → refused')
  assert.equal(await sCode(uploadBytes(at(thief, u.storagePath), bytes(10), JPEG)), 'storage/unauthorized', 'a path issued to another guest')
  assert.equal(await sCode(uploadBytes(at(g, `events/${id}/photos/${u.photoId}/other.jpg`), bytes(10), JPEG)), 'storage/unauthorized', 'another file name')
  assert.equal(await sCode(uploadBytes(at(g, u.storagePath), bytes(10), { contentType: 'text/html' })), 'storage/unauthorized', 'not an image')
  assert.equal(await sCode(uploadBytes(at(g, u.storagePath), bytes(10), { contentType: 'image/png' })), 'storage/unauthorized', 'type differs from the declared one')
  assert.equal(await sCode(uploadBytes(at(g, u.storagePath), bytes(8 * 1024 * 1024 + 1), JPEG)), 'storage/unauthorized', '> 8 MB')
  assert.equal(await sCode(uploadBytes(at(g, u.storagePath), bytes(0), JPEG)), 'storage/unauthorized', 'empty')
  assert.equal(await sCode(uploadBytes(at(g, u.storagePath), bytes(1024), JPEG)), 'ok', 'the real thing')
  assert.equal(await sCode(uploadBytes(at(g, u.storagePath), bytes(1024, 9), JPEG)), 'storage/unauthorized', 'no overwrite, not even by the owner of the path')
  await callAs(g, 'finalizePhoto', { eventId: id, photoId: u.photoId })
  assert.equal(await sCode(uploadBytes(at(g, u.storagePath), bytes(1024, 3), JPEG)), 'storage/unauthorized', 'no re-upload after finalize either')
  assert.equal(await sCode(listAll(at(dj, `events/${id}/photos`))), 'storage/unauthorized', 'no listing, owner included')
  assert.equal(await sCode(deleteObject(at(dj, u.storagePath))), 'storage/unauthorized', 'no client delete, owner included')
  assert.equal(await sCode(getBytes(at(thief, u.storagePath))), 'storage/unauthorized')

  // an event that ends after the slot was issued no longer accepts bytes
  const g3 = await mk('anonymous'); const u3 = await upload(g3, id)
  await seedUpdate(`events/${id}`, { status: 'ended' })
  assert.equal(await fails(upload(await mk('anonymous'), id)), 'failed-precondition:event_ended')
  assert.equal(await sCode(uploadBytes(at(g3, u3.storagePath), bytes(10), JPEG)), 'storage/unauthorized', 'bytes after the event ended')
})

test('P3. createPhotoUpload / finalizePhoto guards: plan, event type, event state, format, size, anti-spam, ownership', async () => {
  const g = await mk('anonymous')
  const ok = await setup(); const free = await setup('free'); const std = await setup('wedding', { type: 'standard' }); const ended = await setup('wedding', { status: 'ended' })
  assert.equal(await fails(upload(g, free.id)), 'permission-denied:photos_unavailable')
  assert.equal(await fails(upload(g, std.id)), 'failed-precondition:photos_unavailable')
  assert.equal(await fails(upload(g, ended.id)), 'failed-precondition:event_ended')
  assert.equal(await fails(upload(g, 'nonexistent-event')), 'not-found:event_not_found')
  assert.equal(await fails(upload(g, ok.id, { ext: 'gif' })), 'invalid-argument:unsupported_format')
  assert.equal(await fails(upload(g, ok.id, { ext: 'exe' })), 'invalid-argument:unsupported_format')
  assert.equal(await fails(upload(g, ok.id, { size: 9 * 1024 * 1024 })), 'invalid-argument:file_too_large')
  assert.equal(await fails(callAs(g, 'createPhotoUpload', { ext: 'jpg' })), 'invalid-argument:invalid_payload')

  await upload(g, ok.id)
  assert.equal(await fails(upload(g, ok.id)), 'resource-exhausted:cooldown', 'two slots within 2 s')
  const passer = await setup('free'); await seedSet(`users/${passer.dj.uid}/eventPasses/p1`, { status: 'active', validUntil: new Date(Date.now() + 3_600_000), legacySessionId: null, eventId: null })
  await upload(g, passer.id)                                                                      // an active Event Pass unlocks photos for a Free owner

  const u = await upload(await mk('anonymous'), ok.id), stranger = await mk('anonymous')
  assert.equal(await fails(callAs(stranger, 'finalizePhoto', { eventId: ok.id, photoId: u.photoId })), 'not-found:photo_not_found', 'only the guest the slot was issued to can finalize')
  assert.equal(await fails(callAs(stranger, 'finalizePhoto', { eventId: ok.id, photoId: 'nope' })), 'not-found:photo_not_found')
  const del = await setup(); await seedUpdate(`events/${del.id}`, { deletedAt: new Date() })
  assert.equal(await fails(upload(g, del.id)), 'not-found:event_not_found', 'a deleted event')
})

test('P4. moderatePhoto: approve / reject / feature / delete, gates, ownership; delete removes the file and the document', async () => {
  const { dj, id } = await setup(); const g = await mk('anonymous'), intruder = await mk(), anon = await mk('anonymous')
  const p = await fullUpload(g, id)
  assert.deepEqual(await callAs(dj, 'moderatePhoto', { eventId: id, photoId: p.photoId, action: 'set_featured', isFeatured: true }), { changed: true, isFeatured: true })
  assert.deepEqual(await callAs(dj, 'moderatePhoto', { eventId: id, photoId: p.photoId, action: 'set_featured', isFeatured: true }), { changed: false, isFeatured: true })
  assert.equal(await fails(callAs(intruder, 'moderatePhoto', { eventId: id, photoId: p.photoId, action: 'delete' })), 'not-found:event_not_found')
  assert.equal(await fails(callAs(anon, 'moderatePhoto', { eventId: id, photoId: p.photoId, action: 'delete' })), 'permission-denied:account_required')
  assert.equal(await fails(callAs(dj, 'moderatePhoto', { eventId: id, photoId: p.photoId, action: 'set_status', status: 'winner' })), 'invalid-argument:invalid_payload')
  assert.equal(await fails(callAs(dj, 'moderatePhoto', { eventId: id, photoId: 'missing', action: 'delete' })), 'not-found:photo_not_found')

  assert.ok(await objMeta(p.storagePath)); assert.deepEqual(await callAs(dj, 'moderatePhoto', { eventId: id, photoId: p.photoId, action: 'delete' }), { changed: true, deleted: true })
  assert.equal(await objMeta(p.storagePath), null, 'the file is gone'); assert.equal((await fsGet(`events/${id}/photos/${p.photoId}`)).fields, undefined, 'and so is the document')

  // a Free owner (no Advance, no pass): cannot approve / feature (premium gate), can still delete
  const f = await setup('free'); const g2 = await mk('anonymous')
  await seedUpdate(`events/${f.id}`, { type: 'party' })
  await seedSet(`events/${f.id}/photos/x1`, { guestUid: g2.uid, status: 'pending', source: 'guest_upload', storagePath: `events/${f.id}/photos/x1/original.jpg`, contentType: 'image/jpeg', isFeatured: false, createdAt: new Date(), updatedAt: new Date() })
  assert.equal(await fails(callAs(f.dj, 'moderatePhoto', { eventId: f.id, photoId: 'x1', action: 'set_status', status: 'approved' })), 'permission-denied:event_access_required')
  assert.deepEqual(await callAs(f.dj, 'moderatePhoto', { eventId: f.id, photoId: 'x1', action: 'delete' }), { changed: true, deleted: true })
})

test('P5. winner photos: owner-only direct upload, one folder per event, path validation in updateEventConfig, replaced / removed files are deleted', async () => {
  const { dj, id } = await setup(); const guest = await mk('anonymous'), intruder = await mk()
  const w = (name: string) => `events/${id}/winner/${name}`
  const groom = `groom-${'a'.repeat(12)}.jpg`, bride = `bride-${'b'.repeat(12)}.png`
  assert.equal(await sCode(uploadBytes(ref(stor(dj), w(groom)), bytes(500), JPEG)), 'ok')
  assert.equal(await sCode(uploadBytes(ref(stor(dj), w(bride)), bytes(500), { contentType: 'image/png' })), 'ok')
  assert.equal(await sCode(uploadBytes(ref(stor(guest), w(`groom-${'c'.repeat(12)}.jpg`)), bytes(500), JPEG)), 'storage/unauthorized', 'a guest cannot upload winner photos')
  assert.equal(await sCode(uploadBytes(ref(stor(intruder), w(`groom-${'d'.repeat(12)}.jpg`)), bytes(500), JPEG)), 'storage/unauthorized', 'nor another account')
  assert.equal(await sCode(uploadBytes(ref(stor(dj), w('groom-short.jpg')), bytes(500), JPEG)), 'storage/unauthorized', 'guessable / malformed name')
  assert.equal(await sCode(uploadBytes(ref(stor(dj), w(`groom-${'e'.repeat(12)}.jpg`)), bytes(9 * 1024 * 1024), JPEG)), 'storage/unauthorized', '> 8 MB')
  assert.equal(await sCode(uploadBytes(ref(stor(dj), w(`groom-${'f'.repeat(12)}.svg`)), bytes(500), { contentType: 'image/svg+xml' })), 'storage/unauthorized', 'svg is refused')
  assert.equal(await sCode(uploadBytes(ref(stor(dj), w(groom)), bytes(500, 2), JPEG)), 'storage/unauthorized', 'no overwrite')
  assert.equal(await sCode(getBytes(ref(stor(guest), w(groom)))), 'ok', 'the TV / guests read them')

  const base = { phase: 'hidden', winner: null }
  await callAs(dj, 'updateEventConfig', { eventId: id, winnerAnnouncement: { ...base, groom_photo_path: w(groom), bride_photo_path: w(bride) } })
  assert.equal(await fails(callAs(dj, 'updateEventConfig', { eventId: id, winnerAnnouncement: { ...base, groom_photo_path: `events/another-event/winner/${groom}` } })), 'invalid-argument:invalid_payload', 'another event')
  assert.equal(await fails(callAs(dj, 'updateEventConfig', { eventId: id, winnerAnnouncement: { ...base, groom_photo_path: `events/${id}/photos/x/original.jpg` } })), 'invalid-argument:invalid_payload', 'a guest photo')
  assert.equal(await fails(callAs(dj, 'updateEventConfig', { eventId: id, winnerAnnouncement: { ...base, groom_photo_path: `events/${id}/winner/../photos/x` } })), 'invalid-argument:invalid_payload', 'path traversal')
  assert.equal(await fails(callAs(dj, 'updateEventConfig', { eventId: id, winnerAnnouncement: { ...base, groom_photo_path: 'legacy-session-id/123.jpg' } })), 'invalid-argument:invalid_payload', 'a legacy-style path of ANOTHER session is refused')

  // unchanged paths are accepted (editing names / phase must not require re-uploading), and a changed path deletes the old file
  await callAs(dj, 'updateEventConfig', { eventId: id, winnerAnnouncement: { ...base, phase: 'running', groom_photo_path: w(groom), bride_photo_path: w(bride) } })
  assert.ok(await objMeta(w(groom)) && await objMeta(w(bride)))
  const groom2 = `groom-${'g'.repeat(12)}.jpg`
  await uploadBytes(ref(stor(dj), w(groom2)), bytes(500), JPEG)
  await callAs(dj, 'updateEventConfig', { eventId: id, winnerAnnouncement: { ...base, groom_photo_path: w(groom2), bride_photo_path: w(bride) } })
  assert.equal(await objMeta(w(groom)), null, 'the replaced groom photo was deleted'); assert.ok(await objMeta(w(groom2)) && await objMeta(w(bride)))
  await callAs(dj, 'updateEventConfig', { eventId: id, winnerAnnouncement: null })
  assert.equal(await objMeta(w(groom2)), null); assert.equal(await objMeta(w(bride)), null, 'resetting the feature deletes both files')
  await callAs(dj, 'updateEventConfig', { eventId: id, winnerAnnouncement: { ...base, groom_photo_path: `legacy-ps${id}/own-session-file.jpg` } })      // the event's OWN legacy folder is accepted (signal mirror while Supabase leads)
  // legacy paths already stored survive an edit that leaves them unchanged and are never deleted by this callable
  await seedUpdate(`events/${id}`, { screenConfig: { winner_announcement: { phase: 'hidden', groom_photo_path: 'legacyid/1.jpg', bride_photo_path: null } } })
  await callAs(dj, 'updateEventConfig', { eventId: id, winnerAnnouncement: { phase: 'running', groom_photo_path: 'legacyid/1.jpg', bride_photo_path: null } })
  await callAs(dj, 'updateEventConfig', { eventId: id, winnerAnnouncement: null })                // legacy path dropped: nothing in Storage to delete, no error
})

test('P6. firestore.rules for photos: owner reads all, guests / TV only approved (query must filter), nobody writes, deleted event hides them', async () => {
  const { dj, id } = await setup(); const g = await mk('anonymous'), other = await mk('anonymous'), stranger = await mk()
  const a = await fullUpload(g, id), b = await fullUpload(await mk('anonymous'), id), c = await upload(await mk('anonymous'), id)
  await callAs(dj, 'moderatePhoto', { eventId: id, photoId: a.photoId, action: 'set_status', status: 'approved' })
  await callAs(dj, 'moderatePhoto', { eventId: id, photoId: b.photoId, action: 'set_status', status: 'rejected' })
  const col = (cl: TestClient) => collection(cl.db, 'events', id, 'photos')
  const ownerAll = await getDocs(query(col(dj), orderBy('createdAt', 'desc')))
  assert.deepEqual(ownerAll.docs.map((d) => d.data().status).sort(), ['approved', 'rejected', 'uploading'], 'owner sees every state, uploading included')
  const approved = await getDocs(query(col(other), where('status', '==', 'approved'), orderBy('createdAt', 'desc')))
  assert.deepEqual(approved.docs.map((d) => d.id), [a.photoId]); assert.equal(approved.docs[0].data().guestUid, g.uid, '(guestUid is visible on approved photos: the album is public; no PII beyond the anonymous uid + the typed name)')
  assert.ok(await denied(getDocs(col(other))), 'an unfiltered guest query is refused (rules are not filters)')
  assert.ok(await denied(getDocs(query(col(other), where('status', '==', 'pending')))), 'pending is private')
  assert.ok(await denied(getDoc(doc(other.db, 'events', id, 'photos', b.photoId))), 'a rejected photo is private')
  assert.equal((await getDocs(query(col(stranger), where('status', '==', 'approved'), orderBy('createdAt', 'desc')))).size, 1, 'any signed-in account may read approved ones (guest page)')
  for (const cl of [dj, g, other]) {
    assert.ok(await denied(addDoc(col(cl), { status: 'approved' })), 'no client create')
    assert.ok(await denied(updateDoc(doc(cl.db, 'events', id, 'photos', a.photoId), { status: 'approved' })), 'no client update')
    assert.ok(await denied(deleteDoc(doc(cl.db, 'events', id, 'photos', a.photoId))), 'no client delete')
  }
  assert.ok(await denied(getDoc(doc(dj.db, 'events', id, 'photoGuests', g.uid))), 'anti-spam state is server-only')
  void c
  await seedUpdate(`events/${id}`, { deletedAt: new Date() })
  assert.ok(await denied(getDocs(query(col(other), where('status', '==', 'approved'), orderBy('createdAt', 'desc')))), 'deleted event: approved photos are hidden from guests')
  assert.equal(await sCode(getBytes(ref(stor(other), a.storagePath))), 'storage/unauthorized', 'and so are the files')
  assert.equal(await sCode(getBytes(ref(stor(dj), a.storagePath))), 'ok', '(the owner can still reach them for a restore)')
})
