import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { getStorage, connectStorageEmulator, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { doc, getDoc } from 'firebase/firestore'
import { newClient, closeClient, type TestClient } from './helpers'
import { seedSet, seedUpdate, eventFields } from './seed'

/**
 * MIOLOVE media engine: photos + videos, ORIGINAL quality, the 50-contents trial, ownership of the originals and the one-archive "download everything".
 * Real emulators (Auth, Firestore, Functions incl. the export trigger, Storage with its rules); nothing is mocked.
 */
const MiB = 1024 * 1024
const BUCKET = 'gs://demo-iomixo.firebasestorage.app'
const LIMIT = 50
const clients: TestClient[] = []
const tmp = mkdtempSync(join(tmpdir(), 'miolove-media-'))
after(async () => { await Promise.all(clients.map(closeClient)); rmSync(tmp, { recursive: true, force: true }) })
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }
const callAs = <O = any>(c: TestClient, name: string, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, O>(f, name)(data as any).then((r) => r.data)
}
const stor = (c: TestClient) => { const s = getStorage(c.app, BUCKET); try { connectStorageEmulator(s, '127.0.0.1', 9199) } catch { /* already connected */ } return s }
const code = (e: any) => `${String(e.code).replace('functions/', '')}:${e.details?.reason ?? ''}`
async function fails(p: Promise<unknown>) { try { await p } catch (e: any) { return code(e) } assert.fail('expected rejection') }
async function storageFails(p: Promise<unknown>) { try { await p } catch (e: any) { return String(e.code) } assert.fail('expected a Storage rejection') }
const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json())
const objUrl = (path: string) => `http://127.0.0.1:9199/v0/b/demo-iomixo.firebasestorage.app/o/${encodeURIComponent(path)}`
const objExists = async (path: string) => (await fetch(objUrl(path), { headers: { authorization: 'Bearer owner' } })).ok
const objBytes = async (path: string) => Buffer.from(await (await fetch(`${objUrl(path)}?alt=media`, { headers: { authorization: 'Bearer owner' } })).arrayBuffer())
const countOf = async (id: string) => Number((await fsGet(`events/${id}`)).fields.trialPhotoCount?.integerValue ?? -1)
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
/** Deterministic pseudo-random bytes (incompressible, so an altered / re-encoded copy cannot hash the same). */
const bytes = (n: number, seed: number) => { const b = Buffer.alloc(n); let x = seed >>> 0 || 1; for (let i = 0; i < n; i++) { x = (x * 1664525 + 1013904223) >>> 0; b[i] = x >>> 24 } return b }
const LIMIT_ERR = 'resource-exhausted:miolove_trial_photo_limit_reached'
let n = 0

