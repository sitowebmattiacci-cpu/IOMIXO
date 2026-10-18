import type { Locale } from '@/lib/i18n'

/** MIOLOVE table sign: a printable card with the guest QR. Only the owner's overrides are stored; everything else follows the album. */
export type PosterFormat = 'A4' | 'A5'
export type TitleFontKey = 'playfair' | 'cormorant' | 'cinzel' | 'inter'
export type ScriptFontKey = 'greatVibes' | 'dancing' | 'tangerine'
export type BodyFontKey = 'inter' | 'cormorant' | 'playfair'
export type TitleSize = 's' | 'm' | 'l'
export type PosterOccasion = 'wedding' | 'birthday' | 'baptism' | 'other'

export interface PosterConfig {
  format: PosterFormat
  primaryColor: string
  backgroundColor: string
  titleFont: TitleFontKey
  scriptFont: ScriptFontKey
  bodyFont: BodyFontKey
  title1: string
  title2: string
  title3: string
  instruction1: string
  instruction2: string
  displayName: string
  displayDate: string
  titleSize: TitleSize
}
/** What is persisted: a key is present only when the owner changed it ('' on a text field = deliberately empty). */
export type PosterOverrides = Partial<PosterConfig>

export const POSTER_SIZES_MM: Record<PosterFormat, { w: number; h: number }> = { A4: { w: 210, h: 297 }, A5: { w: 148, h: 210 } }
export const POSTER_TEXT_FIELDS = ['title1', 'title2', 'title3', 'instruction1', 'instruction2', 'displayName', 'displayDate'] as const
export type PosterTextField = (typeof POSTER_TEXT_FIELDS)[number]
export const POSTER_TEXT_MAX: Record<PosterTextField, number> = { title1: 24, title2: 16, title3: 24, instruction1: 60, instruction2: 60, displayName: 80, displayDate: 40 }

export const TITLE_FONTS: TitleFontKey[] = ['playfair', 'cormorant', 'cinzel', 'inter']
export const SCRIPT_FONTS: ScriptFontKey[] = ['greatVibes', 'dancing', 'tangerine']
export const BODY_FONTS: BodyFontKey[] = ['inter', 'cormorant', 'playfair']
export const TITLE_SIZES: TitleSize[] = ['s', 'm', 'l']
export const POSTER_FORMATS: PosterFormat[] = ['A4', 'A5']

export const POSTER_PRESETS: Array<{ id: string; primary: string; background: string }> = [
  { id: 'rose',       primary: '#F06A9B', background: '#FFF7FA' },
  { id: 'sage',       primary: '#6B8F71', background: '#F6F3EA' },
  { id: 'terracotta', primary: '#B5573B', background: '#FBF4EC' },
  { id: 'dustyblue',  primary: '#5B7C99', background: '#FFFFFF' },
]
export const DEFAULT_STYLE = { format: 'A4', primaryColor: POSTER_PRESETS[0].primary, backgroundColor: POSTER_PRESETS[0].background, titleFont: 'playfair', scriptFont: 'greatVibes', bodyFont: 'inter', titleSize: 'm' } as const

const SCRIPTS: Record<Locale, Record<PosterOccasion, [string, string]>> = {
  it: { wedding: ["l'", 'amore'], birthday: ['la', 'festa'], baptism: ['questo', 'momento'], other: ['questo', 'momento'] },
  en: { wedding: ['the', 'love'], birthday: ['the', 'party'], baptism: ['this', 'moment'], other: ['this', 'moment'] },
  fr: { wedding: ["l'", 'amour'], birthday: ['la', 'fête'], baptism: ['ce', 'moment'], other: ['ce', 'moment'] },
  es: { wedding: ['el', 'amor'], birthday: ['la', 'fiesta'], baptism: ['este', 'momento'], other: ['este', 'momento'] },
}
const COMMON: Record<Locale, { title1: string; instruction1: string; instruction2: string }> = {
  it: { title1: 'CONDIVIDI', instruction1: 'CONDIVIDI LE TUE FOTO!', instruction2: 'SCANSIONA IL QR CODE E CARICA' },
  en: { title1: 'SHARE', instruction1: 'SHARE YOUR PHOTOS!', instruction2: 'SCAN THE QR CODE AND UPLOAD' },
  fr: { title1: 'PARTAGEZ', instruction1: 'PARTAGEZ VOS PHOTOS !', instruction2: 'SCANNEZ LE QR CODE ET TÉLÉCHARGEZ' },
  es: { title1: 'COMPARTE', instruction1: '¡COMPARTE TUS FOTOS!', instruction2: 'ESCANEA EL CÓDIGO QR Y SUBE' },
}

