import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launch, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

/**
 * Profile + avatar cutover: NEXT_PUBLIC_FIRESTORE_DASHBOARD on, Render answers 503 to EVERYTHING. Settings (name + account avatar) and the DJ profile
 * page (fields + public avatar) read and write Firestore / Storage only; the public guest page shows the DJ avatar through getPublicEvent.
 */
let render: FakeRender, app: App, browser: Browser
before(async () => {
  render = await startFakeRender()
  app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true' })
  browser = await launch()
})
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const fsDoc = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
const objects = async (uid: string) => ((await (await fetch(`http://127.0.0.1:9199/v0/b/demo-iomixo.firebasestorage.app/o?prefix=${encodeURIComponent(`profiles/${uid}/avatar/`)}`, { headers: { authorization: 'Bearer owner' } })).json()).items ?? []).map((i: any) => i.name as string)
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 20_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
// guest presence heartbeats (still Render, a different domain) are the only tolerated writes
const nonGet = () => render.calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/heartbeat'))
const legacyProfileCalls = () => render.calls.filter((c) => /^\/(user\/(me|profile|avatar)|api\/dj\/profile)/.test(c.path))

// 1×1 PNG / minimal JPEG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'), Buffer.alloc(300, 1), Buffer.from([0xff, 0xd9])])

