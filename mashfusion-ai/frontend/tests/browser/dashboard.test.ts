import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launch, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

/**
 * Dashboard cutover: NEXT_PUBLIC_FIRESTORE_DASHBOARD + OWNER_OPS + PUBLIC_READ on, and Render answers 503 to EVERYTHING (no route is registered).
 */
let render: FakeRender, app: App, browser: Browser
before(async () => {
  render = await startFakeRender()
  app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true' })
  browser = await launch()
})
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const fsDoc = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
const fsList = async (path: string) => ((await fsDoc(path)).documents ?? []) as any[]
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 20_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
const hour = 3_600_000
const mandatory = () => render.calls.filter((c) => c.path === '/user/me' || c.path === '/stripe/event-passes' || c.path === '/api/live/sessions')
const nonGet = () => render.calls.filter((c) => c.method !== 'GET')

async function login(plan: string, passes: Array<Record<string, unknown>> = [], count = 6) {
  const owner = await newClient('account')
  const stamp = Date.now()
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, displayName: 'DJ Firestore', plan: { tier: plan, source: 'legacy' }, legacySupabaseId: `sb-${stamp}`, createdAt: new Date(), updatedAt: new Date() })
  for (const [i, p] of Array.from(passes.entries())) await seedSet(`users/${owner.uid}/eventPasses/pass${i}`, { source: 'legacy', amountCents: 2900, currency: 'eur', createdAt: new Date(), legacySessionId: null, eventId: null, ...p })
  const events: Array<{ id: string; legacy: string; slug: string; title: string }> = []
  for (let i = 0; i < count; i++) {
    const id = `dev${stamp}-${i}`, slug = `dslug${stamp}-${i}`, legacy = `legacy-d${stamp}-${i}`, title = `Evento Dash ${i + 1}`
    await seedSet(`events/${id}`, eventFields(owner.uid, slug, { type: i % 2 ? 'wedding' : 'party', title, legacySupabaseId: legacy, createdAt: new Date(stamp - i * 1000), screenConfig: { show_polls: false, show_dedications: false }, guestConfig: { requests: true } }))
    await seedSet(`eventSlugs/${slug}`, { eventId: id })
    events.push({ id, legacy, slug, title })
  }
  const ctx = await browser.newContext(); const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  await page.goto(`${app.url}/login`, { waitUntil: 'networkidle', timeout: 120_000 })
  await page.waitForTimeout(1500)
  for (let attempt = 0; attempt < 8 && !/dashboard|sessions/.test(page.url()); attempt++) {
    await page.locator('input[type="email"]').fill(owner.email); await page.locator('input[type="password"]').fill('password123')
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/dashboard|sessions/, { timeout: 15_000 }).catch(() => {})
  }
  assert.match(page.url(), /dashboard|sessions/, 'login must succeed against the Auth emulator')
  return { page, ctx, owner, events }
}
const shot = (page: Page, name: string) => page.screenshot({ path: `/tmp/claude-501/dash-${name}.png` }).catch(() => {})

