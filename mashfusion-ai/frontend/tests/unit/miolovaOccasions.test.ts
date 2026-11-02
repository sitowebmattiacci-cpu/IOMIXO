import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { middleware } from '../../middleware'
import { MIOLOVE_FULL } from '../../lib/miolove/fullMessages'
import { LANG_META, LIVE_LANGS } from '../../lib/miolove/langs'
import { OCCASION_IDS, PAGES, PAGE_IDS, plannedPagePath, publishedLangs, resolvePublicPath, type OccasionId } from '../../lib/miolove/pages'
import { MIOLOVE_FORBIDDEN_COPY, ALBUM_PRICING, GUEST_UPLOAD_CAP, TRIAL_MEDIA_LIMIT, formatAlbumPrice } from '../../lib/miolove/plans'
import { MEDIA_LIMITS } from '../../lib/media/mediaTypes'
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

test('OCC-1. registry: the three occasions have a route and a slug per language; only the wedding page is published (it, en, fr, es), the rest answer 404 and are in no sitemap', () => {
  assert.deepEqual([...OCCASION_IDS], ['wedding', 'birthday', 'baptism'])
  assert.deepEqual(OCCASION_IDS.map((id) => PAGES[id].route), ['/matrimonio', '/compleanno', '/battesimo'])
  for (const id of OCCASION_IDS) assert.equal(Object.keys(PAGES[id].slugs).length, 12, `${id} has a provisional slug per language`)
  assert.equal(published().length, 12, '3 occasions × 4 languages')
  const URLS = { wedding: ['/matrimonio', '/en/wedding', '/fr/mariage', '/es/boda'], birthday: ['/compleanno', '/en/birthday', '/fr/anniversaire', '/es/cumpleanos'], baptism: ['/battesimo', '/en/christening', '/fr/bapteme', '/es/bautizo'] } as const
  for (const id of OCCASION_IDS) assert.deepEqual(['it', 'en', 'fr', 'es'].map((l) => plannedPagePath(id, l as any)), URLS[id], `${id}: the 12 URLs (Spanish: the singular)`)
  assert.equal(new Set(OCCASION_IDS.flatMap((id) => URLS[id])).size, 12)
  assert.equal(resolvePublicPath('/matrimonio')?.page, 'wedding')
  for (const p of ['/es/bodas', '/en/baptism', '/en/baptisms', '/es/cumpleaños', '/de/hochzeit', '/de/geburtstag', '/pt-br/casamento', '/en/weddings', '/fr/mariages', '/es/quinceaneras']) assert.equal(resolvePublicPath(p), null, `${p} is not published`)
  const urls = miolovePublicUrls()
  assert.ok(urls.includes(`${ORIGIN}/matrimonio`)); assert.ok(!urls.some((u) => /\/bodas|baptism|hochzeit|geburtstag|taufe|casamento|quince/.test(u)))
  for (const id of OCCASION_IDS) for (const p of URLS[id]) assert.ok(urls.includes(`${ORIGIN}${p}`), p)
  assert.equal(new Set(urls).size, urls.length)
  for (const u of urls) assert.equal(mioloveRobotsHeader(new URL(u).pathname), null, `${u} is indexable`)
})

test('OCC-2. middleware: the published occasion URL is rewritten/served with its language; unpublished ones are not routed (404); a client header never decides', () => {
  assert.deepEqual(call('/matrimonio'), { rewrite: null, lang: 'it' })
  assert.deepEqual(call('/matrimonio/'), { rewrite: null, lang: 'it' })
  assert.deepEqual(call('/matrimonio', { 'x-ml-lang': 'en' }), { rewrite: null, lang: 'it' })
  for (const [p, lang] of [['/en/wedding', 'en'], ['/fr/mariage', 'fr'], ['/es/boda', 'es']]) assert.deepEqual(call(p, { 'x-ml-lang': 'it' }), { rewrite: '/matrimonio', lang }, p)
  for (const p of ['/es/bodas', '/en/baptism', '/es/quinceaneras', '/de/hochzeit']) assert.deepEqual(call(p, { 'x-ml-lang': 'en' }), { rewrite: null, lang: null }, p)
})

