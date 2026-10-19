import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

/**
 * Two portals, one Firebase project: the real hostnames (iomixo.com / miolovealbum.com) are mapped to the local dev server by Chrome, so detection,
 * metadata, redirects and links all run exactly as on the real domains. NEXT_PUBLIC_MIOLOVE_LIVE=true = the MIOLOVE domain is connected.
 */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' }); browser = await launchPortals(app) })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const I = () => portalUrl(app, 'iomixo.com'), M = () => portalUrl(app, 'miolovealbum.com')
const LEGACY = /mashup|\bAI\b|stem separation|BPM|producer|composer|studio/i
const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 20_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
const head = (p: Page) => p.evaluate(() => ({
  title: document.title, canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
  ogSite: document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ?? null, ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? null,
  ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null, description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
}))
async function signIn(page: Page, base: string, email: string) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1200)
  await page.locator('input[type="email"]').fill(email); await page.locator('input[type="password"]').fill('password123'); await page.locator('button[type="submit"]').click()
}
/** Logs (from the first paint of every document) which of these strings were EVER visible: a cross-brand flash would show up here. */
async function trackPaint(page: Page, words: string[]) {
  const seen = new Set<string>()
  page.on('console', (m) => { const t = m.text(); if (t.startsWith('__SEEN:')) seen.add(t.slice(7)) })
  await page.addInitScript((w) => {
    const done = new Set<string>()
    const scan = () => { const t = document.body?.innerText ?? ''; for (const x of w) if (!done.has(x) && t.includes(x)) { done.add(x); console.log('__SEEN:' + x) } }
    const start = () => { new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, characterData: true }); scan() }
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start)
  }, words)
  return seen
}

