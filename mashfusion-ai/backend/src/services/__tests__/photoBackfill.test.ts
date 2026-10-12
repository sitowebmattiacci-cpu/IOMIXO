/** Emulator-only (npm run test:firebase): legacy photos → events/{id}/photos (metadata only): mapping, idempotency, markers, guards, rollback, binary plan. */
export {}
const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const d = emu ? describe : describe.skip
const svc: typeof import('../photoBackfill') = emu ? require('../photoBackfill') : (undefined as never)
const { firestore } = emu ? require('../../lib/firebaseAdmin') : ({} as any)

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const OPTS = { apply: false, projectId: 'demo-iomixo' }, APPLY = { apply: true, projectId: 'demo-iomixo' }
const run = (snap: any, o: any = OPTS) => svc.runPhotoBackfill(snap, o, { db: firestore() })

async function mkEvent(legacy: string, over: Record<string, unknown> = {}) {
  const ref = firestore().collection('events').doc()
  await ref.set({ ownerUid: 'o-' + uid(), slug: 's' + uid(), legacySupabaseId: legacy, title: 'T', type: 'wedding', status: 'live', createdAt: new Date(), updatedAt: new Date(), ...over })
  return ref
}
const photo = (session_id: string, over: Record<string, unknown> = {}) => ({
  id: `lp-${uid()}`, session_id, guest_name: 'Zia', caption: 'Che bella', storage_path: `${session_id}/1700000000-ab12cd.jpg`, status: 'approved', source: 'live_booth', is_featured: true,
  created_at: '2026-02-01T10:00:00.123456+00:00', updated_at: '2026-02-01T10:00:00.123456+00:00', ...over,
})
const session = (id: string, over: Record<string, unknown> = {}) => ({ id, dj_id: 'dj-1', public_slug: 's', session_type: 'wedding', show_photos: true, winner_announcement: null, ...over })

