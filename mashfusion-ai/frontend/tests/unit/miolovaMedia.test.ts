import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharedIt from '../../locales/it.json'
import sharedEn from '../../locales/en.json'
import sharedFr from '../../locales/fr.json'
import sharedEs from '../../locales/es.json'
import { MIOLOVE_FULL } from '../../lib/miolove/fullMessages'
const { it: mlIt, en: mlEn, fr: mlFr, es: mlEs } = MIOLOVE_FULL
import { classifyFile, refusalReason, attachmentDisposition, formatDuration, isVideoMedia, MEDIA_LIMITS, VIDEO_LIMIT_MB } from '../../lib/media/mediaTypes'
import { UPLOAD_ERROR_KEYS, FINAL_UPLOAD_REASONS, ALBUM_CLOSED_REASONS } from '../../lib/media/uploadErrors'
import { MEDIA_LIMITS as SERVER_LIMITS, kindOfExt, mediaPaths, ownedPaths, originalPathOf, archiveEntryName, MIME_BY_EXT } from '../../../../firebase/functions/src/photos/media'
import { parseCreatePhotoUploadInput, maxOriginalBytes } from '../../../../firebase/functions/src/photos/photos'

const MiB = 1024 * 1024
const f = (name: string, type: string, size = 1000) => ({ name, type, size })

test('MEDIA-U1. classification: the real MIME type decides, the extension is only the fallback; HEIC / GIF / AVI are refused', () => {
  assert.deepEqual(classifyFile(f('IMG_1.JPG', 'image/jpeg')), { kind: 'photo', ext: 'jpg', contentType: 'image/jpeg' })
  assert.equal(classifyFile(f('a.png', 'image/png'))!.ext, 'png'); assert.equal(classifyFile(f('a.webp', 'image/webp'))!.ext, 'webp')
  assert.deepEqual(classifyFile(f('v.mp4', 'video/mp4')), { kind: 'video', ext: 'mp4', contentType: 'video/mp4' })
  assert.deepEqual(classifyFile(f('IMG_0001.MOV', 'video/quicktime')), { kind: 'video', ext: 'mov', contentType: 'video/quicktime' })
  assert.deepEqual(classifyFile(f('v.webm', 'video/webm')), { kind: 'video', ext: 'webm', contentType: 'video/webm' })
  assert.equal(classifyFile(f('x.m4v', 'video/x-m4v'))!.ext, 'mp4')
  // some phones hand over an empty type: the extension decides
  assert.equal(classifyFile(f('IMG_2.mov', ''))!.kind, 'video'); assert.equal(classifyFile(f('p.jpeg', ''))!.contentType, 'image/jpeg'); assert.equal(classifyFile(f('v.mp4', 'application/octet-stream'))!.kind, 'video')
  // a renamed file is not fooled by its name when the browser knows its type
  assert.equal(classifyFile(f('virus.jpg', 'application/x-msdownload')), null); assert.equal(classifyFile(f('clip.mp4', 'image/gif')), null)
  for (const [n, t] of [['a.heic', 'image/heic'], ['a.heif', 'image/heif'], ['a.gif', 'image/gif'], ['a.avi', 'video/x-msvideo'], ['a.mkv', 'video/x-matroska'], ['a.pdf', 'application/pdf'], ['noext', '']]) assert.equal(classifyFile(f(n, t)), null, n)
})

test('MEDIA-U2. limits: video 150 MB per file (not per album), photo original 50 MB; the boundary is exact', () => {
  assert.equal(VIDEO_LIMIT_MB, 150); assert.equal(MEDIA_LIMITS.videoBytes, 150 * MiB); assert.equal(MEDIA_LIMITS.photoOriginalBytes, 50 * MiB)
  assert.equal(refusalReason(f('v.mp4', 'video/mp4', 150 * MiB)), null); assert.equal(refusalReason(f('v.mp4', 'video/mp4', 150 * MiB + 1)), 'video_too_large')
  assert.equal(refusalReason(f('v.mov', 'video/quicktime', 1)), null); assert.equal(refusalReason(f('v.mov', 'video/quicktime', 400 * MiB)), 'video_too_large')
  assert.equal(refusalReason(f('p.jpg', 'image/jpeg', 50 * MiB)), null); assert.equal(refusalReason(f('p.jpg', 'image/jpeg', 50 * MiB + 1)), 'file_too_large')
  assert.equal(refusalReason(f('e.mp4', 'video/mp4', 0)), 'unsupported_format', 'an empty file'); assert.equal(refusalReason(f('a.gif', 'image/gif', 10)), 'unsupported_format')
})

