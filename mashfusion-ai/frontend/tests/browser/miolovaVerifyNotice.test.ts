import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

/**
 * MIOLOVE "confirm your e-mail" notice in the real UI (Auth + Firestore + Functions emulators, mail in dry-run: nothing is sent): shown only to an unverified couple account, in the 4 languages,
 * resend (with its cooldown), close (per tab session), automatic disappearance when the address becomes verified, no horizontal overflow on mobile — and IOMIXO never shows it.
 */
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'; process.env.GCLOUD_PROJECT = 'demo-iomixo'
const fnReq = createRequire(__dirname + '/../../../../firebase/functions/package.json')
const { initializeApp, getApps } = fnReq('firebase-admin/app'); const { getAuth } = fnReq('firebase-admin/auth')
if (!getApps().length) initializeApp({ projectId: 'demo-iomixo' })
const adminAuth = getAuth()

let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' }); browser = await launchPortals(app) })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const M = () => portalUrl(app, 'miolovealbum.com'), I = () => portalUrl(app, 'iomixo.com')
const NOTICE = '[data-testid="verify-notice"]'
const TEXT = { it: 'Conferma il tuo indirizzo e-mail', en: 'Confirm your e-mail address', fr: 'Confirmez votre adresse e-mail', es: 'Confirma tu correo electrónico' } as const
type L = keyof typeof TEXT
let n = 0
/** A couple that already has an album: with NO album the dashboard shows the full-screen onboarding, which sits above the layout (and the notice) until the first album exists. */
async function plantAlbum(uid: string) {
  const id = `vn${Date.now()}${n++}`, slug = `vns${Date.now()}${n}`, end = new Date(Date.now() + 5 * 86_400_000)
  await seedSet(`events/${id}`, eventFields(uid, slug, { type: 'wedding', brand: 'miolove', title: 'Nozze Test', legacySupabaseId: undefined, occasionType: 'birthday', weddingDate: '2031-06-12', guestConfig: null, screenConfig: null,
    accessMode: 'trial', trialPhotoCount: 0, trialPhotoLimit: 50, trialStartsAt: new Date(), trialExpiresAt: end, purgeAfter: new Date(end.getTime() + 30 * 86_400_000), createdAt: new Date(), updatedAt: new Date() }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
}
async function account(type: 'couple' | 'dj', verified = false, withAlbum = true) {
  const o = await newClient('account')
  await seedSet(`users/${o.uid}`, { uid: o.uid, email: o.email, displayName: 'Anna Test', accountType: type, plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  if (type === 'couple' && withAlbum) await plantAlbum(o.uid)
  if (verified) await adminAuth.updateUser(o.uid, { emailVerified: true })
  return o
}
async function ctx(vp = { width: 1280, height: 900 }, locale: L = 'it'): Promise<BrowserContext> {
  const c = await browser.newContext({ viewport: vp }); await c.addInitScript((l) => { try { localStorage.setItem('iomixo.locale', l) } catch { /* ignore */ } }, locale); return c
}
async function login(page: Page, base: string, email: string) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
  for (let a = 0; a < 8 && /\/login$/.test(page.url()); a++) {
    await page.locator('input[type="email"]').fill(email); await page.locator('input[type="password"]').fill('password123')
    await page.locator('button[type="submit"]').click(); await page.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 15_000 }).catch(() => {})
  }
}
const visible = (page: Page) => page.locator(NOTICE).isVisible().catch(() => false)
async function settle(page: Page, ms = 3500) { await page.locator('main').waitFor({ timeout: 90_000 }).catch(() => {}); await page.waitForTimeout(ms) }
/** Positive checks poll: the notice appears once the account profile has been read. */
async function shown(page: Page) { return page.locator(NOTICE).waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false) }

