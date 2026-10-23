import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SCREEN_BACKGROUNDS, SCREEN_BACKGROUND_IDS, resolveScreenBackground, isScreenBackgroundId } from '../../lib/miolove/screenBackgrounds'

const PUBLIC = join(__dirname, '../../public')

test('SB1. the six presets, in order, with unique stable ids', () => {
  assert.deepEqual([...SCREEN_BACKGROUND_IDS], ['default', 'romantic_pink_bokeh', 'ethereal_pastel_light', 'botanical_green_mist', 'violet_light_ribbons', 'dreamy_champagne_glow'])
  assert.deepEqual(SCREEN_BACKGROUNDS.map((b) => b.id), [...SCREEN_BACKGROUND_IDS])
})

test('SB2. missing / unknown / malformed theme falls back to default', () => {
  for (const cfg of [undefined, null, {}, { backgroundTheme: undefined }, { backgroundTheme: 'nope' }, { backgroundTheme: 5 }, { backgroundTheme: '../x' }, 'str', []]) assert.equal(resolveScreenBackground(cfg).id, 'default', JSON.stringify(cfg))
  assert.equal(resolveScreenBackground({ backgroundTheme: 'violet_light_ribbons' }).id, 'violet_light_ribbons')
  assert.equal(isScreenBackgroundId('romantic_pink_bokeh'), true); assert.equal(isScreenBackgroundId('x'), false)
})

test('SB3. every preset asset + preview exists, is small, and is stored once; default has none', () => {
  for (const b of SCREEN_BACKGROUNDS) {
    if (b.id === 'default') { assert.equal(b.asset, null); assert.equal(b.overlay, null); continue }
    for (const [f, max] of [[b.asset, 150_000], [b.preview, 10_000]] as const) {
      assert.ok(f && existsSync(join(PUBLIC, f)), `${b.id}: ${f}`); assert.ok(statSync(join(PUBLIC, f!)).size < max, `${b.id} ${f} too heavy`)
    }
    assert.ok(b.overlay, `${b.id} needs a readability overlay`)
  }
})

test('SB4. the server whitelist equals the client list', () => {
  const src = readFileSync(join(__dirname, '../../../../firebase/functions/src/owner/config.ts'), 'utf8')
  const m = /SCREEN_BACKGROUND_THEMES = \[([^\]]+)\]/.exec(src); assert.ok(m)
  assert.deepEqual(m![1].split(',').map((x) => x.trim().replace(/'/g, '')), [...SCREEN_BACKGROUND_IDS])
})