test('OCC-3. hreflang and canonical: a page lists only the languages it is published in, self-referencing, x-default = Italian', () => {
  assert.deepEqual(pageAlternates('wedding'), { it: `${ORIGIN}/matrimonio`, en: `${ORIGIN}/en/wedding`, fr: `${ORIGIN}/fr/mariage`, es: `${ORIGIN}/es/boda`, 'x-default': `${ORIGIN}/matrimonio` })
  for (const { id, lang } of published()) {
    const m = mioloveOccasionMetadata(id, lang) as any
    assert.equal(m.alternates.canonical, `${ORIGIN}${plannedPagePath(id, lang)}`)
    assert.deepEqual(m.robots, { index: true, follow: true })
    assert.deepEqual(m.openGraph.alternateLocale, publishedLangs(id).filter((l) => l !== lang).map((l) => LANG_META[l].og), 'og:locale:alternate lists only languages the page exists in')
    assert.equal(m.openGraph.url, m.alternates.canonical); assert.equal(m.openGraph.locale, LANG_META[lang].og)
    for (const l of publishedLangs(id)) assert.equal(m.alternates.languages[LANG_META[l].hreflang], `${ORIGIN}${plannedPagePath(id, l)}`)
  }
  assert.throws(() => mioloveOccasionMetadata('wedding', 'de'), /not published/)
  assert.throws(() => mioloveOccasionMetadata('birthday', 'de'), /not published/)
  assert.throws(() => mioloveOccasionStructuredData('baptism', 'pt-BR' as any), /not published/)
})

test('OCC-3b. social preview: a dedicated 1200×630 card per occasion, light enough for any crawler, used by Open Graph and Twitter', () => {
  for (const id of OCCASION_IDS) {
    const f = `public/demo/miolove/opt/og-${id}.jpg`, bytes = readFileSync(new URL(`../../${f}`, import.meta.url))
    assert.ok(bytes.length < 200 * 1024, `${f} ${bytes.length} bytes`); assert.deepEqual([bytes[0], bytes[1]], [0xff, 0xd8], 'a JPEG')
    let h = 0, w = 0; for (let i = 2; i + 9 < bytes.length; ) { if (bytes[i] !== 0xff) { i++; continue } const m = bytes[i + 1]; if (m >= 0xc0 && m <= 0xc3) { h = bytes.readUInt16BE(i + 5); w = bytes.readUInt16BE(i + 7); break } i += 2 + bytes.readUInt16BE(i + 2) }
    assert.deepEqual([w, h], [1200, 630], f)
    for (const { lang } of published().filter((p) => p.id === id)) {
      const m = mioloveOccasionMetadata(id, lang) as any
      assert.equal(m.openGraph.images[0].url, `${ORIGIN}/${f.replace('public/', '')}`); assert.equal(m.twitter.card, 'summary_large_image'); assert.deepEqual([m.openGraph.images[0].width, m.openGraph.images[0].height], [1200, 630])
    }
  }
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

test('OCC-5. one H1 text, 4–6 own FAQ, 400–1100 words of content; FAQ unique and not copied from the home or the guide', () => {
  for (const { id, lang } of published()) {
    const o = D[lang].occasions[id]
    assert.ok(o.hero.titleA.length > 8 && o.hero.titleB.length > 4, `${id}/${lang} H1`)
    const faq = occasionFaq(id, lang)
    assert.ok(faq.length >= 4 && faq.length <= 6, `${id}/${lang} ${faq.length} FAQ`)
    const home = Object.values(D[lang].home.faq).map((f: any) => f?.q).filter(Boolean), guide = Object.values(D[lang].ideas.faq).map((f: any) => f?.q).filter(Boolean)
    const seen = new Set<string>()
    for (const f of faq) { assert.ok(f.q.endsWith('?') && f.a.length > 60, `${id}/${lang} ${f.key}`); assert.ok(!seen.has(f.q)); seen.add(f.q); assert.ok(!home.includes(f.q) && !guide.includes(f.q), `${id}/${lang} FAQ copied: ${f.q}`) }
    const n = words(strings({ ...o, meta: undefined }).join(' '))
    assert.ok(n >= 400 && n <= 1100, `${id}/${lang} ${n} words`)
  }
})

test('OCC-6. price and trial limit come from plans.ts: no figure typed in a text, no list price, no wording the product does not have', () => {
  for (const { id, lang } of published()) {
    const all = strings(D[lang].occasions[id]).join('\n')
    assert.doesNotMatch(all, /€|\$|\b\d+[.,]\d{2}\b/, `${id}/${lang}: a price must be {price}`)
    assert.doesNotMatch(all, /39[.,]99|listino|list price|barrat|strikethrough|sconto|discount|remise|descuento|-\s?50 ?%/i, `${id}/${lang}: no struck-through price or discount`)
    assert.doesNotMatch(all, MIOLOVE_FORBIDDEN_COPY, `${id}/${lang}`)
    assert.doesNotMatch(all, /12 mesi|12 months|12 mois|illimitat[oi] nel tempo|per sempre|forever|à vie|para siempre|garantit|guarante|garantiz/i, `${id}/${lang}: no promise the product does not keep`)
    assert.match(all, /\{price\}/, `${id}/${lang} shows the price`); assert.match(all, /\{trialLimit\}/, `${id}/${lang} states the trial limit`)
    const placeholders = new Set(all.match(/\{\w+\}/g)); for (const p of placeholders) assert.ok(['{price}', '{trialLimit}', '{guestCap}', '{videoMax}', '{photoMax}'].includes(p), `${id}/${lang} unknown ${p}`)
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

// What may legitimately repeat between occasion pages is the product's facts (no app, trial, ZIP, 365 days, price block, CTA). What must differ is the editorial
// part: why this occasion needs an album, the moments, the questions and their answers (the four steps describe the same product flow, so they share verbs: they are not measured).
const editorial = (o: any) => ({ sub: o.hero.sub, why: o.why, moments: o.moments, faq: o.faq })
const grams = (s: string, n = 4) => { const w = s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean), out = new Set<string>(); for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' ')); return out }
const overlap = (a: Set<string>, b: Set<string>) => { let n = 0; for (const g of a) if (b.has(g)) n++; return n / Math.max(1, Math.min(a.size, b.size)) }
const bag = (o: any) => new Set(strings(o).join(' ').toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 5))
const jaccard = (a: Set<string>, b: Set<string>) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n) }

