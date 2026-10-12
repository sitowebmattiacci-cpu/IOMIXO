import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launch, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render); browser = await launch() })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const fsDoc = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
const fsList = async (path: string) => ((await fsDoc(path)).documents ?? []) as any[]
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 20_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
const writes = () => render.calls.filter((c) => c.method !== 'GET')

async function ownerSession() {
  const owner = await newClient('account')                              // Auth-emulator account (email + password123)
  const stamp = Date.now(), legacy = `legacy-own-${stamp}`, id = `oev-b${stamp}`, slug = `oslug${stamp}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, plan: { tier: 'wedding', source: 'legacy' } })
  await seedSet(`events/${id}`, eventFields(owner.uid, slug, { type: 'wedding', title: 'Matrimonio Browser', legacySupabaseId: legacy, screenConfig: { show_polls: false, show_dedications: false }, guestConfig: { requests: true } }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  await seedSet(`events/${id}/requests/rq1`, { guestUid: 'anon-guest', songTitle: 'Canzone da moderare', artist: 'Artista X', message: null, status: 'pending', createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${id}/dedications/dd1`, { senderName: 'Zia', message: 'Dedica da moderare', status: 'pending', createdAt: new Date(), updatedAt: new Date() })
  const session = { id: legacy, dj_id: 'legacy-dj', event_name: 'Matrimonio Browser', dj_name: 'DJ', description: null, is_active: true, public_slug: slug, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    session_type: 'wedding', couple_names: 'Anna & Marco', wedding_date: null, venue_name: null, screen_mode_enabled: true, screen_config: { show_polls: false, show_dedications: false }, guest_config: { requests: true } }
  render.routes.set('GET /user/me', () => ({ id: 'legacy-dj', email: owner.email, plan: 'wedding', full_name: 'DJ Test', created_at: new Date().toISOString() }))
  render.routes.set('GET /stripe/event-passes', () => [])
  render.routes.set(`GET /api/live/sessions/${legacy}`, () => session)
  const ctx = await browser.newContext(); const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  const consoleMsgs: string[] = []; page.on('console', (m) => consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 160)))
  await page.goto(`${app.url}/login`, { waitUntil: 'networkidle', timeout: 120_000 })
  await page.waitForTimeout(1500)                                   // let React hydrate before typing (dev server)
  // The first request after the dev server starts compiles the route: React may hydrate after the first fill → retry until the form really submits.
  for (let attempt = 0; attempt < 8 && !/dashboard|sessions/.test(page.url()); attempt++) {
    await page.locator('input[type="email"]').fill(owner.email); await page.locator('input[type="password"]').fill('password123')
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/dashboard|sessions/, { timeout: 15_000 }).catch(() => {})
  }
  assert.match(page.url(), /dashboard|sessions/, 'login must succeed against the Auth emulator')
  render.calls.length = 0
  await page.goto(`${app.url}/sessions/${legacy}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  return { page, ctx, id, legacy, slug }
}
const shot = (page: Page, name: string) => page.screenshot({ path: `/tmp/claude-501/owner-${name}.png` }).catch(() => {})

test('O1. owner moderates a music request from the dashboard: Firestore status changes, nothing is written to Render', async () => {
  const s = await ownerSession()
  try {
    await s.page.getByText('Canzone da moderare').first().waitFor({ timeout: 90_000 })
    await s.page.getByRole('button', { name: /Approva/ }).first().click()
    await until(async () => (await fsDoc(`events/${s.id}/requests/rq1`)).fields?.status?.stringValue === 'approved', 20_000, 'request approved')
    await s.page.getByRole('button', { name: /Rifiuta/ }).first().click()
    await until(async () => (await fsDoc(`events/${s.id}/requests/rq1`)).fields?.status?.stringValue === 'rejected', 20_000, 'request rejected')
    await s.page.locator('div.rounded-\\[18px\\]', { hasText: 'Canzone da moderare' }).getByRole('button', { name: /Elimina/ }).click()      // the REQUEST card, not the session's own Elimina
    await until(async () => (await fsList(`events/${s.id}/requests`)).length === 0, 20_000, 'request deleted')
    assert.deepEqual(writes(), [], 'no PATCH/DELETE/POST reached Render')
  } catch (e) { await shot(s.page, 'o1'); throw e } finally { await s.ctx.close() }
})

test('O2. owner moderates a dedication (approve → public wall, reject, delete) from the dashboard', async () => {
  const s = await ownerSession()
  try {
    await s.page.getByRole('button', { name: /Dediche/ }).first().click()
    await s.page.getByText('Dedica da moderare').first().waitFor({ timeout: 90_000 })
    await s.page.locator('button[title="Approva"]').first().click()
    await until(async () => (await fsDoc(`events/${s.id}/dedications/dd1`)).fields?.status?.stringValue === 'approved', 20_000, 'dedication approved')
    await s.page.locator('button[title="Rifiuta"]').first().click()
    await until(async () => (await fsDoc(`events/${s.id}/dedications/dd1`)).fields?.status?.stringValue === 'rejected', 20_000, 'dedication rejected')
    await s.page.locator('button[title="Elimina"]').first().click()
    await until(async () => (await fsList(`events/${s.id}/dedications`)).length === 0, 20_000, 'dedication deleted')
    assert.deepEqual(writes(), [])
  } catch (e) { await shot(s.page, 'o2'); throw e } finally { await s.ctx.close() }
})

test('O3. owner creates a poll, then closes it, from the dashboard (Firestore-native poll)', async () => {
  const s = await ownerSession()
  try {
    await s.page.getByRole('button', { name: /Giochi/ }).first().click()
    const q = s.page.getByPlaceholder('Domanda'); await q.waitFor({ timeout: 90_000 })
    await q.fill('Torta: cioccolato o frutta?')
    await s.page.getByPlaceholder('Opzione 1').fill('Cioccolato'); await s.page.getByPlaceholder('Opzione 2').fill('Frutta')
    await s.page.locator('form', { has: q }).getByRole('button', { name: 'Invia' }).click()
    const poll = await until(async () => (await fsList(`events/${s.id}/polls`))[0], 20_000, 'poll created')
    assert.equal(poll.fields.status.stringValue, 'open'); assert.equal(poll.fields.question.stringValue, 'Torta: cioccolato o frutta?')
    assert.ok(!poll.fields.legacySupabaseId, 'native poll: no Supabase id')
    await s.page.getByText('Torta: cioccolato o frutta?').first().waitFor({ timeout: 20_000 })
    await s.page.getByRole('button', { name: 'Chiudi sondaggio' }).first().click()
    await until(async () => (await fsList(`events/${s.id}/polls`))[0]?.fields.status.stringValue === 'closed', 20_000, 'poll closed')
    assert.deepEqual(writes(), [])
  } catch (e) { await shot(s.page, 'o3'); throw e } finally { await s.ctx.close() }
})

test('O4. owner toggles a TV section: screenConfig is written to Firestore ONLY (no PATCH to Render) and the dashboard keeps showing it', async () => {
  const s = await ownerSession()
  try {
    await s.page.getByRole('button', { name: /Schermo live/ }).first().click({ timeout: 90_000 })      // opens the TV visibility panel
    const box = s.page.locator('label', { hasText: 'Sondaggi' }).locator('input[type="checkbox"]').first()
    await box.waitFor({ timeout: 90_000, state: 'attached' })
    await box.check({ force: true }).catch(async () => { await box.click({ force: true }) })
    const cfg = await until(async () => {
      const f = (await fsDoc(`events/${s.id}`)).fields?.screenConfig?.mapValue?.fields
      return f?.show_polls?.booleanValue === true ? f : undefined
    }, 20_000, 'screenConfig.show_polls = true')
    assert.equal(cfg.show_dedications.booleanValue, false, 'the other toggles keep their value')
    assert.deepEqual(writes(), [], 'config is Firestore-authoritative: Render must not receive the PATCH')
    await until(async () => await box.isChecked(), 20_000, 'dashboard shows the saved toggle (Firestore overlay on the legacy session)')
  } catch (e) { await shot(s.page, 'o4'); throw e } finally { await s.ctx.close() }
})
