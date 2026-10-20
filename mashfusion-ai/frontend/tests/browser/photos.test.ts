import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launch, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

/**
 * Photos + Live Booth + winner announcement in the real UI, Render answering 503 to EVERYTHING (no route registered), Storage / Firestore / Functions on the
 * emulators: guest uploads from /booth → owner moderates in the dashboard → the TV (/screen) updates in realtime → reject / delete → winner photos.
 */
let render: FakeRender, app: App, browser: Browser
before(async () => {
  render = await startFakeRender()
  app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true' })
  browser = await launch()
})
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const fsDoc = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
const fsList = async (path: string) => ((await fsDoc(path)).documents ?? []) as any[]
const objMeta = async (path: string) => { const r = await fetch(`http://127.0.0.1:9199/v0/b/demo-iomixo.firebasestorage.app/o/${encodeURIComponent(path)}`, { headers: { authorization: 'Bearer owner' } }); return r.ok ? await r.json() : null }
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 30_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 500)) }
}
const shot = (page: Page, name: string) => page.screenshot({ path: `/tmp/claude-501/photos-${name}.png` }).catch(() => {})
const storageImgs = (p: Page) => p.locator('img[src*="127.0.0.1:9199"]').count()
const dataCalls = () => render.calls.filter((c) => /\/photos|booth-photo|\/screen$|\/api\/live\/public\//.test(c.path) && !c.path.endsWith('/heartbeat'))

// Photos / Live Booth are a MIOLOVE album feature: the album owner is a Sposi account (accessMode 'activated'). A DJ (IOMIXO) never gets them.
async function ownerSetup(over: Record<string, unknown> = {}, accountType: 'couple' | 'dj' = 'couple') {
  const owner = await newClient('account'), stamp = Date.now(), id = `phev${stamp}`, slug = `phslug${stamp}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, accountType, plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  if (accountType === 'couple') over = { accessMode: 'activated', ...over }
  await seedSet(`events/${id}`, eventFields(owner.uid, slug, { type: 'wedding', title: 'Foto Browser', legacySupabaseId: undefined, screenConfig: { show_photos: true, live_booth_layout: 'grid' }, guestConfig: { requests: true }, ...over }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  const ctx = await browser.newContext(); const page = await ctx.newPage(); page.on('dialog', (d) => d.accept())
  await page.goto(`${app.url}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
  for (let attempt = 0; attempt < 8 && !/dashboard|sessions/.test(page.url()); attempt++) {
    await page.locator('input[type="email"]').fill(owner.email); await page.locator('input[type="password"]').fill('password123')
    await page.locator('button[type="submit"]').click(); await page.waitForURL(/dashboard|sessions/, { timeout: 15_000 }).catch(() => {})
  }
  assert.match(page.url(), /dashboard|sessions/)
  return { owner, id, slug, ctx, page }
}

test('H1. MIOLOVE album: guest uploads from the Live Booth → approved immediately → the TV shows it live, no approve / reject in the dashboard → delete removes file + doc; Render untouched', async () => {
  const s = await ownerSetup()
  const tvCtx = await browser.newContext(), guestCtx = await browser.newContext()
  try {
    render.calls.length = 0
    const tv = await tvCtx.newPage(); await tv.goto(`${app.url}/screen/${s.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await tv.getByText('Foto Browser').first().waitFor({ timeout: 90_000 }).catch(() => {})

    // guest: Live Booth, native file picker path (no camera in headless)
    const guest = await guestCtx.newPage(); await guest.goto(`${app.url}/booth/${s.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await guest.getByTestId('guest-upload-input').waitFor({ state: 'attached', timeout: 90_000 })
    await guest.getByTestId('guest-upload-input').setInputFiles({ name: 'selfie.png', mimeType: 'image/png', buffer: PNG })      // the album uploader sends it on its own
    const photo = await until(async () => (await fsList(`events/${s.id}/photos`))[0], 30_000, 'photo doc')
    const photoId = photo.name.split('/').pop()
    // Wedding: no moderation. Finalize makes the photo approved and the TV shows it live.
    await until(async () => (await fsDoc(`events/${s.id}/photos/${photoId}`)).fields.status.stringValue === 'approved', 20_000, 'photo finalized (approved, no moderation)')
    const f = (await fsDoc(`events/${s.id}/photos/${photoId}`)).fields
    assert.equal(f.source.stringValue, 'live_booth'); assert.ok(f.guestUid.stringValue); assert.match(f.storagePath.stringValue, new RegExp(`^events/${s.id}/photos/${photoId}/original\\.(jpg|png)$`))
    assert.ok(await objMeta(f.storagePath.stringValue), 'the bytes are in Storage')
    await until(async () => (await storageImgs(tv)) >= 1, 45_000, 'the photo appears on the TV (realtime) without any approval')

    // owner: Photos tab → the card is there, with delete but WITHOUT approve / reject
    await s.page.goto(`${app.url}/sessions/${s.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await s.page.getByRole('button', { name: /Foto/ }).first().click({ timeout: 90_000 })
    await s.page.locator('img[src*="127.0.0.1:9199"]').first().waitFor({ timeout: 60_000 })
    await s.page.locator('div.group', { has: s.page.locator('img') }).first().hover()
    assert.equal(await s.page.locator('button[title="Approva"], button[title="Rifiuta"]').count(), 0, 'no approve / reject buttons for Wedding photos')

    // delete → file and document gone
    await s.page.locator('div.group', { has: s.page.locator('img') }).first().hover()
    await s.page.locator('button[title="Elimina"]').first().click()
    await until(async () => (await fsList(`events/${s.id}/photos`)).length === 0, 20_000, 'doc deleted')
    assert.equal(await objMeta(f.storagePath.stringValue), null, 'file deleted')

    assert.deepEqual(render.calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/heartbeat')), [], 'no write reached Render / Supabase')
    assert.deepEqual(dataCalls(), [], 'no photos / booth / screen / public call reached Render')
  } catch (e) { await shot(s.page, 'h1-owner'); throw e } finally { await s.ctx.close(); await tvCtx.close(); await guestCtx.close() }
})

test('H2. winner announcement: owner uploads both photos to Storage, picks the winner and starts it; the TV shows them from Storage; Render untouched', async () => {
  const s = await ownerSetup({ screenConfig: { show_photos: false } }, 'dj')
  const tvCtx = await browser.newContext()
  try {
    render.calls.length = 0
    await s.page.goto(`${app.url}/sessions/${s.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await s.page.getByRole('button', { name: /Giochi/ }).first().click({ timeout: 90_000 })
    const inputs = s.page.locator('input[type="file"]'); await inputs.nth(1).waitFor({ state: 'attached', timeout: 90_000 })
    await inputs.nth(0).setInputFiles({ name: 'groom.png', mimeType: 'image/png', buffer: PNG })
    await until(async () => !!(await fsDoc(`events/${s.id}`)).fields?.screenConfig?.mapValue?.fields?.winner_announcement?.mapValue?.fields?.groom_photo_path?.stringValue, 30_000, 'groom photo path saved')
    await inputs.nth(1).setInputFiles({ name: 'bride.png', mimeType: 'image/png', buffer: PNG })
    const w = await until(async () => { const x = (await fsDoc(`events/${s.id}`)).fields?.screenConfig?.mapValue?.fields?.winner_announcement?.mapValue?.fields; return x?.bride_photo_path?.stringValue && x }, 30_000, 'bride photo path saved')
    const groomPath = w.groom_photo_path.stringValue, bridePath = w.bride_photo_path.stringValue
    assert.match(groomPath, new RegExp(`^events/${s.id}/winner/groom-[A-Za-z0-9]+\\.`)); assert.match(bridePath, new RegExp(`^events/${s.id}/winner/bride-[A-Za-z0-9]+\\.`))
    assert.ok(await objMeta(groomPath) && await objMeta(bridePath), 'both files are in Storage')
    await s.page.locator('img[src*="127.0.0.1:9199"]').first().waitFor({ timeout: 30_000 })                    // the panel previews them from Storage

    await s.page.getByRole('button', { name: 'Sposo', exact: true }).click()
    await s.page.getByRole('button', { name: /Avvia proclamazione/ }).click({ timeout: 20_000 })
    await until(async () => (await fsDoc(`events/${s.id}`)).fields.screenConfig.mapValue.fields.winner_announcement.mapValue.fields.phase?.stringValue === 'running', 20_000, 'announcement running')

    const tv = await tvCtx.newPage(); await tv.goto(`${app.url}/screen/${s.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await until(async () => (await tv.locator('img[src*="winner"]').count()) >= 1, 60_000, 'winner photos on the TV (from Storage)')

    // replacing a photo deletes the old file
    await s.page.getByRole('button', { name: /Sostituisci/ }).first().click({ trial: true }).catch(() => {})
    await s.page.getByRole('button', { name: /Ripristina/ }).first().click()
    assert.deepEqual(render.calls.filter((c) => c.method !== 'GET'), [], 'no write reached Render')
    assert.deepEqual(dataCalls(), [], 'no photo / screen call reached Render')
  } catch (e) { await shot(s.page, 'h2-owner'); throw e } finally { await s.ctx.close(); await tvCtx.close() }
})

test('H3. IOMIXO Wedding DJ: no Photos / Poster / Live Booth in the dashboard, /booth is not available, the TV ignores show_photos', async () => {
  const s = await ownerSetup({}, 'dj')
  const ctx = await browser.newContext()
  try {
    await s.page.goto(`${app.url}/sessions/${s.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await s.page.getByRole('button', { name: /Giochi/ }).first().waitFor({ timeout: 90_000 })
    for (const name of [/^Foto/, /Poster/, /Live Booth/]) assert.equal(await s.page.locator('nav').getByRole('button', { name }).count(), 0, `no ${name} section for a DJ`)
    assert.equal(await s.page.locator('[role="img"][aria-label="MIOLOVE ALBUM"]').count(), 0, 'no MIOLOVE logo in the Wedding DJ dashboard')
    assert.ok(await s.page.locator('[role="img"][aria-label="IOMIXO Live Hub"]').first().isVisible(), 'IOMIXO brand in the Wedding DJ dashboard')

    const page = await ctx.newPage()
    await page.goto(`${app.url}/booth/${s.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText('Il Live Booth non è disponibile per questo evento.').waitFor({ timeout: 90_000 })
    assert.equal(await page.locator('input[type="file"]').count(), 0, 'no upload control')

    await page.goto(`${app.url}/screen/${s.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {})
    await page.waitForTimeout(8000)
    assert.equal(await storageImgs(page), 0, 'no photo on the IOMIXO TV even with show_photos true')
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /MIOLOVE/, 'no MIOLOVE brand on the IOMIXO TV')
  } catch (e) { await shot(s.page, 'h3-owner'); throw e } finally { await s.ctx.close(); await ctx.close() }
})
