import type { CSSProperties } from 'react'

/**
 * Backgrounds of a MIOLOVE album's big screen (/screen/[slug]). ONE definition shared by the owner's picker and the screen renderer.
 * The album stores only the stable id in `screenConfig.backgroundTheme` (never a path); a missing or unknown value means 'default'.
 * The server keeps its own whitelist (firebase/functions/src/owner/config.ts); tests/unit/screenBackgrounds.test.ts checks the two lists are equal.
 */
export const SCREEN_BACKGROUND_IDS = ['default', 'romantic_pink_bokeh', 'ethereal_pastel_light', 'botanical_green_mist', 'violet_light_ribbons', 'dreamy_champagne_glow'] as const
export type ScreenBackgroundId = (typeof SCREEN_BACKGROUND_IDS)[number]

export interface ScreenBackground {
  id: ScreenBackgroundId
  /** Italian fallback name; the UI uses the `wdAdmin.screenBg.<id>` translation. */
  label: string
  /** Full-size image (null = the original dark stage gradient). */
  asset: string | null
  /** Small image for the picker grid (null = CSS preview). */
  preview: string | null
  /** Veil over the image so the (light) event title / date / location stay readable: darker in the middle where the text sits, nearly clear at the edges. CSS background value. */
  overlay: string | null
  /** Inline style of the event date / location on the screen (null = the original look). */
  date: CSSProperties | null
  location: CSSProperties | null
}

const BASE = '/miolove/screen-backgrounds'
/** Centre veil: `rgb` tint at `mid` opacity under the text, fading to `edge` at the borders (a soft vignette tint keeps the picture's character). */
const veil = (rgb: string, mid: number, edge: number) =>
  `radial-gradient(ellipse 62% 48% at 50% 50%, rgba(${rgb},${mid}) 0%, rgba(${rgb},${(mid * 0.7).toFixed(2)}) 55%, rgba(${rgb},${edge}) 100%)`
const shadow = (rgb: string, a: number) => `0 1px 14px rgba(${rgb},${a}), 0 0 2px rgba(${rgb},${a / 2})`
const bg = (id: Exclude<ScreenBackgroundId, 'default'>, label: string, overlay: string, date: CSSProperties, location: CSSProperties): ScreenBackground =>
  ({ id, label, asset: `${BASE}/${id}.webp`, preview: `${BASE}/${id}-thumb.webp`, overlay, date, location })

export const SCREEN_BACKGROUNDS: readonly ScreenBackground[] = [
  { id: 'default', label: 'Default', asset: null, preview: null, overlay: null, date: null, location: null },
  bg('romantic_pink_bokeh', 'Rosa romantico', veil('50,12,28', 0.34, 0.08),
    { color: '#fde8ee', textShadow: shadow('50,12,28', 0.5) }, { color: 'rgba(255,244,246,0.92)', textShadow: shadow('50,12,28', 0.55) }),
  bg('ethereal_pastel_light', 'Azzurro etereo', veil('18,78,120', 0.27, 0.02),
    { color: '#fff2f6', textShadow: shadow('10,35,65', 0.5) }, { color: 'rgba(255,255,255,0.94)', textShadow: shadow('10,35,65', 0.55) }),
  bg('botanical_green_mist', 'Verde botanico', veil('0,0,0', 0.2, 0.04),
    { color: '#f6dfe6' }, { color: 'rgba(240,244,238,0.9)', textShadow: shadow('0,20,10', 0.45) }),
  bg('violet_light_ribbons', 'Viola luminoso', veil('0,0,0', 0.12, 0.02),
    { color: '#f4d9e6' }, { color: 'rgba(245,236,242,0.9)' }),
  bg('dreamy_champagne_glow', 'Champagne', veil('96,62,44', 0.3, 0.02),
    { color: '#fff3ee', textShadow: shadow('70,40,28', 0.5) }, { color: 'rgba(255,250,244,0.95)', textShadow: shadow('70,40,28', 0.55) }),
]

export const isScreenBackgroundId = (v: unknown): v is ScreenBackgroundId => typeof v === 'string' && (SCREEN_BACKGROUND_IDS as readonly string[]).includes(v)

/** The theme stored in a screen config; anything missing / unknown falls back to the default. */
export function resolveScreenBackground(cfg: unknown): ScreenBackground {
  const v = cfg && typeof cfg === 'object' ? (cfg as Record<string, unknown>).backgroundTheme : undefined
  return SCREEN_BACKGROUNDS.find((b) => b.id === v) ?? SCREEN_BACKGROUNDS[0]
}
