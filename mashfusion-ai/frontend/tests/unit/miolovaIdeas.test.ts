import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIOLOVE_FULL } from '../../lib/miolove/fullMessages'
const { it, en, fr, es } = MIOLOVE_FULL
import { MIOLOVE_FORBIDDEN_COPY } from '../../lib/miolove/plans'
import { GUEST_NAME_MAX, cleanGuestName, displayGuestName, loadGuestName, saveGuestName } from '../../lib/media/guestName'
import { IDEAS, IDEA_OCCASIONS, IDEAS_BY_OCCASION, FAQ_KEYS } from '../../lib/miolove/ideas'
import { IDEAS_PATH, HOME_PATH, ideasLangOfPath, ideasPath, homePath } from '../../lib/miolove/paths'
import { mioloveIdeasMetadata, mioloveIdeasStructuredData, miolovePublicUrls, ideasUrl, SEO_LANGUAGES } from '../../lib/miolove/seo'
import { OCCASION_COVERS, DEMO_PHOTOS } from '../../lib/miolove/demoMedia'
import { exportFileName } from '../../../../firebase/functions/src/photos/media'
import { parseRequestExportInput, MAX_SELECTION } from '../../../../firebase/functions/src/photos/exports'
import { parseCreatePhotoUploadInput, PHOTO_LIMITS } from '../../../../firebase/functions/src/photos/photos'

const D: Record<string, any> = { it, en, fr, es }
const LANGS = ['it', 'en', 'fr', 'es'] as const
const leaves = (o: any, p = ''): string[] => (typeof o === 'object' && o ? Object.entries(o).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k)) : [p])
const get = (o: any, path: string) => path.split('.').reduce((a, k) => a?.[k], o)

// ── Guest name ──
test('NAME-1. cleanGuestName: trim, collapse, strip control chars, max 40 characters, empty → undefined', () => {
  assert.equal(cleanGuestName('  Giulia  '), 'Giulia'); assert.equal(cleanGuestName('Zia   Pina\n'), 'Zia Pina')
  assert.equal(cleanGuestName(''), undefined); assert.equal(cleanGuestName('   '), undefined); assert.equal(cleanGuestName(undefined), undefined); assert.equal(cleanGuestName(42), undefined)
  assert.equal(cleanGuestName('a'.repeat(100))!.length, GUEST_NAME_MAX); assert.equal(GUEST_NAME_MAX, 40)
  assert.equal(cleanGuestName('Zoë \u0007 Ré'), 'Zoë Ré')
  assert.equal(Array.from(cleanGuestName('🎉'.repeat(60))!).length, 40, 'cut by characters, never in the middle of an emoji')
})
test('NAME-2. displayGuestName: a name, or the localized "Anonimo" for empty / legacy media (null, undefined, blank)', () => {
  assert.equal(displayGuestName('Marco', 'Anonimo'), 'Marco')
  for (const legacy of [null, undefined, '', '   ']) assert.equal(displayGuestName(legacy as any, 'Anonimo'), 'Anonimo')
  for (const l of LANGS) assert.ok(get(D[l], 'weddingPanels.anonymous') ?? true)
})
test('NAME-3. the remembered name is per event: event A never inherits the name of event B; it can be changed and cleared', () => {
  const store = new Map<string, string>()
  ;(globalThis as any).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } }
  try {
    assert.equal(loadGuestName('evento-a'), '')
    saveGuestName('evento-a', '  Anna ')
    assert.equal(loadGuestName('evento-a'), 'Anna'); assert.equal(loadGuestName('evento-b'), '', 'another event starts empty')
    saveGuestName('evento-b', 'Luca'); assert.equal(loadGuestName('evento-a'), 'Anna'); assert.equal(loadGuestName('evento-b'), 'Luca')
    saveGuestName('evento-a', 'Anna Maria'); assert.equal(loadGuestName('evento-a'), 'Anna Maria')
    saveGuestName('evento-a', '   '); assert.equal(loadGuestName('evento-a'), '', 'clearing forgets it'); assert.equal(loadGuestName('evento-b'), 'Luca')
  } finally { delete (globalThis as any).window }
  // private mode / blocked storage: never throws
  ;(globalThis as any).window = { localStorage: { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } } }
  try { assert.equal(loadGuestName('x'), ''); saveGuestName('x', 'Anna') } finally { delete (globalThis as any).window }
})
test('NAME-4. server: guestName is optional, trimmed, max 40 (a 41st character is refused); absent → null', () => {
  const base = { eventId: 'ev1', ext: 'jpg', source: 'guest_upload', size: 1000 }
  assert.equal(PHOTO_LIMITS.guestName, 40)
  assert.equal(parseCreatePhotoUploadInput({ ...base }).guestName, null)
  assert.equal(parseCreatePhotoUploadInput({ ...base, guestName: '  Giulia ' }).guestName, 'Giulia')
  assert.equal(parseCreatePhotoUploadInput({ ...base, guestName: 'a'.repeat(40) }).guestName, 'a'.repeat(40))
  assert.throws(() => parseCreatePhotoUploadInput({ ...base, guestName: 'a'.repeat(41) }))
})
test('NAME-5. the field is localized in IT/EN/FR/ES', () => {
  for (const l of LANGS) for (const k of ['nameLabel', 'namePlaceholder', 'nameHint']) assert.ok(String(get(D[l], `media.guest.${k}`)).length > 3, `${l} ${k}`)
  assert.match(D.it.media.guest.nameLabel, /facoltativo/i)
})

