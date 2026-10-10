/** Emulator-only (npm run test:firebase): projection of legacy polls / votes into Firestore. */
const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const d = emu ? describe : describe.skip
const repo: typeof import('../pollRepository') = emu ? require('../pollRepository') : (undefined as never)
const evRepo: typeof import('../eventRepository') = emu ? require('../eventRepository') : (undefined as never)
const { firestore } = emu ? require('../../lib/firebaseAdmin') : ({} as any)

const sid = () => `ps-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const mkEvent = async (session = sid()) => ({
  session,
  eventId: await evRepo.upsertEventFromLegacy('owner1', { id: session, public_slug: `slug-${session}`, event_name: 'x', is_active: true, session_type: 'party' } as any),
})
const poll = (session_id: string, over: Record<string, unknown> = {}) => ({
  id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, session_id, question: 'Q?', options: ['A', 'B', 'C'], is_active: true, created_at: '2026-02-01T10:00:00Z', ...over,
})
const pollDocs = async (eventId: string) => (await firestore().collection('events').doc(eventId).collection('polls').get()).docs
const legacyShard = async (pollRef: any) => (await pollRef.collection('tally').doc('legacy').get()).data()?.counts

d('pollRepository projection (Firestore emulator)', () => {
  it('projects a poll (open/closed, options as strings, idempotent) and its status changes', async () => {
    const { session, eventId } = await mkEvent(); const p = poll(session)
    expect(await repo.projectPollCreated(p as any)).toBe(true)
    expect(await repo.projectPollCreated(p as any)).toBe(false)
    let docs = await pollDocs(eventId)
    expect(docs).toHaveLength(1)
    expect(docs[0].data()).toMatchObject({ question: 'Q?', options: ['A', 'B', 'C'], status: 'open', legacySupabaseId: p.id })
    expect(await repo.projectPollActive(session, p.id, false)).toBe(true)
    docs = await pollDocs(eventId); expect(docs[0].data().status).toBe('closed')
    expect(await repo.projectPollActive(session, p.id, true)).toBe(true)
    expect((await pollDocs(eventId))[0].data().status).toBe('open')
  })

  it('folds legacy-route votes into the `legacy` tally shard (first vote, change, same option)', async () => {
    const { session, eventId } = await mkEvent(); const p = poll(session)
    await repo.projectPollCreated(p as any)
    const ref = (await pollDocs(eventId))[0].ref
    await repo.projectLegacyVote(session, p.id, null, 1)
    await repo.projectLegacyVote(session, p.id, null, 1)
    expect(await legacyShard(ref)).toMatchObject({ o1: 2 })
    await repo.projectLegacyVote(session, p.id, 1, 2) // a client changes its vote
    expect(await legacyShard(ref)).toMatchObject({ o1: 1, o2: 1 })
    expect(await repo.projectLegacyVote(session, p.id, 2, 2)).toBe(false)
    expect(await repo.projectLegacyVote('unknown', p.id, null, 0)).toBe(false)
  })

  it('setLegacyTally replaces the shard (backfill)', async () => {
    const { session, eventId } = await mkEvent(); const p = poll(session)
    await repo.projectPollCreated(p as any)
    await repo.setLegacyTally(session, p.id, [3, 0, 7]); await repo.setLegacyTally(session, p.id, [3, 0, 7])
    expect(await legacyShard((await pollDocs(eventId))[0].ref)).toEqual({ o0: 3, o1: 0, o2: 7 })
  })

  it('deleting a session removes the event with ALL subcollections and the slug mapping', async () => {
    const { session, eventId } = await mkEvent(); const p = poll(session)
    await repo.projectPollCreated(p as any)
    const ref = (await pollDocs(eventId))[0].ref
    await ref.collection('votes').doc('u1').set({ optionIndex: 0 })
    await ref.collection('tally').doc('s0').set({ counts: { o0: 1 } })
    await firestore().collection('events').doc(eventId).collection('requestGuests').doc('u1').set({ count: 1 })
    await evRepo.deleteEventByLegacyId('owner1', session)
    expect((await firestore().collection('events').doc(eventId).get()).exists).toBe(false)
    expect((await ref.collection('votes').get()).empty).toBe(true)
    expect((await ref.collection('tally').get()).empty).toBe(true)
    expect((await firestore().collection('events').doc(eventId).collection('requestGuests').get()).empty).toBe(true)
    expect(await evRepo.getEventIdBySlug(`slug-${session}`)).toBeNull()
  })
})

export {}
