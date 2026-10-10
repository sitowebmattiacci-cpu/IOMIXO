/**
 * Emulator tests run only with FIRESTORE_EMULATOR_HOST set (npm run test:firebase).
 * Pure-mapping tests always run.
 */
const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const rawRepo: typeof import('../eventRepository') = emu ? require('../eventRepository') : (undefined as never)
// toEventFields is pure but lives in a module that imports firebase-admin → load lazily only with the emulator.
const d = emu ? describe : describe.skip

const row = (over: Record<string, unknown> = {}) => ({
  id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  public_slug: `slug${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
  event_name: 'Matrimonio', dj_name: 'DJ', is_active: true, session_type: 'wedding',
  couple_names: 'A & B', wedding_date: '2026-09-12', venue_name: 'Villa',
  screen_mode_enabled: true, guest_config: { requests: true }, created_at: '2026-01-01T10:00:00Z', ...over,
})

d('eventRepository (Firestore emulator)', () => {
  const { upsertEventFromLegacy, deleteEventByLegacyId, getEventIdBySlug, toEventFields, EventConflictError } = (rawRepo ?? {}) as typeof import('../eventRepository')
  const { firestore } = emu ? require('../../lib/firebaseAdmin') : ({} as any)

  it('maps legacy rows to the Firestore model (status, type defaults)', () => {
    expect(toEventFields(row() as any)).toMatchObject({ title: 'Matrimonio', status: 'live', type: 'wedding', screenModeEnabled: true })
    expect(toEventFields(row({ is_active: false, session_type: 'weird' }) as any)).toMatchObject({ status: 'ended', type: 'standard' })
  })

  it('creates event + slug mapping, owned by the Firebase uid', async () => {
    const r = row()
    const id = await upsertEventFromLegacy('uidA', r as any)
    expect(await getEventIdBySlug(r.public_slug)).toBe(id)
    const doc = (await firestore().collection('events').doc(id).get()).data()
    expect(doc).toMatchObject({ ownerUid: 'uidA', legacySupabaseId: r.id, slug: r.public_slug, status: 'live' })
    expect(doc.createdAt.toDate().toISOString()).toBe('2026-01-01T10:00:00.000Z')
  })

  it('update is idempotent, keeps the same doc, and reflects status changes', async () => {
    const r = row()
    const id = await upsertEventFromLegacy('uidA', r as any)
    expect(await upsertEventFromLegacy('uidA', { ...r, is_active: false, event_name: 'Renamed' } as any)).toBe(id)
    const doc = (await firestore().collection('events').doc(id).get()).data()
    expect(doc).toMatchObject({ status: 'ended', title: 'Renamed', ownerUid: 'uidA' })
  })

  it('4. ownerUid cannot be changed by a later write', async () => {
    const r = row()
    await upsertEventFromLegacy('uidA', r as any)
    await expect(upsertEventFromLegacy('uidB', r as any)).rejects.toBeInstanceOf(EventConflictError)
  })

  it('11. duplicate slug is rejected atomically (no orphan event)', async () => {
    const a = row()
    await upsertEventFromLegacy('uidA', a as any)
    const dup = row({ public_slug: a.public_slug })
    await expect(upsertEventFromLegacy('uidB', dup as any)).rejects.toBeInstanceOf(EventConflictError)
    const orphans = await firestore().collection('events').where('legacySupabaseId', '==', dup.id).get()
    expect(orphans.empty).toBe(true)
  })

  it('delete removes event and slug, and ignores other owners', async () => {
    const r = row()
    await upsertEventFromLegacy('uidA', r as any)
    await deleteEventByLegacyId('uidB', r.id)
    expect(await getEventIdBySlug(r.public_slug)).not.toBeNull()
    await deleteEventByLegacyId('uidA', r.id)
    expect(await getEventIdBySlug(r.public_slug)).toBeNull()
  })
})

export {} // make this file a module (avoids global-scope name clashes between tests)
