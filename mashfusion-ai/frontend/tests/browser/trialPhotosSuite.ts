import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { newClient, closeClient } from '../firebase/helpers'
import { seedSet, seedUpdate, eventFields } from '../firebase/seed'

export function trialPhotoSuite(vps: Array<{ width: number; height: number }>, withActivated: boolean) {
/** MIOLOVE free trial, photos: a Free couple's album collects guest photos up to the limit, in the real UI (Firebase emulators). */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' }); browser = await launchPortals(app) })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const M = () => portalUrl(app, 'miolovealbum.com')
const LIMIT = 50
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const fsDoc = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
const countOf = async (id: string) => Number((await fsDoc(`events/${id}`)).fields.trialPhotoCount?.integerValue ?? -1)
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 30_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 500)) }
}
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
const FORBIDDEN = /Advance|Event Pass|IOMIXO|permission|denied|Piano (Advance|Pro|Free)/i

async function trialAlbum() {
  const owner = await newClient('account'), id = `tpb${Date.now()}`, slug = `tpbs${Date.now()}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, displayName: 'Enrico Rossi', accountType: 'couple', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${id}`, eventFields(owner.uid, slug, { type: 'wedding', title: 'Album Prova', legacySupabaseId: undefined, occasionType: 'wedding', accessMode: 'trial', trialPhotoCount: 0, trialPhotoLimit: LIMIT, guestConfig: { requests: false, live_booth: true } }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  return { owner, id, slug }
}
async function login(page: Page, email: string) {
  await page.goto(`${M()}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
  for (let attempt = 0; attempt < 8 && /\/login$/.test(page.url()); attempt++) {
    await page.locator('input[type="email"]').fill(email); await page.locator('input[type="password"]').fill('password123')
    await page.locator('button[type="submit"]').click(); await page.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 15_000 }).catch(() => {})
  }
}
async function goTab(page: Page, name: RegExp) {
  await page.locator('button[aria-label="Menu"]:visible, nav[aria-label="Wedding"]:visible').first().waitFor({ timeout: 90_000 })
  const menu = page.getByRole('button', { name: 'Menu', exact: true }); if (await menu.isVisible().catch(() => false)) await menu.click()
  await page.locator('nav[aria-label="Wedding"]:visible').getByRole('button', { name }).first().click({ timeout: 30_000 })
}
const quota = (p: Page) => p.getByTestId('trial-quota-count').first()
/** One guest upload through the Live Booth page; resolves with the page so the caller can read what the guest sees. */
async function guestUpload(ctxGuest: Awaited<ReturnType<Browser['newContext']>>, slug: string) {
  const g = await ctxGuest.newPage(); await g.goto(`${M()}/booth/${slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  // The album uploader sends a picked file on its own (no "send" button): photos AND videos, original quality.
  await g.getByTestId('guest-upload-input').waitFor({ state: 'attached', timeout: 90_000 })
  await g.getByTestId('guest-upload-input').setInputFiles({ name: 'selfie.png', mimeType: 'image/png', buffer: PNG })
  return g
}

for (const vp of vps) {
  test(`Q1. trial album @${vp.width}: quota 0/${LIMIT}, QR + Live Booth open, guest photo counts, 50/50 shows the limit, delete frees a slot`, async () => {
    const a = await trialAlbum()
    const ctx = await browser.newContext({ viewport: vp }), guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage(); page.on('dialog', (d) => d.accept())
    try {
      await login(page, a.owner.email)
      await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })

      // Home: "Prova gratuita", 0 / 50 foto, bar, hint, no payment CTA yet
      await quota(page).waitFor({ timeout: 90_000 })
      assert.equal((await quota(page).innerText()).replace(/\s+/g, ' '), `0 / ${LIMIT} contenuti`)
      const home = await page.evaluate(() => document.body.innerText)
      assert.match(home, /Prova gratuita/); assert.match(home, new RegExp(`Puoi raccogliere fino a ${LIMIT} contenuti \\(foto o video, insieme\\) gratuitamente\\.`))
      assert.doesNotMatch(home, FORBIDDEN); assert.equal(await page.getByTestId('album-activate').count(), 0)
      assert.equal(await page.getByRole('progressbar').first().getAttribute('aria-valuenow'), '0')
      assert.equal(await overflow(page), false, 'home overflow')
      await page.screenshot({ path: `/tmp/trial-quota-home-${vp.width}.png` }).catch(() => {})

      // Photos: quota (no guest-link card)
      await goTab(page, /^Foto$|Foto/)
      await quota(page).waitFor({ timeout: 60_000 })
      assert.equal(await page.getByTestId('wd-photos-guest-link').count(), 0, 'no guest-link card')
      assert.equal((await quota(page).innerText()).replace(/\s+/g, ' '), `0 / ${LIMIT} contenuti`)
      assert.equal(await overflow(page), false, 'photos overflow')

      // One guest collection: no separate Live Booth view, no guest URL / QR / copy / open in the Photos section
      assert.equal(await page.getByRole('button', { name: /Live Booth/ }).count(), 0, 'no Live Booth segment in a MIOLOVE album')
      assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /bloccat|Advance|Event Pass/i)
      assert.equal(await page.locator('svg[width="104"]').count(), 0, 'no guest QR in Photos')
      assert.equal(await page.getByRole('button', { name: /Copia link/ }).count(), 0, 'no copy-link in Photos')

      // guest uploads -> counter 1, shown in the owner's page
      const g1 = await guestUpload(guestCtx, a.slug)
      await until(async () => (await countOf(a.id)) === 1, 40_000, 'counter 1')
      await until(async () => /^1 \/ 50 contenuti$/.test((await quota(page).innerText().catch(() => '')).replace(/\s+/g, ' ')), 30_000, 'owner sees 1 / 50')
      await g1.close()

      // 49 -> the 50th is accepted; 50 / 50 shows the limit and the placeholder CTA
      await seedUpdate(`events/${a.id}`, { trialPhotoCount: LIMIT - 1 })
      const g50 = await guestUpload(guestCtx, a.slug)
      await until(async () => (await countOf(a.id)) === LIMIT, 40_000, '50th photo accepted'); await g50.close()
      await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await quota(page).waitFor({ timeout: 90_000 })
      assert.equal((await quota(page).innerText()).replace(/\s+/g, ' '), `${LIMIT} / ${LIMIT} contenuti`)
      await page.getByText('Limite della prova gratuita raggiunto').waitFor({ timeout: 30_000 })
      const cta = page.getByTestId('album-activate'); assert.equal(await cta.getAttribute('data-album-id'), a.id, 'the CTA pays THIS album'); assert.match((await cta.innerText()).replace(/\s+/g, ' '), /Attiva album — €19,99/)
      assert.equal(await overflow(page), false, 'full overflow')
      await page.screenshot({ path: `/tmp/trial-quota-full-${vp.width}.png` }).catch(() => {})

      // guest over the limit: friendly message, album still open and photos still visible, nothing created
      const before = (await fsDoc(`events/${a.id}/photos`)).documents?.length ?? 0
      const gOver = await guestUpload(guestCtx, a.slug)
      await gOver.getByText(/Questo album ha raggiunto il limite della prova gratuita/).first().waitFor({ timeout: 40_000 })
      assert.doesNotMatch(await gOver.evaluate(() => document.body.innerText), FORBIDDEN)
      assert.equal(await overflow(gOver), false, 'guest overflow'); await gOver.screenshot({ path: `/tmp/trial-guest-limit-${vp.width}.png` }).catch(() => {})
      assert.equal(await countOf(a.id), LIMIT); assert.equal((await fsDoc(`events/${a.id}/photos`)).documents?.length ?? 0, before, 'the refused slot left no document')
      await gOver.goto(`${M()}/live/${a.slug}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await gOver.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {}); await gOver.waitForTimeout(3000)
      const liveText = await gOver.evaluate(() => document.body.innerText)
      assert.ok(liveText.trim().length > 20 && !/non trovata|terminata|not found/i.test(liveText), `guest page stays open: ${liveText.slice(0, 200)}`)
      const reader = await newClient('anonymous')   // the approved photos stay readable by guests (rules), the album is not locked
      const approved = await getDocs(query(collection(reader.db, 'events', a.id, 'photos'), where('status', '==', 'approved')))
      assert.ok(approved.size >= 1, 'existing photos remain readable')
      await closeClient(reader)
      assert.doesNotMatch(await gOver.evaluate(() => document.body.innerText), FORBIDDEN); await gOver.close()

      // owner deletes one photo -> 49 / 50 and a new guest photo is accepted again
      await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await goTab(page, /^Foto$|Foto/)
      await page.locator('img[src*="127.0.0.1:9199"]').first().waitFor({ timeout: 60_000 })
      await page.locator('div.group', { has: page.locator('img') }).first().hover()
      await page.locator('button[title="Elimina"]').first().click()
      await until(async () => (await countOf(a.id)) === LIMIT - 1, 30_000, 'counter 49')
      await until(async () => /^49 \/ 50 contenuti$/.test((await quota(page).innerText().catch(() => '')).replace(/\s+/g, ' ')), 30_000, 'owner sees 49 / 50')
      const gAgain = await guestUpload(guestCtx, a.slug)
      await until(async () => (await countOf(a.id)) === LIMIT, 40_000, 'new upload accepted after the delete'); await gAgain.close()
    } finally { await ctx.close(); await guestCtx.close() }
  })
}

if (withActivated) test('Q2. an activated album shows no trial quota', async () => {
  const a = await trialAlbum(); await seedUpdate(`events/${a.id}`, { accessMode: 'activated' }); await seedUpdate(`users/${a.owner.uid}`, { plan: { tier: 'wedding', source: 'legacy' } })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage()
  try {
    await login(page, a.owner.email)
    await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTestId('wd-guest-preview').waitFor({ timeout: 90_000 })
    assert.equal(await page.getByTestId('trial-quota').count(), 0)
  } finally { await ctx.close() }
})
}
