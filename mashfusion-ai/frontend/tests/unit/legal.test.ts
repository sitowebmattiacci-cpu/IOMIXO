import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRIVACY } from '../../lib/legal/privacy'
import { TERMS } from '../../lib/legal/terms'
import { LEGAL_DATE, PRIVACY_EMAIL, TERMS_EMAIL, legalEmail, type LegalDoc, type LegalVars } from '../../lib/legal/types'

const LOCALES = ['it', 'en', 'es', 'fr'] as const
const vars = (miolove: boolean): LegalVars => ({ miolove, brand: miolove ? 'MIOLOVE ALBUM' : 'IOMIXO Live Hub', name: miolove ? 'MIOLOVE ALBUM' : 'IOMIXO', short: miolove ? 'MIOLOVE' : 'IOMIXO' })
const texts = (d: LegalDoc) => [d.lead, ...d.sections.flatMap((s) => [s.title, ...s.blocks.flatMap((b) => ('ul' in b ? b.ul : [b.p]))])]
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

for (const [kind, builders, sections] of [['privacy', PRIVACY, 10], ['terms', TERMS, 16]] as const) {
  for (const miolove of [false, true]) {
    test(`LG1. ${kind} (${miolove ? 'MIOLOVE' : 'IOMIXO'}): IT / ES / FR have the same structure, links and emphasis as the English text, and are really translated`, () => {
      const en = builders.en(vars(miolove))
      assert.equal(en.sections.length, sections)
      for (const l of LOCALES) {
        const d = builders[l](vars(miolove))
        assert.equal(d.sections.length, sections, `${l} sections`)
        d.sections.forEach((s, i) => {
          assert.match(s.title, new RegExp(`^${i + 1}\\. \\S`), `${l} numbering`)
          assert.deepEqual(s.blocks.map((b) => ('ul' in b ? `ul${b.ul.length}` : 'p')), en.sections[i].blocks.map((b) => ('ul' in b ? `ul${b.ul.length}` : 'p')), `${l} section ${i + 1} shape`)
        })
        const a = texts(en), b = texts(d); assert.equal(b.length, a.length, `${l} blocks`)
        b.forEach((t, i) => {
          assert.equal(count(t, /\*\*/g), count(a[i], /\*\*/g), `${l} #${i} emphasis`); assert.equal(count(t, /\{\{mail\}\}/g), count(a[i], /\{\{mail\}\}/g), `${l} #${i} mail`)
          assert.equal(count(t, /\{\{privacy:[^}]+\}\}/g), count(a[i], /\{\{privacy:[^}]+\}\}/g), `${l} #${i} privacy link`); assert.doesNotMatch(t, /undefined|\bnull\b|\[object/, `${l} #${i}`)
          if (l !== 'en' && a[i].length > 40) assert.notEqual(t, a[i], `${l} #${i} is translated`)
        })
      }
    })
    test(`LG2. ${kind} (${miolove ? 'MIOLOVE' : 'IOMIXO'}): domain-aware branding in every language, never the other portal's brand`, () => {
      for (const l of LOCALES) {
        const all = texts(builders[l](vars(miolove))).join('\n')
        assert.match(all, miolove ? /MIOLOVE/ : /IOMIXO/, `${l} brand`); assert.doesNotMatch(all, miolove ? /IOMIXO/ : /MIOLOVE/, `${l} no foreign brand`)
        assert.doesNotMatch(all, /iomixo\.com|@/, `${l}: addresses only through the {{mail}} placeholder`)
      }
    })
  }
}

test('LG3. shared legal addresses and per-language dates', () => {
  assert.equal(PRIVACY_EMAIL, 'privacy@iomixo.com'); assert.equal(TERMS_EMAIL, 'legal@iomixo.com')
  assert.equal(legalEmail('privacy', true), 'info@miolovealbum.com'); assert.equal(legalEmail('terms', true), 'info@miolovealbum.com'); assert.equal(legalEmail('terms', false), 'legal@iomixo.com')
  assert.deepEqual(Object.keys(LEGAL_DATE).sort(), ['en', 'es', 'fr', 'it']); assert.equal(LEGAL_DATE.en, 'October 16, 2026')
})

test('LG4. the substance of the clauses survives translation (figures, jurisdiction, providers, regions)', () => {
  for (const l of LOCALES) {
    const t = texts(TERMS[l](vars(true))).join('\n'), p = texts(PRIVACY[l](vars(false))).join('\n')
    for (const needle of ['16', '14', '12']) assert.ok(t.includes(needle), `${l} terms ${needle}`)
    assert.match(t, /ital/i); assert.match(p, /europe-west1/); assert.match(p, /europe-west4/); assert.match(p, /Stripe/); assert.match(p, /GDPR|RGPD/); assert.ok(p.includes('30'), `${l} 30 days`)
  }
})
