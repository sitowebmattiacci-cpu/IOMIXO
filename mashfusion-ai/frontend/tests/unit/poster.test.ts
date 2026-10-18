import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QRCodeSVG } from 'qrcode.react'
import jsQR from 'jsqr'
import {
  posterDefaults, posterTextDefaults, resolvePoster, sanitizeOverrides, formatPosterDate, posterFileName, readableInk, asOccasion,
  POSTER_PRESETS, POSTER_SIZES_MM,
} from '../../lib/poster/posterConfig'
import { qrModulesFromSvg, qrMatrix } from '../../lib/poster/qr'
import { buildPdf } from '../../lib/poster/pdf'

const URL_ = 'https://miolovealbum.com/live/abc123xyz9'

test('P1. defaults follow the occasion and the language (copy is occasion-aware, no wedding copy on non-wedding)', () => {
  assert.deepEqual(posterTextDefaults('wedding', 'it'), { title1: 'CONDIVIDI', title2: "l'", title3: 'amore', instruction1: 'CONDIVIDI LE TUE FOTO!', instruction2: 'SCANSIONA IL QR CODE E CARICA' })
  assert.deepEqual([posterTextDefaults('birthday', 'it').title2, posterTextDefaults('birthday', 'it').title3], ['la', 'festa'])
  for (const o of ['baptism', 'other']) assert.deepEqual([posterTextDefaults(o, 'it').title2, posterTextDefaults(o, 'it').title3], ['questo', 'momento'])
  assert.equal(posterTextDefaults('wedding', 'en').title1, 'SHARE'); assert.equal(posterTextDefaults('wedding', 'fr').title3, 'amour'); assert.equal(posterTextDefaults('wedding', 'es').title1, 'COMPARTE')
  for (const l of ['it', 'en', 'fr', 'es'] as const) for (const o of ['birthday', 'baptism', 'other'] as const) assert.doesNotMatch(Object.values(posterTextDefaults(o, l)).join(' '), /amore|love|amour|amor|sposi|wedding|mariage|boda/i, `${l}/${o}`)
  assert.equal(asOccasion(undefined), 'wedding'); assert.equal(asOccasion('nonsense'), 'wedding')
})

test('P2. name and date default from the event; a missing date never renders "null"; overrides win and an empty override hides the row', () => {
  const ctx = { occasion: 'wedding', locale: 'it' as const, eventName: 'Matrimonio di Enrico', eventDate: '2027-06-12' }
  const d = posterDefaults(ctx)
  assert.deepEqual([d.displayName, d.displayDate, d.format], ['Matrimonio di Enrico', '12 giugno 2027', 'A4'])
  assert.equal(posterDefaults({ ...ctx, locale: 'en' }).displayDate, '12 June 2027')
  for (const none of [null, undefined, '', 'not a date']) assert.equal(posterDefaults({ ...ctx, eventDate: none }).displayDate, '')
  assert.equal(formatPosterDate('2027-02-30', 'it'), '2 marzo 2027', 'UTC arithmetic, no timezone drift')
  const r = resolvePoster({ displayName: 'Anna & Marco', displayDate: '' }, ctx)
  assert.deepEqual([r.displayName, r.displayDate], ['Anna & Marco', ''])
})

test('P3. untouched texts follow the language, edited ones never do', () => {
  const ctx = (locale: 'it' | 'en') => ({ occasion: 'wedding', locale, eventName: 'X' })
  const edited = { title1: 'GRAZIE' }
  assert.equal(resolvePoster(edited, ctx('en')).title1, 'GRAZIE'); assert.equal(resolvePoster(edited, ctx('en')).title3, 'love'); assert.equal(resolvePoster(edited, ctx('it')).title3, 'amore')
})

test('P4. stored overrides are sanitised: unknown keys, bad colours, bad enums and long texts are dropped / trimmed', () => {
  const o = sanitizeOverrides({ format: 'A3', primaryColor: 'red', backgroundColor: '#FFF7FA', titleFont: 'comic', scriptFont: 'dancing', title1: 'x'.repeat(99), evil: '<script>', titleSize: 'xl', qrUrl: 'https://evil.example' })
  assert.deepEqual(o, { backgroundColor: '#FFF7FA', scriptFont: 'dancing', title1: 'x'.repeat(24) })
  assert.deepEqual(sanitizeOverrides(null), {}); assert.deepEqual(sanitizeOverrides([1]), {}); assert.deepEqual(sanitizeOverrides('x'), {})
})

