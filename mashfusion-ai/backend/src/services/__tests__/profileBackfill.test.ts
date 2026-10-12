/** Emulator-only (npm run test:firebase): legacy profiles → users.displayName / djProfiles (metadata only): mapping, idempotency, sanitising, guards, rollback, avatar plan. */
export {}
const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const d = emu ? describe : describe.skip
const svc: typeof import('../profileBackfill') = emu ? require('../profileBackfill') : (undefined as never)
const { firestore } = emu ? require('../../lib/firebaseAdmin') : ({} as any)

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const OPTS = { apply: false, projectId: 'demo-iomixo' }, APPLY = { apply: true, projectId: 'demo-iomixo' }
const run = (snap: any, o: any = OPTS) => svc.runProfileBackfill(snap, o, { db: firestore() })
const PUB = 'https://x.supabase.co/storage/v1/object/public/avatars'

async function mkUser(legacy: string, over: Record<string, unknown> = {}) {
  const ref = firestore().collection('users').doc('u' + uid().replace(/[^A-Za-z0-9]/g, ''))
  await ref.set({ uid: ref.id, email: 'a@b.c', plan: { tier: 'free', source: 'default' }, legacySupabaseId: legacy, createdAt: new Date(), updatedAt: new Date(), ...over })
  return ref
}
const dj = (user_id: string, over: Record<string, unknown> = {}) => ({
  user_id, display_name: 'DJ Test', bio: 'Bio', instagram_url: 'https://instagram.com/dj', tiktok_url: null, spotify_url: '', soundcloud_url: null, website_url: 'https://dj.example',
  avatar_url: `${PUB}/${user_id}/1700000000000.jpg`, public_slug: 'slug-' + uid(), created_at: '2026-01-02T10:00:00.123456+00:00', updated_at: '2026-01-03T10:00:00+00:00', ...over,
})

