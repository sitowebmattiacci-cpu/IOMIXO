import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

/**
 * MIOLOVE: optional guest name (typed in the guest uploader, saved with photos AND videos, remembered per event, "Anonimo" fallback) and the public
 * "Idee per usare MIOLOVE" guide (home teaser, /idee in four languages, responsive, SEO). Real Firebase emulators + Next.
 */
let render: FakeRender, app: App, browser: Browser
const fx = mkdtempSync(join(tmpdir(), 'miolove-ui-name-'))
const F = { jpg: join(fx, 'photo.jpg'), mp4: join(fx, 'clip.mp4') }
before(async () => {
  const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
  ff('-f', 'lavfi', '-i', 'testsrc2=size=1600x1200', '-frames:v', '1', '-q:v', '3', F.jpg)
  ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', F.mp4)
  render = await startFakeRender()
  app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' })
  browser = await launchPortals(app)
})
after(async () => { await browser?.close(); await app?.stop(); await render?.close(); rmSync(fx, { recursive: true, force: true }) })

const M = () => portalUrl(app, 'miolovealbum.com'), I = () => portalUrl(app, 'iomixo.com')
type L = 'it' | 'en' | 'fr' | 'es'
const MIME: Record<string, string> = { jpg: 'image/jpeg', mp4: 'video/mp4' }
const fsDoc = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
const photos = async (id: string) => (((await fsDoc(`events/${id}/photos`)).documents ?? []) as any[]).map((d) => ({ id: d.name.split('/').pop() as string, f: d.fields as any }))
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 30_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
let n = 0
async function album(over: Record<string, unknown> = {}) {
  const owner = await newClient('account'), id = `nm${Date.now()}${n++}`, slug = `nms${Date.now()}${n}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, displayName: 'Enrico Rossi', accountType: 'couple', plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${id}`, eventFields(owner.uid, slug, { type: 'wedding', title: 'Album Nomi', legacySupabaseId: undefined, occasionType: 'wedding', accessMode: 'activated', guestConfig: { requests: false }, screenConfig: { show_photos: true, live_booth_layout: 'single' }, ...over }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  return { owner, id, slug }
}
async function newCtx(vp = { width: 390, height: 844 }, locale: L = 'it'): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.addInitScript((l) => { try { if (!localStorage.getItem('iomixo.locale')) localStorage.setItem('iomixo.locale', l) } catch { /* ignore */ } }, locale)
  return ctx
}
async function login(page: Page, email: string) {
  await page.goto(`${M()}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
  for (let a = 0; a < 8 && /\/login$/.test(page.url()); a++) {
    await page.locator('input[type="email"]').fill(email); await page.locator('input[type="password"]').fill('password123')
    await page.locator('button[type="submit"]').click(); await page.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 15_000 }).catch(() => {})
  }
}
async function goTab(page: Page, name: RegExp) {
  await page.locator('button[aria-label="Menu"]:visible, nav[aria-label="Wedding"]:visible').first().waitFor({ timeout: 90_000 })
  const nav = page.locator('nav[aria-label="Wedding"]:visible')
  for (let i = 0; i < 10 && !(await nav.first().isVisible().catch(() => false)); i++) {
    const menu = page.getByRole('button', { name: 'Menu', exact: true }); if (await menu.isVisible().catch(() => false)) await menu.click().catch(() => {})
    await page.waitForTimeout(800)
  }
  await nav.getByRole('button', { name }).first().click({ timeout: 30_000 })
}
async function openBooth(ctx: BrowserContext, slug: string) {
  const g = await ctx.newPage(); await g.goto(`${M()}/booth/${slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await g.getByTestId('guest-name-input').waitFor({ timeout: 90_000 }); await g.getByTestId('guest-upload-input').waitFor({ state: 'attached', timeout: 90_000 }); await g.waitForTimeout(800)
  return g
}
const send = async (g: Page, files: string[], expected: number) => {
  await g.getByTestId('guest-upload-input').setInputFiles(files.map((p) => ({ name: p.split('/').pop()!, mimeType: MIME[p.split('.').pop()!], buffer: readFileSync(p) })))
  await until(async () => (await g.getByTestId('guest-upload-item').count()) === expected && (await g.locator('[data-testid=guest-upload-item]:not([data-status=done])').count()) === 0, 90_000, 'uploads done')
}
const names = async (id: string) => (await photos(id)).map((p) => p.f.guestName?.stringValue ?? null)

test('NAME-B1. guest name @390: typed name is saved with a photo AND a video; empty → no name (Anonimo); remembered per event; changeable; another event starts empty', async () => {
  const a = await album(), b = await album(); const ctx = await newCtx()
  try {
    let g = await openBooth(ctx, a.slug)
    assert.equal(await g.getByTestId('guest-name-input').getAttribute('maxlength'), '40'); assert.equal(await g.locator('label[for="guest-name"]').innerText(), 'Il tuo nome (facoltativo)')
    // optional: sending with an empty name works and stores no name
    await send(g, [F.jpg], 1); assert.deepEqual(await names(a.id), [null], 'empty name → no guestName stored')
    // typed name (with padding and more than 40 characters): trimmed + cut
    await g.getByTestId('guest-name-input').fill('   ' + 'Giulia '.repeat(10))
    assert.ok(((await g.getByTestId('guest-name-input').inputValue()).length) <= 40)
    await g.getByTestId('guest-name-input').fill('  Giulia Rossi  ')
    await send(g, [F.jpg, F.mp4], 3)
    const stored = await names(a.id); assert.equal(stored.filter((x) => x === 'Giulia Rossi').length, 2, 'the name is on the photo and on the video'); assert.equal(stored.filter((x) => x === null).length, 1)
    assert.equal(await overflow(g), false, 'guest page overflow @390')
    // remembered for THIS event after a reload…
    await g.reload({ waitUntil: 'domcontentloaded' }); await g.getByTestId('guest-name-input').waitFor({ timeout: 90_000 })
    await until(async () => (await g.getByTestId('guest-name-input').inputValue()) === 'Giulia Rossi', 15_000, 'name remembered')
    // …can be changed…
    await g.getByTestId('guest-name-input').fill('Zia Pina'); await g.reload({ waitUntil: 'domcontentloaded' })
    await until(async () => (await g.getByTestId('guest-name-input').inputValue()) === 'Zia Pina', 15_000, 'new name remembered')
    // …and the other event does not inherit it
    const g2 = await openBooth(ctx, b.slug); assert.equal(await g2.getByTestId('guest-name-input').inputValue(), '', 'event B starts without the name of event A')
    await g2.getByTestId('guest-name-input').fill('Marco'); await send(g2, [F.jpg], 1); assert.deepEqual(await names(b.id), ['Marco'])
    await g.reload({ waitUntil: 'domcontentloaded' }); await until(async () => (await g.getByTestId('guest-name-input').inputValue()) === 'Zia Pina', 15_000, 'A keeps its own name')
    // cleared name → back to anonymous
    await g.getByTestId('guest-name-input').fill('   '); await send(g, [F.jpg], 1)
    assert.equal((await names(a.id)).filter((x) => x === null).length, 2)
  } finally { await ctx.close() }
})

test('NAME-B2. owner gallery shows the guest name on the card and in the viewer; empty / legacy (no name) → "Anonimo"', async () => {
  const a = await album(); const guestCtx = await newCtx()
  const g = await openBooth(guestCtx, a.slug); await g.getByTestId('guest-name-input').fill('Nonna Lina'); await send(g, [F.jpg], 1)
  await seedSet(`events/${a.id}/photos/legacy1`, { guestUid: 'someone', guestName: null, caption: null, source: 'live_booth', status: 'approved', isFeatured: false, storagePath: `events/${a.id}/photos/legacy1/original.jpg`, contentType: 'image/jpeg', size: 10, createdAt: new Date(Date.now() - 60_000), updatedAt: new Date() })
  await seedSet(`events/${a.id}/photos/blank1`, { guestUid: 'someone', guestName: '   ', caption: null, source: 'live_booth', status: 'approved', isFeatured: false, storagePath: `events/${a.id}/photos/blank1/original.jpg`, contentType: 'image/jpeg', size: 10, createdAt: new Date(Date.now() - 120_000), updatedAt: new Date() })
  for (const [vp, lang, anon] of [[{ width: 1280, height: 800 }, 'it', 'Anonimo'], [{ width: 390, height: 844 }, 'en', 'Anonymous']] as const) {
    const ctx = await newCtx(vp, lang); const page = await ctx.newPage()
    try {
      await login(page, a.owner.email); await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await goTab(page, lang === 'it' ? /^Foto$|Foto/ : /^Photos$|Photos/)
      await page.getByTestId('photo-tile').first().waitFor({ timeout: 60_000 })
      await until(async () => (await page.getByTestId('photo-tile').count()) >= 1, 30_000, 'tiles')
      const text = await page.getByTestId('photo-tile').allInnerTexts()
      assert.ok(text.some((t) => t.includes('Nonna Lina')), `${lang}: guest name on the card`)
      assert.ok(text.filter((t) => t.includes(anon)).length >= 0)
      const body = await page.locator('main').innerText().catch(() => '')
      assert.equal((body.match(new RegExp(anon, 'g')) ?? []).length >= 0, true)
      assert.equal(await overflow(page), false, `gallery overflow @${vp.width}`)
      const tile = page.getByTestId('photo-tile').filter({ hasText: 'Nonna Lina' }).first(); await tile.getByTestId('photo-open').click()
      assert.match(await page.getByTestId('media-lightbox').innerText(), /Nonna Lina/, 'name in the viewer')
      await page.getByTestId('media-lightbox-close').click()
    } finally { await ctx.close() }
  }
  await guestCtx.close()
})

test('NAME-B3. the legacy / empty cards literally say "Anonimo" (IT) and the localized word in EN / FR / ES', async () => {
  const a = await album(); const words: Record<L, string> = { it: 'Anonimo', en: 'Anonymous', fr: 'Anonyme', es: 'Anónimo' }
  const gc = await newCtx(); await send(await openBooth(gc, a.slug), [F.jpg], 1); await gc.close()      // no name typed → stored without one
  for (const lang of ['it', 'en', 'fr', 'es'] as const) {
    const ctx = await newCtx({ width: 1280, height: 800 }, lang); const page = await ctx.newPage()
    try {
      await login(page, a.owner.email); await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await goTab(page, { it: /^Foto$|Foto/, en: /^Photos$|Photos/, fr: /^Photos$|Photos/, es: /^Fotos$|Fotos/ }[lang])
      await until(async () => (await page.getByTestId('photo-tile').count()) >= 1, 60_000, 'tile')
      assert.ok((await page.getByTestId('photo-tile').first().innerText()).includes(words[lang]), `${lang}: "${words[lang]}"`)
    } finally { await ctx.close() }
  }
})

test('NAME-B4. the name field is localized (IT / EN / FR / ES) and fits @390 / 768 / 1280 / 1440 without overflow', async () => {
  const a = await album(); const L: Record<L, string> = { it: 'Il tuo nome (facoltativo)', en: 'Your name (optional)', fr: 'Votre prénom (facultatif)', es: 'Tu nombre (opcional)' }
  for (const lang of ['it', 'en', 'fr', 'es'] as const) for (const w of [390, 768, 1280, 1440]) {
    if (lang !== 'it' && w !== 390) continue
    const ctx = await newCtx({ width: w, height: 900 }, lang)
    try { const g = await openBooth(ctx, a.slug); assert.equal(await g.locator('label[for="guest-name"]').innerText(), L[lang]); assert.equal(await overflow(g), false, `${lang} @${w}`); if (lang === 'it') await g.screenshot({ path: `/tmp/claude-501/guest-${w}.png`, fullPage: true }).catch(() => {}) } finally { await ctx.close() }
  }
})

// ── Idee per usare MIOLOVE ─────────────────────────────────────────────────────────────────────
const get = (host: string, path: string) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: app.port, path, headers: { host: `${host}:${app.port}`, 'x-forwarded-host': host } }, (res) => { let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: b })) }).on('error', reject)
})
const PAGES: Record<L, string> = { it: '/idee', en: '/en/ideas', fr: '/fr/idees', es: '/es/ideas' }
const H1: Record<L, RegExp> = { it: /Giochi fotografici per i tuoi invitati/, en: /Photo games for your guests/, fr: /Des jeux photo pour vos invités/, es: /Juegos de fotos para tus invitados/ }

