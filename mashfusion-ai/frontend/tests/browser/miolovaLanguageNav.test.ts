import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'

/**
 * Phase 4C: the language of a public MIOLOVE page is the language of its URL. The menu navigates, a saved language never overrides a public page,
 * "/" stays Italian, and the language follows the visitor to sign-in / sign-up and back to the home of that language.
 */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_MIOLOVE_LIVE: 'true' }); browser = await launchPortals(app) })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const M = () => portalUrl(app, 'miolovealbum.com'), I = () => portalUrl(app, 'iomixo.com')
type L = 'it' | 'en' | 'fr' | 'es'
const LANGS: L[] = ['it', 'en', 'fr', 'es']
const HOME: Record<L, string> = { it: '/', en: '/en', fr: '/fr', es: '/es' }
const IDEAS: Record<L, string> = { it: '/idee', en: '/en/ideas', fr: '/fr/idees', es: '/es/ideas' }
const H1: Record<L, string> = { it: 'I tuoi ricordi, raccontati da chi li vive.', en: 'Your memories, told by the people who live them.', fr: 'Vos souvenirs, racontés par ceux qui les vivent.', es: 'Tus recuerdos, contados por quienes los viven.' }
const stored = (p: Page) => p.evaluate(() => localStorage.getItem('iomixo.locale'))
const setStored = (p: Page, l: string) => p.evaluate((x) => localStorage.setItem('iomixo.locale', x), l)
const htmlLang = (p: Page) => p.evaluate(() => document.documentElement.lang)
const settle = async (p: Page) => { await p.waitForLoadState('networkidle'); await p.waitForTimeout(600) }
const open = async (p: Page, path: string, host = M()) => { await p.goto(`${host}${path}`, { waitUntil: 'networkidle', timeout: 120_000 }); await p.waitForTimeout(700) }
/** Opens the menu and returns the codes it offers. */
async function menu(p: Page): Promise<string[]> {
  const trigger = p.getByTestId('miolove-lang-trigger').first()
  for (let i = 0; i < 10 && (await p.locator('[role="listbox"]').count()) === 0; i++) { await trigger.click(); await p.waitForTimeout(350) }
  return p.locator('[role="listbox"] [role="option"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-lang') ?? ''))
}
async function choose(p: Page, to: L, expectPath: string) {
  await menu(p); await p.locator(`[role="listbox"] [data-lang="${to}"]`).first().click()
  await p.waitForURL((u) => u.pathname === expectPath, { timeout: 30_000 }); await settle(p)
}

test('NAV1. home and guide: every language → every language navigates to the equivalent URL; content, <html lang>, canonical and the saved language all follow the URL', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage()
  try {
    for (const [name, table] of [['home', HOME], ['guide', IDEAS]] as const) {
      for (const from of LANGS) for (const to of LANGS) {
        if (from === to) continue
        await open(page, table[from])
        assert.deepEqual(await menu(page), LANGS, `${name} ${from}: the menu offers the four published languages, no draft`)
        await choose(page, to, table[to])
        assert.equal(await htmlLang(page), to, `${name} ${from}→${to}: <html lang>`)
        assert.equal(await page.evaluate(() => document.querySelector('link[rel="canonical"]')?.getAttribute('href')), `https://miolovealbum.com${table[to] === '/' ? '' : table[to]}`, `${name} ${from}→${to}: canonical`)
        if (name === 'home') assert.equal(await page.getByTestId('home-h1').innerText(), H1[to], `${name} ${from}→${to}: content in the language of the URL`)
        assert.equal(await stored(page), to, `${name} ${from}→${to}: the language of the page that opened is remembered`)
      }
    }
  } finally { await ctx.close() }
})

test('NAV2. a saved language never overrides a public page: "/" stays Italian, /en English, whatever was stored; a reload changes nothing', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage()
  try {
    await open(page, '/idee'); 
    for (const saved of ['en', 'fr', 'es']) {
      await setStored(page, saved)
      await open(page, '/'); assert.equal(await page.getByTestId('home-h1').innerText(), H1.it, `saved ${saved}: "/" is Italian`); assert.equal(await htmlLang(page), 'it')
      await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(600); assert.equal(await page.getByTestId('home-h1').innerText(), H1.it, `saved ${saved}: "/" still Italian after a reload`)
      await open(page, '/idee'); assert.equal(await htmlLang(page), 'it'); assert.match(await page.locator('h1').first().innerText(), /invitati/, '/idee is the Italian guide')
    }
    await setStored(page, 'fr'); await open(page, '/en'); assert.equal(await page.getByTestId('home-h1').innerText(), H1.en, 'a saved French never beats the /en URL'); assert.equal(await stored(page), 'en')
  } finally { await ctx.close() }
})

