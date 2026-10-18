import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import jsQR from 'jsqr'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

/** MIOLOVE table sign editor + language menu in the real UI (Firebase emulators). */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' }); browser = await launchPortals(app) })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const M = () => portalUrl(app, 'miolovealbum.com'), I = () => portalUrl(app, 'iomixo.com')
const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 30_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)

async function album(occasion: string, opts: { date?: string | null; accessMode?: 'trial' | 'activated'; title?: string } = {}) {
  const owner = await newClient('account'), stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`, id = `pst${stamp}`, slug = `pslug${stamp}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, displayName: 'Enrico Rossi', accountType: 'couple', plan: { tier: opts.accessMode === 'activated' ? 'wedding' : 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${id}`, eventFields(owner.uid, slug, { type: 'wedding', title: opts.title ?? 'Album di prova', legacySupabaseId: undefined, occasionType: occasion, accessMode: opts.accessMode ?? 'trial', weddingDate: opts.date === undefined ? '2027-06-12' : opts.date, guestConfig: { requests: false, live_booth: true } }))
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
async function openPoster(page: Page, a: { owner: { email: string }; id: string }) {
  await login(page, a.owner.email)
  await page.goto(`${M()}/sessions/${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await goTab(page, /Poster|Cartel|Affiche/); await page.getByTestId('poster-editor').waitFor({ timeout: 60_000 })
  await drawn(page)
}
const seq = (p: Page) => p.evaluate(() => Number((document.querySelector('[data-testid="poster-canvas"]') as HTMLCanvasElement | null)?.dataset.drawn ?? 0))
/** Waits for the preview canvas to be (re)drawn after the last change. */
async function drawn(page: Page, after = 0) { await until(async () => (await seq(page)) > after, 30_000, 'preview drawn'); await page.waitForTimeout(150) }
const poster = (p: Page) => p.evaluate(() => { const e = document.querySelector('[data-testid="poster-preview"]') as HTMLElement; return { cfg: JSON.parse(e.dataset.poster!), qr: e.dataset.qrValue!, format: e.dataset.format! } })
const px = (p: Page, x: number, y: number) => p.evaluate(([x, y]) => { const c = document.querySelector('[data-testid="poster-canvas"]') as HTMLCanvasElement; const d = c.getContext('2d')!.getImageData(x, y, 1, 1).data; return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase() }, [x, y] as const)
const ratio = (p: Page) => p.evaluate(() => { const r = document.querySelector('[data-testid="poster-canvas"]')!.getBoundingClientRect(); return r.width / r.height })
const edit = async (page: Page, id: string, value: string) => { const before = await seq(page); await page.getByTestId(id).fill(value); await drawn(page, before) }

const DEFAULTS: Record<string, { t2: string; t3: string }> = { wedding: { t2: "l'", t3: 'amore' }, birthday: { t2: 'la', t3: 'festa' }, baptism: { t2: 'questo', t3: 'momento' }, other: { t2: 'questo', t3: 'momento' } }
for (const [occasion, vp] of [['wedding', 390], ['wedding', 1280], ['birthday', 1280], ['baptism', 1280], ['other', 1280]] as const) {
  test(`PO1. poster defaults @${vp} (${occasion}, trial album): occasion copy, event name + date, A4, QR = guest URL, no overflow`, async () => {
    const a = await album(occasion, { title: 'Festa di Enrico' }), ctx = await browser.newContext({ viewport: { width: vp, height: vp === 390 ? 844 : 900 } }), page = await ctx.newPage()
    try {
      await openPoster(page, a)
      const s = await poster(page)
      assert.deepEqual([s.cfg.title1, s.cfg.title2, s.cfg.title3, s.cfg.instruction1, s.cfg.instruction2], ['CONDIVIDI', DEFAULTS[occasion].t2, DEFAULTS[occasion].t3, 'CONDIVIDI LE TUE FOTO!', 'SCANSIONA IL QR CODE E CARICA'])
      assert.deepEqual([s.cfg.displayName, s.cfg.displayDate, s.format, s.cfg.primaryColor, s.cfg.backgroundColor], ['Festa di Enrico', '12 giugno 2027', 'A4', '#F06A9B', '#FFF7FA'])
      assert.equal(s.qr, `https://miolovealbum.com/live/${a.slug}`, 'the QR value is the MIOLOVE guest URL')
      assert.ok(Math.abs((await ratio(page)) - 210 / 297) < 0.01, 'A4 proportions')
      assert.equal(await px(page, 8, 8), '#FFF7FA', 'sheet colour')
      if (occasion !== 'wedding') assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /\bamore\b|sposi|matrimon|nozze/i)
      assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /Advance|Event Pass|IOMIXO/i, 'no paywall on a trial album')
      assert.equal(await page.getByTestId('poster-qr-note').count(), 1); assert.equal(await page.locator('input[value^="https://"]').count(), 0, 'the link is not editable')
      assert.equal(await overflow(page), false, 'overflow')
      // preview is large enough to judge on a phone
      assert.ok((await page.getByTestId('poster-canvas').boundingBox())!.width >= 300, 'preview width')
      assert.ok(await page.getByTestId('poster-download').isVisible(), 'download reachable')
      await page.screenshot({ path: `/tmp/poster-${occasion}-${vp}.png`, fullPage: true }).catch(() => {})
    } finally { await ctx.close() }
  })
}