test('OCC-8. not copied from the home, the guide or from each other: the editorial text of every page is its own (repeated phrases AND shared vocabulary stay low)', () => {
  for (const { id, lang } of published()) {
    const mine = editorial(D[lang].occasions[id])
    for (const [name, o] of [['home', D[lang].home], ['ideas', D[lang].ideas]] as Array<[string, any]>) assert.ok(overlap(grams(strings(mine).join(' ')), grams(strings(o).join(' '))) < 0.1, `${id}/${lang} repeats ${name}`)
    for (const other of OCCASION_IDS.filter((o) => o !== id)) {
      const theirs = editorial(D[lang].occasions[other])
      assert.ok(overlap(grams(strings(mine).join(' ')), grams(strings(theirs).join(' '))) < 0.08, `${id}/${lang} repeats ${other} (4-word phrases)`)
      assert.ok(overlap(grams(strings(mine).join(' '), 3), grams(strings(theirs).join(' '), 3)) < 0.14, `${id}/${lang} repeats ${other} (3-word phrases)`)
      assert.ok(jaccard(bag(mine), bag(theirs)) < 0.3, `${id}/${lang} shares too much vocabulary with ${other}`)
    }
  }
})

test('OCC-8b. each occasion talks about its own situations (not the wedding with a word changed): occasion-specific terms are present, and absent from the other pages', () => {
  const SPECIFIC: Record<OccasionId, Record<string, RegExp>> = {
    wedding: { it: /tableau|ricevimento|sposi|promesse/i, en: /reception|photographer|newlyweds|recessional/i, fr: /vin d’honneur|mairie|mariés|promesses/i, es: /banquete|novios|recepción|luna de miel/i },
    birthday: { it: /torta|diciottesimo|a sorpresa|bambini/i, en: /cake|18th|surprise|kids/i, fr: /gâteau|18 ans|surprise|goûter/i, es: /pastel|15 años|sorpresa|infantil/i },
    baptism: { it: /parroco|nonni|bomboniere|battesimo/i, en: /christening|godparents|grandparents|priest/i, fr: /baptême|parrain|grands-parents|dragées/i, es: /bautizo|abuelos|padrinos|sacerdote|iglesia/i },
  }
  for (const { id, lang } of published()) {
    const mine = strings(editorial(D[lang].occasions[id])).join(' ')
    assert.match(mine, SPECIFIC[id][lang], `${id}/${lang} has its own situations`)
    for (const o of OCCASION_IDS.filter((x) => x !== id)) { const m = mine.match(SPECIFIC[o][lang]); if (id !== 'wedding' && o === 'wedding') assert.equal(m, null, `${id}/${lang} reads like the wedding page: "${m?.[0]}"`) }
  }
})

