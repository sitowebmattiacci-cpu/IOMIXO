import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { getStorage, connectStorageEmulator, ref, uploadBytes, getBytes, deleteObject, listAll, getDownloadURL } from 'firebase/storage'
import { newClient, closeClient, denied, type TestClient } from './helpers'
import { seedSet } from './seed'
import { createUser, getUser } from '../../lib/firebase/repositories/userRepository'
import { getDjProfile, saveDjProfile } from '../../lib/firebase/repositories/djProfileRepository'

/** Profile avatars: commitAvatar / removeAvatar + storage.rules (profiles/{uid}/avatar) + firestore.rules, against the emulators. */
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
const sCode = async (p: Promise<unknown>) => { try { await p; return 'ok' } catch (e: any) { return String(e.code) } }

const JPEG = (n = 2048) => { const b = new Uint8Array(n).fill(1); b.set([0xff, 0xd8, 0xff, 0xe0]); return b }
const PNG = (n = 512) => { const b = new Uint8Array(n).fill(2); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b }
const WEBP = (n = 512) => { const b = new Uint8Array(n).fill(3); b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]); return b }
let n = 0
const tok = () => `tok${Date.now().toString(36)}${n++}abcdefghijkl`
const apath = (uid: string, kind: 'user' | 'dj', ext = 'jpg') => `profiles/${uid}/avatar/${kind}-${tok()}.${ext}`
const put = (c: TestClient, path: string, bytes: Uint8Array, contentType = 'image/jpeg') => uploadBytes(ref(stor(c), path), bytes, { contentType })
const listed = async (c: TestClient, uid: string) => {
  // Storage rules forbid listing for clients: use the emulator REST API as admin.
  const r = await fetch(`http://127.0.0.1:9199/v0/b/demo-iomixo.firebasestorage.app/o?prefix=${encodeURIComponent(`profiles/${uid}/avatar/`)}`, { headers: { authorization: 'Bearer owner' } })
  return ((await r.json()).items ?? []).map((i: any) => i.name as string)
}

test('A1. DJ avatar: upload → commit → URL served, doc written by the server; replace deletes the old file; remove clears everything', async () => {
  const a = await mk(); await saveDjProfile(a.db, a.uid, { displayName: 'DJ A' })
  const p1 = apath(a.uid, 'dj')
  await put(a, p1, JPEG())
  const r1 = await callAs(a, 'commitAvatar', { kind: 'dj', path: p1 })
  assert.equal(r1.avatarPath, p1)
  const d1 = await getDjProfile(a.db, a.uid)
  assert.equal(d1?.avatarPath, p1); assert.equal(d1?.avatarUrl, r1.avatarUrl); assert.equal(d1?.displayName, 'DJ A', 'other fields untouched')
  assert.equal((await (await fetch(r1.avatarUrl)).arrayBuffer()).byteLength, 2048, 'tokenised URL is served to anyone holding it (guest page)')

  const p2 = apath(a.uid, 'dj', 'png')
  await put(a, p2, PNG(), 'image/png')
  const r2 = await callAs(a, 'commitAvatar', { kind: 'dj', path: p2 })
  assert.deepEqual(await listed(a, a.uid), [p2], 'the replaced avatar is gone')
  assert.equal((await fetch(r1.avatarUrl)).ok, false, 'the old URL is dead')
  assert.equal((await getDjProfile(a.db, a.uid))?.avatarUrl, r2.avatarUrl)

  assert.deepEqual(await callAs(a, 'removeAvatar', { kind: 'dj' }), { removed: 1 })
  const d3 = await getDjProfile(a.db, a.uid)
  assert.equal(d3?.avatarUrl, null); assert.equal(d3?.avatarPath, null); assert.equal(d3?.displayName, 'DJ A')
  assert.deepEqual(await listed(a, a.uid), [])
  assert.deepEqual(await callAs(a, 'removeAvatar', { kind: 'dj' }), { removed: 0 }, 'idempotent')
})

test('A2. account avatar is independent from the DJ avatar; commit creates the FREE default doc for a native account without one', async () => {
  const a = await mk()
  const pu = apath(a.uid, 'user', 'webp'), pd = apath(a.uid, 'dj')
  await put(a, pu, WEBP(), 'image/webp'); await put(a, pd, JPEG())
  await callAs(a, 'commitAvatar', { kind: 'user', path: pu }); await callAs(a, 'commitAvatar', { kind: 'dj', path: pd })
  const u = await getUser(a.db, a.uid)
  assert.equal(u?.avatarPath, pu); assert.deepEqual({ tier: u?.plan.tier, source: u?.plan.source }, { tier: 'free', source: 'default' })
  assert.equal((await getDjProfile(a.db, a.uid))?.avatarPath, pd)
  await callAs(a, 'removeAvatar', { kind: 'user' })
  assert.equal((await getUser(a.db, a.uid))?.avatarUrl, null); assert.equal((await getDjProfile(a.db, a.uid))?.avatarPath, pd, 'DJ avatar survives')
})

