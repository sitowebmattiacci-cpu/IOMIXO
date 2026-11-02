import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { seedSet, eventFields } from './seed'
import { revokeGalleryLinks, updateEventConfig } from '../../../../firebase/functions/src/owner/config'

/**
 * Closing the download links of a MIOLOVE album when "Galleria condivisa" goes OFF must work for ANY album size and must never claim more than it did:
 * resumable (a photo done is marked, later calls only do what is left), bounded in time, counting failures, `incomplete` until every approved photo is done.
 * Admin-SDK logic against the Firestore emulator with an injected token revoker (the real Storage behaviour is in SG10 / the cloud procedure).
 */
const fnReq = createRequire(__dirname + '/../../../../firebase/functions/package.json')
const { initializeApp, getApps } = fnReq('firebase-admin/app')
const { getFirestore } = fnReq('firebase-admin/firestore')
if (!getApps().length) initializeApp({ projectId: 'demo-iomixo' })
const db = getFirestore()
let n = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function album(photos: number, over: Record<string, unknown> = {}, owner = `ow${Date.now()}${n}`) {
  const id = `rv${Date.now()}${n++}`
  await seedSet(`users/${owner}`, { uid: owner, email: `${owner}@t.dev`, accountType: 'couple', plan: { tier: 'free', source: 'default' } })
  await seedSet(`events/${id}`, eventFields(owner, `s${id}`, { type: 'wedding', brand: 'miolove', accessMode: 'activated', occasionType: 'wedding', guestConfig: { shared_gallery: true }, screenConfig: null, ...over }))
  const batch = db.batch()
  for (let i = 0; i < photos; i++) batch.set(db.doc(`events/${id}/photos/p${i}`), { status: 'approved', storagePath: `events/${id}/photos/p${i}/original.jpg`, optimizedPath: `events/${id}/photos/p${i}/optimized.jpg`, thumbPath: `events/${id}/photos/p${i}/thumb.jpg` })
  await batch.commit()
  return { id, owner }
}

test('RV1. a big album is revoked in several bounded passes: each pass stops on time, marks what it did, the next only does the rest, nothing is revoked twice, the last says complete', async () => {
  const { id } = await album(240)
  const seen = new Map<string, number>(); const revoke = async (p: string) => { seen.set(p, (seen.get(p) ?? 0) + 1); await sleep(8); return 'revoked' as const }
  let passes = 0, last = await revokeGalleryLinks(db, id, 1, { budgetMs: 120, revoke })
  assert.equal(last.state, 'incomplete', 'a small time budget cannot finish 720 files'); assert.ok(last.pending > 0 && last.pending < 240, `partial progress (pending ${last.pending})`); assert.equal(last.failed, 0)
  const afterFirst = last.pending
  while (last.state !== 'complete' && passes++ < 200) last = await revokeGalleryLinks(db, id, 1, { budgetMs: 120, revoke })
  assert.deepEqual([last.state, last.pending, last.failed], ['complete', 0, 0]); assert.ok(passes >= 1 && afterFirst > last.pending)
  assert.equal(seen.size, 720, 'every file of every approved photo'); assert.ok([...seen.values()].every((c) => c === 1), 'no file revoked twice across passes')
  const ev = (await db.doc(`events/${id}`).get()).data()!; assert.deepEqual([ev.galleryRevocation.state, ev.galleryRevocation.pending], ['complete', 0])
})

test('RV2. a failure is never hidden: the album stays incomplete with the count, and the next pass redoes ONLY the failed photo', async () => {
  const { id } = await album(5)
  const calls: string[] = []
  const bad = async (p: string) => { calls.push(p); return p.includes('/p3/') && p.endsWith('thumb.jpg') ? 'failed' as const : 'revoked' as const }
  const r1 = await revokeGalleryLinks(db, id, 1, { revoke: bad })
  assert.deepEqual([r1.state, r1.pending, r1.failed], ['incomplete', 1, 1])
  assert.equal((await db.doc(`events/${id}`).get()).data()!.galleryRevocation.state, 'incomplete', 'the state is stored on the event')
  calls.length = 0
  const r2 = await revokeGalleryLinks(db, id, 1, { revoke: async (p) => { calls.push(p); return 'revoked' } })
  assert.deepEqual([r2.state, r2.pending, r2.failed], ['complete', 0, 0]); assert.equal(new Set(calls.map((p) => p.split('/')[3])).size, 1, 'only the failed photo is redone')
})

