import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIOLOVE_FULL } from '../../lib/miolove/fullMessages'
const { it, en, fr, es } = MIOLOVE_FULL
import {
  ALBUM_INCLUDED, ALBUM_PRICE_EUR, ALBUM_PRICING, formatAlbumListPrice, FEATURE_STATUS, TRIAL_EXCLUDED, TRIAL_INCLUDED, formatAlbumPrice, visibleItems, MIOLOVE_FORBIDDEN_COPY,
  type FeatureId,
} from '../../lib/miolove/plans'
import { albumStatus } from '../../lib/miolove/albumStatus'
import { DEMO_REVIEWS, reviewsToShow } from '../../lib/miolove/reviews'
import { asOccasionType, occasionText } from '../../lib/occasion'
import { mioloveHomeMetadata, mioloveStructuredData, MIOLOVE_DISALLOW, miolovePublicUrls } from '../../lib/miolove/seo'
import { mioloveRobotsHeader } from '../../lib/miolove/indexing'
import { PAGES, type PageId } from '../../lib/miolove/pages'
import { screenShowsPhotos, composeScreenPayload } from '../../lib/events/screenModel'

const D: Record<string, any> = { it, en, fr, es }
const leaves = (o: any, p = ''): string[] => (typeof o === 'object' && o ? Object.entries(o).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k)) : [p])
const get = (o: any, path: string) => path.split('.').reduce((a, k) => a?.[k], o)

test('PRICING. one price: €19.99 once; formats per language; never monthly', () => {
  assert.equal(ALBUM_PRICE_EUR, 19.99)
  assert.deepEqual(['it', 'en', 'fr', 'es'].map((l) => formatAlbumPrice(l)), ['€19,99', '$19.99', '19,99 €', '19,99 €'])
  assert.deepEqual(['it', 'en', 'fr', 'es'].map((l) => formatAlbumListPrice(l)), ['€39,99', '$39.99', '39,99 €', '39,99 €'])
  assert.ok(ALBUM_PRICING.list.eur > ALBUM_PRICING.current.eur && ALBUM_PRICING.list.usd > ALBUM_PRICING.current.usd, 'the struck-through price is the higher one')
  assert.equal(formatAlbumPrice('en-GB'), '$19.99', 'any English locale string → dollars')
})

test('PRICING. only features that really exist are shown (planned ones are skipped), nothing references a missing feature', () => {
  const shown = [...visibleItems(TRIAL_INCLUDED), ...visibleItems(TRIAL_EXCLUDED), ...visibleItems(ALBUM_INCLUDED)]
  for (const i of shown) if (i.feature) assert.equal(FEATURE_STATUS[i.feature], 'available', i.key)
  const keys = shown.map((i) => i.key)
  // The media engine and the per-album retention (365 days, daily purge) have shipped: their lines are shown.
  for (const shippedKey of ['months12Upload', 'months12Storage']) assert.ok(keys.includes(shippedKey), `${shippedKey} is implemented`)
  for (const f of ['video', 'originalQuality', 'downloadAll', 'months12'] as const) assert.equal(FEATURE_STATUS[f], 'available', f)
  assert.ok(keys.includes('trialQuotaMedia') && keys.includes('albumMedia') && keys.includes('originalQuality') && keys.includes('downloadAll') && keys.includes('noDownloadAll'))
  assert.ok(!keys.includes('trialQuotaPhotos') && !keys.includes('albumMediaPhotos'), 'the "photos only" wording is replaced once video exists')
  assert.ok(keys.includes('poster') && keys.includes('noBrand'))
  // flipping a status makes the page follow
  const photosOnly = { ...FEATURE_STATUS, video: 'planned' } as Record<FeatureId, 'available' | 'planned'>
  const k1 = visibleItems(ALBUM_INCLUDED, photosOnly).map((i) => i.key)
  assert.ok(k1.includes('albumMediaPhotos') && !k1.includes('albumMedia'))
  const all = Object.fromEntries(Object.keys(FEATURE_STATUS).map((k) => [k, 'available'])) as Record<FeatureId, 'available'>
  const k2 = visibleItems(ALBUM_INCLUDED, all).map((i) => i.key)
  assert.ok(k2.includes('albumMedia') && !k2.includes('albumMediaPhotos') && k2.includes('downloadAll') && k2.includes('months12Storage'))
})

