import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { middleware } from '../../middleware'
import { DEFAULT_LANG, LANG_META, LIVE_LANGS, MIOLOVE_LANGS, isLiveLang, type MioloveLang } from '../../lib/miolove/langs'
import { PAGES, PAGE_IDS, plannedPagePath, plannedPaths, publishedLangs, resolvePublicPath, switchOptions, switchTarget, type PageDef, type PageId } from '../../lib/miolove/pages'
import { HOME_PATH, IDEAS_PATH, homePath, ideasPath } from '../../lib/miolove/paths'
import { PUBLIC_ONLY_NAMESPACES, SERVER_ONLY_NAMESPACES, hasMessages, loadCoreMessages, loadMessages, makeT } from '../../lib/miolove/messages'
import { MIOLOVE_PRIVATE_PREFIXES, MIOLOVE_SERVICE_PATHS, mioloveRobotsHeader } from '../../lib/miolove/indexing'
import { mioloveServiceMetadata, SEO_LANGUAGES, homeUrl, ideasUrl, mioloveHomeMetadata, mioloveIdeasMetadata, mioloveIdeasStructuredData, mioloveStructuredData, miolovePublicUrls, pageAlternates } from '../../lib/miolove/seo'
import { LOCALES, type Locale } from '../../lib/locales'
import { MIOLOVE_LOCALES, intlLocale, isSharedLocale, type MioloveLocale } from '../../lib/miolove/locale'
import { localeFromAcceptLanguage } from '../../lib/miolove/requestLang'
import { CORE_FILES, MIOLOVE_FULL } from '../../lib/miolove/fullMessages'
const it = MIOLOVE_FULL.it

const fe = join(__dirname, '..', '..')
const NEW_LANGS: MioloveLang[] = ['de', 'pt-BR', 'pt-PT', 'nl', 'pl', 'el', 'ja', 'ko']
const ORIGIN = 'https://miolovealbum.com'

// ── Registry ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('I18N-REG-1. twelve languages, Italian on the bare root, pt-BR and pt-PT kept apart, no generic /pt', () => {
  assert.deepEqual([...MIOLOVE_LANGS], ['it', 'en', 'fr', 'es', 'de', 'pt-BR', 'pt-PT', 'nl', 'pl', 'el', 'ja', 'ko'])
  assert.equal(DEFAULT_LANG, 'it'); assert.equal(LANG_META.it.prefix, '')
  const prefixes = MIOLOVE_LANGS.map((l) => LANG_META[l].prefix).filter(Boolean)
  assert.equal(new Set(prefixes).size, prefixes.length, 'one folder per language')
  assert.ok(prefixes.every((p) => p === p.toLowerCase() && !p.includes('/')), 'lowercase single folders')
  assert.equal(LANG_META['pt-BR'].prefix, 'pt-br'); assert.equal(LANG_META['pt-PT'].prefix, 'pt-pt'); assert.ok(!prefixes.includes('pt'))
  assert.equal(LANG_META['pt-BR'].hreflang, 'pt-BR'); assert.equal(LANG_META['pt-PT'].hreflang, 'pt-PT')
  assert.equal(new Set(MIOLOVE_LANGS.map((l) => LANG_META[l].hreflang)).size, 12, 'every hreflang distinct')
})

test('I18N-REG-2. only it / en / fr / es are published; the eight new languages are drafts (flipping one is a deliberate edit of this pin)', () => {
  assert.deepEqual([...LIVE_LANGS], ['it', 'en', 'fr', 'es'])
  for (const l of NEW_LANGS) assert.equal(LANG_META[l].status, 'draft', l)
  for (const id of PAGE_IDS) assert.deepEqual(publishedLangs(id), ['it', 'en', 'fr', 'es'], `${id} is published only in the four online languages`)
})

test('I18N-REG-3. the shared UI Locale (read by IOMIXO) is untouched: four languages, same order', () => {
  assert.deepEqual([...LOCALES], ['it', 'en', 'es', 'fr'])
  assert.ok(LIVE_LANGS.every((l) => (LOCALES as string[]).includes(l)), 'published MIOLOVE languages are all shared locales until a live language brings its own provider')
})