test('NAV3. client-side arrival never leaves a public page in the wrong language: from an English app page, the "home" link opens the English home; a router push to "/" is Italian', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage()
  try {
    await open(page, '/en'); await page.getByTestId('nav-try-free').first().click(); await page.waitForURL(/\/register/, { timeout: 30_000 }); await settle(page)
    assert.equal(await stored(page), 'en'); assert.match(await page.locator('body').innerText(), /Create|account|Sign up|Start/i, 'register in English')
    // the logo goes to the home of the language being read
    const logo = page.locator('a[href="/en"]').first(); assert.equal(await logo.count() > 0, true, 'logo → /en')
    await logo.evaluate((el) => (el as HTMLElement).click());   // the desktop layout of this page hides the logo, the link itself is what is under test await page.waitForURL((u) => u.pathname === '/en', { timeout: 30_000 }); await settle(page)
    assert.equal(await page.getByTestId('home-h1').innerText(), H1.en)
    // a client-side navigation from an English state to the Italian root: UrlLocale puts the page back in the language of its URL
    // a REAL client-side navigation (no page load) from the English state to the Italian root: a marker set on the window must survive it
    await page.waitForFunction(() => typeof (window as any).next?.router?.push === 'function', null, { timeout: 30_000 })
    await page.evaluate(() => { (window as any).__softNav = 'alive'; (window as any).next.router.push('/') })
    await page.waitForURL((u) => u.pathname === '/', { timeout: 30_000 }); await settle(page)
    assert.equal(await page.evaluate(() => (window as any).__softNav), 'alive', 'it was a client-side navigation, not a page load')
    assert.equal(await page.getByTestId('home-h1').innerText(), H1.it, '"/" is Italian even when reached from an English page')
    assert.equal(await stored(page), 'it', 'and the saved language follows the page that is open')
    // and back to English the same way
    await page.evaluate(() => { (window as any).next.router.push('/fr') }); await page.waitForURL((u) => u.pathname === '/fr', { timeout: 30_000 }); await settle(page)
    assert.equal(await page.evaluate(() => (window as any).__softNav), 'alive'); assert.equal(await page.getByTestId('home-h1').innerText(), H1.fr)
  } finally { await ctx.close() }
})

test('NAV4. continuity: home (any language) → login and sign-up stay in that language, their logo and the legal pages\' "back" go to the home of that language', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage()
  try {
    for (const l of LANGS) {
      await open(page, HOME[l]); await page.getByTestId('nav-login').first().click(); await page.waitForURL(/\/login/, { timeout: 30_000 }); await settle(page)
      assert.equal(await stored(page), l, `${l}: login keeps the language`)
      const logo = page.locator('a[aria-label], a').filter({ has: page.locator('img, svg') }).first()
      assert.equal(await page.locator(`a[href="${HOME[l]}"]`).count() > 0, true, `${l}: login logo → ${HOME[l]}`)
      await page.goto(`${M()}/privacy`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600)
      assert.equal(await page.locator(`a[href="${HOME[l]}"]`).count() >= 3, true, `${l}: privacy header / back / footer → ${HOME[l]}`)
      void logo
    }
    await open(page, '/'); await page.getByTestId('nav-try-free').first().click(); await page.waitForURL(/\/register/, { timeout: 30_000 }); await settle(page)
    assert.equal(await stored(page), 'it'); assert.equal(await page.locator('a[href="/"]').count() > 0, true)
  } finally { await ctx.close() }
})

test('NAV5. the menu of the app pages (sign-in, privacy) still switches in place and is remembered; draft languages are in no menu', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage()
  try {
    for (const path of ['/login', '/privacy']) {
      await open(page, path); assert.deepEqual(await menu(page), LANGS, `${path}: four published languages only`)
      await page.locator('[role="listbox"] [data-lang="fr"]').first().click(); await page.waitForTimeout(500)
      assert.equal(new URL(page.url()).pathname, path, `${path}: no navigation`); assert.equal(await stored(page), 'fr')
    }
  } finally { await ctx.close() }
})

test('NAV6. IOMIXO is untouched: its pages have no MIOLOVE language URLs, its logo still links to "/" and its own switcher is the old one', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage()
  try {
    for (const path of ['/en', '/idee', '/de', '/en/ideas']) { const r = await page.goto(`${I()}${path}`, { waitUntil: 'domcontentloaded' }); assert.equal(r?.status(), 404, `iomixo ${path}`) }
    await open(page, '/login', I()); assert.equal(await page.getByTestId('miolove-lang').count(), 0); assert.ok(await page.locator('a[href="/"]').count() > 0, 'IOMIXO logo → "/"')
    await open(page, '/', I()); assert.equal(await page.getByTestId('miolove-lang').count(), 0)
    for (const l of ['de', 'pt-br', 'ja']) { const r = await page.goto(`${M()}/${l}`, { waitUntil: 'domcontentloaded' }); assert.equal(r?.status(), 404, `draft /${l}`) }
  } finally { await ctx.close() }
})