type Over = Record<string, unknown>
async function setup(over: Over = {}, tier: 'free' | 'wedding' = 'free', accountType: 'couple' | 'dj' = 'couple') {
  const owner = await mk(); const id = `md${Date.now()}${n++}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, accountType, plan: { tier, source: tier === 'free' ? 'default' : 'legacy' } })
  await seedSet(`events/${id}`, eventFields(owner.uid, `md${id}`, { type: 'wedding', ...over })); await seedSet(`eventSlugs/md${id}`, { eventId: id })
  return { owner, id }
}
const trial = (count: number, over: Over = {}) => ({ accessMode: 'trial', trialPhotoCount: count, trialPhotoLimit: LIMIT, ...over })
const activated = (over: Over = {}) => ({ accessMode: 'activated', ...over })

interface Slot { photoId: string; storagePath: string; contentType: string; mediaType: 'photo' | 'video'; optimizedPath: string | null; thumbPath: string | null; maxBytes: number }
interface Media { ext: string; original: Buffer; optimized?: Buffer; thumb?: Buffer; filename?: string; claimedSize?: number }
const create = (g: TestClient, eventId: string, m: Media) => callAs<Slot>(g, 'createPhotoUpload', {
  eventId, ext: m.ext, size: m.claimedSize ?? m.original.length, source: 'live_booth', guestName: 'Guest',
  withOptimized: !!m.optimized, withThumb: !!m.thumb, originalFilename: m.filename, width: 4000, height: 3000, durationSec: m.ext === 'jpg' ? undefined : 12.5,
})
/** Resumable, exactly like the web client (a single-request upload of 100+ MB fails in the emulator's transport before the rules are even asked). */
const putObj = (g: TestClient, path: string, data: Uint8Array, contentType: string) => new Promise<void>((resolve, reject) => {
  const task = uploadBytesResumable(ref(stor(g), path), data, { contentType }); task.on('state_changed', undefined, reject, () => resolve())
})
/** The whole new-style upload as the browser does it: derivatives first, the original last, then finalize. */
async function send(g: TestClient, eventId: string, m: Media) {
  const s = await create(g, eventId, m)
  if (m.optimized) await putObj(g, s.optimizedPath!, m.optimized, 'image/jpeg')
  if (m.thumb) await putObj(g, s.thumbPath!, m.thumb, 'image/jpeg')
  await putObj(g, s.storagePath, m.original, s.contentType)
  return { s, done: () => callAs<{ photoId: string; status: string }>(g, 'finalizePhoto', { eventId, photoId: s.photoId }) }
}
const photoMedia = (seed: number, size = 300_000): Media => ({ ext: 'jpg', original: bytes(size, seed), optimized: bytes(40_000, seed + 1), thumb: bytes(5_000, seed + 2), filename: `IMG_${seed}.jpg` })
const videoMedia = (seed: number, ext: 'mp4' | 'mov' | 'webm' = 'mp4', size = 600_000): Media => ({ ext, original: bytes(size, seed), thumb: bytes(5_000, seed + 2), filename: `VID_${seed}.${ext}` })
const guest = () => mk('anonymous')
async function addMedia(eventId: string, m: Media) { const g = await guest(); const u = await send(g, eventId, m); await u.done(); return u.s }

// ─────────────────────────────────────────── ORIGINAL QUALITY ───────────────────────────────────────────

test('ORIG-1. a photo keeps its ORIGINAL byte for byte; the optimized copy and thumbnail sit beside it; the doc carries the whole media model', async () => {
  const { owner, id } = await setup(activated())
  const m = photoMedia(11, 3 * MiB)
  const s = await addMedia(id, m)
  assert.equal(sha(await objBytes(s.storagePath)), sha(m.original), 'the stored original is exactly what the guest sent')
  assert.equal(sha(await objBytes(s.optimizedPath!)), sha(m.optimized!)); assert.equal(sha(await objBytes(s.thumbPath!)), sha(m.thumb!))
  const f = (await fsGet(`events/${id}/photos/${s.photoId}`)).fields
  assert.equal(f.status.stringValue, 'approved'); assert.equal(f.mediaType.stringValue, 'photo'); assert.equal(f.contentType.stringValue, 'image/jpeg')
  assert.equal(f.originalPath.stringValue, s.storagePath); assert.equal(f.optimizedPath.stringValue, `events/${id}/photos/${s.photoId}/optimized.jpg`)
  assert.equal(f.thumbPath.stringValue, `events/${id}/photos/${s.photoId}/thumb.jpg`); assert.equal(f.originalFilename.stringValue, 'IMG_11.jpg')
  assert.equal(Number(f.size.integerValue), m.original.length, 'size = the ORIGINAL size'); assert.equal(Number(f.width.integerValue), 4000); assert.equal(Number(f.height.integerValue), 3000)
  // the owner can fetch the original through Storage (this is what "download" uses)
  assert.match(await getDownloadURL(ref(stor(owner), s.storagePath)), /original\.jpg/)
})

test('ORIG-2. videos (MP4, MOV, WebM) are kept as sent: original preserved, never transcoded, content type as declared', async () => {
  const { id } = await setup(activated())
  for (const [i, ext] of Array.from((['mp4', 'mov', 'webm'] as const).entries())) {
    const m = videoMedia(20 + i, ext); const s = await addMedia(id, m)
    assert.equal(sha(await objBytes(s.storagePath)), sha(m.original), `${ext}: original preserved`)
    const meta = await (await fetch(objUrl(s.storagePath), { headers: { authorization: 'Bearer owner' } })).json()
    assert.equal(meta.contentType, ({ mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' } as Record<string, string>)[ext])
    const f = (await fsGet(`events/${id}/photos/${s.photoId}`)).fields
    assert.equal(f.mediaType.stringValue, 'video'); assert.equal(f.optimizedPath?.stringValue, undefined, 'a video has no optimized image'); assert.equal(Number(f.durationSec.doubleValue), 12.5)
    assert.equal(await objExists(s.thumbPath!), true, 'poster frame stored beside it')
  }
})

test('ORIG-3. ownership: guests / the TV read the optimized image and thumbnail, NEVER the original of a new photo; the owner reads everything', async () => {
  const { owner, id } = await setup(activated())
  const s = await addMedia(id, photoMedia(31))
  const other = await guest(), uploader = await guest()
  for (const g of [other]) {
    assert.match(await getDownloadURL(ref(stor(g), s.optimizedPath!)), /optimized\.jpg/)
    assert.match(await getDownloadURL(ref(stor(g), s.thumbPath!)), /thumb\.jpg/)
    assert.equal(await storageFails(getDownloadURL(ref(stor(g), s.storagePath))), 'storage/unauthorized', 'a guest cannot read the original')
  }
  assert.equal(await storageFails(getDownloadURL(ref(stor(uploader), s.storagePath))), 'storage/unauthorized', 'not even a guest who is not the owner of the event')
  for (const p of [s.storagePath, s.optimizedPath!, s.thumbPath!]) assert.match(await getDownloadURL(ref(stor(owner), p)), /alt=media/)
  const stranger = await mk()                                        // another real account: not the owner
  assert.equal(await storageFails(getDownloadURL(ref(stor(stranger), s.storagePath))), 'storage/unauthorized')
})

test('ORIG-4. a video must be playable by guests / the TV (there is no transcoded copy): its file is readable once approved, but not before', async () => {
  const { id } = await setup(activated({ type: 'wedding' }))
  const g = await guest(); const u = await send(g, id, videoMedia(41)); const viewer = await guest()
  assert.equal(await storageFails(getDownloadURL(ref(stor(viewer), u.s.storagePath))), 'storage/unauthorized', 'still uploading: not readable')
  await u.done()
  assert.match(await getDownloadURL(ref(stor(viewer), u.s.storagePath)), /original\.mp4/)
})

test('ORIG-5. rules: nobody overwrites or deletes an object; a derivative that was not declared, a wrong type, or a wrong path is refused', async () => {
  const { id } = await setup(activated())
  const g = await guest()
  const s = await create(g, id, { ext: 'jpg', original: bytes(2000, 1), optimized: bytes(500, 2) })                 // declares optimized, NOT thumb
  assert.equal(await storageFails(putObj(g, `events/${id}/photos/${s.photoId}/thumb.jpg`, bytes(100, 3), 'image/jpeg')), 'storage/unauthorized', 'undeclared thumb')
  assert.equal(await storageFails(putObj(g, s.optimizedPath!, bytes(100, 3), 'video/mp4')), 'storage/unauthorized', 'optimized must be a JPEG')
  assert.equal(await storageFails(putObj(g, s.storagePath, bytes(100, 3), 'video/mp4')), 'storage/unauthorized', 'original must match the declared type')
  assert.equal(await storageFails(putObj(g, s.optimizedPath!, bytes(5 * MiB, 3), 'image/jpeg')), 'storage/unauthorized', 'optimized is capped (4 MB)')
  await putObj(g, s.optimizedPath!, bytes(500, 2), 'image/jpeg'); await putObj(g, s.storagePath, bytes(2000, 1), s.contentType)
  assert.equal(await storageFails(putObj(g, s.storagePath, bytes(2000, 9), s.contentType)), 'storage/unauthorized', 'no overwrite')
  const intruder = await guest()
  assert.equal(await storageFails(putObj(intruder, `events/${id}/photos/${s.photoId}/original.jpg`, bytes(10, 1), 'image/jpeg')), 'storage/unauthorized', 'only the guest the slot was issued to')
})

// ─────────────────────────────────────────── LIMITS & FORMATS ───────────────────────────────────────────

test('VID-1. video size: 150 MB is accepted, 150 MB + 1 byte is refused with a clear reason; the NUMBER of videos is not limited', async () => {
  const { id } = await setup(activated())
  const g = await guest()
  const ok = await callAs<Slot>(g, 'createPhotoUpload', { eventId: id, ext: 'mp4', size: 150 * MiB, source: 'guest_upload' })
  assert.equal(ok.maxBytes, 150 * MiB)
  assert.equal(await fails(callAs(await guest(), 'createPhotoUpload', { eventId: id, ext: 'mp4', size: 150 * MiB + 1, source: 'guest_upload' })), 'invalid-argument:video_too_large')
  assert.equal(await fails(callAs(await guest(), 'createPhotoUpload', { eventId: id, ext: 'mov', size: 151 * MiB, source: 'guest_upload' })), 'invalid-argument:video_too_large')
  for (let i = 0; i < 4; i++) await addMedia(id, videoMedia(50 + i, 'mp4', 1000))        // many videos: no count limit
  assert.equal(await countOf(id), -1, 'an activated album carries no counter')
})

test('VID-2. Storage rules enforce the 150 MB ceiling on the real bytes (a client that lies about the size is still stopped)', async () => {
  const { id } = await setup(activated())
  const g = await guest(); const s = await create(g, id, { ext: 'mp4', original: bytes(1000, 1) })                  // declares 1 KB
  assert.equal(await storageFails(putObj(g, s.storagePath, Buffer.alloc(150 * MiB + 1, 7), 'video/mp4')), 'storage/unauthorized', '150 MB + 1 byte')
  const g2 = await guest(); const s2 = await create(g2, id, { ext: 'mp4', original: bytes(1000, 1), claimedSize: 150 * MiB })
  await putObj(g2, s2.storagePath, Buffer.alloc(150 * MiB, 7), 'video/mp4')                                          // exactly 150 MB
  assert.deepEqual(await callAs(g2, 'finalizePhoto', { eventId: id, photoId: s2.photoId }).then((r: any) => r.status), 'approved')
  assert.equal((await objBytes(s2.storagePath)).length, 150 * MiB)
})

test('VID-3. photo size and format: originals up to 50 MB (with derivatives), 8 MB without; HEIC / GIF / AVI are refused with a clear reason', async () => {
  const { id } = await setup(activated())
  const g = await guest()
  assert.equal((await callAs<Slot>(g, 'createPhotoUpload', { eventId: id, ext: 'jpg', size: 50 * MiB, source: 'guest_upload', withOptimized: true })).maxBytes, 50 * MiB)
  assert.equal(await fails(callAs(await guest(), 'createPhotoUpload', { eventId: id, ext: 'jpg', size: 50 * MiB + 1, source: 'guest_upload', withOptimized: true })), 'invalid-argument:file_too_large')
  assert.equal(await fails(callAs(await guest(), 'createPhotoUpload', { eventId: id, ext: 'jpg', size: 9 * MiB, source: 'guest_upload' })), 'invalid-argument:file_too_large', 'legacy single-file flow keeps 8 MB')
  for (const ext of ['heic', 'gif', 'avi', 'mkv', 'exe']) assert.equal(await fails(callAs(await guest(), 'createPhotoUpload', { eventId: id, ext, size: 1000, source: 'guest_upload' })), 'invalid-argument:unsupported_format', ext)
  assert.equal(await fails(callAs(await guest(), 'createPhotoUpload', { eventId: id, ext: 'mp4', size: 1000, source: 'guest_upload', withOptimized: true })), 'invalid-argument:invalid_payload', 'a video has no optimized image')
})

test('VID-4. videos and derivatives belong to MIOLOVE albums: an IOMIXO Wedding DJ event refuses them and keeps its single-file photos', async () => {
  const dj = await setup({}, 'wedding', 'dj')
  assert.equal(await fails(callAs(await guest(), 'createPhotoUpload', { eventId: dj.id, ext: 'mp4', size: 1000, source: 'guest_upload' })), 'invalid-argument:unsupported_format')
  assert.equal(await fails(callAs(await guest(), 'createPhotoUpload', { eventId: dj.id, ext: 'jpg', size: 1000, source: 'guest_upload', withOptimized: true })), 'invalid-argument:unsupported_format')
  const g = await guest(); const s = await callAs<Slot>(g, 'createPhotoUpload', { eventId: dj.id, ext: 'jpg', size: 1000, source: 'guest_upload' })
  await putObj(g, s.storagePath, bytes(1000, 1), 'image/jpeg'); assert.equal((await callAs(g, 'finalizePhoto', { eventId: dj.id, photoId: s.photoId })).status, 'approved')
  const f = (await fsGet(`events/${dj.id}/photos/${s.photoId}`)).fields
  assert.equal(f.mediaType, undefined, 'IOMIXO docs keep the exact legacy shape'); assert.equal(f.optimizedPath, undefined)
})

// ─────────────────────────────────────────── TRIAL = 50 CONTENTS ───────────────────────────────────────────

test('TRIAL-1. 49 photos + 1 video = 50: accepted; the 51st content (photo OR video) is refused', async () => {
  const { id } = await setup(trial(LIMIT - 1))                       // 49 photos already in
  await addMedia(id, videoMedia(60)); assert.equal(await countOf(id), LIMIT, 'the video took the 50th slot')
  assert.equal(await fails(create(await guest(), id, photoMedia(61))), LIMIT_ERR, '51st as a photo')
  assert.equal(await fails(create(await guest(), id, videoMedia(62))), LIMIT_ERR, '51st as a video')
  assert.equal(await countOf(id), LIMIT)
})

test('TRIAL-2. 40 photos + 10 videos = 50 (photos and videos share ONE quota), then the next one is refused', async () => {
  const { id } = await setup(trial(40))
  for (let i = 0; i < 10; i++) await addMedia(id, videoMedia(70 + i, 'mp4', 2000))
  assert.equal(await countOf(id), LIMIT)
  assert.equal(await fails(create(await guest(), id, videoMedia(99))), LIMIT_ERR)
  assert.equal(await fails(create(await guest(), id, photoMedia(98))), LIMIT_ERR)
})

test('TRIAL-3. a mixed trial counts every content once: 3 photos + 2 videos → 5', async () => {
  const { id } = await setup(trial(0))
  for (let i = 0; i < 3; i++) await addMedia(id, photoMedia(110 + i, 20_000))
  for (let i = 0; i < 2; i++) await addMedia(id, videoMedia(120 + i, 'mp4', 20_000))
  assert.equal(await countOf(id), 5)
})

test('TRIAL-4. deleting a content frees its slot and removes EVERY file of it (original, optimized, thumbnail / poster) and the record', async () => {
  const { owner, id } = await setup(trial(LIMIT - 2))
  const v = await addMedia(id, videoMedia(130)), p = await addMedia(id, photoMedia(131))
  assert.equal(await countOf(id), LIMIT); assert.equal(await fails(create(await guest(), id, photoMedia(132))), LIMIT_ERR)
  const all = [v.storagePath, v.thumbPath!, p.storagePath, p.optimizedPath!, p.thumbPath!]
  for (const path of all) assert.equal(await objExists(path), true, path)
  await callAs(owner, 'moderatePhoto', { eventId: id, photoId: v.photoId, action: 'delete' })
  assert.equal(await countOf(id), LIMIT - 1, 'deleting the video freed one slot')
  assert.equal(await objExists(v.storagePath), false); assert.equal(await objExists(v.thumbPath!), false); assert.equal((await fsGet(`events/${id}/photos/${v.photoId}`)).fields, undefined)
  await callAs(owner, 'moderatePhoto', { eventId: id, photoId: p.photoId, action: 'delete' })
  for (const path of [p.storagePath, p.optimizedPath!, p.thumbPath!]) assert.equal(await objExists(path), false, `orphan left: ${path}`)
  assert.equal(await countOf(id), LIMIT - 2)
  await addMedia(id, photoMedia(133)); assert.equal(await countOf(id), LIMIT - 1, 'a new content is accepted again')
})

test('TRIAL-5. a failed upload never takes a slot: nothing uploaded, a missing derivative, or an original rejected by the rules', async () => {
  const { id } = await setup(trial(7))
  const g = await guest(); const s = await create(g, id, videoMedia(140))
  assert.equal(await fails(callAs(g, 'finalizePhoto', { eventId: id, photoId: s.photoId })), 'failed-precondition:upload_missing'); assert.equal(await countOf(id), 7)
  const g2 = await guest(); const p = await create(g2, id, photoMedia(141))                                   // optimized declared but never sent
  await putObj(g2, p.storagePath, bytes(1000, 1), p.contentType)
  assert.equal(await fails(callAs(g2, 'finalizePhoto', { eventId: id, photoId: p.photoId })), 'failed-precondition:upload_missing'); assert.equal(await countOf(id), 7)
  await putObj(g2, p.optimizedPath!, bytes(500, 2), 'image/jpeg')                                              // the retry completes it
  assert.equal((await callAs(g2, 'finalizePhoto', { eventId: id, photoId: p.photoId })).status, 'approved'); assert.equal(await countOf(id), 8)
  const g3 = await guest(); const v = await create(g3, id, videoMedia(142))
  assert.equal(await storageFails(putObj(g3, v.storagePath, Buffer.alloc(150 * MiB + 1), 'video/mp4')), 'storage/unauthorized')
  assert.equal(await fails(callAs(g3, 'finalizePhoto', { eventId: id, photoId: v.photoId })), 'failed-precondition:upload_missing'); assert.equal(await countOf(id), 8)
})

test('TRIAL-6. concurrency from 49: a photo and a video finalizing at once → exactly one takes the 50th slot; the loser leaves no record and no file', async () => {
  const { id } = await setup(trial(LIMIT - 1))
  const [a, b] = [await send(await guest(), id, photoMedia(150)), await send(await guest(), id, videoMedia(151))]
  const out = await Promise.allSettled([a.done(), b.done()])
  assert.equal(out.filter((o) => o.status === 'fulfilled').length, 1); assert.equal(await countOf(id), LIMIT)
  const lost = out[0].status === 'rejected' ? a : b
  assert.equal(code((out.find((o) => o.status === 'rejected') as PromiseRejectedResult).reason), LIMIT_ERR)
  assert.equal((await fsGet(`events/${id}/photos/${lost.s.photoId}`)).fields, undefined)
  for (const path of [lost.s.storagePath, lost.s.thumbPath, lost.s.optimizedPath]) if (path) assert.equal(await objExists(path), false, path)
})

test('TRIAL-7. an activated album has no numeric limit, whatever a stale counter says', async () => {
  const { id } = await setup(activated({ trialPhotoCount: LIMIT, trialPhotoLimit: LIMIT }))
  for (let i = 0; i < 3; i++) await addMedia(id, i % 2 ? videoMedia(160 + i, 'mp4', 1000) : photoMedia(160 + i, 5000))
  assert.equal(await countOf(id), LIMIT, 'untouched')
})

// ─────────────────────────────────────────── LEGACY ───────────────────────────────────────────

test('LEGACY-1. photos uploaded before the media model (one compressed file, no new fields) keep working: shown to guests, finalized by an old client, downloaded by the owner', async () => {
  const { owner, id } = await setup(activated())
  // an old document + object, exactly as the previous version wrote them
  const legacyPath = `events/${id}/photos/old1/original.jpg`, legacyBytes = bytes(9000, 5)
  const admin = await mk(); void admin
  await seedSet(`events/${id}/photos/old1`, { guestUid: 'someone', guestName: 'Old', caption: null, source: 'live_booth', status: 'approved', isFeatured: false, storagePath: legacyPath, contentType: 'image/jpeg', size: 9000, createdAt: new Date(), updatedAt: new Date() })
  const up = await fetch(`http://127.0.0.1:9199/v0/b/demo-iomixo.firebasestorage.app/o?name=${encodeURIComponent(legacyPath)}`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'image/jpeg' }, body: legacyBytes })
  assert.equal(up.status, 200)
  assert.equal(await objExists(legacyPath), true)
  const viewer = await guest()
  assert.match(await getDownloadURL(ref(stor(viewer), legacyPath)), /original\.jpg/)                       // guests still read the single file
  assert.match(await getDownloadURL(ref(stor(owner), legacyPath)), /original\.jpg/)
  // an old (cached) client: no flags, one file ≤ 8 MB → the legacy flow still completes
  const g = await guest(); const s = await callAs<Slot>(g, 'createPhotoUpload', { eventId: id, ext: 'jpg', size: 4000, source: 'live_booth' })
  assert.equal(s.optimizedPath, null); assert.equal(s.maxBytes, 8 * MiB)
  await putObj(g, s.storagePath, bytes(4000, 6), 'image/jpeg'); assert.equal((await callAs(g, 'finalizePhoto', { eventId: id, photoId: s.photoId })).status, 'approved')
  assert.match(await getDownloadURL(ref(stor(await guest()), s.storagePath)), /original\.jpg/, 'a photo without an optimized copy stays readable')
  assert.deepEqual(await callAs(owner, 'moderatePhoto', { eventId: id, photoId: 'old1', action: 'delete' }), { changed: true, deleted: true })
  assert.equal(await objExists(legacyPath), false)
})

