import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser } from 'playwright-core'
import { startFakeRender, startNext, launch, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet } from '../firebase/seed'

/**
 * Billing read path + checkout/portal wiring with NEXT_PUBLIC_FIREBASE_BILLING (+ dashboard) on and Render answering 503 to everything:
 * subscription / payments / Event Passes come from Firestore, historical (legacy-backfill) subscription status is NOT shown as current, and no /stripe/* call is made.
 */
let render: FakeRender, app: App, browser: Browser
before(async () => {
  render = await startFakeRender()
  app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_FIREBASE_BILLING: 'true' })
  browser = await launch()
})
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const day = 86_400_000
const stripeCalls = () => render.calls.filter((c) => c.path.startsWith('/stripe') || c.path === '/user/me')

test('BL1. billing page on Firebase: current subscription from the webhook doc, payments ledger, active Event Pass; historical trial ignored; zero /stripe calls', async () => {
  const owner = await newClient('account'); const now = Date.now()
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, displayName: 'DJ Bill', plan: { tier: 'wedding', source: 'stripe', validUntil: new Date(now + 33 * day) }, stripeCustomerId: 'cus_ui1', createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`users/${owner.uid}/subscriptions/sub_hist`, { stripeSubscriptionId: 'sub_hist', legacyStatus: 'trialing', historical: true, stale: true, tier: 'wedding', currentPeriodEnd: new Date(now - 100 * day) })
  await seedSet(`users/${owner.uid}/subscriptions/sub_live`, { stripeSubscriptionId: 'sub_live', status: 'active', historical: false, stale: false, tier: 'wedding', currentPeriodStart: new Date(now - 2 * day), currentPeriodEnd: new Date(now + 28 * day), cancelAtPeriodEnd: false })
  await seedSet(`users/${owner.uid}/payments/pi_ui1`, { stripePaymentIntentId: 'pi_ui1', amountCents: 1999, currency: 'eur', status: 'succeeded', description: 'Subscription payment', createdAt: new Date(now - 2 * day) })
  await seedSet(`users/${owner.uid}/payments/pi_ui2`, { stripePaymentIntentId: 'pi_ui2', amountCents: 799, currency: 'eur', status: 'refunded', description: 'Event Pass 24H', createdAt: new Date(now - 9 * day) })
  await seedSet(`users/${owner.uid}/eventPasses/pi_pass_ui`, { status: 'active', validUntil: new Date(now + 5 * 3600_000), source: 'stripe', amountCents: 799, currency: 'eur', createdAt: new Date(now - 19 * 3600_000) })

  const ctx = await browser.newContext(); const page = await ctx.newPage()
  try {
    await page.goto(`${app.url}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
    for (let i = 0; i < 8 && !/dashboard|sessions/.test(page.url()); i++) {
      await page.locator('input[type="email"]').fill(owner.email); await page.locator('input[type="password"]').fill('password123')
      await page.locator('button[type="submit"]').click(); await page.waitForURL(/dashboard|sessions/, { timeout: 15_000 }).catch(() => {})
    }
    assert.match(page.url(), /dashboard|sessions/)
    render.calls.length = 0
    await page.goto(`${app.url}/billing`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText('19.99 EUR').first().waitFor({ timeout: 90_000 })
    await page.getByText('7.99 EUR').first().waitFor({ timeout: 10_000 })
    await page.getByText('refunded').first().waitFor({ timeout: 10_000 })
    const body = await page.locator('body').innerText()
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const fmt = (t: number) => { const d = new Date(t); return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}` }       // date-fns 'd MMM yyyy'
    assert.ok(body.includes(fmt(now + 28 * day)), `current period end ${fmt(now + 28 * day)} is shown`)
    assert.ok(!body.includes(fmt(now - 100 * day)), 'the historical (stale legacy) period is NOT shown as current')
    assert.deepEqual(stripeCalls(), [], 'no /stripe/* or /user/me call reaches Render')
    assert.deepEqual(render.calls.filter((c) => c.method !== 'GET'), [])
  } catch (e) { await page.screenshot({ path: '/tmp/claude-501/billing-bl1.png' }).catch(() => {}); throw e } finally { await ctx.close() }
})