test('I18N-REG-4. a page is published in a language only if the language is live AND the page lists it', () => {
  for (const id of PAGE_IDS) for (const l of publishedLangs(id)) { assert.ok(isLiveLang(l)); assert.ok(PAGES[id].langs.includes(l)) }
  for (const id of PAGE_IDS) assert.ok(Object.keys(PAGES[id].slugs).length === 12, `${id} has a (provisional) slug for every language`)
})

// ── URLs that already exist never change ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('I18N-URL-1. the eight URLs already online, the sitemap and the helpers are exactly what they were', () => {
  assert.deepEqual(HOME_PATH, { it: '/', en: '/en', fr: '/fr', es: '/es' })
  assert.deepEqual(IDEAS_PATH, { it: '/idee', en: '/en/ideas', fr: '/fr/idees', es: '/es/ideas' })
  assert.deepEqual(miolovePublicUrls(), [
    `${ORIGIN}/`, `${ORIGIN}/en`, `${ORIGIN}/fr`, `${ORIGIN}/es`,
    `${ORIGIN}/idee`, `${ORIGIN}/en/ideas`, `${ORIGIN}/fr/idees`, `${ORIGIN}/es/ideas`,
    `${ORIGIN}/privacy`, `${ORIGIN}/terms`,
  ])
  assert.equal(homePath('xx'), '/'); assert.equal(ideasPath('xx'), '/idee')
  assert.equal(homePath('de'), '/', 'a draft language has no public path: callers get the Italian one'); assert.equal(ideasPath('pt-BR'), '/idee')
})

test('I18N-URL-2. album, QR, booth, TV, login, dashboard and payment paths stay unprefixed and keep their robots rules', () => {
  for (const p of ['/live/abc123', '/booth/p1', '/screen/abc123', '/remote/x', '/auth/action', '/dashboard', '/sessions', '/billing', '/onboarding']) {
    assert.equal(mioloveRobotsHeader(p), 'noindex, nofollow', p)
  }
  for (const p of ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email']) assert.equal(mioloveRobotsHeader(p), 'noindex, follow', p)
  for (const l of MIOLOVE_LANGS) for (const p of [...MIOLOVE_PRIVATE_PREFIXES, ...MIOLOVE_SERVICE_PATHS]) {
    const folder = p.split('/')[1]
    assert.notEqual(folder, LANG_META[l].prefix, `language folder "${LANG_META[l].prefix}" would collide with ${p}`)
  }
})

test('I18N-URL-3. no language folder collides with an application route; no planned public URL is a private or service page', () => {
  const routes = readdirSync(join(fe, 'app')).filter((n) => statSync(join(fe, 'app', n)).isDirectory()).map((n) => n.replace(/^\((.*)\)$/, '$1'))
  for (const l of MIOLOVE_LANGS) assert.ok(!routes.includes(LANG_META[l].prefix || '\0'), `folder "${LANG_META[l].prefix}" is an app route`)
  for (const l of MIOLOVE_LANGS) for (const p of plannedPaths(l)) assert.equal(mioloveRobotsHeader(p), null, `${p} must be public`)
})

// ── Drafts are invisible ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('I18N-DRAFT-1. every URL planned for a draft language is unresolved, absent from the sitemap and from every hreflang', () => {
  const urls = new Set(miolovePublicUrls())
  for (const l of NEW_LANGS) for (const id of PAGE_IDS) {
    const path = plannedPagePath(id, l)
    assert.equal(resolvePublicPath(path), null, `${path} must not resolve`)
    assert.equal(resolvePublicPath(`${path}/`), null)
    assert.ok(!urls.has(`${ORIGIN}${path === '/' ? '/' : path}`), `${path} in the sitemap`)
    const alt = JSON.stringify([pageAlternates(id), mioloveHomeMetadata('it').alternates, mioloveIdeasMetadata('it').alternates])
    assert.ok(!alt.includes(`${ORIGIN}${path}"`) || path === '/', `${path} in an hreflang`)
    assert.ok(!(LANG_META[l].hreflang in pageAlternates(id)), `${LANG_META[l].hreflang} in hreflang`)
  }
  assert.ok(![...urls].some((u) => /\/(de|pt-br|pt-pt|nl|pl|el|ja|ko)(\/|$)/.test(u)), 'no draft folder anywhere in the sitemap')
})

