import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'
import { SCREEN_BACKGROUND_IDS } from '../../lib/miolove/screenBackgrounds'

/** MIOLOVE "Sfondi": the owner picks the screen background from the Home; /screen shows it; per album; persists across reload and a new login. */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' }); browser = await launchPortals(app) })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const M = () => portalUrl(app, 'miolovealbum.com')
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 30_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
async function album(title: string) {
  const owner = await newClient('account'), stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`, id = `sb${stamp}`, slug = `sbslug${stamp}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, displayName: 'Enrico Rossi', accountType: 'couple', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${id}`, eventFields(owner.uid, slug, {
    type: 'wedding', brand: 'miolove', title, coupleNames: null, legacySupabaseId: undefined, occasionType: 'wedding', accessMode: 'activated', weddingDate: '2031-06-12', guestConfig: null, screenConfig: null,
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
const home = async (page: Page, a: { id: string }) => { await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.getByTestId('screen-bg-open').waitFor({ timeout: 90_000 }) }
const fsTheme = async (id: string) => ((await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/events/${id}`, { headers: { authorization: 'Bearer owner' } })).json()) as any).fields?.screenConfig?.mapValue?.fields?.backgroundTheme?.stringValue ?? null
const activeId = (page: Page) => page.locator('[data-testid^="screen-bg-"][data-active="true"]').getAttribute('data-testid')
const tvTheme = async (a: { slug: string }, title: string) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const tv = await ctx.newPage()
  try {
    await tv.goto(`${M()}/screen/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await tv.getByText(title).first().waitFor({ timeout: 90_000 })
    await tv.waitForTimeout(1500)
    const bd = tv.getByTestId('screen-backdrop')
    return { theme: (await bd.count()) ? await bd.getAttribute('data-theme') : null, title: await tv.getByText(title).first().isVisible(), date: /2031/.test(await tv.evaluate(() => document.body.innerText)) }
  } finally { await ctx.close() }
}

test('SBB1. "Sfondi" on the Home: modal, all presets, active highlighted, select+apply, reload/relogin keep it, /screen shows it, switch, Default restores', async () => {
  const a = await album('Album Sfondi A'); const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage()
  try {
    await login(page, a.owner.email); await home(page, a)
    await page.getByTestId('screen-bg-open').click(); await page.getByTestId('screen-bg-modal').waitFor()
    for (const id of SCREEN_BACKGROUND_IDS) await page.getByTestId(`screen-bg-${id}`).waitFor()
    assert.equal(await page.locator('[data-testid^="screen-bg-"][data-active]').count(), 6)
    assert.equal(await activeId(page), 'screen-bg-default', 'fresh album: Default is active')
    assert.equal(await page.getByTestId('screen-bg-check').count(), 1)
    assert.equal(await page.getByTestId('screen-bg-apply').isDisabled(), true, 'nothing changed yet')
    assert.equal((await tvTheme(a, 'Album Sfondi A')).theme, null, 'default: stage as before')

    await page.getByTestId('screen-bg-romantic_pink_bokeh').click(); assert.equal(await activeId(page), 'screen-bg-romantic_pink_bokeh')
    await page.getByTestId('screen-bg-apply').click(); await page.getByTestId('screen-bg-modal').waitFor({ state: 'detached' })
    await until(async () => (await fsTheme(a.id)) === 'romantic_pink_bokeh', 30_000, 'saved in Firestore')

    await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByTestId('screen-bg-open').waitFor({ timeout: 90_000 })
    await page.getByTestId('screen-bg-open').click(); await until(async () => (await activeId(page)) === 'screen-bg-romantic_pink_bokeh', 30_000, 'active after reload')
    await page.getByTestId('screen-bg-modal').getByLabel('Chiudi').click(); await page.getByTestId('screen-bg-modal').waitFor({ state: 'detached' })

    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p2 = await ctx2.newPage()          // logout/login = a brand new session
    try { await login(p2, a.owner.email); await home(p2, a); await p2.getByTestId('screen-bg-open').click(); await until(async () => (await activeId(p2)) === 'screen-bg-romantic_pink_bokeh', 30_000, 'active after re-login') } finally { await ctx2.close() }

    const tv = await tvTheme(a, 'Album Sfondi A'); assert.equal(tv.theme, 'romantic_pink_bokeh'); assert.ok(tv.title && tv.date, 'title and date unchanged')

    await page.getByTestId('screen-bg-open').click(); await page.getByTestId('screen-bg-violet_light_ribbons').click(); await page.getByTestId('screen-bg-apply').click()
    await until(async () => (await fsTheme(a.id)) === 'violet_light_ribbons', 30_000, 'switched')
    assert.equal((await tvTheme(a, 'Album Sfondi A')).theme, 'violet_light_ribbons')

    await page.getByTestId('screen-bg-open').click(); await page.getByTestId('screen-bg-reset').click()
    await until(async () => (await fsTheme(a.id)) === 'default', 30_000, 'reset saved')
    assert.equal((await tvTheme(a, 'Album Sfondi A')).theme, null, 'Default restored')
  } finally { await ctx.close() }
})

test('SBB2. two albums keep their own theme (A pink, B green)', async () => {
  const a = await album('Album Rosa'), b = await album('Album Verde')
  for (const [al, theme] of [[a, 'romantic_pink_bokeh'], [b, 'botanical_green_mist']] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage()
    try { await login(page, al.owner.email); await home(page, al); await page.getByTestId('screen-bg-open').click(); await page.getByTestId(`screen-bg-${theme}`).click(); await page.getByTestId('screen-bg-apply').click(); await until(async () => (await fsTheme(al.id)) === theme, 30_000, theme) } finally { await ctx.close() }
  }
  assert.equal((await tvTheme(a, 'Album Rosa')).theme, 'romantic_pink_bokeh'); assert.equal((await tvTheme(b, 'Album Verde')).theme, 'botanical_green_mist')
})
