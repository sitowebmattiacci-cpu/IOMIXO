import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, seedUpdate, eventFields } from '../firebase/seed'

/**
 * MIOLOVE media engine in the real UI (Firebase emulators + Next): guests upload photos AND videos at original quality, the owner browses / plays /
 * downloads originals / deletes / downloads everything as one archive, the TV plays videos then moves on, the 50-contents trial counts both.
 * Fixtures are generated with ffmpeg (real H.264 / VP8 files the browser can play).
 */
let render: FakeRender, app: App, browser: Browser
const fx = mkdtempSync(join(tmpdir(), 'miolove-ui-media-'))
const F = { jpg: join(fx, 'photo.jpg'), mp4: join(fx, 'clip.mp4'), mov: join(fx, 'clip.mov'), webm: join(fx, 'clip.webm') }
before(async () => {
  const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
  ff('-f', 'lavfi', '-i', 'testsrc2=size=1600x1200', '-frames:v', '1', '-q:v', '3', F.jpg)
  ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', F.mp4)
  ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'mov', F.mov)
  ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15', '-t', '2', '-c:v', 'libvpx', '-b:v', '200k', F.webm)
  render = await startFakeRender()
  app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' })
  browser = await launchPortals(app)
})
after(async () => { await browser?.close(); await app?.stop(); await render?.close(); rmSync(fx, { recursive: true, force: true }) })

