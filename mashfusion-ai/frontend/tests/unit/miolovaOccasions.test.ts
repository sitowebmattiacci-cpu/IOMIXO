import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { middleware } from '../../middleware'
import { MIOLOVE_FULL } from '../../lib/miolove/fullMessages'
import { LANG_META, LIVE_LANGS } from '../../lib/miolove/langs'
import { OCCASION_IDS, PAGES, PAGE_IDS, plannedPagePath, publishedLangs, resolvePublicPath, type OccasionId } from '../../lib/miolove/pages'
import { MIOLOVE_FORBIDDEN_COPY, ALBUM_PRICING, TRIAL_MEDIA_LIMIT, formatAlbumPrice } from '../../lib/miolove/plans'
import { occasionText } from '../../lib/miolove/occasions'
import { miolovePublicUrls, mioloveOccasionMetadata, mioloveOccasionStructuredData, occasionFaq, pageAlternates } from '../../lib/miolove/seo'
import { mioloveRobotsHeader } from '../../lib/miolove/indexing'

// Occasion pages (wedding, birthday, baptism × it/en/fr/es). Today only the Italian wedding page is published; every check runs over what the registry
// publishes, so the same tests cover each page and language the day it is added.
const ORIGIN = 'https://miolovealbum.com'
const D = MIOLOVE_FULL as Record<string, any>
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const published = (): Array<{ id: OccasionId; lang: (typeof LIVE_LANGS)[number] }> => OCCASION_IDS.flatMap((id) => publishedLangs(id).map((lang) => ({ id, lang })))
const strings = (o: any): string[] => (typeof o === 'string' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : [])
const words = (s: string) => s.split(/\s+/).filter(Boolean).length
const call = (path: string, extra: Record<string, string> = {}) => {
  const res = middleware(new NextRequest(`${ORIGIN}${path}`, { headers: { host: 'miolovealbum.com', ...extra } }))
  return { rewrite: res.headers.get('x-middleware-rewrite') ? new URL(res.headers.get('x-middleware-rewrite')!).pathname : null, lang: res.headers.get('x-middleware-request-x-ml-lang') }
}

test('OCC-1. registry: the three occasions have a route and a slug per language; only the Italian wedding page is published, the rest answer 404 and are in no sitemap', () => {
  assert.deepEqual([...OCCASION_IDS], ['wedding', 'birthday', 'baptism'])
  assert.deepEqual(OCCASION_IDS.map((id) => PAGES[id].route), ['/matrimonio', '/compleanno', '/battesimo'])
  for (const id of OCCASION_IDS) assert.equal(Object.keys(PAGES[id].slugs).length, 12, `${id} has a provisional slug per language`)
  assert.deepEqual(OCCASION_IDS.map((id) => plannedPagePath(id, 'it')), ['/matrimonio', '/compleanno', '/battesimo'])
  assert.deepEqual(OCCASION_IDS.map((id) => plannedPagePath(id, 'en')), ['/en/wedding', '/en/birthday', '/en/baptism'])
  assert.deepEqual(OCCASION_IDS.map((id) => plannedPagePath(id, 'fr')), ['/fr/mariage', '/fr/anniversaire', '/fr/bapteme'])
  assert.deepEqual(published().map((p) => p.id + ':' + p.lang), ['wedding:it'])
  assert.equal(resolvePublicPath('/matrimonio')?.page, 'wedding')
  for (const p of ['/compleanno', '/battesimo', '/en/wedding', '/en/birthday', '/fr/mariage', '/es/bodas', '/es/boda', '/de/hochzeit']) assert.equal(resolvePublicPath(p), null, `${p} is not published`)
  const urls = miolovePublicUrls()
  assert.ok(urls.includes(`${ORIGIN}/matrimonio`)); assert.ok(!urls.some((u) => /compleanno|battesimo|\/wedding|\/mariage|\/bodas|hochzeit/.test(u)))
  assert.equal(new Set(urls).size, urls.length)
  for (const u of urls) assert.equal(mioloveRobotsHeader(new URL(u).pathname), null, `${u} is indexable`)
})

test('OCC-2. middleware: the published occasion URL is rewritten/served with its language; unpublished ones are not routed (404); a client header never decides', () => {
  assert.deepEqual(call('/matrimonio'), { rewrite: null, lang: 'it' })
  assert.deepEqual(call('/matrimonio/'), { rewrite: null, lang: 'it' })
  assert.deepEqual(call('/matrimonio', { 'x-ml-lang': 'en' }), { rewrite: null, lang: 'it' })
  for (const p of ['/en/wedding', '/fr/mariage', '/es/bodas', '/compleanno', '/battesimo', '/en/birthday']) assert.deepEqual(call(p, { 'x-ml-lang': 'en' }), { rewrite: null, lang: null }, p)
})

