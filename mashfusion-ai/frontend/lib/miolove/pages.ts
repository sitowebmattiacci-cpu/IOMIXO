// The single registry of MIOLOVE's public, indexable pages and of their URL in every language. Pure module (client components, the edge middleware, the
// sitemap, the metadata builders and the unit tests all read it). Languages and their status live in lib/miolove/langs.ts.
//
// A page exists in a language when BOTH say so: the language is `live` (langs.ts) and the language is listed in the page's `langs`. Everything else is
// a draft: the URL answers 404 (the middleware never rewrites it), it is in no sitemap and no hreflang. The slugs of draft languages are provisional,
// kept here so the URL plan is reviewable; they are fixed when the language is reviewed.
//
// The home, the guide and the occasion pages (wedding, birthday, baptism) live here. An occasion page is listed in a language only when its reviewed text exists.
import { DEFAULT_LANG, LANG_META, LIVE_LANGS, isLiveLang, type MioloveLang } from './langs'

export type PageId = 'home' | 'ideas' | OccasionId
export type OccasionId = 'wedding' | 'birthday' | 'baptism'
export const OCCASION_IDS: readonly OccasionId[] = ['wedding', 'birthday', 'baptism']
export const isOccasionId = (v: unknown): v is OccasionId => typeof v === 'string' && (OCCASION_IDS as readonly string[]).includes(v)

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
  // Occasion pages. Slugs of the four online languages are the planned URLs (the Spanish one is fixed with the keyword check of the Spanish text); `langs` grows
  // one language at a time, as its text is written and reviewed. An empty list = not published anywhere: every URL answers 404, nothing in sitemap or hreflang.
  wedding: {
    id: 'wedding', route: '/matrimonio',
    slugs: { it: 'matrimonio', en: 'wedding', fr: 'mariage', es: 'bodas', de: 'hochzeit', 'pt-BR': 'casamento', 'pt-PT': 'casamento', nl: 'bruiloft', pl: 'wesele', el: 'gamos', ja: 'wedding', ko: 'wedding' },
    langs: ['it'],
  },
  birthday: {
    id: 'birthday', route: '/compleanno',
    slugs: { it: 'compleanno', en: 'birthday', fr: 'anniversaire', es: 'cumpleanos', de: 'geburtstag', 'pt-BR': 'aniversario', 'pt-PT': 'aniversario', nl: 'verjaardag', pl: 'urodziny', el: 'genethlia', ja: 'birthday', ko: 'birthday' },
    langs: [],
  },
  baptism: {
    id: 'baptism', route: '/battesimo',
    slugs: { it: 'battesimo', en: 'baptism', fr: 'bapteme', es: 'bautizo', de: 'taufe', 'pt-BR': 'batizado', 'pt-PT': 'batizado', nl: 'doop', pl: 'chrzest', el: 'vaptisi', ja: 'baptism', ko: 'baptism' },
    langs: [],
  },
}
export const PAGE_IDS = Object.keys(PAGES) as PageId[]

/** Public path of a page in a language, published or not (draft URLs are only ever PLANNED: they answer 404). */
export function plannedPagePath(id: PageId, lang: MioloveLang, pages: Record<PageId, PageDef> = PAGES): string {
  const prefix = LANG_META[lang].prefix, slug = pages[id].slugs[lang]
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

// ── Language switch on a public page ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// What the language menu of a public page offers: for each PUBLISHED language the URL to open. The same page when it is published there ("exact"); otherwise
// the home of that language when the home is published ("fallback"); otherwise nothing: the language is not offered (a draft never appears, and a page is
// never shown in a language it does not exist in). `cfg` lets the tests describe registries that do not exist yet; production code passes nothing.
export interface SwitchConfig { pages?: Record<PageId, PageDef>; live?: readonly MioloveLang[] }
export interface SwitchTarget { lang: MioloveLang; path: string; exact: boolean }

export function switchTarget(id: PageId, lang: MioloveLang, cfg: SwitchConfig = {}): SwitchTarget | null {
  const pages = cfg.pages ?? PAGES, live = cfg.live ?? LIVE_LANGS
  if (!live.includes(lang)) return null
  const has = (page: PageId) => pages[page].langs.includes(lang)
  if (has(id)) return { lang, path: plannedPagePath(id, lang, pages), exact: true }
  if (has('home')) return { lang, path: plannedPagePath('home', lang, pages), exact: false }
  return null
}

/** The entries of the language menu of page `id`, in registry order. */
export function switchOptions(id: PageId, cfg: SwitchConfig = {}): SwitchTarget[] {
  const live = cfg.live ?? LIVE_LANGS
  return live.flatMap((l) => switchTarget(id, l, cfg) ?? [])
}
