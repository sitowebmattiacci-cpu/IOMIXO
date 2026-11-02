import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sharedGalleryOn } from '../../lib/miolove/sharedGallery'
import { screenShowsPhotos } from '../../lib/events/screenModel'

const root = join(__dirname, '../../../..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const loc = (l: string) => JSON.parse(readFileSync(join(__dirname, `../../locales/miolove/${l}.json`), 'utf8'))

test('SGU1. only a real boolean true opens the gallery; absent / false / any other value is closed', () => {
  assert.equal(sharedGalleryOn({ shared_gallery: true }), true)
  for (const v of [undefined, null, {}, [], 'true', 1, { shared_gallery: false }, { shared_gallery: 'true' }, { shared_gallery: 1 }, { shared_gallery: null }, true]) assert.equal(sharedGalleryOn(v), false, JSON.stringify(v))
})

test('SGU2. the TV follows the switch; IOMIXO events are unaffected', () => {
  const album = { type: 'wedding' as const, accessMode: 'activated' as const }
  assert.equal(screenShowsPhotos({ ...album, guestConfig: { shared_gallery: false } }, { show_photos: true }), false)
  assert.equal(screenShowsPhotos({ ...album, guestConfig: { shared_gallery: true } }, {}), true)
  assert.equal(screenShowsPhotos({ type: 'party', accessMode: null, guestConfig: null }, { show_photos: true }), true)
})

test('SGU3. firestore.rules and storage.rules gate the media of a MIOLOVE album on guestConfig.shared_gallery, same test in both', () => {
  const fr = read('firebase/firestore.rules'), sr = read('firebase/storage.rules')
  assert.match(fr, /function sharedGalleryOn\(e\)[\s\S]*?guestConfig\.get\('shared_gallery', false\) == true/)
  assert.match(fr, /match \/photos\/\{photoId\}[\s\S]*?guestMayReadPhotos\(eventId\)/)
  assert.match(fr, /!isMioloveEvent\(eventId\) \|\| sharedGalleryOn\(e\)/)
  assert.match(sr, /function galleryOpen\(ev\)[\s\S]*?guestConfig\.get\('shared_gallery', false\) == true/)
  assert.match(sr, /function guestCanRead\(ph, ev\)[\s\S]*?galleryOpen\(ev\)/)
  // the owner branch of both is unchanged: it never depends on the switch
  assert.match(fr, /allow get, list: if isEventOwner\(eventId\)\s*\|\|/); assert.match(sr, /function canRead\(ev\) \{ return \(isAccount\(\) && ev\.ownerUid == request\.auth\.uid\) \|\| guestCanRead/)
})

test('SGU4. the server only stores a boolean for the switch, and nothing else of the callable changed', () => {
  const c = read('firebase/functions/src/owner/config.ts')
  assert.match(c, /shared_gallery must be a boolean/); assert.match(c, /checkGuestConfig\(plainObject\(d\.guestConfig/)
})

test('SGU5. the dashboard switch exists for an album, starts OFF, and the guest page shows the gallery only when it is ON', () => {
  const dash = read('mashfusion-ai/frontend/app/(dashboard)/sessions/[sessionId]/page.tsx')
  assert.match(dash, /key: 'shared_gallery'[\s\S]*?albumPrivacy\.sharedGallery/)
  assert.match(dash, /const isOn = \(key: string\) => \(key === 'requests' \? cfg\.requests !== false : cfg\[key\] === true\)/, 'a key that is not stored reads OFF')
  const live = read('mashfusion-ai/frontend/app/live/[slug]/page.tsx')
  assert.match(live, /isAlbum && photosAllowed && sharedGalleryOn\(session\.guest_config\)[\s\S]*?<GuestGallery/)
})

test('SGU6. texts exist in every MIOLOVE language', () => {
  // German is a draft that ships only on the branches that carry it: it is checked when its dictionary exists, the four online languages always.
  for (const l of ['it', 'en', 'fr', 'es', 'de'].filter((x) => x !== 'de' || existsSync(join(__dirname, '../../locales/miolove/de.json')))) {
    const d = loc(l)
    for (const k of ['sharedGallery', 'sharedGalleryDesc']) assert.ok(d.albumPrivacy[k]?.length > 3, `${l} albumPrivacy.${k}`)
    for (const k of ['title', 'empty', 'error', 'add']) assert.ok(d.guestAlbum.gallery[k]?.length > 3, `${l} guestAlbum.gallery.${k}`)
  }
  assert.equal(loc('it').albumPrivacy.sharedGallery, 'Galleria condivisa')
})