// ─────────────────────────────────────────── DOWNLOAD EVERYTHING ───────────────────────────────────────────

async function waitExport(eventId: string, exportId: string, want: string[] = ['ready', 'failed']) {
  for (let i = 0; i < 240; i++) {
    const f = (await fsGet(`events/${eventId}/exports/${exportId}`)).fields
    if (f && want.includes(f.status.stringValue)) return f
    await new Promise((r) => setTimeout(r, 500))
  }
  assert.fail('export did not finish')
}
async function fetchZip(url: string, name: string) {
  const res = await fetch(url); assert.equal(res.status, 200, 'the download URL works'); assert.match(res.headers.get('content-type') ?? '', /zip|octet/)
  const file = join(tmp, `${name}.zip`); writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  const dir = join(tmp, name); execFileSync('unzip', ['-qo', file, '-d', dir])
  return { dir, names: readdirSync(dir).sort(), read: (f: string) => readFileSync(join(dir, f)) }
}

test('EXPORT-1. photos only: ONE archive with the ORIGINAL of every photo (not the optimized copies), progress on the export doc, owner-only URL', async () => {
  const { owner, id } = await setup(activated())
  const ms = [photoMedia(201, 400_000), photoMedia(202, 250_000), photoMedia(203, 120_000)]
  for (const m of ms) await addMedia(id, m)
  const r = await callAs<{ exportId: string; status: string; total: number }>(owner, 'requestAlbumExport', { eventId: id })
  assert.equal(r.total, 3); assert.ok(['queued', 'preparing'].includes(r.status))
  const f = await waitExport(id, r.exportId); assert.equal(f.status.stringValue, 'ready'); assert.equal(Number(f.processed.integerValue), 3)
  const { url, bytes: size } = await callAs<{ url: string; bytes: number }>(owner, 'getAlbumExportUrl', { eventId: id, exportId: r.exportId })
  const z = await fetchZip(url, 'photos-only'); assert.equal(z.names.length, 3); assert.ok(size && size > 700_000)
  const got = z.names.map((n) => sha(z.read(n))).sort(), want = ms.map((m) => sha(m.original)).sort()
  assert.deepEqual(got, want, 'the archive holds the originals, byte for byte')
  for (const m of ms) assert.ok(!z.names.some((n) => sha(z.read(n)) === sha(m.optimized!)), 'no optimized copy or thumbnail in the archive')
  assert.ok(z.names.every((n, i) => /^\d{4}-IMG_\d+\.jpg$/.test(n)), `names: ${z.names}`)
})