test('PO2. no date: the row is empty (never "null"); the date follows the language until edited', async () => {
  const a = await album('wedding', { date: null }), ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await ctx.newPage()
  try {
    await openPoster(page, a)
    assert.equal((await poster(page)).cfg.displayDate, ''); assert.equal(await page.getByTestId('poster-displayDate').inputValue(), '')
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText + JSON.stringify(document.querySelector('[data-testid="poster-preview"]')!.getAttribute('data-poster'))), /null|undefined|Invalid/i)
  } finally { await ctx.close() }
})

test('PO3. customise (texts, preset + custom colours, fonts, A5), live preview, save, reload, then reset', async () => {
  const a = await album('wedding'), ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  try {
    await openPoster(page, a)
    assert.equal(await page.getByTestId('poster-save').isDisabled(), true, 'nothing to save yet')
    await edit(page, 'poster-title1', 'GRAZIE'); await edit(page, 'poster-title3', 'a tutti'); await edit(page, 'poster-instruction2', 'INQUADRA E CARICA'); await edit(page, 'poster-displayName', 'Anna & Marco')
    let before = await seq(page); await page.getByTestId('poster-preset-sage').click(); await drawn(page, before)
    assert.equal(await px(page, 8, 8), '#F6F3EA'); assert.equal((await poster(page)).cfg.primaryColor, '#6B8F71')
    before = await seq(page); await page.getByTestId('poster-primary').fill('#112233'); await drawn(page, before); assert.equal((await poster(page)).cfg.primaryColor, '#112233')
    before = await seq(page); await page.getByTestId('poster-background').fill('#abcdef'); await drawn(page, before); assert.equal(await px(page, 8, 8), '#ABCDEF')
    before = await seq(page); await page.getByTestId('poster-titleFont').selectOption('cinzel'); await drawn(page, before)
    before = await seq(page); await page.getByTestId('poster-scriptFont').selectOption('dancing'); await drawn(page, before)
    before = await seq(page); await page.getByTestId('poster-bodyFont').selectOption('cormorant'); await drawn(page, before)
    before = await seq(page); await page.getByRole('button', { name: 'Grande', exact: true }).click(); await drawn(page, before)
    before = await seq(page); await page.getByRole('button', { name: 'A5', exact: true }).click(); await drawn(page, before)
    assert.ok(Math.abs((await ratio(page)) - 148 / 210) < 0.01, 'A5 proportions')
    const s = await poster(page)
    assert.deepEqual([s.cfg.title1, s.cfg.title3, s.cfg.titleFont, s.cfg.scriptFont, s.cfg.bodyFont, s.cfg.titleSize, s.format, s.cfg.displayName], ['GRAZIE', 'a tutti', 'cinzel', 'dancing', 'cormorant', 'l', 'A5', 'Anna & Marco'])
    assert.equal(await page.getByTestId('poster-dirty').count(), 1)

    await page.getByTestId('poster-save').click(); await page.getByText('Poster salvato').first().waitFor({ timeout: 30_000 })
    const f = (await until(async () => (await fsGet(`events/${a.id}`)).fields.posterConfig?.mapValue?.fields, 20_000, 'posterConfig saved'))
    assert.deepEqual([f.title1.stringValue, f.format.stringValue, f.primaryColor.stringValue, f.backgroundColor.stringValue, f.titleFont.stringValue, f.titleSize.stringValue, f.displayName.stringValue], ['GRAZIE', 'A5', '#112233', '#ABCDEF', 'cinzel', 'l', 'Anna & Marco'])
    assert.equal(f.title2, undefined, 'untouched fields are not stored')

    await page.reload({ waitUntil: 'domcontentloaded' }); await goTab(page, /Poster/); await page.getByTestId('poster-editor').waitFor({ timeout: 60_000 }); await drawn(page)
    const r = await poster(page)
    assert.deepEqual([r.cfg.title1, r.cfg.primaryColor, r.format, r.cfg.titleFont, r.cfg.displayName, r.cfg.title2], ['GRAZIE', '#112233', 'A5', 'cinzel', 'Anna & Marco', "l'"])
    assert.equal(await px(page, 8, 8), '#ABCDEF'); assert.equal(await page.getByTestId('poster-dirty').count(), 0)

    await page.getByTestId('poster-reset').click(); await page.getByText('Poster salvato').first().waitFor({ timeout: 30_000 })
    await until(async () => { const g = (await fsGet(`events/${a.id}`)).fields.posterConfig?.mapValue?.fields ?? {}; return Object.keys(g).join() === 'format' }, 20_000, 'reset stored')
    const d = await poster(page)
    assert.deepEqual([d.cfg.title1, d.cfg.title3, d.cfg.primaryColor, d.cfg.backgroundColor, d.cfg.titleFont, d.cfg.displayName, d.cfg.instruction2], ['CONDIVIDI', 'amore', '#F06A9B', '#FFF7FA', 'playfair', 'Album di prova', 'SCANSIONA IL QR CODE E CARICA'])
  } finally { await ctx.close() }
})