test('OCC-8c. limits and promises are the product\'s: no "unlimited" wording, the per-guest cap equals the server\'s, sizes come from the media limits', () => {
  const fnSrc = readFileSync(new URL('../../../../firebase/functions/src/photos/photos.ts', import.meta.url), 'utf8')
  assert.equal(Number(/MIOLOVE_PHOTO_POLICY = \{[^}]*maxPerGuest: (\d+)/.exec(fnSrc)![1]), GUEST_UPLOAD_CAP, 'GUEST_UPLOAD_CAP mirrors the Cloud Function')
  assert.equal(MEDIA_LIMITS.videoBytes / 1048576, 150); assert.equal(MEDIA_LIMITS.photoOriginalBytes / 1048576, 50)
  for (const { id, lang } of published()) {
    const all = strings(D[lang].occasions[id]).join('\n')
    assert.doesNotMatch(all, /illimitat|unlimited|illimité|ilimitad|infinit|per sempre|forever|à vie|para siempre/i, `${id}/${lang}: say the real limit, not "unlimited"`)
    assert.doesNotMatch(all, /\b(150|500)\b| 50 ?MB/, `${id}/${lang}: figures come from the configuration`)
    assert.doesNotMatch(all, /originali? .*(sempre|garantit)/i)
  }
  assert.equal(occasionText('{guestCap} {videoMax} {photoMax}', 'it'), '500 150 50')
})

