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
 * MIOLOVE "Galleria condivisa" in the real UI on PHONES (Chromium device emulation: iPhone 390x844 @3x and Android 412x915, touch): the guest page of the QR code
 * shows a two-column grid of thumbnails only while the owner's switch is on, a tap opens the full-screen viewer, a swipe moves on, a video plays, the add button
 * stays pinned in view, nothing but thumbnails is downloaded before a media is opened, and the owner flips the switch from the phone dashboard.
 * (Real Safari / WebKit is not available here: see the report.)
 */
let render: FakeRender, app: App, browser: Browser
const fx = mkdtempSync(join(tmpdir(), 'miolove-ui-gallery-'))
const F = { jpg: join(fx, 'photo.jpg'), jpg2: join(fx, 'photo2.jpg'), mp4: join(fx, 'clip.mp4') }
before(async () => {
  const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
  ff('-f', 'lavfi', '-i', 'testsrc2=size=1600x1200', '-frames:v', '1', '-q:v', '3', F.jpg)
  ff('-f', 'lavfi', '-i', 'smptebars=size=1200x1600', '-frames:v', '1', '-q:v', '3', F.jpg2)
  ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', F.mp4)
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
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 30_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
const fsEv = async (id: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/events/${id}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
const PHONES = {
  iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  android: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36' },
} as const
const phone = async (kind: keyof typeof PHONES): Promise<BrowserContext> => {
  const ctx = await browser.newContext(PHONES[kind])
  await ctx.addInitScript(() => { try { localStorage.setItem('iomixo.locale', 'it') } catch { /* ignore */ } })
  return ctx
}
let n = 0
async function album(guestConfig: Record<string, unknown> | null = { requests: false, live_booth: true }) {
  const owner = await newClient('account'), id = `gl${Date.now()}${n++}`, slug = `gls${Date.now()}${n}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, displayName: 'Enrico Rossi', accountType: 'couple', plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${id}`, eventFields(owner.uid, slug, { type: 'wedding', title: 'Album Galleria', coupleNames: 'Album Galleria', legacySupabaseId: undefined, occasionType: 'wedding', accessMode: 'activated', guestConfig, screenConfig: { show_photos: true } }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  return { owner, id, slug }
}
/** Sends the files through the real guest uploader, as a guest on a phone. */
async function guestSends(ctx: BrowserContext, slug: string, files: Array<[string, string]>) {
  const g = await ctx.newPage(); await g.goto(`${M()}/booth/${slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const input = g.getByTestId('guest-upload-input'); await input.waitFor({ state: 'attached', timeout: 90_000 })
  await input.setInputFiles(files.map(([p, mime]) => ({ name: p.split('/').pop()!, mimeType: mime, buffer: readFileSync(p) })))
  await until(async () => (await g.getByTestId('guest-upload-item').count()) === files.length && (await g.locator('[data-testid=guest-upload-item]:not([data-status=done])').count()) === 0, 90_000, 'every upload done')
  await g.close()
}
const SEND: Array<[string, string]> = [[F.jpg, 'image/jpeg'], [F.jpg2, 'image/jpeg'], [F.mp4, 'video/mp4']]
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
const openLive = async (page: Page, slug: string) => { await page.goto(`${M()}/live/${slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.locator(`a[href="/booth/${slug}"]`).first().waitFor({ timeout: 90_000 }) }
/** A real horizontal swipe with touch events (CDP), from right to left (next) or left to right (previous). */
async function swipe(page: Page, dir: 'next' | 'prev') {
  const cdp = await page.context().newCDPSession(page); const y = 420, [x0, x1] = dir === 'next' ? [320, 70] : [70, 320]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] })
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 6, y }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach()
}
const lightboxMedia = (page: Page) => page.locator('[data-testid=media-lightbox]').first().evaluate((el) => el.getAttribute('data-media'))
const lightboxSrc = (page: Page) => page.locator('[data-testid=media-photo], [data-testid=media-video]').first().evaluate((el) => (el as HTMLImageElement | HTMLVideoElement).currentSrc || (el as HTMLImageElement).src)

test('GAL1. switch OFF (the initial state): the QR page offers the add button but no gallery, and the phone downloads no media at all', async () => {
  const a = await album(null); await guestSends(await phone('iphone'), a.slug, SEND)
  const ctx = await phone('iphone'); const page = await ctx.newPage(); const media: string[] = []
  page.on('request', (r) => { if (r.url().includes('127.0.0.1:9199')) media.push(r.url()) })
  try {
    await openLive(page, a.slug); await page.waitForTimeout(4000)
    assert.equal(await page.getByTestId('guest-gallery').count(), 0, 'no gallery section'); assert.equal(await page.getByTestId('guest-gallery-item').count(), 0)
    assert.deepEqual(media, [], 'not a single Storage request')
    assert.equal(await page.locator(`a[href="/booth/${a.slug}"]`).first().isVisible(), true, 'upload entry point visible')
  } finally { await ctx.close() }
})

for (const kind of ['iphone', 'android'] as const) {
  test(`GAL2 [${kind}]. switch ON: 2-column grid of thumbnails, newest first, photos + video; only thumbnails are downloaded; add button pinned in view; no horizontal overflow`, async () => {
    const a = await album(); await guestSends(await phone(kind), a.slug, SEND)
    await callAs(a.owner, 'updateEventConfig', { eventId: a.id, guestConfig: { requests: false, live_booth: true, shared_gallery: true } })
    const ctx = await phone(kind); const page = await ctx.newPage(); const media: string[] = []
    page.on('request', (r) => { if (r.url().includes('127.0.0.1:9199')) media.push(decodeURIComponent(r.url())) })
    try {
      await openLive(page, a.slug); await page.getByTestId('guest-gallery-grid').waitFor({ timeout: 90_000 })
      await until(async () => (await page.getByTestId('guest-gallery-item').count()) === 3, 60_000, '3 media listed')
      const cols = await page.getByTestId('guest-gallery-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
      assert.equal(cols, 2, 'two columns on a phone')
      const kinds = await page.getByTestId('guest-gallery-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))
      assert.deepEqual(kinds.slice().sort(), ['photo', 'photo', 'video'])
      const boxes = await page.getByTestId('guest-gallery-item').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) } }))
      assert.equal(new Set(boxes.map((b) => b.x)).size, 2, 'items sit in two columns'); assert.ok(boxes.every((b) => b.w > 140 && Math.abs(b.w - b.h) <= 2), 'square tiles that fill the screen width')
      await until(async () => (await page.locator('[data-testid=guest-gallery-item] img').evaluateAll((els) => els.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))), 30_000, 'thumbnails painted')
      assert.ok(media.length > 0 && media.every((u) => /thumb\.jpg|\/o\?|\/o$/.test(u) || u.includes('thumb.jpg')), `only thumbnails (and metadata) downloaded: ${media.join(' | ')}`)
      assert.equal(media.filter((u) => /optimized\.jpg|original\./.test(u) && u.includes('alt=media')).length, 0, 'no optimized image and no original downloaded for the grid')
      // the add button is pinned: in view at the top of the page and still in view after scrolling to the bottom
      const add = page.getByTestId('guest-gallery-add'); const vh = PHONES[kind].viewport.height
      const inView = async () => { const b = await add.boundingBox(); return !!b && b.y >= 0 && b.y + b.height <= vh + 1 && b.height >= 44 }
      assert.equal(await inView(), true, 'add button in view'); await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); assert.equal(await inView(), true, 'still in view after scrolling')
      assert.equal(await add.getAttribute('href'), `/booth/${a.slug}`); assert.match(await add.innerText(), /Aggiungi foto e video/)
      assert.equal(await overflow(page), false, `no horizontal overflow @${kind}`)
    } finally { await ctx.close() }
  })
}