test('A3. an existing paid plan / legacy id is never touched by a commit', async () => {
  const a = await mk()
  await seedSet(`users/${a.uid}`, { uid: a.uid, email: a.email, plan: { tier: 'wedding', source: 'legacy' }, legacySupabaseId: 'leg-1', displayName: 'Owner' })
  const p = apath(a.uid, 'user'); await put(a, p, JPEG()); await callAs(a, 'commitAvatar', { kind: 'user', path: p })
  const u = await getUser(a.db, a.uid)
  assert.deepEqual([u?.plan.tier, u?.legacySupabaseId, u?.displayName, u?.avatarPath], ['wedding', 'leg-1', 'Owner', p])
})

test('A4. owner-only: nobody writes in somebody else\'s folder, commits somebody else\'s path, or commits the other kind', async () => {
  const a = await mk(); const b = await mk(); const g = await mk('anonymous')
  const pa = apath(a.uid, 'dj')
  assert.equal(await sCode(put(b, pa, JPEG())), 'storage/unauthorized', 'another account cannot write into a folder that is not its own')
  assert.equal(await sCode(put(g, apath(g.uid, 'dj'), JPEG())), 'storage/unauthorized', 'anonymous cannot upload an avatar at all')
  await put(a, pa, JPEG())
  assert.equal(await fails(callAs(b, 'commitAvatar', { kind: 'dj', path: pa })), 'permission-denied:not_your_avatar')
  assert.equal(await fails(callAs(a, 'commitAvatar', { kind: 'user', path: pa })), 'permission-denied:not_your_avatar', 'a dj- file cannot become the account avatar')
  assert.equal(await fails(callAs(g, 'commitAvatar', { kind: 'dj', path: apath(g.uid, 'dj') })), 'unauthenticated:account_required')
  assert.equal(await fails(callAs(g, 'removeAvatar', { kind: 'dj' })), 'unauthenticated:account_required')
  assert.equal(await sCode(getBytes(ref(stor(b), pa))), 'storage/unauthorized', 'bytes not readable by others')
  assert.equal(await sCode(getBytes(ref(stor(a), pa))), 'ok', 'readable by the owner')
  assert.equal(await sCode(listAll(ref(stor(a), `profiles/${a.uid}/avatar`))), 'storage/unauthorized', 'never listable')
  // b removing "its" avatar never reaches a's files
  await callAs(b, 'removeAvatar', { kind: 'dj' })
  assert.equal(await sCode(getBytes(ref(stor(a), pa))), 'ok')
})

test('A5. no blind overwrite, no client delete, strict names / types / size', async () => {
  const a = await mk(); const p = apath(a.uid, 'user')
  await put(a, p, JPEG())
  assert.equal(await sCode(put(a, p, JPEG(4096))), 'storage/unauthorized', 'overwrite of an existing object')
  assert.equal(await sCode(deleteObject(ref(stor(a), p))), 'storage/unauthorized', 'clients cannot delete (cleanup is server-side)')
  assert.equal(await sCode(put(a, `profiles/${a.uid}/avatar/user-short.jpg`, JPEG())), 'storage/unauthorized', 'predictable / short names')
  assert.equal(await sCode(put(a, `profiles/${a.uid}/avatar/other-${tok()}.jpg`, JPEG())), 'storage/unauthorized', 'unknown kind')
  assert.equal(await sCode(put(a, apath(a.uid, 'user', 'gif'), JPEG(), 'image/gif')), 'storage/unauthorized', 'extension')
  assert.equal(await sCode(put(a, apath(a.uid, 'user', 'png'), PNG(), 'text/html')), 'storage/unauthorized', 'declared MIME')
  assert.equal(await sCode(put(a, apath(a.uid, 'user'), JPEG(5 * 1024 * 1024 + 1))), 'storage/unauthorized', '> 5 MB')
  assert.equal(await sCode(put(a, `profiles/${a.uid}/avatar/sub/user-${tok()}.jpg`, JPEG())), 'storage/unauthorized', 'nested paths')
})

test('A6. the server re-checks the bytes: a non-image declared as jpeg is rejected and removed; a missing upload is reported', async () => {
  const a = await mk()
  const fake = apath(a.uid, 'dj'); await put(a, fake, new Uint8Array(300).fill(65))
  assert.equal(await fails(callAs(a, 'commitAvatar', { kind: 'dj', path: fake })), 'invalid-argument:invalid_image')
  assert.deepEqual(await listed(a, a.uid), [], 'the rejected object is deleted')
  const wrongExt = apath(a.uid, 'dj', 'png'); await put(a, wrongExt, JPEG(), 'image/png')
  assert.equal(await fails(callAs(a, 'commitAvatar', { kind: 'dj', path: wrongExt })), 'invalid-argument:invalid_image', 'extension must match the real format')
  assert.equal(await fails(callAs(a, 'commitAvatar', { kind: 'dj', path: apath(a.uid, 'dj') })), 'failed-precondition:upload_missing')
  for (const bad of [{}, { kind: 'x', path: 'a' }, { kind: 'dj', path: '../x' }, { kind: 'dj', path: `profiles/${a.uid}/avatar/dj-short.jpg` }, { kind: 'dj' }])
    assert.equal(await fails(callAs(a, 'commitAvatar', bad)), 'invalid-argument:invalid_payload', JSON.stringify(bad))
  assert.equal(await fails(callAs(a, 'removeAvatar', { kind: 'zzz' })), 'invalid-argument:invalid_payload')
  assert.equal((await getDjProfile(a.db, a.uid)), null, 'a failed commit writes nothing')
})

