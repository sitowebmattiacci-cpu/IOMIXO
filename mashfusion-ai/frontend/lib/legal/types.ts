import type { Locale } from '@/lib/i18n'

/**
 * Legal pages (Privacy / Terms) per language. Inline markup: **bold**, {{mail}} (the page's contact address),
 * {{privacy:link text}} (link to /privacy). Texts are faithful translations of the English source.
 */
export type LegalBlock = { p: string } | { ul: string[] }
export interface LegalDoc { lead: string; sections: Array<{ title: string; blocks: LegalBlock[] }> }

export interface LegalVars {
  /** MIOLOVE ALBUM portal (true) or IOMIXO (false). */
  miolove: boolean
  /** Portal brand as configured: "MIOLOVE ALBUM" / "IOMIXO Live Hub". */
  brand: string
  /** Short name used in running text: "MIOLOVE ALBUM" / "IOMIXO". */
  name: string
  /** Short defined term in the Terms: "MIOLOVE" / "IOMIXO". */
  short: string
}
export type LegalBuilder = (v: LegalVars) => LegalDoc
export type LegalBuilders = Record<Locale, LegalBuilder>

/** Variant text: [IOMIXO, MIOLOVE]. */
export const pick = (v: LegalVars, pair: readonly [string, string]) => (v.miolove ? pair[1] : pair[0])

export const LEGAL_DATE: Record<Locale, string> = { en: 'October 16, 2026', it: '16 ottobre 2026', es: '16 de octubre de 2026', fr: '16 octobre 2026' }
export const PRIVACY_EMAIL = 'privacy@iomixo.com'
export const TERMS_EMAIL = 'legal@iomixo.com'
/** The only public contact of MIOLOVE ALBUM (Privacy, Terms, content reports, support): MIOLOVE pages never show an iomixo.com address. */
export const MIOLOVE_EMAIL = 'info@miolovealbum.com'
export const legalEmail = (kind: 'privacy' | 'terms', miolove: boolean): string => (miolove ? MIOLOVE_EMAIL : kind === 'privacy' ? PRIVACY_EMAIL : TERMS_EMAIL)
