import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, serverTimestamp } from 'firebase/firestore'
import { newClient, closeClient, denied, type TestClient } from './helpers'
import { seedSet } from './seed'

/** Billing history rules: users/{uid}/subscriptions + payments (owner read, no client write) and stripeCustomers (no client access at all). */
const clients: TestClient[] = []
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }
after(() => Promise.all(clients.map(closeClient)))

async function setup() {
  const a = await mk(), b = await mk(), g = await mk('anonymous')
  await seedSet(`users/${a.uid}`, { uid: a.uid, email: a.email, plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`users/${a.uid}/subscriptions/sub_test1`, { stripeSubscriptionId: 'sub_test1', legacyStatus: 'trialing', historical: true, stale: true })
  await seedSet(`users/${a.uid}/payments/pi_test1`, { stripePaymentIntentId: 'pi_test1', amountCents: 799, historical: true })
  await seedSet(`users/${a.uid}/eventPasses/pi_pass1`, { status: 'active', validUntil: new Date(Date.now() + 3600_000) })
  await seedSet(`stripeCustomers/cus_test1`, { uid: a.uid, legacySupabaseId: 'x' })
  return { a, b, g }
}

test('B1. owner reads own subscriptions and payments (get + list); eventPasses still readable', async () => {
  const { a } = await setup()
  assert.equal((await getDoc(doc(a.db, 'users', a.uid, 'subscriptions', 'sub_test1'))).data()?.legacyStatus, 'trialing')
  assert.equal((await getDoc(doc(a.db, 'users', a.uid, 'payments', 'pi_test1'))).data()?.amountCents, 799)
  assert.equal((await getDocs(collection(a.db, 'users', a.uid, 'subscriptions'))).size, 1)
  assert.equal((await getDocs(collection(a.db, 'users', a.uid, 'payments'))).size, 1)
  assert.equal((await getDocs(collection(a.db, 'users', a.uid, 'eventPasses'))).size, 1)
})

test('B2. another account and an anonymous guest are denied (get + list) on someone else\'s billing history', async () => {
  const { a, b, g } = await setup()
  for (const c of [b, g]) for (const sub of ['subscriptions', 'payments']) {
    assert.ok(await denied(getDoc(doc(c.db, 'users', a.uid, sub, sub === 'payments' ? 'pi_test1' : 'sub_test1'))), `${sub} get`)
    assert.ok(await denied(getDocs(collection(c.db, 'users', a.uid, sub))), `${sub} list`)
  }
})

test('B3. every client write is denied, even for the owner (create / overwrite / update / delete / add), on subscriptions and payments', async () => {
  const { a, b } = await setup()
  for (const [sub, id] of [['subscriptions', 'sub_test1'], ['payments', 'pi_test1']] as const) {
    assert.ok(await denied(setDoc(doc(a.db, 'users', a.uid, sub, 'new_one'), { amountCents: 1, createdAt: serverTimestamp() })), `${sub} create`)
    assert.ok(await denied(setDoc(doc(a.db, 'users', a.uid, sub, id), { amountCents: 0 })), `${sub} overwrite`)
    assert.ok(await denied(updateDoc(doc(a.db, 'users', a.uid, sub, id), { amountCents: 0, tier: 'wedding' })), `${sub} update`)
    assert.ok(await denied(deleteDoc(doc(a.db, 'users', a.uid, sub, id))), `${sub} delete`)
    assert.ok(await denied(addDoc(collection(a.db, 'users', a.uid, sub), { amountCents: 1 })), `${sub} add`)
    assert.ok(await denied(setDoc(doc(b.db, 'users', a.uid, sub, 'hijack'), { amountCents: 1 })), `${sub} other account create`)
  }
  assert.equal((await getDoc(doc(a.db, 'users', a.uid, 'payments', 'pi_test1'))).data()?.amountCents, 799, 'unchanged')
})

test('B4. stripeCustomers is closed to every client: no get, no list, no write (owner of the mapping included)', async () => {
  const { a, b, g } = await setup()
  for (const c of [a, b, g]) {
    assert.ok(await denied(getDoc(doc(c.db, 'stripeCustomers', 'cus_test1'))), 'get')
    assert.ok(await denied(getDocs(collection(c.db, 'stripeCustomers'))), 'list')
    assert.ok(await denied(setDoc(doc(c.db, 'stripeCustomers', 'cus_mine'), { uid: c.uid })), 'create')
    assert.ok(await denied(updateDoc(doc(c.db, 'stripeCustomers', 'cus_test1'), { uid: c.uid })), 'update')
    assert.ok(await denied(deleteDoc(doc(c.db, 'stripeCustomers', 'cus_test1'))), 'delete')
  }
})

test('B4b. stripeEvents (webhook idempotency log) is closed to every client', async () => {
  const { a, g } = await setup()
  await seedSet('stripeEvents/evt_test1', { type: 'x', status: 'processed' })
  for (const c of [a, g]) {
    assert.ok(await denied(getDoc(doc(c.db, 'stripeEvents', 'evt_test1'))), 'get'); assert.ok(await denied(getDocs(collection(c.db, 'stripeEvents'))), 'list')
    assert.ok(await denied(setDoc(doc(c.db, 'stripeEvents', 'evt_forged'), { status: 'processed' })), 'create'); assert.ok(await denied(deleteDoc(doc(c.db, 'stripeEvents', 'evt_test1'))), 'delete')
  }
})

test('B5. billing fields on the user doc stay server-only: no client write of stripeCustomerId or plan', async () => {
  const { a } = await setup()
  for (const patch of [{ stripeCustomerId: 'cus_evil' }, { plan: { tier: 'wedding', source: 'stripe' } }])
    assert.ok(await denied(updateDoc(doc(a.db, 'users', a.uid), { ...patch, updatedAt: serverTimestamp() })), JSON.stringify(Object.keys(patch)))
})
