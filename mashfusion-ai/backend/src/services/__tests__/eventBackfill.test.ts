/** Emulator-only (npm run test:firebase): sessions → events backfill — mapping, collisions, idempotency, stale protection, guards, rollback, scale. */
export {}
const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const d = emu ? describe : describe.skip
const svc: typeof import('../eventBackfill') = emu ? require('../eventBackfill') : (undefined as never)
const { firestore } = emu ? require('../../lib/firebaseAdmin') : ({} as any)

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const v = (n: number) => `2026-02-01T10:00:00.${String(100000 + n).padStart(6, '0')}+00:00`
const OPTS = { apply: false, projectId: 'demo-iomixo' }
const APPLY = { apply: true, projectId: 'demo-iomixo' }

async function fbUser(legacy: string) {
  const fb = `fb-${uid()}`
  await firestore().doc(`users/${fb}`).set({ uid: fb, legacySupabaseId: legacy, createdAt: new Date(), updatedAt: new Date() })
  return fb
}
const ses = (dj_id: string, over: Record<string, unknown> = {}) => ({
  id: `ls-${uid()}`, dj_id, public_slug: `s${uid()}`, event_name: 'Matrimonio', dj_name: 'DJ', description: null, is_active: true, session_type: 'wedding',
  couple_names: 'A & B', wedding_date: '2026-09-12', venue_name: 'Villa', screen_mode_enabled: true, guest_config: { requests: true }, screen_config: { photos: true },
  roulette_penitenze: null, shoe_game_questions: null, created_at: v(0), updated_at: v(1), ...over,
})
const run = (sessions: any[], o: any = OPTS) => svc.runEventBackfill({ sessions }, o, { db: firestore() })
const byLegacy = async (id: string) => (await firestore().collection('events').where('legacySupabaseId', '==', id).get()).docs
const total = async () => (await firestore().collection('events').get()).size

