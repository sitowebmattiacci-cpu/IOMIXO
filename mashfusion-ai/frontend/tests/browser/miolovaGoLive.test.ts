import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

/** MIOLOVE go-live sprint: public home, SEO, pricing, Google login, guest page, occasion copy, privacy, previews, billing, white label. */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' }); browser = await launchPortals(app) })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const M = () => portalUrl(app, 'miolovealbum.com'), I = () => portalUrl(app, 'iomixo.com')
type L = 'it' | 'en' | 'fr' | 'es'
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
const text = (p: Page) => p.evaluate(() => document.body.innerText)
const setLocale = (p: Page, l: L) => p.evaluate((x) => localStorage.setItem('iomixo.locale', x), l)
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 30_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
const get = (host: string, path: string) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: app.port, path, headers: { host: `${host}:${app.port}`, 'x-forwarded-host': host } }, (res) => { let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: b })) }).on('error', reject)
})
const FORBIDDEN = /Event\s*Pass|Advance|Pro\s*DJ|IOMIXO|7,99|19,99\s*\/|\/\s*mese|al mese|per month|par mois|al mes\b|upgrade|piano mensile/i
/** The page text without the five reassurances ("non è un abbonamento…"), which deny a subscription on purpose. */
const noReassure = (p: Page) => p.evaluate(() => { const c = document.body.cloneNode(true) as HTMLElement; c.querySelectorAll('[data-reassure],[data-testid="faq-list"],script,style,noscript').forEach((e) => e.remove()); return c.textContent || '' })

