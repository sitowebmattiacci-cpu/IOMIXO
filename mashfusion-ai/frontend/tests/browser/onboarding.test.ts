import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'
import { newClient } from '../firebase/helpers'
import { seedSet, eventFields } from '../firebase/seed'

/** MIOLOVE onboarding (Firebase emulators): the first screen of a Sposi account with no album, and what it saves. */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_FIRESTORE_DASHBOARD: 'true', NEXT_PUBLIC_MIOLOVE_LIVE: 'true' }); browser = await launchPortals(app) })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const M = () => portalUrl(app, 'miolovealbum.com'), I = () => portalUrl(app, 'iomixo.com')
const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
const ownerEvents = async (uid: string) => (((await fsGet('events?pageSize=1000')).documents ?? []) as any[]).filter((d) => d.fields.ownerUid?.stringValue === uid)
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 20_000, label = 'condition'): Promise<T> {
  const t0 = Date.now()
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`); await new Promise((r) => setTimeout(r, 400)) }
}
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
const WEDDING_COPY = /\bsposi\b|\bsposo\b|\bsposa\b|matrimon|nozze|giorno speciale|grande giorno/i

async function couple(tier: 'free' | 'wedding' = 'wedding', displayName: string | null = 'Enrico Rossi') {
  const c = await newClient('account')
  await seedSet(`users/${c.uid}`, { uid: c.uid, email: c.email, ...(displayName ? { displayName } : {}), accountType: 'couple', plan: { tier, source: 'legacy' }, ...(tier === 'wedding' ? { miolovePlan: { tier, source: 'stripe' } } : {}), createdAt: new Date(), updatedAt: new Date() })
  return c
}
async function signIn(page: Page, base: string, email: string) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1200)
  await page.locator('input[type="email"]').fill(email); await page.locator('input[type="password"]').fill('password123'); await page.locator('button[type="submit"]').click()
}
const openOnboarding = async (page: Page, email: string) => {
  await page.goto(`${M()}/login`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1500)
  // the very first load of a cold dev server can swallow the first submit: retry until the app leaves /login
  for (let attempt = 0; attempt < 8 && /\/login$/.test(page.url()); attempt++) {
    await page.locator('input[type="email"]').fill(email); await page.locator('input[type="password"]').fill('password123')
    await page.locator('button[type="submit"]').click(); await page.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 15_000 }).catch(() => {})
  }
  await page.waitForURL(/\/onboarding$/, { timeout: 90_000 }); await page.getByTestId('couple-onboarding').waitFor({ timeout: 60_000 })
}

for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`O1. new Sposi account @${vp.width}: lands on the onboarding (MIOLOVE only, no role choice), names follow the occasion, nothing is saved before the button`, async () => {
    const c = await couple()
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    try {
      await openOnboarding(page, c.email)
      const text = await page.evaluate(() => document.body.innerText)
      assert.match(text, /Raccontaci del tuo evento/); assert.match(text, /Benvenuto, Enrico/)
      assert.doesNotMatch(text, /IOMIXO|Live Hub|\bDJ\b|\bParty\b|Come vuoi usare la piattaforma/i)
      for (const gone of ['account-type-choice', 'account-type-dj', 'account-type-couple']) assert.equal(await page.getByTestId(gone).count(), 0, gone)
      assert.ok(await page.locator('[role="img"][aria-label="MIOLOVE ALBUM"]:visible').first().isVisible()); assert.equal(await page.locator('img[alt="IOMIXO Logo"]').count(), 0)
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="couple-onboarding"]')!).backgroundColor), 'rgb(255, 247, 250)')
      assert.equal(await overflow(page), false, 'overflow')
      await page.screenshot({ path: `/tmp/onboarding-${vp.width}.png`, fullPage: true }).catch(() => {})
      // only the four languages that exist, with flags
      await page.getByTestId('miolove-lang-trigger').click()
      assert.deepEqual((await page.locator('[role="option"]').allInnerTexts()).map((o) => o.replace(/\s+/g, ' ').trim()), ['🇮🇹 Italiano', '🇬🇧 English', '🇫🇷 Français', '🇪🇸 Español'])
      await page.keyboard.press('Escape')
      // card width: 560-650px on desktop
      if (vp.width >= 1000) { const w = (await page.locator('form').boundingBox())!.width; assert.ok(w >= 560 && w <= 650, `card ${w}px`) }

      // the four occasions, wedding selected by default; names follow the choice while the field is untouched
      assert.deepEqual(await page.locator('[role="radio"]').allInnerTexts(), ['💍\nMatrimonio', '🎉\nCompleanno', '🕊️\nBattesimo', '✨\nAltro'])
      assert.equal(await page.getByTestId('occasion-wedding').getAttribute('aria-checked'), 'true')
      const name = page.getByTestId('onboarding-name')
      assert.equal(await name.inputValue(), 'Matrimonio di Enrico')
      await page.getByTestId('occasion-birthday').click(); assert.equal(await name.inputValue(), 'Compleanno di Enrico')
      await page.getByTestId('occasion-baptism').click(); assert.equal(await name.inputValue(), ''); assert.equal(await name.getAttribute('placeholder'), 'Battesimo di [nome]')
      assert.equal(await page.getByTestId('onboarding-create').isDisabled(), true, 'baptism needs the child\'s name')
      await page.getByTestId('occasion-other').click(); assert.equal(await name.inputValue(), 'Il mio evento')
      // selected card: very light pink background, pink border
      await page.waitForTimeout(500)   // colour transition
      const sel = await page.getByTestId('occasion-other').evaluate((el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.borderTopColor] })
      assert.deepEqual(sel, ['rgb(252, 232, 240)', 'rgb(240, 106, 155)'])
      // a name typed by the user is never overwritten
      await name.fill('La festa di Giulia'); await page.getByTestId('occasion-wedding').click(); await page.getByTestId('occasion-birthday').click()
      assert.equal(await name.inputValue(), 'La festa di Giulia')
      // "I don't know the date yet" clears the date and is reversible
      await page.getByTestId('onboarding-date').fill('2027-06-12'); await page.getByTestId('onboarding-date-unknown').click()
      assert.equal(await page.getByTestId('onboarding-date').inputValue(), ''); assert.equal(await page.getByTestId('onboarding-date').isDisabled(), true)
      assert.equal(await page.getByTestId('onboarding-date-unknown').getAttribute('aria-pressed'), 'true')
      await page.getByTestId('onboarding-date-unknown').click(); assert.equal(await page.getByTestId('onboarding-date').isDisabled(), false)
      assert.equal(await overflow(page), false, 'overflow after interaction')
      assert.equal((await ownerEvents(c.uid)).length, 0, 'nothing was written')
      assert.match(await page.getByTestId('onboarding-create').innerText(), /^Crea il mio album$/)
    } finally { await ctx.close() }
  })
}

test('O2. language switcher: IT / EN / ES / FR translate the onboarding', async () => {
  const c = await couple(); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage()
  try {
    await openOnboarding(page, c.email)
    const titles: Record<string, string> = { EN: 'Tell us about your event', ES: 'Cuéntanos sobre tu evento', FR: 'Parlez-nous de votre événement', IT: 'Raccontaci del tuo evento' }
    for (const l of ['EN', 'ES', 'FR', 'IT']) {
      await page.getByTestId('miolove-lang-trigger').click(); await page.locator(`[role="option"][data-lang="${l.toLowerCase()}"]`).click()
      await page.getByText(titles[l], { exact: true }).waitFor({ timeout: 10_000 })
      assert.equal(await overflow(page), false, `${l} overflow`)
    }
  } finally { await ctx.close() }
})

const MATRIX = [
  { name: 'wedding + date + default name', occasion: 'wedding', date: '2027-06-12', custom: null, title: 'Matrimonio di Enrico' },
  { name: 'birthday + unknown date + custom name', occasion: 'birthday', date: null, custom: 'I 40 anni di Enrico', title: 'I 40 anni di Enrico' },
  { name: 'baptism + no date + typed name', occasion: 'baptism', date: null, custom: 'Battesimo di Leo', title: 'Battesimo di Leo' },
  { name: 'other + date + default name', occasion: 'other', date: '2027-09-03', custom: null, title: 'Il mio evento' },
] as const
for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) for (const m of MATRIX) {
  test(`O3. create @${vp.width}: ${m.name} → occasionType ${m.occasion}, type stays wedding, straight into the album Home`, async () => {
    const c = await couple(); const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    try {
      await openOnboarding(page, c.email)
      await page.getByTestId(`occasion-${m.occasion}`).click()
      if (m.custom) await page.getByTestId('onboarding-name').fill(m.custom)
      if (m.date) await page.getByTestId('onboarding-date').fill(m.date); else if (m.name.includes('unknown')) await page.getByTestId('onboarding-date-unknown').click()
      await page.getByTestId('onboarding-create').click()
      await page.waitForURL(/\/sessions\/[^/]+$/, { timeout: 90_000 })
      const eventId = page.url().split('/sessions/')[1]
      const f = (await until(async () => (await fsGet(`events/${eventId}`)).fields, 20_000, 'album'))
      assert.equal(f.type.stringValue, 'wedding', 'the engine type is untouched'); assert.equal(f.occasionType.stringValue, m.occasion)
      assert.equal(f.title.stringValue, m.title); assert.equal(f.ownerUid.stringValue, c.uid)
      assert.equal(f.accessMode.stringValue, 'activated', 'a couple with paid access is never trial')
      if (m.date) assert.equal(f.weddingDate.stringValue, m.date); else assert.ok('nullValue' in f.weddingDate, 'no date = null')
      assert.equal(f.guestConfig.mapValue.fields.requests.booleanValue, false); assert.equal(f.guestConfig.mapValue.fields.live_booth.booleanValue, true)
      // the Home of the new album
      await page.getByTestId('wd-guest-preview').waitFor({ timeout: 60_000 })
      assert.equal((await ownerEvents(c.uid)).length, 1, 'exactly one album')
      await page.screenshot({ path: `/tmp/onboarding-home-${vp.width}-${m.occasion}.png` }).catch(() => {})
      const home = await page.evaluate(() => document.body.innerText)
      assert.doesNotMatch(home, /IOMIXO|\bDJ\b|\bParty\b/i); assert.equal(await overflow(page), false, 'home overflow')
      assert.doesNotMatch(home, /wedding edition/i, 'MIOLOVE never says "Wedding Edition"')
      if (m.occasion === 'wedding') assert.match(home, /grande giorno/i)
      else assert.doesNotMatch(home, WEDDING_COPY, 'no wedding copy on a non-wedding Home')
      // the onboarding never comes back for an account that has an album
      await page.goto(`${M()}/onboarding`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForURL(/\/sessions$/, { timeout: 60_000 })
    } finally { await ctx.close() }
  })
}

test('O4. an account that already has an album never sees the onboarding (login, /sessions, /onboarding)', async () => {
  const c = await couple(); const slug = `ob${Date.now()}`
  await seedSet(`events/${slug}`, eventFields(c.uid, slug, { type: 'wedding', title: 'Album esistente', legacySupabaseId: undefined })); await seedSet(`eventSlugs/${slug}`, { eventId: slug })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage()
  try {
    await signIn(page, M(), c.email); await page.waitForURL(/\/sessions$/, { timeout: 90_000 })
    await page.getByText('Album esistente').first().waitFor({ timeout: 60_000 })
    assert.equal(await page.getByTestId('couple-onboarding').count(), 0)
    await page.goto(`${M()}/onboarding`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForURL(/\/sessions$/, { timeout: 60_000 })
    assert.equal(await page.getByTestId('couple-onboarding').count(), 0); assert.equal(await overflow(page), false)
  } finally { await ctx.close() }
})

test('O5. leaving the onboarding creates nothing', async () => {
  const free = await couple('free'); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage()
  try {
    await openOnboarding(page, free.email)
    await page.getByTestId('occasion-birthday').click(); await page.getByTestId('onboarding-name').fill('Mezza compilazione')
    assert.equal((await ownerEvents(free.uid)).length, 0, 'nothing is saved before the button')
    await page.goto(`${M()}/billing`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    assert.equal((await ownerEvents(free.uid)).length, 0, 'leaving the screen creates nothing')
  } finally { await ctx.close() }
})

for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`O7. Free couple @${vp.width}: the first album is created as TRIAL (no Advance paywall); a second one is refused with the MIOLOVE message`, async () => {
    const c = await couple('free'); const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    try {
      await openOnboarding(page, c.email)
      assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /Advance|Event Pass|IOMIXO|\bDJ\b|\bParty\b/i)
      await page.getByTestId('occasion-birthday').click(); await page.getByTestId('onboarding-name').fill('Compleanno trial')
      await page.getByTestId('onboarding-create').click()
      await page.waitForURL(/\/sessions\/[^/]+$/, { timeout: 90_000 })
      const eventId = page.url().split('/sessions/')[1]
      const f = await until(async () => (await fsGet(`events/${eventId}`)).fields, 20_000, 'album')
      assert.deepEqual([f.type.stringValue, f.occasionType.stringValue, f.accessMode.stringValue, f.ownerUid.stringValue], ['wedding', 'birthday', 'trial', c.uid])
      assert.ok('nullValue' in f.weddingDate, 'the date is optional')
      assert.equal((await fsGet(`trialAlbums/${c.uid}`)).fields.eventId.stringValue, eventId, 'reservation written')
      await page.getByTestId('wd-guest-preview').waitFor({ timeout: 60_000 })
      const home = await page.evaluate(() => document.body.innerText)
      assert.doesNotMatch(home, /Advance|Event Pass|IOMIXO|\bDJ\b|\bParty\b/i); assert.equal(await overflow(page), false, 'home overflow')
      await page.screenshot({ path: `/tmp/trial-home-${vp.width}.png` }).catch(() => {})
      // the onboarding is closed for good, and a second album from /sessions is refused with a MIOLOVE message (not an Advance paywall)
      await page.goto(`${M()}/onboarding`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForURL(/\/sessions$/, { timeout: 60_000 })
      await page.getByTestId('new-session').click(); await page.locator('form input').first().fill('Secondo album')
      await page.locator('form button[type="submit"]').click()
      await page.getByText(/Hai già creato il tuo album gratuito/).first().waitFor({ timeout: 60_000 })
      assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /Advance|Event Pass|IOMIXO|Bloccata/i, 'the trial album is listed unlocked')
      assert.equal((await ownerEvents(c.uid)).length, 1, 'still exactly one album')
    } finally { await ctx.close() }
  })
}

test('O6. IOMIXO is untouched: a DJ never gets the onboarding, iomixo.com has no such screen', async () => {
  const dj = await newClient('account')
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, email: dj.email, accountType: 'dj', plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage()
  try {
    await signIn(page, I(), dj.email); await page.waitForURL(/\/dashboard/, { timeout: 90_000 })
    await page.getByText('Profilo DJ').first().waitFor({ timeout: 60_000 })
    await page.goto(`${I()}/onboarding`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForURL(/\/dashboard/, { timeout: 60_000 })
    assert.equal(await page.getByTestId('couple-onboarding').count(), 0)
    await page.goto(`${I()}/sessions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText('Sessioni Live').first().waitFor({ timeout: 60_000 })         // an empty DJ list is NOT redirected anywhere
    assert.match(page.url(), /\/sessions$/)
  } finally { await ctx.close() }
})