d('event backfill (Firestore emulator)', () => {
  jest.setTimeout(240_000)

  it('dry-run is the default and never writes', async () => {
    const l = 'dj-' + uid(); await fbUser(l); const s = ses(l)
    const r = await run([s])
    expect(r.mode).toBe('dry-run'); expect(r.events.wouldCreate).toBe(1); expect(r.applied).toBeUndefined()
    expect(await byLegacy(s.id)).toHaveLength(0); expect((await firestore().doc(`eventSlugs/${s.public_slug}`).get()).exists).toBe(false)
  })

  it('creates event + slug with legacySupabaseId, owner, version, createdAt from the source; a rerun changes nothing', async () => {
    const legacy = 'dj-' + uid(); const o = await fbUser(legacy); const s = ses(legacy, { is_active: false, session_type: 'party' })
    const r = await run([s], APPLY)
    expect(r.applied).toEqual({ written: 1, skipped: 0 })
    const [e] = await byLegacy(s.id); const x = e.data()
    expect(x).toMatchObject({ ownerUid: o, legacySupabaseId: s.id, slug: s.public_slug, title: 'Matrimonio', type: 'party', status: 'ended', coupleNames: 'A & B' })
    expect(x.sourceUpdatedAt.nanoseconds).toBe(100001000); expect(x.createdAt.toDate().toISOString()).toBe('2026-02-01T10:00:00.100Z')
    expect(x.screenConfig).toEqual({ photos: true }); expect(x.screen_config).toBeUndefined()   // TV toggles are public data → screenConfig; the legacy key name is never written
    expect((await firestore().doc(`eventSlugs/${s.public_slug}`).get()).data()).toEqual({ eventId: e.id })
    const again = await run([s], APPLY)
    expect(again.events).toMatchObject({ wouldCreate: 0, wouldUpdate: 0, wouldNoop: 1 }); expect(again.applied).toEqual({ written: 0, skipped: 0 })
    expect(await byLegacy(s.id)).toHaveLength(1)
  })

  it('newer source updates only the mapped fields (server bridge fields untouched); older source is STALE', async () => {
    const legacy = 'dj-' + uid(); await fbUser(legacy); const s = ses(legacy)
    await run([s], APPLY)
    const [e] = await byLegacy(s.id); await e.ref.update({ requestLimit: 25, dedicationsEnabled: true })
    const newer = { ...s, event_name: 'Nuovo titolo', updated_at: v(5) }
    expect((await run([newer])).events.wouldUpdate).toBe(1)
    await run([newer], APPLY)
    expect((await e.ref.get()).data()).toMatchObject({ title: 'Nuovo titolo', requestLimit: 25, dedicationsEnabled: true })
    const older = { ...s, event_name: 'Vecchio', updated_at: v(2) }
    const r = await run([older], APPLY)
    expect(r.events.stale).toBe(1); expect(r.applied).toEqual({ written: 0, skipped: 0 }); expect((await e.ref.get()).data()!.title).toBe('Nuovo titolo')
  })

  it('an event created by the projection (no sourceUpdatedAt) is never overwritten unless identical', async () => {
    const legacy = 'dj-' + uid(); const o = await fbUser(legacy); const s = ses(legacy)
    const ref = firestore().collection('events').doc()
    await ref.set({ ownerUid: o, legacySupabaseId: s.id, slug: s.public_slug, title: 'Modificato da projection', type: 'standard', status: 'live' })
    await firestore().doc(`eventSlugs/${s.public_slug}`).set({ eventId: ref.id })
    const r = await run([s], APPLY)
    expect(r.events.unversioned).toBe(1); expect((await ref.get()).data()!.title).toBe('Modificato da projection')
  })

  it('an event written by an older run (no screenConfig key) gets it filled at EQUAL version; an existing different value is never overwritten', async () => {
    const legacy = 'dj-' + uid(); await fbUser(legacy); const s = ses(legacy)
    await run([s], APPLY)
    const [e] = await byLegacy(s.id); await e.ref.update({ screenConfig: require('firebase-admin/firestore').FieldValue.delete() })
    const r = await run([s], APPLY)
    expect(r.events.wouldUpdate).toBe(1); expect((await e.ref.get()).data()!.screenConfig).toEqual({ photos: true })
    await e.ref.update({ screenConfig: { photos: false } })
    expect((await run([s], APPLY)).events).toMatchObject({ drift: 1, wouldUpdate: 0 }); expect((await e.ref.get()).data()!.screenConfig).toEqual({ photos: false })
  })

  it('duplicate slug / duplicate legacy id in the input block --apply and write nothing', async () => {
    const legacy = 'dj-' + uid(); await fbUser(legacy)
    const a = ses(legacy), b = ses(legacy, { public_slug: a.public_slug }), c = ses(legacy), c2 = { ...c, public_slug: `s${uid()}` }, ok = ses(legacy)
    const r = await run([a, b, c, c2, ok])
    expect(r.sessions).toMatchObject({ duplicateSlug: 2, duplicateLegacyId: 2 }); expect(r.events.wouldCreate).toBe(1)
    await expect(run([a, b, c, c2, ok], APPLY)).rejects.toThrow(/duplicate/)
    expect(await byLegacy(ok.id)).toHaveLength(0)
    expect((await run([ok], APPLY)).applied!.written).toBe(1)
  })

  it('slug already used by another event = collision (blocker, nothing written); existing event of another owner = conflict', async () => {
    const l1 = 'dj-' + uid(), l2 = 'dj-' + uid(); await fbUser(l1); await fbUser(l2)
    const a = ses(l1); await run([a], APPLY)
    const clash = ses(l1, { public_slug: a.public_slug })                      // different legacy id, same slug
    const r = await run([clash]); expect(r.sessions.slugCollision).toBe(1); expect(r.blockers.join()).toMatch(/collision/)
    await expect(run([clash], APPLY)).rejects.toThrow(/collision/); expect(await byLegacy(clash.id)).toHaveLength(0)
    const stolen = { ...a, dj_id: l2 }                                         // same legacy id, now claimed by another owner
    expect((await run([stolen])).sessions.ownerConflict).toBe(1)
    await expect(run([stolen], APPLY)).rejects.toThrow(/different owner/)
  })

  it('unmapped owner is skipped (no email fallback); ambiguous owner blocks --apply', async () => {
    const lAmb = 'dj-' + uid(); await fbUser(lAmb); await fbUser(lAmb)
    const lOk = 'dj-' + uid(); await fbUser(lOk)
    const un = ses('dj-nobody-' + uid()), amb = ses(lAmb), ok = ses(lOk)
    await firestore().doc(`users/by-email-${uid()}`).set({ email: 'x@example.com' })   // an email match alone must never map an owner
    const r = await run([un, amb, ok])
    expect(r.sessions).toMatchObject({ unmappedOwner: 1, ambiguousOwner: 1 }); expect(r.events.wouldCreate).toBe(1)
    await expect(run([un, amb, ok], APPLY)).rejects.toThrow(/ambiguous/)
    expect((await run([un, ok], APPLY)).applied!.written).toBe(1)
    expect(await byLegacy(un.id)).toHaveLength(0)
  })

  it('guards: --apply on a non-demo project needs yesProduction BEFORE any Firestore access; invalid rows are excluded', async () => {
    const throwing = { collection() { throw new Error('touched firestore') } } as any
    await expect(svc.runEventBackfill({ sessions: [] }, { apply: true, projectId: 'iomixo-494817' }, { db: throwing })).rejects.toThrow(/yes-production/)
    const legacy = 'dj-' + uid(); await fbUser(legacy)
    const r = await run([ses(legacy, { public_slug: 'a/b' }), ses(legacy, { updated_at: 'garbage' }), ses(legacy, { event_name: '' })])
    expect(r.sessions.invalid).toBe(3); expect(r.events.wouldCreate).toBe(0)
  })

  it('--legacy-user-id and --limit restrict the selection; duplicates are still detected on the full input', async () => {
    const l1 = 'dj-' + uid(), l2 = 'dj-' + uid(); await fbUser(l1); await fbUser(l2)
    const a = ses(l1), b = ses(l2), b2 = ses(l2)
    expect((await run([a, b, b2], { ...OPTS, legacyUserId: l2 })).sessions.selected).toBe(2)
    expect((await run([a, b, b2], { ...OPTS, limit: 1 })).sessions.selected).toBe(1)
    const dup = ses(l1, { public_slug: a.public_slug })
    expect((await run([a, dup], { ...OPTS, legacyUserId: l1 })).sessions.duplicateSlug).toBe(2)
  })

  it('rollback: deletes only what the run created (dry-run first), restores updates, skips changed docs and events with children', async () => {
    const legacy = 'dj-' + uid(); await fbUser(legacy)
    const a = ses(legacy), b = ses(legacy), c = ses(legacy)
    const created = await run([a, b, c], APPLY)
    const [ea] = await byLegacy(a.id), [eb] = await byLegacy(b.id), [ec] = await byLegacy(c.id)
    await eb.ref.update({ title: 'edit dopo il backfill' })                    // changed since → must be kept
    await ec.ref.collection('requests').doc('r1').set({ songTitle: 'x' })      // has children → must be kept
    const dry = await svc.runEventRollback(firestore(), { entries: created.rollbackEntries! }, { apply: false, projectId: 'demo-iomixo' })
    expect(dry).toMatchObject({ deleted: 2, skippedChanged: 2, skippedHasChildren: 2 }); expect((await ea.ref.get()).exists).toBe(true)
    await expect(svc.runEventRollback(firestore(), { entries: created.rollbackEntries! }, { apply: true, projectId: 'iomixo-494817' })).rejects.toThrow(/yes-production/)
    await svc.runEventRollback(firestore(), { entries: created.rollbackEntries! }, { apply: true, projectId: 'demo-iomixo' })
    expect((await ea.ref.get()).exists).toBe(false); expect((await firestore().doc(`eventSlugs/${a.public_slug}`).get()).exists).toBe(false)
    expect((await eb.ref.get()).data()!.title).toBe('edit dopo il backfill'); expect((await ec.ref.get()).exists).toBe(true)
    expect((await firestore().doc(`eventSlugs/${c.public_slug}`).get()).exists).toBe(true); expect((await firestore().doc(`eventSlugs/${b.public_slug}`).get()).exists).toBe(true)
    // restore of an update
    const s = ses(legacy); await run([s], APPLY)
    const upd = await run([{ ...s, event_name: 'v2', updated_at: v(9) }], APPLY)
    const [es] = await byLegacy(s.id); expect(es.data().title).toBe('v2')
    await svc.runEventRollback(firestore(), { entries: upd.rollbackEntries! }, { apply: true, projectId: 'demo-iomixo' })
    expect((await es.ref.get()).data()).toMatchObject({ title: 'Matrimonio' })
  })

  it('100 synthetic sessions: apply creates 100 events + 100 slugs, rerun is zero changes, nothing deleted', async () => {
    const owners = await Promise.all(Array.from({ length: 10 }, async () => { const l = 'dj-' + uid(); const fb = await fbUser(l); return { l, fb } }))
    const sessions = Array.from({ length: 100 }, (_, i) => ses(owners[i % 10].l, { session_type: ['standard', 'party', 'wedding'][i % 3], is_active: i % 2 === 0 }))
    // count only THIS test's events: other suites share the emulator and run in parallel
    const mine = async () => (await Promise.all(owners.map(async (o) => (await firestore().collection('events').where('ownerUid', '==', o.fb).get()).size))).reduce((a, b) => a + b, 0)
    const r = await run(sessions, APPLY)
    expect(r.events.wouldCreate).toBe(100); expect(r.applied).toEqual({ written: 100, skipped: 0 }); expect(await mine()).toBe(100)
    const again = await run(sessions, APPLY)
    expect(again.events).toMatchObject({ wouldCreate: 0, wouldUpdate: 0, wouldRepairSlug: 0, wouldNoop: 100 }); expect(again.applied).toEqual({ written: 0, skipped: 0 })
    expect(await mine()).toBe(100)
  })

  it('a missing slug mapping of an existing event is repaired without touching the event', async () => {
    const legacy = 'dj-' + uid(); await fbUser(legacy); const s = ses(legacy); await run([s], APPLY)
    await firestore().doc(`eventSlugs/${s.public_slug}`).delete()
    const r = await run([s], APPLY)
    expect(r.events.wouldRepairSlug).toBe(1); expect((await firestore().doc(`eventSlugs/${s.public_slug}`).get()).exists).toBe(true)
  })
})