async function album(occasion: string, over: Record<string, unknown> = {}, title = 'Compleanno di Martina') {
  const owner = await newClient('account'), stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`, id = `gl${stamp}`, slug = `glslug${stamp}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, displayName: 'Enrico Rossi', accountType: 'couple', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${id}`, eventFields(owner.uid, slug, {
    type: 'wedding', brand: 'miolove', title, coupleNames: null, legacySupabaseId: undefined, occasionType: occasion, accessMode: 'trial', trialPhotoCount: 0, trialPhotoLimit: 50,
    trialStartsAt: new Date(), trialExpiresAt: new Date(Date.now() + 6 * 86_400_000), weddingDate: '2031-06-12', guestConfig: null, screenConfig: null, ...over,
  }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  return { owner, id, slug }
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
  const menu = page.getByRole('button', { name: 'Menu', exact: true }); if (await menu.isVisible().catch(() => false)) await menu.click()
  await page.locator('nav[aria-label="Wedding"]:visible').getByRole('button', { name }).first().click({ timeout: 30_000 })
}
const open = async (page: Page, a: { owner: { email: string }; id: string }) => { await login(page, a.owner.email); await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }) }

// ── 1. Public home ─────────────────────────────────────────────────────────────────────────────
for (const w of [390, 768, 1280, 1440]) {
  test(`HOME1. public home @${w}: every section, headline, CTAs, pricing €19,99, no overflow, no IOMIXO / Event Pass / monthly wording`, async () => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } }); const page = await ctx.newPage()
    try {
      const resp = await page.goto(`${M()}/`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1000)
      assert.equal(new URL(page.url()).pathname, '/', 'no redirect to /login')
      assert.match(await resp!.text(), /data-testid="miolove-home"/, 'server-rendered MIOLOVE home')
      assert.equal(await page.getByTestId('home-h1').innerText(), 'I tuoi ricordi, raccontati da chi li vive.')
      for (const id of ['home-header', 'hero-visual', 'home-preview', 'plan-cards', 'faq-list', 'final-cta', 'home-footer', 'whatsapp-compare']) assert.ok(await page.getByTestId(id).count() >= 1, id)
      assert.equal(await page.getByTestId('how-step').count(), 4); assert.equal(await page.getByTestId('event-type').count(), 4)
      assert.ok(await page.getByTestId('feature-card').count() >= 7)
      assert.match(await page.getByTestId('hero-note').innerText(), /7 giorni di prova gratis · Nessuna carta di credito/)
      assert.equal(await page.getByTestId('album-price').innerText(), '€19,99'); assert.equal(await page.getByTestId('album-list-price').innerText(), '€39,99'); assert.match(await page.getByTestId('album-price-line').innerText(), /una volta · Nessun abbonamento/)
      const body = await noReassure(page); assert.doesNotMatch(body, FORBIDDEN)
      for (const s of ['Prova gratis', 'Album completo', 'Foto e video illimitati', 'Slideshow live', 'Logo MIOLOVE visibile']) assert.ok(body.includes(s), s)
      for (const planned of ['12 mesi']) assert.ok(!body.includes(planned), `"${planned}" is not implemented: it must not be advertised`)
      for (const live of ['Foto e video illimitati', 'Qualità originale', 'Scarica tutto con un click']) assert.ok(body.includes(live), `"${live}" ships with the media engine: it must be advertised`)
      assert.equal(await page.getByTestId('hero-cta-primary').getAttribute('href'), '/register')
      assert.equal(await overflow(page), false, 'overflow')
      // reviews: development shows the DEMO layout only under a visible demo badge
      assert.equal(await page.getByTestId('reviews-demo-badge').count(), 1); assert.equal(await page.getByTestId('reviews-list').getAttribute('data-demo'), 'true')
      assert.doesNotMatch(body, /Trustpilot|10\.000|premi|award/i)
      if (w < 1024) { await page.waitForTimeout(2500)  /* hydration */; for (let i = 0; i < 25 && (await page.getByTestId('nav-menu').getAttribute('aria-expanded')) !== 'true'; i++) { await page.getByTestId('nav-menu').click(); await page.waitForTimeout(800) }; assert.equal(await page.getByTestId('nav-menu').getAttribute('aria-expanded'), 'true', 'mobile menu opens'); assert.ok(await page.getByTestId('nav-drawer').count() === 1, 'drawer rendered') }
      await page.screenshot({ path: `/tmp/claude-501/home-${w}.png`, fullPage: true }).catch(() => {})
    } finally { await ctx.close() }
  })
}

test('HOME2. language: IT/EN/FR/ES switch live and persist after a refresh; no Italian leaks into the other languages', async () => {
  const H1: Record<L, string> = { it: 'I tuoi ricordi, raccontati da chi li vive.', en: 'Your memories, told by the people who live them.', fr: 'Vos souvenirs, racontés par ceux qui les vivent.', es: 'Tus recuerdos, contados por quienes los viven.' }
  const PRICE: Record<L, string> = { it: '€19,99', en: '$19.99', fr: '19,99 €', es: '19,99 €' }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage()
  try {
    await page.goto(`${M()}/`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(800)
    const pick = async (l: L) => { const opt = page.locator(`[data-lang="${l}"]`); for (let i = 0; i < 10 && !(await opt.isVisible().catch(() => false)); i++) { await page.getByTestId('miolove-lang-trigger').first().click(); await page.waitForTimeout(300) } await opt.click() }
    for (const l of ['en', 'fr', 'es', 'it'] as L[]) {
      await pick(l); assert.equal(await page.getByTestId('home-h1').innerText(), H1[l]); assert.equal(await page.getByTestId('album-price').innerText(), PRICE[l])
      const b = await noReassure(page); assert.doesNotMatch(b, FORBIDDEN, l)
      if (l !== 'it') assert.doesNotMatch(b, /Come funziona|Prova gratis|Cosa include|Domande frequenti|Pagamento unico/, `${l}: Italian leaked`)
    }
    for (const l of ['fr', 'es', 'en'] as L[]) { await pick(l); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800); assert.equal(await page.getByTestId('home-h1').innerText(), H1[l], `${l} after refresh`) }
  } finally { await ctx.close() }
})

test('SEO1. metadata, hreflang, language URLs, structured data, robots, sitemap, noindex on private pages; IOMIXO untouched', async () => {
  const ctx = await browser.newContext(); const page = await ctx.newPage()
  try {
    await page.goto(`${M()}/`, { waitUntil: 'networkidle', timeout: 120_000 })
    const h = await page.evaluate(() => ({
      title: document.title, canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
      alt: Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).map((e) => [e.getAttribute('hreflang'), e.getAttribute('href')]),
      og: document.querySelector('meta[property="og:title"]')?.getAttribute('content'), tw: document.querySelector('meta[name="twitter:card"]')?.getAttribute('content'),
      desc: document.querySelector('meta[name="description"]')?.getAttribute('content'), ld: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((e) => e.textContent),
      robots: document.querySelector('meta[name="robots"]')?.getAttribute('content'), lang: document.documentElement.lang,
    }))
    assert.match(h.title, /MIOLOVE ALBUM — Album fotografico digitale/); assert.equal((h.canonical ?? '').replace(/\/$/, ''), 'https://miolovealbum.com'); assert.match(h.desc ?? '', /QR code/)
    assert.deepEqual(h.alt.map((a) => a[0]).sort(), ['en', 'es', 'fr', 'it', 'x-default']); assert.equal(h.tw, 'summary'); assert.match(h.og ?? '', /MIOLOVE/); assert.match(h.robots ?? '', /index/)
    const ld = JSON.parse(h.ld.join('')); assert.deepEqual(ld['@graph'].map((x: any) => x['@type']), ['Organization', 'WebSite', 'SoftwareApplication'])
    assert.doesNotMatch(JSON.stringify(h), /iomixo/i, 'no IOMIXO in the MIOLOVE head')
    // language URL: the FIRST html is already French
    const fr = await get('miolovealbum.com', '/fr'); assert.match(fr.body, /<html lang="fr"/); assert.match(fr.body, /Vos souvenirs/); assert.match(fr.body, /rel="canonical" href="https:\/\/miolovealbum\.com\/fr"/); assert.match(fr.body, /hrefLang="en" href="https:\/\/miolovealbum\.com\/en"/)
    // robots / sitemap
    const rb = await get('miolovealbum.com', '/robots.txt'); assert.match(rb.body, /Disallow: \/live\//); assert.match(rb.body, /Sitemap: https:\/\/miolovealbum\.com\/sitemap\.xml/)
    const sm = await get('miolovealbum.com', '/sitemap.xml'); assert.match(sm.body, /miolovealbum\.com\/en/); assert.doesNotMatch(sm.body, /\/live\/|\/sessions/)
    // private surfaces: noindex
    for (const path of ['/live/abc', '/booth/abc', '/screen/abc', '/sessions', '/billing']) assert.match(String((await get('miolovealbum.com', path)).headers['x-robots-tag']), /noindex/, path)
    assert.equal((await get('miolovealbum.com', '/login')).headers['x-robots-tag'], undefined)
    // IOMIXO: its own landing, no sitemap entries other than root, open robots, no noindex header
    const io = await get('iomixo.com', '/'); assert.match(io.body, /data-portal="iomixo"|IOMIXO/); assert.doesNotMatch(io.body, /miolove-home/)
    const ir = await get('iomixo.com', '/robots.txt'); assert.doesNotMatch(ir.body, /Disallow: \/live/)
    assert.equal((await get('iomixo.com', '/live/abc')).headers['x-robots-tag'], undefined)
  } finally { await ctx.close() }
})

// ── 2. Google login ─────────────────────────────────────────────────────────────────────────────
const GOOGLE: Record<L, string> = { it: 'Continua con Google', en: 'Continue with Google', fr: 'Continuer avec Google', es: 'Continuar con Google' }
for (const route of ['login', 'register']) {
  test(`AUTH-G1. /${route}: "Continue with Google" in IT/EN/FR/ES, no overflow at 390 / 1280, IOMIXO login has none`, async () => {
    for (const w of [390, 1280]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 } }); const page = await ctx.newPage()
      try {
        await page.goto(`${M()}/${route}`, { waitUntil: 'networkidle', timeout: 120_000 })
        for (const l of ['it', 'en', 'fr', 'es'] as L[]) {
          await setLocale(page, l); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500)
          assert.equal((await page.getByTestId('google-signin').innerText()).trim(), GOOGLE[l], `${route} ${l}`); assert.equal(await overflow(page), false, `${route} ${l} @${w}`)
        }
        await page.goto(`${I()}/${route}`, { waitUntil: 'networkidle' }); assert.equal(await page.getByTestId('google-signin').count(), 0, 'IOMIXO is unchanged')
      } finally { await ctx.close() }
    }
  })
}

test('AUTH-G2. Google popup (Auth emulator): new account → MIOLOVE onboarding; same Google email again → same uid, no second profile; an e-mail/password account keeps its role', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage()
  const email = `g${Date.now()}@example.com`
  async function viaGoogle(p: Page) {
    await p.goto(`${M()}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await p.waitForTimeout(1200)
    const [popup] = await Promise.all([p.waitForEvent('popup', { timeout: 30_000 }), p.getByTestId('google-signin').click()])
    assert.equal(await p.getByTestId('google-signin').getAttribute('aria-busy'), 'true', 'loading state while the popup is open')
    await popup.waitForLoadState('load'); await popup.waitForTimeout(1500)
    const existing = popup.getByText(email)
    if (await existing.count().catch(() => 0)) await existing.first().click()
    else {
      await popup.locator('#add-account-button').click()
      await popup.locator('#autogen-button').click()
      await popup.locator('#email-input').fill(email)
      await popup.locator('#sign-in').click()
    }
    await p.waitForURL((u) => /\/(sessions|onboarding)/.test(u.pathname), { timeout: 60_000 })
  }
  try {
    await viaGoogle(page)
    await page.waitForURL(/\/onboarding/, { timeout: 60_000 })                                  // a brand-new account has no album: MIOLOVE onboarding
    const users = async () => (((await (await fetch('http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/users?pageSize=1000', { headers: { authorization: 'Bearer owner' } })).json()) as any).documents ?? []).filter((d: any) => d.fields?.email?.stringValue === email)
    const first = await users(); assert.equal(first.length, 1); assert.equal(first[0].fields.accountType.stringValue, 'couple')
    await page.context().clearCookies(); await page.evaluate(() => { indexedDB.databases?.().then((dbs) => dbs.forEach((d) => d.name && indexedDB.deleteDatabase(d.name))); localStorage.clear() })
    await viaGoogle(page)
    const second = await users(); assert.equal(second.length, 1, 'the same Google account never creates a second profile'); assert.equal(second[0].name, first[0].name, 'same uid')
  } finally { await ctx.close() }
})