test('COPY. the four languages have the same MIOLOVE keys; every plan item has a text; no IOMIXO / Event Pass / monthly wording outside the reassurances', () => {
  // Occasion-page texts (occasions.<id>.*) exist in a language once that page is published there; the shared labels (occasions.common.*) once any of them is.
  const forLang = (l: string) => leaves(it).filter((k) => { const m = /^occasions\.(\w+)\./.exec(k); return !m || (m[1] === 'common' ? (['wedding', 'birthday', 'baptism'] as PageId[]).some((id) => (PAGES[id].langs as readonly string[]).includes(l)) : (PAGES[m[1] as PageId]?.langs as readonly string[] | undefined)?.includes(l)) }).sort()
  for (const l of ['en', 'fr', 'es']) assert.deepEqual(leaves(D[l]).sort(), forLang(l), `${l} keys differ from it`)
  for (const l of Object.keys(D)) {
    for (const i of [...TRIAL_INCLUDED, ...TRIAL_EXCLUDED, ...ALBUM_INCLUDED]) assert.ok(get(D[l], `albumPlan.f.${i.key}`), `${l} ${i.key}`)
    const copy = { ...D[l], albumPlan: { ...D[l].albumPlan, oneTime: '', notMonthly: '', notPerGuest: '', noSubscription: '', noUpgrade: '' }, albumAuth: undefined }
    for (const path of leaves(copy)) {
      const v = String(get(copy, path) ?? '')
      if (path.startsWith('home.faq.')) continue                       // the FAQ explains "not a subscription / not monthly" on purpose
      assert.doesNotMatch(v, MIOLOVE_FORBIDDEN_COPY, `${l} ${path}: "${v}"`)
    }
    for (const k of ['home.hero.titleA', 'home.hero.titleB']) assert.ok(get(D[l], k))
  }
  assert.equal(it.home.hero.titleA + ' ' + it.home.hero.titleB, 'I tuoi ricordi, raccontati da chi li vive.')
})

test('REVIEWS. production never shows invented reviews; development shows demo ones flagged as demo; real ones always win', () => {
  assert.deepEqual(reviewsToShow({ production: true, forceDemo: false }), { items: [], demo: false })
  const dev = reviewsToShow({ production: false, forceDemo: false })
  assert.equal(dev.demo, true); assert.ok(dev.items.length > 0 && dev.items.every((r) => r.placeholder))
  assert.equal(reviewsToShow({ production: true, forceDemo: true }).demo, true)
  const real = { ...DEMO_REVIEWS[0], id: 'r1', placeholder: false }
  assert.deepEqual(reviewsToShow({ production: true, forceDemo: false }, [real]), { items: [real], demo: false })
  assert.deepEqual(reviewsToShow({ production: false, forceDemo: true }, [{ ...real, placeholder: true }]), { items: DEMO_REVIEWS, demo: true }, 'a flagged placeholder is never promoted to a real review')
})

test('OCCASION. every occasion has its own labels in all languages; "Nomi degli sposi" only for a wedding; unknown = wedding', () => {
  assert.equal(asOccasionType(undefined), 'wedding'); assert.equal(asOccasionType('funeral'), 'wedding')
  const t = (l: string) => (p: string) => String(get(D[l], p) ?? p)
  assert.equal(occasionText(t('it'), 'wedding', 'namesLabel'), 'Nomi degli sposi')
  assert.equal(occasionText(t('it'), 'birthday', 'namesLabel'), 'Nome del festeggiato/a')
  assert.equal(occasionText(t('it'), 'baptism', 'namesLabel'), 'Nome del bambino/a')
  assert.equal(occasionText(t('it'), 'other', 'namesLabel'), 'Nome da mostrare')
  for (const l of Object.keys(D)) for (const o of ['birthday', 'baptism', 'other']) for (const k of ['namesLabel', 'namesDesc', 'boothIntro', 'frameTitle', 'homeSubtitle', 'photoTitle', 'namesPlaceholder']) {
    assert.doesNotMatch(String(get(D[l], `occasion.${o}.${k}`)), /spos|matrimon|wedding|mari|boda|novi|nozze|just married/i, `${l} ${o}.${k}`)
  }
  for (const l of Object.keys(D)) assert.ok(get(D[l], 'onboarding.eyebrow.wedding'), `${l} wedding eyebrow`)
})

test('TRIAL. an album\'s state comes from ITS OWN server marks: trial / trial paused / pending / active / expired / none', () => {
  const now = Date.parse('2026-10-19T12:00:00Z')
  assert.equal(albumStatus(null, now), null)
  assert.deepEqual(albumStatus({ access_mode: 'trial', trial_expires_at: '2026-10-22T12:00:00Z', trial_photo_count: 4, trial_photo_limit: 50 }, now),
    { kind: 'trial', daysLeft: 3, until: '2026-10-22T12:00:00Z', used: 4, limit: 50, canActivate: true })
  const ended = albumStatus({ access_mode: 'trial', trial_expires_at: '2026-10-19T11:00:00Z' }, now)!
  assert.deepEqual([ended.kind, ended.canActivate, ended.daysLeft], ['trialEnded', true, 30], 'paused, 30 days left to recover it')
  assert.equal(albumStatus({ access_mode: 'trial', trial_expires_at: '2026-09-01T00:00:00Z' }, now)!.canActivate, false, 'recovery window over: no longer purchasable')
  assert.equal(albumStatus({ access_mode: 'trial' }, now)!.kind, 'trial', 'an older trial without an end date is open')
  assert.deepEqual([albumStatus({ access_mode: 'pending' }, now)!.kind, albumStatus({ access_mode: 'pending' }, now)!.canActivate], ['pending', true])
  const active = albumStatus({ access_mode: 'activated', expires_at: '2027-10-19T12:00:00Z' }, now)!
  assert.deepEqual([active.kind, active.daysLeft, active.canActivate], ['active', 365, false])
  assert.equal(albumStatus({ access_mode: 'activated', expires_at: '2026-10-19T12:00:00Z' }, now)!.kind, 'expired')
  assert.equal(albumStatus({ access_mode: 'activated' }, now)!.kind, 'active', 'paid before the expiry field existed: stays active')
  assert.equal(albumStatus({}, now), null, 'an unknown mode is never active')
})

