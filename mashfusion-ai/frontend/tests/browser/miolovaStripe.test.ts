import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, seedUpdate, eventFields } from '../firebase/seed'

/** MIOLOVE one-time album activation in the real UI: "Attiva album" → server checkout → return pages. The Stripe call itself is covered by tests/firebase/miolovaStripe.test.ts (fake Stripe). */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_FIREBASE_BILLING: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' }); browser = await launchPortals(app) })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })
const M = () => portalUrl(app, 'miolovealbum.com')
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 30_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
let n = 0
async function album(accessMode: 'trial' | 'activated' = 'trial') {
  const owner = await newClient('account'), id = `st${Date.now()}${n++}`, slug = `sts${Date.now()}${n}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, displayName: 'Enrico Rossi', accountType: 'couple', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${id}`, eventFields(owner.uid, slug, { type: 'wedding', brand: 'miolove', title: 'Album Stripe', legacySupabaseId: undefined, occasionType: 'birthday', accessMode, trialPhotoCount: 2, trialPhotoLimit: 50,
    trialStartsAt: new Date(), trialExpiresAt: new Date(Date.now() + 5 * 86_400_000), guestConfig: null, screenConfig: null }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  return { owner, id, slug }
}
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
/** Answers the createAlbumCheckoutSession callable like the server would when Stripe has built a session (the UI is what is under test here). */
async function fakeCheckout(page: Page, url: string, seen: any[]) {
  await page.route('**/createAlbumCheckoutSession', async (route) => {
    const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h })
    seen.push(JSON.parse(route.request().postData() ?? '{}'))
    await route.fulfill({ status: 200, headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ result: { url } }) })
  })
}

