import { readableInk, type BodyFontKey, type PosterConfig, type ScriptFontKey, type TitleFontKey } from './posterConfig'
import type { QrModules } from './qr'

type FontKey = TitleFontKey | ScriptFontKey | BodyFontKey
const CSS_VAR: Record<FontKey, string> = {
  playfair: '--font-playfair', cormorant: '--font-cormorant', cinzel: '--font-cinzel', inter: '--font-inter',
  greatVibes: '--font-great-vibes', dancing: '--font-dancing-script', tangerine: '--font-tangerine',
}
const FALLBACK: Record<FontKey, string> = {
  playfair: 'serif', cormorant: 'serif', cinzel: 'serif', inter: 'sans-serif', greatVibes: 'cursive', dancing: 'cursive', tangerine: 'cursive',
}
const SCRIPT_WEIGHT: Record<ScriptFontKey, number> = { greatVibes: 400, dancing: 700, tangerine: 700 }

/** The next/font family already loaded by the app (its CSS variable), so no font is downloaded for the poster alone. */
export function fontFamily(key: FontKey): string {
  const v = (el: Element) => getComputedStyle(el).getPropertyValue(CSS_VAR[key]).trim()
  return v(document.body) || v(document.documentElement) || FALLBACK[key]
}

const SIZE_FACTOR = { s: 0.85, m: 1, l: 1.15 } as const

export interface DrawnText { text: string; x: number; y: number; size: number }

/** Loads the faces the poster uses (a canvas does not wait for them). */
export async function ensurePosterFonts(cfg: PosterConfig): Promise<void> {
  const sample = `${cfg.title1}${cfg.title2}${cfg.title3}${cfg.instruction1}${cfg.instruction2}${cfg.displayName}${cfg.displayDate}`
  const faces = [`700 40px ${fontFamily(cfg.titleFont)}`, `${SCRIPT_WEIGHT[cfg.scriptFont]} 40px ${fontFamily(cfg.scriptFont)}`, `700 40px ${fontFamily(cfg.bodyFont)}`, `500 40px ${fontFamily(cfg.bodyFont)}`]
  await Promise.allSettled(faces.map((f) => document.fonts.load(f, sample || 'A')))
}

/**
 * The one renderer: the on-screen preview and the PDF are the same drawing at different resolutions.
 * Layout is relative to the sheet (width W, height H in pixels), so A4 and A5 share it.
 */
export function drawPoster(ctx: CanvasRenderingContext2D, cfg: PosterConfig, qr: QrModules, W: number, H: number): DrawnText[] {
  const drawn: DrawnText[] = []
  const ink = readableInk(cfg.backgroundColor), f = SIZE_FACTOR[cfg.titleSize]
  ctx.fillStyle = cfg.backgroundColor; ctx.fillRect(0, 0, W, H)
  const inset = W * 0.05
  ctx.strokeStyle = cfg.primaryColor; ctx.lineWidth = Math.max(1, W * 0.004); ctx.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset)

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  const maxW = W * 0.78
  const line = (text: string, y: number, size: number, weight: number, family: string, color: string, spacing = 0) => {
    if (!text.trim()) return
    const set = (s: number) => { ctx.font = `${weight} ${s}px ${family}`; (ctx as any).letterSpacing = `${s * spacing}px` }
    set(size)
    const w = ctx.measureText(text).width
    if (w > maxW) { size *= maxW / w; set(size) }
    ctx.fillStyle = color; ctx.fillText(text, W / 2, y)
    drawn.push({ text, x: W / 2, y, size })
    ;(ctx as any).letterSpacing = '0px'
  }
  const title = fontFamily(cfg.titleFont), script = fontFamily(cfg.scriptFont), body = fontFamily(cfg.bodyFont)
  line(cfg.title1, H * 0.15, W * 0.11 * f, 700, title, cfg.primaryColor, 0.02)
  line(cfg.title2, H * 0.222, W * 0.088 * f, SCRIPT_WEIGHT[cfg.scriptFont], script, ink)
  line(cfg.title3, H * 0.322, W * 0.17 * f, SCRIPT_WEIGHT[cfg.scriptFont], script, cfg.primaryColor)

  // QR: black on a white box with the 4-module quiet zone, whatever the sheet colour; whole pixels per module so edges stay sharp.
  const quiet = 4, total = qr.size + 2 * quiet
  const mod = Math.max(1, Math.floor((W * 0.5) / total)), box = mod * total
  const bx = Math.round((W - box) / 2), by = Math.round(H * 0.405)
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(bx, by, box, box)
  ctx.fillStyle = '#000000'
  for (const [x, y, w] of qr.runs) ctx.fillRect(bx + (quiet + x) * mod, by + (quiet + y) * mod, w * mod, mod)

  line(cfg.instruction1, H * 0.795, W * 0.04, 700, body, ink, 0.06)
  line(cfg.instruction2, H * 0.838, W * 0.03, 500, body, ink, 0.05)
  line(cfg.displayName, H * 0.9, W * 0.05, 700, body, cfg.primaryColor, 0.02)
  line(cfg.displayDate, H * 0.94, W * 0.032, 500, body, ink, 0.03)
  return drawn
}
