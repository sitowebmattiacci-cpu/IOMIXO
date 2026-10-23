import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

/**
 * MIOLOVE multi-album in the real UI: "I miei album" lists every album with ITS OWN status and dates, a second album can be created (no second trial) and is "Da attivare" with its own
 * "Attiva album — €19,99", two paid albums show two different expiry dates, and no account-wide "plan" is shown anywhere. Real Functions + Firestore emulators; only the Stripe session is faked.
 */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_FIREBASE_BILLING: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' }); browser = await launchPortals(app) })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })
const M = () => portalUrl(app, 'miolovealbum.com')
const DAY = 86_400_000
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
const body = (p: Page) => p.locator('body').innerText()
const FORBIDDEN_PLAN = /Piano attuale|Il tuo piano|Your plan|Current plan|Plan actuel|Piano Advance|Event Pass|Advance/i
const itDate = (d: Date) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 30_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
let n = 0
async function owner() {
  const o = await newClient('account')
  await seedSet(`users/${o.uid}`, { uid: o.uid, email: o.email, displayName: 'Enrico Rossi', accountType: 'couple', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  return o
}
/** Plants an album in any state. `title` is also its id suffix, so a test can find the card of each one. */
async function plant(uid: string, title: string, over: Record<string, unknown>, ageMs = 0) {
  const id = `mb${Date.now()}${n++}`, slug = `mbs${Date.now()}${n}`
  await seedSet(`events/${id}`, eventFields(uid, slug, { type: 'wedding', brand: 'miolove', title, legacySupabaseId: undefined, occasionType: 'birthday', weddingDate: '2031-06-12', guestConfig: null, screenConfig: null,
    createdAt: new Date(Date.now() - ageMs), updatedAt: new Date(Date.now() - ageMs), ...over }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  return { id, slug }
}
const trial = (end: Date) => ({ accessMode: 'trial', trialPhotoCount: 2, trialPhotoLimit: 50, trialStartsAt: new Date(end.getTime() - 7 * DAY), trialExpiresAt: end, purgeAfter: new Date(end.getTime() + 30 * DAY) })
const paid = (activated: Date) => ({ accessMode: 'activated', activatedAt: activated, expiresAt: new Date(activated.getTime() + 365 * DAY), purgeAfter: new Date(activated.getTime() + 365 * DAY) })
async function newCtx(vp = { width: 1280, height: 900 }, locale = 'it'): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: vp }); await ctx.addInitScript((l) => { try { localStorage.setItem('iomixo.locale', l) } catch { /* ignore */ } }, locale); return ctx
}
async function login(page: Page, email: string) {
  await page.goto(`${M()}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
  for (let a = 0; a < 8 && /\/login$/.test(page.url()); a++) {
    await page.locator('input[type="email"]').fill(email); await page.locator('input[type="password"]').fill('password123')
    await page.locator('button[type="submit"]').click(); await page.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 15_000 }).catch(() => {})
  }
}
async function fakeCheckout(page: Page, url: string, seen: any[]) {
  await page.route('**/createAlbumCheckoutSession', async (route) => {
    const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h })
    seen.push(JSON.parse(route.request().postData() ?? '{}'))
    await route.fulfill({ status: 200, headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ result: { url } }) })
  })
}
const card = (page: Page, id: string) => page.locator(`[data-testid="album-card"][data-album-id="${id}"]`)

test('MB-1. a second album can be created from "I miei album": no "one album" refusal, no second trial; it is "Da attivare", opens with its own banner, and its CTA pays THAT album', async () => {
  const o = await owner(); const a = await plant(o.uid, 'Album prova', trial(new Date(Date.now() + 5 * DAY)))
  await seedSet(`trialAlbums/${o.uid}`, { eventId: a.id, createdAt: new Date() })                   // the account\'s one trial is already taken by this album
  const ctx = await newCtx(); const page = await ctx.newPage(); const seen: any[] = []
  try {
    await fakeCheckout(page, `${M()}/billing?payment=cancelled`, seen)
    await login(page, o.email); await page.goto(`${M()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTestId('album-list').waitFor({ timeout: 90_000 })
    assert.equal(await page.getByTestId('album-card').count(), 1); assert.equal(await card(page, a.id).getAttribute('data-status'), 'trial'); assert.match(await card(page, a.id).innerText(), /Prova gratuita/)
    // create the second one: the form says plainly that it has no new trial, then the album is created (the old "Hai già creato il tuo album gratuito" refusal is gone)
    await page.getByTestId('new-session').click()
    await page.getByTestId('new-album-note').waitFor({ timeout: 30_000 }); assert.match(await page.getByTestId('new-album-note').innerText(), /non include una nuova prova gratuita.*€19,99/)
    await page.locator('form input').first().fill('Compleanno di Luca'); await page.getByTestId('album-occasion').selectOption('birthday')
    await page.locator('form input[type="date"]').first().fill('2026-12-05'); await page.locator('form button[type="submit"]').click()
    await page.waitForURL(/\/sessions\/[^/]+$/, { timeout: 90_000 })
    const b = page.url().split('/sessions/')[1]; assert.notEqual(b, a.id)
    const f = await until(async () => (await fsGet(`events/${b}`)).fields, 20_000, 'second album')
    assert.deepEqual([f.accessMode.stringValue, f.title.stringValue, f.weddingDate.stringValue, f.trialExpiresAt], ['pending', 'Compleanno di Luca', '2026-12-05', undefined])
    assert.equal((await fsGet(`trialAlbums/${o.uid}`)).fields.eventId.stringValue, a.id, 'the one trial stays with the first album')
    await page.getByTestId('album-lifecycle').waitFor({ timeout: 90_000 }); assert.equal(await page.getByTestId('album-lifecycle').getAttribute('data-status'), 'pending')
    assert.match(await page.getByTestId('album-lifecycle').innerText(), /Da attivare/); assert.equal(await page.getByTestId('trial-quota').count(), 0, 'a pending album shows no trial quota')
    assert.equal((await page.getByTestId('album-activate').innerText()).replace(/\s+/g, ' '), 'Attiva album — €19,99')
    await page.screenshot({ path: '/tmp/multi-pending-album.png' }).catch(() => {})
    // the list: both albums, each with its own state; the CTA exists only on the one to pay and names it
    await page.goto(`${M()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByTestId('album-list').waitFor({ timeout: 90_000 })
    await until(async () => (await page.getByTestId('album-card').count()) === 2, 30_000, 'two cards')
    assert.equal(await card(page, a.id).getAttribute('data-status'), 'trial'); assert.equal(await card(page, b).getAttribute('data-status'), 'pending')
    const cardB = card(page, b); assert.match(await cardB.innerText(), /Compleanno di Luca/); assert.match(await cardB.innerText(), /Da attivare/); assert.match(await cardB.getByTestId('album-card-meta').innerText(), /Compleanno.*5 dicembre 2026/)
    assert.equal(await cardB.getByTestId('album-activate').count(), 1)
    await cardB.getByTestId('album-activate').click(); await until(async () => seen.length === 1, 30_000, 'checkout requested')
    assert.equal(seen[0].data.eventId, b, 'the checkout is for the SECOND album, not the trial one'); assert.deepEqual(Object.keys(seen[0].data).sort(), ['eventId', 'locale'])
    // nothing was activated by asking for a checkout
    assert.equal((await fsGet(`events/${b}`)).fields.accessMode.stringValue, 'pending')
    assert.doesNotMatch(await body(page), FORBIDDEN_PLAN)
  } finally { await ctx.close() }
})

test('MB-2. two paid albums, two different expiry dates (each 365 days from its own activation); paid albums have no pay button; no account-wide plan text on any page', async () => {
  const o = await owner(); const t1 = new Date(Date.now() - 30 * DAY), t2 = new Date(Date.now() - 200 * DAY)
  const a = await plant(o.uid, 'Nozze Anna e Marco', paid(t1), 2000), b = await plant(o.uid, 'Battesimo di Leo', paid(t2), 1000)
  const ctx = await newCtx(); const page = await ctx.newPage()
  try {
    await login(page, o.email); await page.goto(`${M()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByTestId('album-list').waitFor({ timeout: 90_000 })
    await until(async () => (await page.getByTestId('album-card').count()) === 2, 30_000, 'two cards')
    const ea = itDate(new Date(t1.getTime() + 365 * DAY)), eb = itDate(new Date(t2.getTime() + 365 * DAY)); assert.notEqual(ea, eb)
    assert.match(await card(page, a.id).innerText(), new RegExp(`Attivo[\\s\\S]*Disponibile fino al ${ea}[\\s\\S]*(335|334) giorni rimanenti|Disponibile fino al ${ea}.*(335|334) giorni rimanenti`))
    assert.match(await card(page, b.id).innerText(), new RegExp(`Disponibile fino al ${eb}.*(165|164) giorni rimanenti`))
    for (const id of [a.id, b.id]) { assert.equal(await card(page, id).getAttribute('data-status'), 'active'); assert.equal(await card(page, id).getByTestId('album-activate').count(), 0) }
    assert.doesNotMatch(await body(page), FORBIDDEN_PLAN)
    // each album page carries its own banner with its own date
    await page.goto(`${M()}/sessions/${b.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByTestId('album-lifecycle').waitFor({ timeout: 90_000 })
    assert.match(await page.getByTestId('album-lifecycle-line').innerText(), new RegExp(eb)); assert.equal(await page.getByTestId('album-activate').count(), 0)
    // the payments page and the settings page: albums, no plan
    await page.goto(`${M()}/billing`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByTestId('billing-albums').waitFor({ timeout: 90_000 })
    assert.equal(await page.getByTestId('billing-album').count(), 2); assert.equal(await page.getByTestId('miolove-billing').getAttribute('data-to-activate'), '0'); assert.doesNotMatch(await body(page), FORBIDDEN_PLAN)
    await page.goto(`${M()}/settings`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByText('Membro dal', { exact: false }).first().waitFor({ timeout: 60_000 })
    assert.equal(await page.getByTestId('settings-plan').count(), 0); assert.doesNotMatch(await body(page), FORBIDDEN_PLAN)
  } finally { await ctx.close() }
})

test('MB-3. every state in one list @390 and @1280: Prova gratuita / Prova terminata (30 days to recover) / Da attivare / Attivo / Scaduto — only the payable ones carry the button; nothing overflows', async () => {
  const o = await owner(); const now = Date.now()
  const s = {
    trial: await plant(o.uid, 'Album A prova', trial(new Date(now + 4 * DAY)), 5000),
    ended: await plant(o.uid, 'Album B prova finita', trial(new Date(now - 3 * DAY)), 4000),
    pending: await plant(o.uid, 'Album C da attivare', { accessMode: 'pending' }, 3000),
    active: await plant(o.uid, 'Album D attivo', paid(new Date(now - 10 * DAY)), 2000),
    expired: await plant(o.uid, 'Album E scaduto', paid(new Date(now - 400 * DAY)), 1000),
  }
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const ctx = await newCtx(vp); const page = await ctx.newPage()
    try {
      await login(page, o.email); await page.goto(`${M()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByTestId('album-list').waitFor({ timeout: 90_000 })
      await until(async () => (await page.getByTestId('album-card').count()) === 5, 30_000, 'five cards')
      const want: Record<string, [string, RegExp, boolean]> = {
        trial: ['trial', /Prova gratuita/, true], ended: ['trialEnded', /(?=[\s\S]*Prova terminata)(?=[\s\S]*Attivalo entro il)/, true], pending: ['pending', /Da attivare/, true], active: ['active', /Attivo/, false], expired: ['expired', /Scaduto/, false],
      }
      for (const [k, [status, re, payable]] of Object.entries(want)) {
        const c = card(page, (s as any)[k].id); assert.equal(await c.getAttribute('data-status'), status, k); assert.match(await c.innerText(), re, k)
        assert.equal(await c.getByTestId('album-activate').count(), payable ? 1 : 0, `${k} pay button`)
        if (payable) assert.equal((await c.getByTestId('album-activate').innerText()).replace(/\s+/g, ' '), 'Attiva album — €19,99', k)
      }
      assert.equal(await overflow(page), false, `overflow @${vp.width}`)
      await page.screenshot({ path: `/tmp/multi-album-${vp.width}.png`, fullPage: true }).catch(() => {})
      // billing page: the same five albums, the four payable ones can be paid from here
      await page.goto(`${M()}/billing`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByTestId('billing-albums').waitFor({ timeout: 90_000 })
      assert.equal(await page.getByTestId('billing-album').count(), 5); assert.equal(await page.getByTestId('album-activate').count(), 3); assert.equal(await overflow(page), false, `billing overflow @${vp.width}`)
      await page.screenshot({ path: `/tmp/multi-billing-${vp.width}.png`, fullPage: true }).catch(() => {})
    } finally { await ctx.close() }
  }
})

test('MB-4. guests: a pending album and an expired paid album take no uploads on /live, /booth and /screen (closed notice, no camera, no slideshow); an active album still works', async () => {
  const o = await owner(); const now = Date.now()
  const pending = await plant(o.uid, 'Album guest pending', { accessMode: 'pending' })
  const expired = await plant(o.uid, 'Album guest scaduto', paid(new Date(now - 400 * DAY)))
  const active = await plant(o.uid, 'Album guest attivo', paid(new Date(now - 10 * DAY)))
  const ctx = await newCtx({ width: 390, height: 844 }); const page = await ctx.newPage()
  try {
    for (const [a, re] of [[pending, /non è ancora attivo/], [expired, /è scaduto/]] as const) {
      await page.goto(`${M()}/live/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByTestId('guest-notice').waitFor({ timeout: 90_000 })
      assert.match(await page.getByTestId('guest-notice').innerText(), re)
      await page.goto(`${M()}/booth/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByTestId('booth-trial-ended').waitFor({ timeout: 90_000 })
      assert.match(await page.getByTestId('booth-trial-ended').innerText(), re); assert.equal(await page.locator('input[type="file"]').count(), 0, 'no file picker on a closed album')
      await page.goto(`${M()}/screen/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByTestId('screen-album-closed').waitFor({ timeout: 90_000 })
      assert.match(await page.getByTestId('screen-album-closed').innerText(), re)
    }
    await page.goto(`${M()}/booth/${active.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.locator('input[type="file"]').first().waitFor({ state: 'attached', timeout: 90_000 })
    assert.equal(await page.getByTestId('booth-trial-ended').count(), 0, 'the active album is open')
    await page.goto(`${M()}/screen/${active.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForTimeout(4000); assert.equal(await page.getByTestId('screen-album-closed').count(), 0)
  } finally { await ctx.close() }
})

test('MB-5. the 4 languages: the status words, the dates and the CTA are translated and carry the right currency', async () => {
  const o = await owner(); await plant(o.uid, 'Album lingue', { accessMode: 'pending' }, 100); await plant(o.uid, 'Album lingue 2', paid(new Date(Date.now() - 5 * DAY)), 50)
  const exp: Record<string, [RegExp, RegExp, RegExp]> = {
    it: [/Da attivare/, /Attiva album — €19,99/, /Disponibile fino al/], en: [/To activate/, /Activate album — \$19\.99/, /Available until/],
    fr: [/À activer/, /Activer l'album — 19,99 €/, /Disponible jusqu'au/], es: [/Por activar/, /Activar álbum — 19,99 €/, /Disponible hasta el/],
  }
  for (const [l, [pill, cta, until_]] of Object.entries(exp)) {
    const ctx = await newCtx({ width: 1280, height: 900 }, l); const page = await ctx.newPage()
    try {
      await login(page, o.email); await page.goto(`${M()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByTestId('album-list').waitFor({ timeout: 90_000 })
      await until(async () => (await page.getByTestId('album-card').count()) === 2, 30_000, 'two cards')
      const t = (await body(page)).replace(/\s+/g, ' '); assert.match(t, pill, l); assert.match(t, cta, l); assert.match(t, until_, l); assert.doesNotMatch(t, FORBIDDEN_PLAN, l)
    } finally { await ctx.close() }
  }
})