test('MEDIA-U3. client and server agree on every number (a drift would let a file through the UI and fail on the server, or the reverse)', () => {
  assert.equal(SERVER_LIMITS.videoBytes, MEDIA_LIMITS.videoBytes); assert.equal(SERVER_LIMITS.photoOriginalBytes, MEDIA_LIMITS.photoOriginalBytes)
  assert.equal(maxOriginalBytes('video', false), 150 * MiB); assert.equal(maxOriginalBytes('photo', true), 50 * MiB); assert.equal(maxOriginalBytes('photo', false), 8 * MiB)
  // storage.rules mirrors the derivative caps and the legacy ceiling
  const rules = readFileSync(join(__dirname, '../../../../firebase/storage.rules'), 'utf8')
  assert.match(rules, new RegExp(`validDerivative\\(${SERVER_LIMITS.optimizedBytes / MiB} \\* 1024 \\* 1024\\)`)); assert.match(rules, /validDerivative\(1024 \* 1024\)/); assert.equal(SERVER_LIMITS.thumbBytes, MiB)
  assert.match(rules, /maxBytes' in ph \? ph\.maxBytes : 8 \* 1024 \* 1024/); assert.equal((rules.match(/firestore\.get\(/g) ?? []).length, 3, 'photo() / event() are each defined once and passed down: no repeated Firestore reads per request'); assert.equal(SERVER_LIMITS.legacyPhotoBytes, 8 * MiB)
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'webm']) { assert.ok(rules.includes(ext), `storage.rules accepts .${ext}`); assert.ok(MIME_BY_EXT[ext]) }
})

test('MEDIA-U4. server input parsing: kinds, size ceilings, flags; clear reasons', () => {
  const ok = parseCreatePhotoUploadInput({ eventId: 'e1', ext: '.MP4', size: 150 * MiB, originalFilename: 'a/b\\c\u0001.mp4', durationSec: 12.345, width: 1920, height: 1080 })
  assert.equal(ok.ext, 'mp4'); assert.equal(ok.withOptimized, false); assert.match(ok.originalFilename!, /^a_b_c[ _]?\.mp4$/); assert.ok(!/[\\/\u0000-\u001f]/.test(ok.originalFilename!), 'no path separator or control character survives'); assert.equal(ok.durationSec, 12.35)
  const why = (d: object) => { try { parseCreatePhotoUploadInput({ eventId: 'e1', ...d }); return 'ok' } catch (e: any) { return e.details?.reason } }
  assert.equal(why({ ext: 'mp4', size: 150 * MiB + 1 }), 'video_too_large'); assert.equal(why({ ext: 'jpg', size: 50 * MiB + 1, withOptimized: true }), 'file_too_large'); assert.equal(why({ ext: 'jpg', size: 8 * MiB + 1 }), 'file_too_large')
  assert.equal(why({ ext: 'jpg', size: 50 * MiB, withOptimized: true }), 'ok'); assert.equal(why({ ext: 'heic', size: 10 }), 'unsupported_format'); assert.equal(why({ ext: 'mp4', size: 10, withOptimized: true }), 'invalid_payload')
  assert.equal(why({ ext: 'jpg', size: 10, durationSec: -1 }), 'invalid_payload'); assert.equal(why({ ext: 'jpg', size: -5 }), 'invalid_payload')
  assert.equal(kindOfExt('mov'), 'video'); assert.equal(kindOfExt('png'), 'photo'); assert.equal(kindOfExt('exe'), null)
})

test('MEDIA-U5. storage layout + ownership of files: the original is always the download, every derived file is owned (deleted) with it', () => {
  const p = mediaPaths('ev1', 'ph1', 'mov')
  assert.deepEqual(p, { original: 'events/ev1/photos/ph1/original.mov', optimized: 'events/ev1/photos/ph1/optimized.jpg', thumb: 'events/ev1/photos/ph1/thumb.jpg' })
  assert.deepEqual(ownedPaths({ storagePath: p.original, optimizedPath: p.optimized, thumbPath: p.thumb }), [p.original, p.optimized, p.thumb])
  assert.deepEqual(ownedPaths({ storagePath: p.original, optimizedPath: null, thumbPath: p.thumb }), [p.original, p.thumb]); assert.deepEqual(ownedPaths({ storagePath: 'x/original.jpg' }), ['x/original.jpg'], 'a legacy photo')
  assert.equal(originalPathOf({ storagePath: 'a', originalPath: 'b' }), 'b'); assert.equal(originalPathOf({ storagePath: 'a' }), 'a')
})

