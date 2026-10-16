import { test } from 'node:test'
import assert from 'node:assert/strict'
import it from '../../locales/it.json'
import en from '../../locales/en.json'
import es from '../../locales/es.json'
import fr from '../../locales/fr.json'
import { OCCASIONS, COUPLE_DEFAULT_GUEST_CONFIG, firstNameOf, suggestAlbumName, albumNamePlaceholder } from '../../lib/coupleAlbum'

const dict = (d: any) => (path: string, fallback?: string): string => {
  const v = path.split('.').reduce<any>((a, k) => (a != null ? a[k] : undefined), d)
  return typeof v === 'string' ? v : fallback ?? path
}
const tIt = dict(it)

test('first name: first word of the account name, e-mail local part as a fallback, empty when there is neither', () => {
  assert.equal(firstNameOf('Anna e Marco'), 'Anna'); assert.equal(firstNameOf('  Enrico Rossi '), 'Enrico')
  assert.equal(firstNameOf(null, 'giulia.verdi@example.com'), 'giulia.verdi'); assert.equal(firstNameOf('', ''), ''); assert.equal(firstNameOf(undefined), '')
})

test('album name suggestion per occasion; baptism is never filled with the account holder\'s name', () => {
  assert.equal(suggestAlbumName('wedding', 'Enrico', tIt), 'Matrimonio di Enrico')
  assert.equal(suggestAlbumName('birthday', 'Enrico', tIt), 'Compleanno di Enrico')
  assert.equal(suggestAlbumName('baptism', 'Enrico', tIt), '')
  assert.equal(suggestAlbumName('other', 'Enrico', tIt), 'Il mio evento')
  assert.equal(suggestAlbumName('wedding', '', tIt), 'Il nostro matrimonio'); assert.equal(suggestAlbumName('birthday', '', tIt), 'Il mio compleanno')
  assert.equal(albumNamePlaceholder('baptism', tIt), 'Battesimo di [nome]'); assert.equal(albumNamePlaceholder('wedding', tIt), 'Matrimonio di Enrico')
})

test('the Sposi default guest config: no song requests (DJ only), photo entry point on', () => {
  assert.deepEqual({ ...COUPLE_DEFAULT_GUEST_CONFIG }, { requests: false, live_booth: true })
})

test('onboarding copy exists in IT / EN / ES / FR (no missing key falls back silently) and uses only the four supported languages', () => {
  const flat = (o: any, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v ? flat(v, `${p}${k}.`) : [`${p}${k}`]))
  const base = flat((it as any).onboarding).sort()
  for (const [name, d] of Object.entries({ en, es, fr })) assert.deepEqual(flat((d as any).onboarding).sort(), base, `${name} onboarding keys`)
  for (const o of OCCASIONS) assert.ok((it as any).onboarding.occasion[o], o)
})
