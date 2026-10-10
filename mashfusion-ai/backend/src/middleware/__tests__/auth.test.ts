import type { Request } from 'express'

const verifyIdToken = jest.fn()
jest.mock('../../lib/firebaseAdmin', () => ({
  isFirebaseAuthConfigured: () => true,
  firebaseAuth: () => ({ verifyIdToken }),
}))

import { requireAuth, requireAnyAuth, firebaseTokenToAuthUser } from '../auth'

const run = async (mw: typeof requireAuth, headers: Record<string, string> = {}) => {
  const req = { headers, query: {} } as unknown as Request
  const next = jest.fn()
  await mw(req, {} as any, next)
  return { req: req as any, err: next.mock.calls[0]?.[0] }
}

beforeEach(() => { verifyIdToken.mockReset(); delete process.env.SUPABASE_URL })

describe('auth middleware (Firebase)', () => {
  it('401 without token', async () => {
    const { err } = await run(requireAuth)
    expect(err.statusCode ?? err.status).toBe(401)
  })

  it('401 with invalid token (no supabase configured)', async () => {
    verifyIdToken.mockRejectedValue(new Error('bad'))
    const { err } = await run(requireAuth, { authorization: 'Bearer nope' })
    expect(err.statusCode ?? err.status).toBe(401)
  })

  it('populates req.user from a valid Firebase token', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', email: 'a@b.it', email_verified: true, firebase: { sign_in_provider: 'password' } })
    const { req, err } = await run(requireAuth, { authorization: 'Bearer ok' })
    expect(err).toBeUndefined()
    expect(req.user).toMatchObject({ uid: 'u1', sub: 'u1', email: 'a@b.it', emailVerified: true, isAnonymous: false, provider: 'firebase' })
  })

  it('requireAuth rejects anonymous tokens with 403, requireAnyAuth accepts them', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'g1', firebase: { sign_in_provider: 'anonymous' } })
    const a = await run(requireAuth, { authorization: 'Bearer anon' })
    expect(a.err.statusCode ?? a.err.status).toBe(403)
    const b = await run(requireAnyAuth, { authorization: 'Bearer anon' })
    expect(b.err).toBeUndefined()
    expect(b.req.user.isAnonymous).toBe(true)
  })

  it('maps the server-set legacyUserId claim to sub, ignores client-supplied identity', () => {
    const u = firebaseTokenToAuthUser({ uid: 'fb', legacyUserId: 'supa-uuid', firebase: { sign_in_provider: 'password' } } as any)
    expect(u.uid).toBe('fb')
    expect(u.sub).toBe('supa-uuid')
  })
})