// ── Export ──
test('ZIP-1. exportFileName: ASCII, readable, never empty, never a path', () => {
  assert.equal(exportFileName('Matrimonio di Anna & Marco'), 'matrimonio-di-anna-marco-miolove-originals.zip')
  assert.equal(exportFileName('Compleanno di Zoë'), 'compleanno-di-zoe-miolove-originals.zip')
  for (const bad of [undefined, null, '', '   ', '../../etc/passwd', '日本語']) assert.match(exportFileName(bad), /^([a-z0-9-]+-)?miolove-originals\.zip$/)
  assert.equal(exportFileName(''), 'miolove-originals.zip'); assert.ok(exportFileName('x'.repeat(300)).length < 80)
})

// ── Home photos ──
test('PHOTOS. Matrimonio = lively dancing party (not the old embrace); Altro evento = a generic party photo, never a wedding one', () => {
  assert.equal(OCCASION_COVERS.wedding.src, '/demo/miolove/wedding-party.png'); assert.notEqual(OCCASION_COVERS.wedding.src, '/demo/miolove/wedding-ceremony.png')
  assert.equal(OCCASION_COVERS.other.src, '/demo/miolove/party-friends.png'); assert.doesNotMatch(OCCASION_COVERS.other.src, /wedding|bride|ceremony/i)
  assert.equal(OCCASION_COVERS.other, DEMO_PHOTOS.partyFriends); assert.deepEqual([OCCASION_COVERS.other.width, OCCASION_COVERS.other.height], [1448, 1086])
  for (const l of LANGS) assert.doesNotMatch(String(get(D[l], OCCASION_COVERS.other.altKey)), /spos|bride|groom|wedding|mari[ée]|novi|boda|matrimon|veil|velo|voile|cerem|cérémonie|ceremonia/i, `${l} alt of the generic party`)
  assert.equal(new Set(Object.values(OCCASION_COVERS).map((p) => p.src)).size, 4, 'four different covers')
})