for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`PT1. iomixo.com @${vp.width}: DJ register (no role choice) + login, IOMIXO brand only, own metadata`, async () => {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    try {
      await page.goto(`${I()}/register`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(800)
      for (const gone of ['account-type-choice', 'account-type-dj', 'account-type-couple']) assert.equal(await page.getByTestId(gone).count(), 0, gone)
      const text = await page.evaluate(() => document.body.innerText)
      assert.doesNotMatch(text, /Come vuoi usare la piattaforma|MIOLOVE|Sposi|Album|matrimonio/i, 'no MIOLOVE / Sposi / choice on the IOMIXO register page')
      assert.doesNotMatch(text, LEGACY)
      await page.locator(':visible', { hasText: /^Porta il tuo evento a un altro livello\.$/ }).first().waitFor({ timeout: 10_000 })
      assert.ok(await page.getByText('Karaoke e modalità Party').first().count() > 0)
      assert.ok(await page.locator('img[alt="IOMIXO Logo"]:visible').first().isVisible()); assert.equal(await page.locator('[role="img"][aria-label="MIOLOVE ALBUM"]').count(), 0)
      assert.equal(await page.locator('[data-portal]').first().getAttribute('data-portal'), 'iomixo')
      assert.equal(await overflow(page), false, 'register overflow')
      const h = await head(page)
      assert.match(h.title, /IOMIXO/); assert.equal(h.canonical, 'https://iomixo.com'); assert.equal(h.ogSite, 'IOMIXO Live Hub'); assert.equal(h.ogUrl, 'https://iomixo.com')
      assert.doesNotMatch(JSON.stringify(h), /MIOLOVE/i, 'IOMIXO metadata never mentions MIOLOVE')

      await page.goto(`${I()}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(800)
      const lt = await page.evaluate(() => document.body.innerText)
      assert.match(lt, /Accedi per gestire eventi, richieste e regia live\./); assert.doesNotMatch(lt, /MIOLOVE|Sposi|matrimonio|studio/i); assert.doesNotMatch(lt, LEGACY)
      assert.equal(await page.locator('[data-portal]').first().getAttribute('data-portal'), 'iomixo'); assert.equal(await overflow(page), false, 'login overflow')
      // the IOMIXO landing is untouched
      await page.goto(`${I()}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); assert.equal(new URL(page.url()).pathname, '/')
    } finally { await ctx.close() }
  })

  test(`PT2. miolovealbum.com @${vp.width}: Sposi register (no role choice) + login, MIOLOVE only, own metadata, SSR without cross-brand flash`, async () => {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    try {
      const resp = await page.goto(`${M()}/register`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(800)
      const ssr = await resp!.text()                                    // the server-rendered HTML, before any client code runs
      assert.match(ssr, /data-portal="miolove"/); assert.doesNotMatch(ssr, /data-portal="iomixo"/, 'the first paint is already MIOLOVE')
      assert.doesNotMatch(ssr, /Live Hub|IOMIXO Logo|iomixo-logo/i, 'no IOMIXO brand in the server HTML of a MIOLOVE page')
      for (const gone of ['account-type-choice', 'account-type-dj', 'account-type-couple']) assert.equal(await page.getByTestId(gone).count(), 0, gone)
      const text = await page.evaluate(() => document.body.innerText)
      assert.doesNotMatch(text, /Come vuoi usare la piattaforma|IOMIXO|Live Hub|Party|karaoke|Regia|Remote|DJ Example/i)
      assert.doesNotMatch(text, LEGACY)
      await page.locator(':visible', { hasText: /^Il tuo matrimonio, raccontato da chi lo vive\.$/ }).first().waitFor({ timeout: 10_000 })
      assert.ok(await page.locator('[role="img"][aria-label="MIOLOVE ALBUM"]:visible').first().isVisible()); assert.equal(await page.locator('img[alt="IOMIXO Logo"]').count(), 0)
      assert.equal(await overflow(page), false, 'register overflow')
      const h = await head(page)
      assert.equal(h.title, 'MIOLOVE ALBUM'); assert.equal(h.canonical, 'https://miolovealbum.com'); assert.equal(h.ogSite, 'MIOLOVE ALBUM'); assert.match(h.ogTitle ?? '', /MIOLOVE/); assert.equal(h.ogUrl, 'https://miolovealbum.com')
      assert.match(h.description ?? '', /album|foto/i)
      assert.doesNotMatch(JSON.stringify(h), /IOMIXO/i, 'MIOLOVE metadata never mentions IOMIXO')

      await page.goto(`${M()}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(800)
      const lt = await page.evaluate(() => document.body.innerText)
      assert.match(lt, /Accedi per gestire il tuo album matrimonio\./); assert.doesNotMatch(lt, /IOMIXO|Live Hub|DJ|Party|studio/i); assert.doesNotMatch(lt, LEGACY)
      assert.equal(await page.locator('[data-portal]').first().getAttribute('data-portal'), 'miolove'); assert.equal(await overflow(page), false, 'login overflow')
      for (const other of ['forgot-password', 'verify-email']) {
        await page.goto(`${M()}/${other}`, { waitUntil: 'networkidle', timeout: 120_000 })
        assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /IOMIXO|\bAI\b/, `${other}: no IOMIXO / legacy AI brand`)
        assert.equal(await overflow(page), false, `${other} overflow`)
      }
      // MIOLOVE has no marketing landing: the root goes to the sign-in
      await page.goto(`${M()}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForURL(/\/login$/, { timeout: 30_000 })
    } finally { await ctx.close() }
  })
}

test('PT3. sign-up on iomixo.com saves accountType dj with no choice; unknown host (127.0.0.1) falls back to the IOMIXO portal', async () => {
  const ctx = await browser.newContext(); const page = await ctx.newPage(); const email = `djreg${Date.now()}@example.com`
  try {
    await page.goto(`${I()}/register`, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.locator('input[type="text"]').first().fill('DJ Test'); await page.locator('input[type="email"]').fill(email); await page.locator('input[type="password"]').fill('password123')
    await page.locator('button[type="submit"]').click()
    await page.getByText(/Check your inbox|Controlla la tua casella/i).first().waitFor({ timeout: 60_000 })
    assert.equal(await page.getByTestId('register-continue').count(), 0, 'no Sposi continue button for a DJ')
    const u = await until(async () => ((await fsGet('users?pageSize=1000')).documents ?? []).find((d: any) => d.fields.email?.stringValue === email), 20_000, 'users doc')
    assert.equal(u.fields.accountType.stringValue, 'dj')
    await page.goto(`${app.url}/register`, { waitUntil: 'networkidle', timeout: 120_000 })
    assert.equal(await page.locator('[data-portal]').first().getAttribute('data-portal'), 'iomixo', 'safe default on a non-portal host')
  } finally { await ctx.close() }
})

test('PT4. the domain decides the product: a couple-typed account on iomixo.com stays on IOMIXO, a dj-typed account on miolovealbum.com stays on MIOLOVE — no cross-domain redirect, no wrong UI painted', async () => {
  const couple = await newClient('account'), dj = await newClient('account')
  await seedSet(`users/${couple.uid}`, { uid: couple.uid, email: couple.email, accountType: 'couple', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, email: dj.email, accountType: 'dj', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  const hostsVisited = (page: Page) => { const hosts = new Set<string>(); page.on('framenavigated', (f) => { if (f === page.mainFrame() && /^https?:/.test(f.url())) hosts.add(new URL(f.url()).hostname) }); return hosts }

  // couple-typed account on IOMIXO
  let ctx = await browser.newContext(); let page = await ctx.newPage(); let hosts = hostsVisited(page)
  try {
    await signIn(page, I(), couple.email)
    await page.waitForURL(/iomixo\.com:\d+\/dashboard/, { timeout: 60_000 })
    await page.getByText('Profilo DJ').first().waitFor({ timeout: 60_000 })
    await page.waitForTimeout(3000)
    assert.deepEqual(Array.from(hosts), ['iomixo.com'], 'never left iomixo.com')
    // a Sposi-only path and a DJ path both stay on the same domain
    await page.goto(`${I()}/sessions`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000)
    assert.equal(new URL(page.url()).hostname, 'iomixo.com'); assert.match(new URL(page.url()).pathname, /^\/sessions$/)
  } finally { await ctx.close() }

  // dj-typed account on MIOLOVE
  ctx = await browser.newContext(); page = await ctx.newPage(); hosts = hostsVisited(page)
  const seen = await trackPaint(page, ['Regia DJ', 'Profilo DJ', 'Prossime date', 'Sessioni Live', 'Party Mode'])
  try {
    await signIn(page, M(), dj.email)
    await page.getByTestId('couple-onboarding').waitFor({ timeout: 60_000 })
    assert.match(page.url(), /miolovealbum\.com:\d+\/onboarding/)
    // DJ-only URLs on MIOLOVE are replaced on the SAME domain
    for (const route of ['/events', '/dashboard', '/profile']) {
      await page.goto(`${M()}${route}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForURL(/\/(sessions|onboarding)$/, { timeout: 60_000 })
      assert.equal(new URL(page.url()).hostname, 'miolovealbum.com', route)
    }
    assert.deepEqual(Array.from(hosts), ['miolovealbum.com'], 'never left miolovealbum.com')
    assert.deepEqual(Array.from(seen), [], 'no DJ UI was painted on miolovealbum.com')
  } finally { await ctx.close() }
})

test('PT5. public links: Sposi album → miolovealbum.com, Wedding DJ and Party → iomixo.com, Remote stays on iomixo.com', async () => {
  const dj = await newClient('account'), couple = await newClient('account'), stamp = Date.now()
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, email: dj.email, accountType: 'dj', plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`users/${couple.uid}`, { uid: couple.uid, email: couple.email, accountType: 'couple', plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  const wedSlug = `lw${stamp}`, partySlug = `lp${stamp}`, coupleSlug = `lc${stamp}`
  for (const [id, slug, owner, type] of [[`lwid${stamp}`, wedSlug, dj.uid, 'wedding'], [`lpid${stamp}`, partySlug, dj.uid, 'party'], [`lcid${stamp}`, coupleSlug, couple.uid, 'wedding']] as const) {
    await seedSet(`events/${id}`, eventFields(owner, slug, { type, title: `Evento ${slug}`, legacySupabaseId: undefined, ...(slug === coupleSlug ? { accessMode: 'activated' } : {}) })); await seedSet(`eventSlugs/${slug}`, { eventId: id })
  }
  // DJ on iomixo.com
  let ctx = await browser.newContext(); let page = await ctx.newPage()
  try {
    await signIn(page, I(), dj.email); await page.waitForURL(/\/dashboard/, { timeout: 60_000 })
    await page.goto(`${I()}/sessions/lwid${stamp}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText(`https://iomixo.com/live/${wedSlug}`, { exact: true }).waitFor({ timeout: 60_000 })
    assert.equal(await page.locator(`a[href*="miolovealbum.com"]`).count(), 0, 'no MIOLOVE link on a Wedding DJ event')
    assert.ok(await page.locator(`a[href="https://iomixo.com/remote/${wedSlug}"]`).count() > 0, 'the Wedding Remote link stays on IOMIXO')
    assert.equal(await page.getByText(`miolovealbum.com/remote`).count(), 0)
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: I() })
    await page.goto(`${I()}/sessions/lpid${stamp}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: /Copia link/ }).first().click({ timeout: 60_000 })
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `https://iomixo.com/live/${partySlug}`, 'the copied Party link is IOMIXO')
    assert.ok(await page.locator(`a[href="https://iomixo.com/screen/${partySlug}"]`).count() > 0, 'Party TV link is IOMIXO')
    assert.equal(await page.getByRole('button', { name: /Live Booth/ }).count(), 0, 'no Live Booth on a Party event')
    assert.equal(await page.locator('a[href*="/booth/"]').count(), 0, 'no Live Booth link on a Party event')
    assert.equal(await page.locator(`a[href*="miolovealbum.com"]`).count(), 0, 'no MIOLOVE link on a Party event')
  } finally { await ctx.close() }
  // Sposi on miolovealbum.com
  ctx = await browser.newContext(); page = await ctx.newPage()
  try {
    await signIn(page, M(), couple.email); await page.waitForURL(/\/sessions/, { timeout: 60_000 })
    await page.goto(`${M()}/sessions/lcid${stamp}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText(`https://miolovealbum.com/live/${coupleSlug}`, { exact: true }).waitFor({ timeout: 60_000 })
    assert.equal(await page.locator('a[href*="/remote/"]').count(), 0, 'no Remote DJ for Sposi')
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /iomixo/i, 'no IOMIXO text in the Sposi album Home')
  } finally { await ctx.close() }
})

/** What a browser on `host` is told about the installable app and its icons (links in <head>, the manifest they point at, the bare /favicon.ico). */
async function brandAssets(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 })
  return page.evaluate(async () => {
    const manifestHref = document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? ''
    const manifest = await (await fetch(manifestHref)).json()
    const bare = await fetch('/favicon.ico', { redirect: 'follow' })
    return { icons: Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')).map((l) => l.getAttribute('href') ?? ''), manifest, themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'), bare: { status: bare.status, url: new URL(bare.url).pathname } }
  })
}

test('PT6. manifest, theme-color and icons are per portal: IOMIXO dark/pink, MIOLOVE light/pink, no IOMIXO icon on MIOLOVE', async () => {
  const ctx = await browser.newContext(); const page = await ctx.newPage()
  try {
    const i = await brandAssets(page, `${I()}/login`)
    assert.equal(i.manifest.name, 'IOMIXO Live Hub'); assert.equal(i.manifest.theme_color, '#0A0A0D'); assert.equal(i.manifest.background_color, '#0A0A0D'); assert.equal(i.themeColor, '#0A0A0D')
    assert.ok(i.icons.length > 0 && i.icons.every((h) => !/miolove/i.test(h)), `IOMIXO icons: ${i.icons}`)
    assert.deepEqual([i.bare.status, i.bare.url], [200, '/brand/iomixo/favicon.ico'])
    const m = await brandAssets(page, `${M()}/login`)
    assert.equal(m.manifest.name, 'MIOLOVE ALBUM'); assert.equal(m.manifest.theme_color, '#F06A9B'); assert.equal(m.manifest.background_color, '#FFFDFB'); assert.equal(m.themeColor, '#F06A9B')
    assert.ok(m.icons.length > 0 && m.icons.every((h) => /miolove/i.test(h)), `MIOLOVE icons must all be MIOLOVE assets: ${m.icons}`)
    assert.ok(m.manifest.icons.every((x: any) => /miolove/i.test(x.src)), 'MIOLOVE manifest icons')
    assert.doesNotMatch(JSON.stringify(m.manifest), /iomixo|8F1D2C/i)
    assert.deepEqual([m.bare.status, m.bare.url], [200, '/brand/miolove/favicon.ico'])
    assert.doesNotMatch(JSON.stringify(i.manifest), /8F1D2C/i)
  } finally { await ctx.close() }
})

const LEGAL_LEGACY = /\bAI\b|artificial intelligence|mashup|\bstems?\b|\bBPM\b|credits?\b|transformation|Vercel|DMCA/i

for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`PT7. /privacy and /terms are brand-aware @${vp.width}: MIOLOVE never shows IOMIXO (title, header, footer), IOMIXO stays dark`, async () => {
    const ctx = await browser.newContext({ viewport: vp, locale: 'en-US' }); const page = await ctx.newPage()
    try {
      for (const route of ['/privacy', '/terms']) {
        await page.goto(`${M()}${route}`, { waitUntil: 'networkidle', timeout: 120_000 })
        const text = await page.evaluate(() => document.body.innerText)
        assert.match(await page.title(), /MIOLOVE ALBUM/); assert.match(text, /MIOLOVE ALBUM/)
        assert.doesNotMatch(await page.title(), /IOMIXO/); assert.doesNotMatch(text.replace(/@iomixo\.com/g, ''), /IOMIXO|Live Hub/, `${route}: no IOMIXO brand on MIOLOVE`)
        assert.doesNotMatch(text, LEGAL_LEGACY, `${route}: no legacy AI/music/Vercel text`); assert.doesNotMatch(text, /\bDJs?\b|\bParty\b/, `${route}: no DJ/Party on MIOLOVE`)
        assert.equal(await page.locator('img[alt="IOMIXO Logo"]').count(), 0); assert.ok(await page.locator('[role="img"][aria-label="MIOLOVE ALBUM"]:visible').first().isVisible())
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[style*="--lg-bg"]')!).backgroundColor), 'rgb(255, 247, 250)')
        assert.equal(await overflow(page), false, `${M()}${route} overflow`)
        await page.goto(`${I()}${route}`, { waitUntil: 'networkidle', timeout: 120_000 })
        const itext = await page.evaluate(() => document.body.innerText)
        assert.match(await page.title(), /IOMIXO|Privacy|Terms/); assert.doesNotMatch(itext, /MIOLOVE|Sposi|album matrimonio/i); assert.doesNotMatch(itext, LEGAL_LEGACY, `${route}: no legacy AI/music/Vercel text on IOMIXO`)
        assert.match(itext, route === '/terms' ? /Live Booth/ : /Firebase App Hosting/)
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[style*="--lg-bg"]')!).backgroundColor), 'rgb(10, 10, 13)')
        assert.equal(await overflow(page), false, `${I()}${route} overflow`)
      }
    } finally { await ctx.close() }
  })
}

