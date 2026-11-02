// Social preview images (Open Graph / Twitter) of the MIOLOVE occasion pages: 1200×630 JPEG built from the cover photo of each occasion (the same photos the home already
// shows; the PNG originals are never touched and are never sent to a crawler: they weigh ~2.3 MB). One-off tool, not part of the build:
//   npm i --no-save sharp && node scripts/make-miolove-og-images.mjs
// Output: public/demo/miolove/opt/og-<occasion>.jpg (committed static assets). Keep the names in sync with OCCASION_OG in lib/miolove/demoMedia.ts.
import sharp from 'sharp'
import { stat } from 'node:fs/promises'

// The covers are portrait photos (1086×1448): cropped to 1.91:1 they lose the faces. So the card is a composition, language-neutral: the whole photo on the left (full height),
// the MIOLOVE ALBUM logo on ivory on the right.
const COVERS = { wedding: 'wedding-party', birthday: 'birthday-martina', baptism: 'baptism-family' }
const W = 1200, H = 630, PHOTO_W = Math.round(H * 1086 / 1448)
const LOGO_CROP = { left: 97, top: 453, width: 1060, height: 348 }   // same crop as scripts/optimize-miolove-images.mjs
const logo = await sharp('public/brand/miolove/miolove-album-logo-on-light.png').extract(LOGO_CROP).resize({ width: 520 }).png().toBuffer()
const logoH = (await sharp(logo).metadata()).height
const [r, g, b] = await sharp(logo).removeAlpha().raw().toBuffer()   // the logo file's own ivory (first pixel) is the card background, so the logo has no visible box
const IVORY = { r, g, b }
for (const [occasion, name] of Object.entries(COVERS)) {
  const out = `public/demo/miolove/opt/og-${occasion}.jpg`
  const photo = await sharp(`public/demo/miolove/${name}.png`).resize({ width: PHOTO_W, height: H, fit: 'cover' }).toBuffer()
  await sharp({ create: { width: W, height: H, channels: 3, background: IVORY } })
    .composite([{ input: photo, left: 0, top: 0 }, { input: logo, left: PHOTO_W + Math.round((W - PHOTO_W - 520) / 2), top: Math.round((H - logoH) / 2) }])
    .jpeg({ quality: 82, mozjpeg: true }).toFile(out)
  console.log(out, `${((await stat(out)).size / 1024).toFixed(0)} KB`)
}
