import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet } from '../firebase/seed'

/** Pre-launch performance: MIOLOVE public pages start Firebase only for a browser that already has a session; login, sign-up and the signed-in home work exactly as before; IOMIXO always starts it. */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' }); browser = await launchPortals(app) })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })
const M = () => portalUrl(app, 'miolovealbum.com'), I = () => portalUrl(app, 'iomixo.com')
/** Does this browser hold the Firebase SDK's own database? It is created the moment Auth starts. */
const firebaseStarted = (page: Page) => page.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'firebaseLocalStorageDb'))

test('DEFER-B1. a new visitor: home, language home and guide never start Firebase; the public buttons are there', async () => {
  const c = await browser.newContext(); const page = await c.newPage()
  try {
    for (const path of ['/', '/en', '/es/ideas', '/privacy']) {
      await page.goto(`${M()}${path}`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(2000)
      assert.equal(await firebaseStarted(page), false, `${path}: Firebase must not start for a visitor without a session`)
    }
    await page.goto(`${M()}/`, { waitUntil: 'networkidle' }); assert.ok(await page.getByTestId('nav-try-free').count() >= 1, 'sign-up button')
    assert.equal(await page.getByTestId('nav-my-albums').count(), 0)
  } finally { await c.close() }
})

test('DEFER-B2. from the home to sign-up and login by plain navigation: Firebase starts, the account is created and signs in', async () => {
  const c = await browser.newContext(); const page = await c.newPage()
  try {
    await page.goto(`${M()}/`, { waitUntil: 'networkidle', timeout: 120_000 }); assert.equal(await firebaseStarted(page), false)
    const o = await newClient('account'); await seedSet(`users/${o.uid}`, { uid: o.uid, email: o.email, displayName: 'Anna', accountType: 'couple', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
    await page.getByTestId('nav-login').first().click(); await page.waitForURL(/\/login$/, { timeout: 60_000 })
    await page.locator('input[type="email"]').waitFor({ timeout: 60_000 }); let up = false; for (let i = 0; i < 40 && !up; i++) { up = await firebaseStarted(page); if (!up) await page.waitForTimeout(500) }
    assert.equal(up, true, '/login starts Firebase (client-side navigation from the home)')
    for (let a = 0; a < 6 && /\/login$/.test(page.url()); a++) {
      await page.locator('input[type="email"]').fill(o.email); await page.locator('input[type="password"]').fill('password123'); await page.locator('button[type="submit"]').click()
      await page.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 15_000 }).catch(() => {})
    }
    assert.ok(!/\/login$/.test(page.url()), 'signed in')
    // back on the public home the stored session is recognised: the signed-in button replaces the sign-up one
    await page.goto(`${M()}/`, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.getByTestId('nav-my-albums').first().waitFor({ state: 'visible', timeout: 60_000 }); assert.equal(await firebaseStarted(page), true)
  } finally { await c.close() }
})

test('DEFER-B3. sign-up page and IOMIXO start Firebase at once', async () => {
  const c = await browser.newContext(); const page = await c.newPage()
  try {
    await page.goto(`${M()}/register`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500); assert.equal(await firebaseStarted(page), true, '/register')
    await page.goto(`${I()}/`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
  } finally { await c.close() }
  const c2 = await browser.newContext(); const p2 = await c2.newPage()
  try { await p2.goto(`${I()}/`, { waitUntil: 'networkidle', timeout: 120_000 }); await p2.waitForTimeout(2000); assert.equal(await firebaseStarted(p2), true, 'IOMIXO home keeps starting Firebase') } finally { await c2.close() }
})