/** Raw request with an explicit Host header (no redirect following): what App Hosting forwards for the custom domains. */
const rawGet = (host: string, path: string) => new Promise<{ status: number; location: string | null }>((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: app.port, path, headers: { host: `${host}:${app.port}`, 'x-forwarded-host': host } }, (res) => { res.resume(); resolve({ status: res.statusCode ?? 0, location: (res.headers.location as string | undefined) ?? null }) }).on('error', reject)
})

test('PT8. www.miolovealbum.com is a permanent alias of the apex (path + query kept); apex, IOMIXO hosts and dev hosts are never redirected that way', async () => {
  for (const [path, to] of [['/', 'https://miolovealbum.com/'], ['/login', 'https://miolovealbum.com/login'], ['/live/abc?x=1', 'https://miolovealbum.com/live/abc?x=1'], ['/register', 'https://miolovealbum.com/register']] as const) {
    const r = await rawGet('www.miolovealbum.com', path)
    assert.equal(r.status, 308, path); assert.equal(r.location, to, path)
  }
  const apexRoot = await rawGet('miolovealbum.com', '/'); assert.equal(apexRoot.status, 307); assert.match(apexRoot.location ?? '', /\/login$/)
  assert.equal((await rawGet('miolovealbum.com', '/login')).status, 200)
  for (const host of ['iomixo.com', 'www.iomixo.com']) { const r = await rawGet(host, '/login'); assert.equal(r.status, 200, host); assert.equal(r.location, null) }
  assert.equal((await rawGet('127.0.0.1', '/login')).status, 200)
})

