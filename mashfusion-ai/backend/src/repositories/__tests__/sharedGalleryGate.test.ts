/**
 * MIOLOVE "Galleria condivisa" on the LEGACY Supabase photo listings (both public GET routes). Runs only with the Firestore emulator (npm run test:firebase);
 * Supabase and signed URLs are faked, Firestore is real, the routes are the real routers mounted as in app.ts.
 */
const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const d = emu ? describe : describe.skip

const SESSIONS: Record<string, { id: string; session_type: string }> = {}
jest.mock('../../config/supabase', () => {
  const chain = (table: string) => {
    const q: any = { _f: {} as Record<string, unknown> }
    q.select = () => q; q.order = () => q; q.limit = () => q
    q.eq = (k: string, v: unknown) => { q._f[k] = v; return q }
    q.maybeSingle = async () => ({ data: table === 'live_sessions' ? SESSIONS[String(q._f.public_slug)] ?? null : null })
    q.then = (res: (v: unknown) => unknown) => res({ data: table === 'live_photos' ? [{ id: 'p1', guest_name: 'G', caption: null, status: 'approved', storage_path: 'x/y.jpg', created_at: '2026-01-01' }] : [], error: null })
    return q
  }
  return { supabaseAdmin: { from: (t: string) => chain(t) } }
})
jest.mock('../../services/storage', () => ({ createWeddingPhotoSignedUrl: async (p: string) => `https://signed.example/${p}?t=1` }))

d('legacy photo listings honour the shared-gallery switch', () => {
  const express = emu ? require('express') : null
  const request = emu ? require('supertest') : null
  const { firestore } = emu ? require('../../lib/firebaseAdmin') : ({} as any)
  /** Each router alone (in app.ts both answer /api/live/public/:slug/photos and the first mounted wins): both must hold the switch. */
  const hit = (which: 'public' | 'photos', slug: string) => {
    const a = express(); a.use(express.json())
    if (which === 'public') a.use('/api/live/public', require('../../routes/livePublic').livePublicRouter)
    else a.use('/api/live', require('../../routes/livePhotos').livePhotosRouter)
    a.use((err: any, _q: any, r: any, _n: any) => r.status(err.statusCode ?? 500).json({ error: err.message }))
    return request(a).get(`/api/live/public/${slug}/photos`)
  }
  const both = (slug: string) => Promise.all([hit('public', slug), hit('photos', slug)])
  let n = 0
  async function seed(slug: string, ev: Record<string, unknown> | null, owner?: { uid: string; accountType: string }) {
    SESSIONS[slug] = { id: `sess-${slug}`, session_type: 'wedding' }
    if (ev) { const id = `ev-${slug}`; await firestore().collection('events').doc(id).set(ev); await firestore().collection('eventSlugs').doc(slug).set({ eventId: id }) }
    if (owner) await firestore().collection('users').doc(owner.uid).set({ accountType: owner.accountType })
  }

  it.each([
    ['brand miolove, switch absent', { brand: 'miolove', guestConfig: null }],
    ['brand miolove, switch false', { brand: 'miolove', guestConfig: { shared_gallery: false } }],
    ['brand miolove, switch not a real true', { brand: 'miolove', guestConfig: { shared_gallery: 'true' } }],
    ['legacy wedding recognised by accessMode', { type: 'wedding', accessMode: 'activated', guestConfig: { requests: false } }],
  ])('OFF hides the listing: %s', async (_l, ev) => {
    const slug = `gate${Date.now()}${n++}`; await seed(slug, { ownerUid: 'o1', type: 'wedding', ...ev })
    for (const r of await both(slug)) { expect(r.status).toBe(200); expect(r.body.data).toEqual([]); expect(JSON.stringify(r.body)).not.toContain('signed.example') }
  })

  it('a legacy couple-owned wedding with no brand / accessMode is a MIOLOVE album too (hidden)', async () => {
    const slug = `gate${Date.now()}${n++}`; await seed(slug, { ownerUid: 'couple1', type: 'wedding', guestConfig: null }, { uid: 'couple1', accountType: 'couple' })
    for (const r of await both(slug)) expect(r.body.data).toEqual([])
  })

  it('ON keeps serving the listing (signed URLs) on both routes', async () => {
    const slug = `gate${Date.now()}${n++}`; await seed(slug, { ownerUid: 'o1', type: 'wedding', brand: 'miolove', guestConfig: { shared_gallery: true } })
    for (const r of await both(slug)) { expect(r.body.data.length).toBe(1); expect(JSON.stringify(r.body)).toContain('signed.example') }
  })

  it('IOMIXO is untouched: an IOMIXO wedding / party event, a DJ-owned legacy event and a slug with no Firestore event are answered as before', async () => {
    const cases: Array<[string, Record<string, unknown> | null, { uid: string; accountType: string } | undefined]> = [
      ['brand iomixo wedding', { ownerUid: 'dj1', type: 'wedding', brand: 'iomixo', guestConfig: null }, undefined],
      ['party', { ownerUid: 'dj1', type: 'party', guestConfig: null }, undefined],
      ['legacy dj-owned wedding', { ownerUid: 'dj2', type: 'wedding', guestConfig: null }, { uid: 'dj2', accountType: 'dj' }],
      ['no firestore event', null, undefined],
    ]
    for (const [label, ev, owner] of cases) {
      const slug = `gate${Date.now()}${n++}`; await seed(slug, ev, owner)
      for (const r of await both(slug)) expect([label, r.status, r.body.data.length]).toEqual([label, 200, 1])
    }
  })
})