test('MEDIA-U6. archive entry names: safe, unique, ordered, extension of the ORIGINAL', () => {
  const a = archiveEntryName(1, { id: 'p1', storagePath: 'x/original.jpg', originalFilename: 'IMG 001.JPG' }), b = archiveEntryName(2, { id: 'p2', storagePath: 'x/original.mov', originalFilename: '../../etc/passwd' })
  assert.equal(a, '0001-IMG 001.jpg'); assert.ok(!b.includes('..') && !b.includes('/') && b.endsWith('.mov'), b); assert.equal(archiveEntryName(3, { id: 'p3', storagePath: 'x/original.mp4' }), '0003-p3.mp4')
  assert.notEqual(archiveEntryName(1, { id: 'a', storagePath: 'x.jpg', originalFilename: 'same.jpg' }), archiveEntryName(2, { id: 'b', storagePath: 'y.jpg', originalFilename: 'same.jpg' }), 'the same file name twice stays unique')
  assert.equal(archiveEntryName(4, { id: 'z', storagePath: 'x.jpg', originalFilename: 'Festa di Gioia à Roma 🎉.jpg' }), '0004-Festa di Gioia à Roma.jpg')
})

test('MEDIA-U7. helpers: download disposition (real name, safe), duration badge, legacy video detection by URL', () => {
  assert.equal(attachmentDisposition('clip.mp4', 'v'), "attachment; filename*=UTF-8''clip.mp4"); assert.equal(attachmentDisposition('', 'video.mp4'), "attachment; filename*=UTF-8''video.mp4")
  assert.ok(!/["\\\n/]/.test(attachmentDisposition('a"b\\c/d\ne.jpg', 'x').replace(/^attachment; filename\*=UTF-8''/, '')), 'no header injection'); assert.match(attachmentDisposition('Festa à.jpg', 'x'), /Festa%20%C3%A0\.jpg$/)
  assert.deepEqual([0, 5, 65, 3599.6, null].map((s) => formatDuration(s)), ['0:00', '0:05', '1:05', '60:00', '']); assert.equal(formatDuration(NaN), '')
  assert.equal(isVideoMedia({ media_type: 'video', url: 'x.jpg' }), true); assert.equal(isVideoMedia({ media_type: 'photo', url: 'a/clip.mp4' }), false); assert.equal(isVideoMedia({ url: 'https://h/o/a%2Fclip.mp4?alt=media' }), true); assert.equal(isVideoMedia({ url: 'https://h/o/a%2Fp.jpg?alt=media' }), false)
})

test('MEDIA-U8. localization: every upload error reason has a text, and every media.* key the code uses exists in IT / EN / FR / ES', () => {
  const merge = (a: any, b: any): any => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return o }
  const D: Record<string, any> = { it: merge(sharedIt, mlIt), en: merge(sharedEn, mlEn), fr: merge(sharedFr, mlFr), es: merge(sharedEs, mlEs) }
  const get = (o: any, path: string) => path.split('.').reduce((a, k) => a?.[k], o)
  for (const l of Object.keys(D)) for (const [reason, key] of Object.entries(UPLOAD_ERROR_KEYS)) assert.ok(typeof get(D[l], key) === 'string' && get(D[l], key).length > 3, `${l}: ${reason} → ${key}`)
  Array.from(FINAL_UPLOAD_REASONS).forEach((r) => assert.ok(UPLOAD_ERROR_KEYS[r] || r === 'event_ended', r)); Array.from(ALBUM_CLOSED_REASONS).forEach((r) => assert.ok(FINAL_UPLOAD_REASONS.has(r), r))
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (/node_modules|\.next|tests/.test(p) ? [] : walk(p)) : /\.(tsx?)$/.test(p) ? [p] : [] })
  const root = join(__dirname, '../..'); const used = new Set<string>()
  for (const file of [...walk(join(root, 'components')), ...walk(join(root, 'app')), ...walk(join(root, 'lib'))]) Array.from(readFileSync(file, 'utf8').matchAll(/\bt\(\s*'(media\.[A-Za-z0-9_.]+)'/g)).forEach((m) => used.add(m[1]))
  assert.ok(used.size >= 25, `the code uses ${used.size} media.* keys`)
  for (const l of Object.keys(D)) for (const k of Array.from(used)) assert.ok(typeof get(D[l], k) === 'string' && get(D[l], k).length > 0, `${l}: missing ${k}`)
  // the visible limits say the same number in every language
  for (const l of Object.keys(D)) { assert.match(D[l].guestAlbum.err.videoTooLarge, /150/); assert.match(D[l].guestAlbum.err.tooLarge, /50/); assert.match(D[l].guestAlbum.limitReached, /50/); assert.match(D[l].media.guest.hint, /150/) }
  assert.equal(D.it.guestAlbum.err.videoTooLarge, 'Il video supera il limite massimo di 150 MB.')
})