test('PT9. every Function shares one CORS allow-list with both IOMIXO and both MIOLOVE origins (the emulator reflects any origin, so the source list is what is asserted)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../../../../firebase/functions/src/index.ts', import.meta.url), 'utf8')
  const list = /cors:\s*\[([^\]]+)\]/.exec(src)?.[1] ?? ''
  for (const origin of ['https://iomixo.com', 'https://www.iomixo.com', 'https://miolovealbum.com', 'https://www.miolovealbum.com']) assert.ok(list.includes(`'${origin}'`), origin)
  assert.equal((src.match(/cors:/g) ?? []).length, 2, 'one allow-list (guestCallOptions) + the webhook cors:false; callables must all derive from guestCallOptions')
  const emu = await fetch('http://127.0.0.1:5001/demo-iomixo/europe-west1/getPublicEvent', { method: 'OPTIONS', headers: { origin: 'https://www.miolovealbum.com', 'access-control-request-method': 'POST' } })
  assert.equal(emu.headers.get('access-control-allow-origin'), 'https://www.miolovealbum.com')
})

/** The value encoded by every visible QR on the page (read from the React props, so what a phone would scan). */
const qrValues = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('svg')).filter((el) => el.getBoundingClientRect().width >= 60).map((el: any) => {
  const k = Object.keys(el).find((x) => x.startsWith('__reactFiber')); let f = k ? el[k] : null
  while (f) { const v = f.memoizedProps?.value; if (typeof v === 'string' && /^https?:/.test(v)) return v; f = f.return }
  return null
}).filter(Boolean) as string[])
const NO_DJ = /\bDJs?\b|\bParty\b|Brano al DJ|Regia/i