describe('event backfill (pure)', () => {
  const pure = () => ({ ...(jest.requireActual('../eventBackfill') as typeof import('../eventBackfill')) })
  it('decideEvent: stale / noop / drift / unversioned / update', () => {
    const { decideEvent } = pure()
    const { Timestamp } = require('firebase-admin/firestore')
    const t = (s: number) => new Timestamp(s, 0)
    const f = { title: 'a' }
    expect(decideEvent(null, { version: t(5), fields: f })).toBe('create')
    expect(decideEvent({ version: t(9), content: { title: 'b' } }, { version: t(5), fields: f })).toBe('stale')
    expect(decideEvent({ version: t(5), content: { title: 'a' } }, { version: t(5), fields: f })).toBe('noop')
    expect(decideEvent({ version: t(5), content: { title: 'b' } }, { version: t(5), fields: f })).toBe('drift')
    expect(decideEvent({ version: null, content: { title: 'b' } }, { version: t(5), fields: f })).toBe('unversioned')
    expect(decideEvent({ version: t(1), content: { title: 'b' } }, { version: t(5), fields: f })).toBe('update')
    expect(decideEvent({ version: t(5), content: { title: 'a' } }, { version: t(5), fields: { ...f, screenConfig: { a: 1 } } })).toBe('update')   // additive fill
    expect(decideEvent({ version: t(9), content: { title: 'a' } }, { version: t(5), fields: { ...f, screenConfig: { a: 1 } } })).toBe('stale')
    expect(decideEvent({ version: t(5), content: { title: 'a', screenConfig: null } }, { version: t(5), fields: { ...f, screenConfig: { a: 1 } } })).toBe('drift')
  })
  it('inventoryEvents counts duplicates, invalid slugs and carried configs', () => {
    const { inventoryEvents } = pure()
    const base = { id: '1', dj_id: 'u', public_slug: 's', event_name: 'x', is_active: true, session_type: 'party', created_at: v(0), updated_at: v(1) }
    const inv = inventoryEvents([base, { ...base }, { ...base, id: '2', public_slug: 'a/b', screen_config: { a: 1 } }] as any)
    expect(inv).toMatchObject({ total: 3, duplicateIds: 1, duplicateSlugs: 1, invalidSlugs: 1, withScreenConfig: 1, distinctOwners: 1 })
  })
})