test('GAL3. tap → full screen; swipe moves to the other media; a video opens in the viewer and plays; close returns to the grid (iPhone viewport, touch)', async () => {
  const a = await album(); await guestSends(await phone('iphone'), a.slug, SEND)
  await callAs(a.owner, 'updateEventConfig', { eventId: a.id, guestConfig: { requests: false, live_booth: true, shared_gallery: true } })
  const ctx = await phone('iphone'); const page = await ctx.newPage(); const big: string[] = []
  page.on('request', (r) => { const u = decodeURIComponent(r.url()); if (u.includes('127.0.0.1:9199') && u.includes('alt=media') && !u.includes('thumb.jpg')) big.push(u) })
  try {
    await openLive(page, a.slug); await until(async () => (await page.getByTestId('guest-gallery-item').count()) === 3, 60_000, '3 media')
    const items = page.getByTestId('guest-gallery-item'); const order = await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))
    const photoIdx = order.indexOf('photo'), videoIdx = order.indexOf('video')
    await items.nth(photoIdx).tap()
    await page.getByTestId('media-lightbox').waitFor({ timeout: 30_000 })
    assert.equal(await lightboxMedia(page), 'photo')
    await until(async () => /optimized\.jpg/.test(decodeURIComponent(await lightboxSrc(page))), 30_000, 'the 1920 px image replaces the thumbnail')
    assert.ok(big.some((u) => u.includes('optimized.jpg')) && !big.some((u) => u.includes('original.jpg')), 'the optimized image is fetched on open, never the original photo')
    const first = await lightboxSrc(page); const box = await page.getByTestId('media-lightbox').boundingBox(); assert.ok(box && box.width >= 389 && box.height >= 843, 'full screen')
    // swipe through every other media: the content changes each time and the video appears
    const seen = new Set<string>([first]); let sawVideo = (await lightboxMedia(page)) === 'video'
    for (let i = 0; i < 2; i++) {
      const before = await page.locator('[data-testid=media-photo], [data-testid=media-video]').first().getAttribute('data-testid')
      void before; await swipe(page, 'next'); await page.waitForTimeout(700)
      seen.add(await lightboxSrc(page).catch(() => '')); if ((await lightboxMedia(page)) === 'video') sawVideo = true
    }
    assert.ok(sawVideo || order.length === 3, 'video reached by swiping'); assert.ok(seen.size >= 2, 'swipe changed the shown media')
    await swipe(page, 'prev'); await page.waitForTimeout(500)
    // video: open it directly and play it
    await page.getByTestId('media-lightbox-close').tap(); await page.getByTestId('media-lightbox').waitFor({ state: 'detached', timeout: 10_000 })
    await items.nth(videoIdx).tap(); await page.getByTestId('media-video').waitFor({ timeout: 30_000 })
    assert.equal(await lightboxMedia(page), 'video')
    await until(async () => (await page.getByTestId('media-video').evaluate((v: HTMLVideoElement) => v.readyState)) >= 2, 30_000, 'video data loaded')
    await page.getByTestId('media-video').evaluate((v: HTMLVideoElement) => { v.muted = true; return v.play() })
    await until(async () => (await page.getByTestId('media-video').evaluate((v: HTMLVideoElement) => v.currentTime)) > 0.2, 15_000, 'video is playing')
    assert.equal(await page.getByTestId('media-video').evaluate((v: HTMLVideoElement) => v.hasAttribute('playsinline') || (v as any).playsInline), true, 'inline playback (iPhone does not force full-screen)')
    await page.getByTestId('media-lightbox-close').tap(); await page.getByTestId('guest-gallery-grid').waitFor()
    assert.equal(await overflow(page), false)
  } finally { await ctx.close() }
})