async function login() {
  const owner = await newClient('account'); const stamp = Date.now()
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, displayName: 'DJ Firestore', plan: { tier: 'pro', source: 'legacy' }, legacySupabaseId: `sb-${stamp}`, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`djProfiles/${owner.uid}`, { displayName: 'Stage Old', bio: 'Old bio', instagramUrl: 'https://instagram.com/old', publicSlug: 'old-slug', createdAt: new Date(), updatedAt: new Date() })
  const id = `pev${stamp}`, slug = `pslug${stamp}`
  await seedSet(`events/${id}`, eventFields(owner.uid, slug, { type: 'party', title: 'Evento Profilo', legacySupabaseId: `legacy-${stamp}` })); await seedSet(`eventSlugs/${slug}`, { eventId: id })
  const ctx = await browser.newContext(); const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  await page.goto(`${app.url}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
  for (let attempt = 0; attempt < 8 && !/dashboard|sessions/.test(page.url()); attempt++) {
    await page.locator('input[type="email"]').fill(owner.email); await page.locator('input[type="password"]').fill('password123')
    await page.locator('button[type="submit"]').click(); await page.waitForURL(/dashboard|sessions/, { timeout: 15_000 }).catch(() => {})
  }
  assert.match(page.url(), /dashboard|sessions/, 'login must succeed against the Auth emulator')
  return { page, ctx, owner, slug }
}
const shot = (page: Page, name: string) => page.screenshot({ path: `/tmp/claude-501/profile-${name}.png` }).catch(() => {})

test('P1. settings: profile opens from Firestore, rename, upload / replace / remove the account avatar — Render 503, zero legacy calls', async () => {
  const s = await login()
  try {
    render.calls.length = 0
    await s.page.goto(`${app.url}/settings`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const name = s.page.locator('input[maxlength="80"]').first()
    await until(async () => (await name.inputValue().catch(() => '')) === 'DJ Firestore', 90_000, 'name from users/{uid}')
    await name.fill('Nome Nuovo'); await s.page.getByRole('button', { name: /^(Save|Salva)$/ }).first().click()
    await until(async () => (await fsDoc(`users/${s.owner.uid}`)).fields?.displayName?.stringValue === 'Nome Nuovo', 15_000, 'rename persisted')

    const file = s.page.locator('input[type="file"]').first()
    await file.setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG })
    const first = await until(async () => (await fsDoc(`users/${s.owner.uid}`)).fields?.avatarPath?.stringValue, 30_000, 'avatar committed')
    assert.match(first, new RegExp(`^profiles/${s.owner.uid}/avatar/user-[A-Za-z0-9_-]{16,}\\.png$`))
    const url1 = (await fsDoc(`users/${s.owner.uid}`)).fields.avatarUrl.stringValue
    assert.equal((await fetch(url1)).status, 200, 'avatar URL is served')
    await s.page.locator(`img[alt="Avatar"]`).first().waitFor({ timeout: 30_000 })           // next/image accepts the Firebase host
    assert.equal(await s.page.locator('img[alt="Avatar"]').first().evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), true, 'avatar rendered')

    await file.setInputFiles({ name: 'b.jpg', mimeType: 'image/jpeg', buffer: JPG })        // replace
    const second = await until(async () => { const p = (await fsDoc(`users/${s.owner.uid}`)).fields?.avatarPath?.stringValue; return p && p !== first ? p : false }, 30_000, 'avatar replaced')
    assert.match(second, /\.jpg$/); assert.deepEqual(await objects(s.owner.uid), [second], 'the replaced file was deleted')
    assert.equal((await fetch(url1)).status === 200, false, 'old URL is dead')

    await s.page.getByRole('button', { name: /(Remove|Rimuovi)/ }).first().click()
    await until(async () => !(await fsDoc(`users/${s.owner.uid}`)).fields?.avatarPath, 30_000, 'avatar removed')
    assert.deepEqual(await objects(s.owner.uid), [], 'cleanup complete')
    assert.deepEqual(legacyProfileCalls(), [], 'profile/avatar never reach Render'); assert.deepEqual(nonGet(), [])
    assert.equal((await fsDoc(`users/${s.owner.uid}`)).fields.plan.mapValue.fields.tier.stringValue, 'pro', 'plan untouched')
  } catch (e) { await shot(s.page, 'p1'); throw e } finally { await s.ctx.close() }
})

test('P2. DJ profile: loads from djProfiles, edits fields, uploads / removes the public avatar; the guest page shows it; slug stays as migrated', async () => {
  const s = await login()
  try {
    render.calls.length = 0
    await s.page.goto(`${app.url}/profile`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const stage = s.page.locator('input').first()
    await until(async () => (await stage.inputValue().catch(() => '')) === 'Stage Old', 90_000, 'DJ profile from djProfiles/{uid}')
    assert.equal(await s.page.locator('textarea').first().inputValue(), 'Old bio')
    assert.equal(await s.page.locator('input[value="old-slug"]').getAttribute('readonly') !== null, true, 'slug is read-only (kept as migrated)')
    await stage.fill('Stage New'); await s.page.locator('textarea').first().fill('Nuova bio')
    await s.page.locator('input[placeholder^="https://instagram"]').fill('https://instagram.com/new')
    await s.page.locator('button[type="submit"]').click()
    await until(async () => { const f = (await fsDoc(`djProfiles/${s.owner.uid}`)).fields; return f?.displayName?.stringValue === 'Stage New' && f?.bio?.stringValue === 'Nuova bio' && f?.instagramUrl?.stringValue === 'https://instagram.com/new' && f?.publicSlug?.stringValue === 'old-slug' }, 15_000, 'dj profile saved, slug untouched')

    await s.page.locator('input[type="file"]').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG })
    const path = await until(async () => (await fsDoc(`djProfiles/${s.owner.uid}`)).fields?.avatarPath?.stringValue, 30_000, 'dj avatar committed')
    assert.match(path, /\/dj-[A-Za-z0-9_-]{16,}\.png$/)
    assert.equal((await fsDoc(`djProfiles/${s.owner.uid}`)).fields.displayName.stringValue, 'Stage New', 'commit keeps the edited fields')

    // a guest (new context, anonymous) sees the avatar on the public event page via getPublicEvent
    const gctx = await browser.newContext(); const guest = await gctx.newPage()
    try {
      await guest.goto(`${app.url}/live/${s.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await guest.getByText('Nuova bio').first().waitFor({ timeout: 60_000 })               // public profile text (getPublicEvent)
      await guest.getByText('Richiedi una canzone').first().click()                  // open the music-request section, where the DJ avatar is shown
      const src = await until(async () => guest.locator('img.rounded-full').first().getAttribute('src').catch(() => null), 60_000, 'avatar on the guest page')
      assert.equal(src, (await fsDoc(`djProfiles/${s.owner.uid}`)).fields.avatarUrl.stringValue)
    } catch (e) { await shot(guest, 'p2-guest'); console.error('GUEST BODY:', (await guest.locator('body').innerText().catch(() => '')).slice(0, 600), await guest.locator('img').evaluateAll((l) => l.map((i) => i.className + ' ' + (i as HTMLImageElement).src.slice(0, 80)))); throw e } finally { await gctx.close() }

    await s.page.getByRole('button', { name: /(Remove|Rimuovi)/ }).first().click()
    await until(async () => !(await fsDoc(`djProfiles/${s.owner.uid}`)).fields?.avatarPath, 30_000, 'dj avatar removed')
    assert.deepEqual(await objects(s.owner.uid), [])
    assert.deepEqual(legacyProfileCalls(), []); assert.deepEqual(nonGet(), [])
  } catch (e) { await shot(s.page, 'p2'); throw e } finally { await s.ctx.close() }
})