test('EXPORT-2. photos + videos (and a legacy photo) in the same archive, original quality, unique names', async () => {
  const { owner, id } = await setup(activated())
  const ph = photoMedia(211, 500_000), mp = videoMedia(212, 'mp4', 900_000), mv = videoMedia(213, 'mov', 700_000)
  for (const m of [ph, mp, mv]) await addMedia(id, m)
  const g = await guest(); const old = await callAs<Slot>(g, 'createPhotoUpload', { eventId: id, ext: 'jpg', size: 3000, source: 'live_booth' })    // a legacy-style single file
  const oldBytes = bytes(3000, 214); await putObj(g, old.storagePath, oldBytes, 'image/jpeg'); await callAs(g, 'finalizePhoto', { eventId: id, photoId: old.photoId })
  const r = await callAs<{ exportId: string }>(owner, 'requestAlbumExport', { eventId: id })
  assert.equal((await waitExport(id, r.exportId)).status.stringValue, 'ready')
  const z = await fetchZip((await callAs<{ url: string }>(owner, 'getAlbumExportUrl', { eventId: id, exportId: r.exportId })).url, 'mixed')
  assert.equal(z.names.length, 4); assert.equal(new Set(z.names).size, 4)
  assert.deepEqual(z.names.map((n) => sha(z.read(n))).sort(), [ph.original, mp.original, mv.original, oldBytes].map(sha).sort())
  assert.ok(z.names.some((n) => n.endsWith('.mp4')) && z.names.some((n) => n.endsWith('.mov')))
})

