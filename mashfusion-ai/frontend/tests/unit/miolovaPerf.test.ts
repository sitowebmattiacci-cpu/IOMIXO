import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { DEMO_PHOTOS, DEMO_WIDTHS, demoFallbackSrc, demoSrcSet } from '../../lib/miolove/demoMedia'
import { WEDDING_BRAND_LOGO, WEDDING_BRAND_LOGO_OPT } from '../../lib/brand/wedding'

const PUBLIC = join(__dirname, '../../public')
const onDisk = (url: string) => join(PUBLIC, url.split('?')[0])
const urls = (srcset: string) => srcset.split(',').map((c) => c.trim().split(/\s+/))   // [[url, '540w'], ...]

test('PERF-1. every demo photo has its AVIF and WebP copies at every width, and the browser never gets less than the standard widths', () => {
  for (const [name, photo] of Object.entries(DEMO_PHOTOS)) {
    for (const ext of ['avif', 'webp'] as const) {
      const set = urls(demoSrcSet(photo, ext))
      assert.ok(set.length >= DEMO_WIDTHS.length, `${name} ${ext}`)
      for (const [url, w] of set) {
        assert.ok(existsSync(onDisk(url)), `${url} missing: run scripts/optimize-miolove-images.mjs`)
        assert.match(w, /^\d+w$/); assert.ok(statSync(onDisk(url)).size < 400 * 1024, `${url} is ${(statSync(onDisk(url)).size / 1024).toFixed(0)} KB`)
      }
      assert.ok(set.some(([, w]) => w === `${photo.width}w`) || photo.width <= DEMO_WIDTHS[DEMO_WIDTHS.length - 1], `${name}: native width offered`)
    }
    assert.ok(existsSync(onDisk(demoFallbackSrc(photo))), `${name} fallback`)
    assert.ok(existsSync(onDisk(photo.src)), `${name} original PNG stays as the source`)
  }
})
test('PERF-2. the optimised copies are a small fraction of the originals (a visitor never downloads a 2 MB PNG)', () => {
  for (const photo of Object.values(DEMO_PHOTOS)) {
    const png = statSync(onDisk(photo.src)).size, widest = Math.max(...urls(demoSrcSet(photo, 'avif')).map(([u]) => statSync(onDisk(u)).size))
    assert.ok(widest < png / 8, `${photo.src}: widest AVIF ${widest} vs PNG ${png}`)
  }
})
test('PERF-3. logo: a cropped lossless WebP (1060 px and 636 px) exists for every variant and is lighter than the PNG canvas', () => {
  for (const v of Object.keys(WEDDING_BRAND_LOGO) as (keyof typeof WEDDING_BRAND_LOGO)[]) {
    const stem = WEDDING_BRAND_LOGO_OPT[v], full = onDisk(`${stem}.webp`), small = onDisk(`${stem}-636.webp`)
    assert.ok(existsSync(full) && existsSync(small), v)
    assert.ok(statSync(small).size < statSync(full).size && statSync(full).size < statSync(onDisk(WEDDING_BRAND_LOGO[v])).size, `${v} sizes`)
  }
})
test('PERF-4. next.config: only the new MIOLOVE image folders get a cache header (security headers and the rest are untouched)', async () => {
  const cfg = createRequire(__filename)('../../next.config.js')
  const rules: { source: string; headers: { key: string; value: string }[] }[] = await cfg.headers()
  const cached = rules.filter((r) => r.headers.some((h) => h.key === 'Cache-Control'))
  assert.deepEqual(cached.map((r) => r.source).sort(), ['/brand/miolove/opt/:path*', '/demo/miolove/opt/:path*'])
  for (const r of cached) assert.match(r.headers.find((h) => h.key === 'Cache-Control')!.value, /^public, max-age=\d+, stale-while-revalidate=\d+$/)
  const all = rules.find((r) => r.source === '/(.*)')!; assert.ok(all.headers.some((h) => h.key === 'X-Frame-Options') && !all.headers.some((h) => h.key === 'Cache-Control'))
})