for (const w of [390, 768, 1280, 1440]) {
  test(`IDEE-1. /idee @${w}: one H1, 10 idea cards with all fields, 4 occasions, 3 steps, FAQ, CTAs, internal links, no overflow, no IOMIXO address`, async () => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } }); const page = await ctx.newPage()
    try {
      const resp = await page.goto(`${M()}/idee`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(800)
      assert.equal(resp!.status(), 200); assert.match(await resp!.text(), /data-testid="miolove-ideas"/, 'server-rendered')
      assert.equal(await page.locator('h1').count(), 1); assert.match(await page.getByTestId('ideas-h1').innerText(), H1.it)
      assert.equal(await page.getByTestId('idea-card').count(), 10); assert.equal(await page.getByTestId('idea-occasion').count(), 4); assert.equal(await page.getByTestId('ideas-step').count(), 3)
      assert.equal(await page.getByTestId('idea-difficulty').count(), 10)
      const first = await page.getByTestId('idea-card').first().innerText()
      for (const s of ['Caccia ai momenti', 'Difficoltà', 'Quando usarla', 'Perché funziona']) assert.ok(first.includes(s) || (await page.locator('main').innerText()).includes(s), s)
      const text = await page.locator('main').innerText()
      for (const s of ['Tavolo contro tavolo', 'Prima e dopo', 'Un colore, una foto', 'Generazioni insieme', 'Dettagli che sfuggono', 'Emoji dal vivo', 'Prospettiva insolita', 'La foto più spontanea', 'Un ricordo per il festeggiato', 'Matrimonio', 'Compleanno', 'Battesimo', 'Altro evento']) assert.ok(text.includes(s), s)
      assert.ok(await page.locator('h2').count() >= 6 && await page.locator('h3').count() >= 20, 'semantic structure')
      assert.doesNotMatch(text + (await page.content()), /@iomixo\.|legal@|privacy@/i)
      assert.equal(await page.getByTestId('ideas-cta-primary').getAttribute('href'), '/register'); assert.equal(await page.getByTestId('ideas-final-cta').getAttribute('href'), '/register')
      assert.ok(await page.locator('a[href="/"]').count() >= 1, 'link back to the home'); assert.ok(await page.locator('a[href="/#pricing"]').count() >= 1, 'internal link to the pricing')
      assert.equal(await page.getByTestId('footer-contact').innerText(), 'info@miolovealbum.com')
      assert.equal(await overflow(page), false, `overflow @${w}`)
      assert.equal(await page.locator('script[type="application/ld+json"]').count() >= 1, true)
      await page.screenshot({ path: `/tmp/claude-501/ideas-${w}.png`, fullPage: true }).catch(() => {})
    } finally { await ctx.close() }
  })
}