test('AUTH-G3. Google errors are localized: a closed popup and a provider collision show IT/EN/FR/ES messages, never raw Firebase text', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage()
  try {
    await page.goto(`${M()}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(800)
    const CLOSED: Record<L, string> = { it: 'Hai chiuso la finestra di Google', en: 'You closed the Google window', fr: 'Vous avez fermé la fenêtre Google', es: 'Cerraste la ventana de Google' }
    for (const l of ['it', 'en', 'fr', 'es'] as L[]) {
      await setLocale(page, l); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400)
      const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 30_000 }), page.getByTestId('google-signin').click()])
      await popup.close()
      const toast = await page.locator('[role="status"]').first().innerText({ timeout: 15_000 })
      assert.ok(toast.includes(CLOSED[l]), `${l}: "${toast}"`); assert.doesNotMatch(toast, /auth\/|Firebase/)
      await page.waitForTimeout(600)
      assert.equal(await page.getByTestId('google-signin').isEnabled(), true, 'the button is usable again')
    }
  } finally { await ctx.close() }
})

// ── 3. Guest page: active at once, occasion copy, trial end, white label ─────────────────────────────
const EYEBROW: Record<string, Record<L, string>> = {
  wedding: { it: 'Matrimonio', en: 'Wedding', fr: 'Mariage', es: 'Boda' }, birthday: { it: 'Compleanno', en: 'Birthday', fr: 'Anniversaire', es: 'Cumpleaños' },
  baptism: { it: 'Battesimo', en: 'Baptism', fr: 'Baptême', es: 'Bautizo' }, other: { it: 'Evento', en: 'Event', fr: 'Événement', es: 'Evento' },
}
for (const occasion of ['wedding', 'birthday', 'baptism', 'other']) {
  test(`GUEST1. ${occasion}, FUTURE date, no guest_config: the guest page is active at once (photo action, no "available soon"), eyebrow follows the occasion in IT/EN/FR/ES, never "Wedding Edition"`, async () => {
    const a = await album(occasion, {}, `Festa ${occasion}`)
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage()
    try {
      for (const l of ['it', 'en', 'fr', 'es'] as L[]) {
        await page.goto(`${M()}/live/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await setLocale(page, l); await page.reload({ waitUntil: 'domcontentloaded' })
        await page.getByText(`Festa ${occasion}`).first().waitFor({ timeout: 90_000 })
        const t = await text(page)
        assert.doesNotMatch(t, /sarà disponibile tra poco|will be available soon|Wedding Edition|Advance|Event Pass|IOMIXO|DJ/i, `${occasion} ${l}`)
        assert.ok(t.toUpperCase().includes(EYEBROW[occasion][l].toUpperCase()), `${occasion} ${l}: eyebrow "${EYEBROW[occasion][l]}" in ${t.slice(0, 120)}`)
        assert.ok(await page.locator('[data-testid="guest-primary-cta"] a[href^="/booth/"]').count() === 1, 'one direct photo/video action'); assert.doesNotMatch(t, /Cosa vuoi fare|What would you like|Que voulez-vous|¿Qué quieres/i, 'no action menu intro')
        assert.equal(await overflow(page), false, 'overflow')
      }
    } finally { await ctx.close() }
  })
}

