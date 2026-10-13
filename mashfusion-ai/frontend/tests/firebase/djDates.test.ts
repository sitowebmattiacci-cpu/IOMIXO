import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, collection, addDoc, setDoc, updateDoc, deleteDoc, getDocs, getDoc, serverTimestamp } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { newClient, closeClient, denied, type TestClient } from './helpers'
import { seedSet, eventFields } from './seed'

/** DJ upcoming dates: djProfiles/{uid}/dates (owner CRUD, firestore.rules) + the public ones through getPublicEvent. */
const clients: TestClient[] = []
after(async () => { await Promise.all(clients.map(closeClient)) })
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }
const callAs = <O = any>(c: TestClient, name: string, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, O>(f, name)(data as any).then((r) => r.data)
}
const date = (over: Record<string, unknown> = {}) => ({
  title: 'Club Night', eventDate: '2999-01-01', venueName: 'Club', city: 'Roma', ticketUrl: 'https://t.example/x', isPublic: true,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over,
})

test('J1. owner CRUD on own dates; others and guests denied; invalid documents rejected', async () => {
  const a = await mk(); const b = await mk(); const g = await mk('anonymous')
  const col = collection(a.db, 'djProfiles', a.uid, 'dates')
  const ref = await addDoc(col, date())
  assert.equal((await getDocs(col)).size, 1)
  await updateDoc(ref, { isPublic: false, updatedAt: serverTimestamp() })
  assert.equal((await getDoc(ref)).data()!.isPublic, false)
  assert.ok(await denied(getDocs(collection(b.db, 'djProfiles', a.uid, 'dates'))))
  assert.ok(await denied(addDoc(collection(b.db, 'djProfiles', a.uid, 'dates'), date())))
  assert.ok(await denied(getDocs(collection(g.db, 'djProfiles', a.uid, 'dates'))))
  assert.ok(await denied(addDoc(collection(g.db, 'djProfiles', g.uid, 'dates'), date())))
  assert.ok(await denied(addDoc(col, date({ title: '' }))), 'empty title')
  assert.ok(await denied(addDoc(col, date({ eventDate: 'tomorrow' }))), 'bad date')
  assert.ok(await denied(addDoc(col, date({ ticketUrl: 'javascript:alert(1)' }))), 'non-http link')
  assert.ok(await denied(addDoc(col, date({ extra: 1 }))), 'unknown field')
  assert.ok(await denied(setDoc(doc(b.db, 'djProfiles', a.uid, 'dates', ref.id), date())))
  await deleteDoc(ref)
  assert.equal((await getDocs(col)).size, 0)
})

test('J2. getPublicEvent returns only the owner\'s public, upcoming dates (soonest first)', async () => {
  const dj = await mk(); const g = await mk('anonymous')
  const id = `dj${Date.now()}`; const slug = `djs${id}`
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, plan: { tier: 'pro', source: 'legacy' } })
  await seedSet(`events/${id}`, eventFields(dj.uid, slug, {})); await seedSet(`eventSlugs/${slug}`, { eventId: id })
  const col = collection(dj.db, 'djProfiles', dj.uid, 'dates')
  await addDoc(col, date({ title: 'Later', eventDate: '2999-06-01' }))
  await addDoc(col, date({ title: 'Soon', eventDate: '2999-02-01' }))
  await addDoc(col, date({ title: 'Hidden', eventDate: '2999-03-01', isPublic: false }))
  await addDoc(col, date({ title: 'Past', eventDate: '2000-01-01' }))
  const r = await callAs(g, 'getPublicEvent', { slug })
  assert.deepEqual(r.events.map((e: any) => e.title), ['Soon', 'Later'])
  assert.deepEqual(Object.keys(r.events[0]).sort(), ['city', 'event_date', 'id', 'ticket_url', 'title', 'venue_name'])
})
