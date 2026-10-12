import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { newClient, closeClient, denied, type TestClient } from './helpers'
import { getUser, createUser, updateUserProfile } from '../../lib/firebase/repositories/userRepository'
import { getDjProfile, saveDjProfile } from '../../lib/firebase/repositories/djProfileRepository'

const clients: TestClient[] = []
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }
after(() => Promise.all(clients.map(closeClient)))

test('repository: creates the default FREE profile and reads it back', async () => {
  const a = await mk()
  assert.equal(await getUser(a.db, a.uid), null)
  await createUser(a.db, { uid: a.uid, email: a.email, displayName: 'Alice' })
  const u = await getUser(a.db, a.uid)
  assert.equal(u?.displayName, 'Alice')
  assert.deepEqual({ tier: u?.plan.tier, source: u?.plan.source }, { tier: 'free', source: 'default' })
  assert.ok(u?.createdAt instanceof Date, 'server timestamp resolved')
})

test('1. owner can read own profile / 2. another user cannot', async () => {
  const a = await mk(); const b = await mk()
  await createUser(a.db, { uid: a.uid, email: a.email })
  assert.ok(await getUser(a.db, a.uid))
  assert.ok(await denied(getDoc(doc(b.db, 'users', a.uid))))
})

test('3. owner can update an allowed profile field (repository)', async () => {
  const a = await mk()
  await createUser(a.db, { uid: a.uid, email: a.email })
  await updateUserProfile(a.db, a.uid, { displayName: 'New Name' })
  assert.equal((await getUser(a.db, a.uid))?.displayName, 'New Name')
})

test('4. user cannot change plan, legacySupabaseId, email, uid or timestamps', async () => {
  const a = await mk()
  await createUser(a.db, { uid: a.uid, email: a.email })
  const ref = doc(a.db, 'users', a.uid)
  for (const patch of [
    { plan: { tier: 'wedding', source: 'default' } },
    { 'plan.tier': 'pro' },
    { legacySupabaseId: 'x' },
    { email: 'evil@example.com' },
    { uid: 'other' },
    { createdAt: serverTimestamp() },
  ]) {
    assert.ok(await denied(updateDoc(ref, { ...patch, updatedAt: serverTimestamp() })), JSON.stringify(Object.keys(patch)))
  }
  assert.equal((await getUser(a.db, a.uid))?.plan.tier, 'free')
})

test('cannot create own doc with a paid plan, a legacy id, or for someone else', async () => {
  const a = await mk(); const b = await mk()
  const base = { uid: a.uid, email: a.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
  assert.ok(await denied(setDoc(doc(a.db, 'users', a.uid), { ...base, plan: { tier: 'wedding', source: 'default' } })))
  assert.ok(await denied(setDoc(doc(a.db, 'users', a.uid), { ...base, plan: { tier: 'free', source: 'default' }, legacySupabaseId: 'x' })))
  assert.ok(await denied(setDoc(doc(b.db, 'users', a.uid), { ...base, plan: { tier: 'free', source: 'default' } })))
  assert.ok(await denied(setDoc(doc(a.db, 'users', a.uid), { ...base, plan: { tier: 'free', source: 'default' }, createdAt: new Date() })))
})

test('invalid profile values rejected (oversized name)', async () => {
  const a = await mk()
  await createUser(a.db, { uid: a.uid, email: a.email })
  assert.ok(await denied(updateUserProfile(a.db, a.uid, { displayName: 'x'.repeat(81) })))
  // the avatar is server-only: a client cannot write it at all (not even a valid https URL)
  for (const patch of [{ avatarUrl: 'https://evil.example/x.png' }, { avatarPath: 'profiles/other/avatar/user-aaaaaaaaaaaaaaaa.png' }, { avatarUrl: 'javascript:alert(1)' }])
    assert.ok(await denied(updateDoc(doc(a.db, 'users', a.uid), { ...patch, updatedAt: serverTimestamp() })), JSON.stringify(Object.keys(patch)))
})

test('5. anonymous cannot read or write profiles (users and djProfiles)', async () => {
  const a = await mk(); const g = await mk('anonymous')
  await createUser(a.db, { uid: a.uid, email: a.email })
  await saveDjProfile(a.db, a.uid, { displayName: 'DJ A' })
  assert.ok(await denied(getDoc(doc(g.db, 'users', a.uid))))
  assert.ok(await denied(getDoc(doc(g.db, 'djProfiles', a.uid))))
  assert.ok(await denied(setDoc(doc(g.db, 'djProfiles', g.uid), { displayName: 'x', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })))
  assert.ok(await denied(setDoc(doc(g.db, 'users', g.uid), { uid: g.uid, email: '', plan: { tier: 'free', source: 'default' }, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })))
})

test('djProfile: owner saves/reads; others denied; publicSlug not client-writable', async () => {
  const a = await mk(); const b = await mk()
  await saveDjProfile(a.db, a.uid, { displayName: 'DJ A', instagramUrl: 'https://instagram.com/a' })
  await saveDjProfile(a.db, a.uid, { bio: 'hello' })
  const p = await getDjProfile(a.db, a.uid)
  assert.deepEqual([p?.displayName, p?.bio, p?.instagramUrl], ['DJ A', 'hello', 'https://instagram.com/a'])
  assert.ok(await denied(getDoc(doc(b.db, 'djProfiles', a.uid))))
  assert.ok(await denied(updateDoc(doc(a.db, 'djProfiles', a.uid), { publicSlug: 'mine', updatedAt: serverTimestamp() })))
  assert.ok(await denied(saveDjProfile(b.db, a.uid, { bio: 'hijack' })))
  assert.ok(await denied(saveDjProfile(a.db, a.uid, { websiteUrl: 'ftp://nope' })))
})

test('other collections stay closed (deny-all)', async () => {
  const a = await mk()
  assert.ok(await denied(getDoc(doc(a.db, 'requests', 'x'))))
  assert.ok(await denied(setDoc(doc(a.db, 'requests', 'x'), { ownerUid: a.uid })))
})