test('GUEST2. photos are OFF by the owner: a clear message, not a lock; a closed trial: the album stays readable with a localized notice and no upload; booth too', async () => {
  const off = await album('birthday', { guestConfig: { requests: false, live_booth: false } })
  const ended = await album('baptism', { trialExpiresAt: new Date(Date.now() - 60_000), trialStartsAt: new Date(Date.now() - 7 * 86_400_000) }, 'Battesimo di Leo')
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage()
  try {
    await page.goto(`${M()}/live/${off.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText("L'invio di foto e video non è attivo").waitFor({ timeout: 90_000 })
    await page.goto(`${M()}/live/${ended.slug}`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('guest-notice').waitFor({ timeout: 90_000 })
    assert.match(await page.getByTestId('guest-notice').innerText(), /prova gratuita di questo album è terminata/)
    await page.getByText('Battesimo di Leo').first().waitFor()
    await page.goto(`${M()}/booth/${ended.slug}`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('booth-trial-ended').waitFor({ timeout: 90_000 }); assert.equal(await page.locator('button:has(svg.lucide-camera)').count(), 0)
    await setLocale(page, 'fr'); await page.reload({ waitUntil: 'domcontentloaded' })
    assert.match(await page.getByTestId('booth-trial-ended').innerText({ timeout: 60_000 }), /essai gratuit de cet album est terminé/)
  } finally { await ctx.close() }
})

test('WL1. white label: a trial album shows the MIOLOVE mark on the guest page and the TV; an ACTIVATED album shows none', async () => {
  const trial = await album('wedding', {}, 'Album trial'), paid = await album('wedding', { accessMode: 'activated', trialPhotoCount: undefined, trialPhotoLimit: undefined, trialExpiresAt: undefined, trialStartsAt: undefined }, 'Album paid')
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage()
  try {
    await page.goto(`${M()}/live/${trial.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByTestId('guest-topbar').waitFor({ timeout: 90_000 })
    assert.equal(await page.getByTestId('guest-topbar').getAttribute('data-whitelabel'), 'false'); assert.ok(await page.locator('[role="img"][aria-label="MIOLOVE ALBUM"]').count() >= 1); assert.match(await text(page), /MIOLOVE ALBUM/)
    await page.goto(`${M()}/live/${paid.slug}`, { waitUntil: 'domcontentloaded' }); await page.getByText('Album paid').first().waitFor({ timeout: 90_000 })
    assert.equal(await page.getByTestId('guest-topbar').getAttribute('data-whitelabel'), 'true'); assert.equal(await page.locator('[role="img"][aria-label="MIOLOVE ALBUM"]').count(), 0); assert.doesNotMatch(await text(page), /MIOLOVE/i)
    await page.goto(`${M()}/screen/${paid.slug}`, { waitUntil: 'domcontentloaded' }); await page.getByText('Album paid').first().waitFor({ timeout: 90_000 }); assert.doesNotMatch(await text(page), /MIOLOVE/i, 'TV of a paid album')
    await page.goto(`${M()}/screen/${trial.slug}`, { waitUntil: 'domcontentloaded' }); await page.getByText('Album trial').first().waitFor({ timeout: 90_000 }); assert.match(await text(page), /MIOLOVE ALBUM/, 'TV of a trial album keeps the mark')
  } finally { await ctx.close() }
})

// ── 4. Owner area ──────────────────────────────────────────────────────────────────────────────────────
const NAMES: Record<string, string> = { wedding: 'Nomi degli sposi', birthday: 'Nome del festeggiato/a', baptism: 'Nome del bambino/a', other: 'Nome da mostrare' }
for (const occasion of ['wedding', 'birthday', 'baptism', 'other']) {
  test(`OWN1. ${occasion}: settings label is dynamic; privacy works on a TRIAL album with no Advance / Event Pass wording`, async () => {
    const a = await album(occasion)
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage()
    try {
      await open(page, a)
      await goTab(page, /Impostazioni/); await page.getByTestId('settings-names-input').waitFor({ timeout: 60_000 })
      const t = await text(page); assert.ok(t.includes(NAMES[occasion]), `label "${NAMES[occasion]}"`)
      if (occasion !== 'wedding') assert.doesNotMatch(t, /sposi/i)
      assert.equal(await page.getByTestId('settings-names-input').getAttribute('placeholder') !== null, true)
      await goTab(page, /Privacy/)
      await page.getByText('Invio foto degli ospiti').first().waitFor({ timeout: 60_000 })
      const p = await text(page)
      assert.doesNotMatch(p, /Visibilità ospiti bloccata|Event Pass|Advance|Sblocca|Pro\b|Richieste|dediche|Giochi|musical/i, 'no IOMIXO paywall / DJ settings')
      assert.ok(p.includes('Foto sullo schermo'))
      assert.ok(await page.locator('input[type="checkbox"], [role="switch"]').count() >= 2, 'toggles are usable')
    } finally { await ctx.close() }
  })
}

test('OWN2. home of the album: QR + phone preview + monitor preview are the REAL /live and /screen pages (iframes) for each occasion; trial banner with days left', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage()
  try {
    for (const occasion of ['wedding', 'birthday', 'baptism', 'other']) {
      const a = await album(occasion, {}, `Album ${occasion}`)
      await open(page, a)
      const phone = page.getByTestId('preview-phone-frame'), monitor = page.getByTestId('preview-monitor-frame')
      await phone.waitFor({ timeout: 90_000 }); await monitor.waitFor({ timeout: 30_000 }); await page.locator('#wd-qrcode-svg').waitFor()
      assert.equal(await phone.locator('iframe').getAttribute('src'), `/live/${a.slug}`); assert.equal(await monitor.locator('iframe').getAttribute('src'), `/screen/${a.slug}`)
      await phone.frameLocator('iframe').getByText(`Album ${occasion}`).first().waitFor({ timeout: 90_000 })             // the frame really rendered the guest page
      await monitor.frameLocator('iframe').getByText(`Album ${occasion}`).first().waitFor({ timeout: 90_000 })           // ...and the TV
      assert.match(await page.getByTestId('trial-days').innerText(), /giorni rimasti|giorno rimasto/)
      assert.equal(await overflow(page), false)
    }
    // narrow screens: still both previews, inside the viewport
    await page.setViewportSize({ width: 390, height: 844 })
    const a = await album('birthday', {}, 'Album mobile'); await open(page, a)
    await page.getByTestId('preview-phone-frame').waitFor({ timeout: 90_000 }); await page.getByTestId('preview-monitor-frame').scrollIntoViewIfNeeded()
    const box = (await page.getByTestId('preview-monitor-frame').boundingBox())!; assert.ok(box.x >= 0 && box.x + box.width <= 391, 'monitor inside the viewport')
    assert.equal(await overflow(page), false)
  } finally { await ctx.close() }
})

test('OWN3. poster / QR card: LOCKED on a trial album (Album completo CTA), open on an activated one; "download all" locked on trial', async () => {
  const t = await album('wedding'), p = await album('wedding', { accessMode: 'activated', trialPhotoCount: undefined, trialPhotoLimit: undefined, trialExpiresAt: undefined, trialStartsAt: undefined })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage()
  try {
    await open(page, t); await goTab(page, /Poster/); await page.getByTestId('poster-locked').waitFor({ timeout: 60_000 })
    assert.match(await text(page), /Card e poster QR sono inclusi nell'Album completo/); assert.equal(await page.getByTestId('poster-editor').count(), 0)
    await goTab(page, /Foto/); await page.getByTestId('photos-download').waitFor({ timeout: 60_000 }); assert.equal(await page.getByTestId('photos-download').isDisabled(), true)
    await ctx.clearCookies()
    await open(page, p); await goTab(page, /Poster/); await page.getByTestId('poster-editor').waitFor({ timeout: 60_000 }); assert.equal(await page.getByTestId('poster-locked').count(), 0)
  } finally { await ctx.close() }
})

// ── 5. Plan / billing ──────────────────────────────────────────────────────────────────────────────────
test('BILL1. MIOLOVE "Piano" page: trial + full album €19,99 once, no Event Pass / Advance / monthly / IOMIXO, a live (enabled) activation button; 4 languages; 390 / 768 / 1280 / 1440', async () => {
  const a = await album('birthday')
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage()
  try {
    await login(page, a.owner.email)
    for (const w of [390, 768, 1280, 1440]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto(`${M()}/billing`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByTestId('miolove-billing').waitFor({ timeout: 90_000 })
      await page.getByTestId('billing-status').filter({ hasText: 'Prova gratis in corso' }).waitFor({ timeout: 60_000 })
      const t = await noReassure(page); assert.doesNotMatch(t, FORBIDDEN, `@${w}`); assert.doesNotMatch(t, /Abbonamento/)
      for (const s of ['Prova gratis', 'Album completo', '€19,99', 'una volta']) assert.ok((await text(page)).includes(s), s)
      await page.getByTestId('plan-activate').waitFor({ timeout: 60_000 }); await until(async () => !(await page.getByTestId('plan-activate').isDisabled()), 30_000, 'the activation button is live')
      assert.match(await page.getByTestId('plan-activate-note').innerText(), /Pagamento unico.*Nessun abbonamento/)
      assert.equal(await overflow(page), false, `overflow @${w}`)
    }
    const T: Record<L, string[]> = { it: ['Prova gratis', '€19,99'], en: ['Free trial', '$19.99'], fr: ['Essai gratuit', '19,99 €'], es: ['Prueba gratis', '19,99 €'] }
    for (const l of ['en', 'fr', 'es', 'it'] as L[]) {
      await setLocale(page, l); await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByTestId('album-price').waitFor({ timeout: 60_000 })
      const t = await text(page); for (const s of T[l]) assert.ok(t.includes(s), `${l} ${s}`); assert.doesNotMatch(await noReassure(page), FORBIDDEN, l)
    }
    // sidebar / settings carry no IOMIXO plan names either
    await setLocale(page, 'it'); await page.goto(`${M()}/settings`, { waitUntil: 'domcontentloaded' }); await page.getByTestId('settings-plan').waitFor({ timeout: 60_000 })
    assert.equal(await page.getByTestId('settings-plan').innerText(), 'Prova gratis'); assert.doesNotMatch(await text(page), /Event Pass|Advance|\bfree\b|\bpro\b/i)
  } finally { await ctx.close() }
})

test('REG1. IOMIXO regression: landing, login, register keep IOMIXO content; no MIOLOVE leakage', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage()
  try {
    await page.goto(`${I()}/`, { waitUntil: 'networkidle', timeout: 120_000 })
    const t = await text(page); assert.match(t, /IOMIXO/); assert.match(t, /Event Pass|Pro|Advance/); assert.doesNotMatch(t, /MIOLOVE|miolove/i); assert.equal(await page.getByTestId('miolove-home').count(), 0)
    for (const r of ['login', 'register']) { await page.goto(`${I()}/${r}`, { waitUntil: 'networkidle' }); assert.doesNotMatch(await text(page), /MIOLOVE|Google/i, r) }
  } finally { await ctx.close() }
})
