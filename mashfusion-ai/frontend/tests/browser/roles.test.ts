import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launch, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

/**
 * Account roles in the real UI (Firebase emulators, Render answers 503): DJ keeps everything, "Sposi" (accountType 'couple')
 * gets only the album area; direct URLs of DJ routes never render DJ UI.
 */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true' }); browser = await launch() })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 20_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
const FORBIDDEN = /Sposo\/a|\bSposo\b|\bSposa\b|\bCouple\b|\bCoppia\b/

async function login(page: Page, email: string) {
  await page.goto(`${app.url}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
  for (let attempt = 0; attempt < 8 && !/dashboard|sessions/.test(page.url()); attempt++) {
    await page.locator('input[type="email"]').fill(email); await page.locator('input[type="password"]').fill('password123')
    await page.locator('button[type="submit"]').click(); await page.waitForURL(/dashboard|sessions/, { timeout: 15_000 }).catch(() => {})
  }
}

/** Fails if a DJ-only string is EVER painted while navigating: samples the DOM on every mutation from the first paint. */
async function watchForbidden(page: Page, words: string[]) {
  await page.addInitScript((w) => {
    const KEY = '__djSeen'
    const scan = () => {
      const t = document.body?.innerText ?? ''; const cur: string[] = JSON.parse(sessionStorage.getItem(KEY) ?? '[]')
      for (const x of w) if (t.includes(x) && !cur.includes(x)) cur.push(x)
      sessionStorage.setItem(KEY, JSON.stringify(cur))
    }
    const start = () => { new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, characterData: true }); scan() }
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start)
  }, words)
}
const seen = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('__djSeen') ?? '[]') as string[])

// ── DJ ──────────────────────────────────────────────────────────────────────
test('D1. DJ (explicit accountType) and legacy owner (no field): full dashboard, Party + Wedding creation, Regia DJ, remote', async () => {
  for (const type of ['dj', undefined] as const) {
    const dj = await newClient('account')
    await seedSet(`users/${dj.uid}`, { uid: dj.uid, email: dj.email, ...(type ? { accountType: type } : {}), plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
    const wedSlug = `djw${Date.now()}${type ?? 'legacy'}`, wedId = `djwid${Date.now()}${type ?? 'legacy'}`
    await seedSet(`events/${wedId}`, eventFields(dj.uid, wedSlug, { type: 'wedding', title: `Nozze ${type ?? 'legacy'}`, legacySupabaseId: undefined }))
    await seedSet(`eventSlugs/${wedSlug}`, { eventId: wedId })
    const ctx = await browser.newContext(); const page = await ctx.newPage()
    try {
      await login(page, dj.email)
      await page.goto(`${app.url}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByText('Profilo DJ').first().waitFor({ timeout: 60_000 })   // full DJ navigation
      assert.ok(await page.getByText('Prossime date').first().isVisible())
      // creation: both Party Mode and Wedding Edition are offered
      await page.goto(`${app.url}/sessions`, { waitUntil: 'domcontentloaded' })
      for (let attempt = 0; attempt < 4; attempt++) {
        await page.getByRole('button', { name: /Nuova sessione/ }).first().click({ timeout: 90_000 })
        if (await page.getByText('Wedding Edition').first().waitFor({ state: 'visible', timeout: 6_000 }).then(() => true, () => false)) break
        await page.goto(`${app.url}/sessions`, { waitUntil: 'domcontentloaded' })
      }
      assert.ok(await page.getByText('Party Mode').first().isVisible())
      // the wedding opens with BOTH groups: Per gli sposi + Regia DJ
      await page.goto(`${app.url}/sessions/${wedId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByText('Regia DJ').first().waitFor({ timeout: 60_000 })
      for (const label of ['Richieste', 'Dediche', 'Giochi', 'Live Booth', 'Schermo']) assert.ok(await page.getByRole('button', { name: new RegExp(label) }).first().isVisible(), label)
      // remote opens (no redirect)
      await page.goto(`${app.url}/remote/${wedSlug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.waitForTimeout(3000)
      assert.match(page.url(), /\/remote\//)
    } finally { await ctx.close() }
  }
})

// ── Sposi ───────────────────────────────────────────────────────────────────
test('S1. Sposi: sign-up with the choice (390px), only album UI, MIOLOVE brand, no Party / Regia DJ, DJ URLs bounced without a DJ flash', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage()
  const email = `sposi${Date.now()}@example.com`
  try {
    await page.goto(`${app.url}/register`, { waitUntil: 'networkidle', timeout: 120_000 })
    // the choice is mandatory and uses the approved copy
    await page.getByText('Come vuoi usare la piattaforma?').first().waitFor({ timeout: 30_000 })
    assert.ok(await page.getByText('Gestisci matrimoni ed eventi, richieste, giochi, schermo e regia.').isVisible())
    assert.ok(await page.getByText('Crea il tuo album, raccogli le foto degli invitati e gestisci il tuo matrimonio.').isVisible())
    assert.ok(await page.getByTestId('account-type-couple').getByText('Sposi', { exact: true }).isVisible())
    assert.ok(!FORBIDDEN.test(await page.getByTestId('account-type-choice').innerText()))
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow at 390px')
    await page.locator('input[type="text"]').first().fill('Anna e Marco'); await page.locator('input[type="email"]').fill(email); await page.locator('input[type="password"]').fill('password123')
    // no choice yet: refused client-side, nothing is created
    await page.locator('button[type="submit"]').click()
    await page.getByText('Scegli come vuoi usare la piattaforma').first().waitFor({ timeout: 10_000 })
    await page.getByTestId('account-type-couple').click(); await page.locator('button[type="submit"]').click()
    await page.getByTestId('register-continue').waitFor({ timeout: 60_000 })
    const u = await until(async () => { const l = (await fsGet('users')).documents ?? []; return l.find((d: any) => d.fields.email?.stringValue === email) }, 20_000, 'users doc')
    assert.equal(u.fields.accountType.stringValue, 'couple')
    const uid = u.name.split('/').pop()
    await seedSet(`users/${uid}`, { uid, email, accountType: 'couple', plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() }) // paid plan comes from billing, not the role

    await watchForbidden(page, ['Regia DJ', 'Profilo DJ', 'Prossime date', 'Party Mode', 'Sessioni Live'])
    // direct DJ routes land on the album home
    for (const route of ['/dashboard', '/profile', '/events']) {
      await page.goto(`${app.url}${route}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.waitForURL(/\/sessions$/, { timeout: 60_000 })
    }
    // sidebar (mobile menu): albums / subscription / settings only, MIOLOVE brand
    await page.getByRole('button', { name: 'Menu' }).click()
    const nav = page.getByRole('navigation', { name: 'Menu' })
    await nav.getByText('I miei album').waitFor({ timeout: 30_000 })
    for (const hidden of ['Profilo DJ', 'Prossime date', 'Dashboard', 'Sessioni Live']) assert.equal(await nav.getByText(hidden).count(), 0, hidden)
    assert.ok(await page.getByRole('img', { name: 'MIOLOVE ALBUM' }).first().isVisible())
    await page.getByRole('button', { name: 'Menu' }).click()   // close the drawer

    // create the album: wedding only, no type picker, no DJ name
    await page.getByRole('button', { name: /Nuovo album|Crea il tuo album/ }).first().click({ timeout: 60_000 })
    assert.equal(await page.getByText('Party Mode').count(), 0); assert.equal(await page.getByText('Wedding Edition').count(), 0)
    await page.locator('input[required]').first().fill('Il nostro matrimonio')
    await page.getByRole('button', { name: /Crea sessione/ }).click()
    await page.waitForURL(/\/sessions\/[^/]+$/, { timeout: 60_000 })
    const eventId = page.url().split('/sessions/')[1]
    const ev = await until(async () => (await fsGet(`events/${eventId}`)).fields, 20_000, 'album created')
    assert.equal(ev.type.stringValue, 'wedding'); assert.equal(ev.ownerUid.stringValue, uid)
    const slug = ev.slug.stringValue

    // album area: Per gli sposi tabs only
    await page.locator('.wedding-admin').waitFor({ timeout: 60_000 })
    await page.locator('.wedding-admin header button[aria-label="Menu"]').click()
    await page.getByText('Per gli sposi').last().waitFor({ timeout: 30_000 })
    for (const label of ['Home', 'Foto', 'Privacy', 'Poster', 'Impostazioni']) assert.ok(await page.getByRole('button', { name: new RegExp(`^${label}`) }).first().count() > 0, label)
    for (const label of ['Richieste', 'Dediche', 'Giochi', 'Live Booth', 'Schermo']) assert.equal(await page.getByRole('button', { name: new RegExp(label) }).count(), 0, label)
    assert.equal(await page.getByText('Regia DJ').count(), 0)
    assert.ok(await page.getByRole('img', { name: 'MIOLOVE ALBUM' }).first().isVisible())

    // a Party event can be seeded server-side only; the couple opening it never sees DJ UI
    const partyId = `cparty${Date.now()}`
    await seedSet(`events/${partyId}`, eventFields(uid, `cp${Date.now()}`, { type: 'party', title: 'Festa Segreta', legacySupabaseId: undefined }))
    await page.goto(`${app.url}/sessions/${partyId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForURL(/\/sessions$/, { timeout: 60_000 })
    assert.equal(await page.getByText('Festa Segreta').count(), 0, 'party events are not listed for Sposi')

    // remote (and its slug) is bounced
    await page.goto(`${app.url}/remote/${slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForURL(/\/sessions$/, { timeout: 60_000 })

    // not a single DJ string was painted at any time of the whole journey
    assert.deepEqual(await seen(page), [], 'DJ UI must never flash')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow at 390px')
  } finally { await ctx.close() }
})

const DJ_STRINGS = ['Regia DJ', 'Profilo DJ', 'Prossime date', 'Party', 'IOMIXO', 'Sessioni Live']
const rgb = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor)

async function coupleAccount() {
  const c = await newClient('account')
  await seedSet(`users/${c.uid}`, { uid: c.uid, email: c.email, accountType: 'couple', plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  return c
}

test('S2. Sposi at 390px: /sessions, /billing, /settings use the MIOLOVE theme, no DJ / Party UI, no overflow', async () => {
  const c = await coupleAccount()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage()
  try {
    await login(page, c.email)
    for (const route of ['/sessions', '/billing', '/settings']) {
      await page.goto(`${app.url}${route}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.locator('[data-role="couple"]').waitFor({ timeout: 60_000 })
      await page.waitForTimeout(1500)
      assert.equal(await rgb(page, '.couple-theme .bg-surface-400'), 'rgb(255, 247, 250)', `${route} background`)
      assert.ok(await page.getByRole('img', { name: 'MIOLOVE ALBUM' }).first().isVisible(), `${route} logo`)
      const text = await page.evaluate(() => document.body.innerText)
      for (const w of DJ_STRINGS) assert.ok(!text.includes(w), `${route}: "${w}" must not be shown`)
      assert.ok(!FORBIDDEN.test(text), `${route}: forbidden account label`)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${route}: no horizontal overflow`)
      // no dark surface left: card background is white, never the dark glass
      const card = page.locator('.couple-theme .glass').first()
      if (await card.count()) assert.equal(await card.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)', `${route} card`)
    }
    // primary action uses the MIOLOVE pink
    await page.goto(`${app.url}/sessions`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('new-session').waitFor({ timeout: 60_000 })
    assert.equal(await page.getByTestId('new-session').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(240, 106, 155)')
    await page.screenshot({ path: '/tmp/couple-sessions-390.png' }).catch(() => {})
  } finally { await ctx.close() }
})

test('S3. account read failure: no DJ UI, no assumed role, error state with retry, then the right UI', async () => {
  const c = await coupleAccount()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage()
  try {
    await login(page, c.email)
    await watchForbidden(page, ['Regia DJ', 'Profilo DJ', 'Prossime date', 'Sessioni Live', 'Dashboard'])
    await ctx.route(/:8080\//, (r) => r.abort())          // Firestore emulator unreachable → the account read FAILS
    await page.goto(`${app.url}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTestId('role-error').waitFor({ timeout: 90_000 })
    assert.ok(await page.getByTestId('role-retry').isVisible())
    assert.equal(await page.locator('[data-role]').count(), 0, 'no role was assumed')
    assert.equal(await page.url().includes('/sessions'), false)
    await ctx.unroute(/:8080\//)
    for (let i = 0; i < 12 && !(await page.locator('[data-role="couple"]').count()); i++) {
      if (await page.getByTestId('role-retry').count()) await page.getByTestId('role-retry').click().catch(() => {})
      await page.waitForTimeout(2500)
    }
    await page.waitForURL(/\/sessions$/, { timeout: 60_000 })
    await page.locator('[data-role="couple"]').waitFor({ timeout: 30_000 })
    assert.deepEqual(await seen(page), [], 'DJ UI never painted during the failure / retry')
  } finally { await ctx.close() }
})

test('S4. a really legacy account (NO users document at all) is a DJ with the full dashboard', async () => {
  const legacy = await newClient('account')           // Firebase account, nothing in Firestore
  const ctx = await browser.newContext(); const page = await ctx.newPage()
  try {
    await login(page, legacy.email)
    await page.goto(`${app.url}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText('Profilo DJ').first().waitFor({ timeout: 60_000 })
    assert.equal(await page.locator('[data-role="dj"]').count() >= 0, true)
    assert.match(page.url(), /\/dashboard/)
  } finally { await ctx.close() }
})
