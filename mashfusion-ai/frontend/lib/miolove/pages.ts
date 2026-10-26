// The single registry of MIOLOVE's public, indexable pages and of their URL in every language. Pure module (client components, the edge middleware, the
// sitemap, the metadata builders and the unit tests all read it). Languages and their status live in lib/miolove/langs.ts.
//
// A page exists in a language when BOTH say so: the language is `live` (langs.ts) and the language is listed in the page's `langs`. Everything else is
// a draft: the URL answers 404 (the middleware never rewrites it), it is in no sitemap and no hreflang. The slugs of draft languages are provisional,
// kept here so the URL plan is reviewable; they are fixed when the language is reviewed.
//
// Today only the home and the guide exist. Occasion pages (wedding, birthday, baptism…) are added here later, one entry each.
import { DEFAULT_LANG, LANG_META, LIVE_LANGS, isLiveLang, type MioloveLang } from './langs'

export type PageId = 'home' | 'ideas'

export interface PageDef {
  id: PageId
  /** The one Next route that renders this page, whatever the language (the middleware rewrites every public URL to it). */
  route: string
  /** Last URL segment per language ('' = the folder itself). */
  slugs: Record<MioloveLang, string>
  /** Languages in which this page has real, reviewed content. */
  langs: readonly MioloveLang[]
}

export const PAGES: Record<PageId, PageDef> = {
  home: {
    id: 'home', route: '/',
    slugs: { it: '', en: '', fr: '', es: '', de: '', 'pt-BR': '', 'pt-PT': '', nl: '', pl: '', el: '', ja: '', ko: '' },
    langs: ['it', 'en', 'fr', 'es'],
  },
  ideas: {
    id: 'ideas', route: '/idee',
    slugs: { it: 'idee', en: 'ideas', fr: 'idees', es: 'ideas', de: 'ideen', 'pt-BR': 'ideias', 'pt-PT': 'ideias', nl: 'ideeen', pl: 'pomysly', el: 'ideas', ja: 'ideas', ko: 'ideas' },
    langs: ['it', 'en', 'fr', 'es'],
  },
}
export const PAGE_IDS = Object.keys(PAGES) as PageId[]

/** Public path of a page in a language, published or not (draft URLs are only ever PLANNED: they answer 404). */
export function plannedPagePath(id: PageId, lang: MioloveLang): string {
  const prefix = LANG_META[lang].prefix, slug = PAGES[id].slugs[lang]
  const path = [prefix, slug].filter(Boolean).join('/')
  return path ? `/${path}` : '/'
}

/** Languages in which the page is actually published, in registry order. */
export const publishedLangs = (id: PageId): MioloveLang[] => LIVE_LANGS.filter((l) => PAGES[id].langs.includes(l))
export const isPublished = (id: PageId, lang: MioloveLang): boolean => isLiveLang(lang) && PAGES[id].langs.includes(lang)

/** Path of a published page; a page that is not published in `lang` falls back to its Italian URL (never to a draft URL). */
export function pagePath(id: PageId, lang: string): string {
  return plannedPagePath(id, isPublished(id, lang as MioloveLang) ? (lang as MioloveLang) : DEFAULT_LANG)
}

const clean = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path)

/** Public URL → the page and language it is, ONLY for published pages; anything else (drafts, unknown folders) → null, so the request stays a 404. */
export function resolvePublicPath(path: string): { page: PageId; lang: MioloveLang; route: string } | null {
  const p = clean(path)
  for (const id of PAGE_IDS) for (const lang of publishedLangs(id)) if (plannedPagePath(id, lang) === p) return { page: id, lang, route: PAGES[id].route }
  return null
}

/** Every URL the registry PLANS for a language (published or not), for audits and tests. */
export const plannedPaths = (lang: MioloveLang): string[] => PAGE_IDS.map((id) => plannedPagePath(id, lang))
