import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MIOLOVE_FULL } from '../../lib/miolove/fullMessages'
import * as plans from '../../lib/miolove/plans'
import { ALBUM_PRICING, GUEST_UPLOAD_CAP, formatAlbumPrice } from '../../lib/miolove/plans'
import { occasionText } from '../../lib/miolove/occasions'

// Commercial claims of the MIOLOVE pages: one real price (no list price, no crossed-out amount) and no "unlimited" wording that the technical limits contradict.
const fe = join(__dirname, '..', '..')
const D: Record<string, any> = MIOLOVE_FULL
const LANGS = ['it', 'en', 'fr', 'es'] as const
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'node_modules' || n === '.next' ? [] : walk(p)) : /\.(tsx?|json)$/.test(n) ? [p] : [] })
const leaves = (o: any, p = ''): Array<[string, string]> => (typeof o === 'string' ? [[p, o]] : o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k)) : [])

test('COMM-1. only the real price exists: no list price in the configuration, the components or any of the four languages', () => {
  assert.ok(!('list' in ALBUM_PRICING)); assert.ok(!('formatAlbumListPrice' in plans)); assert.ok(!('ALBUM_LIST_PRICE_EUR' in plans))
  assert.deepEqual(LANGS.map((l) => formatAlbumPrice(l)), ['€19,99', '$19.99', '19,99 €', '19,99 €'])
  for (const f of [...walk(join(fe, 'components/miolove')), join(fe, 'lib/miolove/plans.ts')]) {
    const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.doesNotMatch(src, /<s[ >]|line-through|formatAlbumListPrice|ALBUM_LIST_PRICE|\{list\}/, `${f.slice(fe.length + 1)} shows or builds a crossed-out price`)
  }
  for (const l of LANGS) for (const [k, v] of leaves(D[l])) {
    assert.doesNotMatch(v, /\{list\}|39[.,]99|listino|list price|prix catalogue|precio de lista|invece di \{|au lieu de \{|instead of \{|en lugar de \{/i, `${l} ${k}`)
    assert.ok(!/^albumPlan\.listPrice$/.test(k), `${l}: the "list price" label is gone`)
  }
  // the FAQ about the price still says what it costs, once, with the real price
  for (const l of LANGS) { const a: string = D[l].home.faq.q4.a; assert.ok(a.includes('{price}') && a.includes('365')); assert.ok(!/\(.*\{price\}.*\)/.test(a)) }
})

test('COMM-2. content limits: no "unlimited photos / videos" wording; the plan says "no overall limit per album" and states the technical limits from the configuration', () => {
  for (const l of LANGS) {
    for (const k of ['albumMedia', 'albumMediaPhotos']) assert.doesNotMatch(D[l].albumPlan.f[k], /illimitat|unlimited|illimité|ilimitad/i, `${l} ${k}`)
    const note: string = D[l].albumPlan.limitsNote
    for (const ph of ['{guestCap}', '{videoMax}', '{photoMax}']) assert.ok(note.includes(ph), `${l} note has ${ph}`)
    assert.doesNotMatch(note, /\b\d{2,3}\b/, 'the figures are placeholders, never typed')
    assert.doesNotMatch(note, /storage|archivi|almacenamiento|stockage|GB|TB/i, 'no storage-capacity promise')
  }
  assert.equal(D.it.albumPlan.f.albumMedia, 'Foto e video senza limite complessivo per album')
  assert.equal(occasionText(D.it.albumPlan.limitsNote, 'it'), 'Nessun limite al numero di invitati né al totale dell’album. Per evitare abusi: fino a 500 contenuti per invitato, video fino a 150 MB, foto fino a 50 MB.')
  assert.equal(GUEST_UPLOAD_CAP, 500)
  // "Unlimited guests" stays: nothing in the Cloud Functions caps the number of guests of an album (only the per-guest anti-abuse cap)
  const fn = join(fe, '../../firebase/functions/src')
  for (const f of walk(fn)) assert.doesNotMatch(readFileSync(f, 'utf8'), /\b(maxGuests|MAX_GUESTS|guestLimit|maxEventGuests)\b/, `${f.slice(fn.length)}: a guest-count cap would make "unlimited guests" false`)
  for (const l of LANGS) assert.match(D[l].albumPlan.f.guests, /illimitat|unlimited|illimité|ilimitad/i)
})

test('COMM-3. the plan card renders the limits note and no crossed-out price (source check; the browser test pins the rendered text)', () => {
  const src = readFileSync(join(fe, 'components/miolove/PlanCards.tsx'), 'utf8')
  assert.match(src, /data-testid="album-limits-note"/); assert.match(src, /occasionText\(t\('albumPlan\.limitsNote'\), locale\)/); assert.doesNotMatch(src, /album-list-price/)
})
