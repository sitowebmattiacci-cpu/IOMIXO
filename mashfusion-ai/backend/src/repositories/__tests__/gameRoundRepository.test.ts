/** Emulator-only (npm run test:firebase): versioned projection of live_game_rounds into events/{id}/games/{roundId}. */
export {}
const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const d = emu ? describe : describe.skip
const repo: typeof import('../gameRoundRepository') = emu ? require('../gameRoundRepository') : (undefined as never)
const evRepo: typeof import('../eventRepository') = emu ? require('../eventRepository') : (undefined as never)
const { firestore } = emu ? require('../../lib/firebaseAdmin') : ({} as any)

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const mkEvent = async () => {
  const session = `gs-${uid()}`
  const eventId = await evRepo.upsertEventFromLegacy('owner1', { id: session, public_slug: `slug-${session}`, event_name: 'x', is_active: true, session_type: 'wedding' } as any)
  return { session, eventId }
}
/** Postgres-style timestamptz text with microseconds: v(n) is strictly increasing in n. */
const v = (n: number) => `2026-02-01T10:00:00.${String(100000 + n).padStart(6, '0')}+00:00`
const CREATED = '2026-02-01T09:59:59.123456+00:00'
const round = (session_id: string, over: Record<string, unknown> = {}) => ({
  id: `r-${uid()}`, session_id, game_type: 'wedding_roulette', status: 'idle' as const,
  config: { penitenze: [{ label: 'A', category: 'soft', enabled: true }], categories: ['soft'] }, result: null,
  created_at: CREATED, updated_at: v(0), ...over,
})
const shoe = (session_id: string, idx: number, over: Record<string, unknown> = {}) => round(session_id, {
  game_type: 'shoe_game', status: 'running', config: { questions: ['q1', 'q2', 'q3'], current_index: idx, is_active: true }, updated_at: v(idx), ...over,
})
const games = async (eventId: string) => (await firestore().collection('events').doc(eventId).collection('games').get()).docs
const read = async (eventId: string, id: string) => (await firestore().collection('events').doc(eventId).collection('games').doc(id).get()).data()
const shuffle = <T,>(a: T[]) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]] } return r }

