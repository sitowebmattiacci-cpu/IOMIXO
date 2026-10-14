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

/** The official PNGs are square (1254px) canvases: this is the logo area to display, in source pixels. Files stay untouched. */
export const WEDDING_BRAND_LOGO_CANVAS = 1254
export const WEDDING_BRAND_LOGO_CROP = {
  default: { x: 55, y: 483, w: 1153, h: 339 },
  onLight: { x: 136, y: 475, w: 988, h: 298 },
  onDark: { x: 190, y: 501, w: 883, h: 263 },
} as const

/** Prefix for files downloaded from the Wedding area (QR, poster, photos). */
export const WEDDING_BRAND_FILE_PREFIX = 'miolove'
