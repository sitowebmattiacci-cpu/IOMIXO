import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser } from 'playwright-core'
import { startFakeRender, startNext, launch, type FakeRender, type App } from './harness'
import { seedSet, eventFields } from '../firebase/seed'

let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render); browser = await launch() })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

let n = 0
async function seedScreenEvent(over: Record<string, unknown> = {}, planTier = 'wedding') {
  const owner = `sown${Date.now()}${n++}`, id = `sev${Date.now()}${n}`, slug = `sslug${Date.now()}${n}`
  await seedSet(`users/${owner}`, { uid: owner, plan: { tier: planTier, source: 'legacy' } })
  await seedSet(`events/${id}`, eventFields(owner, slug, { type: 'wedding', title: 'Schermo Firestore', coupleNames: 'Anna & Marco', legacySupabaseId: `legacy-${id}`, ...over }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  return { owner, id, slug }
}
const legacyScreen = (name: string) => ({
  session: { event_name: name, dj_name: 'DJ', session_type: 'wedding', couple_names: 'Legacy & Couple', wedding_date: null, venue_name: null, is_active: true, screen_config: { show_dedications: true } },
  roulette: null, shoe_game: null, active_poll: null, dedications: [{ id: 'l1', guest_name: 'Ospite', message: 'Messaggio dal percorso legacy', status: 'approved', created_at: new Date().toISOString() }], photos: [],
})
const screenCalls = () => render.calls.filter((c) => /\/public\/.+\/screen$/.test(c.path))

test('S1. screen/[slug] renders entirely from Firestore (event, approved dedications, live poll + tally) with Render down', async () => {
  const e = await seedScreenEvent({ screenConfig: { show_dedications: true, show_polls: true } })
  await seedSet(`events/${e.id}/dedications/d1`, { senderName: 'Zia Rosa', message: 'Tanti auguri sposi', status: 'approved', createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${e.id}/dedications/d2`, { senderName: 'Segreta', message: 'Messaggio NON approvato', status: 'pending', createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${e.id}/polls/p1`, { question: 'Quale canzone per il taglio della torta?', options: ['Alfa', 'Beta'], status: 'open', createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${e.id}/polls/p1/tally/s0`, { counts: { o0: 3, o1: 1 } })
  render.calls.length = 0
  const page = await (await browser.newContext()).newPage(); const errors: string[] = []; page.on('pageerror', (x) => errors.push(x.message))
  await page.goto(`${app.url}/screen/${e.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByText('Tanti auguri sposi').first().waitFor({ timeout: 60_000 })
  await page.getByText('Quale canzone per il taglio della torta?').first().waitFor({ timeout: 30_000 })
  assert.equal(await page.getByText('Messaggio NON approvato').count(), 0, 'pending dedications must never reach the TV')
  assert.equal(await page.getByText('Sessione non trovata').count(), 0)
  await page.screenshot({ path: `/tmp/claude-501/screen-${Date.now()}.png` })
  assert.equal(screenCalls().length, 0, 'no legacy /screen call: Firestore served the whole payload')
  // realtime: a new approved dedication appears without reload
  await seedSet(`events/${e.id}/dedications/d3`, { senderName: 'Nonno', message: 'Nuova dedica in tempo reale', status: 'approved', createdAt: new Date(), updatedAt: new Date() })
  await page.getByText('Nuova dedica in tempo reale').first().waitFor({ timeout: 20_000 })
  assert.deepEqual(errors, [])
})

test('S2. explicit legacy fallback: show_photos, winner announcement, missing config, Free plan → the page uses the legacy payload (no crash, no blank)', async () => {
  render.routes.set('GET /api/live/public/*', (c) => (c.path.endsWith('/screen') ? legacyScreen(`LEGACY ${c.path.split('/').at(-2)}`) : null))
  const cases: Array<[string, Record<string, unknown>, string?]> = [
    ['photos', { screenConfig: { show_dedications: true, show_photos: true } }],
    ['winner', { screenConfig: { show_dedications: true, winner_announcement: { enabled: true, groom_photo_path: 'x/g.jpg' } } }],
    ['no config', {}],
    ['null config', { screenConfig: null }],
    ['free plan', { screenConfig: { show_dedications: true } }, 'free'],
  ]
  for (const [label, over, tier] of cases) {
    const e = await seedScreenEvent(over, tier)
    render.calls.length = 0
    const page = await (await browser.newContext()).newPage(); const errors: string[] = []; page.on('pageerror', (x) => errors.push(x.message))
    await page.goto(`${app.url}/screen/${e.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText('Messaggio dal percorso legacy').first().waitFor({ timeout: 40_000 })
    assert.ok(screenCalls().length >= 1, `${label}: the legacy /screen endpoint must be used`)
    assert.deepEqual(errors, [], label)
    await page.context().close()
  }
  render.routes.clear()
})

test('S3. historical roulette/shoe data lives in Supabase: if the screen shows games but Firestore has no round → legacy', async () => {
  render.routes.set('GET /api/live/public/*', (c) => (c.path.endsWith('/screen') ? legacyScreen('LEGACY games') : null))
  const e = await seedScreenEvent({ screenConfig: { show_dedications: true, show_roulette: true } })
  render.calls.length = 0
  const page = await (await browser.newContext()).newPage()
  await page.goto(`${app.url}/screen/${e.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByText('Messaggio dal percorso legacy').first().waitFor({ timeout: 40_000 })
  assert.ok(screenCalls().length >= 1)
  render.routes.clear()
})
