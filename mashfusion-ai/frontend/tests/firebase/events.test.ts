import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit } from 'firebase/firestore'
import { deleteApp } from 'firebase/app'
import { newClient, closeClient, denied, newSignedOutDb, type TestClient } from './helpers'
import { seedSet, seedUpdate, eventFields } from './seed'
import {
  getEventById, getEventBySlug, getEventIdBySlug, listOwnerEvents, subscribeEvent,
} from '../../lib/firebase/repositories/eventRepository'
import { eventToPublicSession } from '../../lib/events/eventService'

const clients: TestClient[] = []
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }
after(() => Promise.all(clients.map(closeClient)))

let n = 0
async function seedEvent(ownerUid: string, extra: Record<string, unknown> = {}) {
  const slug = `slug${Date.now()}${n++}`
  const id = `evt${Date.now()}${n}`
  await seedSet(`events/${id}`, eventFields(ownerUid, slug, extra))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  await seedSet(`events/${id}/private/config`, { shoeGameQuestions: ['secret answer'] })
  return { id, slug }
}

test('1/2. owner reads own event (by id and by slug)', async () => {
  const o = await mk(); const e = await seedEvent(o.uid)
  assert.equal((await getEventById(o.db, e.id))?.title, 'Wedding Anna & Marco')
  assert.equal((await getEventBySlug(o.db, e.slug))?.id, e.id)
})

test('6/10. anonymous guest resolves slug and reads the live event', async () => {
  const o = await mk(); const g = await mk('anonymous'); const e = await seedEvent(o.uid)
  assert.equal(await getEventIdBySlug(g.db, e.slug), e.id)
  const ev = await getEventBySlug(g.db, e.slug)
  assert.equal(ev?.status, 'live'); assert.equal(ev?.type, 'wedding')
  assert.equal(await getEventBySlug(g.db, 'does-not-exist'), null)
})

test('ended events stay readable (guests see the "closed" page)', async () => {
  const o = await mk(); const g = await mk('anonymous'); const e = await seedEvent(o.uid, { status: 'ended' })
  const ev = await getEventById(g.db, e.id)
  assert.equal(ev?.status, 'ended'); assert.equal(eventToPublicSession(ev!).is_active, false)
})

test('unauthenticated access is denied', async () => {
  const o = await mk(); const e = await seedEvent(o.uid)
  const { app, db } = newSignedOutDb()
  assert.ok(await denied(getDoc(doc(db, 'events', e.id))))
  assert.ok(await denied(getDoc(doc(db, 'eventSlugs', e.slug))))
  await deleteApp(app)
})

test('3/4/8. no client can create, update, re-own or delete events (guest, other user, owner)', async () => {
  const o = await mk(); const x = await mk(); const g = await mk('anonymous'); const e = await seedEvent(o.uid)
  for (const c of [o, x, g]) {
    assert.ok(await denied(updateDoc(doc(c.db, 'events', e.id), { title: 'hacked' })))
    assert.ok(await denied(updateDoc(doc(c.db, 'events', e.id), { ownerUid: c.uid })))
    assert.ok(await denied(deleteDoc(doc(c.db, 'events', e.id))))
    assert.ok(await denied(setDoc(doc(c.db, 'events', `new${c.uid}`), eventFields(c.uid, `s${c.uid}`))))
    assert.ok(await denied(setDoc(doc(c.db, 'eventSlugs', `hijack${c.uid}`), { eventId: e.id })))
    assert.ok(await denied(updateDoc(doc(c.db, 'eventSlugs', e.slug), { eventId: 'other' })))
  }
  const ev = await getEventById(o.db, e.id)
  assert.equal(ev?.title, 'Wedding Anna & Marco'); assert.equal(ev?.ownerUid, o.uid)
})

test('5/7. private config is owner-only: other users and guests cannot read it', async () => {
  const o = await mk(); const x = await mk(); const g = await mk('anonymous'); const e = await seedEvent(o.uid)
  assert.ok((await getDoc(doc(o.db, 'events', e.id, 'private', 'config'))).exists())
  assert.ok(await denied(getDoc(doc(x.db, 'events', e.id, 'private', 'config'))))
  assert.ok(await denied(getDoc(doc(g.db, 'events', e.id, 'private', 'config'))))
  assert.ok(await denied(getDocs(collection(o.db, 'events', e.id, 'private'))))
})

test('9. owner query returns only own events, newest first, bounded', async () => {
  const a = await mk(); const b = await mk()
  const e1 = await seedEvent(a.uid, { createdAt: new Date('2026-01-01') })
  const e2 = await seedEvent(a.uid, { createdAt: new Date('2026-03-01') })
  await seedEvent(b.uid)
  const mine = await listOwnerEvents(a.db, a.uid)
  assert.deepEqual(mine.map((e) => e.id), [e2.id, e1.id])
  assert.equal((await listOwnerEvents(a.db, a.uid, 1)).length, 1)
})

test('queries are not filters: unfiltered/foreign/guest listings are denied', async () => {
  const a = await mk(); const b = await mk(); const g = await mk('anonymous')
  await seedEvent(a.uid); await seedEvent(b.uid)
  assert.ok(await denied(getDocs(collection(a.db, 'events'))), 'owner without ownerUid filter')
  assert.ok(await denied(getDocs(query(collection(a.db, 'events'), where('ownerUid', '==', b.uid), orderBy('createdAt', 'desc'), limit(5)))), 'foreign owner')
  assert.ok(await denied(listOwnerEvents(g.db, g.uid)), 'anonymous cannot list')
  assert.ok(await denied(getDocs(collection(a.db, 'eventSlugs'))))
})

test('12/13. realtime listener receives updates and stops after unsubscribe', async () => {
  const o = await mk(); const g = await mk('anonymous'); const e = await seedEvent(o.uid)
  const seen: Array<string | null> = []
  const first = new Promise<void>((r) => { let done = false; var unsub = subscribeEvent(g.db, e.id, (ev) => { seen.push(ev?.status ?? null); if (!done) { done = true; r() } }); (globalThis as any).__unsub = unsub })
  await first
  assert.deepEqual(seen, ['live'])

  const waitFor = async (cond: () => boolean) => { for (let i = 0; i < 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 100)); assert.ok(cond(), `timeout, seen=${seen}`) }
  await seedUpdate(`events/${e.id}`, { status: 'ended' })
  await waitFor(() => seen.includes('ended'))

  ;(globalThis as any).__unsub()
  const count = seen.length
  await seedUpdate(`events/${e.id}`, { status: 'live' })
  await new Promise((r) => setTimeout(r, 800))
  assert.equal(seen.length, count, 'no callbacks after unsubscribe')
})

test('listener reports permission errors through onError (e.g. signed-out)', async () => {
  const o = await mk(); const e = await seedEvent(o.uid)
  const { app, db } = newSignedOutDb()
  const err = await new Promise<Error>((r) => subscribeEvent(db, e.id, () => {}, r))
  assert.equal((err as any).code, 'permission-denied'); await deleteApp(app)
})