d('gameRoundRepository versioned projection (Firestore emulator)', () => {
  jest.setTimeout(60_000)
  it('creates a round keyed by the Supabase id, verbatim config/result, DB created_at and source version', async () => {
    const { session, eventId } = await mkEvent(); const r = round(session)
    expect(await repo.projectGameRound(r as any)).toBe('created')
    const docs = await games(eventId)
    expect(docs).toHaveLength(1); expect(docs[0].id).toBe(r.id)
    const data = docs[0].data()
    expect(data).toMatchObject({ type: 'wedding_roulette', status: 'idle', config: r.config, result: null, legacySupabaseId: r.id })
    expect(data.createdAt.seconds).toBe(Math.floor(Date.parse('2026-02-01T09:59:59Z') / 1000)); expect(data.createdAt.nanoseconds).toBe(123456000)
    expect(data.sourceUpdatedAt.nanoseconds).toBe(100000000 + 0 * 1000 + 0) // .100000
    expect(data.updatedAt).toBeDefined()
  })

  it('1. newer update after older → newer wins', async () => {
    const { session, eventId } = await mkEvent(); const r = round(session)
    await repo.projectGameRound(r as any)
    expect(await repo.projectGameRound({ ...r, status: 'completed', result: { slot_label: 'A' }, updated_at: v(5) } as any)).toBe('applied')
    expect(await read(eventId, r.id)).toMatchObject({ status: 'completed', result: { slot_label: 'A' } })
  })

  it('2. older update after newer → ignored, state untouched, payload-free structured log', async () => {
    const { session, eventId } = await mkEvent(); const r = round(session)
    await repo.projectGameRound({ ...r, status: 'completed', result: { slot_label: 'NEW' }, updated_at: v(9) } as any)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await repo.projectGameRound({ ...r, status: 'running', result: { slot_label: 'OLD-SECRET' }, updated_at: v(3) } as any)).toBe('stale_ignored')
    expect(await read(eventId, r.id)).toMatchObject({ status: 'completed', result: { slot_label: 'NEW' } })
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes('stale_ignored'))!
    expect(JSON.parse(line)).toEqual({ projection: 'games', result: 'stale_ignored', eventId, roundId: r.id })
    expect(line).not.toContain('OLD-SECRET'); warn.mockRestore()
  })

  it('microsecond precision: two versions inside the same millisecond are still ordered', async () => {
    const { session, eventId } = await mkEvent(); const r = round(session)
    await repo.projectGameRound({ ...r, config: { n: 1 }, updated_at: '2026-02-01T10:00:00.123456+00:00' } as any)
    expect(await repo.projectGameRound({ ...r, config: { n: 0 }, updated_at: '2026-02-01T10:00:00.123455+00:00' } as any)).toBe('stale_ignored')
    expect(await repo.projectGameRound({ ...r, config: { n: 2 }, updated_at: '2026-02-01T10:00:00.123457+00:00' } as any)).toBe('applied')
    expect((await read(eventId, r.id)).config).toEqual({ n: 2 })
  })

  it('3. same updated_at repeated → idempotent no-op', async () => {
    const { session, eventId } = await mkEvent(); const r = round(session, { status: 'running', updated_at: v(4) })
    expect(await repo.projectGameRound(r as any)).toBe('created')
    const first = (await read(eventId, r.id)).updatedAt
    for (let i = 0; i < 3; i++) expect(await repo.projectGameRound(r as any)).toBe('duplicate')
    const after = await read(eventId, r.id)
    expect(after.updatedAt.isEqual(first)).toBe(true); expect(after.status).toBe('running')
    expect(await games(eventId)).toHaveLength(1)
  })

  it('4. 50 concurrent old/new pairs (random issue order) → final state is ALWAYS the new one', async () => {
    const { session, eventId } = await mkEvent()
    // 50 distinct rounds raced in parallel (a contended pair on the SAME doc costs seconds of lock wait on the emulator).
    const outcomes = await Promise.all(Array.from({ length: 50 }, async () => {
      const r = round(session, { game_type: 'shoe_game', status: 'running', config: { questions: ['a', 'b'], current_index: 0, is_active: true } })
      await repo.projectGameRound(r as any)
      const oldU = { ...r, config: { ...r.config, current_index: 1 }, updated_at: v(1) }
      const newU = { ...r, config: { ...r.config, current_index: 2 }, updated_at: v(2) }
      await Promise.all(shuffle([oldU, newU]).map((u) => repo.projectGameRound(u as any)))
      return ((await read(eventId, r.id)).config as any).current_index
    }))
    expect(outcomes.filter((i) => i !== 2)).toHaveLength(0)
    expect(outcomes).toHaveLength(50)
  })

  it('5. DJ start bulk: closing rows are versioned per round; a stale bulk never overwrites a newer projection', async () => {
    const { session, eventId } = await mkEvent()
    const a = round(session, { status: 'running', result: { slot_label: 'x' }, updated_at: v(1) }), b = round(session, { updated_at: v(1) })
    await repo.projectGameRounds([a, b] as any)
    // a was spun again (v7) before the slow "start" bulk arrives with its closing versions (v5)
    await repo.projectGameRound({ ...a, status: 'completed', result: { slot_label: 'FINAL' }, updated_at: v(7) } as any)
    const res = await repo.projectGameRounds([{ ...a, status: 'completed', updated_at: v(5) }, { ...b, status: 'completed', updated_at: v(5) }] as any)
    expect(res).toEqual(['stale_ignored', 'applied'])
    expect(await read(eventId, a.id)).toMatchObject({ status: 'completed', result: { slot_label: 'FINAL' } })
    expect(await read(eventId, b.id)).toMatchObject({ status: 'completed' })
    const next = round(session, { updated_at: v(6) }); await repo.projectGameRound(next as any)
    expect((await games(eventId)).length).toBe(3)
  })

  it('6. remote start: createdAt is the DB created_at (not the Node clock)', async () => {
    const { session, eventId } = await mkEvent()
    const r = round(session, { created_at: '2026-01-05T08:00:00.000321+00:00', updated_at: '2026-01-05T08:00:00.000321+00:00' })
    await repo.projectGameRound(r as any)
    const c = (await read(eventId, r.id)).createdAt
    expect(new Date(c.seconds * 1000).toISOString()).toBe('2026-01-05T08:00:00.000Z'); expect(c.nanoseconds).toBe(321000)
  })

  it('7. spin / reset racing in both orders → the later DB version wins', async () => {
    const { session, eventId } = await mkEvent()
    const bad = await Promise.all(Array.from({ length: 20 }, async () => {
      const r = round(session)
      await repo.projectGameRound(r as any)
      const spin = { ...r, status: 'running', result: { slot_label: 'S' }, updated_at: v(1) }
      const reset = { ...r, status: 'idle', result: null, updated_at: v(2) }
      await Promise.all(shuffle([spin, reset]).map((u) => repo.projectGameRound(u as any)))
      const s = await read(eventId, r.id); return s.status !== 'idle' || s.result !== null
    }))
    expect(bad.filter(Boolean)).toHaveLength(0)
  })

  it('first creation raced by two writers (never seen before): terminates and ends on the newer version', async () => {
    const { session, eventId } = await mkEvent(); const r = round(session)
    const t0 = Date.now()
    await Promise.all(shuffle([{ ...r, updated_at: v(1) }, { ...r, updated_at: v(2) }]).map((u) => repo.projectGameRound(u as any)))
    console.log(`first-creation race took ${Date.now() - t0} ms`)
    const s = await read(eventId, r.id)
    expect(s.sourceUpdatedAt.nanoseconds).toBe(100000000 + 2000)
  })

  it('8. consecutive shoe "next" presses applied in any order → highest index wins', async () => {
    const { session, eventId } = await mkEvent(); const base = shoe(session, 0)
    await repo.projectGameRound(base as any)
    const steps = Array.from({ length: 10 }, (_, i) => shoe(session, i + 1, { id: base.id }))
    await Promise.all(shuffle(steps).map((u) => repo.projectGameRound(u as any)))
    expect(((await read(eventId, base.id)).config as any).current_index).toBe(10)
  })

  it('9. non-existent event / unknown type / missing versions → nothing is written', async () => {
    const { session, eventId } = await mkEvent()
    expect(await repo.projectGameRound(round(`nope-${uid()}`) as any)).toBe('no_event')
    expect(await repo.projectGameRound(round(session, { game_type: 'stand_up' }) as any)).toBe('invalid')
    expect(await repo.projectGameRound(round(session, { status: 'weird' }) as any)).toBe('invalid')
    expect(await repo.projectGameRound(round(session, { updated_at: undefined }) as any)).toBe('invalid')
    expect(await repo.projectGameRound(round(session, { created_at: 'yesterday' }) as any)).toBe('invalid')
    expect(await games(eventId)).toHaveLength(0)
  })

  it('a doc projected before versioning existed (no sourceUpdatedAt) is overwritten by the first versioned row', async () => {
    const { session, eventId } = await mkEvent(); const r = round(session)
    await firestore().collection('events').doc(eventId).collection('games').doc(r.id).set({ type: 'wedding_roulette', status: 'idle', config: null, result: null, legacySupabaseId: r.id })
    expect(await repo.projectGameRound({ ...r, status: 'running', updated_at: v(1) } as any)).toBe('applied')
    expect((await read(eventId, r.id)).sourceUpdatedAt).toBeDefined()
  })

  it('deleting the session removes its games (no orphans)', async () => {
    const { session, eventId } = await mkEvent()
    await repo.projectGameRound(round(session) as any)
    await evRepo.deleteEventByLegacyId('owner1', session)
    expect((await firestore().collection('events').doc(eventId).collection('games').get()).size).toBe(0)
  })
})
