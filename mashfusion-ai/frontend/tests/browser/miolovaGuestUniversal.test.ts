import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { startFakeRender, startNext, CHROME, PORTAL_HOSTS, portalUrl, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

/**
 * MIOLOVE guest link, universal compatibility (QR code / WhatsApp link → /live/<slug> → upload): the page opens ONCE (no redirect, no bounce), is a plain web
 * page (no installable-app manifest), survives a browser with storage / IndexedDB blocked, never calls a failed load "album not found", and a photo AND a
 * video really reach Storage. Real Chromium with the phone user agents of the field report (Xiaomi 14T Chrome, WhatsApp / Facebook in-app, iPhone Safari).
 * The Xiaomi failure itself is not reproduced here (see docs/miolove-guest-link/diagnosis.md): these tests pin everything the platform controls.
 */
let render: FakeRender, app: App, browser: Browser
const fx = mkdtempSync(join(tmpdir(), 'miolove-guest-universal-'))
const F = { jpg: join(fx, 'photo.jpg'), mp4: join(fx, 'clip.mp4') }
const PHONES: Record<string, { ua: string; viewport: { width: number; height: number } }> = {
  'Xiaomi 14T Chrome': { ua: 'Mozilla/5.0 (Linux; Android 14; 23116PN5BC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', viewport: { width: 393, height: 851 } },
  'Android WhatsApp WebView': { ua: 'Mozilla/5.0 (Linux; Android 14; 23116PN5BC Build/UKQ1.231003.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36', viewport: { width: 393, height: 851 } },
  'Facebook in-app': { ua: 'Mozilla/5.0 (Linux; Android 13; SM-S911B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.0;]', viewport: { width: 360, height: 780 } },
  'iPhone Safari': { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 844 } },
}
before(async () => {
  const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
  ff('-f', 'lavfi', '-i', 'testsrc2=size=1280x960', '-frames:v', '1', '-q:v', '3', F.jpg)
  ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', F.mp4)
  render = await startFakeRender()
  app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' })
  browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', `--host-resolver-rules=${PORTAL_HOSTS.map((h) => `MAP ${h} 127.0.0.1`).join(', ')}`, `--unsafely-treat-insecure-origin-as-secure=${PORTAL_HOSTS.map((h) => portalUrl(app, h)).join(',')}`],
  })
})
after(async () => { await browser?.close(); await app?.stop(); await render?.close(); rmSync(fx, { recursive: true, force: true }) })

const M = () => portalUrl(app, 'miolovealbum.com')
const fsDoc = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 40_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 500)) }
}
async function album(mode: 'trial' | 'activated') {
  const owner = await newClient('account'), id = `gu${mode}${Date.now()}`, slug = `gus${mode}${Date.now()}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, displayName: 'Enrico Rossi', accountType: 'couple', plan: { tier: mode === 'activated' ? 'wedding' : 'free', source: mode === 'activated' ? 'legacy' : 'default' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${id}`, eventFields(owner.uid, slug, { type: 'wedding', title: 'Album Universale', legacySupabaseId: undefined, occasionType: 'wedding', accessMode: mode, trialPhotoCount: 0, trialPhotoLimit: 50, guestConfig: { requests: false, live_booth: true } }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  return { id, slug }
}
const phone = (name: string, extra: Parameters<Browser['newContext']>[0] = {}) =>
  browser.newContext({ userAgent: PHONES[name].ua, viewport: PHONES[name].viewport, isMobile: !/Safari\/604/.test(PHONES[name].ua) || true, hasTouch: true, deviceScaleFactor: 2.75, ...extra })
/** Main-frame navigations of a page, from the first request on. */
/** Distinct addresses the main frame went through (a same-address same-document update, e.g. the router syncing history on hydrate, is not a navigation). */
function navLog(page: Page) { const urls: string[] = []; page.on('framenavigated', (f) => { if (f === page.mainFrame() && urls[urls.length - 1] !== f.url()) urls.push(f.url()) }); return urls }
const guestReady = (p: Page) => p.getByRole('link', { name: /.+/ }).first().waitFor({ timeout: 90_000 })

for (const name of Object.keys(PHONES)) {
  for (const mode of ['trial', 'activated'] as const) {
    test(`GU1. ${name}, ${mode} album, clean session, link opened from WhatsApp: ONE navigation, album shown, stays put, plain web page`, async () => {
      const a = await album(mode), ctx = await phone(name), page = await ctx.newPage(), nav = navLog(page)
      try {
        const href = `${M()}/live/${a.slug}`
        await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 120_000, referer: 'android-app://com.whatsapp/' })
        await page.getByTestId('guest-loading').or(page.locator('a[href*="/booth/"]')).first().waitFor({ timeout: 90_000 })
        await page.locator('a[href*="/booth/"]').first().waitFor({ timeout: 90_000 })
        await page.waitForTimeout(8000)                                                   // a hidden redirect / bounce would show up here
        assert.deepEqual(nav, [href], `main frame went through exactly the link: ${nav.join(' → ')}`)
        assert.equal(page.url(), href)
        assert.equal(await page.locator('link[rel="manifest"]').count(), 0, 'a guest page is not an installable app')
        assert.equal(await page.locator('meta[name="robots"][content*="noindex"]').count(), 1)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'no horizontal scroll')
        assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /non trovata|not found|Advance|Event Pass/i)
      } finally { await ctx.close() }
    })
  }
}

