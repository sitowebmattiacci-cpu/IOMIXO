/** Single source of truth for the public Wedding brand. Party/DJ keep the IOMIXO brand. */
export const WEDDING_BRAND_NAME = 'MIOLOVE ALBUM'
export const WEDDING_BRAND_DOMAIN = 'miolovealbum.com'

/** Official logo assets (files live in /public/brand/miolove). */
export const WEDDING_BRAND_LOGO = {
  /** Transparent, for headers and interfaces. */
  default: '/brand/miolove/miolove-album-logo.png',
  /** Ivory background version. */
  onLight: '/brand/miolove/miolove-album-logo-on-light.png',
  /** Dark background version. */
  onDark: '/brand/miolove/miolove-album-logo-on-dark.png',
} as const

/** The official PNGs are square (1254px) canvases: this is the logo area to display, in source pixels. */
export const WEDDING_BRAND_LOGO_CANVAS = 1254
export const WEDDING_BRAND_LOGO_CROP = {
  default: { x: 97, y: 453, w: 1060, h: 348 },
  onLight: { x: 97, y: 453, w: 1060, h: 348 },
  onDark: { x: 97, y: 453, w: 1060, h: 348 },
} as const

/** Prefix for files downloaded from the Wedding area (QR, poster, photos). */
export const WEDDING_BRAND_FILE_PREFIX = 'miolove'
