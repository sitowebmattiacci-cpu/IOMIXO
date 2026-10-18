/** QR modules read back from qrcode.react's SVG (`<path d="M{x} {y}h{w}v1H{x}z…">`), so the printed code is exactly the one the library produced. */
export interface QrModules { size: number; runs: Array<[x: number, y: number, w: number]> }

export function qrModulesFromSvg(svg: string): QrModules | null {
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
  if (!vb) return null
  // the second <path> is the dark modules (the first is the white background)
  const paths: string[] = []
  svg.replace(/<path[^>]*\sd="([^"]+)"/g, (_m, d: string) => { paths.push(d); return '' })
  if (paths.length < 2) return null
  const runs: QrModules['runs'] = []
  paths[1].replace(/M(\d+)[ ,](\d+)\s*h(\d+)v1/g, (_m, x: string, y: string, w: string) => { runs.push([+x, +y, +w]); return '' })
  return runs.length ? { size: +vb[1], runs } : null
}

export function qrMatrix(qr: QrModules): boolean[][] {
  const m = Array.from({ length: qr.size }, () => new Array<boolean>(qr.size).fill(false))
  for (const [x, y, w] of qr.runs) for (let i = 0; i < w; i++) m[y][x + i] = true
  return m
}