test('EXPORT-3. authorization: only the album owner can ask, follow or fetch; guests, other accounts and anonymous users are refused', async () => {
  const { owner, id } = await setup(activated()); await addMedia(id, photoMedia(221, 5000))
  const stranger = await mk(), anon = await guest()
  assert.equal(await fails(callAs(anon, 'requestAlbumExport', { eventId: id })), 'permission-denied:account_required', 'a guest (anonymous)')
  assert.equal(await fails(callAs(stranger, 'requestAlbumExport', { eventId: id })), 'not-found:event_not_found', 'another account')
  const r = await callAs<{ exportId: string }>(owner, 'requestAlbumExport', { eventId: id }); await waitExport(id, r.exportId)
  assert.equal(await fails(callAs(stranger, 'getAlbumExportUrl', { eventId: id, exportId: r.exportId })), 'not-found:event_not_found')
  assert.equal(await fails(callAs(anon, 'getAlbumExportUrl', { eventId: id, exportId: r.exportId })), 'permission-denied:account_required')
  // the export doc: owner reads, nobody else
  assert.equal((await getDoc(doc(owner.db, `events/${id}/exports/${r.exportId}`))).exists(), true)
  await assert.rejects(getDoc(doc(stranger.db, `events/${id}/exports/${r.exportId}`)), (e: any) => e.code === 'permission-denied')
  await assert.rejects(getDoc(doc(anon.db, `events/${id}/exports/${r.exportId}`)), (e: any) => e.code === 'permission-denied')
  // the archive itself is closed to every client, the owner included (the owner gets a token URL from the callable)
  const zipPath = `events/${id}/exports/${r.exportId}/album.zip`
  for (const c of [owner, stranger, anon]) assert.equal(await storageFails(getDownloadURL(ref(stor(c), zipPath))), 'storage/unauthorized')
})

