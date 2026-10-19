import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

/**
 * ONE Firebase identity (same uid / email / password) uses BOTH products. The domain decides the product; accountType (dj | couple | missing) is never a
 * barrier and never redirects across domains; each dashboard lists only the resources of its own product. Real hostnames mapped to the local dev server.
 */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' }); browser = await launchPortals(app) })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const I = () => portalUrl(app, 'iomixo.com'), M = () => portalUrl(app, 'miolovealbum.com')
const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 30_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
async function signIn(page: Page, base: string, email: string) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1200)
  // The first request after a cold dev-server start can swallow the submit (hydration not done yet): retry until the page leaves /login.
  for (let attempt = 0; attempt < 6 && /\/login/.test(page.url()); attempt++) {
    await page.locator('input[type="email"]').fill(email); await page.locator('input[type="password"]').fill('password123'); await page.locator('button[type="submit"]').click()
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 15_000 }).catch(() => {})
  }
}
/** Every main-frame host a page ever visited: a cross-domain redirect (or a loop) would show up here. */
const trackHosts = (page: Page) => { const hosts: string[] = []; page.on('framenavigated', (f) => { if (f === page.mainFrame() && /^https?:/.test(f.url())) hosts.push(new URL(f.url()).hostname) }); return hosts }
const stable = async (page: Page) => { const url = page.url(); await page.waitForTimeout(3500); assert.equal(page.url(), url, 'no redirect loop: the URL is stable') }

type Type = 'dj' | 'couple' | undefined
const TYPES: Type[] = ['dj', 'couple', undefined]
const label = (t: Type) => t ?? 'missing'