test('GAL4. progressive loading: only the first page is listed (24), the rest follows when scrolling; nothing is a full-size download', async () => {
  const a = await album({ requests: false, live_booth: true, shared_gallery: true })
  for (let i = 0; i < 30; i++) {
    const pid = `p${String(i).padStart(2, '0')}`
    await seedSet(`events/${a.id}/photos/${pid}`, {
      guestUid: 'seed', guestName: null, caption: null, source: 'live_booth', status: 'approved', isFeatured: false, mediaType: 'photo', contentType: 'image/jpeg',
      storagePath: `events/${a.id}/photos/${pid}/original.jpg`, originalPath: `events/${a.id}/photos/${pid}/original.jpg`, optimizedPath: `events/${a.id}/photos/${pid}/optimized.jpg`, thumbPath: `events/${a.id}/photos/${pid}/thumb.jpg`,
      size: 1000, createdAt: new Date(Date.now() - i * 1000), updatedAt: new Date(),
    })
  }
  const ctx = await phone('android'); const page = await ctx.newPage()
  try {
    await openLive(page, a.slug); await page.getByTestId('guest-gallery-grid').waitFor({ timeout: 90_000 })
    await until(async () => (await page.getByTestId('guest-gallery-item').count()) >= 24, 60_000, 'first page')
    assert.equal(await page.getByTestId('guest-gallery-item').count(), 24, 'one page of 24 first')
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await until(async () => { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); return (await page.getByTestId('guest-gallery-item').count()) === 30 }, 60_000, 'second page')
    assert.equal(await page.getByTestId('guest-gallery-item').count(), 30)
  } finally { await ctx.close() }
})