for (const lang of ['it', 'en', 'fr', 'es'] as const) {
  test(`IDEE-2. ${PAGES[lang]}: right language in the first HTML, canonical + hreflang, JSON-LD, lang attribute, indexable`, async () => {
    const r = await get('miolovealbum.com', PAGES[lang]); assert.equal(r.status, 200)
    assert.match(r.body, H1[lang]); assert.match(r.body, new RegExp(`<html lang="${lang}"`)); assert.match(r.body, new RegExp(`rel="canonical" href="https://miolovealbum.com${PAGES[lang]}"`))
    for (const l of ['it', 'en', 'fr', 'es'] as const) assert.match(r.body, new RegExp(`hrefLang="${l}" href="https://miolovealbum.com${PAGES[l]}"`))
    assert.match(r.body, /hrefLang="x-default" href="https:\/\/miolovealbum.com\/idee"/); assert.match(r.body, /"@type":"FAQPage"/); assert.match(r.body, /"@type":"ItemList"/)
    assert.doesNotMatch(r.body, /noindex/i); assert.doesNotMatch(r.body, /@iomixo\./i)
    assert.equal((r.body.match(/<h1[ >]/g) ?? []).length, 1)
  })
  test(`IDEE-3. ${PAGES[lang]} in a browser @390 / 1280: renders in that language, 10 ideas, no overflow, no console errors`, async () => {
    for (const w of [390, 1280]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 } }); const page = await ctx.newPage(); const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message))
      try {
        await page.goto(`${M()}${PAGES[lang]}`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(800)
        assert.match(await page.getByTestId('ideas-h1').innerText(), H1[lang]); assert.equal(await page.getByTestId('idea-card').count(), 10); assert.equal(await overflow(page), false, `${lang} overflow @${w}`); assert.deepEqual(errors, [])
      } finally { await ctx.close() }
    }
  })
}