for (const vp of [390, 1280]) {
  test(`PO4. language menu @${vp}: flags + names, switches the UI at once, persists on refresh, edited poster text is never overwritten`, async () => {
    const a = await album('wedding'), ctx = await browser.newContext({ viewport: { width: vp, height: 844 } }), page = await ctx.newPage()
    try {
      await openPoster(page, a)
      const trigger = page.getByTestId('miolove-lang-trigger')
      assert.match((await trigger.innerText()).replace(/\s+/g, ' ').trim(), vp === 390 ? /^🇮🇹 IT$/ : /^🇮🇹 Italiano$/)
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
      await trigger.click()
      const opts = await page.locator('[role="option"]').allInnerTexts(); assert.deepEqual(opts.map((o) => o.replace(/\s+/g, ' ').trim()), ['🇮🇹 Italiano', '🇬🇧 English', '🇫🇷 Français', '🇪🇸 Español'])
      const menu = (await page.locator('[role="listbox"]').boundingBox())!, vw = vp
      assert.ok(menu.x >= 0 && menu.x + menu.width <= vw && menu.y >= 0, 'menu is not clipped')
      assert.equal(await page.locator('[role="option"][aria-selected="true"]').count(), 1)
      await page.keyboard.press('Escape'); assert.equal(await page.locator('[role="listbox"]').count(), 0, 'Escape closes')
      await edit(page, 'poster-title1', 'GRAZIE')

      const pick = async (code: string) => { await trigger.click(); await page.locator(`[role="option"][data-lang="${code}"]`).click() }
      await pick('en'); await until(async () => (await poster(page)).cfg.title3 === 'love', 20_000, 'English defaults')
      let s = (await poster(page)).cfg; assert.deepEqual([s.title1, s.title3, s.instruction1, s.displayDate], ['GRAZIE', 'love', 'SHARE YOUR PHOTOS!', '12 June 2027'])
      assert.match(await page.evaluate(() => document.body.innerText), /Table QR sign/)
      assert.match((await trigger.innerText()).replace(/\s+/g, ' '), vp === 390 ? /🇬🇧 EN$/ : /🇬🇧 English$/)
      await pick('fr'); await until(async () => (await poster(page)).cfg.title3 === 'amour', 20_000, 'French defaults')
      assert.match(await page.evaluate(() => document.body.innerText), /Cartonnet QR de table/); assert.equal((await poster(page)).cfg.title1, 'GRAZIE')
      await pick('es'); await until(async () => (await poster(page)).cfg.title3 === 'amor', 20_000, 'Spanish defaults')
      assert.match(await page.evaluate(() => document.body.innerText), /Cartel QR de mesa/)
      assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /Impostazioni|Foto degli|Tutti gli eventi/, 'the whole album shell is Spanish, not Italian')

      await page.reload({ waitUntil: 'domcontentloaded' }); await goTab(page, /Cartel/); await page.getByTestId('poster-editor').waitFor({ timeout: 60_000 }); await drawn(page)
      assert.equal((await poster(page)).cfg.title3, 'amor', 'language survives a refresh'); assert.match(await page.evaluate(() => document.body.innerText), /Cartel QR de mesa/)
      assert.equal(await overflow(page), false, 'overflow')
      await pick('it'); await until(async () => (await poster(page)).cfg.title3 === 'amore', 20_000, 'Italian again')
    } finally { await ctx.close() }
  })
}

