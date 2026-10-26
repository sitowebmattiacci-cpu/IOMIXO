// Regenerates the optimised copies of the MIOLOVE home images (public/demo/miolove/opt/*, public/brand/miolove/opt/*). One-off tool, not part of the build:
//   npm i --no-save sharp && node scripts/optimize-miolove-images.mjs
// App Hosting does not run the Next.js image optimizer (/_next/image answers 404), so the optimised files are produced here and committed as static assets.
// The PNG originals stay untouched (they are the source of truth and the manifest in lib/miolove/demoMedia.ts still points at them).
import sharp from 'sharp'
import { readdir, mkdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'

const DEMO = 'public/demo/miolove', DEMO_OUT = join(DEMO, 'opt')
const LOGO_DIR = 'public/brand/miolove', LOGO_OUT = join(LOGO_DIR, 'opt')
const WIDTHS = [240, 360, 540, 828, 1086]               // keep in sync with DEMO_WIDTHS in lib/miolove/demoMedia.ts
const AVIF = { quality: 60, effort: 6 }, WEBP = { quality: 85, effort: 6 }
const LOGO_CROP = { left: 97, top: 453, width: 1060, height: 348 }   // WEDDING_BRAND_LOGO_CROP in lib/brand/wedding.ts

const kb = (n) => `${(n / 1024).toFixed(0)} KB`
const psnr = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d } return 10 * Math.log10((255 * 255) / (s / a.length || 1e-9)) }
let before = 0, after = 0
await mkdir(DEMO_OUT, { recursive: true }); await mkdir(LOGO_OUT, { recursive: true })

for (const f of (await readdir(DEMO)).filter((n) => n.endsWith('.png'))) {
  const name = basename(f, '.png'), src = join(DEMO, f), meta = await sharp(src).metadata()
  before += (await stat(src)).size
  const widths = [...WIDTHS, ...(meta.width > 1086 ? [meta.width] : [])]   // the landscape photo also gets its native 1448
  const line = []
  for (const w of widths) {
    const ref = await sharp(src).resize({ width: w }).removeAlpha().raw().toBuffer()
    for (const [ext, fmt, opts] of [['avif', 'avif', AVIF], ['webp', 'webp', WEBP]]) {
      const out = join(DEMO_OUT, `${name}-${w}.${ext}`)
      await sharp(src).resize({ width: w })[fmt](opts).toFile(out)
      const size = (await stat(out)).size; after += size
      if (w === 828) line.push(`${ext} ${kb(size)} PSNR ${psnr(ref, await sharp(out).removeAlpha().raw().toBuffer()).toFixed(1)} dB`)
    }
  }
  console.log(`${name.padEnd(24)} png ${kb((await stat(src)).size).padStart(7)} -> @828: ${line.join(' | ')}`)
}
// Logo: only the displayed area (the PNGs are 1254 px square canvases that are cropped by CSS), lossless so the artwork is pixel-identical.
for (const f of (await readdir(LOGO_DIR)).filter((n) => /^miolove-album-logo.*\.png$/.test(n))) {
  const out = join(LOGO_OUT, f.replace('.png', '.webp')), small = join(LOGO_OUT, f.replace('.png', '-636.webp')), src = join(LOGO_DIR, f)
  await sharp(src).extract(LOGO_CROP).webp({ lossless: true, effort: 6 }).toFile(out)
  await sharp(src).extract(LOGO_CROP).resize({ width: 636 }).webp({ lossless: true, effort: 6 }).toFile(small)   // 3x density for a logo up to ~210 px wide
  console.log(`${f.padEnd(40)} png ${kb((await stat(src)).size).padStart(7)} -> cropped lossless webp ${kb((await stat(out)).size)} (636 px: ${kb((await stat(small)).size)})`)
}
console.log(`demo photos: ${kb(before)} of originals (9 files) -> ${kb(after)} for all generated variants`)