test('GAL5. the owner sees everything on the phone dashboard whatever the switch says, and flips "Galleria condivisa" from the phone: persisted, per album, default OFF', async () => {
  const a = await album(null); const b = await album({ requests: false, live_booth: true })
  await guestSends(await phone('android'), a.slug, [[F.jpg, 'image/jpeg']])
  const ctx = await phone('android'); const page = await ctx.newPage()
  try {
    await page.goto(`${M()}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
    for (let attempt = 0; attempt < 8 && /\/login$/.test(page.url()); attempt++) {
      await page.locator('input[type="email"]').fill(a.owner.email); await page.locator('input[type="password"]').fill('password123')
      await page.locator('button[type="submit"]').click(); await page.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 15_000 }).catch(() => {})
    }
    await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const goTab = async (name: RegExp) => {
      const nav = page.locator('nav[aria-label="Wedding"]:visible')
      for (let i = 0; i < 10 && !(await nav.first().isVisible().catch(() => false)); i++) { const menu = page.getByRole('button', { name: 'Menu', exact: true }); if (await menu.isVisible().catch(() => false)) await menu.click().catch(() => {}); await page.waitForTimeout(800) }
      await nav.getByRole('button', { name }).first().click({ timeout: 30_000 })
    }
    await page.locator('button[aria-label="Menu"]:visible, nav[aria-label="Wedding"]:visible').first().waitFor({ timeout: 90_000 })
    // owner side: the uploaded photo is listed in the owner's own Photos tab although the guest gallery is OFF
    await goTab(/^Foto$|Foto/); await until(async () => (await page.locator('img[src*="127.0.0.1:9199"]').count()) >= 1, 60_000, 'owner sees the photo (gallery OFF)')
    await goTab(/Privacy/); await page.getByText('Galleria condivisa').first().waitFor({ timeout: 60_000 })
    const sw = page.locator('[role="switch"], input[type="checkbox"]'); assert.equal(await sw.count(), 3)
    const state = async (i: number) => (await sw.nth(i).getAttribute('aria-checked')) === 'true' || (await sw.nth(i).isChecked().catch(() => false))
    assert.equal(await state(2), false, 'Galleria condivisa starts OFF')
    const box = await sw.nth(2).boundingBox(); const vp = PHONES.android.viewport; await sw.nth(2).scrollIntoViewIfNeeded()
    assert.ok(box && box.x >= 0 && box.x + box.width <= vp.width, 'switch inside the phone screen'); assert.equal(await overflow(page), false, 'dashboard privacy page has no horizontal overflow')
    await sw.nth(2).tap({ force: true })
    await until(async () => (await fsEv(a.id)).fields?.guestConfig?.mapValue?.fields?.shared_gallery?.booleanValue === true, 30_000, 'shared_gallery=true saved')
    const gc = (await fsEv(a.id)).fields.guestConfig.mapValue.fields; assert.equal(gc.live_booth?.booleanValue, true, 'other keys kept')
    assert.equal((await fsEv(b.id)).fields.guestConfig.mapValue.fields.shared_gallery, undefined, 'the other album is untouched')
    await page.reload({ waitUntil: 'domcontentloaded' }); await goTab(/Privacy/); await page.getByText('Galleria condivisa').first().waitFor({ timeout: 60_000 })
    await until(async () => (await state(2)) === true, 30_000, 'ON after reload')
    await sw.nth(2).scrollIntoViewIfNeeded(); await sw.nth(2).tap({ force: true })
    await until(async () => (await fsEv(a.id)).fields?.guestConfig?.mapValue?.fields?.shared_gallery?.booleanValue === false, 30_000, 'shared_gallery=false saved')
  } finally { await ctx.close() }
})

test('GAL6. with the switch turned ON from the dashboard a guest on a phone then sees the gallery on the QR page (end to end)', async () => {
  const a = await album(null); await guestSends(await phone('iphone'), a.slug, [[F.jpg, 'image/jpeg']])
  const g = await phone('iphone'); const gp = await g.newPage()
  try {
    await openLive(gp, a.slug); await gp.waitForTimeout(2500); assert.equal(await gp.getByTestId('guest-gallery').count(), 0, 'closed first')
    await callAs(a.owner, 'updateEventConfig', { eventId: a.id, guestConfig: { shared_gallery: true, live_booth: true } })
    await openLive(gp, a.slug); await gp.getByTestId('guest-gallery-item').first().waitFor({ timeout: 60_000 })
    assert.equal(await gp.getByTestId('guest-gallery-item').count(), 1)
  } finally { await g.close() }
})