test('I18N-DRAFT-2. metadata and structured data refuse to describe a draft language (they throw instead of serving Italian text under a foreign URL)', () => {
  for (const l of NEW_LANGS) {
    assert.throws(() => mioloveHomeMetadata(l), /not published/)
    assert.throws(() => mioloveIdeasMetadata(l), /not published/)
    assert.throws(() => mioloveStructuredData(l), /not published/)
    assert.throws(() => mioloveIdeasStructuredData(l), /not published/)
  }
})

// ── hreflang / canonical ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('I18N-HREF-1. canonical is the page itself; hreflang is the same reciprocal set on every language, self-referencing, with x-default = Italian', () => {
  const each: Array<[string, (l: MioloveLang) => any, (l: MioloveLang) => string]> = [['home', mioloveHomeMetadata, homeUrl], ['ideas', mioloveIdeasMetadata, ideasUrl]]
  for (const [id, meta, url] of each) {
    const reference = JSON.stringify(meta('it').alternates?.languages)
    for (const l of LIVE_LANGS) {
      const a = meta(l).alternates
      assert.equal(a.canonical, url(l), `${id} ${l} canonical`)
      assert.equal(JSON.stringify(a.languages), reference, `${id} ${l}: every language lists the same set (reciprocal)`)
      assert.equal(a.languages[LANG_META[l].hreflang], a.canonical, `${id} ${l} lists itself`)
    }
    const langs = meta('it').alternates.languages
    assert.deepEqual(Object.keys(langs), ['it', 'en', 'fr', 'es', 'x-default'])
    assert.equal(langs['x-default'], url('it'))
    for (const u of Object.values(langs) as string[]) assert.ok(miolovePublicUrls().includes(u), `${u} is in the sitemap`)
  }
  assert.deepEqual([...SEO_LANGUAGES], ['it', 'en', 'fr', 'es'])
})

test('I18N-HREF-2. structured data declares only the published languages', () => {
  const g = mioloveStructuredData('en')['@graph'] as any[]
  assert.deepEqual(g.find((n) => n['@type'] === 'WebSite').inLanguage, ['it', 'en', 'fr', 'es'])
  assert.equal((mioloveIdeasStructuredData('fr')['@graph'] as any[])[0].inLanguage, 'fr')
})

// ── Middleware ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const call = (host: string, path: string, extra: Record<string, string> = {}) => {
  const res = middleware(new NextRequest(`https://${host}${path}`, { headers: { host, ...extra } }))
  return {
    status: res.status,
    rewrite: res.headers.get('x-middleware-rewrite') ? new URL(res.headers.get('x-middleware-rewrite')!).pathname : null,
    lang: res.headers.get('x-middleware-request-x-ml-lang'),
    robots: res.headers.get('X-Robots-Tag'),
    location: res.headers.get('location'),
  }
}

test('I18N-MW-1. the four published languages route exactly as before (rewrite target, language header)', () => {
  const table: Array<[string, string | null, string | null]> = [
    ['/', null, 'it'], ['/en', '/', 'en'], ['/fr', '/', 'fr'], ['/es', '/', 'es'], ['/en/', '/', 'en'],
    ['/idee', null, 'it'], ['/en/ideas', '/idee', 'en'], ['/fr/idees', '/idee', 'fr'], ['/es/ideas', '/idee', 'es'], ['/idee/', null, 'it'],
  ]
  for (const [path, rewrite, lang] of table) {
    const r = call('miolovealbum.com', path)
    assert.equal(r.rewrite, rewrite, `${path} rewrite`); assert.equal(r.lang, lang, `${path} x-ml-lang`); assert.equal(r.robots, null)
  }
})

test('I18N-MW-2. a client-supplied language header never decides a public page: the URL does ("/" and "/idee" are Italian, whatever is sent)', () => {
  assert.equal(call('miolovealbum.com', '/', { 'x-ml-lang': 'en' }).lang, 'it')
  assert.equal(call('miolovealbum.com', '/idee', { 'x-ml-lang': 'fr' }).lang, 'it')
  assert.equal(call('miolovealbum.com', '/en', { 'x-ml-lang': 'fr' }).lang, 'en')
})

