// The language type of MIOLOVE, independent of the shared UI `Locale` (lib/locales.ts: it | en | es | fr), which IOMIXO also reads and which does NOT change.
// Every `Locale` is a `MioloveLocale`; the eight languages being prepared (de, pt-BR, pt-PT, nl, pl, el, ja, ko) are MioloveLocales that are not `Locale`s.
// New MIOLOVE-only code takes a `MioloveLocale`; shared code keeps `Locale`. Pure module (client components, server, tests).
import { LOCALES, type Locale } from '@/lib/locales'
import { LANG_META, MIOLOVE_LANGS, isMioloveLang, type MioloveLang } from './langs'

export type MioloveLocale = MioloveLang
export const MIOLOVE_LOCALES: readonly MioloveLocale[] = MIOLOVE_LANGS
export const isMioloveLocale = isMioloveLang

/** True for the four languages the shared UI (and IOMIXO) supports; false for the languages only MIOLOVE will have. */
export const isSharedLocale = (l: MioloveLocale): l is Locale & MioloveLocale => (LOCALES as readonly string[]).includes(l)

/** Intl locale (dates, numbers) of a MIOLOVE language. */
export const intlLocale = (l: MioloveLocale): string => LANG_META[l].intl