d('profile backfill (Firestore emulator)', () => {
  jest.setTimeout(120_000)

  it('inventory: counts, avatar sources, bad urls — no identifiers', () => {
    const inv = svc.inventoryProfiles({
      users: [{ id: 'a', full_name: 'A', avatar_url: `${PUB}/a/1.png` }, { id: 'b', full_name: '', avatar_url: 'https://cdn.example/x.jpg' }] as any,
      djProfiles: [dj('a'), dj('b', { instagram_url: 'javascript:x', public_slug: null, avatar_url: null })] as any,
    })
    expect(inv).toMatchObject({ users: 2, usersWithName: 1, usersWithAvatar: 2, djProfiles: 2, withDisplayName: 2, withBio: 2, withSocials: 2, withSlug: 1, withAvatar: 1, nonHttpUrls: 1,
      avatars: { total: 3, supabasePublicBucket: 2, external: 1 } })
    expect(inv.notInLegacySchema.join()).toContain('phone')
  })

  it('dry-run never writes; apply creates djProfiles + names, NEVER an avatar served field; rerun is a no-op; existing data is never overwritten', async () => {
    const lid = 'l-' + uid(); const u = await mkUser(lid)
    const snap = { users: [{ id: lid, full_name: 'Mario Rossi', avatar_url: `${PUB}/${lid}/1.png` }], djProfiles: [dj(lid)] }
    const dryR = await run(snap)
    expect(dryR.mode).toBe('dry-run'); expect(dryR.users).toMatchObject({ wouldSetName: 1 }); expect(dryR.djProfiles).toMatchObject({ wouldCreate: 1 }); expect(dryR.avatars.toCopy).toBe(2)
    expect((await firestore().collection('djProfiles').doc(u.id).get()).exists).toBe(false)
    expect((await u.get()).data().displayName).toBeUndefined()

    const r = await run(snap, APPLY)
    expect(r.applied).toEqual({ written: 2, skipped: 0 })
    const prof = (await firestore().collection('djProfiles').doc(u.id).get()).data()
    expect(prof).toMatchObject({ displayName: 'DJ Test', bio: 'Bio', instagramUrl: 'https://instagram.com/dj', tiktokUrl: null, spotifyUrl: null, websiteUrl: 'https://dj.example', legacySupabaseId: lid, backfilled: true })
    expect(prof.avatarUrl).toBeUndefined(); expect(prof.avatarPath).toBeUndefined(); expect(prof.legacyAvatarUrl).toContain('/avatars/')
    const us = (await u.get()).data(); expect(us.displayName).toBe('Mario Rossi'); expect(us.avatarUrl).toBeUndefined(); expect(us.plan).toEqual({ tier: 'free', source: 'default' })

    const again = await run(snap, APPLY)
    expect(again.applied).toEqual({ written: 0, skipped: 0 }); expect(again.djProfiles).toMatchObject({ noop: 1, wouldCreate: 0 })
    // the owner edits afterwards: a rerun reports drift and never overwrites
    await firestore().collection('djProfiles').doc(u.id).update({ bio: 'Changed by owner' })
    await u.update({ displayName: 'Chosen' })
    const drift = await run(snap)
    expect(drift.djProfiles).toMatchObject({ drift: 1, wouldCreate: 0 }); expect(drift.users).toMatchObject({ keptExistingName: 1, wouldSetName: 0 })
  })

  it('unmapped users are skipped (never created), ambiguous ones are blockers, a slug held by someone else blocks that row', async () => {
    const lid = 'l-' + uid(), amb = 'l-' + uid(), taken = 'l-' + uid(), slug = 'held-' + uid()
    await mkUser(amb); await mkUser(amb); const t = await mkUser(taken)
    await firestore().collection('djProfiles').doc('someone-else').set({ publicSlug: slug, createdAt: new Date(), updatedAt: new Date() })
    const r = await run({ users: [], djProfiles: [dj(lid), dj(amb), dj(taken, { public_slug: slug })] })
    expect(r.djProfiles).toMatchObject({ unmapped: 1, ambiguous: 1, slugClashes: 1, wouldCreate: 0 })
    expect(r.blockers.join(' ')).toMatch(/no users\/\{uid\}\.legacySupabaseId/); expect(r.blockers.join(' ')).toMatch(/more than one/); expect(r.blockers.join(' ')).toMatch(/public_slug already used/)
    await expect(run({ users: [], djProfiles: [dj(amb)] }, APPLY)).rejects.toThrow(/refused/)
    expect((await firestore().collection('djProfiles').doc(t.id).get()).exists).toBe(false)
  })

  it('values are rules-compatible: non-http / oversized dropped and counted; guards refuse a real project without --yes-production', async () => {
    const lid = 'l-' + uid(); const u = await mkUser(lid)
    const r = await run({ users: [], djProfiles: [dj(lid, { instagram_url: 'javascript:alert(1)', bio: 'x'.repeat(1500), display_name: 'n'.repeat(120), website_url: 'https://' + 'a'.repeat(400) })] }, APPLY)
    expect(r.djProfiles.sanitized).toBe(3)
    const p = (await firestore().collection('djProfiles').doc(u.id).get()).data()
    expect([p.instagramUrl, p.websiteUrl, p.bio.length, p.displayName.length]).toEqual([null, null, 1000, 80])
    await expect(svc.runProfileBackfill({ users: [], djProfiles: [] }, { apply: true, projectId: 'iomixo-494817' }, { db: firestore() })).rejects.toThrow(/yes-production/)
  })

  it('rollback removes only what the run created and only if still untouched (no committed avatar, name unchanged)', async () => {
    const a = 'l-' + uid(), b = 'l-' + uid(); const ua = await mkUser(a), ub = await mkUser(b)
    const r = await run({ users: [{ id: a, full_name: 'Aa' }, { id: b, full_name: 'Bb' }], djProfiles: [dj(a), dj(b)] }, APPLY)
    await firestore().collection('djProfiles').doc(ub.id).update({ avatarPath: `profiles/${ub.id}/avatar/dj-aaaaaaaaaaaaaaaa.jpg` })   // owner uploaded an avatar since
    await ub.update({ displayName: 'Renamed' })
    const dry = await svc.runProfileRollback(firestore(), r.entries!, OPTS)
    expect(dry).toEqual({ removed: 1, restored: 1, skippedChanged: 2 }); expect((await firestore().collection('djProfiles').doc(ua.id).get()).exists).toBe(true)
    await svc.runProfileRollback(firestore(), r.entries!, APPLY)
    expect((await firestore().collection('djProfiles').doc(ua.id).get()).exists).toBe(false); expect((await ua.get()).data().displayName).toBeUndefined()
    expect((await firestore().collection('djProfiles').doc(ub.id).get()).exists).toBe(true); expect((await ub.get()).data().displayName).toBe('Renamed')
  })

  it('avatar manifest: deterministic target paths under profiles/{uid}/avatar, only the legacy public bucket, no copy', async () => {
    const lid = 'l-' + uid(); const u = await mkUser(lid)
    const snap = { users: [{ id: lid, avatar_url: `${PUB}/${lid}/1.png` }, { id: 'ghost', avatar_url: `${PUB}/ghost/1.png` }], djProfiles: [dj(lid, { avatar_url: `${PUB}/${lid}/2.JPEG` }), dj(lid + 'x', { avatar_url: 'https://cdn.example/a.jpg' })] }
    const m1 = await svc.buildAvatarManifest(snap as any, firestore()), m2 = await svc.buildAvatarManifest(snap as any, firestore())
    expect(m1).toEqual(m2); expect(m1.unmapped).toBe(2); expect(m1.entries).toHaveLength(2)
    for (const e of m1.entries) { expect(e.targetPath).toMatch(new RegExp(`^profiles/${u.id}/avatar/(user|dj)-[A-Za-z0-9_-]{24}\\.(png|jpg)$`)); expect(e.legacyBucket).toBe('avatars') }
    expect(m1.entries.map((e) => e.kind).sort()).toEqual(['dj', 'user'])
  })
})