test('SEO. title, description, canonical, hreflang for IT/EN/FR/ES, OpenGraph, Twitter, structured data (no reviews), robots', () => {
  const m = mioloveHomeMetadata('en') as any
  assert.match(String(m.title.absolute), /MIOLOVE ALBUM/); assert.ok(m.description.length > 60)
  assert.equal(m.alternates.canonical, 'https://miolovealbum.com/en')
  assert.deepEqual(Object.keys(m.alternates.languages).sort(), ['en', 'es', 'fr', 'it', 'x-default'])
  assert.equal(m.alternates.languages.it, 'https://miolovealbum.com/'); assert.equal(m.openGraph.locale, 'en_GB'); assert.equal(m.twitter.card, 'summary')
  const g = mioloveStructuredData('it')['@graph']
  assert.deepEqual(g.map((x: any) => x['@type']), ['Organization', 'WebSite', 'SoftwareApplication'])
  assert.deepEqual(g[2].offers.map((o: any) => o.price), ['0', '19.99']); assert.doesNotMatch(JSON.stringify(g), /aggregateRating|review/i)
  for (const p of ['/live/x', '/booth/x', '/screen/x', '/sessions', '/billing']) assert.match(String(mioloveRobotsHeader(p)), /noindex/, `${p} is noindex`)
  assert.deepEqual(MIOLOVE_DISALLOW, ['/api/'], 'noindex pages stay crawlable: robots.txt blocks only the API')
  assert.ok(miolovePublicUrls().every((u) => !/\/(live|booth|screen|sessions)\//.test(u)), 'no album in the sitemap')
})

test('SCREEN. a MIOLOVE album plays its photos by default; an explicit "off" is final; other events keep opt-in', () => {
  const album = { type: 'wedding' as const, accessMode: 'trial' as const }
  assert.equal(screenShowsPhotos(album, {}), true); assert.equal(screenShowsPhotos(album, { show_photos: false }), false)
  assert.equal(screenShowsPhotos(album, { show_photos: true }), true, 'switched back ON')
  assert.equal(screenShowsPhotos({ type: 'wedding', accessMode: null }, {}), false); assert.equal(screenShowsPhotos({ type: 'party', accessMode: null }, { show_photos: true }), true)
  const ev: any = { ...album, title: 'T', djName: null, coupleNames: null, weddingDate: null, venueName: null, status: 'live' }
  const p = composeScreenPayload(ev, {}, null, undefined, null, { photos: [{ id: 'a' } as any] })
  assert.equal(p.photos.length, 1)
})

test('DEMO. every demo picture of the home exists on disk and the sample event has the same photos everywhere', async () => {
  const { existsSync } = await import('node:fs'), { join } = await import('node:path')
  const { DEMO_EVENT, OCCASION_COVERS } = await import('../../lib/miolove/demoMedia')
  assert.equal(DEMO_EVENT.photos.length, 4)
  const alts = (l: string) => Object.keys(get(D[l], 'home.demoAlt')); for (const l of Object.keys(D)) for (const p of [...DEMO_EVENT.photos, ...Object.values(OCCASION_COVERS)]) assert.ok(get(D[l], p.altKey), `${l} alt ${p.altKey}`); void alts
  for (const p of [...DEMO_EVENT.photos, ...Object.values(OCCASION_COVERS)]) assert.ok(existsSync(join(__dirname, '../../public', p.src)), p.src)
  assert.deepEqual(Object.keys(OCCASION_COVERS).sort(), ['baptism', 'birthday', 'other', 'wedding'])
})

test('CONTACT. the public MIOLOVE address is info@miolovealbum.com; no iomixo address in the MIOLOVE texts', () => {
  for (const l of Object.keys(D)) for (const path of leaves(D[l])) assert.doesNotMatch(String(get(D[l], path) ?? ''), /@iomixo\.(com|ai)/i, `${l} ${path}`)
})