test('OCC-3. hreflang and canonical: a page lists only the languages it is published in, self-referencing, x-default = Italian', () => {
  assert.deepEqual(pageAlternates('wedding'), { it: `${ORIGIN}/matrimonio`, 'x-default': `${ORIGIN}/matrimonio` })
  for (const { id, lang } of published()) {
    const m = mioloveOccasionMetadata(id, lang) as any
    assert.equal(m.alternates.canonical, `${ORIGIN}${plannedPagePath(id, lang)}`)
    assert.deepEqual(m.robots, { index: true, follow: true })
    assert.deepEqual(m.openGraph.alternateLocale, publishedLangs(id).filter((l) => l !== lang).map((l) => LANG_META[l].og), 'og:locale:alternate lists only languages the page exists in')
    assert.equal(m.openGraph.url, m.alternates.canonical); assert.equal(m.openGraph.locale, LANG_META[lang].og)
    for (const l of publishedLangs(id)) assert.equal(m.alternates.languages[LANG_META[l].hreflang], `${ORIGIN}${plannedPagePath(id, l)}`)
  }
  assert.throws(() => mioloveOccasionMetadata('wedding', 'en'), /not published/)
  assert.throws(() => mioloveOccasionMetadata('birthday', 'it'), /not published/)
  assert.throws(() => mioloveOccasionStructuredData('baptism', 'it'), /not published/)
})

test('OCC-4. title ≤ 60, description 120–160, no price in the snippet, distinct from every other page of the same language', () => {
  for (const { id, lang } of published()) {
    const m = D[lang].occasions[id].meta as { title: string; description: string; ogTitle: string }
    assert.ok(m.title.length >= 25 && m.title.length <= 60, `${id}/${lang} title ${m.title.length}`)
    assert.ok(m.description.length >= 120 && m.description.length <= 160, `${id}/${lang} description ${m.description.length}`)
    assert.ok(m.ogTitle.length <= 80, `${id}/${lang} og:title`)
    assert.doesNotMatch(`${m.title} ${m.description}`, /€|\$|\d+[.,]\d{2}|abbonament|subscription|abonnement|suscripci/i)
    const others = [D[lang].home.meta, D[lang].ideas.meta, ...OCCASION_IDS.filter((o) => o !== id && D[lang].occasions?.[o]).map((o) => D[lang].occasions[o].meta)]
    for (const o of others) for (const f of ['title', 'description', 'ogTitle'] as const) assert.notEqual(m[f], o[f], `${id}/${lang} ${f} duplicates another page`)
  }
})

test('OCC-5. one H1 text, 4–6 own FAQ, 400–900 words of content; FAQ unique and not copied from the home or the guide', () => {
  for (const { id, lang } of published()) {
    const o = D[lang].occasions[id]
    assert.ok(o.hero.titleA.length > 8 && o.hero.titleB.length > 4, `${id}/${lang} H1`)
    const faq = occasionFaq(id, lang)
    assert.ok(faq.length >= 4 && faq.length <= 6, `${id}/${lang} ${faq.length} FAQ`)
    const home = Object.values(D[lang].home.faq).map((f: any) => f?.q).filter(Boolean), guide = Object.values(D[lang].ideas.faq).map((f: any) => f?.q).filter(Boolean)
    const seen = new Set<string>()
    for (const f of faq) { assert.ok(f.q.endsWith('?') && f.a.length > 60, `${id}/${lang} ${f.key}`); assert.ok(!seen.has(f.q)); seen.add(f.q); assert.ok(!home.includes(f.q) && !guide.includes(f.q), `${id}/${lang} FAQ copied: ${f.q}`) }
    const n = words(strings({ ...o, meta: undefined }).join(' '))
    assert.ok(n >= 400 && n <= 900, `${id}/${lang} ${n} words`)
  }
})

