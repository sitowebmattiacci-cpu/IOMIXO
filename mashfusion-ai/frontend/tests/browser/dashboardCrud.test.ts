import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launch, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet } from '../firebase/seed'

/**
 * Owner cycle in the real dashboard UI: NEXT_PUBLIC_FIRESTORE_DASHBOARD on, Render 503 to everything (no route registered).
 * create (UI form) → listed → detail → close/reopen → roulette → shoe game → delete → slug unresolvable.
 */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true' }); browser = await launch() })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 20_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
const shot = (page: Page, name: string) => page.screenshot({ path: `/tmp/claude-501/crud-${name}.png` }).catch(() => {})

test('K1. create → list → detail → close/reopen → roulette → shoe → delete, all on Firestore with Render at 503', async () => {
  const owner = await newClient('account')
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  const ctx = await browser.newContext(); const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  try {
    await page.goto(`${app.url}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
    for (let attempt = 0; attempt < 8 && !/dashboard|sessions/.test(page.url()); attempt++) {
      await page.locator('input[type="email"]').fill(owner.email); await page.locator('input[type="password"]').fill('password123')
      await page.locator('button[type="submit"]').click(); await page.waitForURL(/dashboard|sessions/, { timeout: 15_000 }).catch(() => {})
    }
    assert.match(page.url(), /dashboard|sessions/)
    render.calls.length = 0

    // create (wedding) from the UI form
    await page.goto(`${app.url}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    // The create step depends on the plan having loaded when the button is clicked: retry until the Party/Wedding choice shows.
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.getByRole('button', { name: /Nuova sessione/ }).first().click({ timeout: 90_000 })
      if (await page.getByText('Wedding Edition').first().waitFor({ state: 'visible', timeout: 6_000 }).then(() => true, () => false)) break
      await page.goto(`${app.url}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    }
    await page.getByText('Wedding Edition').first().click()
    await page.locator('input[required]').first().fill('Matrimonio UI')
    await page.getByRole('button', { name: /Crea sessione/ }).click()
    await page.waitForURL(/\/sessions\/[^/]+$/, { timeout: 60_000 })
    const eventId = page.url().split('/sessions/')[1]
    const ev = await until(async () => { const d = await fsGet(`events/${eventId}`); return d.fields }, 20_000, 'event created')
    assert.equal(ev.title.stringValue, 'Matrimonio UI'); assert.equal(ev.type.stringValue, 'wedding'); assert.equal(ev.ownerUid.stringValue, owner.uid); assert.ok(!ev.legacySupabaseId)
    const slug = ev.slug.stringValue
    assert.equal((await fsGet(`eventSlugs/${slug}`)).fields.eventId.stringValue, eventId)
    await page.getByText('Matrimonio UI').first().waitFor({ timeout: 60_000 })                         // detail renders from Firestore

    // it is in the list
    await page.goto(`${app.url}/sessions`, { waitUntil: 'domcontentloaded' })
    await page.getByText('Matrimonio UI', { exact: true }).first().waitFor({ timeout: 60_000 })
    await page.getByText('Matrimonio UI', { exact: true }).first().click()
    await page.waitForURL(new RegExp(`/sessions/${eventId}`), { timeout: 30_000 })

    // close / reopen (is_active → status)
    await page.getByRole('button', { name: 'Chiudi', exact: true }).first().click({ timeout: 60_000 })
    await until(async () => (await fsGet(`events/${eventId}`)).fields.status.stringValue === 'ended', 20_000, 'status ended')
    await page.getByRole('button', { name: 'Apri', exact: true }).first().click({ timeout: 30_000 })
    await until(async () => (await fsGet(`events/${eventId}`)).fields.status.stringValue === 'live', 20_000, 'status live')

    // games tab: roulette then shoe game
    await page.getByRole('button', { name: /Giochi/ }).first().click()
    await page.getByRole('button', { name: /Avvia roulette/ }).first().click({ timeout: 60_000 })
    const roulette = await until(async () => { const l = (await fsGet(`events/${eventId}/games`)).documents ?? []; return l.find((d: any) => d.fields.type.stringValue === 'wedding_roulette' && d.fields.status.stringValue === 'completed' && d.fields.result?.mapValue) }, 30_000, 'roulette spun')
    assert.ok(roulette.fields.result.mapValue.fields.slot_label.stringValue)
    await page.getByRole('button', { name: /Avvia gioco/ }).first().click({ timeout: 60_000 })
    await until(async () => ((await fsGet(`events/${eventId}/games`)).documents ?? []).find((d: any) => d.fields.type.stringValue === 'shoe_game' && d.fields.status.stringValue === 'running'), 20_000, 'shoe started')
    await page.getByRole('button', { name: /Prossima domanda/ }).first().click({ timeout: 30_000 })
    await until(async () => ((await fsGet(`events/${eventId}/games`)).documents ?? []).find((d: any) => d.fields.type.stringValue === 'shoe_game' && d.fields.config.mapValue.fields.current_index.integerValue === '1'), 20_000, 'shoe next')

    // guest page works for the Firebase-native event
    const guest = await (await browser.newContext()).newPage()
    await guest.goto(`${app.url}/live/${slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await guest.getByText(/Matrimonio UI/).first().waitFor({ timeout: 60_000 })

    assert.deepEqual(render.calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/heartbeat')), [], 'nothing written to Render / Supabase')
    // Photos / booth stay on Render (out of this block) and just fail quietly at 503; everything else about the event must not reach it.
    const outOfScope = /\/(photos|booth)(\/|$)/
    assert.deepEqual(render.calls.filter((c) => (c.path === '/api/live/sessions' || c.path === '/user/me' || c.path.includes(eventId)) && !outOfScope.test(c.path)), [], 'no list/detail/plan/games call to Render for the native event')

    // delete from the dashboard → back to the list, gone, slug unresolvable, guest page gone
    await page.getByRole('button', { name: /Impostazioni/ }).first().click()
    await page.getByRole('button', { name: 'Elimina', exact: true }).first().click({ timeout: 30_000 })
    await page.waitForURL(/\/sessions$/, { timeout: 30_000 })
    await until(async () => !(await fsGet(`eventSlugs/${slug}`)).fields, 20_000, 'slug removed')
    assert.ok((await fsGet(`events/${eventId}`)).fields.deletedAt, 'soft delete keeps the document')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    assert.equal(await page.getByText('Matrimonio UI', { exact: true }).count(), 0, 'no longer in the dashboard list')
    const guest2 = await (await browser.newContext()).newPage()
    await guest2.goto(`${app.url}/live/${slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await guest2.waitForTimeout(6000)
    assert.equal(await guest2.getByText(/Matrimonio UI/).count(), 0, 'the public page no longer shows the deleted event')
  } catch (e) { await shot(page, 'k1'); throw e } finally { await ctx.close() }
})