test('STRIPE-B1. trial: "Attiva album" is live and sends ONLY the album id + language (no price / amount / currency); the real server answers a clear message while no Stripe price is configured', async () => {
  const a = await album(); const ctx = await newCtx(); const page = await ctx.newPage(); const sent: string[] = []
  page.on('request', (r) => { if (/createAlbumCheckoutSession/.test(r.url()) && r.method() === 'POST') sent.push(r.postData() ?? '') })
  try {
    await login(page, a.owner.email); await page.goto(`${M()}/billing`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const btn = page.getByTestId('album-activate').first(); await btn.waitFor({ timeout: 90_000 }); await until(async () => !(await btn.isDisabled()), 30_000, 'button live')
    assert.equal((await btn.innerText()).replace(/\s+/g, ' '), 'Attiva album — €19,99'); assert.match(await page.getByTestId('billing-how').innerText(), /pagamento unico/i)
    await btn.click()
    await until(async () => sent.length === 1, 30_000, 'checkout requested'); const body = JSON.parse(sent[0]).data
    assert.deepEqual(Object.keys(body).sort(), ['eventId', 'locale']); assert.equal(body.eventId, a.id); assert.equal(body.locale, 'it')
    await page.getByText(/non è ancora disponibile|Impossibile avviare il pagamento/).first().waitFor({ timeout: 30_000 })      // dev emulator: no Stripe price / dummy key
    assert.equal(await page.getByTestId('album-activate').first().isDisabled(), false, 'the button is usable again')
    assert.equal((await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/events/${a.id}`, { headers: { authorization: 'Bearer owner' } })).json() as any).fields.accessMode.stringValue, 'trial', 'asking for a checkout activates nothing')
  } finally { await ctx.close() }
})

test('STRIPE-B2. checkout opens (URL from the server), cancel returns to MIOLOVE with the album intact and the CTA still there; EN request carries locale en', async () => {
  const a = await album(); const ctx = await newCtx({ width: 1280, height: 900 }, 'en'); const page = await ctx.newPage(); const seen: any[] = []
  try {
    await fakeCheckout(page, `${M()}/billing?payment=cancelled&album=${a.id}`, seen)
    await login(page, a.owner.email); await page.goto(`${M()}/billing`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const btn = page.getByTestId('album-activate').first(); await btn.waitFor({ timeout: 90_000 }); await until(async () => !(await btn.isDisabled()), 30_000, 'button live')
    assert.equal((await btn.innerText()).replace(/\s+/g, ' '), 'Activate album — $19.99', 'EN shows $19.99')
    await btn.click(); await page.waitForURL(/payment=cancelled/, { timeout: 30_000 }); assert.equal(seen[0].data.locale, 'en'); assert.equal(new URL(page.url()).origin, M())
    await page.getByTestId('payment-cancelled').waitFor({ timeout: 60_000 }); assert.match(await page.getByTestId('payment-cancelled').innerText(), /Payment cancelled/)
    await page.getByTestId('album-activate').first().waitFor(); assert.equal(await overflow(page), false)
  } finally { await ctx.close() }
})

test('STRIPE-B3. success return: the redirect alone does NOT activate ("payment received"); once the (webhook-written) accessMode flips the page says "Album attivato"; billing shows no pay CTA', async () => {
  const a = await album(); const ctx = await newCtx(); const page = await ctx.newPage()
  try {
    await login(page, a.owner.email); await page.goto(`${M()}/sessions/${a.id}?payment=success&session_id=cs_test_x`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTestId('payment-pending').waitFor({ timeout: 90_000 }); assert.match(await page.getByTestId('payment-pending').innerText(), /Pagamento ricevuto/)
    await page.waitForTimeout(6000); assert.equal(await page.getByTestId('payment-activated').count(), 0, 'success URL alone never activates')
    await seedUpdate(`events/${a.id}`, { accessMode: 'activated', activatedAt: new Date() })            // what the verified webhook does
    await page.getByTestId('payment-activated').waitFor({ timeout: 60_000 }); assert.match(await page.getByTestId('payment-activated').innerText(), /Album attivato/)
    await page.goto(`${M()}/billing`, { waitUntil: 'domcontentloaded' }); await page.getByTestId('billing-album').filter({ hasText: 'Attivo' }).waitFor({ timeout: 60_000 })
    assert.equal(await page.getByTestId('album-activate').count(), 0, 'an activated album has no pay button')
  } finally { await ctx.close() }
})

test('STRIPE-B4. an already activated album: no activation CTA anywhere; pricing is €19,99 (IT) / $19.99 (EN) and fits @390 / 768 / 1280 / 1440', async () => {
  const a = await album('activated'); const t = await album('trial')
  for (const [vp, lang, price] of [[390, 'it', '€19,99'], [768, 'it', '€19,99'], [1280, 'en', '$19.99'], [1440, 'it', '€19,99']] as const) {
    const ctx = await newCtx({ width: vp, height: 900 }, lang); const page = await ctx.newPage()
    try {
      await login(page, t.owner.email); await page.goto(`${M()}/billing`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByTestId('album-activate').first().waitFor({ timeout: 90_000 }); assert.ok((await page.locator('body').innerText()).includes(price), `${lang} ${price}`)
      assert.ok(!/abbonamento mensile|per month|\/\s*mese/i.test(await page.locator('body').innerText())); assert.equal(await overflow(page), false, `overflow @${vp}`)
    } finally { await ctx.close() }
  }
  const ctx = await newCtx(); const page = await ctx.newPage()
  try { await login(page, a.owner.email); await page.goto(`${M()}/billing`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByTestId('billing-album').filter({ hasText: 'Attivo' }).waitFor({ timeout: 60_000 }); assert.equal(await page.getByTestId('album-activate').count(), 0) } finally { await ctx.close() }
})

test('STRIPE-B5. one owner, album A activated + album B to activate, in BOTH list orders: ONLY B has "Attiva album", the checkout is requested for B (never A)', async () => {
  for (const order of ['activated-first', 'trial-first'] as const) {
    const owner = await newClient('account'); const stamp = Date.now()
    await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, displayName: 'Enrico', accountType: 'couple', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
    const mk = async (id: string, mode: string, at: number) => { await seedSet(`events/${id}`, eventFields(owner.uid, `s${id}`, { type: 'wedding', brand: 'miolove', title: id, legacySupabaseId: undefined, occasionType: 'other', accessMode: mode, trialPhotoCount: 1, trialPhotoLimit: 50, ...(mode === 'activated' ? { activatedAt: new Date(), expiresAt: new Date(Date.now() + 200 * 86_400_000) } : {}), guestConfig: null, screenConfig: null, createdAt: new Date(at), updatedAt: new Date(at) })); await seedSet(`eventSlugs/s${id}`, { eventId: id }) }
    const A = `A${stamp}${order[0]}`, B = `B${stamp}${order[0]}`
    await mk(A, 'activated', order === 'activated-first' ? stamp : stamp - 60_000); await mk(B, 'pending', order === 'activated-first' ? stamp - 60_000 : stamp)
    const ctx = await newCtx(); const page = await ctx.newPage(); const seen: any[] = []
    try {
      await fakeCheckout(page, `${M()}/billing?payment=cancelled`, seen)
      await login(page, owner.email); await page.goto(`${M()}/billing`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const btn = page.getByTestId('album-activate'); await btn.first().waitFor({ timeout: 90_000 }); await until(async () => !(await btn.first().isDisabled()), 30_000, 'button live')
      assert.equal(await btn.count(), 1, `${order}: exactly one album can be paid`); assert.equal(await btn.getAttribute('data-album-id'), B)
      assert.equal(await page.getByTestId('miolove-billing').getAttribute('data-to-activate'), '1')
      assert.equal(await page.locator(`[data-testid="billing-album"][data-album-id="${A}"] [data-testid="album-activate"]`).count(), 0, 'A has no pay CTA')
      await btn.click(); await until(async () => seen.length === 1, 30_000, 'checkout requested'); assert.equal(seen[0].data.eventId, B, `${order}: checkout is for B, never A`)
    } finally { await ctx.close() }
  }
})