for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`PT10. Sposi album on miolovealbum.com @${vp.width}: clean logo, no DJ copy, Photos tab shows guest link + QR, booth, poster — all MIOLOVE`, async () => {
    const couple = await newClient('account')
    await seedSet(`users/${couple.uid}`, { uid: couple.uid, email: couple.email, accountType: 'couple', plan: { tier: 'wedding', source: 'legacy' }, miolovePlan: { tier: 'wedding', source: 'stripe' }, createdAt: new Date(), updatedAt: new Date() })
    const ctx = await browser.newContext({ viewport: vp }); await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: M() }); const page = await ctx.newPage()
    await page.addInitScript('window.__name = (f) => f')
    try {
      // MIOLOVE logo: the transparent asset, never the ivory canvas that shows as a box on the tinted page
      await page.goto(`${M()}/register`, { waitUntil: 'networkidle', timeout: 120_000 })
      const logoSrc = await page.locator('[role="img"][aria-label="MIOLOVE ALBUM"]:visible img').first().getAttribute('src')
      assert.match(logoSrc ?? '', /miolove-album-logo\.png/); assert.doesNotMatch(logoSrc ?? '', /on-light|on-dark/)
      assert.equal(await overflow(page), false, 'register overflow')

      await signIn(page, M(), couple.email); await page.waitForURL(/\/sessions/, { timeout: 60_000 })
      await page.getByTestId('onboarding-name').fill('Album di prova', { timeout: 60_000 })
      await page.getByTestId('onboarding-create').click()
      await page.waitForURL(/\/sessions\/[^/]+$/, { timeout: 60_000 })
      const eventId = page.url().split('/sessions/')[1]
      const ev = (await until(async () => (await fsGet(`events/${eventId}`)).fields, 20_000, 'album created'))
      const slug = ev.slug.stringValue
      assert.equal(ev.guestConfig?.mapValue?.fields?.requests?.booleanValue, false, 'a Sposi album starts with song requests off')
      assert.equal(ev.guestConfig?.mapValue?.fields?.live_booth?.booleanValue, true, 'and the photo entry point on')
      const guestUrl = `https://miolovealbum.com/live/${slug}`, boothUrl = `https://miolovealbum.com/booth/${slug}`

      const openTab = async (label: string) => {
        const btn = page.getByRole('button', { name: new RegExp(`^${label}`) }).first()
        if (!(await btn.isVisible())) await page.locator('.wedding-admin header button[aria-label="Menu"]').click()
        await btn.click(); await page.waitForTimeout(800)
      }
      // Home: guest preview has no "send your song to the DJ"
      await page.getByTestId('wd-guest-preview').waitFor({ timeout: 60_000 })
      const home = await page.evaluate(() => document.body.innerText)
      assert.doesNotMatch(home, NO_DJ, 'Home: no DJ / Party copy'); assert.doesNotMatch(await page.getByTestId('wd-guest-preview').innerText(), /DJ|canzone/i)
      assert.ok((await qrValues(page)).includes(guestUrl), 'Home QR'); assert.equal(await overflow(page), false, 'home overflow')

      // Photos: guest link + QR + copy + open, then the Live Booth
      await openTab('Foto')
      const card = page.getByTestId('wd-photos-guest-link'); await card.waitFor({ timeout: 30_000 })
      assert.deepEqual(await qrValues(page), [guestUrl], 'Photos QR = guest link'); assert.equal(await card.getByText(guestUrl).count(), 1)
      await card.getByRole('button', { name: /Copia link/ }).click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), guestUrl)
      assert.equal(await card.locator('a').first().getAttribute('href'), guestUrl)
      assert.doesNotMatch(await page.evaluate(() => document.body.innerText), NO_DJ, 'Photos: no DJ / Party copy'); assert.equal(await overflow(page), false, 'photos overflow')
      await page.getByRole('button', { name: /^Live Booth/ }).first().click(); await page.waitForTimeout(800)
      assert.deepEqual(await qrValues(page), [boothUrl], 'Booth QR')
      await page.getByRole('button', { name: /Copia link/ }).first().click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), boothUrl)
      assert.ok(await page.locator(`a[href="${boothUrl}"]`).count() > 0, 'Open booth'); assert.equal(await overflow(page), false, 'booth overflow')

      // Poster
      await openTab('Poster')
      await page.getByTestId('poster-preview').waitFor({ timeout: 30_000 })
      assert.equal(await page.getByTestId('poster-preview').getAttribute('data-qr-value'), guestUrl, 'Poster QR'); assert.doesNotMatch(await page.evaluate(() => document.body.innerText), NO_DJ, 'Poster: no DJ / Party copy')
      assert.equal(await overflow(page), false, 'poster overflow')
      assert.equal(await page.locator('a[href*="iomixo.com"]').count(), 0, 'no iomixo.com link anywhere in the Sposi album')

      // What a guest scanning the QR really gets: a photo action, no song request
      const guest = await ctx.newPage()
      await guest.goto(`${M()}/live/${slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await guest.getByText('Invia una foto').first().waitFor({ timeout: 60_000 })
      const gt = await guest.evaluate(() => document.body.innerText)
      assert.doesNotMatch(gt, /canzone|brano|\bDJ\b/i, 'guest page: no song request'); assert.equal(await overflow(guest), false, 'guest overflow')
    } finally { await ctx.close() }
  })
}

test('PT11. DJ Wedding (iomixo.com) is IOMIXO: guest preview offers song requests and no photos, guest and Remote links are both IOMIXO, no MIOLOVE logo', async () => {
  const dj = await newClient('account'), stamp = Date.now(), slug = `djreg${stamp}`, id = `djregid${stamp}`
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, email: dj.email, accountType: 'dj', plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${id}`, eventFields(dj.uid, slug, { type: 'wedding', title: `Nozze ${slug}`, legacySupabaseId: undefined })); await seedSet(`eventSlugs/${slug}`, { eventId: id })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage()
  await page.addInitScript('window.__name = (f) => f')
  try {
    await signIn(page, I(), dj.email); await page.waitForURL(/\/dashboard/, { timeout: 60_000 })
    await page.goto(`${I()}/sessions/${id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTestId('wd-guest-preview').waitFor({ timeout: 60_000 })
    assert.match(await page.getByTestId('wd-guest-preview').innerText(), /Invia il tuo brano al DJ/)
    assert.doesNotMatch(await page.getByTestId('wd-guest-preview').innerText(), /Live Booth|Invia una foto/i, 'no photo action in the Wedding DJ guest preview')
    const q = await qrValues(page); assert.ok(q.includes(`https://iomixo.com/live/${slug}`) && q.includes(`https://iomixo.com/remote/${slug}`), q.join(' '))
    assert.ok(!q.some((v) => v.includes('miolovealbum.com')), q.join(' '))
    assert.equal(await page.locator('[role="img"][aria-label="MIOLOVE ALBUM"]').count(), 0, 'no MIOLOVE logo for a DJ')
  } finally { await ctx.close() }
})

