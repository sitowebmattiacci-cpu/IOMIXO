/** Emulator-only (npm run test:firebase): projection of legacy live_dedications into Firestore. */
const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const d = emu ? describe : describe.skip
const repo: typeof import('../dedicationRepository') = emu ? require('../dedicationRepository') : (undefined as never)
const evRepo: typeof import('../eventRepository') = emu ? require('../eventRepository') : (undefined as never)
const { firestore } = emu ? require('../../lib/firebaseAdmin') : ({} as any)

const sid = () => `ds-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const mkEvent = async (session = sid()) => ({
  session,
  eventId: await evRepo.upsertEventFromLegacy('owner1', { id: session, public_slug: `slug-${session}`, event_name: 'x', is_active: true, session_type: 'wedding' } as any, { dedicationsEnabled: true }),
})
const row = (session_id: string, over: Record<string, unknown> = {}) => ({
  id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, session_id, guest_name: 'Zio', message: 'Auguri', status: 'pending', created_at: '2026-02-01T10:00:00Z', ...over,
})
const docsOf = async (eventId: string) => (await firestore().collection('events').doc(eventId).collection('dedications').get()).docs

d('dedicationRepository projection (Firestore emulator)', () => {
  it('17. projects creation (idempotent, no guestUid, no counter) and skips unknown sessions', async () => {
    const { session, eventId } = await mkEvent(); const r = row(session)
    expect(await repo.projectDedicationCreated(r as any)).toBe(true)
    expect(await repo.projectDedicationCreated(r as any)).toBe(false)
    const docs = await docsOf(eventId)
    expect(docs).toHaveLength(1)
    expect(docs[0].data()).toMatchObject({ senderName: 'Zio', message: 'Auguri', status: 'pending', legacySupabaseId: r.id })
    expect('guestUid' in docs[0].data()).toBe(false)
    expect((await firestore().collection('events').doc(eventId).collection('state').get()).empty).toBe(true)
    expect(await repo.projectDedicationCreated(row('unknown') as any)).toBe(false)
  })

  it('17. projects status changes coming from the moderation routes', async () => {
    const { session, eventId } = await mkEvent(); const r = row(session)
    await repo.projectDedicationCreated(r as any)
    expect(await repo.projectDedicationStatus(session, r.id, 'approved')).toBe(true)
    expect((await docsOf(eventId))[0].data().status).toBe('approved')
    expect(await repo.projectDedicationStatus(session, 'missing', 'rejected')).toBe(false)
  })

  it('18. projects deletion', async () => {
    const { session, eventId } = await mkEvent(); const r = row(session)
    await repo.projectDedicationCreated(r as any)
    expect(await repo.projectDedicationDeleted(session, r.id)).toBe(true)
    expect(await docsOf(eventId)).toHaveLength(0)
    expect(await repo.projectDedicationDeleted(session, r.id)).toBe(false)
  })

  it('event projection stores the server-computed dedicationsEnabled flag', async () => {
    const { eventId } = await mkEvent()
    expect((await firestore().collection('events').doc(eventId).get()).data().dedicationsEnabled).toBe(true)
  })
})

export {}