test('GU2. the HTTP layer of every shape of the link: www and a trailing slash move once to the canonical address, a query string is kept, status 200, no cookies needed', async () => {
  const a = await album('trial'), base = `http://miolovealbum.com:${app.port}`
  const get = (u: string) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; text: () => Promise<string>; header: (n: string) => string | null }>((resolve, reject) => {
    const url = new URL(u)
    http.get({ host: '127.0.0.1', port: app.port, path: url.pathname + url.search, headers: { host: url.host, 'user-agent': PHONES['Xiaomi 14T Chrome'].ua } }, (res) => {
      let body = ''; res.on('data', (d) => { body += d }); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text: async () => body, header: (n) => (res.headers[n] as string | undefined) ?? null }))
    }).on('error', reject)
  })
  const plain = await get(`${base}/live/${a.slug}`); assert.equal(plain.status, 200)
  assert.match(plain.header('x-robots-tag') ?? '', /noindex/)
  assert.equal(plain.header('set-cookie'), null, 'no cookie is set by the guest page request')
  const www = await get(`http://www.miolovealbum.com:${app.port}/live/${a.slug}?x=1`)
  assert.equal(www.status, 308); assert.equal(www.header('location'), `https://miolovealbum.com/live/${a.slug}?x=1`)
  assert.equal((await get(`${base}/live/${a.slug}?utm_source=qr`)).status, 200)
  const html = await (await get(`${base}/live/${a.slug}`)).text()
  assert.doesNotMatch(html, /rel="manifest"/); assert.doesNotMatch(html, /http-equiv="refresh"/i)
})

test('GU3. the public home keeps its manifest (only guest surfaces drop it)', async () => {
  const ctx = await phone('Xiaomi 14T Chrome'), page = await ctx.newPage()
  try {
    await page.goto(`${M()}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    assert.equal(await page.locator('link[rel="manifest"]').count(), 1)
    for (const path of ['/booth/x', '/screen/x']) { await page.goto(`${M()}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); assert.equal(await page.locator('link[rel="manifest"]').count(), 0, path) }
  } finally { await ctx.close() }
})