test('EXPORT-4. rules of the feature: a free trial album cannot export; an empty album refuses; an unfinished export has no URL; a second click follows the running one', async () => {
  const t = await setup(trial(1)); await addMedia(t.id, photoMedia(231, 5000))
  assert.equal(await fails(callAs(t.owner, 'requestAlbumExport', { eventId: t.id })), 'permission-denied:export_requires_album')
  const e = await setup(activated())
  assert.equal(await fails(callAs(e.owner, 'requestAlbumExport', { eventId: e.id })), 'failed-precondition:export_empty')
  for (let i = 0; i < 6; i++) await addMedia(e.id, photoMedia(240 + i, 800_000))
  const a = await callAs<{ exportId: string }>(e.owner, 'requestAlbumExport', { eventId: e.id })
  await waitExport(e.id, a.exportId)
  await seedSet(`events/${e.id}/exports/running1`, { ownerUid: e.owner.uid, status: 'preparing', total: 6, processed: 2, zipPath: 'x', createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 1e6) })
  assert.equal((await callAs<{ exportId: string }>(e.owner, 'requestAlbumExport', { eventId: e.id })).exportId, 'running1', 'a click while one is running follows the running one')
  await seedUpdate(`events/${e.id}/exports/running1`, { status: 'failed' })
  assert.equal(await fails(callAs(e.owner, 'getAlbumExportUrl', { eventId: e.id, exportId: 'nope' })), 'not-found:export_not_found')
  await seedSet(`events/${e.id}/exports/fake1`, { ownerUid: e.owner.uid, status: 'preparing', total: 1, processed: 0, zipPath: 'x', createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 1e6) })
  assert.equal(await fails(callAs(e.owner, 'getAlbumExportUrl', { eventId: e.id, exportId: 'fake1' })), 'failed-precondition:export_not_ready')
  await seedSet(`events/${e.id}/exports/old1`, { ownerUid: e.owner.uid, status: 'ready', total: 1, processed: 1, zipPath: 'x', createdAt: new Date(0), updatedAt: new Date(0), expiresAt: new Date(1000) })
  assert.equal(await fails(callAs(e.owner, 'getAlbumExportUrl', { eventId: e.id, exportId: 'old1' })), 'failed-precondition:export_expired')
})

