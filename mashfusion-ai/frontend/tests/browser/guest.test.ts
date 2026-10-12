import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser } from 'playwright-core'
import { startFakeRender, startNext, launch, type FakeRender, type App } from './harness'
import { seedSet, eventFields } from '../firebase/seed'

let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render); browser = await launch() })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const fsDoc = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
const fsList = async (path: string) => ((await fsDoc(path)).documents ?? []) as any[]

test('B1. guest page /live/[slug] renders from Firestore with Render down and sends a request through the callable', async () => {
  const owner = `own${Date.now()}`, id = `bev${Date.now()}`, slug = `bslug${Date.now()}`
  await seedSet(`users/${owner}`, { uid: owner, plan: { tier: 'wedding', source: 'legacy' } })
  await seedSet(`events/${id}`, eventFields(owner, slug, { type: 'party', title: 'Festa Browser Test', djName: 'DJ Browser', legacySupabaseId: `legacy-${id}` }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  const ctx = await browser.newContext(); const page = await ctx.newPage()
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${app.url}/live/${slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByText('Festa Browser Test').first().waitFor({ timeout: 60_000 })
  assert.ok(await page.getByText('DJ Browser').first().isVisible())
  await page.screenshot({ path: `/tmp/claude-501/guest-${Date.now()}.png` })
  assert.equal(render.calls.filter((c) => c.path.endsWith(`/api/live/public/${slug}`) && c.method === 'GET').length, 0, 'the public lookup must not touch Render')
  assert.deepEqual(errors, [])
  await ctx.close()
})

test('B2. guest sends a music request from the page: callable → Firestore doc (guest uid, pending); poll vote + results from Firestore; Render untouched', async () => {
  const owner = `gown${Date.now()}`, id = `gev${Date.now()}`, slug = `gslug${Date.now()}`
  await seedSet(`users/${owner}`, { uid: owner, plan: { tier: 'wedding', source: 'legacy' } })
  await seedSet(`events/${id}`, eventFields(owner, slug, { type: 'party', title: 'Festa Guest Flow', legacySupabaseId: `legacy-${id}`, guestConfig: { requests: true, music_battle: true } }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  await seedSet(`events/${id}/polls/pp1`, { question: 'Che musica ora?', options: ['Techno', 'Pop'], status: 'open', createdAt: new Date(), updatedAt: new Date() })
  render.calls.length = 0
  const page = await (await browser.newContext()).newPage(); const errors: string[] = []; page.on('pageerror', (x) => errors.push(x.message))
  await page.goto(`${app.url}/live/${slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByText('Festa Guest Flow').first().waitFor({ timeout: 60_000 })

  // music request
  await page.getByText('Richiedi una canzone').first().click()
  const inputs = page.locator('input[type="text"], input:not([type]), textarea')
  await inputs.first().waitFor({ timeout: 20_000 })
  await inputs.first().fill('Titolo Browser Test')
  await page.getByRole('button', { name: /invia|richiedi/i }).last().click()
  await page.getByText('Richiesta inviata al DJ').first().waitFor({ timeout: 30_000 }).catch(async (e) => { await page.screenshot({ path: '/tmp/claude-501/b2-request.png' }); throw e })
  const reqs = await fsList(`events/${id}/requests`)
  assert.equal(reqs.length, 1); assert.equal(reqs[0].fields.songTitle.stringValue, 'Titolo Browser Test'); assert.equal(reqs[0].fields.status.stringValue, 'pending')
  assert.ok(reqs[0].fields.guestUid.stringValue, 'guest uid comes from the anonymous token')

  // poll
  await page.getByText('Torna alle funzioni').first().click()
  await page.getByText('Vota il sondaggio').first().click()
  await page.getByText('Che musica ora?').first().waitFor({ timeout: 30_000 }).catch(async (e) => { await page.screenshot({ path: '/tmp/claude-501/b2-poll.png' }); throw e })
  await page.getByText('Techno').first().click()
  await page.waitForFunction(() => document.body.innerText.includes('Techno'), null, { timeout: 5_000 })
  const deadline = Date.now() + 20_000; let counts: any = {}
  while (Date.now() < deadline) { const shards = await fsList(`events/${id}/polls/pp1/tally`); counts = shards.reduce((a: any, s: any) => ({ ...a, ...s.fields.counts?.mapValue?.fields }), {}); if (counts.o0) break; await new Promise((r) => setTimeout(r, 400)) }
  assert.equal(counts.o0?.integerValue, '1', 'the vote reached the tally through votePoll')
  assert.deepEqual(render.calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/heartbeat')), [], 'no legacy write (request, vote): only the presence heartbeat and the initial poll lookup before realtime is ready')
  assert.deepEqual(errors, [])
})
