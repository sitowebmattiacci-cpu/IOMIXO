// The single registry of MIOLOVE languages. Pure module with no imports (client components, the edge middleware and the unit tests all read it).
//
// This is NOT the shared UI `Locale` of lib/locales.ts (it | en | es | fr, also read by IOMIXO): that type stays exactly as it is. MIOLOVE's public site is
// planned in 12 languages; which of them exist for visitors and search engines is decided here, and only here, by `status`.
//
//   live  — complete and reviewed: served, canonical, in hreflang, in the sitemap.
//   draft — not published: its URLs answer 404, it is in no sitemap and no hreflang, the language menu never offers it.
//
// A language goes `live` only when lib/miolove/pages.ts lists it for a page AND tests/unit/miolovaI18nRegistry.test.ts is green for it (complete dictionary,
// no Italian text left over, loader registered). Never flip a status to make a page "appear".

export const MIOLOVE_LANGS = ['it', 'en', 'fr', 'es', 'de', 'pt-BR', 'pt-PT', 'nl', 'pl', 'el', 'ja', 'ko'] as const
export type MioloveLang = (typeof MIOLOVE_LANGS)[number]
export type LangStatus = 'live' | 'draft'

export interface LangMeta {
  /** URL folder: '' for the bare root (Italian), otherwise lowercase without slashes. */
  prefix: string
  /** hreflang value (BCP 47, region only where two markets share a language). */
  hreflang: string
  /** <html lang>. */
  htmlLang: string
  /** Open Graph locale. */
  og: string
  /** Intl locale for dates and numbers. */
  intl: string
  status: LangStatus
}

export const LANG_META: Record<MioloveLang, LangMeta> = {
  it: { prefix: '', hreflang: 'it', htmlLang: 'it', og: 'it_IT', intl: 'it-IT', status: 'live' },
  en: { prefix: 'en', hreflang: 'en', htmlLang: 'en', og: 'en_GB', intl: 'en-GB', status: 'live' },
  fr: { prefix: 'fr', hreflang: 'fr', htmlLang: 'fr', og: 'fr_FR', intl: 'fr-FR', status: 'live' },
  es: { prefix: 'es', hreflang: 'es', htmlLang: 'es', og: 'es_ES', intl: 'es-ES', status: 'live' },
  de: { prefix: 'de', hreflang: 'de', htmlLang: 'de', og: 'de_DE', intl: 'de-DE', status: 'draft' },
  'pt-BR': { prefix: 'pt-br', hreflang: 'pt-BR', htmlLang: 'pt-BR', og: 'pt_BR', intl: 'pt-BR', status: 'draft' },
  'pt-PT': { prefix: 'pt-pt', hreflang: 'pt-PT', htmlLang: 'pt-PT', og: 'pt_PT', intl: 'pt-PT', status: 'draft' },
  nl: { prefix: 'nl', hreflang: 'nl', htmlLang: 'nl', og: 'nl_NL', intl: 'nl-NL', status: 'draft' },
  pl: { prefix: 'pl', hreflang: 'pl', htmlLang: 'pl', og: 'pl_PL', intl: 'pl-PL', status: 'draft' },
  el: { prefix: 'el', hreflang: 'el', htmlLang: 'el', og: 'el_GR', intl: 'el-GR', status: 'draft' },
  ja: { prefix: 'ja', hreflang: 'ja', htmlLang: 'ja', og: 'ja_JP', intl: 'ja-JP', status: 'draft' },
  ko: { prefix: 'ko', hreflang: 'ko', htmlLang: 'ko', og: 'ko_KR', intl: 'ko-KR', status: 'draft' },
}

/** The language of the bare root; also the hreflang x-default. */
export const DEFAULT_LANG: MioloveLang = 'it'

/** Published languages, in registry order (the order of hreflang and of the sitemap). */
export const LIVE_LANGS: readonly MioloveLang[] = MIOLOVE_LANGS.filter((l) => LANG_META[l].status === 'live')

export const isMioloveLang = (v: unknown): v is MioloveLang => typeof v === 'string' && (MIOLOVE_LANGS as readonly string[]).includes(v)
export const isLiveLang = (v: unknown): v is MioloveLang => isMioloveLang(v) && LANG_META[v].status === 'live'

/** URL folder → language, only for the folders of PUBLISHED languages ('' is never matched here: the root is Italian). */
export function liveLangOfPrefix(prefix: string): MioloveLang | null {
  if (!prefix) return null
  return LIVE_LANGS.find((l) => LANG_META[l].prefix === prefix) ?? null
}