test('VN-1. unverified couple: the notice shows on the dashboard, in the saved language, without blocking the page', async () => {
  const o = await account('couple'); const c = await ctx(); const page = await c.newPage()
  try {
    await login(page, M(), o.email); await page.goto(`${M()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await settle(page)
    assert.equal(await shown(page), true); assert.match(await page.locator(NOTICE).innerText(), new RegExp(TEXT.it))
    assert.ok(await page.getByTestId('album-list').isVisible().catch(() => false), 'the album list is there and usable')
    assert.equal(await page.getByTestId('couple-onboarding').count(), 0, 'no onboarding overlay on top')
  } finally { await c.close() }
})

test('VN-2. IT / EN / FR / ES: the notice, its buttons and the sent message follow the language', async () => {
  const o = await account('couple')
  for (const l of ['it', 'en', 'fr', 'es'] as L[]) {
    const c = await ctx({ width: 1280, height: 900 }, l); const page = await c.newPage()
    try {
      await login(page, M(), o.email); await page.goto(`${M()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await settle(page)
      assert.match(await page.locator(NOTICE).innerText(), new RegExp(TEXT[l]), l)
      assert.ok((await page.getByTestId('verify-notice-close').getAttribute('aria-label'))!.length > 2)
    } finally { await c.close() }
  }
})

test('VN-3. resend: sends through the MIOLOVE path (dry-run), confirms in the page and the button then waits (cooldown) — a second click cannot fire', async () => {
  const o = await account('couple'); const c = await ctx(); const page = await c.newPage(); const calls: string[] = []
  page.on('request', (r) => { if (/sendMioloveVerification/.test(r.url()) && r.method() === 'POST') calls.push(r.url()) })
  try {
    await login(page, M(), o.email); await page.goto(`${M()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await settle(page)
    await page.getByTestId('verify-notice-resend').click(); await page.getByTestId('verify-notice-note').waitFor({ timeout: 20_000 })
    assert.match(await page.getByTestId('verify-notice-note').innerText(), /inviata/i); assert.equal(await page.getByTestId('verify-notice-resend').isDisabled(), true)
    await page.getByTestId('verify-notice-resend').click({ force: true, timeout: 1500 }).catch(() => {}); await settle(page, 800)
    assert.equal(calls.length, 1, 'exactly one callable request')
  } finally { await c.close() }
})

test('VN-4. close hides the notice for this tab session (also after a reload) without touching the account; a new browser session shows it again', async () => {
  const o = await account('couple'); const c = await ctx(); const page = await c.newPage()
  try {
    await login(page, M(), o.email); await page.goto(`${M()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await settle(page)
    await page.getByTestId('verify-notice-close').click(); assert.equal(await visible(page), false)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 }); await settle(page); assert.equal(await visible(page), false, 'stays closed after reload')
    assert.equal((await adminAuth.getUser(o.uid)).emailVerified, false, 'closing verified nothing')
  } finally { await c.close() }
  const c2 = await ctx(); const p2 = await c2.newPage()
  try { await login(p2, M(), o.email); await p2.goto(`${M()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await settle(p2); assert.equal(await shown(p2), true, 'new session: shown again') } finally { await c2.close() }
})

test('VN-5. when the address becomes verified the notice disappears on its own when the user comes back to the tab (no reload)', async () => {
  const o = await account('couple'); const c = await ctx(); const page = await c.newPage()
  try {
    await login(page, M(), o.email); await page.goto(`${M()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await settle(page); assert.equal(await shown(page), true)
    await adminAuth.updateUser(o.uid, { emailVerified: true })                                  // what the e-mail link does, from another tab
    await page.waitForTimeout(16_000); await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.locator(NOTICE).waitFor({ state: 'detached', timeout: 20_000 })
  } finally { await c.close() }
})

test('VN-6. never shown: a verified couple, a DJ account on the MIOLOVE domain, and any IOMIXO account (verified or not)', async () => {
  const cases: Array<[string, () => Promise<{ email: string }>, string, string]> = [
    ['verified couple', () => account('couple', true), M(), '/sessions'],
    ['dj profile on MIOLOVE', () => account('dj'), M(), '/sessions'],
    ['unverified DJ on IOMIXO', () => account('dj'), I(), '/dashboard'],
    ['verified DJ on IOMIXO', () => account('dj', true), I(), '/dashboard'],
  ]
  for (const [why, mk, base, path] of cases) {
    const o = await mk(); const c = await ctx(); const page = await c.newPage()
    try { await login(page, base, o.email); await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await settle(page); assert.equal(await visible(page), false, why) } finally { await c.close() }
  }
})

test('VN-7. mobile 390px: the notice fits (no horizontal overflow) and stays out of the way', async () => {
  const o = await account('couple'); const c = await ctx({ width: 390, height: 844 }); const page = await c.newPage()
  try {
    await login(page, M(), o.email); await page.goto(`${M()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await settle(page); assert.equal(await shown(page), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false)
    const box = await page.locator(NOTICE).boundingBox(); assert.ok(box && box.height < 170, `notice height ${box?.height}`)
  } finally { await c.close() }
})

const all = (page: Page) => page.locator(NOTICE)
async function toOnboarding(page: Page, email: string) {
  await login(page, M(), email); await page.waitForURL(/\/onboarding$/, { timeout: 90_000 }); await page.getByTestId('couple-onboarding').waitFor({ timeout: 60_000 })
}

test('VN-8. first-album screen (no album yet): exactly ONE notice, on top of the screen and usable; resend works; creating the first album is not blocked; the layout one takes over afterwards', async () => {
  const o = await account('couple', false, false); const c = await ctx(); const page = await c.newPage(); const calls: string[] = []
  page.on('request', (r) => { if (/sendMioloveVerification/.test(r.url()) && r.method() === 'POST') calls.push(r.url()) })
  try {
    await toOnboarding(page, o.email); assert.equal(await shown(page), true)
    assert.equal(await all(page).count(), 1, 'one notice in the page'); assert.equal(await all(page).getAttribute('data-placement'), 'onboarding')
    const box = (await all(page).boundingBox())!, head = (await page.locator('[data-testid="couple-onboarding"] header').boundingBox())!, form = (await page.getByTestId('onboarding-name').boundingBox())!
    assert.ok(box.y >= head.y + head.height - 1 && box.y + box.height <= form.y, 'between the header and the form')
    await page.getByTestId('verify-notice-resend').click(); await page.getByTestId('verify-notice-note').waitFor({ timeout: 20_000 })
    assert.match(await page.getByTestId('verify-notice-note').innerText(), /inviata/i); assert.equal(calls.length, 1)
    await page.getByTestId('onboarding-create').click(); await page.waitForURL(/\/sessions\/[^/]+$/, { timeout: 90_000 })       // the first album is created with an unverified address
    assert.equal(await shown(page), true); assert.equal(await all(page).count(), 1, 'one notice after the redirect'); assert.equal(await all(page).getAttribute('data-placement'), 'layout')
  } finally { await c.close() }
})

test('VN-9. first-album screen: closing it hides it for the tab session and it stays closed in the dashboard; the account is not touched', async () => {
  const o = await account('couple', false, false); const c = await ctx(); const page = await c.newPage()
  try {
    await toOnboarding(page, o.email); assert.equal(await shown(page), true)
    await page.getByTestId('verify-notice-close').click(); assert.equal(await all(page).count(), 0)
    await page.getByTestId('onboarding-create').click(); await page.waitForURL(/\/sessions\/[^/]+$/, { timeout: 90_000 }); await settle(page)
    assert.equal(await all(page).count(), 0, 'still closed in the dashboard')
    assert.equal((await adminAuth.getUser(o.uid)).emailVerified, false)
  } finally { await c.close() }
})

test('VN-10. first-album screen: becomes verified → the notice goes away on its own; a verified account never sees it; FR on a 390px screen fits without overflow', async () => {
  const a = await account('couple', false, false); const c = await ctx(); const page = await c.newPage()
  try {
    await toOnboarding(page, a.email); assert.equal(await shown(page), true)
    await adminAuth.updateUser(a.uid, { emailVerified: true }); await page.waitForTimeout(16_000); await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.locator(NOTICE).waitFor({ state: 'detached', timeout: 20_000 })
  } finally { await c.close() }
  const v = await account('couple', true, false); const c2 = await ctx(); const p2 = await c2.newPage()
  try { await toOnboarding(p2, v.email); await settle(p2); assert.equal(await all(p2).count(), 0, 'verified account') } finally { await c2.close() }
  const m = await account('couple', false, false); const c3 = await ctx({ width: 390, height: 844 }, 'fr'); const p3 = await c3.newPage()
  try {
    await toOnboarding(p3, m.email); assert.equal(await shown(p3), true); assert.match(await all(p3).innerText(), new RegExp(TEXT.fr))
    assert.equal(await p3.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false)
    const box = (await all(p3).boundingBox())!, form = (await p3.getByTestId('onboarding-name').boundingBox())!; assert.ok(box.y + box.height <= form.y && box.height < 200)
  } finally { await c3.close() }
})