test('D1. wedding owner: dashboard + sessions list (6 events) + Advance plan + detail, Render 503, no mandatory Render call', async () => {
  const s = await login('wedding', [
    { status: 'active', validUntil: new Date(Date.now() + 5 * hour) },
    { status: 'expired', validUntil: new Date(Date.now() - 5 * hour) },
  ])
  try {
    render.calls.length = 0
    await s.page.goto(`${app.url}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await s.page.getByText('Advance', { exact: true }).first().waitFor({ timeout: 90_000 })
    await s.page.getByText('DJ', { exact: false }).first().waitFor({ timeout: 10_000 })        // greeting from users/{uid}.displayName
    await s.page.goto(`${app.url}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    for (const e of s.events) await s.page.getByText(e.title, { exact: true }).first().waitFor({ timeout: 60_000 })
    assert.equal(await s.page.getByText(/^Evento Dash \d$/).count(), 6, 'all 6 events listed')
    assert.equal(await s.page.locator('svg.lucide-lock').count(), 0, 'Advance owner: no event is locked')
    await s.page.getByText(s.events[1].title, { exact: true }).first().click()
    await s.page.waitForURL(new RegExp(`/sessions/${s.events[1].legacy}`), { timeout: 30_000 })
    await s.page.getByText(s.events[1].title).first().waitFor({ timeout: 60_000 })
    assert.deepEqual(mandatory(), [], 'plan, passes and sessions list never reach Render')
    assert.deepEqual(nonGet(), [])
  } catch (e) { await shot(s.page, 'd1'); throw e } finally { await s.ctx.close() }
})

test('D2. free owner: an active Event Pass unlocks premium events; an expired one does not', async () => {
  const withPass = await login('free', [{ status: 'active', validUntil: new Date(Date.now() + 5 * hour) }], 2)
  try {
    await withPass.page.goto(`${app.url}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await withPass.page.getByText('Event Pass 24H').first().waitFor({ timeout: 90_000 })
    await withPass.page.goto(`${app.url}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await withPass.page.getByText(withPass.events[0].title, { exact: true }).first().waitFor({ timeout: 60_000 })
    assert.equal(await withPass.page.locator('svg.lucide-lock').count(), 0, 'active pass → premium events open')
  } catch (e) { await shot(withPass.page, 'd2a'); throw e } finally { await withPass.ctx.close() }

  const expired = await login('free', [{ status: 'expired', validUntil: new Date(Date.now() - hour) }, { status: 'refunded', validUntil: new Date(Date.now() + 5 * hour) }], 2)
  try {
    await expired.page.goto(`${app.url}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await expired.page.getByText(expired.events[0].title, { exact: true }).first().waitFor({ timeout: 60_000 })
    await until(async () => (await expired.page.locator('svg.lucide-lock').count()) > 0, 20_000, 'premium events locked for a free account')
    assert.deepEqual(mandatory(), [])
  } catch (e) { await shot(expired.page, 'd2b'); throw e } finally { await expired.ctx.close() }
})

test('D3. detail on a 503 Render: moderate request + dedication, create/close poll, update TV config — Firestore only; guest and screen pages render', async () => {
  const s = await login('wedding', [], 2)
  const ev = s.events[1]                                  // odd index = wedding layout (tabs Dediche, Giochi...)
  await seedSet(`events/${ev.id}/requests/rq1`, { guestUid: 'anon-guest', songTitle: 'Canzone da moderare', artist: 'Artista X', message: null, status: 'pending', createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${ev.id}/dedications/dd1`, { senderName: 'Zia', message: 'Dedica da moderare', status: 'pending', createdAt: new Date(), updatedAt: new Date() })
  try {
    render.calls.length = 0
    await s.page.goto(`${app.url}/sessions/${ev.legacy}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await s.page.getByText('Canzone da moderare').first().waitFor({ timeout: 90_000 })
    await s.page.getByRole('button', { name: /Approva/ }).first().click()
    await until(async () => (await fsDoc(`events/${ev.id}/requests/rq1`)).fields?.status?.stringValue === 'approved', 20_000, 'request approved')

    await s.page.getByRole('button', { name: /Dediche/ }).first().click()
    await s.page.getByText('Dedica da moderare').first().waitFor({ timeout: 60_000 })
    await s.page.locator('button[title="Approva"]').first().click()
    await until(async () => (await fsDoc(`events/${ev.id}/dedications/dd1`)).fields?.status?.stringValue === 'approved', 20_000, 'dedication approved')

    await s.page.getByRole('button', { name: /Giochi/ }).first().click()
    const q = s.page.getByPlaceholder('Domanda'); await q.waitFor({ timeout: 60_000 })
    await q.fill('Torta?'); await s.page.getByPlaceholder('Opzione 1').fill('Si'); await s.page.getByPlaceholder('Opzione 2').fill('No')
    await s.page.locator('form', { has: q }).getByRole('button', { name: 'Invia' }).click()
    await until(async () => (await fsList(`events/${ev.id}/polls`))[0], 20_000, 'poll created')
    await s.page.getByRole('button', { name: 'Chiudi sondaggio' }).first().click()
    await until(async () => (await fsList(`events/${ev.id}/polls`))[0]?.fields.status.stringValue === 'closed', 20_000, 'poll closed')

    await s.page.getByRole('button', { name: /Schermo live/ }).first().click({ timeout: 60_000 })
    const box = s.page.locator('label', { hasText: 'Sondaggi' }).locator('input[type="checkbox"]').first()
    await box.waitFor({ timeout: 60_000, state: 'attached' })
    await box.check({ force: true }).catch(async () => { await box.click({ force: true }) })
    await until(async () => (await fsDoc(`events/${ev.id}`)).fields?.screenConfig?.mapValue?.fields?.show_polls?.booleanValue === true, 20_000, 'screenConfig.show_polls')
    assert.deepEqual(nonGet(), [], 'no write reached Render')
    assert.deepEqual(mandatory(), [])

    const guest = await (await browser.newContext()).newPage(); await guest.goto(`${app.url}/live/${ev.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await guest.getByText(/Anna & Marco/).first().waitFor({ timeout: 60_000 })
    const tv = await (await browser.newContext()).newPage(); await tv.goto(`${app.url}/screen/${ev.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await tv.getByText(/Anna & Marco|Evento Dash 2/).first().waitFor({ timeout: 60_000 })
  } catch (e) { await shot(s.page, 'd3'); throw e } finally { await s.ctx.close() }
})
