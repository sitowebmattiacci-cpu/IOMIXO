import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
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
    await page.getByText(/Check your inbox/i).first().waitFor({ timeout: 60_000 })
    assert.equal(await page.getByTestId('register-continue').count(), 0, 'no Sposi continue button for a DJ')
    const u = await until(async () => ((await fsGet('users')).documents ?? []).find((d: any) => d.fields.email?.stringValue === email), 20_000, 'users doc')
    assert.equal(u.fields.accountType.stringValue, 'dj')
    await page.goto(`${app.url}/register`, { waitUntil: 'networkidle', timeout: 120_000 })
    assert.equal(await page.locator('[data-portal]').first().getAttribute('data-portal'), 'iomixo', 'safe default on a non-portal host')
  } finally { await ctx.close() }
})

test('PT4. wrong portal: a Sposi account on iomixo.com goes to miolovealbum.com, a DJ on miolovealbum.com goes to iomixo.com — the wrong UI is never painted', async () => {
  const couple = await newClient('account'), dj = await newClient('account')
  await seedSet(`users/${couple.uid}`, { uid: couple.uid, email: couple.email, accountType: 'couple', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, email: dj.email, accountType: 'dj', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  const stub = (page: Page) => page.route(/^https:\/\/(www\.)?(iomixo|miolovealbum)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>portal target</body></html>' }))

  // Sposi on IOMIXO
  let ctx = await browser.newContext(); let page = await ctx.newPage(); await stub(page)
  let seen = await trackPaint(page, ['I miei album', 'I tuoi album', 'Per gli sposi', 'Nuovo album'])
  try {
    await signIn(page, I(), couple.email)
    await page.waitForURL('https://miolovealbum.com/sessions', { timeout: 60_000 })
    assert.deepEqual(Array.from(seen), [], 'no Sposi UI was painted on iomixo.com')
    // a Sposi path is kept
    const p2 = await ctx.newPage(); await stub(p2)
    await p2.goto(`${I()}/sessions/abc?x=1`, { waitUntil: 'commit' }); await p2.waitForURL('https://miolovealbum.com/sessions/abc?x=1', { timeout: 60_000 })
    // a DJ-only path is not kept: MIOLOVE home
    const p3 = await ctx.newPage(); await stub(p3)
    await p3.goto(`${I()}/remote/some-slug`, { waitUntil: 'commit' }); await p3.waitForURL('https://miolovealbum.com/sessions', { timeout: 60_000 })
  } finally { await ctx.close() }

  // DJ on MIOLOVE
  ctx = await browser.newContext(); page = await ctx.newPage(); await stub(page)
  seen = await trackPaint(page, ['Regia DJ', 'Profilo DJ', 'Prossime date', 'Sessioni Live', 'Party Mode'])
  try {
    await signIn(page, M(), dj.email)
    await page.waitForURL('https://iomixo.com/sessions', { timeout: 60_000 })
    assert.deepEqual(Array.from(seen), [], 'no DJ UI was painted on miolovealbum.com')
    const p2 = await ctx.newPage(); await stub(p2)
    await p2.goto(`${M()}/events`, { waitUntil: 'commit' }); await p2.waitForURL('https://iomixo.com/dashboard', { timeout: 60_000 })
  } finally { await ctx.close() }

  // right portal: nothing happens
  ctx = await browser.newContext(); page = await ctx.newPage(); await stub(page)
  try {
    await signIn(page, I(), dj.email); await page.waitForURL(/iomixo\.com:\d+\/dashboard/, { timeout: 60_000 })
    await page.getByText('Profilo DJ').first().waitFor({ timeout: 60_000 })
  } finally { await ctx.close() }
})

test('PT5. public links: Wedding → miolovealbum.com (also for a DJ on iomixo.com), Party → iomixo.com, Remote stays on iomixo.com', async () => {
  const dj = await newClient('account'), couple = await newClient('account'), stamp = Date.now()
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, email: dj.email, accountType: 'dj', plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`users/${couple.uid}`, { uid: couple.uid, email: couple.email, accountType: 'couple', plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  const wedSlug = `lw${stamp}`, partySlug = `lp${stamp}`, coupleSlug = `lc${stamp}`
  for (const [id, slug, owner, type] of [[`lwid${stamp}`, wedSlug, dj.uid, 'wedding'], [`lpid${stamp}`, partySlug, dj.uid, 'party'], [`lcid${stamp}`, coupleSlug, couple.uid, 'wedding']] as const) {
    await seedSet(`events/${id}`, eventFields(owner, slug, { type, title: `Evento ${slug}`, legacySupabaseId: undefined })); await seedSet(`eventSlugs/${slug}`, { eventId: id })
  }
  // DJ on iomixo.com
  let ctx = await browser.newContext(); let page = await ctx.newPage()
  try {
    await signIn(page, I(), dj.email); await page.waitForURL(/\/dashboard/, { timeout: 60_000 })
    await page.goto(`${I()}/sessions/lwid${stamp}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText(`https://miolovealbum.com/live/${wedSlug}`, { exact: true }).waitFor({ timeout: 60_000 })
    assert.ok(await page.locator(`a[href="https://iomixo.com/remote/${wedSlug}"]`).count() > 0, 'the Wedding Remote link stays on IOMIXO')
    assert.equal(await page.getByText(`miolovealbum.com/remote`).count(), 0)
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: I() })
    await page.goto(`${I()}/sessions/lpid${stamp}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: /Copia link/ }).first().click({ timeout: 60_000 })
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `https://iomixo.com/live/${partySlug}`, 'the copied Party link is IOMIXO')
    assert.ok(await page.locator(`a[href="https://iomixo.com/screen/${partySlug}"]`).count() > 0, 'Party TV link is IOMIXO')
    await page.getByRole('button', { name: /Live Booth/ }).first().click()
    await page.locator(`a[href="https://iomixo.com/booth/${partySlug}"]`).first().waitFor({ state: 'attached', timeout: 30_000 })
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