// ── Ideas guide ──
test('IDEAS-1. 10 ideas, each with title / text / when / why / difficulty / occasions in all four languages', () => {
  assert.equal(IDEAS.length, 10); assert.equal(new Set(IDEAS.map((i) => i.id)).size, 10)
  for (const l of LANGS) for (const i of IDEAS) for (const k of ['title', 'text', 'when', 'why']) assert.ok(String(get(D[l], `ideas.items.${i.id}.${k}`)).length > 8, `${l} ${i.id}.${k}`)
  for (const l of LANGS) for (const k of ['easy', 'medium', 'difficulty', 'when', 'why']) assert.ok(get(D[l], `ideas.list.${k}`), `${l} list.${k}`)
  for (const i of IDEAS) { assert.ok(['easy', 'medium'].includes(i.difficulty)); assert.ok(i.occasions.length >= 1) }
  for (const id of ['hunt', 'tables', 'beforeAfter', 'colour', 'generations', 'details', 'emoji', 'angle', 'candid', 'keepsake']) assert.ok(IDEAS.some((i) => i.id === id), id)
})
test('IDEAS-2. every occasion (Matrimonio, Compleanno, Battesimo, Altro evento) has its block and at least 3 ideas', () => {
  assert.deepEqual([...IDEA_OCCASIONS], ['wedding', 'birthday', 'baptism', 'other'])
  for (const o of IDEA_OCCASIONS) { assert.ok(IDEAS_BY_OCCASION(o).length >= 3, o); for (const l of LANGS) for (const k of ['title', 'text', 'tip']) assert.ok(String(get(D[l], `ideas.occasions.${o}.${k}`)).length > 8, `${l} ${o}.${k}`) }
})
test('IDEAS-3. the four dictionaries have exactly the same keys under ideas.*, no empty values, no IOMIXO address / product words', () => {
  const ref = leaves(it.ideas).sort()
  for (const l of LANGS) {
    assert.deepEqual(leaves(D[l].ideas).sort(), ref, `${l} keys`)
    for (const p of leaves(D[l].ideas)) { const v = String(get(D[l].ideas, p)); assert.ok(v.trim().length > 0, `${l} ${p} empty`); assert.doesNotMatch(v, MIOLOVE_FORBIDDEN_COPY, `${l} ${p}`); assert.doesNotMatch(v, /@iomixo\./i, `${l} ${p}`) }
  }
  for (const k of FAQ_KEYS) for (const l of LANGS) assert.ok(get(D[l], `ideas.faq.${k}.q`) && get(D[l], `ideas.faq.${k}.a`), `${l} ${k}`)
})
test('IDEAS-4. localized public URLs: /idee, /en/ideas, /fr/idees, /es/ideas (trailing slash ok); other paths are not the guide', () => {
  assert.deepEqual(IDEAS_PATH, { it: '/idee', en: '/en/ideas', fr: '/fr/idees', es: '/es/ideas' })
  for (const [l, p] of Object.entries(IDEAS_PATH)) { assert.equal(ideasLangOfPath(p), l); assert.equal(ideasLangOfPath(`${p}/`), l); assert.equal(ideasPath(l), p) }
  for (const bad of ['/', '/en', '/en/idee', '/idee/x', '/ideas', '/fr/ideas']) assert.equal(ideasLangOfPath(bad), null, bad)
  assert.equal(ideasPath('xx'), '/idee'); assert.equal(homePath('en'), HOME_PATH.en)
})
test('IDEAS-5. SEO: one canonical + hreflang per language, sensible title / description lengths, structured data = visible text, in the sitemap', () => {
  for (const l of SEO_LANGUAGES) {
    const m = mioloveIdeasMetadata(l) as any, d = D[l].ideas.meta
    assert.equal(m.alternates.canonical, ideasUrl(l)); assert.deepEqual(Object.keys(m.alternates.languages).sort(), ['en', 'es', 'fr', 'it', 'x-default'])
    assert.equal(m.alternates.languages['x-default'], 'https://miolovealbum.com/idee')
    assert.ok(d.title.length >= 30 && d.title.length <= 65, `${l} title ${d.title.length}`); assert.ok(d.description.length >= 100 && d.description.length <= 165, `${l} description ${d.description.length}`)
    const g = mioloveIdeasStructuredData(l)['@graph'] as any[]
    assert.deepEqual(g.map((x) => x['@type']), ['Article', 'BreadcrumbList', 'ItemList', 'FAQPage'])
    assert.equal(g[2].itemListElement.length, 10); assert.equal(g[3].mainEntity.length, FAQ_KEYS.length)
    assert.ok(miolovePublicUrls().includes(ideasUrl(l)), `${l} in the sitemap`)
  }
  assert.equal(ideasUrl('it'), 'https://miolovealbum.com/idee'); assert.equal(ideasUrl('fr'), 'https://miolovealbum.com/fr/idees')
})
test('IDEAS-6. the guide targets the intents naturally (no keyword stuffing: each key phrase at most twice in the title + description)', () => {
  const intents: Record<string, RegExp> = { it: /giochi fotografici/i, en: /photo games?/i, fr: /jeux photo/i, es: /juegos de fotos/i }
  for (const l of LANGS) {
    const meta = `${D[l].ideas.meta.title} ${D[l].ideas.meta.description}`
    assert.match(meta, intents[l]); assert.ok((meta.match(new RegExp(intents[l].source, 'gi')) ?? []).length <= 2, `${l} repeats its key phrase`)
    assert.match(meta, /QR/); assert.ok(/matrimon|wedding|mariage|boda/i.test(meta), l); assert.ok(/complean|birthday|anniversaire|cumplea/i.test(meta), l)
  }
})

test('ZIP-2. selection archive name and mediaIds parsing: dedupe, cap, no empty list, no non-ids', () => {
  assert.equal(exportFileName('Festa di Lia', true), 'festa-di-lia-miolove-selezione.zip'); assert.equal(exportFileName('Festa di Lia'), 'festa-di-lia-miolove-originals.zip')
  assert.deepEqual(parseRequestExportInput({ eventId: 'e1' }), { eventId: 'e1' })
  assert.deepEqual(parseRequestExportInput({ eventId: 'e1', mediaIds: ['a', 'b', 'a'] }), { eventId: 'e1', mediaIds: ['a', 'b'] })
  assert.throws(() => parseRequestExportInput({ eventId: 'e1', mediaIds: [] })); assert.throws(() => parseRequestExportInput({ eventId: 'e1', mediaIds: 'a' }))
  assert.throws(() => parseRequestExportInput({ eventId: 'e1', mediaIds: ['events/x/photos/y/original.jpg'] }))
  assert.throws(() => parseRequestExportInput({ eventId: 'e1', mediaIds: Array.from({ length: MAX_SELECTION + 1 }, (_, i) => `m${i}`) }))
})
