import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Pre-launch SEO copy: snippet-safe lengths in every published language and a Spanish that reads naturally in Latin America (and in Spain) — one neutral Spanish, no peninsular-only words.
const read = (p: string) => JSON.parse(readFileSync(new URL(`../../locales/miolove/${p}`, import.meta.url), 'utf8'))
const LANGS = ['it', 'en', 'fr', 'es'] as const

test('ML-SEO-1. home and guide: title ≤ 60, description 120–160 characters, brand in the home title, no price or subscription wording, every field distinct per page', () => {
  for (const l of LANGS) {
    const d = read(`public/${l}.json`), seen = new Set<string>()
    for (const page of ['home', 'ideas'] as const) {
      const m = d[page].meta as { title: string; description: string; ogTitle: string }
      assert.ok(m.title.length >= 25 && m.title.length <= 60, `${l} ${page} title ${m.title.length}`)
      assert.ok(m.description.length >= 120 && m.description.length <= 160, `${l} ${page} description ${m.description.length}`)
      assert.ok(m.ogTitle.length <= 80, `${l} ${page} og:title ${m.ogTitle.length}`)
      if (page === 'home') assert.match(m.title, /MIOLOVE ALBUM/)
      assert.doesNotMatch(`${m.title} ${m.description}`, /€|\$|abbonament|subscription|abonnement|suscripci/i)
      for (const v of [m.title, m.description]) { assert.ok(!seen.has(v), `${l} duplicate meta`); seen.add(v) }
    }
  }
})

test('ML-SEO-2. the home title carries the search intent of the language (album + QR + wedding/party words)', () => {
  const need: Record<(typeof LANGS)[number], RegExp> = { it: /album.*QR.*matrimoni/i, en: /wedding.*album.*QR/i, fr: /album.*QR.*mariage/i, es: /álbum.*QR.*bodas/i }
  for (const l of LANGS) assert.match(read(`public/${l}.json`).home.meta.title, need[l], l)
})

test('ML-SEO-3. Spanish for Latin America: no peninsular-only wording in the MIOLOVE Spanish texts (video, teléfono, tomar fotos; tú, never vosotros)', () => {
  const es = JSON.stringify([read('es.json'), read('public/es.json')])
  assert.doesNotMatch(es, /vídeo|móvil|\bvosotros\b|\bvuestr[oa]s?\b|ordenador|\bcoger\b|\bcogéis\b|\bhacen fotos\b|\bhagan fotos\b|\bHaz una foto\b|\bhacerse una foto\b|\bpodéis\b|\btenéis\b|\bsubid\b/i)
})