test('I18N-MW-3. draft-language URLs are not routed (no rewrite, no language header): the request ends in the application 404', () => {
  for (const l of NEW_LANGS) for (const id of PAGE_IDS) {
    const r = call('miolovealbum.com', plannedPagePath(id, l), { 'x-ml-lang': l })
    assert.equal(r.rewrite, null, plannedPagePath(id, l)); assert.equal(r.lang, null)
  }
})

test('I18N-MW-4. private paths keep X-Robots-Tag; www redirects to the apex; IOMIXO is never routed by the MIOLOVE registry', () => {
  assert.equal(call('miolovealbum.com', '/live/abc123').robots, 'noindex, nofollow')
  assert.equal(call('miolovealbum.com', '/login').robots, 'noindex, follow')
  assert.equal(call('miolovealbum.com', '/dashboard').rewrite, null)
  const w = call('www.miolovealbum.com', '/en/ideas'); assert.equal(w.status, 308); assert.equal(w.location, `${ORIGIN}/en/ideas`)
  for (const p of ['/', '/en', '/fr', '/idee', '/en/ideas', '/de', '/pt-br', '/live/abc123']) {
    const r = call('iomixo.com', p)
    assert.equal(r.rewrite, null, `iomixo ${p} rewrite`); assert.equal(r.lang, null, `iomixo ${p} lang`); assert.equal(r.robots, null, `iomixo ${p} robots`)
  }
  assert.equal(call('localhost:3000', '/en').rewrite, null, 'non-portal hosts are untouched too')
})

// ── Dictionaries: complete, no Italian left over, no bundle leaks ────────────────────────────────────────────────────────────────────────────────
const flat = (o: any, p = ''): Array<[string, unknown]> =>
  o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [[p, o]]
const placeholders = (s: string): string => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
/** Short strings (brand, "Menu", "Account", sample first names) are legitimately the same in two languages; longer text equal to Italian is a missed translation. */
const SAME_AS_ITALIAN_MAX = 14

/** What is wrong with a dictionary that wants to be published, compared with the Italian reference. Empty list = publishable. */
export function dictionaryProblems(reference: unknown, candidate: unknown, isReference = false): string[] {
  const ref = new Map(flat(reference)), got = new Map(flat(candidate)), out: string[] = []
  for (const [k, v] of ref) {
    if (!got.has(k)) { out.push(`missing ${k}`); continue }
    const c = got.get(k)
    if (typeof v !== 'string') continue
    if (typeof c !== 'string' || c.trim() === '') { out.push(`empty ${k}`); continue }
    if (!isReference && c === v && v.length > SAME_AS_ITALIAN_MAX) out.push(`untranslated (Italian) ${k}`)
    if (placeholders(c) !== placeholders(v)) out.push(`placeholders ${k}`)
  }
  for (const k of got.keys()) if (!ref.has(k)) out.push(`extra ${k}`)
  return out
}

test('I18N-DICT-1. every published language has a registered, complete dictionary: no missing key, nothing left in Italian, same placeholders', async () => {
  for (const l of LIVE_LANGS) {
    assert.ok(hasMessages(l), `${l} has a loader`)
    const all = await loadMessages(l, Object.keys(it))
    assert.deepEqual(dictionaryProblems(it, all, l === DEFAULT_LANG), [], l)
  }
})

test('I18N-DICT-2. the completeness check really catches an unfinished language (a copy of the Italian file, a missing key, a lost placeholder)', () => {
  assert.ok(dictionaryProblems(it, it).length > 100, 'an untranslated copy is refused')
  const en = JSON.parse(JSON.stringify(MIOLOVE_FULL.en))
  assert.deepEqual(dictionaryProblems(it, en), [])
  const broken = JSON.parse(JSON.stringify(en)); delete broken.home.meta.title
  assert.deepEqual(dictionaryProblems(it, broken), ['missing home.meta.title'])
  const [k, v] = flat(en).find(([, s]) => typeof s === 'string' && /\{\w+\}/.test(s as string))!
  const lost = JSON.parse(JSON.stringify(en)); k.split('.').reduce((a: any, key, i, arr) => (i === arr.length - 1 ? (a[key] = String(v).replace(/\{\w+\}/g, 'X')) : a[key]), lost)
  assert.deepEqual(dictionaryProblems(it, lost), [`placeholders ${k}`])
})

