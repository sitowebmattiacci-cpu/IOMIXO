const upsert = jest.fn()
const del = jest.fn()
jest.mock('../../lib/firebaseAdmin', () => ({ isFirebaseAuthConfigured: () => true }))
const getEffectivePlan = jest.fn()
const hasEventAccess = jest.fn()
jest.mock('../plan', () => ({ getEffectivePlan, hasEventAccess }))
const pollRepo = { projectPollCreated: jest.fn(), projectPollActive: jest.fn(), projectLegacyVote: jest.fn() }
jest.mock('../../repositories/pollRepository', () => pollRepo)
jest.mock('../../repositories/eventRepository', () => ({ upsertEventFromLegacy: upsert, deleteEventByLegacyId: del }))

import { projectSession, projectSessionDeleted, projectPollCreated, projectPollActive, projectLegacyVote } from '../eventProjection'

const req = (user: object) => ({ user }) as any
const row = { id: 's1', public_slug: 'abc', event_name: 'x', is_active: true }

beforeEach(() => { upsert.mockReset(); del.mockReset(); delete process.env.FIRESTORE_EVENT_PROJECTION })

describe('eventProjection (transitional, flag-gated)', () => {
  it('does nothing unless FIRESTORE_EVENT_PROJECTION=on', async () => {
    await projectSession(req({ provider: 'firebase', uid: 'u1' }), row)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('projects with the Firebase uid as owner when enabled', async () => {
    process.env.FIRESTORE_EVENT_PROJECTION = 'on'
    await projectSession(req({ provider: 'firebase', uid: 'u1', sub: 'legacy' }), row)
    expect(upsert).toHaveBeenCalledWith('u1', row, {})
    await projectSessionDeleted(req({ provider: 'firebase', uid: 'u1' }), 's1')
    expect(del).toHaveBeenCalledWith('u1', 's1')
  })

  it('projects the DJ\'s effective-plan request limit and dedication access (server-side, never from the client)', async () => {
    process.env.FIRESTORE_EVENT_PROJECTION = 'on'
    getEffectivePlan.mockResolvedValueOnce('free'); hasEventAccess.mockResolvedValueOnce(false)
    await projectSession(req({ provider: 'firebase', uid: 'u1', requestLimit: 999, dedicationsEnabled: true }), { ...row, dj_id: 'dj1' })
    expect(upsert).toHaveBeenLastCalledWith('u1', { ...row, dj_id: 'dj1' }, { requestLimit: 30, dedicationsEnabled: false })
    getEffectivePlan.mockResolvedValueOnce('wedding'); hasEventAccess.mockResolvedValueOnce(true)
    await projectSession(req({ provider: 'firebase', uid: 'u1' }), { ...row, dj_id: 'dj1' })
    expect(upsert).toHaveBeenLastCalledWith('u1', { ...row, dj_id: 'dj1' }, { requestLimit: null, dedicationsEnabled: true })
  })

  it('skips Supabase-authenticated requests (no Firebase owner)', async () => {
    process.env.FIRESTORE_EVENT_PROJECTION = 'on'
    await projectSession(req({ provider: 'supabase', uid: 'legacy' }), row)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('never throws when the projection fails', async () => {
    process.env.FIRESTORE_EVENT_PROJECTION = 'on'
    upsert.mockRejectedValue(new Error('boom'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(projectSession(req({ provider: 'firebase', uid: 'u1' }), row)).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled(); spy.mockRestore()
  })
})

describe('poll projection (flag-gated, never throws)', () => {
  const poll = { id: 'p1', session_id: 's1', question: 'Q', options: ['a', 'b'], is_active: true }
  beforeEach(() => { Object.values(pollRepo).forEach((f) => f.mockReset()); delete process.env.FIRESTORE_EVENT_PROJECTION })

  it('does nothing when the flag is off', async () => {
    await projectPollCreated(poll); await projectPollActive('s1', 'p1', false); await projectLegacyVote('s1', 'p1', null, 0)
    Object.values(pollRepo).forEach((f) => expect(f).not.toHaveBeenCalled())
  })

  it('closes the polls the legacy route deactivated BEFORE projecting the new one', async () => {
    process.env.FIRESTORE_EVENT_PROJECTION = 'on'
    const order: string[] = []
    pollRepo.projectPollActive.mockImplementation(async (_s: string, id: string) => { order.push(`close:${id}`) })
    pollRepo.projectPollCreated.mockImplementation(async () => { order.push('create') })
    await projectPollCreated(poll, ['old1', 'old2'])
    expect(order).toEqual(['close:old1', 'close:old2', 'create'])
  })

  it('forwards status changes and legacy votes, and swallows failures', async () => {
    process.env.FIRESTORE_EVENT_PROJECTION = 'on'
    await projectPollActive('s1', 'p1', false)
    expect(pollRepo.projectPollActive).toHaveBeenCalledWith('s1', 'p1', false)
    await projectLegacyVote('s1', 'p1', 0, 1)
    expect(pollRepo.projectLegacyVote).toHaveBeenCalledWith('s1', 'p1', 0, 1)
    pollRepo.projectLegacyVote.mockRejectedValue(new Error('boom'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(projectLegacyVote('s1', 'p1', null, 0)).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled(); spy.mockRestore()
  })
})
