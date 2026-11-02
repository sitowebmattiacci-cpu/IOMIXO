import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIOLOVE_DISALLOW, MIOLOVE_PRIVATE_PREFIXES, MIOLOVE_SERVICE_PATHS, mioloveRobotsHeader } from '../../lib/miolove/indexing'
import { miolovePublicUrls, mioloveServiceMetadata, mioloveLegalMetadata, type MioloveServicePage } from '../../lib/miolove/seo'

const path = (url: string) => new URL(url).pathname

test('SEO-IDX-1. private surfaces answer noindex, nofollow: albums, TV screen, owner area (incl. dashboard / events / profile) and the auth handler', () => {
  for (const p of ['/live/abc', '/booth/abc', '/screen/abc', '/remote/abc', '/sessions', '/sessions/xyz', '/onboarding', '/billing', '/settings', '/auth/action', '/dashboard', '/dashboard/', '/events', '/profile'])
    assert.equal(mioloveRobotsHeader(p), 'noindex, nofollow', p)
})
test('SEO-IDX-2. service pages (login, sign-up, password, e-mail) answer noindex, follow; a trailing slash changes nothing', () => {
  for (const p of MIOLOVE_SERVICE_PATHS) { assert.equal(mioloveRobotsHeader(p), 'noindex, follow', p); assert.equal(mioloveRobotsHeader(`${p}/`), 'noindex, follow', `${p}/`) }
  assert.deepEqual([...MIOLOVE_SERVICE_PATHS].sort(), ['/forgot-password', '/login', '/register', '/reset-password', '/verify-email'])
})
test('SEO-IDX-3. public pages and look-alike paths get no robots header', () => {
  for (const p of ['/', '/en', '/fr', '/es', '/idee', '/en/ideas', '/fr/idees', '/es/ideas', '/privacy', '/terms', '/livestream', '/eventsfoo', '/profiles', '/sessionsx', '/loginx', '/registered'])
    assert.equal(mioloveRobotsHeader(p), null, p)
})
test('SEO-IDX-4. robots.txt never contradicts noindex: nothing that carries noindex is disallowed (the crawler must be able to read it); only /api/ is blocked', () => {
  assert.deepEqual(MIOLOVE_DISALLOW, ['/api/'])
  const samples = ['/live/abc', '/booth/abc', '/screen/abc', '/remote/abc', '/sessions', '/sessions/x', '/onboarding', '/billing', '/settings', '/auth/action', '/dashboard', '/events', '/profile', ...MIOLOVE_SERVICE_PATHS]
  for (const p of samples) { assert.ok(mioloveRobotsHeader(p), `${p} is noindex`); assert.ok(!MIOLOVE_DISALLOW.some((d) => p.startsWith(d)), `${p} carries noindex, so it must stay crawlable`) }
  for (const prefix of MIOLOVE_PRIVATE_PREFIXES) assert.ok(mioloveRobotsHeader(prefix.endsWith('/') ? `${prefix}x` : prefix), `${prefix} answers noindex`)
  for (const pub of ['/', '/en', '/idee', '/privacy', '/terms']) assert.ok(!MIOLOVE_DISALLOW.some((d) => pub.startsWith(d)), `${pub} must not be blocked`)
})
test('SEO-IDX-5. sitemap: 4 homes, 4 guides, the wedding page in 4 languages, privacy, terms; no login / sign-up, no private path; every listed URL is indexable', () => {
  const urls = miolovePublicUrls()
  assert.equal(urls.length, 14); assert.equal(new Set(urls).size, urls.length)
  assert.ok(urls.includes('https://miolovealbum.com/privacy') && urls.includes('https://miolovealbum.com/terms') && urls.includes('https://miolovealbum.com/en'))
  for (const u of urls) { assert.ok(u.startsWith('https://miolovealbum.com'), u); assert.equal(mioloveRobotsHeader(path(u)), null, `${u} must be indexable`) }
  assert.ok(!urls.some((u) => /\/(login|register|forgot-password|reset-password|verify-email|dashboard)/.test(u)))
})
test('SEO-META-1. service pages: own title and description, noindex + follow, no canonical, no brand of the other portal', () => {
  const pages: MioloveServicePage[] = ['login', 'register', 'forgot', 'reset', 'verify']
  const titles = new Set<string>()
  for (const p of pages) {
    const m = mioloveServiceMetadata(p) as any
    assert.ok(typeof m.title === 'string' && m.title.length >= 5 && m.title.length <= 40, `${p} title (the auth layout adds " — MIOLOVE ALBUM")`); titles.add(m.title)
    assert.ok(m.description.length >= 40 && m.description.length <= 165, `${p} description ${m.description.length}`)
    assert.deepEqual(m.robots, { index: false, follow: true }); assert.equal(m.alternates, undefined, `${p}: no canonical on a noindex page`)
    assert.doesNotMatch(JSON.stringify(m), /iomixo|live hub/i)
  }
  assert.equal(titles.size, pages.length, 'every service page has its own title')
})
test('SEO-META-2. privacy / terms: Italian title and description, self-referencing canonical, indexable, own Open Graph URL', () => {
  const titles = new Set<string>()
  for (const [kind, p] of [['privacy', '/privacy'], ['terms', '/terms']] as const) {
    const m = mioloveLegalMetadata(kind) as any, url = `https://miolovealbum.com${p}`
    assert.equal(m.alternates.canonical, url); assert.equal(m.alternates.languages, undefined, 'one URL per document: no hreflang')
    assert.equal(m.openGraph.url, url); assert.deepEqual(m.robots, { index: true, follow: true })
    assert.match(m.title.absolute, /MIOLOVE ALBUM/); assert.ok(m.title.absolute.length <= 65, m.title.absolute); titles.add(m.title.absolute)
    assert.ok(m.description.length >= 80 && m.description.length <= 165, `${kind} description ${m.description.length}`); assert.doesNotMatch(m.description, /^How |^The terms/, 'not the old English text')
    assert.doesNotMatch(JSON.stringify(m), /iomixo/i)
  }
  assert.equal(titles.size, 2)
})