const readPdf = (path: string) => {
  const buf = readFileSync(path), txt = buf.toString('latin1')
  const im = txt.indexOf('/Subtype /Image'), len = /\/Length (\d+) >>\nstream\n/.exec(txt.slice(im))!, from = im + len.index + len[0].length
  const w = +/\/Width (\d+)/.exec(txt.slice(im))![1], h = +/\/Height (\d+)/.exec(txt.slice(im))![1]
  const rgb = inflateSync(buf.subarray(from, from + +len[1])), rgba = new Uint8ClampedArray(w * h * 4)
  for (let i = 0, j = 0; i < w * h; i++, j += 4) { rgba[j] = rgb[i * 3]; rgba[j + 1] = rgb[i * 3 + 1]; rgba[j + 2] = rgb[i * 3 + 2]; rgba[j + 3] = 255 }
  return { size: buf.length, txt, w, h, rgba, pages: (txt.match(/\/Type \/Page\b(?!s)/g) ?? []).length, box: /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(txt)!.slice(1).map(Number) }
}
for (const [fmt, ptW, ptH, pxW, pxH] of [['A4', 595.28, 841.89, 2480, 3508], ['A5', 419.53, 595.28, 1748, 2480]] as const) {
  test(`PO5. PDF ${fmt}: real download, one page of the right size, sharp 300 dpi image, text layer, no editor UI, QR decodes to the guest URL`, async () => {
    const a = await album('wedding'), ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }), page = await ctx.newPage()
    try {
      await openPoster(page, a)
      if (fmt === 'A5') { const before = await seq(page); await page.getByRole('button', { name: 'A5', exact: true }).click(); await drawn(page, before) }
      await edit(page, 'poster-displayName', 'Anna & Marco')
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByTestId('poster-download').click()])
      assert.equal(dl.suggestedFilename(), `miolove-cartello-qr-${a.slug}.pdf`)
      const pdf = readPdf((await dl.path())!)
      assert.ok(pdf.size > 5_000, 'not empty'); assert.equal(pdf.txt.slice(0, 5), '%PDF-'); assert.equal(pdf.pages, 1)
      assert.ok(Math.abs(pdf.box[0] - ptW) < 0.02 && Math.abs(pdf.box[1] - ptH) < 0.02, `MediaBox ${pdf.box}`)
      assert.ok(Math.abs(pdf.w - pxW) <= 1 && Math.abs(pdf.h - pxH) <= 1, `300 dpi pixels ${pdf.w}x${pdf.h}`)
      for (const t of ['CONDIVIDI', 'amore', 'CONDIVIDI LE TUE FOTO!', 'SCANSIONA IL QR CODE E CARICA', 'Anna & Marco', '12 giugno 2027']) assert.ok(pdf.txt.includes(t.replace(/[()\\]/g, '\\$&')), `text layer: ${t}`)
      const code = jsQR(pdf.rgba, pdf.w, pdf.h)
      assert.equal(code?.data, `https://miolovealbum.com/live/${a.slug}`, 'the QR printed in the PDF decodes to the guest URL')
      // sheet colour at the corner, i.e. only the poster is in the page (no controls)
      assert.deepEqual(Array.from(pdf.rgba.subarray(4 * (8 * pdf.w + 8), 4 * (8 * pdf.w + 8) + 3)), [0xFF, 0xF7, 0xFA])
    } finally { await ctx.close() }
  })
}