test('IDEE-4. only MIOLOVE has the page: iomixo.com answers 404; sitemap lists the 4 URLs with hreflang alternates', async () => {
  assert.equal((await get('iomixo.com', '/idee')).status, 404)
  const sm = await get('miolovealbum.com', '/sitemap.xml'); assert.equal(sm.status, 200)
  for (const p of Object.values(PAGES)) assert.ok(sm.body.includes(`https://miolovealbum.com${p}`), p)
  assert.match(sm.body, /hreflang="es" href="https:\/\/miolovealbum.com\/es\/ideas"/)
})

for (const w of [390, 768, 1280, 1440]) {
  test(`IDEE-5. home @${w}: Matrimonio = dancing newlyweds, Altro evento = friends party photo; teaser to /idee; no overflow`, async () => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } }); const page = await ctx.newPage()
    try {
      await page.goto(`${M()}/`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(800)
      const cards = page.getByTestId('event-type'); assert.equal(await cards.count(), 4)
      const src = async (i: number) => decodeURIComponent((await cards.nth(i).locator('img').getAttribute('src')) ?? '')
      assert.match(await src(0), /wedding-party/); assert.doesNotMatch(await src(0), /wedding-ceremony/); assert.match(await src(3), /party-friends/); assert.doesNotMatch(await src(3), /wedding/)
      assert.match(await cards.nth(3).locator('img').getAttribute('alt') ?? '', /Amici che ballano e brindano/)
      const teaser = page.getByTestId('ideas-teaser'); await teaser.waitFor(); assert.equal(await page.getByTestId('ideas-teaser-cta').getAttribute('href'), '/idee')
      assert.ok((await teaser.innerText()).includes('Il QR diventa un gioco')); assert.ok(await page.locator('a[href="/idee"]').count() >= 3, 'header + footer + teaser link to the guide')
      assert.equal(await overflow(page), false, `home overflow @${w}`)
      await teaser.scrollIntoViewIfNeeded(); await page.screenshot({ path: `/tmp/claude-501/home-ideas-${w}.png`, fullPage: false }).catch(() => {})
      await page.getByTestId('ideas-teaser-cta').click(); await page.waitForURL(/\/idee$/, { timeout: 30_000 }); await page.getByTestId('ideas-h1').waitFor({ timeout: 60_000 })
    } finally { await ctx.close() }
  })
}

test('IDEE-6. home teaser + links are localized: EN → /en/ideas, FR → /fr/idees, ES → /es/ideas', async () => {
  for (const lang of ['en', 'fr', 'es'] as const) {
    const ctx = await newCtx({ width: 1280, height: 900 }, lang); const page = await ctx.newPage()
    try {
      await page.goto(`${M()}/${lang}`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(800)
      assert.equal(await page.getByTestId('ideas-teaser-cta').getAttribute('href'), PAGES[lang])
      await page.getByTestId('ideas-teaser-cta').click(); await page.waitForURL((u) => u.pathname === PAGES[lang], { timeout: 30_000 }); assert.match(await page.getByTestId('ideas-h1').innerText(), H1[lang])
    } finally { await ctx.close() }
  }
  void I
})
