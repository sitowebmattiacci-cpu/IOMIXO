import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'

/**
 * Phase B: the first HTML of every MIOLOVE page is rendered in the visitor's language (URL, then cookie, then the browser's), so nothing flashes in Italian,
 * and the title / <html lang> of the service pages agree with it. No raw key may show, and nothing may fail to hydrate.
 */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_MIOLOVE_LIVE: 'true' }); browser = await launchPortals(app) })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const M = () => portalUrl(app, 'miolovealbum.com'), I = () => portalUrl(app, 'iomixo.com')
type L = 'it' | 'en' | 'fr' | 'es'
const LANGS: L[] = ['it', 'en', 'fr', 'es']
const BROWSER_LOCALE: Record<L, string> = { it: 'it-IT', en: 'en-GB', fr: 'fr-FR', es: 'es-ES' }
const LOGIN_TITLE: Record<L, string> = { it: 'Accedi', en: 'Sign in', fr: 'Se connecter', es: 'Iniciar sesión' }
const WELCOME: Record<L, RegExp> = { it: /Bentornat/i, en: /Welcome back/i, fr: /Bon retour|Content de vous revoir|Bienvenue/i, es: /Bienvenid/i }
const RAW_KEY = /\b(auth|common|roles|home|ideas|albumPlan|wdAdmin|weddingPanels|guestAlbum|guestMenu|media|occasion|onboarding|sessions|settings|billing|booth|sidebar|dashboard|legal|brand)\.[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)*\b/

async function newPage(locale: L, extra: { cookie?: L; storage?: L } = {}): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: BROWSER_LOCALE[locale], extraHTTPHeaders: { 'accept-language': BROWSER_LOCALE[locale] } })
  if (extra.cookie) await ctx.addCookies([{ name: 'ml_lang', value: extra.cookie, url: M() }])
  if (extra.storage) await ctx.addInitScript((l) => { try { localStorage.setItem('iomixo.locale', l) } catch {} }, extra.storage)
  const page = await ctx.newPage(); const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  return { ctx, page, errors }
}
const hydrationErrors = (errs: string[]) => errs.filter((e) => /hydrat|did not match|Text content does not match|Minified React error #(418|423|425)/i.test(e))
const settle = async (p: Page, ms = 1200) => { await p.waitForLoadState('networkidle'); await p.waitForTimeout(ms) }
const bodyText = (p: Page) => p.evaluate(() => document.body.innerText)
/** The server's own answer (first HTML), as a crawler or a slow phone sees it before any script runs. */
// (plain HTTP to the local server with the portal host in the Host header: only the browser knows the host mapping)
const get = (url: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
  const u = new URL(url)
  http.get({ host: '127.0.0.1', port: app.port, path: u.pathname, headers: { host: u.host, 'x-forwarded-host': u.hostname, 'accept-language': 'it', ...headers } }, (res) => {
    let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: b }))
  }).on('error', reject)
})
async function firstHtml(url: string, headers: Record<string, string> = {}): Promise<string> { return (await get(url, headers)).body }
const htmlLang = (html: string) => html.match(/<html lang="([^"]+)"/)?.[1]
const title = (html: string) => html.match(/<title>([^<]*)<\/title>/)?.[1]

test('LOAD1. first HTML is already in the visitor\'s language: browser language, cookie, URL — no Italian first, <html lang> and the title agree', async () => {
  for (const l of LANGS) {
    const html = await firstHtml(`${M()}/login`, { 'accept-language': BROWSER_LOCALE[l] })
    assert.equal(htmlLang(html), l, `Accept-Language ${l}`); assert.match(title(html) ?? '', new RegExp(`^${LOGIN_TITLE[l]}`), `title ${l}`)
    assert.match(html, /name="robots" content="noindex, follow"/, 'service page stays noindex'); assert.doesNotMatch(html, /rel="canonical"/, 'and has no canonical')
    const c = await firstHtml(`${M()}/login`, { 'accept-language': 'de-DE', cookie: `ml_lang=${l}` })
    assert.equal(htmlLang(c), l, `cookie ${l} beats the browser`); assert.match(title(c) ?? '', new RegExp(`^${LOGIN_TITLE[l]}`))
  }
  assert.equal(htmlLang(await firstHtml(`${M()}/login`, { 'accept-language': 'de-DE' })), 'it', 'an unsupported browser language → Italian, as before')
  assert.equal(htmlLang(await firstHtml(`${M()}/`, { 'accept-language': 'fr-FR', cookie: 'ml_lang=fr' })), 'it', 'public pages follow their URL, not the cookie')
  assert.equal(htmlLang(await firstHtml(`${M()}/en`, { 'accept-language': 'fr-FR', cookie: 'ml_lang=fr' })), 'en')
  assert.equal(htmlLang(await firstHtml(`${I()}/login`, { 'accept-language': 'fr-FR', cookie: 'ml_lang=fr' })), 'it', 'IOMIXO ignores all of it')
})

