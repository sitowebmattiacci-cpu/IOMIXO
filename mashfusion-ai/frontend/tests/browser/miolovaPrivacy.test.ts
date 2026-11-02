import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'
import { newClient, type TestClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

/**
 * MIOLOVE album privacy switches in the real UI (Firebase emulators + Next), driven by a real album owner:
 *   "Invio foto degli ospiti" (guestConfig.live_booth)  → guest /live + /booth (the QR page), and the upload API itself
 *   "Foto sullo schermo"      (screenConfig.show_photos) → the TV /screen
 * Persistence (toggle → Firestore → reload) is OWN1b in miolovaGoLive.test.ts.
 */
let render: FakeRender, app: App, browser: Browser
const fx = mkdtempSync(join(tmpdir(), 'miolove-ui-privacy-'))
const JPG = join(fx, 'photo.jpg')
before(async () => {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1600x1200', '-frames:v', '1', '-q:v', '3', JPG])
  render = await startFakeRender()
  app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' })
  browser = await launchPortals(app)
})
after(async () => { await browser?.close(); await app?.stop(); await render?.close(); rmSync(fx, { recursive: true, force: true }) })

const M = () => portalUrl(app, 'miolovealbum.com')
const callAs = <O = any>(c: TestClient, name: string, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, O>(f, name)(data as any).then((r) => r.data)
}
async function fails(p: Promise<unknown>) { try { await p } catch (e: any) { return `${String(e.code).replace('functions/', '')}:${e.details?.reason ?? ''}` } assert.fail('expected rejection') }
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 30_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
let n = 0
async function album() {
  const owner = await newClient('account'), id = `pv${Date.now()}${n++}`, slug = `pvs${Date.now()}${n}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, displayName: 'Enrico Rossi', accountType: 'couple', plan: { tier: 'wedding', source: 'legacy' } })
  await seedSet(`events/${id}`, eventFields(owner.uid, slug, { type: 'wedding', title: 'Album Privacy', coupleNames: 'Album Privacy', legacySupabaseId: undefined, occasionType: 'wedding', accessMode: 'activated', guestConfig: null, screenConfig: null }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  return { owner, id, slug }
}
const setCfg = (a: { owner: TestClient; id: string }, data: Record<string, unknown>) => callAs(a.owner, 'updateEventConfig', { eventId: a.id, ...data })
const newCtx = async (vp = { width: 390, height: 844 }): Promise<BrowserContext> => {
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.addInitScript(() => { try { localStorage.setItem('iomixo.locale', 'it') } catch { /* ignore */ } })
  return ctx
}
const OFF_TEXT = /L'invio di foto e video non è attivo/

test('PRVB1. guest side: uploads ON → /live offers the album and /booth takes a file; OFF → /live and /booth refuse, the API says guest_uploads_disabled; ON again → back', async () => {
  const a = await album(); const ctx = await newCtx(); const page = await ctx.newPage(); const guest = await newClient('anonymous')
  const boothOpen = async (slug: string) => { await page.goto(`${M()}/booth/${slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByText('Album Privacy').first().waitFor({ timeout: 90_000 }) }
  try {
    // ON (never set = the album default)
    await page.goto(`${M()}/live/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.locator(`a[href="/booth/${a.slug}"]`).first().waitFor({ timeout: 90_000 })
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), OFF_TEXT)
    await boothOpen(a.slug); await page.getByTestId('guest-upload-input').waitFor({ state: 'attached', timeout: 60_000 })
    await page.getByTestId('guest-upload-input').setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: readFileSync(JPG) })
    await until(async () => (await page.locator('[data-testid=guest-upload-item][data-status=done]').count()) === 1, 90_000, 'upload done while ON')

    // OFF
    await setCfg(a, { guestConfig: { requests: false, live_booth: false } })
    await page.goto(`${M()}/live/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText(OFF_TEXT).first().waitFor({ timeout: 90_000 })
    assert.equal(await page.locator(`a[href="/booth/${a.slug}"]`).count(), 0, '/live offers no photo entry')
    await boothOpen(a.slug); await page.getByTestId('booth-uploads-off').waitFor({ timeout: 60_000 })
    assert.match(await page.getByTestId('booth-uploads-off').innerText(), OFF_TEXT)
    assert.equal(await page.getByTestId('guest-upload-input').count(), 0, '/booth (the QR page) has no uploader')
    assert.equal(await fails(callAs(guest, 'createPhotoUpload', { eventId: a.id, ext: 'jpg', source: 'live_booth' })), 'permission-denied:guest_uploads_disabled', 'the API refuses too')

    // ON again
    await setCfg(a, { guestConfig: { requests: false, live_booth: true } })
    await boothOpen(a.slug); await page.getByTestId('guest-upload-input').waitFor({ state: 'attached', timeout: 60_000 })
    assert.equal(await page.getByTestId('booth-uploads-off').count(), 0)
    assert.ok((await callAs(guest, 'createPhotoUpload', { eventId: a.id, ext: 'jpg', source: 'live_booth' })).photoId, 'the API accepts again')
  } finally { await ctx.close() }
})

test('PRVB2. TV: with "Galleria condivisa" off the TV shows none (the server refuses it); then show_photos ON shows the album photos, OFF shows none, ON again brings them back', async () => {
  const a = await album(); const guestCtx = await newCtx(); const g = await guestCtx.newPage()
  try {
    await g.goto(`${M()}/booth/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await g.getByTestId('guest-upload-input').waitFor({ state: 'attached', timeout: 90_000 })
    await g.getByTestId('guest-upload-input').setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: readFileSync(JPG) })
    await until(async () => (await g.locator('[data-testid=guest-upload-item][data-status=done]').count()) === 1, 90_000, 'photo uploaded')
  } finally { await guestCtx.close() }
  const ctx = await newCtx({ width: 1280, height: 720 }); const tv = await ctx.newPage()
  const photoCount = (p: Page) => p.locator('img[src*="127.0.0.1:9199"]').count()
  const open = async () => { await tv.goto(`${M()}/screen/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await tv.getByText('Album Privacy').first().waitFor({ timeout: 90_000 }) }
  try {
    await open(); await tv.waitForTimeout(6000)
    assert.equal(await photoCount(tv), 0, 'gallery OFF (initial value): no album photo on the TV')
    await setCfg(a, { guestConfig: { requests: false, live_booth: true, shared_gallery: true } })
    await open(); await until(async () => (await photoCount(tv)) >= 1, 60_000, 'photo on the TV (gallery ON, show_photos default ON)')
    await setCfg(a, { screenConfig: { show_photos: false } })
    await open(); await tv.waitForTimeout(6000)                          // the page is up and has had time to load photos: none may appear
    assert.equal(await photoCount(tv), 0, 'OFF: no album photo on the TV')
    await setCfg(a, { screenConfig: { show_photos: true } })
    await open(); await until(async () => (await photoCount(tv)) >= 1, 60_000, 'photo back on the TV')
  } finally { await ctx.close() }
})
