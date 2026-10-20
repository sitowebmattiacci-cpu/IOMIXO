import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Browser, Page } from 'playwright-core'
import { startFakeRender, startNext, launchPortals, portalUrl, type FakeRender, type App } from './harness'

/** MIOLOVE /login and /register follow the selected language (IT/EN/FR/ES) live and after a refresh, at 390px and 1280px. */
let render: FakeRender, app: App, browser: Browser
before(async () => { render = await startFakeRender(); app = await startNext(render, { NEXT_PUBLIC_MIOLOVE_LIVE: 'true' }); browser = await launchPortals(app) })
after(async () => { await browser?.close(); await app?.stop(); await render?.close() })

const M = () => portalUrl(app, 'miolovealbum.com')
type L = 'it' | 'en' | 'fr' | 'es'
const LOGIN: Record<L, string[]> = {
  it: ['Bentornato', 'Accedi', 'Password dimenticata?', 'Crea un account gratuito'],
  en: ['Welcome back', 'Sign in', 'Forgot password?', 'Create a free account'],
  fr: ['Bon retour', 'Se connecter', 'Mot de passe oublié ?', 'Créer un compte gratuit'],
  es: ['Bienvenido de nuevo', 'Iniciar sesión', '¿Olvidaste tu contraseña?', 'Crear una cuenta gratuita'],
}
const REGISTER: Record<L, string[]> = {
  it: ['Crea il tuo account', '7 giorni di prova gratis', 'Nome completo', 'Crea account', 'Accedi'],
  en: ['Create your account', '7-day free trial', 'Full name', 'Create account', 'Sign in'],
  fr: ['Créer votre compte', '7 jours d’essai gratuit', 'Nom complet', 'Créer un compte', 'Se connecter'],
  es: ['Crea tu cuenta', '7 días de prueba gratis', 'Nombre completo', 'Crear cuenta', 'Iniciar sesión'],
}
const ENGLISH = /Welcome back|Sign in|Forgot password|Create a free account|Create your account|Create account|Full name|Free forever|7-day free trial|Signing in|Creating…|Min\. 8 characters|Check your inbox/
const NAMES: Record<L, string> = { it: 'Italiano', en: 'English', fr: 'Français', es: 'Español' }
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
const body = (p: Page) => p.evaluate(() => document.body.innerText)
async function pick(page: Page, l: L) {
  const opt = page.locator(`[data-lang="${l}"]`)
  for (let i = 0; i < 10 && !(await opt.isVisible().catch(() => false)); i++) { await page.getByTestId('miolove-lang-trigger').click(); await page.waitForTimeout(400) }   // first click can land before hydration
  await opt.click()
}

for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  for (const [route, expected] of [['login', LOGIN], ['register', REGISTER]] as const) {
    test(`AI18N. MIOLOVE /${route} @${vp.width}: IT/EN/FR/ES live switch, no English leaks, persists after refresh`, async () => {
      const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
      try {
        await page.goto(`${M()}/${route}`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(1000)
        for (const l of ['fr', 'es', 'it', 'en'] as L[]) {
          await pick(page, l)                                         // live: no reload between the click and the assertions
          const text = await body(page)
          for (const s of expected[l]) assert.ok(text.includes(s), `${route} ${l} @${vp.width}: missing "${s}"`)
          if (l !== 'en') assert.doesNotMatch(text, ENGLISH, `${route} ${l} @${vp.width}: English leaked`)
          assert.equal(await overflow(page), false, `${route} ${l} @${vp.width}: overflow`)
        }
        for (const l of ['fr', 'es', 'it'] as L[]) {                  // persistence
          await pick(page, l); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800)
          const text = await body(page)
          for (const s of expected[l]) assert.ok(text.includes(s), `${route} ${l} after refresh @${vp.width}: missing "${s}"`)
          assert.doesNotMatch(text, ENGLISH, `${route} ${l} after refresh: English leaked`)
        }
      } finally { await ctx.close() }
    })
  }
}

