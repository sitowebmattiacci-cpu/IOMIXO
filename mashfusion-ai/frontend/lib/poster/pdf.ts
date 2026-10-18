/** A one-page PDF with the poster as a lossless 300 dpi image, plus an invisible text layer so the words stay searchable. No library needed. */
export interface PdfText { text: string; x: number; y: number; size: number }   // px, baseline origin top-left, x = centre
export interface PdfInput { wMm: number; hMm: number; pxW: number; pxH: number; rgba: Uint8ClampedArray | Uint8Array; texts: PdfText[] }

const MM_TO_PT = 72 / 25.4
const num = (n: number) => n.toFixed(2)

/** WinAnsi-safe string literal bytes (Latin-1; anything else becomes '?'). */
function pdfText(s: string): Uint8Array {
  const out: number[] = [0x28]
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i); if (c > 255) c = 0x3f
    if (c === 0x28 || c === 0x29 || c === 0x5c) out.push(0x5c)
    out.push(c)
  }
  out.push(0x29)
  return Uint8Array.from(out)
}

export async function buildPdf(p: PdfInput): Promise<Blob> {
  const wPt = p.wMm * MM_TO_PT, hPt = p.hMm * MM_TO_PT
  const rgb = new Uint8Array(p.pxW * p.pxH * 3)
  for (let i = 0, j = 0; i < p.rgba.length; i += 4, j += 3) { rgb[j] = p.rgba[i]; rgb[j + 1] = p.rgba[i + 1]; rgb[j + 2] = p.rgba[i + 2] }
  const image = new Uint8Array(await new Response(new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())

  const enc = new TextEncoder()
  const chunks: Uint8Array[] = [], offsets: number[] = []
  let len = 0
  const push = (u: Uint8Array) => { chunks.push(u); len += u.length }
  const str = (s: string) => push(enc.encode(s))
  const obj = (n: number, body: () => void) => { offsets[n] = len; str(`${n} 0 obj\n`); body(); str('\nendobj\n') }

  push(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))   // %PDF-1.4 + binary marker
  obj(1, () => str('<< /Type /Catalog /Pages 2 0 R >>'))
  obj(2, () => str('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'))
  obj(3, () => str(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(wPt)} ${num(hPt)}] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 6 0 R >> >> /Contents 5 0 R >>`))
  obj(4, () => {
    str(`<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`)
    push(image); str('\nendstream')
  })
  const content: Uint8Array[] = [enc.encode(`q ${num(wPt)} 0 0 ${num(hPt)} 0 0 cm /Im0 Do Q\nBT 3 Tr\n`)]
  const k = wPt / p.pxW
  for (const t of p.texts) {
    const sizePt = Math.max(1, t.size * k), width = t.text.length * sizePt * 0.5
    content.push(enc.encode(`/F1 ${num(sizePt)} Tf 1 0 0 1 ${num(t.x * k - width / 2)} ${num(hPt - t.y * k)} Tm `), pdfText(t.text), enc.encode(' Tj\n'))
  }
  content.push(enc.encode('ET\n'))
  const contentLen = content.reduce((a, c) => a + c.length, 0)
  obj(5, () => { str(`<< /Length ${contentLen} >>\nstream\n`); content.forEach(push); str('endstream') })
  obj(6, () => str('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'))

  const xref = len
  str('xref\n0 7\n0000000000 65535 f \n')
  for (let n = 1; n <= 6; n++) str(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  str(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}