test('EXPORT-5. rejected media and unfinished uploads are not packed; a doc whose file vanished is skipped without failing the archive', async () => {
  const { owner, id } = await setup(activated())
  const keep = photoMedia(251, 30_000); await addMedia(id, keep)
  const g = await guest(); await create(g, id, photoMedia(252, 30_000))                                   // still uploading
  await seedSet(`events/${id}/photos/rejx`, { guestUid: g.uid, status: 'rejected', storagePath: `events/${id}/photos/rejx/original.jpg`, contentType: 'image/jpeg', createdAt: new Date() })
  await seedSet(`events/${id}/photos/ghost`, { guestUid: g.uid, status: 'approved', storagePath: `events/${id}/photos/ghost/original.jpg`, contentType: 'image/jpeg', createdAt: new Date() })
  const r = await callAs<{ exportId: string; total: number }>(owner, 'requestAlbumExport', { eventId: id })
  const f = await waitExport(id, r.exportId); assert.equal(f.status.stringValue, 'ready'); assert.equal(Number(f.skipped.integerValue), 1)
  const z = await fetchZip((await callAs<{ url: string }>(owner, 'getAlbumExportUrl', { eventId: id, exportId: r.exportId })).url, 'filtered')
  assert.equal(z.names.length, 1); assert.equal(sha(z.read(z.names[0])), sha(keep.original))
})

