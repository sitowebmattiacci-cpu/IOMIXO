import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, collectionGroup } from 'firebase/firestore'
import { deleteApp } from 'firebase/app'
import { newClient, closeClient, denied, newSignedOutDb, type TestClient } from './helpers'
import { seedSet, seedUpdate, eventFields } from './seed'
import { subscribeLatestGame, fromGameDoc } from '../../lib/firebase/repositories/gameRepository'

const clients: TestClient[] = []
after(async () => { await Promise.all(clients.map(closeClient)) })
const mk = async (k: 'account' | 'anonymous' = 'anonymous') => { const c = await newClient(k); clients.push(c); return c }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let n = 0
async function seedGames(ownerUid: string) {
  const id = `gev${Date.now()}${n++}`
  await seedSet(`events/${id}`, eventFields(ownerUid, `s${id}`, { type: 'wedding', legacySupabaseId: `gs-${id}` }))
  const base = Date.now()
  const g = (key: string, type: string, status: string, config: unknown, result: unknown, age: number) =>
    seedSet(`events/${id}/games/${key}`, { type, status, config, result, legacySupabaseId: key, createdAt: new Date(base - age), updatedAt: new Date(base - age) })
  await g('roulette-old', 'wedding_roulette', 'completed', { penitenze: [{ label: 'A' }] }, { slot_label: 'A' }, 60_000)
  await g('roulette-new', 'wedding_roulette', 'idle', { penitenze: [{ label: 'B', category: 'soft', enabled: true }] }, null, 10_000)
  await g('shoe-1', 'shoe_game', 'running', { questions: ['q1', 'q2'], current_index: 0, is_active: true }, null, 5_000)
  return id
}

test('1. owner, anonymous guest and any signed-in user can read a game; signed-out cannot', async () => {
  const dj = await mk('account'); const guest = await mk(); const other = await mk('account'); const id = await seedGames(dj.uid)
  for (const c of [dj, guest, other]) {
    const snap = await getDoc(doc(c.db, 'events', id, 'games', 'shoe-1'))
    assert.equal(snap.data()?.type, 'shoe_game')
    assert.equal((await getDocs(collection(c.db, 'events', id, 'games'))).size, 3)
  }
  const { app, db } = newSignedOutDb()
  assert.ok(await denied(getDoc(doc(db, 'events', id, 'games', 'shoe-1'))))
  assert.ok(await denied(getDocs(collection(db, 'events', id, 'games'))))
  await deleteApp(app)
})

test('2. no client write on games, for the owner, a guest or another account', async () => {
  const dj = await mk('account'); const guest = await mk(); const other = await mk('account'); const id = await seedGames(dj.uid)
  for (const c of [dj, guest, other]) {
    assert.ok(await denied(addDoc(collection(c.db, 'events', id, 'games'), { type: 'shoe_game', status: 'running' })), 'create')
    assert.ok(await denied(setDoc(doc(c.db, 'events', id, 'games', 'new'), { type: 'wedding_roulette', status: 'idle' })), 'set')
    assert.ok(await denied(updateDoc(doc(c.db, 'events', id, 'games', 'roulette-new'), { status: 'completed', result: { slot_label: 'EVIL' } })), 'update')
    assert.ok(await denied(deleteDoc(doc(c.db, 'events', id, 'games', 'shoe-1'))), 'delete')
  }
  const snap = await getDoc(doc(dj.db, 'events', id, 'games', 'roulette-new'))
  assert.equal(snap.data()?.status, 'idle'); assert.equal(snap.data()?.result, null)
})

test('3. no listing across events (collection group is closed)', async () => {
  const dj = await mk('account'); const guest = await mk(); await seedGames(dj.uid)
  assert.ok(await denied(getDocs(collectionGroup(guest.db, 'games'))))
  assert.ok(await denied(getDocs(collectionGroup(dj.db, 'games'))))
})

test('4. subscribeLatestGame: newest round per type, realtime updates, types never mixed', async () => {
  const dj = await mk('account'); const guest = await mk(); const id = await seedGames(dj.uid)
  const roulette: Array<ReturnType<typeof fromGameDoc> | null> = [], shoe: Array<ReturnType<typeof fromGameDoc> | null> = []
  const u1 = subscribeLatestGame(guest.db, id, 'wedding_roulette', (r) => roulette.push(r))
  const u2 = subscribeLatestGame(guest.db, id, 'shoe_game', (r) => shoe.push(r))
  await sleep(600)
  assert.equal(roulette.at(-1)?.id, 'roulette-new')
  assert.equal(roulette.at(-1)?.status, 'idle')
  assert.equal(shoe.at(-1)?.id, 'shoe-1')
  assert.deepEqual((shoe.at(-1)?.config as any).questions, ['q1', 'q2'])

  // spin: same round, status + result change → pushed to the listener
  await seedUpdate(`events/${id}/games/roulette-new`, { status: 'completed', result: { slot_index: 0, slot_label: 'B' } })
  // shoe next: config.current_index moves
  await seedUpdate(`events/${id}/games/shoe-1`, { config: { questions: ['q1', 'q2'], current_index: 1, is_active: true } })
  await sleep(600)
  assert.deepEqual(roulette.at(-1)?.result, { slot_index: 0, slot_label: 'B' })
  assert.equal(roulette.at(-1)?.status, 'completed')
  assert.equal((shoe.at(-1)?.config as any).current_index, 1)

  // a brand-new roulette round becomes the latest
  await seedSet(`events/${id}/games/roulette-newest`, { type: 'wedding_roulette', status: 'idle', config: { penitenze: [] }, result: null, legacySupabaseId: 'roulette-newest', createdAt: new Date(Date.now() + 1000), updatedAt: new Date() })
  await sleep(600)
  assert.equal(roulette.at(-1)?.id, 'roulette-newest')
  assert.equal(shoe.at(-1)?.id, 'shoe-1')
  u1(); u2()
})

test('5. an event without projected games yields null (caller keeps the legacy polling); unknown types are ignored', async () => {
  const dj = await mk('account'); const guest = await mk()
  const id = `gev${Date.now()}${n++}`
  await seedSet(`events/${id}`, eventFields(dj.uid, `s${id}`, { legacySupabaseId: `gs-${id}` }))
  const seen: unknown[] = []
  const u = subscribeLatestGame(guest.db, id, 'shoe_game', (r) => seen.push(r))
  await sleep(500); u()
  assert.deepEqual(seen, [null])
  assert.equal(fromGameDoc('x', { type: 'stand_up_guess', status: 'idle' }), null)
})