test('RV3. a file that no longer exists counts as revoked (nothing can serve it) so it cannot keep an album incomplete forever; a new ON → OFF (new epoch) revokes everything again', async () => {
  const { id } = await album(3)
  const gone = await revokeGalleryLinks(db, id, 1, { revoke: async () => 'gone' }); assert.deepEqual([gone.state, gone.pending], ['complete', 0])
  const seen: string[] = []; const again = await revokeGalleryLinks(db, id, 2, { revoke: async (p) => { seen.push(p); return 'revoked' } })
  assert.deepEqual([again.state, seen.length], ['complete', 9], 'epoch 2: every file again')
  const none = await revokeGalleryLinks(db, id, 2, { revoke: async () => assert.fail('nothing left to revoke') })
  assert.equal(none.state, 'complete')
})

const call = (owner: string, id: string, guestConfig: Record<string, unknown>) => updateEventConfig(db, { auth: { uid: owner } } as any, { eventId: id, guestConfig } as any)

test('RV4. through the callable logic: ON → OFF opens epoch 1 and reports the revocation; OFF → OFF with nothing pending changes nothing; ON clears the state; the next OFF is epoch 2', async () => {
  const { id, owner } = await album(2)
  const r1 = await call(owner, id, { shared_gallery: false })
  assert.deepEqual([r1.galleryRevocation?.state, r1.galleryRevocation?.epoch], ['complete', 1]); assert.deepEqual(r1.updated, ['guestConfig'], 'internal keys are not reported as client fields')
  assert.equal((await db.doc(`events/${id}`).get()).data()!.galleryEpoch, 1)
  const r2 = await call(owner, id, { shared_gallery: false, live_booth: true }); assert.equal(r2.galleryRevocation, undefined, 'already closed and complete: no new round')
  assert.equal((await db.doc(`events/${id}`).get()).data()!.galleryEpoch, 1)
  await call(owner, id, { shared_gallery: true }); assert.equal((await db.doc(`events/${id}`).get()).data()!.galleryRevocation, undefined, 'opening clears the state')
  const r3 = await call(owner, id, { shared_gallery: false }); assert.equal(r3.galleryRevocation?.epoch, 2)
})

test('RV5. an interrupted revocation is RESUMED by the next save with the gallery off (no new epoch); IOMIXO events never get the fields', async () => {
  const { id, owner } = await album(3, { guestConfig: { shared_gallery: false }, galleryEpoch: 4, galleryRevocation: { state: 'incomplete', epoch: 4, pending: 3, failed: 0 } })
  const r = await call(owner, id, { shared_gallery: false }); assert.deepEqual([r.galleryRevocation?.state, r.galleryRevocation?.epoch], ['complete', 4])
  assert.equal((await db.doc(`events/${id}`).get()).data()!.galleryEpoch, 4, 'the epoch did not grow')
  const dj = `dj${Date.now()}${n++}`, did = `rvd${Date.now()}${n++}`
  await seedSet(`users/${dj}`, { uid: dj, email: `${dj}@t.dev`, accountType: 'dj', plan: { tier: 'advance', source: 'legacy' } })
  await seedSet(`events/${did}`, eventFields(dj, `s${did}`, { type: 'party', brand: 'iomixo', guestConfig: { shared_gallery: true } }))
  await db.doc(`events/${did}/photos/p`).set({ status: 'approved', storagePath: 'x/o.jpg' })
  const rd = await call(dj, did, { shared_gallery: false }); assert.equal(rd.galleryRevocation, undefined)
  const ev = (await db.doc(`events/${did}`).get()).data()!; assert.equal('galleryEpoch' in ev || 'galleryRevocation' in ev, false, 'IOMIXO event untouched')
  assert.equal('linksRevokedEpoch' in (await db.doc(`events/${did}/photos/p`).get()).data()!, false)
})