test('PT12. QR / links of the wrong domain move to the event\'s own portal (path, slug and query kept); historic couple album included; Party Live Booth is blocked', async () => {
  const dj = await newClient('account'), couple = await newClient('account'), old = await newClient('account'), stamp = Date.now()
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, email: dj.email, accountType: 'dj', plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`users/${couple.uid}`, { uid: couple.uid, email: couple.email, accountType: 'couple', plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`users/${old.uid}`, { uid: old.uid, email: old.email, accountType: 'couple', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  const evs = { djw: `rdw${stamp}`, party: `rdp${stamp}`, album: `rda${stamp}`, historic: `rdh${stamp}` }
  for (const [id, slug, owner, type, extra] of [
    [`id${evs.djw}`, evs.djw, dj.uid, 'wedding', {}], [`id${evs.party}`, evs.party, dj.uid, 'party', {}],
    [`id${evs.album}`, evs.album, couple.uid, 'wedding', { accessMode: 'activated' }], [`id${evs.historic}`, evs.historic, old.uid, 'wedding', {}],
  ] as const) { await seedSet(`events/${id}`, eventFields(owner, slug, { type, title: `Evento ${slug}`, legacySupabaseId: undefined, ...extra })); await seedSet(`eventSlugs/${slug}`, { eventId: id }) }
  const ctx = await browser.newContext(); const page = await ctx.newPage()
  // The redirect target is the canonical production origin (https, no dev port): capture it instead of following it.
  const jumps: string[] = []
  await page.route(/^https:\/\/(www\.)?(iomixo|miolovealbum)\.com\//, (route) => { jumps.push(route.request().url()); return route.abort() })
  const jumpTo = async (from: string, expected: string) => {
    jumps.length = 0
    await page.goto(from, { waitUntil: 'domcontentloaded', timeout: 120_000 }).catch(() => {})
    const t0 = Date.now(); while (!jumps.length && Date.now() - t0 < 60_000) await page.waitForTimeout(250)
    const got = jumps[0]
    await page.waitForTimeout(800); await page.goto('about:blank').catch(() => {})   // let the aborted navigation settle before the next one
    assert.equal(got, expected, `${from} → ${got}`)
  }
  try {
    await jumpTo(`${M()}/live/${evs.djw}?x=1#h`, `https://iomixo.com/live/${evs.djw}?x=1#h`.replace('#h', ''))
    await jumpTo(`${M()}/live/${evs.party}`, `https://iomixo.com/live/${evs.party}`)
    await jumpTo(`${I()}/live/${evs.album}`, `https://miolovealbum.com/live/${evs.album}`)
    await jumpTo(`${I()}/live/${evs.historic}`, `https://miolovealbum.com/live/${evs.historic}`)
    // already on the right portal: no redirect, no loop
    jumps.length = 0
    await page.goto(`${M()}/live/${evs.album}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForTimeout(5000)
    assert.deepEqual(jumps, [], 'no redirect on the right portal')
    assert.equal(new URL(page.url()).hostname, 'miolovealbum.com')
    // Party Live Booth on iomixo.com: blocked, no upload control
    await page.goto(`${I()}/booth/${evs.party}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText('Il Live Booth non è disponibile per questo evento.').waitFor({ timeout: 60_000 })
    assert.equal(await page.locator('input[type="file"]').count(), 0)
  } finally { await ctx.close() }
})