test('OCC-9. the route refuses what is not published (other portal, other language, other occasion) and the component hard-codes no price', () => {
  const route = src('components/miolove/occasion/occasionRoute.tsx')
  assert.match(route, /isPublished\(id, l\)/); assert.match(route, /notFound\(\)/); assert.match(route, /config\.id === 'miolove'/)
  for (const [dir, id] of [['matrimonio', 'wedding'], ['compleanno', 'birthday'], ['battesimo', 'baptism']]) {
    const page = src(`app/${dir}/page.tsx`)
    assert.match(page, new RegExp(`occasionPage\\('${id}'\\)`)); assert.match(page, new RegExp(`occasionMetadata\\('${id}'\\)`)); assert.ok(page.split('\n').length < 8, `${dir} is a thin route`)
    assert.equal(PAGES[id as OccasionId].route, `/${dir}`)
  }
  const comp = src('components/miolove/occasion/MioloveOccasion.tsx')
  assert.doesNotMatch(comp, /€|\$\{?\d|19[.,]99|39[.,]99|<s[ >]|line-through/)
  assert.match(comp, /isPublished\(o,/, 'only published occasions are linked')
  assert.match(src('lib/miolove/messages.ts'), /PUBLIC_ONLY_NAMESPACES = \['home', 'ideas', 'occasions'\]/)
  for (const id of PAGE_IDS) assert.ok(PAGES[id].route.startsWith('/'))
})

test('OCC-10. each language is written for its own search: the H1 and the title carry that market\'s main keywords, and no sentence is left in another language', () => {
  const KEYS: Record<OccasionId, Record<string, { h1: RegExp[]; title: RegExp[] }>> = {
    wedding: {
      it: { h1: [/album foto/i, /QR code/i, /matrimonio/i], title: [/album foto matrimonio/i, /QR code/i] },
      en: { h1: [/QR code/i, /photo album/i, /wedding/i], title: [/wedding photo album/i, /QR code/i] },
      fr: { h1: [/album photo/i, /mariage/i, /QR code/i], title: [/album photo de mariage/i, /QR code/i] },
      es: { h1: [/álbum de fotos/i, /código QR/i, /boda/i], title: [/álbum de fotos de boda/i, /código QR/i] } },
    birthday: {
      it: { h1: [/album foto/i, /QR code/i, /compleanno/i], title: [/album foto compleanno/i, /QR code/i] },
      en: { h1: [/birthday/i, /photo album/i, /QR code/i], title: [/birthday photo sharing/i, /QR code/i] },
      fr: { h1: [/album photo/i, /anniversaire/i, /QR code/i], title: [/album photo d’anniversaire/i, /QR code/i] },
      es: { h1: [/álbum de fotos/i, /código QR/i, /cumpleaños/i], title: [/álbum de fotos de cumpleaños/i, /código QR/i] } },
    baptism: {
      it: { h1: [/album foto/i, /QR code/i, /battesimo/i], title: [/album foto battesimo/i, /QR code/i] },
      en: { h1: [/christening/i, /photo album/i, /QR code/i], title: [/christening/i, /baptism/i, /photo album/i] },  // both words: the URL says christening, the search is split
      fr: { h1: [/album photo/i, /baptême/i, /QR code/i], title: [/album photo de baptême/i, /QR code/i] },
      es: { h1: [/álbum de fotos/i, /código QR/i, /bautizo/i], title: [/álbum de fotos de bautizo/i, /código QR/i] } },
  }
  for (const { id, lang } of published()) {
    const o = D[lang].occasions[id], h1 = `${o.hero.titleA} ${o.hero.titleB}`
    for (const r of KEYS[id][lang].h1) assert.match(h1, r, `${id}/${lang} H1`)
    for (const r of KEYS[id][lang].title) assert.match(o.meta.title, r, `${id}/${lang} title`)
    assert.match(o.meta.title, /MIOLOVE ALBUM/)
  }
  // the plan's own names per language, never the Italian ones
  assert.match(D.en.occasions.wedding.price.text + D.en.occasions.wedding.steps.s2.d, /Full album/); assert.doesNotMatch(JSON.stringify(D.en.occasions), /Album completo|Matrimonio/)
  assert.match(JSON.stringify(D.fr.occasions), /Album complet/); assert.match(JSON.stringify(D.es.occasions), /Álbum completo/)
  // one canonical Spanish URL: the singular; the plural was never published and is not linked anywhere
  assert.equal(PAGES.wedding.slugs.es, 'boda'); assert.doesNotMatch(JSON.stringify(D), /\/es\/bodas/)
  // French typography: a space (non-breaking) before ? ! : ; and inside guillemets
  const fr = JSON.stringify(D.fr.occasions);   assert.doesNotMatch(fr, /« | »|[\wé’][?!:;]/, 'guillemets and punctuation use a non-breaking space')
  // Spanish: neutral, tú, video / teléfono (the peninsular words are pinned in ML-SEO-3 for the whole file)
  assert.doesNotMatch(JSON.stringify(D.es.occasions), /vídeo|móvil|vosotros|vuestr|ordenador|coger|hacen fotos|celular/i)
})

test('OCC-11. no orphan pages: the home, the guide and the footer link to the occasion pages through plain <a href> (published ones only), and every page links to its siblings and back to the guide', () => {
  const home = src('components/miolove/home/MioloveHome.tsx'), ideas = src('components/miolove/ideas/MioloveIdeas.tsx'), occ = src('components/miolove/occasion/MioloveOccasion.tsx')
  assert.match(home, /isOccasionId\(k\) && isPublished\(k, locale/); assert.match(home, /href=\{pagePath\(k, locale\)\}/, 'home: occasion cards')
  assert.match(home, /OCCASION_IDS\.filter\(\(o\) => isPublished\(o, locale[^)]*\)\)\.map\(\(o\) => <a [^>]*href=\{pagePath\(o, locale\)\}/, 'footer: one link per published occasion')
  assert.match(ideas, /isOccasionId\(o\) && isPublished\(o, locale/); assert.match(ideas, /href=\{pagePath\(o, locale\)\}/, 'guide: occasion blocks')
  assert.match(occ, /href=\{`\$\{ideasPath\(locale\)\}#\$\{occasion\}`\}/, 'occasion → guide section'); assert.match(occ, /others\.map/, 'occasion → its siblings')
  // the guide's anchors exist for the three occasions
  for (const o of OCCASION_IDS) assert.ok(JSON.stringify(D.it.ideas.occasions[o]).length > 20)
  for (const lang of ['it', 'en', 'fr', 'es']) assert.ok(D[lang].occasions.common.seeOccasion.length > 10)
})

// The texts of the home, the guide and the service pages are what production (479804e) serves, EXCEPT the one deliberate commercial edit authorised on 2026-11-02:
// `home.faq.q4` lost its parenthesis with the crossed-out list price (the hash of `home` was re-pinned for that edit alone; ideas / servicePages are still the production ones). Pinned by
// hash (key-sorted JSON), so a bulk find-and-replace on a locale file cannot silently rewrite them.
const BASE_HASHES: Record<string, Record<string, string>> = {"it": {"home": "1210b0f80f32eb46", "ideas": "1e56cd0e7fc139cf", "servicePages": "991c6198dcd6327a"}, "en": {"home": "da818ee9f66c3c66", "ideas": "23545dd962cfdd0f", "servicePages": "d9d6b17e940b039d"}, "fr": {"home": "e512fef3645e0a57", "ideas": "062a38ec8dc147b8", "servicePages": "87ad2c33959729d1"}, "es": {"home": "e58598450b49af9d", "ideas": "e47411ba939ab3f3", "servicePages": "205799dab8940767"}}
test('OCC-12. home, guide and service-page texts are byte-for-byte the production ones in the four languages (no regression of the existing pages)', () => {
  const sorted = (o: any): any => (Array.isArray(o) ? o.map(sorted) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sorted(o[k])])) : o)
  for (const lang of ['it', 'en', 'fr', 'es']) for (const ns of ['home', 'ideas', 'servicePages']) {
    const h = createHash('sha256').update(JSON.stringify(sorted(D[lang][ns]))).digest('hex').slice(0, 16)
    assert.equal(h, BASE_HASHES[lang][ns], `${lang}.${ns} changed`)
  }
})
