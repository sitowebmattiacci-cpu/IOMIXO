import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveText } from '../../lib/miolove/MioloveI18nProvider'
import { bundledText } from '../../lib/i18n'
import { coreTexts, messagesToSend } from '../../lib/miolove/serverMessages'
import { CORE_FILES } from '../../lib/miolove/fullMessages'
import { LIVE_LANGS, type MioloveLang } from '../../lib/miolove/langs'
import it from '../../locales/it.json'

// The independent MIOLOVE provider (lib/miolove/MioloveI18nProvider.tsx) over the shared context. It must not change a single text of a published language,
// must serve a language the browser does not bundle from the server's texts alone, and must leave IOMIXO's provider and every 404 as they are.
const fe = join(__dirname, '..', '..')
const src = (f: string) => readFileSync(join(fe, f), 'utf8')
const flat = (o: unknown, p = ''): string[] => o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]
const noDelivered = new Map<MioloveLang, Record<string, any>>()

test('PROV-1. for the published languages the new provider returns exactly what the bundled provider returned, for every platform and MIOLOVE key', () => {
  for (const lang of LIVE_LANGS) {
    const server = coreTexts(lang)
    assert.ok(server, `${lang}: the server has its texts`)
    const keys = new Set([...flat(it), ...flat(CORE_FILES[lang as keyof typeof CORE_FILES])])
    let checked = 0
    for (const k of keys) {
      // the old provider: bundled[lang] → bundled[it] → key
      const before = bundledText(lang, k) ?? bundledText('it', k) ?? k
      assert.equal(resolveText(lang, k, undefined, server, noDelivered), before, `${lang} ${k}`)
      assert.equal(resolveText(lang, k, undefined, undefined, noDelivered), before, `${lang} ${k} without server texts`)
      checked++
    }
    assert.ok(checked > 500, `${lang}: ${checked} keys compared`)
  }
})

test('PROV-2. a language the browser does not bundle is served from the server texts; a key it lacks falls to Italian, never to another language, and a missing one shows the key', () => {
  const server = { locale: 'de' as MioloveLang, texts: { nav: { login: 'Anmelden' }, only: { de: 'nur Deutsch' } } }
  assert.equal(resolveText('de', 'nav.login', undefined, server, noDelivered), 'Anmelden')
  assert.equal(resolveText('de', 'only.de', undefined, server, noDelivered), 'nur Deutsch')
  assert.equal(bundledText('de', 'nav.login'), undefined, 'no bundled German table exists')
  const missing = flat(it).find((k) => typeof bundledText('it', k) === 'string' && !k.startsWith('nav.'))!
  assert.equal(resolveText('de', missing, undefined, server, noDelivered), bundledText('it', missing), 'Italian is the one fallback')
  assert.equal(resolveText('de', 'no.such.key', undefined, server, noDelivered), 'no.such.key')
  assert.equal(resolveText('de', 'no.such.key', 'dflt', server, noDelivered), 'dflt')
  // texts of ANOTHER language never answer for this one
  assert.equal(resolveText('de', 'nav.login', undefined, { locale: 'fr', texts: { nav: { login: 'Connexion' } } }, noDelivered), bundledText('it', 'nav.login') ?? 'nav.login')
})

test('PROV-3. page-delivered texts (home, guide) are still honoured, in the language of the page', () => {
  const delivered = new Map<MioloveLang, Record<string, any>>([['en', { home: { meta: { title: 'Wedding album' } } }]])
  assert.equal(resolveText('en', 'home.meta.title', undefined, coreTexts('en'), delivered), 'Wedding album')
})

test('PROV-4. only a published language has server texts: a draft one answers nothing, whatever the request says', () => {
  for (const l of ['de', 'pt-BR', 'pt-PT', 'nl', 'pl', 'el', 'ja', 'ko'] as MioloveLang[]) assert.equal(coreTexts(l), undefined, l)
  for (const l of LIVE_LANGS) assert.equal(coreTexts(l)?.locale, l)
  assert.deepEqual(LIVE_LANGS.map((l) => messagesToSend(l)), LIVE_LANGS.map(() => undefined), 'the bundled languages add no bytes to their pages')
})

test('PROV-5. nothing in the provider path suspends, awaits or lazy-loads in front of the response (a 404 below it would turn into a 200)', () => {
  for (const f of ['app/layout.tsx', 'lib/miolove/MioloveI18nProvider.tsx', 'lib/miolove/serverMessages.ts', 'lib/i18nContext.tsx']) {
    const code = src(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.ok(!/Suspense|next\/dynamic|React\.lazy|\blazy\(|await |async function|export default async/.test(code), `${f} has no suspending step`)
  }
})

test('PROV-6. the portals use separate providers; IOMIXO\'s never imports anything MIOLOVE-specific, and the shared Locale is unchanged', () => {
  const i18n = src('lib/i18n.tsx').split('\n').filter((l) => /^import /.test(l)).join('\n')
  assert.ok(!/miolove\/(MioloveI18nProvider|serverMessages|fullMessages|messages)/.test(i18n), 'IOMIXO\'s provider imports no MIOLOVE provider or loader')
  const layout = src('app/layout.tsx')
  assert.ok(layout.includes('<MioloveI18nProvider initialLocale={lang} ssrLocale={ssrLang} messages={messagesToSend(lang ?? ssrLang)}>'))
  assert.ok(src('lib/locales.ts').includes("export type Locale = 'it' | 'en' | 'es' | 'fr'"))
})