test('LOAD2. sign-in, sign-up, password pages, privacy and terms in every language: right texts, no raw key, no hydration error', async () => {
  for (const l of LANGS) {
    const { ctx, page, errors } = await newPage(l)
    try {
      for (const path of ['/login', '/register', '/forgot-password', '/privacy', '/terms']) {
        await page.goto(`${M()}${path}`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(900)
        const t = await bodyText(page)
        assert.doesNotMatch(t, RAW_KEY, `${l} ${path}: raw key visible`)
        assert.equal(await page.evaluate(() => document.documentElement.lang), path === '/privacy' || path === '/terms' ? 'it' : l, `${l} ${path}: <html lang> (the indexable legal pages are always served as Italian)`)
        if (path === '/login') assert.match(t, WELCOME[l], `${l} login text`)
      }
      assert.deepEqual(hydrationErrors(errors), [], `${l}: hydration`)
    } finally { await ctx.close() }
  }
})

test('LOAD3. public pages in every language: right texts, no raw key, no hydration error', async () => {
  const URLS: Record<L, string[]> = { it: ['/', '/idee'], en: ['/en', '/en/ideas'], fr: ['/fr', '/fr/idees'], es: ['/es', '/es/ideas'] }
  for (const l of LANGS) {
    const { ctx, page, errors } = await newPage('it', { storage: 'fr' })      // a saved language never matters here
    try {
      for (const path of URLS[l]) {
        await page.goto(`${M()}${path}`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(900)
        assert.doesNotMatch(await bodyText(page), RAW_KEY, `${l} ${path}: raw key`); assert.equal(await page.evaluate(() => document.documentElement.lang), l)
      }
      assert.deepEqual(hydrationErrors(errors), [], `${l}: hydration`)
    } finally { await ctx.close() }
  }
})

test('LOAD4. a returning visitor with only a saved language ends in it; choosing a language sets the cookie and the next request is rendered in it from the first byte', async () => {
  const { ctx, page, errors } = await newPage('it', { storage: 'en' })
  try {
    await page.goto(`${M()}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
    assert.match(await bodyText(page), WELCOME.en); assert.deepEqual(hydrationErrors(errors), [])
    assert.equal((await ctx.cookies()).some((c) => c.name === 'ml_lang'), false, 'no cookie until the visitor chooses')
    await page.getByTestId('miolove-lang-trigger').first().click(); await page.locator('[role="listbox"] [data-lang="fr"]').first().click(); await page.waitForTimeout(800)
    assert.match(await bodyText(page), WELCOME.fr)
    assert.equal((await ctx.cookies()).find((c) => c.name === 'ml_lang')?.value, 'fr')
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(700)
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'fr'); assert.match(await bodyText(page), WELCOME.fr)
  } finally { await ctx.close() }
})

test('LOAD5. switching language in place (sign-in, privacy): never a raw key, never a half-translated page, every language, no hydration error', async () => {
  for (const path of ['/login', '/privacy']) {
    const { ctx, page, errors } = await newPage('it')
    try {
      await page.goto(`${M()}${path}`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(900)
      // sample the page while the language changes: a raw key at any instant fails
      await page.evaluate((src) => {
        const rx = new RegExp(src); (window as any).__leaks = []
        new MutationObserver(() => { const m = document.body.innerText.match(rx); if (m) (window as any).__leaks.push(m[0]) }).observe(document.body, { subtree: true, childList: true, characterData: true })
      }, RAW_KEY.source)
      for (const to of ['en', 'fr', 'es', 'it'] as L[]) {
        await page.getByTestId('miolove-lang-trigger').first().click(); await page.locator(`[role="listbox"] [data-lang="${to}"]`).first().click(); await page.waitForTimeout(1200)
        assert.equal(new URL(page.url()).pathname, path); assert.equal(await page.evaluate((k) => localStorage.getItem(k), 'iomixo.locale'), to)
        if (path === '/login') assert.match(await bodyText(page), WELCOME[to], `${path} → ${to}`)
      }
      assert.deepEqual(await page.evaluate(() => (window as any).__leaks), [], `${path}: raw keys appeared while switching`); assert.deepEqual(hydrationErrors(errors), [])
    } finally { await ctx.close() }
  }
})

test('LOAD6. IOMIXO: no MIOLOVE cookie, no hydration error, no raw key', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' }); const page = await ctx.newPage(); const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  try {
    await page.goto(`${I()}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1200)
    assert.deepEqual(hydrationErrors(errors), []); assert.equal((await ctx.cookies()).some((c) => c.name === 'ml_lang'), false)
    assert.doesNotMatch(await bodyText(page), RAW_KEY)
    await page.goto(`${I()}/`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800); assert.doesNotMatch(await bodyText(page), RAW_KEY)
  } finally { await ctx.close() }
})

test('LOAD7. the cookie and the browser language never change a public SEO page: same HTML, title, canonical, hreflang, robots — only the URL decides', async () => {
  const variants: Array<Record<string, string>> = [{}, { 'accept-language': 'fr-FR' }, { cookie: 'ml_lang=de' }, { cookie: 'ml_lang=fr', 'accept-language': 'es-ES' }, { cookie: 'ml_lang=en', 'accept-language': 'en-US' }]
  for (const path of ['/', '/en', '/fr', '/es', '/idee', '/en/ideas', '/fr/idees', '/es/ideas', '/privacy', '/terms']) {
    await get(`${M()}${path}`)                                                   // warm the route up (the dev server compiles on first use)
    const all: Awaited<ReturnType<typeof get>>[] = []
    for (const v of variants) all.push(await get(`${M()}${path}`, { 'accept-language': 'it', ...v }))
    const [r0, ...rest] = all
    const markup = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/[0-9a-f]{16}/g, 'H').replace(/\?v=\d+/g, '')          // the dev server stamps its assets with a timestamp
    assert.equal(r0.status, 200)
    for (const o of rest) { assert.equal(o.status, 200, path); assert.equal(markup(o.body), markup(r0.body), `${path}: identical HTML whatever the cookie / browser language`) }
  }
  // privacy / terms: one URL per document, indexable — the whole first HTML is the same for everyone (Italian); the browser then switches to the saved language
  for (const path of ['/privacy', '/terms']) {
    const meta = (h: string) => [h.match(/<title>([^<]*)<\/title>/)?.[1], h.match(/rel="canonical" href="([^"]*)"/)?.[1], h.match(/name="robots" content="([^"]*)"/)?.[1], h.match(/<meta name="description" content="([^"]*)"/)?.[1]].join('|')
    const a = await get(`${M()}${path}`, { 'accept-language': 'it' }), b = await get(`${M()}${path}`, { 'accept-language': 'it', cookie: 'ml_lang=fr' })
    assert.equal(meta(a.body), meta(b.body), `${path}: same metadata`); assert.match(meta(a.body), new RegExp(`https://miolovealbum.com${path}\\|index, follow`))
  }
})

test('LOAD8. IOMIXO: every URL answers as before — 404s stay 404 (also with a MIOLOVE cookie), no MIOLOVE content, no MIOLOVE language URL', async () => {
  for (const path of ['/idee', '/en', '/fr', '/es', '/en/ideas', '/fr/idees', '/de', '/pt-br', '/nonexistent']) {
    for (const h of [{}, { cookie: 'ml_lang=fr' }] as Array<Record<string, string>>) {
      const r = await get(`${I()}${path}`, h); assert.equal(r.status, 404, `iomixo ${path}`); assert.doesNotMatch(r.body, /MIOLOVE/)
    }
  }
  for (const path of ['/', '/login', '/register']) { const r = await get(`${I()}${path}`, { cookie: 'ml_lang=fr' }); assert.equal(r.status, 200); assert.match(r.body, /<html lang="it"/, 'IOMIXO ignores the MIOLOVE cookie'); assert.doesNotMatch(r.body.replace(/<script[\s\S]*?<\/script>/g, ''), /MIOLOVE ALBUM/) }
})