// ── Remaining auth routes (forgot / reset / verify) ──
const OTHER: Record<string, Record<L, string[]>> = {
  'forgot-password': {
    it: ['Hai dimenticato la password?', 'Invia link', 'Torna all'], en: ['Forgot your password?', 'Send reset link', 'Back to sign in'],
    fr: ['Mot de passe oublié', 'Envoyer', 'Retour à la connexion'], es: ['¿Olvidaste tu contraseña?', 'Enviar', 'Volver al acceso'],
  },
  'reset-password': {
    it: ['Aggiorna password', 'Conferma password'], en: ['Update password', 'Confirm password'],
    fr: ['Mettre à jour le mot de passe', 'Confirmer'], es: ['Actualizar contraseña', 'Confirmar'],
  },
  'verify-email': {
    it: ['Controlla la tua casella', 'Il link scade tra 24 ore'], en: ['Check your inbox', 'Link expires in 24 hours'],
    fr: ['Vérifiez votre boîte mail', 'Le lien expire dans 24 heures'], es: ['Revisa tu bandeja de entrada', 'El enlace expira en 24 horas'],
  },
}
const ENGLISH2 = /Forgot your password|Send reset link|Back to sign in|Update password|Confirm password|Check your inbox|Link expires|Set new password|Choose a strong|Repeat your password|Min\. 8 characters|Email address|We've sent/
const setLocale = (page: Page, l: L) => page.evaluate((x) => localStorage.setItem('iomixo.locale', x), l)

for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  for (const [route, expected] of Object.entries(OTHER)) {
    test(`AI18N2. /${route} @${vp.width}: IT/EN/FR/ES, no English leaks, persists after refresh`, async () => {
      const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
      try {
        await page.goto(`${M()}/${route}?oobCode=bogus`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(800)
        for (const l of ['fr', 'es', 'it', 'en'] as L[]) {
          await pick(page, l)
          const text = await body(page)
          for (const s of expected[l]) assert.ok(text.includes(s), `${route} ${l} @${vp.width}: missing "${s}"`)
          if (l !== 'en') assert.doesNotMatch(text, ENGLISH2, `${route} ${l}: English leaked`)
          assert.equal(await overflow(page), false, `${route} ${l}: overflow`)
        }
        await pick(page, 'fr'); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800)
        const text = await body(page)
        for (const s of expected.fr) assert.ok(text.includes(s), `${route} fr after refresh: missing "${s}"`)
        assert.doesNotMatch(text, ENGLISH2)
      } finally { await ctx.close() }
    })
  }
}

test('AI18N3. a bad reset link / unknown Firebase error shows a TRANSLATED message, never the raw Firebase text', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage()
  try {
    for (const [l, msg] of [['it', 'Questo link non è valido o è scaduto'], ['fr', "Ce lien n'est pas valide ou a expiré"], ['es', 'Este enlace no es válido o ha caducado'], ['en', 'This link is invalid or has expired']] as [L, string][]) {
      await page.goto(`${M()}/reset-password?oobCode=bogus`, { waitUntil: 'networkidle', timeout: 120_000 }); await setLocale(page, l); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800)
      await page.locator('input[autocomplete="new-password"]').nth(0).fill('password123'); await page.locator('input[autocomplete="new-password"]').nth(1).fill('password123')
      await page.locator('button[type="submit"]').click()
      const toast = await page.locator('[role="status"]').first().innerText({ timeout: 15_000 })
      assert.ok(toast.includes(msg), `${l}: got "${toast}"`); assert.doesNotMatch(toast, /Firebase|auth\//)
    }
    // /auth/action without a code
    await page.goto(`${M()}/auth/action`, { waitUntil: 'networkidle' }); await setLocale(page, 'it'); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500)
    assert.ok((await body(page)).includes('Questo link non è valido'))
  } finally { await ctx.close() }
})

test('AI18N4. IOMIXO regression: own LanguageSwitcher, IOMIXO brand, no MIOLOVE flags, login/register localized', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage()
  try {
    for (const route of ['login', 'register', 'forgot-password']) {
      await page.goto(`${portalUrl(app, 'iomixo.com')}/${route}`, { waitUntil: 'networkidle', timeout: 120_000 }); await page.waitForTimeout(800)
      assert.equal(await page.locator('button[aria-pressed]').count(), 4, `${route}: IOMIXO IT/EN/ES/FR switcher`)
      assert.equal(await page.getByTestId('miolove-lang').count(), 0, `${route}: no MIOLOVE switcher`)
      assert.equal(await page.locator('[data-portal="miolove"]').count(), 0, `${route}: no MIOLOVE portal markup`)
      assert.doesNotMatch(await body(page), /MIOLOVE|🇮🇹|🇬🇧|🇫🇷|🇪🇸/)
    }
    await page.goto(`${portalUrl(app, 'iomixo.com')}/login`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'FR', exact: true }).click(); await page.waitForTimeout(300)
    const t = await body(page); assert.ok(t.includes('Bon retour') && t.includes('Se connecter') && t.includes('Mot de passe oublié ?'))
    assert.equal(new URL(page.url()).pathname, '/login')
  } finally { await ctx.close() }
})