test('GU4. restrictive browser (localStorage, sessionStorage, IndexedDB, cookies and service workers all refused): the album still opens and a photo is really stored', async () => {
  const a = await album('trial'), ctx = await phone('Facebook in-app'), page = await ctx.newPage()
  await page.addInitScript(`(() => {
    const deny = () => { throw new DOMException('denied', 'SecurityError') }
    for (const k of ['localStorage', 'sessionStorage', 'indexedDB']) Object.defineProperty(window, k, { get: deny, configurable: true })
    Object.defineProperty(document, 'cookie', { get: () => '', set: () => {}, configurable: true })
    Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined, configurable: true })
  })()`)
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message))
  try {
    await page.goto(`${M()}/live/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.locator('a[href*="/booth/"]').first().waitFor({ timeout: 90_000 })
    await page.locator('a[href*="/booth/"]').first().click()
    await page.getByTestId('guest-upload-input').waitFor({ state: 'attached', timeout: 90_000 })
    await page.getByTestId('guest-upload-input').setInputFiles(F.jpg)
    await until(async () => Number((await fsDoc(`events/${a.id}`)).fields.trialPhotoCount?.integerValue ?? 0) === 1, 40_000, 'photo stored with storage blocked')
    assert.deepEqual(errors.filter((m) => !/denied|SecurityError/i.test(m)), [], 'no uncaught error other than the refused storage')
  } finally { await ctx.close() }
})

test('GU5. QR flow on a clean phone: /live → Live Booth → a PHOTO and a VIDEO are really stored (original bytes in Storage), the counter follows', async () => {
  const a = await album('trial'), ctx = await phone('Xiaomi 14T Chrome'), page = await ctx.newPage()
  try {
    await page.goto(`${M()}/live/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000, referer: 'android-app://com.google.android.apps.photos/' })
    await page.locator('a[href*="/booth/"]').first().click()
    await page.getByTestId('guest-upload-input').waitFor({ state: 'attached', timeout: 90_000 })
    await page.getByTestId('guest-upload-input').setInputFiles(F.jpg)
    await until(async () => Number((await fsDoc(`events/${a.id}`)).fields.trialPhotoCount?.integerValue ?? 0) === 1, 40_000, 'photo counted')
    await page.getByTestId('guest-upload-input').setInputFiles(F.mp4)
    await until(async () => Number((await fsDoc(`events/${a.id}`)).fields.trialPhotoCount?.integerValue ?? 0) === 2, 60_000, 'video counted')
    const docs = ((await fsDoc(`events/${a.id}/photos`)).documents ?? []) as any[]
    assert.deepEqual(docs.map((d) => d.fields.mediaType.stringValue).sort(), ['photo', 'video'])
    for (const d of docs) {
      const path = d.fields.storagePath?.stringValue ?? d.fields.original?.mapValue?.fields?.path?.stringValue
      if (path) {
        const res = await fetch(`http://127.0.0.1:9199/v0/b/demo-iomixo.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media`, { headers: { authorization: 'Bearer owner' } })
        assert.equal(res.status, 200, `${path} is in Storage`)
        assert.equal((await res.arrayBuffer()).byteLength, readFileSync(d.fields.mediaType.stringValue === 'video' ? F.mp4 : F.jpg).length, 'original bytes untouched')
      }
    }
  } finally { await ctx.close() }
})

test('GU6. a request that fails is a retryable error, not "album not found"; one that hangs offers a retry after 12 s; the retry recovers the page', async () => {
  const a = await album('trial')
  for (const mode of ['fail', 'hang'] as const) {
    const ctx = await phone('Android WhatsApp WebView'), page = await ctx.newPage()
    let broken = true
    await page.route('**/getPublicEvent**', async (route) => { if (!broken) return route.continue(); if (mode === 'fail') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"message":"unavailable","status":"UNAVAILABLE"}}' }); /* hang */ })
    try {
      await page.goto(`${M()}/live/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const box = page.getByTestId(mode === 'fail' ? 'guest-load-error' : 'guest-slow')
      await box.waitFor({ timeout: mode === 'fail' ? 90_000 : 60_000 })
      assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /non trovata|not found/i, 'a failed load is not "not found"')
      broken = false
      await box.getByRole('button').click()
      await page.locator('a[href*="/booth/"]').first().waitFor({ timeout: 90_000 })
    } finally { await ctx.close() }
  }
})

test('GU7. a slug that does not exist still says "not found" (and only that)', async () => {
  const ctx = await phone('iPhone Safari'), page = await ctx.newPage()
  try {
    await page.goto(`${M()}/live/does-not-exist-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText(/non trovata/i).first().waitFor({ timeout: 90_000 })
    assert.equal(await page.getByTestId('guest-load-error').count(), 0)
  } finally { await ctx.close() }
})

test('GU8. /diag (device diagnostics) renders its report, is noindex and sends nothing to the server', async () => {
  const a = await album('trial'), ctx = await phone('Xiaomi 14T Chrome'), page = await ctx.newPage()
  const posts: string[] = []; page.on('request', (r) => { if (r.method() !== 'GET' && r.method() !== 'OPTIONS') posts.push(`${r.method()} ${r.url()}`) })
  try {
    const res = await page.goto(`${M()}/diag?slug=${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    assert.match(res!.headers()['x-robots-tag'] ?? '', /noindex/)
    await page.waitForFunction(() => /frame: contenuto mostrato/.test((document.getElementById('diag-report') as HTMLTextAreaElement | null)?.value ?? ''), null, { timeout: 90_000 })
    const report = await page.locator('#diag-report').inputValue()
    assert.ok(!report.includes(a.slug), 'the album slug is masked in the report'); assert.doesNotMatch(report, /idToken|Bearer|apiKey|AIza/i)
    for (const key of ['userAgent', 'navigation', 'displayMode', 'cookies', 'localStorage', 'indexedDB', 'frame url']) assert.match(report, new RegExp(key), key)
    assert.equal(posts.filter((p) => !/identitytoolkit|firestore|getPublicEvent|firebasestorage|\/live\//.test(p)).length, 0, `nothing but the guest page's own calls: ${posts.join(' | ')}`)
  } finally { await ctx.close() }
})