for (const type of TYPES) {
  test(`DUAL1 [accountType ${label(type)}]. same uid: login IOMIXO → iomixo.com dashboard with ONLY IOMIXO events; login MIOLOVE → miolovealbum.com with ONLY the album; no redirect, no loop`, async () => {
    const u = await newClient('account'), stamp = Date.now()
    await seedSet(`users/${u.uid}`, { uid: u.uid, email: u.email, ...(type ? { accountType: type } : {}), plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
    const T = { a: `IomixoUno${stamp}`, b: `IomixoDue${stamp}`, album: `AlbumMiolove${stamp}` }
    const ids = { a: `da${stamp}`, b: `db${stamp}`, album: `dm${stamp}` }
    const seed = (id: string, slug: string, extra: Record<string, unknown>) => Promise.all([
      seedSet(`events/${id}`, eventFields(u.uid, slug, { legacySupabaseId: undefined, ...extra })), seedSet(`eventSlugs/${slug}`, { eventId: id }),
    ])
    await seed(ids.a, `sa${stamp}`, { type: 'party', brand: 'iomixo', title: T.a })
    await seed(ids.b, `sb${stamp}`, { type: 'standard', brand: 'iomixo', title: T.b })
    await seed(ids.album, `sm${stamp}`, { type: 'wedding', brand: 'miolove', accessMode: 'activated', title: T.album })

    // ── 1. IOMIXO ──
    let ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); let page = await ctx.newPage(); let hosts = trackHosts(page)
    try {
      await signIn(page, I(), u.email)
      await page.waitForURL(/iomixo\.com:\d+\/dashboard/, { timeout: 60_000 })
      await page.getByText('Profilo DJ').first().waitFor({ timeout: 60_000 })                  // the IOMIXO navigation, never the MIOLOVE one
      assert.equal(await page.locator('[data-role="couple"]').count(), 0, 'IOMIXO UI, not the Sposi theme')
      await page.getByText(T.a).first().waitFor({ timeout: 60_000 })
      assert.equal(await page.getByText(T.album).count(), 0, 'dashboard: the MIOLOVE album is not an IOMIXO event')
      await page.goto(`${I()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByText(T.a).first().waitFor({ timeout: 60_000 }); await page.getByText(T.b).first().waitFor({ timeout: 60_000 })
      assert.equal(await page.getByText(T.album).count(), 0, 'IOMIXO list: no MIOLOVE album')
      // the album URL does not open on IOMIXO: replaced on the same domain
      await page.goto(`${I()}/sessions/${ids.album}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.waitForURL(/iomixo\.com:\d+\/dashboard/, { timeout: 60_000 }); await stable(page)
      assert.deepEqual(Array.from(new Set(hosts)), ['iomixo.com'], 'never left iomixo.com')
    } finally { await ctx.close() }

    // ── 2. MIOLOVE: same uid, same credentials ──
    ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); page = await ctx.newPage(); hosts = trackHosts(page)
    try {
      await signIn(page, M(), u.email)
      await page.waitForURL(/miolovealbum\.com:\d+\/sessions/, { timeout: 60_000 })
      await page.locator('[data-role="couple"]').waitFor({ timeout: 60_000 })                  // the MIOLOVE UI
      await page.getByText(T.album).first().waitFor({ timeout: 60_000 })
      for (const t of [T.a, T.b]) assert.equal(await page.getByText(t).count(), 0, `MIOLOVE list: no IOMIXO event ${t}`)
      assert.equal(await page.getByTestId('couple-onboarding').count(), 0, 'it has an album: no onboarding')
      assert.equal(await page.getByText('Profilo DJ').count(), 0)
      // the IOMIXO event URLs do not open on MIOLOVE, and DJ-only routes are replaced on the same domain
      await page.goto(`${M()}/sessions/${ids.a}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForURL(/miolovealbum\.com:\d+\/sessions$/, { timeout: 60_000 })
      await page.goto(`${M()}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForURL(/miolovealbum\.com:\d+\/sessions$/, { timeout: 60_000 }); await stable(page)
      // its own album opens
      await page.goto(`${M()}/sessions/${ids.album}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.locator('.wedding-admin').waitFor({ timeout: 60_000 })
      assert.match(page.url(), new RegExp(`miolovealbum\\.com:\\d+/sessions/${ids.album}`))
      assert.deepEqual(Array.from(new Set(hosts)), ['miolovealbum.com'], 'never left miolovealbum.com')
    } finally { await ctx.close() }
  })
}

test('DUAL2. same uid creates from each portal: IOMIXO → IOMIXO event, MIOLOVE → album (own brand, own trial rules); each portal then lists only its own', async () => {
  const u = await newClient('account'), stamp = Date.now()
  await seedSet(`users/${u.uid}`, { uid: u.uid, email: u.email, accountType: 'couple', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  const title = { iomixo: `NuovaIomixo${stamp}`, album: `NuovoAlbum${stamp}` }

  // couple-typed account on IOMIXO (Free): a standard session, not an album
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); let page = await ctx.newPage()
  try {
    await signIn(page, I(), u.email); await page.waitForURL(/iomixo\.com:\d+\/dashboard/, { timeout: 60_000 })
    await page.goto(`${I()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTestId('new-session').click({ timeout: 90_000 })
    await page.locator('input[required]').first().fill(title.iomixo)
    await page.locator('button[type="submit"]').first().click()
    await page.waitForURL(/iomixo\.com:\d+\/sessions\/[^/]+$/, { timeout: 60_000 })
    const e = await until(async () => (await fsGet(`events/${page.url().split('/sessions/')[1]}`)).fields, 20_000, 'IOMIXO event')
    assert.deepEqual([e.brand.stringValue, e.type.stringValue, e.accessMode], ['iomixo', 'standard', undefined], 'an IOMIXO event: no MIOLOVE access, no trial')
  } finally { await ctx.close() }

  // the same uid on MIOLOVE: no album yet → onboarding → its free trial album, even though it already owns an IOMIXO event
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); page = await ctx.newPage()
  try {
    await signIn(page, M(), u.email)
    await page.getByTestId('couple-onboarding').waitFor({ timeout: 60_000 })
    await page.getByTestId('onboarding-name').fill(title.album)
    await page.getByTestId('onboarding-create').click()
    await page.waitForURL(/miolovealbum\.com:\d+\/sessions\/[^/]+$/, { timeout: 60_000 })
    const id = page.url().split('/sessions/')[1]
    const e = await until(async () => (await fsGet(`events/${id}`)).fields, 20_000, 'album')
    assert.deepEqual([e.brand.stringValue, e.type.stringValue, e.accessMode.stringValue, e.trialPhotoLimit.integerValue], ['miolove', 'wedding', 'trial', '50'])
    assert.equal(e.ownerUid.stringValue, u.uid, 'same identity')
    await page.goto(`${M()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText(title.album).first().waitFor({ timeout: 60_000 }); assert.equal(await page.getByText(title.iomixo).count(), 0)
  } finally { await ctx.close() }

  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); page = await ctx.newPage()
  try {
    await signIn(page, I(), u.email); await page.waitForURL(/iomixo\.com:\d+\/dashboard/, { timeout: 60_000 })
    await page.goto(`${I()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText(title.iomixo).first().waitFor({ timeout: 60_000 }); assert.equal(await page.getByText(title.album).count(), 0, 'IOMIXO does not show the MIOLOVE album')
  } finally { await ctx.close() }
})

test('DUAL3. registering on the other portal with an existing email does not create a second user: the same credentials simply log in there', async () => {
  const u = await newClient('account')
  await seedSet(`users/${u.uid}`, { uid: u.uid, email: u.email, accountType: 'dj', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  const ctx = await browser.newContext(); const page = await ctx.newPage()
  try {
    await page.goto(`${M()}/register`, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.locator('input[type="text"]').first().fill('Stessa Persona'); await page.locator('input[type="email"]').fill(u.email); await page.locator('input[type="password"]').fill('password123')
    await page.locator('button[type="submit"]').click()
    await page.getByText(/already exists|già/i).first().waitFor({ timeout: 60_000 })
    const users = ((await fsGet('users?pageSize=1000')).documents ?? []).filter((d: any) => d.fields.email?.stringValue === u.email)
    assert.equal(users.length, 1, 'still one users document for that email'); assert.equal(users[0].fields.accountType.stringValue, 'dj', 'accountType untouched')
    await signIn(page, M(), u.email); await page.waitForURL(/miolovealbum\.com:\d+\/(sessions|onboarding)/, { timeout: 60_000 })
  } finally { await ctx.close() }
})
