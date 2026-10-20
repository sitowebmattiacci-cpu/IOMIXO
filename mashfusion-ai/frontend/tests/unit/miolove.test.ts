import { test } from 'node:test'
import assert from 'node:assert/strict'
import it from '../../locales/miolove/it.json'
import en from '../../locales/miolove/en.json'
import fr from '../../locales/miolove/fr.json'
import es from '../../locales/miolove/es.json'
import {
  ALBUM_INCLUDED, ALBUM_PRICE_EUR, FEATURE_STATUS, TRIAL_EXCLUDED, TRIAL_INCLUDED, albumPlanState, formatAlbumPrice, visibleItems, MIOLOVE_FORBIDDEN_COPY,
  type FeatureId,
} from '../../lib/miolove/plans'
import { DEMO_REVIEWS, reviewsToShow } from '../../lib/miolove/reviews'
import { asOccasionType, occasionText } from '../../lib/occasion'
import { mioloveHomeMetadata, mioloveStructuredData, MIOLOVE_DISALLOW, miolovePublicUrls } from '../../lib/miolove/seo'
import { screenShowsPhotos, composeScreenPayload } from '../../lib/events/screenModel'

const D: Record<string, any> = { it, en, fr, es }
const leaves = (o: any, p = ''): string[] => (typeof o === 'object' && o ? Object.entries(o).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k)) : [p])
const get = (o: any, path: string) => path.split('.').reduce((a, k) => a?.[k], o)

test('PRICING. one price: €19.99 once; formats per language; never monthly', () => {
  assert.equal(ALBUM_PRICE_EUR, 19.99)
  assert.deepEqual(['it', 'en', 'fr', 'es'].map((l) => formatAlbumPrice(l)), ['€19,99', '€19.99', '19,99 €', '19,99 €'])
})

test('PRICING. only features that really exist are shown (planned ones are skipped), nothing references a missing feature', () => {
  const shown = [...visibleItems(TRIAL_INCLUDED), ...visibleItems(TRIAL_EXCLUDED), ...visibleItems(ALBUM_INCLUDED)]
  for (const i of shown) if (i.feature) assert.equal(FEATURE_STATUS[i.feature], 'available', i.key)
  const keys = shown.map((i) => i.key)
  for (const planned of ['trialQuotaMedia', 'albumMedia', 'months12Upload', 'months12Storage', 'originalQuality', 'downloadAll', 'noDownloadAll']) assert.ok(!keys.includes(planned), `${planned} must stay hidden until implemented`)
  assert.ok(keys.includes('trialQuotaPhotos') && keys.includes('albumMediaPhotos') && keys.includes('poster') && keys.includes('noBrand'))
  // flipping a status makes the page follow
  const all = Object.fromEntries(Object.keys(FEATURE_STATUS).map((k) => [k, 'available'])) as Record<FeatureId, 'available'>
  const k2 = visibleItems(ALBUM_INCLUDED, all).map((i) => i.key)
  assert.ok(k2.includes('albumMedia') && !k2.includes('albumMediaPhotos') && k2.includes('downloadAll'))
})

test('COPY. the four languages have the same MIOLOVE keys; every plan item has a text; no IOMIXO / Event Pass / monthly wording outside the reassurances', () => {
  const ref = leaves(it).sort()
  for (const l of ['en', 'fr', 'es']) assert.deepEqual(leaves(D[l]).sort(), ref, `${l} keys differ from it`)
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

test('TRIAL. plan state comes from the server marks: open / ended / active / none', () => {
  const now = Date.parse('2026-10-19T12:00:00Z')
  assert.equal(albumPlanState(null, now).kind, 'none')
  assert.equal(albumPlanState({ access_mode: 'activated' }, now).kind, 'active')
  assert.deepEqual(albumPlanState({ access_mode: 'trial', trial_expires_at: '2026-10-22T12:00:00Z', trial_photo_count: 4, trial_photo_limit: 50 }, now), { kind: 'trial', daysLeft: 3, used: 4, limit: 50 })
  assert.equal(albumPlanState({ access_mode: 'trial', trial_expires_at: '2026-10-19T11:00:00Z' }, now).kind, 'trialEnded')
  assert.equal(albumPlanState({ access_mode: 'trial' }, now).kind, 'trial', 'an older trial without an end date is open')
  assert.equal(albumPlanState({}, now).kind, 'none', 'an unknown mode is never active')
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
  for (const p of ['/live/', '/booth/', '/screen/', '/sessions', '/billing']) assert.ok(MIOLOVE_DISALLOW.includes(p))
  assert.ok(miolovePublicUrls().every((u) => !/\/(live|booth|screen|sessions)\//.test(u)), 'no album in the sitemap')
})

test('SCREEN. a MIOLOVE album plays its photos by default; an explicit "off" is final; other events keep opt-in', () => {
  const album = { type: 'wedding' as const, accessMode: 'trial' as const }
  assert.equal(screenShowsPhotos(album, {}), true); assert.equal(screenShowsPhotos(album, { show_photos: false }), false)
  assert.equal(screenShowsPhotos({ type: 'wedding', accessMode: null }, {}), false); assert.equal(screenShowsPhotos({ type: 'party', accessMode: null }, { show_photos: true }), true)
  const ev: any = { ...album, title: 'T', djName: null, coupleNames: null, weddingDate: null, venueName: null, status: 'live' }
  const p = composeScreenPayload(ev, {}, null, undefined, null, { photos: [{ id: 'a' } as any] })
  assert.equal(p.photos.length, 1)
})