d('photo backfill (Firestore emulator)', () => {
  jest.setTimeout(120_000)

  it('inventory: statuses, sources, extensions, votes, winner files, bad rows — no identifiers', () => {
    const inv = svc.inventoryPhotos({
      photos: [photo('s1'), photo('s1', { status: 'pending', source: 'guest_upload', is_featured: false, storage_path: 's1/a.png' }), photo('s2', { storage_path: '../x.jpg' }), photo('s9', { storage_path: '' })] as any,
      votes: [{ photo_id: 'a', count: 3 }, { photo_id: 'b', count: 0 }],
      sessions: [session('s1', { winner_announcement: { groom_photo_path: 's1/g.jpg', bride_photo_path: 's1/b.jpg' } }), session('s2', { show_photos: false })] as any,
    })
    expect(inv).toMatchObject({ photos: 4, sessionsWithPhotos: 3, byStatus: { approved: 3, pending: 1 }, bySource: { live_booth: 3, guest_upload: 1 }, featured: 3, unsafePath: 1, missingPath: 1,
      votesTotal: 3, photosWithVotes: 1, sessionsWithWinner: 1, winnerPhotoFiles: 2, sessionsShowingPhotos: 1, orphanPhotos: 1 })
  })

  it('dry-run is the default and never writes; apply creates METADATA ONLY (no served file), ids = legacy ids; a rerun is a no-op', async () => {
    const sid = 'ls-' + uid(); const ev = await mkEvent(sid); const p = photo(sid), p2 = photo(sid, { status: 'pending', is_featured: false })
    const snap = { photos: [p, p2], votes: [{ photo_id: p.id, count: 4 }], sessions: [session(sid)] }
    const dry = await run(snap)
    expect(dry.mode).toBe('dry-run'); expect(dry.photos).toMatchObject({ wouldCreate: 2, noop: 0, drift: 0 }); expect(dry.binaries.photoFilesToCopy).toBe(2); expect(dry.events).toMatchObject({ withLegacyPhotos: 1, keptOnLegacy: 1, wouldMarkMigrated: 0 })
    expect((await ev.collection('photos').get()).size).toBe(0)

    const r = await run(snap, APPLY)
    expect(r.applied).toEqual({ written: 2, skipped: 0 }); expect(r.blockers).toEqual([])
    const doc = (await ev.collection('photos').doc(p.id).get()).data()!
    expect(doc).toMatchObject({ guestUid: null, guestName: 'Zia', caption: 'Che bella', source: 'live_booth', status: 'approved', isFeatured: true, storagePath: '', legacyStoragePath: p.storage_path,
      legacySupabaseId: p.id, contentType: 'image/jpeg', legacyVoteCount: 4, backfilled: true })
    expect(doc.createdAt.toDate().toISOString()).toBe('2026-02-01T10:00:00.123Z'); expect((await ev.get()).data()!.photosMigratedAt).toBeUndefined()   // files still legacy
    const again = await run(snap, APPLY); expect(again.photos).toMatchObject({ wouldCreate: 0, noop: 2 }); expect(again.applied).toEqual({ written: 0, skipped: 0 })
  })

  it('never overwrites an existing doc (differences are reported as drift); events with nothing to copy get the migrated marker, others do not', async () => {
    const withPhotos = 'ls-' + uid(), empty = 'ls-' + uid(), withWinner = 'ls-' + uid()
    const e1 = await mkEvent(withPhotos), e2 = await mkEvent(empty), e3 = await mkEvent(withWinner)
    const p = photo(withPhotos)
    const snap = { photos: [p], votes: [], sessions: [session(withPhotos), session(empty, { show_photos: false }), session(withWinner, { winner_announcement: { groom_photo_path: `${withWinner}/g.jpg` } })] }
    expect((await run(snap)).events).toMatchObject({ wouldMarkMigrated: 1, keptOnLegacy: 2 })
    await run(snap, APPLY)
    expect((await e2.get()).data()!.photosMigratedAt).toBeDefined(); expect((await e1.get()).data()!.photosMigratedAt).toBeUndefined(); expect((await e3.get()).data()!.photosMigratedAt).toBeUndefined()
    await e1.collection('photos').doc(p.id).update({ status: 'rejected' })                     // edited in Firestore after the backfill
    const r = await run(snap, APPLY)
    expect(r.photos).toMatchObject({ drift: 1, wouldCreate: 0 }); expect((await e1.collection('photos').doc(p.id).get()).data()!.status).toBe('rejected')
    expect((await run(snap)).binaries.winnerFilesToCopy).toBe(1)
  })

  it('blockers refuse an apply: unmapped session, duplicate ids, unsafe path; --legacy-user-id restricts the scope; guards for a real project', async () => {
    const sid = 'ls-' + uid(); await mkEvent(sid)
    const orphan = photo('no-event-' + uid()), dup = photo(sid), bad = photo(sid, { storage_path: '../../etc/passwd.jpg' })
    const snap = { photos: [photo(sid), orphan, dup, { ...dup }, bad], votes: [], sessions: [session(sid), session(orphan.session_id)] }
    const dry = await run(snap)
    expect(dry.photos).toMatchObject({ unmappedSession: 1, duplicates: 2, invalid: 1, wouldCreate: 1 }); expect(dry.blockers.length).toBeGreaterThanOrEqual(3)
    await expect(run(snap, APPLY)).rejects.toThrow()                                           // BackfillRefused: nothing is written
    const evDoc = (await firestore().collection('events').where('legacySupabaseId', '==', sid).get()).docs[0]
    expect((await evDoc.ref.collection('photos').get()).size).toBe(0)

    const mine = 'ls-' + uid(), theirs = 'ls-' + uid(); await mkEvent(mine); await mkEvent(theirs)
    const scoped = await run({ photos: [photo(mine), photo(theirs)], votes: [], sessions: [session(mine, { dj_id: 'dj-A' }), session(theirs, { dj_id: 'dj-B' })] }, { ...OPTS, legacyUserId: 'dj-A' })
    expect(scoped.photos).toMatchObject({ selected: 1, wouldCreate: 1 })
    await expect(svc.runPhotoBackfill({ photos: [], votes: [], sessions: [] }, { apply: true, projectId: 'iomixo-494817' }, { db: firestore() })).rejects.toThrow()
  })

  it('rollback removes only untouched backfilled docs and the markers it set', async () => {
    const sid = 'ls-' + uid(), empty = 'ls-' + uid(); const ev = await mkEvent(sid), ev2 = await mkEvent(empty)
    const p = photo(sid), q = photo(sid, { status: 'pending' })
    const r = await run({ photos: [p, q], votes: [], sessions: [session(sid), session(empty, { show_photos: false })] }, APPLY)
    await ev.collection('photos').doc(q.id).update({ storagePath: `events/${ev.id}/photos/${q.id}/original.jpg` })      // its binary was copied meanwhile
    const dry = await svc.runPhotoRollback(firestore(), r.entries!, OPTS); expect(dry).toEqual({ removed: 2, skippedChanged: 1 })   // photo p + marker; q kept
    expect((await ev.collection('photos').get()).size).toBe(2)
    const done = await svc.runPhotoRollback(firestore(), r.entries!, APPLY); expect(done).toEqual({ removed: 2, skippedChanged: 1 })
    expect((await ev.collection('photos').get()).docs.map((x: any) => x.id)).toEqual([q.id]); expect((await ev2.get()).data()!.photosMigratedAt).toBeUndefined()
  })

  it('binary manifest: deterministic target paths inside events/{id}, winner files named with a random-looking token, nothing written', async () => {
    const sid = 'ls-' + uid(); const ev = await mkEvent(sid); const p = photo(sid, { storage_path: `${sid}/x.png` }), odd = photo(sid, { storage_path: `${sid}/x.gif` })
    const snap = { photos: [p, odd, photo('ls-none-' + uid())], votes: [], sessions: [session(sid, { winner_announcement: { groom_photo_path: `${sid}/g.jpg`, bride_photo_path: `events/${ev.id}/winner/bride-aaaaaaaaaaaa.jpg` } })] }
    const m = await svc.buildBinaryManifest(snap as any, firestore()); const m2 = await svc.buildBinaryManifest(snap as any, firestore())
    expect(m).toEqual(m2); expect(m).toMatchObject({ unmapped: 1, skipped: 1 })
    const photoEntry = m.entries.find((e: any) => e.kind === 'photo')!, win = m.entries.filter((e: any) => e.kind === 'winner')
    expect(photoEntry).toMatchObject({ eventId: ev.id, photoId: p.id, legacyBucket: 'wedding-photos', legacyPath: `${sid}/x.png`, targetPath: `events/${ev.id}/photos/${p.id}/original.png`, contentType: 'image/png' })
    expect(win).toHaveLength(1); expect(win[0].targetPath).toMatch(new RegExp(`^events/${ev.id}/winner/groom-[A-Za-z0-9]{12,}\\.jpg$`))
    expect((await ev.collection('photos').get()).size).toBe(0)
  })
})