test('P5. print sizes, presets, ink and file name', () => {
  assert.deepEqual(POSTER_SIZES_MM, { A4: { w: 210, h: 297 }, A5: { w: 148, h: 210 } })
  assert.equal(POSTER_PRESETS.length, 4); assert.equal(readableInk('#FFFFFF'), '#2B2B33'); assert.equal(readableInk('#000000'), '#FFFFFF')
  assert.equal(posterFileName('abc 123/../x'), 'miolove-cartello-qr-abc123x.pdf'); assert.equal(posterFileName(''), 'miolove-cartello-qr-album.pdf')
})

test('P6. the QR modules read from qrcode.react form a valid, decodable code for the guest URL', () => {
  const svg = renderToStaticMarkup(React.createElement(QRCodeSVG, { value: URL_, size: 256, level: 'M', includeMargin: false }))
  const qr = qrModulesFromSvg(svg)!; assert.ok(qr && qr.size >= 21 && qr.runs.length > 20)
  const m = qrMatrix(qr)
  for (const [ox, oy] of [[0, 0], [qr.size - 7, 0], [0, qr.size - 7]]) { for (let i = 0; i < 7; i++) assert.ok(m[oy][ox + i] && m[oy + 6][ox + i] && m[oy + i][ox] && m[oy + i][ox + 6], 'finder border') ; assert.ok(m[oy + 3][ox + 3], 'finder centre') }
  // render the matrix with a quiet zone and decode it
  const mod = 8, q = 4, side = (qr.size + 2 * q) * mod, px = new Uint8ClampedArray(side * side * 4).fill(255)
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (m[y][x]) for (let dy = 0; dy < mod; dy++) for (let dx = 0; dx < mod; dx++) { const i = (((y + q) * mod + dy) * side + (x + q) * mod + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0 }
  assert.equal(jsQR(px, side, side)?.data, URL_)
})

test('P7. the PDF writer: one page of the exact size, lossless image, invisible searchable text', async () => {
  for (const [name, w, h, mm] of [['A4', 595.28, 841.89, POSTER_SIZES_MM.A4], ['A5', 419.53, 595.28, POSTER_SIZES_MM.A5]] as const) {
    const pxW = 40, pxH = Math.round((40 * mm.h) / mm.w), rgba = new Uint8ClampedArray(pxW * pxH * 4)
    for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 240; rgba[i + 1] = 106; rgba[i + 2] = 155; rgba[i + 3] = 255 }
    const blob = await buildPdf({ wMm: mm.w, hMm: mm.h, pxW, pxH, rgba, texts: [{ text: "CONDIVIDI l'amore (è)", x: 20, y: 10, size: 4 }] })
    const buf = Buffer.from(await blob.arrayBuffer()), txt = buf.toString('latin1')
    assert.ok(buf.length > 200, name); assert.equal(txt.slice(0, 8), '%PDF-1.4'); assert.match(txt, /%%EOF\s*$/)
    assert.equal((txt.match(/\/Type \/Page\b(?!s)/g) ?? []).length, 1, `${name}: one page`)
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(txt)!; assert.ok(Math.abs(+box[1] - w) < 0.02 && Math.abs(+box[2] - h) < 0.02, `${name} ${box[1]}x${box[2]}`)
    assert.ok(txt.includes("(CONDIVIDI l'amore \\(\xe8\\)) Tj"), 'invisible text layer (WinAnsi)'); assert.ok(txt.includes('3 Tr'))
    // the xref offsets point at the objects
    const start = +/startxref\n(\d+)/.exec(txt)![1]; assert.equal(txt.slice(start, start + 4), 'xref')
    const offs = (txt.slice(start).match(/\d{10} 00000 n/g) ?? []).map((m) => +m.slice(0, 10)); offs.forEach((o, i) => assert.equal(txt.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`))
    // the image stream inflates back to the exact pixels
    const im = /\/Length (\d+) >>\nstream\n/.exec(txt.slice(txt.indexOf('/Subtype /Image')))!, from = txt.indexOf('/Subtype /Image') + im.index + im[0].length
    const raw = inflateSync(buf.subarray(from, from + +im[1])); assert.equal(raw.length, pxW * pxH * 3); assert.deepEqual(Array.from(raw.subarray(0, 3)), [240, 106, 155])
  }
})
