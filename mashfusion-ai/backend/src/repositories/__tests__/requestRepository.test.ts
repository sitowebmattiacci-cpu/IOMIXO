/** Emulator-only (npm run test:firebase): projection of legacy live_requests into Firestore. */
const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const d = emu ? describe : describe.skip
const reqRepo: typeof import('../requestRepository') = emu ? require('../requestRepository') : (undefined as never)
const evRepo: typeof import('../eventRepository') = emu ? require('../eventRepository') : (undefined as never)
const { firestore } = emu ? require('../../lib/firebaseAdmin') : ({} as any)

const sid = () => `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const mkEvent = async (session = sid()) => {
  const eventId = await evRepo.upsertEventFromLegacy('owner1', {
    id: session, public_slug: `slug-${session}`, event_name: 'x', is_active: true,
  } as any, { requestLimit: 30 })
  return { session, eventId }
}
const row = (session_id: string, over: Record<string, unknown> = {}) => ({
  id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, session_id, track_title: 'Song', artist: 'A', message: null, status: 'pending', created_at: '2026-02-01T10:00:00Z', ...over,
})
const counter = async (eventId: string) => (await firestore().collection('events').doc(eventId).collection('state').doc('requests').get()).data()?.total

d('requestRepository projection (Firestore emulator)', () => {
  it('projects a legacy request (guestUid null), idempotently, and skips unknown sessions', async () => {
    const { session, eventId } = await mkEvent()
    const r = row(session)
    expect(await reqRepo.projectRequestCreated(r as any)).toBe(true)
    expect(await reqRepo.projectRequestCreated(r as any)).toBe(false)
    const docs = await firestore().collection('events').doc(eventId).collection('requests').get()
    expect(docs.size).toBe(1)
    expect(docs.docs[0].data()).toMatchObject({ guestUid: null, songTitle: 'Song', status: 'pending', legacySupabaseId: r.id })
    expect(await reqRepo.projectRequestCreated(row('unknown-session') as any)).toBe(false)
  })

  it('keeps an existing counter in step on create/delete, never creates one by itself', async () => {
    const { session, eventId } = await mkEvent()
    const a = row(session), b = row(session)
    await reqRepo.projectRequestCreated(a as any)
    expect(await counter(eventId)).toBeUndefined()
    await firestore().collection('events').doc(eventId).collection('state').doc('requests').set({ total: 1 })
    await reqRepo.projectRequestCreated(b as any)
    expect(await counter(eventId)).toBe(2)
    expect(await reqRepo.projectRequestDeleted(session, a.id)).toBe(true)
    expect(await counter(eventId)).toBe(1)
  })

  it('projects status changes from moderation routes', async () => {
    const { session, eventId } = await mkEvent()
    const r = row(session); await reqRepo.projectRequestCreated(r as any)
    expect(await reqRepo.projectRequestStatus(session, r.id, 'approved')).toBe(true)
    const q = await firestore().collection('events').doc(eventId).collection('requests').where('legacySupabaseId', '==', r.id).get()
    expect(q.docs[0].data().status).toBe('approved')
    expect(await reqRepo.projectRequestStatus(session, 'missing', 'rejected')).toBe(false)
  })

  it('event projection stores requestLimit set by the server', async () => {
    const { eventId } = await mkEvent()
    expect((await firestore().collection('events').doc(eventId).get()).data().requestLimit).toBe(30)
  })
})

export {}