const M = () => portalUrl(app, 'miolovealbum.com')
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const fileSha = (p: string) => sha(readFileSync(p))
const MIME: Record<string, string> = { jpg: 'image/jpeg', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }
const fsDoc = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
const fsList = async (path: string) => ((await fsDoc(path)).documents ?? []) as any[]
const objUrl = (path: string) => `http://127.0.0.1:9199/v0/b/demo-iomixo.firebasestorage.app/o/${encodeURIComponent(path)}`
const objBytes = async (path: string) => Buffer.from(await (await fetch(`${objUrl(path)}?alt=media`, { headers: { authorization: 'Bearer owner' } })).arrayBuffer())
const objExists = async (path: string) => (await fetch(objUrl(path), { headers: { authorization: 'Bearer owner' } })).ok
const countOf = async (id: string) => Number((await fsDoc(`events/${id}`)).fields.trialPhotoCount?.integerValue ?? -1)
const photos = async (id: string) => (await fsList(`events/${id}/photos`)).map((d) => ({ id: d.name.split('/').pop() as string, f: d.fields as any }))
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 30_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
let n = 0
async function album(kind: 'activated' | 'trial' = 'activated', trialCount = 0, over: Record<string, unknown> = {}) {
  const owner = await newClient('account'), id = `mm${Date.now()}${n++}`, slug = `mms${Date.now()}${n}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, displayName: 'Enrico Rossi', accountType: 'couple', plan: { tier: kind === 'activated' ? 'wedding' : 'free', source: kind === 'activated' ? 'legacy' : 'default' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${id}`, eventFields(owner.uid, slug, { type: 'wedding', title: 'Album Media', legacySupabaseId: undefined, occasionType: 'wedding', accessMode: kind, ...(kind === 'trial' ? { trialPhotoCount: trialCount, trialPhotoLimit: 50 } : {}), guestConfig: { requests: false, shared_gallery: true }, screenConfig: { show_photos: true, live_booth_layout: 'single' }, ...over }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  return { owner, id, slug }
}
async function newCtx(vp = { width: 390, height: 844 }, locale = 'it', downloads = false): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: vp, acceptDownloads: downloads })
  await ctx.addInitScript((l) => { try { localStorage.setItem('iomixo.locale', l) } catch { /* ignore */ } }, locale)
  return ctx
}
async function login(page: Page, email: string) {
  await page.goto(`${M()}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
  for (let attempt = 0; attempt < 8 && /\/login$/.test(page.url()); attempt++) {
    await page.locator('input[type="email"]').fill(email); await page.locator('input[type="password"]').fill('password123')
    await page.locator('button[type="submit"]').click(); await page.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 15_000 }).catch(() => {})
  }
}
async function goTab(page: Page, name: RegExp) {
  await page.locator('button[aria-label="Menu"]:visible, nav[aria-label="Wedding"]:visible').first().waitFor({ timeout: 90_000 })
  const nav = page.locator('nav[aria-label="Wedding"]:visible')
  // On a phone the nav is a drawer: a click that lands before the page hydrated is swallowed, so look again and click again until it is open.
  for (let i = 0; i < 10 && !(await nav.first().isVisible().catch(() => false)); i++) {
    const menu = page.getByRole('button', { name: 'Menu', exact: true }); if (await menu.isVisible().catch(() => false)) await menu.click().catch(() => {})
    await page.waitForTimeout(800)
  }
  await nav.getByRole('button', { name }).first().click({ timeout: 30_000 })
}
/** Opens the guest booth and sends the files through the real uploader; resolves when every item is `done`. */
async function guestSends(ctx: BrowserContext, slug: string, files: string[], opts: { wait?: 'done' | 'settled' } = {}) {
  const g = await ctx.newPage(); await g.goto(`${M()}/booth/${slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const input = g.getByTestId('guest-upload-input'); await input.waitFor({ state: 'attached', timeout: 90_000 })
  await input.setInputFiles(files.map((p) => ({ name: p.split('/').pop()!, mimeType: MIME[p.split('.').pop()!], buffer: readFileSync(p) })))
  if ((opts.wait ?? 'done') === 'done') await until(async () => (await g.getByTestId('guest-upload-item').count()) === files.length && (await g.locator('[data-testid=guest-upload-item]:not([data-status=done])').count()) === 0, 90_000, 'every upload done')
  return g
}
const storageOf = (p: { f: any }) => ({
  original: p.f.storagePath.stringValue as string, optimized: p.f.optimizedPath?.stringValue as string | undefined, thumb: p.f.thumbPath?.stringValue as string | undefined,
})

test('MEDIA-1. guest uploads photo + MP4 + MOV + WebM in one go @390: progress, success, ORIGINALS preserved byte for byte, derivatives stored, trial counter not involved', async () => {
  const a = await album('activated'); const ctx = await newCtx(); const errors: string[] = []
  try {
    const g = await guestSends(ctx, a.slug, [F.jpg, F.mp4, F.mov, F.webm]); g.on('pageerror', (e) => errors.push(e.message))
    assert.equal(await g.getByTestId('guest-upload-all-done').isVisible(), true); assert.equal(await g.getByTestId('guest-upload-count').innerText(), '4/4')
    assert.equal(await overflow(g), false, 'guest page overflow @390')
    const docs = await photos(a.id); assert.equal(docs.length, 4)
    const byExt = (e: string) => docs.find((d) => storageOf(d).original.endsWith(`.${e}`))!
    for (const ext of ['jpg', 'mp4', 'mov', 'webm'] as const) {
      const d = byExt(ext), s = storageOf(d); assert.ok(d, ext)
      assert.equal(sha(await objBytes(s.original)), fileSha(F[ext]), `${ext}: the stored file IS the original`)
      assert.equal(d.f.status.stringValue, 'approved'); assert.equal(d.f.originalFilename.stringValue, F[ext].split('/').pop())
      assert.equal(d.f.mediaType.stringValue, ext === 'jpg' ? 'photo' : 'video'); assert.equal(Number(d.f.size.integerValue), readFileSync(F[ext]).length)
      if (ext === 'jpg') { assert.ok(s.optimized && s.thumb, 'photo: optimized + thumbnail'); assert.equal(Number(d.f.width.integerValue), 1600) }
      else { assert.equal(s.optimized, undefined, 'a video has no optimized image'); assert.ok(s.thumb && await objExists(s.thumb), `${ext}: poster frame stored`); assert.ok(Math.abs(Number(d.f.durationSec.doubleValue ?? d.f.durationSec.integerValue) - 2) < 0.6, `${ext}: duration read`) }
    }
    assert.equal(await countOf(a.id), -1, 'activated: no counter'); assert.deepEqual(errors, [])
  } finally { await ctx.close() }
})

test('MEDIA-2. refusals are local, clear and localized (IT / EN / FR / ES): video over 150 MB, unsupported format; nothing is created; retry only where it can help', async () => {
  const a = await album('activated')
  const L: Record<string, { pick: string; big: string; fmt: string }> = {
    it: { pick: 'Scegli foto o video', big: 'Il video supera il limite massimo di 150 MB.', fmt: 'Formato non supportato.' },
    en: { pick: 'Choose photos or videos', big: 'The video exceeds the maximum of 150 MB.', fmt: 'Unsupported format.' },
    fr: { pick: 'Choisir photos ou vidéos', big: 'La vidéo dépasse la limite maximale de 150 Mo.', fmt: 'Format non pris en charge.' },
    es: { pick: 'Elegir fotos o videos', big: 'El video supera el límite máximo de 150 MB.', fmt: 'Formato no admitido.' },
  }
  for (const [lang, txt] of Object.entries(L)) {
    const ctx = await newCtx({ width: 390, height: 844 }, lang)
    try {
      const g = await ctx.newPage(); await g.goto(`${M()}/booth/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await g.getByTestId('guest-upload-input').waitFor({ state: 'attached', timeout: 90_000 })
      await g.getByText(txt.pick).first().waitFor({ timeout: 30_000 })
      await g.evaluate(() => {      // a "151 MB" video and a GIF: the size is declared, not allocated (4 real 151 MB buffers would starve the machine for the tests after this one)
        const big = new File([new Uint8Array(16)], 'big.mp4', { type: 'video/mp4' }); Object.defineProperty(big, 'size', { value: 151 * 1024 * 1024 })
        const gif = new File([new Uint8Array(1000)], 'anim.gif', { type: 'image/gif' })
        const i = document.querySelector('[data-testid=guest-upload-input]') as HTMLInputElement
        Object.defineProperty(i, 'files', { configurable: true, value: [big, gif] })      // the page reads input.files in its change handler
        i.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await until(async () => (await g.getByTestId('guest-upload-error').count()) === 2, 20_000, 'two refusals shown')
      const errs = await g.getByTestId('guest-upload-error').allInnerTexts()
      assert.ok(errs.some((e) => e.includes(txt.big)), `${lang}: ${errs.join(' | ')}`); assert.ok(errs.some((e) => e.includes(txt.fmt)), `${lang}: ${errs.join(' | ')}`)
      assert.equal(await g.getByTestId('guest-upload-retry').count(), 0, 'a refusal retrying cannot fix offers no retry')
      assert.equal(await overflow(g), false, `${lang} overflow`)
    } finally { await ctx.close() }
  }
  assert.equal((await photos(a.id)).length, 0, 'nothing was created')
})

test('MEDIA-3. a failed upload can be retried and succeeds; the failure took no trial slot', async () => {
  const a = await album('trial', 3); const ctx = await newCtx()
  try {
    const g = await ctx.newPage()
    let failing = true      // Storage refuses every write (403: the SDK gives up at once instead of backing off for minutes)
    await g.route(/127\.0\.0\.1:9199/, (r) => (failing && r.request().method() !== 'GET' ? r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":{"code":403,"message":"denied"}}' }) : r.continue()))
    await g.goto(`${M()}/booth/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await g.getByTestId('guest-upload-input').waitFor({ state: 'attached', timeout: 90_000 })
    await g.getByTestId('guest-upload-input').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: readFileSync(F.mp4) })
    await g.getByTestId('guest-upload-retry').waitFor({ timeout: 60_000 })
    assert.equal(await countOf(a.id), 3, 'the failed upload holds no slot')
    failing = false
    await g.getByTestId('guest-upload-retry').click()
    await g.getByTestId('guest-upload-all-done').waitFor({ timeout: 60_000 })
    await until(async () => (await countOf(a.id)) === 4, 20_000, 'slot taken once the retry succeeded')
  } finally { await ctx.close() }
})

test('MEDIA-4. owner gallery @1280 + @390: All / Photos / Videos, thumbnails, play icon + duration, real player in the lightbox, optimized photo, original download, delete', async () => {
  const a = await album('activated'); const guestCtx = await newCtx()
  await (await guestSends(guestCtx, a.slug, [F.jpg, F.mp4])).close()
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const ctx = await newCtx(vp, 'it', true); const page = await ctx.newPage()
    const dls: Array<{ name: string; sha: string }> = []
    const hook = (p: Page) => p.on('download', async (d) => { const path = await d.path(); dls.push({ name: d.suggestedFilename(), sha: path ? fileSha(path) : '' }) })
    hook(page); ctx.on('page', hook)           // the click opens a tab that closes at once: Chrome reports the download on the opener
    try {
      await login(page, a.owner.email); await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await goTab(page, /^Foto$|Foto/)
      await page.getByTestId('photo-tile').first().waitFor({ timeout: 60_000 }); assert.equal(await page.getByTestId('photo-tile').count(), 2)
      assert.equal(await page.locator('[data-testid=photo-tile][data-media=video]').count(), 1)
      // filters
      await page.getByRole('button', { name: /^Video \d+$/ }).click(); assert.equal(await page.getByTestId('photo-tile').count(), 1); assert.equal(await page.locator('[data-testid=photo-tile][data-media=video]').count(), 1)
      await page.getByRole('button', { name: /^Foto \d+$/ }).click(); assert.equal(await page.locator('[data-testid=photo-tile][data-media=photo]').count(), 1); assert.equal(await page.locator('[data-testid=photo-tile][data-media=video]').count(), 0)
      await page.getByRole('button', { name: /^Tutto \d+$/ }).click(); assert.equal(await page.getByTestId('photo-tile').count(), 2)
      // thumbnails are the small copies, never the original
      const imgs = await page.locator('[data-testid=photo-tile] img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src))
      assert.equal(imgs.length, 2); for (const src of imgs) assert.match(decodeURIComponent(src), /thumb\.jpg/, `grid shows the thumbnail: ${src}`)
      assert.equal(await overflow(page), false, `gallery overflow @${vp.width}`)
      // video: real player
      await page.locator('[data-testid=photo-tile][data-media=video] [data-testid=photo-open]').click()
      const video = page.getByTestId('media-video'); await video.waitFor({ timeout: 30_000 })
      await until(async () => (await video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth > 0)), 30_000, 'video decodable')
      await video.evaluate((v: HTMLVideoElement) => { v.muted = true; return v.play() })
      await until(async () => (await video.evaluate((v: HTMLVideoElement) => v.currentTime > 0.2)), 15_000, 'video plays')
      const box = await video.boundingBox(); assert.ok(box && box.width <= vp.width + 1 && box.width > 100, `player fits @${vp.width}: ${JSON.stringify(box)}`)
      assert.ok((await video.getAttribute('src'))!.length > 0)
      assert.equal(await overflow(page), false, 'lightbox overflow')
      // download ORIGINAL of the video from the lightbox
      await page.getByTestId('media-download-original').click(); await until(async () => dls.length >= 1, 30_000, 'video original downloaded')
      assert.equal(dls[0].sha, fileSha(F.mp4), 'the download IS the original MP4'); assert.equal(dls[0].name, 'clip.mp4')
      await page.getByTestId('media-lightbox-close').click(); await page.getByTestId('media-lightbox').waitFor({ state: 'detached' })
      // photo: lightbox shows the optimized copy; the original download is the untouched JPEG
      await page.locator('[data-testid=photo-tile][data-media=photo] [data-testid=photo-open]').click()
      const img = page.getByTestId('media-photo'); await img.waitFor({ timeout: 30_000 })
      await until(async () => /optimized\.jpg/.test(decodeURIComponent((await img.getAttribute('src')) ?? '')), 20_000, 'the lightbox loads the optimized copy (the grid only had the thumbnail)')
      await page.getByTestId('media-download-original').click(); await until(async () => dls.length >= 2, 30_000, 'photo original downloaded')
      assert.equal(dls[1].sha, fileSha(F.jpg), 'the download IS the original JPEG, not the 1920 px copy'); assert.equal(dls[1].name, 'photo.jpg')
      await page.keyboard.press('Escape'); await page.getByTestId('media-lightbox').waitFor({ state: 'detached' })
    } finally { await ctx.close() }
  }
  // delete from the gallery removes record + every file
  const ctx = await newCtx({ width: 1280, height: 800 }); const page = await ctx.newPage(); page.on('dialog', (d) => d.accept())
  try {
    const before = await photos(a.id); const all = before.flatMap((p) => Object.values(storageOf(p)).filter(Boolean) as string[]); assert.equal(all.length, 5)
    await login(page, a.owner.email); await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await goTab(page, /^Foto$|Foto/)
    const tile = page.locator('[data-testid=photo-tile][data-media=video]'); await tile.waitFor({ timeout: 60_000 }); await tile.hover()
    await tile.getByTestId('photo-delete').click()
    await until(async () => (await photos(a.id)).length === 1, 30_000, 'video record deleted')
    const gone = before.find((p) => storageOf(p).original.endsWith('.mp4'))!
    for (const path of Object.values(storageOf(gone)).filter(Boolean) as string[]) assert.equal(await objExists(path), false, `orphan left: ${path}`)
  } finally { await ctx.close(); await guestCtx.close() }
})

test('MEDIA-5. "Scarica tutto": ONE click → preparing → ready → ONE archive with the ORIGINALS of photos + videos (4 languages); a trial album stays locked', async () => {
  const a = await album('activated'); const guestCtx = await newCtx()
  await (await guestSends(guestCtx, a.slug, [F.jpg, F.mp4, F.mov])).close()
  for (const [lang, label] of [['it', 'Scarica tutto'], ['en', 'Download all'], ['fr', 'Tout télécharger'], ['es', 'Descargar todo']] as const) {
    const ctx = await newCtx({ width: 1280, height: 800 }, lang, true); const page = await ctx.newPage()
    const files: Array<{ name: string; path: string }> = []
    const hook = (p: Page) => p.on('download', async (d) => { const path = await d.path(); if (path) files.push({ name: d.suggestedFilename(), path }) })
    hook(page); ctx.on('page', hook)                   // the archive is fetched in the same tab; single originals open a tab
    try {
      await login(page, a.owner.email); await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await goTab(page, /^(Foto|Photos|Fotos)$/)
      const btn = page.getByTestId('photos-download'); await btn.waitFor({ timeout: 60_000 }); await page.getByTestId('photo-tile').first().waitFor({ timeout: 60_000 })
      assert.match(await btn.innerText(), new RegExp(label)); assert.equal(await btn.isDisabled(), false)
      await btn.click()
      await until(async () => ['preparing', 'ready'].includes((await page.getByTestId('album-export').getAttribute('data-phase')) ?? ''), 30_000, 'preparation shown')
      await until(async () => (await page.getByTestId('album-export').getAttribute('data-phase')) === 'ready', 60_000, 'archive ready')
      await until(async () => files.length >= 1, 30_000, 'the archive download started')
      assert.equal(files.length, 1, 'ONE download, not one per file'); assert.match(files[0].name, /^album-media-miolove-originals\.zip$/)
      if (lang === 'it') {
        const dir = join(fx, 'unz'); execFileSync('unzip', ['-qo', files[0].path, '-d', dir]); const names = readdirSync(dir).sort()
        assert.equal(names.length, 3); assert.deepEqual(names.map((f) => sha(readFileSync(join(dir, f)))).sort(), [F.jpg, F.mp4, F.mov].map(fileSha).sort(), 'the archive holds the three ORIGINALS')
        rmSync(dir, { recursive: true, force: true })
      }
    } finally { await ctx.close() }
  }
  const t = await album('trial', 2, {}); await seedSet(`events/${t.id}/photos/x1`, { guestUid: 'g', status: 'approved', storagePath: `events/${t.id}/photos/x1/original.jpg`, contentType: 'image/jpeg', createdAt: new Date() })
  const ctx = await newCtx({ width: 1280, height: 800 }); const page = await ctx.newPage()
  try {
    await login(page, t.owner.email); await page.goto(`${M()}/sessions/${t.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await goTab(page, /^Foto$|Foto/)
    const btn = page.getByTestId('photos-download'); await btn.waitFor({ timeout: 60_000 }); assert.equal(await btn.isDisabled(), true, 'trial: "download all" is part of the full album')
  } finally { await ctx.close(); await guestCtx.close() }
})

test('MEDIA-6. TV slideshow: a video plays muted ONCE then the slideshow moves to the next content (no loop); photos still rotate; IOMIXO photo path untouched', async () => {
  const a = await album('activated'); const guestCtx = await newCtx()
  await (await guestSends(guestCtx, a.slug, [F.jpg, F.mp4])).close()
  const ctx = await newCtx({ width: 1280, height: 720 }); const tv = await ctx.newPage(); const errors: string[] = []; tv.on('pageerror', (e) => errors.push(e.message))
  try {
    await tv.goto(`${M()}/screen/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const video = tv.getByTestId('slide-video')
    await video.waitFor({ timeout: 90_000 })                                           // shuffle may show the photo first: the video comes within the rotation
    assert.equal(await video.evaluate((v: HTMLVideoElement) => v.muted), true, 'TV videos start muted (browsers refuse autoplay with sound)')
    await until(async () => (await video.evaluate((v: HTMLVideoElement) => v.currentTime > 0.3)), 20_000, 'the video plays on the TV')
    // …and after it ends the next content (the photo) takes over: the <video> disappears and the optimized photo shows
    await until(async () => (await tv.getByTestId('slide-video').count()) === 0, 30_000, 'slideshow moved past the video')
    await until(async () => (await tv.locator('img[src*="127.0.0.1:9199"]').count()) >= 1, 20_000, 'the photo is shown after the video')
    const src = await tv.locator('img[src*="127.0.0.1:9199"]').first().getAttribute('src'); assert.match(decodeURIComponent(src!), /optimized\.jpg/, 'the TV loads the optimized copy, not the original')
    // the loop continues: the video comes back later (it is part of the rotation), it is not stuck on one frame
    await tv.getByTestId('slide-video').waitFor({ timeout: 60_000 })
    assert.deepEqual(errors, [])
  } finally { await ctx.close(); await guestCtx.close() }
})

test('MEDIA-7. a lone video on the TV restarts after it ends (one content = it is its own next), no freeze', async () => {
  const a = await album('activated'); const guestCtx = await newCtx()
  await (await guestSends(guestCtx, a.slug, [F.mp4])).close()
  const ctx = await newCtx({ width: 1280, height: 720 }); const tv = await ctx.newPage()
  try {
    await tv.goto(`${M()}/screen/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const video = tv.getByTestId('slide-video'); await video.waitFor({ timeout: 90_000 })
    await until(async () => (await video.evaluate((v: HTMLVideoElement) => v.currentTime > 0.5)), 20_000, 'plays')
    await until(async () => (await tv.getByTestId('slide-video').last().evaluate((v: HTMLVideoElement) => v.currentTime < 0.5 && !v.ended)), 20_000, 'restarted after the end')
  } finally { await ctx.close(); await guestCtx.close() }
})

test('MEDIA-8. trial = 50 CONTENTS in the UI: 49 + one video = 50/50, the 51st (photo or video) is refused with a localized message and no record; delete frees a slot', async () => {
  const a = await album('trial', 49); const guestCtx = await newCtx(); const ownerCtx = await newCtx({ width: 1280, height: 800 })
  try {
    await (await guestSends(guestCtx, a.slug, [F.mp4])).close()
    await until(async () => (await countOf(a.id)) === 50, 30_000, 'the video took the 50th slot')
    const g = await guestSends(guestCtx, a.slug, [F.jpg, F.mov], { wait: 'settled' })
    await until(async () => (await g.getByTestId('guest-upload-error').count()) === 2, 40_000, 'both 51st contents refused')
    for (const t of await g.getByTestId('guest-upload-error').allInnerTexts()) assert.match(t, /limite della prova gratuita \(50 contenuti tra foto e video\)/)
    assert.equal(await g.getByTestId('guest-upload-retry').count(), 0); assert.equal((await photos(a.id)).length, 1); assert.equal(await countOf(a.id), 50)
    const owner = await ownerCtx.newPage(); owner.on('dialog', (d) => d.accept())
    await login(owner, a.owner.email); await owner.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await owner.getByTestId('trial-quota-count').first().waitFor({ timeout: 90_000 }); assert.equal((await owner.getByTestId('trial-quota-count').first().innerText()).replace(/\s+/g, ' '), '50 / 50 contenuti')
    await goTab(owner, /^Foto$|Foto/); const tile = owner.getByTestId('photo-tile').first(); await tile.waitFor({ timeout: 60_000 }); await tile.hover(); await tile.getByTestId('photo-delete').click()
    await until(async () => (await countOf(a.id)) === 49, 30_000, 'delete freed a slot')
    await (await guestSends(guestCtx, a.slug, [F.jpg])).close(); await until(async () => (await countOf(a.id)) === 50, 30_000, 'accepted again')
  } finally { await ownerCtx.close(); await guestCtx.close() }
})

test('MEDIA-9. LEGACY photos (one compressed file, no new fields) still show in the owner gallery and on the TV, and download as the file they have', async () => {
  const a = await album('activated'); const legacy = readFileSync(F.jpg), path = `events/${a.id}/photos/old1/original.jpg`
  await seedSet(`events/${a.id}/photos/old1`, { guestUid: 'someone', guestName: 'Vecchia', caption: null, source: 'live_booth', status: 'approved', isFeatured: false, storagePath: path, contentType: 'image/jpeg', size: legacy.length, createdAt: new Date(), updatedAt: new Date() })
  assert.equal((await fetch(`http://127.0.0.1:9199/v0/b/demo-iomixo.firebasestorage.app/o?name=${encodeURIComponent(path)}`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'image/jpeg' }, body: legacy })).status, 200)
  const ctx = await newCtx({ width: 1280, height: 800 }, 'it', true); const page = await ctx.newPage(); const tv = await ctx.newPage()
  try {
    await tv.goto(`${M()}/screen/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await until(async () => (await tv.locator('img[src*="127.0.0.1:9199"]').count()) >= 1, 60_000, 'legacy photo on the TV'); assert.match(decodeURIComponent((await tv.locator('img[src*="127.0.0.1:9199"]').first().getAttribute('src'))!), /original\.jpg/)
    await login(page, a.owner.email); await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await goTab(page, /^Foto$|Foto/)
    const tile = page.getByTestId('photo-tile'); await tile.first().waitFor({ timeout: 60_000 }); assert.equal(await tile.count(), 1); assert.equal(await page.locator('[data-testid=photo-tile] img').count(), 1)
    await page.getByTestId('photo-open').click(); await page.getByTestId('media-photo').waitFor({ timeout: 30_000 })
    // A legacy object carries no `attachment` disposition (it was uploaded before originals were handled): the browser either saves it or opens the very same file in a new tab
    // (what the old "download" button always did). Both are the file it has; what must not happen is nothing.
    const dl = page.waitForEvent('download', { timeout: 20_000 }).then((d) => ({ d, tab: null as null | string })).catch(() => null)
    const tab = ctx.waitForEvent('page', { timeout: 20_000 }).then(async (p) => { await p.waitForURL(/original\.jpg/, { timeout: 15_000 }).catch(() => {}); return { d: null as any, tab: p.url() } }).catch(() => null)
    await page.getByTestId('media-download-original').click(); const got = await Promise.race([dl, tab])
    assert.ok(got, 'the legacy photo downloads or opens')
    if (got!.d) { const p = await got!.d.path(); assert.equal(p ? fileSha(p) : '', fileSha(F.jpg), 'legacy download = its (only) file') } else assert.match(decodeURIComponent(got!.tab ?? ''), /original\.jpg/, 'the legacy file opened')
  } finally { await ctx.close() }
})

test('MEDIA-SEL. owner Foto: 1 selected → its ORIGINAL straight away; 5 selected → click "Scarica (5)" → preparing → ONE ZIP with the 5 originals (no 5 separate downloads)', async () => {
  const a = await album('activated'); const guestCtx = await newCtx()
  await (await guestSends(guestCtx, a.slug, [F.jpg, F.jpg, F.jpg, F.mp4, F.mov])).close()
  const ctx = await newCtx({ width: 1280, height: 800 }, 'it', true); const page = await ctx.newPage()
  const files: Array<{ name: string; path: string }> = []
  const hook = (p: Page) => p.on('download', async (d) => { const path = await d.path(); if (path) files.push({ name: d.suggestedFilename(), path }) })
  hook(page); ctx.on('page', hook)
  try {
    await login(page, a.owner.email); await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await goTab(page, /^Foto$|Foto/)
    await until(async () => (await page.getByTestId('photo-tile').count()) === 5, 60_000, '5 tiles')
    const pick = (i: number) => page.getByTestId('photo-tile').nth(i).locator('button[aria-pressed]').click()
    const btn = page.getByTestId('photos-download')
    // 1 selected: direct download of the original
    await pick(0); await until(async () => /Scarica \(1\)/.test(await btn.innerText()), 15_000, 'Scarica (1)')
    await btn.click(); await until(async () => files.length >= 1, 30_000, 'single original downloaded'); assert.ok(/\.(jpg|mp4|mov)$/.test(files[0].name), `a media file, not a zip: ${files[0].name}`)
    assert.equal(await page.getByTestId('album-export').count(), 0, 'one media: no archive')
    // 5 selected: ONE zip
    files.length = 0
    for (const i of [1, 2, 3, 4]) await pick(i)
    await until(async () => /Scarica \(5\)/.test(await btn.innerText()), 15_000, 'Scarica (5)')
    await btn.click()
    await until(async () => ['requesting', 'queued', 'preparing', 'ready'].includes((await page.getByTestId('album-export').getAttribute('data-phase')) ?? ''), 20_000, 'preparation shown')
    await until(async () => (await page.getByTestId('album-export').getAttribute('data-phase')) === 'ready', 60_000, 'ready')
    await until(async () => files.length >= 1, 30_000, 'the archive download started'); await page.waitForTimeout(1500)
    assert.equal(files.length, 1, 'ONE download, not five'); assert.equal(files[0].name, 'album-media-miolove-selezione.zip')
    assert.match(await page.getByTestId('export-status').innerText(), /Download pronto/)
    const dir = join(fx, 'sel'); execFileSync('unzip', ['-qo', files[0].path, '-d', dir]); const names = readdirSync(dir).sort(); assert.equal(names.length, 5)
    assert.deepEqual(names.map((f) => sha(readFileSync(join(dir, f)))).sort(), [F.jpg, F.jpg, F.jpg, F.mp4, F.mov].map(fileSha).sort(), 'the 5 ORIGINALS')
    rmSync(dir, { recursive: true, force: true })
  } finally { await ctx.close(); await guestCtx.close() }
})

test('MEDIA-SEL-TRIAL. trial album: 1 selected → original straight away; 2+ selected → NO archive, a clear "activate" call to action instead; "download all" stays locked', async () => {
  const a = await album('trial', 0); const guestCtx = await newCtx()
  await (await guestSends(guestCtx, a.slug, [F.jpg, F.mp4, F.jpg])).close()
  const ctx = await newCtx({ width: 1280, height: 800 }, 'it', true); const page = await ctx.newPage()
  const files: Array<{ name: string; path: string }> = []
  const hook = (p: Page) => p.on('download', async (d) => { const path = await d.path(); if (path) files.push({ name: d.suggestedFilename(), path }) })
  hook(page); ctx.on('page', hook)
  try {
    await login(page, a.owner.email); await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await goTab(page, /^Foto$|Foto/)
    await until(async () => (await page.getByTestId('photo-tile').count()) === 3, 60_000, '3 tiles')
    const btn = page.getByTestId('photos-download'); assert.equal(await btn.isDisabled(), true, '"Scarica tutto" locked in the trial')
    const pick = (i: number) => page.getByTestId('photo-tile').nth(i).locator('button[aria-pressed]').click()
    await pick(0); await until(async () => /Scarica \(1\)/.test(await btn.innerText()), 15_000, 'Scarica (1)')
    assert.equal(await btn.isDisabled(), false); await btn.click(); await until(async () => files.length >= 1, 30_000, 'single original downloaded'); assert.ok(/\.(jpg|mp4)$/.test(files[0].name))
    await pick(1)
    const cta = page.getByTestId('download-many-locked'); await cta.waitFor({ timeout: 15_000 })
    assert.match(await cta.innerText(), /Attiva l'album per scaricare più contenuti insieme/); assert.equal(await page.getByTestId('download-many-activate').getAttribute('href'), '/billing')
    assert.equal(await page.getByTestId('album-export').count(), 0, 'no archive button'); assert.equal(await page.getByTestId('photos-download').count(), 0)
    await pick(2); assert.equal(await cta.count(), 1); assert.equal(files.length, 1, 'nothing else was downloaded')
  } finally { await ctx.close(); await guestCtx.close() }
})