test('EXPORT-6. a new export replaces the old one: the previous archive file and record are deleted', async () => {
  const { owner, id } = await setup(activated()); await addMedia(id, photoMedia(261, 5000))
  const a = await callAs<{ exportId: string }>(owner, 'requestAlbumExport', { eventId: id }); await waitExport(id, a.exportId)
  const zipA = `events/${id}/exports/${a.exportId}/album.zip`; assert.equal(await objExists(zipA), true)
  await seedSet(`events/${id}/exports/${a.exportId}`, { ownerUid: owner.uid, status: 'ready', total: 1, processed: 1, zipPath: zipA, createdAt: new Date(0), updatedAt: new Date(0), expiresAt: new Date(1000) })   // it has expired
  const b = await callAs<{ exportId: string }>(owner, 'requestAlbumExport', { eventId: id }); await waitExport(id, b.exportId)
  assert.notEqual(b.exportId, a.exportId); assert.equal(await objExists(zipA), false, 'expired archive removed'); assert.equal((await fsGet(`events/${id}/exports/${a.exportId}`)).fields, undefined)
})

test('EXPORT-7. an archive is a private link, so it really disappears at expiry: the periodic purge deletes the file and the record without the owner doing anything', async () => {
  const { owner, id } = await setup(activated()); await addMedia(id, photoMedia(271, 5000))
  const r = await callAs<{ exportId: string }>(owner, 'requestAlbumExport', { eventId: id }); await waitExport(id, r.exportId)
  const zipPath = `events/${id}/exports/${r.exportId}/album.zip`
  assert.equal(await objExists(zipPath), true); assert.equal((await fsGet(`events/${id}`)).fields.hasExports.booleanValue, true)
  // the Admin SDK against the same emulators, exactly what the scheduled function runs
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'; process.env.STORAGE_EMULATOR_HOST = 'http://127.0.0.1:9199'; process.env.GCLOUD_PROJECT = 'demo-iomixo'
  const fnRequire = createRequire(join(__dirname, '../../../../firebase/functions/package.json'))                // the Functions' own firebase-admin (same instance the code under test uses)
  const { initializeApp: adminInit, getApps } = fnRequire('firebase-admin/app'); const { getFirestore: adminFirestore } = fnRequire('firebase-admin/firestore')
  if (!getApps().length) adminInit({ projectId: 'demo-iomixo' })
  const { purgeExpiredExports } = await import('../../../../firebase/functions/src/photos/exports')
  const db = adminFirestore()
  const fresh = await purgeExpiredExports(db, Date.now())                                                       // not expired yet: untouched
  assert.ok(fresh.events >= 1); assert.equal(await objExists(zipPath), true); assert.ok((await fsGet(`events/${id}/exports/${r.exportId}`)).fields)
  await seedUpdate(`events/${id}/exports/${r.exportId}`, { expiresAt: new Date(Date.now() - 1000) })
  await purgeExpiredExports(db, Date.now())
  assert.equal(await objExists(zipPath), false, 'archive deleted'); assert.equal((await fsGet(`events/${id}/exports/${r.exportId}`)).fields, undefined, 'record deleted')
  assert.equal((await fsGet(`events/${id}`)).fields.hasExports.booleanValue, false, 'nothing left to purge for this album')
})