test('I18N-DICT-3. loading is per language and per namespace; a language without texts is an error, and a missing key is never answered in Italian', async () => {
  const only = await loadMessages('fr', ['home'])
  assert.deepEqual(Object.keys(only), ['home'])
  assert.equal(await loadMessages('en', ['doesNotExist']).then((m) => Object.keys(m).length), 0)
  for (const l of NEW_LANGS) { assert.equal(hasMessages(l), false, l); await assert.rejects(loadMessages(l, ['home']), /no texts registered/) }
  const t = makeT(only)
  assert.equal(t('home.nav.menu'), 'Menu'); assert.equal(t('home.nope.key'), 'home.nope.key'); assert.equal(t('home.nope', 'x'), 'x')
  assert.notEqual(t('home.meta.title'), (it as any).home.meta.title, 'French title, not the Italian one')
})

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  if (n === 'node_modules' || n === '.next') return []
  const p = join(dir, n)
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
})

test('I18N-BUNDLE-1. no source file loads a dictionary of a draft language; the browser bundle imports only the four published ones, only from the i18n provider', () => {
  const files = ['app', 'components', 'lib'].flatMap((d) => walk(join(fe, d))).concat(join(fe, 'middleware.ts'))
  const draftDict = new RegExp(`locales/miolove/(${NEW_LANGS.join('|')})[/.']`, 'i')
  for (const f of files) assert.ok(!draftDict.test(readFileSync(f, 'utf8')), `${f} references a draft dictionary`)
  const importers = files.filter((f) => /from '@\/locales\/miolove\/|import\('@\/locales\/miolove\//.test(readFileSync(f, 'utf8'))).map((f) => f.slice(fe.length + 1)).sort()
  assert.deepEqual(importers, ['lib/i18n.tsx', 'lib/miolove/fullMessages.ts', 'lib/miolove/messages.ts'], 'who may read the MIOLOVE dictionaries')
  const publicImporters = files.filter((f) => /locales\/miolove\/public\//.test(readFileSync(f, 'utf8'))).map((f) => f.slice(fe.length + 1)).sort()
  assert.deepEqual(publicImporters, ['lib/miolove/fullMessages.ts', 'lib/miolove/messages.ts'], 'the public-page texts are read by server modules only')
  assert.ok(/from '@\/locales\/miolove\/(it|en|es|fr)\.json'/.test(readFileSync(join(fe, 'lib/i18n.tsx'), 'utf8')) && !readFileSync(join(fe, 'lib/i18n.tsx'), 'utf8').includes('miolove/public'), 'the provider bundles the core files only')
})

test('I18N-BUNDLE-2. server-only modules (SEO, messages) are never imported by a client component; the edge modules import no dictionary', () => {
  const files = ['app', 'components', 'lib'].flatMap((d) => walk(join(fe, d)))
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    if (!/^['"]use client['"]/m.test(src.split('\n').slice(0, 3).join('\n'))) continue
    assert.ok(!/miolove\/(seo|messages|fullMessages|publicTexts)'/.test(src), `${f.slice(fe.length + 1)} is a client component importing a server module`)
  }
  for (const f of ['middleware.ts', 'lib/miolove/langs.ts', 'lib/miolove/pages.ts', 'lib/miolove/paths.ts', 'lib/miolove/indexing.ts']) {
    assert.ok(!/\.json'/.test(readFileSync(join(fe, f), 'utf8')), `${f} must stay JSON-free (edge size)`)
  }
})

// ── Language switch (menu of the public pages) ───────────────────────────────────────────────────────────────────────────────────────────────
test('SWITCH-1. every published page × every published language: the menu opens the equivalent URL, exactly, and offers only published languages', () => {
  for (const id of PAGE_IDS) {
    const opts = switchOptions(id)
    assert.deepEqual(opts.map((o) => o.lang), [...LIVE_LANGS], `${id}: only published languages, registry order`)
    for (const o of opts) {
      assert.equal(o.exact, true); assert.equal(o.path, plannedPagePath(id, o.lang)); assert.equal(resolvePublicPath(o.path)?.lang, o.lang, `${o.path} routes to ${o.lang}`)
      assert.equal(resolvePublicPath(o.path)?.page, id)
    }
    for (const l of NEW_LANGS) { assert.equal(switchTarget(id, l), null, `${l} draft: not offered`); assert.ok(!opts.some((o) => o.lang === l)) }
  }
  assert.deepEqual(switchOptions('ideas').map((o) => o.path), ['/idee', '/en/ideas', '/fr/idees', '/es/ideas'])
  assert.deepEqual(switchOptions('home').map((o) => o.path), ['/', '/en', '/fr', '/es'])
})

test('SWITCH-2. a page missing in the chosen language opens that language\'s home; a language without a published home is not offered; drafts never appear', () => {
  const pages: Record<PageId, PageDef> = {
    home: { ...PAGES.home, langs: ['it', 'en', 'fr', 'de'] },
    ideas: { ...PAGES.ideas, langs: ['it', 'en'] },
  }
  const cfg = { pages, live: ['it', 'en', 'fr'] as MioloveLang[] }          // fr has a home but no guide; de is listed by the pages but is not live
  assert.deepEqual(switchOptions('ideas', cfg).map((o) => [o.lang, o.path, o.exact]), [['it', '/idee', true], ['en', '/en/ideas', true], ['fr', '/fr', false]])
  assert.equal(switchTarget('ideas', 'de', cfg), null, 'a language that is not live is never offered, even if a page lists it')
  const noHome: Record<PageId, PageDef> = { home: { ...PAGES.home, langs: ['it', 'en'] }, ideas: { ...PAGES.ideas, langs: ['it', 'en', 'fr'] } }
  assert.equal(switchTarget('home', 'fr', { pages: noHome, live: ['it', 'en', 'fr'] }), null, 'no home → not offered (nothing Italian is ever shown under a foreign URL)')
  assert.deepEqual(switchOptions('home', { pages: noHome, live: ['it', 'en', 'fr'] }).map((o) => o.lang), ['it', 'en'])
})

// ── Language continuity: source guards ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test('SWITCH-3. the shared auth / legal pages go home through HomeLink (IOMIXO keeps <Link href="/">, MIOLOVE gets its language home); the public pages enforce their URL language', () => {
  for (const f of ['app/(auth)/login/page.tsx', 'app/(auth)/register/page.tsx', 'app/(auth)/forgot-password/page.tsx', 'app/(auth)/reset-password/page.tsx', 'app/(auth)/verify-email/page.tsx', 'components/legal/LegalPage.tsx']) {
    const src = readFileSync(join(fe, f), 'utf8')
    assert.ok(!/<Link href="\/"/.test(src), `${f} still links to "/" directly`); assert.ok(src.includes('<HomeLink'), f)
  }
  const home = readFileSync(join(fe, 'components/portal/HomeLink.tsx'), 'utf8')
  assert.ok(home.includes('<Link href="/" {...props} />'), 'non-MIOLOVE hosts: exactly the old link')
  for (const f of ['components/miolove/home/MioloveHome.tsx', 'components/miolove/ideas/MioloveIdeas.tsx']) assert.ok(readFileSync(join(fe, f), 'utf8').includes('<UrlLocale />'), `${f} must enforce the URL language`)
})

// ── Phase B: language per request, service-page titles, what the bundle must never hold ──────────────────────────────────────────────────────────
test('I18N-B1. the texts of a language can be loaded whole, by namespace, or as "core" (everything but what only the public pages read)', async () => {
  for (const l of LIVE_LANGS) {
    const all = await loadMessages(l), core = await loadCoreMessages(l)
    for (const ns of PUBLIC_ONLY_NAMESPACES) { assert.ok(ns in all); assert.ok(!(ns in core), `${l}: core has no "${ns}"`) }
    assert.equal(Object.keys(core).length + PUBLIC_ONLY_NAMESPACES.length + SERVER_ONLY_NAMESPACES.length, Object.keys(all).length)
    assert.deepEqual(Object.keys(await loadMessages(l, ['home'])), ['home'])
    assert.deepEqual(Object.keys(core).sort(), Object.keys(CORE_FILES[l as 'it']).sort(), `${l}: core = the file the browser bundles`)
  }
})

test('I18N-B2. home / guide texts are read only by the home and guide components: every other page can be served without them', () => {
  const files = ['app', 'components', 'lib'].flatMap((d) => walk(join(fe, d)))
  for (const f of files) {
    const rel = f.slice(fe.length + 1)
    if (/^components\/miolove\/(home|ideas)\//.test(rel) || ['lib/miolove/demoMedia.ts', 'lib/miolove/ideas.ts', 'lib/miolove/seo.ts'].includes(rel)) continue
    assert.ok(!/['"`](home|ideas)\.[a-zA-Z]/.test(readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')), `${rel} reads a home / guide text`)
  }
})

test('I18N-B3. service pages (sign-in, sign-up, password, e-mail): title and description follow the visitor\'s language, stay noindex, carry no canonical', () => {
  for (const p of ['login', 'register', 'forgot', 'reset', 'verify'] as const) {
    const titles = new Set<string>()
    for (const l of LIVE_LANGS) {
      const m = mioloveServiceMetadata(p, l) as any
      assert.ok(m.title && m.description.length > 30, `${p} ${l}`); assert.deepEqual(m.robots, { index: false, follow: true }); assert.equal(m.alternates, undefined, 'no canonical')
      titles.add(m.title)
    }
    assert.equal(titles.size, 4, `${p}: four different titles`)
    assert.deepEqual(mioloveServiceMetadata(p), mioloveServiceMetadata(p, 'it'), 'Italian by default')
  }
})

test('I18N-B4. the browser language is read on the server exactly as the client reads navigator.language (first tag, two letters, supported or Italian)', async () => {
  const fn = localeFromAcceptLanguage
  assert.deepEqual(['fr-FR,fr;q=0.9', 'en-GB', 'es', 'IT-it', 'de-DE,en;q=0.8', '', undefined, 'pt-BR'].map(fn), ['fr', 'en', 'es', 'it', 'it', 'it', 'it', 'it'])
})

test('I18N-B5. IOMIXO\'s provider behaviour is untouched: the layout hands the MIOLOVE-only options to MIOLOVE alone, and the dictionaries IOMIXO reads are still the merged ones', () => {
  const layout = readFileSync(join(fe, 'app/layout.tsx'), 'utf8')
  assert.ok(layout.includes("ssrLocale={miolove ? ssrLang : undefined} rememberInCookie={miolove}"), 'non-MIOLOVE hosts get neither option')
  assert.ok(layout.includes("<html lang={miolove ? ssrLang : (lang ?? 'it')}"), 'IOMIXO keeps its <html lang>')
  assert.ok(layout.includes("const urlChosen = isLocale(urlLang) ? urlLang : undefined"))
  const i18n = readFileSync(join(fe, 'lib/i18n.tsx'), 'utf8')
  assert.ok(i18n.includes('deepMerge(it, mlIt)') && i18n.includes('deepMerge(fr, mlFr)'))
})

test('I18N-B6. MioloveLocale is independent of the shared Locale: twelve languages vs the four IOMIXO supports, which are unchanged', () => {
  const widen = (l: Locale): MioloveLocale => l          // compile-time: every shared Locale is a MioloveLocale
  assert.deepEqual(LOCALES.map(widen), ['it', 'en', 'es', 'fr'], 'the shared type and IOMIXO\'s languages did not change')
  assert.equal(MIOLOVE_LOCALES.length, 12)
  assert.deepEqual(MIOLOVE_LOCALES.filter(isSharedLocale), ['it', 'en', 'fr', 'es'])
  assert.deepEqual(MIOLOVE_LOCALES.filter((l) => !isSharedLocale(l)), NEW_LANGS, 'the eight new languages are MIOLOVE-only')
  assert.deepEqual(MIOLOVE_LOCALES.map(intlLocale).slice(0, 4), ['it-IT', 'en-GB', 'fr-FR', 'es-ES'])
  const lib = readFileSync(join(fe, 'lib/locales.ts'), 'utf8'); assert.ok(lib.includes("export type Locale = 'it' | 'en' | 'es' | 'fr'"), 'lib/locales.ts untouched')
})