test('OCC-6. price and trial limit come from plans.ts: no figure typed in a text, no list price, no wording the product does not have', () => {
  for (const { id, lang } of published()) {
    const all = strings(D[lang].occasions[id]).join('\n')
    assert.doesNotMatch(all, /€|\$|\b\d+[.,]\d{2}\b/, `${id}/${lang}: a price must be {price}`)
    assert.doesNotMatch(all, /39[.,]99|invece di|instead of|au lieu de|en lugar de|listino|list price|barrat|strikethrough|sconto|discount|remise|descuento|-\s?50 ?%/i, `${id}/${lang}: no struck-through price or discount`)
    assert.doesNotMatch(all, MIOLOVE_FORBIDDEN_COPY, `${id}/${lang}`)
    assert.doesNotMatch(all, /12 mesi|12 months|12 mois|illimitat[oi] nel tempo|per sempre|forever|à vie|para siempre|garantit|guarante|garantiz/i, `${id}/${lang}: no promise the product does not keep`)
    assert.match(all, /\{price\}/, `${id}/${lang} shows the price`); assert.match(all, /\{trialLimit\}/, `${id}/${lang} states the trial limit`)
    const placeholders = new Set(all.match(/\{\w+\}/g)); for (const p of placeholders) assert.ok(['{price}', '{trialLimit}'].includes(p), `${id}/${lang} unknown ${p}`)
    const filled = occasionFaq(id, lang).map((f) => f.q + f.a).join(' ') + occasionText(D[lang].occasions[id].price.text, lang)
    assert.doesNotMatch(filled, /\{\w+\}/, 'every placeholder is filled'); assert.ok(filled.includes(formatAlbumPrice(lang)) && filled.includes(String(TRIAL_MEDIA_LIMIT)))
  }
  assert.match(formatAlbumPrice('it'), /19,99/); assert.equal(ALBUM_PRICING.current.eur, 19.99)
  assert.match(occasionText('{price}', 'en'), /\$19\.99/)
})

test('OCC-7. structured data: WebPage + BreadcrumbList + FAQPage, FAQ identical to the visible one; no rating, no review, no offer', () => {
  for (const { id, lang } of published()) {
    const sd = mioloveOccasionStructuredData(id, lang), g = sd['@graph'] as any[], url = `${ORIGIN}${plannedPagePath(id, lang)}`
    assert.deepEqual(g.map((n) => n['@type']), ['WebPage', 'BreadcrumbList', 'FAQPage'])
    assert.equal(g[0].url, url); assert.equal(g[0].inLanguage, LANG_META[lang].hreflang)
    assert.deepEqual(g[1].itemListElement.map((i: any) => i.item), [lang === 'it' ? `${ORIGIN}/` : `${ORIGIN}/${LANG_META[lang].prefix}`, url])
    assert.deepEqual(g[2].mainEntity.map((q: any) => [q.name, q.acceptedAnswer.text]), occasionFaq(id, lang).map((f) => [f.q, f.a]))
    assert.doesNotMatch(JSON.stringify(sd), /aggregateRating|"Review"|"Offer"|"price"/)
    JSON.parse(JSON.stringify(sd))
  }
})

test('OCC-8. not copied from the home or the guide: little repeated text between pages of the same language', () => {
  const grams = (s: string) => { const w = s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean), out = new Set<string>(); for (let i = 0; i + 4 <= w.length; i++) out.add(w.slice(i, i + 4).join(' ')); return out }
  const overlap = (a: Set<string>, b: Set<string>) => { let n = 0; for (const g of a) if (b.has(g)) n++; return n / Math.max(1, Math.min(a.size, b.size)) }
  for (const { id, lang } of published()) {
    const mine = grams(strings({ ...D[lang].occasions[id], meta: undefined }).join(' '))
    const others: Array<[string, any]> = [['home', D[lang].home], ['ideas', D[lang].ideas], ...OCCASION_IDS.filter((o) => o !== id && D[lang].occasions?.[o]).map((o): [string, any] => [o, D[lang].occasions[o]])]
    for (const [name, o] of others) assert.ok(overlap(mine, grams(strings(o).join(' '))) < 0.12, `${id}/${lang} repeats ${name}`)
  }
})

test('OCC-9. the route refuses what is not published (other portal, other language, other occasion) and the component hard-codes no price', () => {
  const page = src('app/matrimonio/page.tsx')
  assert.match(page, /isPublished\('wedding'/); assert.match(page, /notFound\(\)/); assert.match(page, /config\.id === 'miolove'/)
  const comp = src('components/miolove/occasion/MioloveOccasion.tsx')
  assert.doesNotMatch(comp, /€|\$\{?\d|19[.,]99|39[.,]99|<s[ >]|line-through/)
  assert.match(comp, /isPublished\(o,/, 'only published occasions are linked')
  assert.match(src('lib/miolove/messages.ts'), /PUBLIC_ONLY_NAMESPACES = \['home', 'ideas', 'occasions'\]/)
  for (const id of PAGE_IDS) assert.ok(PAGES[id].route.startsWith('/'))
})