export const asOccasion = (v: unknown): PosterOccasion => (v === 'birthday' || v === 'baptism' || v === 'other' ? v : 'wedding')

/** The texts that follow the album's occasion and the UI language until the owner edits them. */
export function posterTextDefaults(occasion: unknown, locale: Locale): Pick<PosterConfig, 'title1' | 'title2' | 'title3' | 'instruction1' | 'instruction2'> {
  const [title2, title3] = SCRIPTS[locale][asOccasion(occasion)], c = COMMON[locale]
  return { title1: c.title1, title2, title3, instruction1: c.instruction1, instruction2: c.instruction2 }
}

const DATE_LOCALES: Record<Locale, string> = { it: 'it-IT', en: 'en-GB', fr: 'fr-FR', es: 'es-ES' }
/** 'YYYY-MM-DD…' → "12 giugno 2027". Anything else (null, free text) yields '' so the row is hidden, never "null". */
export function formatPosterDate(iso: unknown, locale: Locale): string {
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  if (!m) return ''
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(DATE_LOCALES[locale], { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}

export interface PosterContext { occasion?: unknown; locale: Locale; eventName: string; eventDate?: unknown }

export function posterDefaults(ctx: PosterContext): PosterConfig {
  return { ...DEFAULT_STYLE, ...posterTextDefaults(ctx.occasion, ctx.locale), displayName: ctx.eventName ?? '', displayDate: formatPosterDate(ctx.eventDate, ctx.locale) }
}

const HEX = /^#[0-9a-fA-F]{6}$/
const pickEnum = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined)

/** Stored value → trusted overrides (unknown keys and invalid values are dropped, never rendered). */
export function sanitizeOverrides(raw: unknown): PosterOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>, out: Record<string, unknown> = {}
  const set = (k: string, v: unknown) => { if (v !== undefined) out[k] = v }
  set('format', pickEnum(r.format, POSTER_FORMATS)); set('titleSize', pickEnum(r.titleSize, TITLE_SIZES))
  set('titleFont', pickEnum(r.titleFont, TITLE_FONTS)); set('scriptFont', pickEnum(r.scriptFont, SCRIPT_FONTS)); set('bodyFont', pickEnum(r.bodyFont, BODY_FONTS))
  for (const k of ['primaryColor', 'backgroundColor'] as const) set(k, typeof r[k] === 'string' && HEX.test(r[k] as string) ? r[k] : undefined)
  for (const k of POSTER_TEXT_FIELDS) set(k, typeof r[k] === 'string' ? (r[k] as string).slice(0, POSTER_TEXT_MAX[k]) : undefined)
  return out as PosterOverrides
}

export const resolvePoster = (overrides: PosterOverrides, ctx: PosterContext): PosterConfig => ({ ...posterDefaults(ctx), ...overrides })

/** Black or white ink, whichever reads better on the chosen background. */
export function readableInk(hex: string): string {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#2B2B33' : '#FFFFFF'
}

export const posterFileName = (slug: string) => `miolove-cartello-qr-${slug.replace(/[^A-Za-z0-9_-]/g, '') || 'album'}.pdf`