test('PO6. IOMIXO has no poster / photo sections: a DJ wedding event offers none of them, and keeps the plain language selector', async () => {
  const dj = await newClient('account'), id = `psd${Date.now()}`, slug = `psds${Date.now()}`
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, email: dj.email, plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${id}`, eventFields(dj.uid, slug, { type: 'wedding', title: 'Matrimonio DJ', legacySupabaseId: undefined, guestConfig: { requests: true } })); await seedSet(`eventSlugs/${slug}`, { eventId: id })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await ctx.newPage()
  try {
    await page.goto(`${I()}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
    for (let attempt = 0; attempt < 8 && /\/login$/.test(page.url()); attempt++) {
      await page.locator('input[type="email"]').fill(dj.email); await page.locator('input[type="password"]').fill('password123')
      await page.locator('button[type="submit"]').click(); await page.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 15_000 }).catch(() => {})
    }
    await page.goto(`${I()}/sessions/${id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.locator('button[aria-label="Menu"]:visible, nav[aria-label="Wedding"]:visible').first().waitFor({ timeout: 90_000 })
    const menu = page.getByRole('button', { name: 'Menu', exact: true }); if (await menu.isVisible().catch(() => false)) await menu.click()
    const nav = page.locator('nav[aria-label="Wedding"]:visible')
    await nav.getByRole('button', { name: /Giochi/ }).first().waitFor({ timeout: 30_000 })
    for (const gone of [/Poster/, /^Foto/, /Live Booth/]) assert.equal(await nav.getByRole('button', { name: gone }).count(), 0, `no ${gone} section for a DJ`)
    assert.equal(await page.getByTestId('poster-editor').count(), 0)
    // IOMIXO language UI is the original one: the plain selector, no MIOLOVE flag menu
    assert.equal(await page.locator('select[aria-label="Language"]').count(), 1); assert.equal(await page.getByTestId('miolove-lang').count(), 0)
    assert.deepEqual(await page.locator('select[aria-label="Language"] option').allInnerTexts(), ['IT', 'EN', 'ES', 'FR'])
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /🇮🇹|🇬🇧|🇫🇷|🇪🇸/)
  } finally { await ctx.close() }
})

// ── Privacy / Terms in the four languages, on both portals ───────────────────────────────────────────
const LEGAL = {
  it: { privacy: 'Informativa sulla privacy', terms: 'Termini di servizio', updated: /Ultimo aggiornamento: 16 ottobre 2026/, privacyBody: /Dati che raccogliamo/, termsBody: /tribunali italiani/ },
  en: { privacy: 'Privacy Policy', terms: 'Terms of Service', updated: /Last updated: October 16, 2026/, privacyBody: /Data we collect/, termsBody: /courts of Italy/ },
  es: { privacy: 'Política de privacidad', terms: 'Condiciones del servicio', updated: /Última actualización: 16 de octubre de 2026/, privacyBody: /Datos que recopilamos/, termsBody: /tribunales de Italia/ },
  fr: { privacy: 'Politique de confidentialité', terms: "Conditions d'utilisation", updated: /Dernière mise à jour: 16 octobre 2026/, privacyBody: /Données que nous collectons/, termsBody: /tribunaux italiens/ },
} as const
for (const [portal, vp] of [['miolove', 1280], ['miolove', 390], ['iomixo', 1280]] as const) {
  test(`LGL1. /privacy and /terms @${vp} on ${portal === 'miolove' ? 'miolovealbum.com' : 'iomixo.com'}: IT / EN / ES / FR, persisted, branded for the portal, right language switcher`, async () => {
    const base = portal === 'miolove' ? M() : I(), brand = portal === 'miolove' ? 'MIOLOVE ALBUM' : 'IOMIXO'
    const ctx = await browser.newContext({ viewport: { width: vp, height: 900 }, locale: 'en-US' }), page = await ctx.newPage()
    const pick = async (code: 'it' | 'en' | 'es' | 'fr') => {
      if (portal === 'miolove') { await page.getByTestId('miolove-lang-trigger').click(); await page.locator(`[role="option"][data-lang="${code}"]`).click() }
      else await page.getByRole('button', { name: code.toUpperCase(), exact: true }).click()
    }
    try {
      for (const kind of ['privacy', 'terms'] as const) {
        await page.goto(`${base}/${kind}`, { waitUntil: 'networkidle', timeout: 120_000 })
        await page.locator('h1').waitFor({ timeout: 60_000 })
        assert.equal(await page.locator('h1').innerText(), LEGAL.en[kind], 'English for an English browser, before any choice')
        if (portal === 'miolove') assert.equal(await page.getByTestId('miolove-lang').count(), 1); else { assert.equal(await page.getByTestId('miolove-lang').count(), 0); assert.equal(await page.getByRole('button', { name: 'IT', exact: true }).count(), 1) }
        for (const code of ['it', 'es', 'fr', 'en'] as const) {
          await pick(code)
          await until(async () => (await page.locator('h1').innerText()) === LEGAL[code][kind], 20_000, `${kind} ${code}`)
          const text = await page.evaluate(() => document.body.innerText)
          assert.match(text, LEGAL[code].updated); assert.match(text, LEGAL[code][kind === 'privacy' ? 'privacyBody' : 'termsBody'])
          assert.match(text, new RegExp(brand)); assert.doesNotMatch(text, portal === 'miolove' ? /IOMIXO/ : /MIOLOVE/, 'no foreign brand')
          assert.ok(await page.locator(`a[href="mailto:${kind === 'privacy' ? 'privacy' : 'legal'}@iomixo.com"]`).count() >= 1, 'shared legal address kept')
          assert.equal(await page.locator('a[href="/' + (kind === 'privacy' ? 'terms' : 'privacy') + '"]').first().innerText(), LEGAL[code][kind === 'privacy' ? 'terms' : 'privacy'])
          assert.equal(await overflow(page), false, `${kind} ${code} overflow`)
        }
        await pick('fr'); await until(async () => (await page.locator('h1').innerText()) === LEGAL.fr[kind], 20_000, 'fr')
        await page.reload({ waitUntil: 'networkidle' }); await until(async () => (await page.locator('h1').innerText()) === LEGAL.fr[kind], 30_000, `${kind}: French survives a refresh`)
        await page.screenshot({ path: `/tmp/review/legal-${portal}-${kind}-${vp}.png`, fullPage: false }).catch(() => {})
        await pick('en')
      }
      // the terms link in the body goes to the privacy policy of the same portal
      await page.goto(`${base}/terms`, { waitUntil: 'networkidle' }); assert.ok(await page.locator('article a[href="/privacy"]').count() >= 1, 'privacy link inside the terms')
    } finally { await ctx.close() }
  })
}