test('A7. a commit deletes only the PREVIOUS avatar of the same kind (no bucket listing); an uncommitted upload stays unreferenced; other kind untouched', async () => {
  const a = await mk(); const orphan = apath(a.uid, 'dj'), prev = apath(a.uid, 'dj'), good = apath(a.uid, 'dj'), userOne = apath(a.uid, 'user')
  await put(a, orphan, JPEG()); await put(a, userOne, JPEG()); await put(a, prev, JPEG(700))
  await callAs(a, 'commitAvatar', { kind: 'dj', path: prev })
  await put(a, good, JPEG(900)); await callAs(a, 'commitAvatar', { kind: 'dj', path: good })
  assert.deepEqual((await listed(a, a.uid)).sort(), [good, orphan, userOne].sort(), 'previous removed; the never-committed upload and the account file are left alone')
  assert.equal((await getDjProfile(a.db, a.uid))?.avatarPath, good)
  // a stored path that is not the owner's own avatar of this kind is never deleted
  await seedSet(`djProfiles/${a.uid}`, { avatarPath: userOne, avatarUrl: 'https://x/y.png', createdAt: new Date(), updatedAt: new Date() })
  await callAs(a, 'removeAvatar', { kind: 'dj' })
  assert.ok((await listed(a, a.uid)).includes(userOne), 'a foreign/other-kind path in the document is not trusted')
})

test('A8. firestore rules: avatar fields are server-only; guests/others cannot read the DJ doc; an owner cannot touch another profile', async () => {
  const a = await mk(); const b = await mk(); const g = await mk('anonymous')
  await createUser(a.db, { uid: a.uid, email: a.email }); await saveDjProfile(a.db, a.uid, { displayName: 'DJ A', bio: 'hi' })
  const dj = doc(a.db, 'djProfiles', a.uid)
  for (const patch of [{ avatarUrl: 'https://evil.example/x.png' }, { avatarPath: 'profiles/zz/avatar/dj-aaaaaaaaaaaaaaaa.jpg' }, { avatarUrl: null }])
    assert.ok(await denied(updateDoc(dj, { ...patch, updatedAt: serverTimestamp() })), JSON.stringify(patch))
  assert.ok(await denied(setDoc(doc(a.db, 'djProfiles', b.uid), { displayName: 'x', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })), 'cannot create for another uid')
  assert.ok(await denied(updateDoc(doc(b.db, 'djProfiles', a.uid), { bio: 'hijack', updatedAt: serverTimestamp() })))
  assert.ok(await denied(updateDoc(doc(b.db, 'users', a.uid), { displayName: 'hijack', updatedAt: serverTimestamp() })))
  assert.ok(await denied(getDoc(doc(b.db, 'djProfiles', a.uid))) && await denied(getDoc(doc(g.db, 'djProfiles', a.uid))))
  assert.ok(await denied(setDoc(doc(a.db, 'djProfiles', a.uid), { displayName: 'x', avatarUrl: 'https://evil.example/x.png', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })), 'no avatar on create either')
  assert.equal((await getDjProfile(a.db, a.uid))?.bio, 'hi')
})

test('A9. public profile: the guest sees name/bio/avatar through getPublicEvent only', async () => {
  const a = await mk(); const g = await mk('anonymous')
  await seedSet(`users/${a.uid}`, { uid: a.uid, plan: { tier: 'pro', source: 'legacy' } })
  const id = `av${Date.now()}`
  const { eventFields } = await import('./seed')
  await seedSet(`events/${id}`, eventFields(a.uid, `avs${id}`, {})); await seedSet(`eventSlugs/avs${id}`, { eventId: id })
  await saveDjProfile(a.db, a.uid, { displayName: 'DJ A', bio: 'bio' })
  const p = apath(a.uid, 'dj'); await put(a, p, JPEG()); const { avatarUrl } = await callAs(a, 'commitAvatar', { kind: 'dj', path: p })
  const r = await callAs(g, 'getPublicEvent', { slug: `avs${id}` })
  assert.equal(r.profile.avatar_url, avatarUrl); assert.equal(r.profile.display_name, 'DJ A')
  assert.equal(await sCode(getDownloadURL(ref(stor(g), p))), 'storage/unauthorized', 'a guest has no direct Storage read; the tokenised URL is the only way')
})
