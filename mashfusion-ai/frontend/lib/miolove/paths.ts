// Public paths of the MIOLOVE pages that exist in several languages. Pure module (safe in client components, middleware and unit tests).
// Italian is the bare path; the other languages carry a language prefix (the middleware rewrites them to the Italian route and forwards the language).
// The URLs themselves live in the registry (lib/miolove/pages.ts); this file keeps the helpers the components already use, answering for PUBLISHED languages only.
import { publishedLangs, pagePath, resolvePublicPath } from './pages'

/** A language whose pages are published today (it | en | fr | es). Draft languages have no public path. */
export type PathLang = 'it' | 'en' | 'fr' | 'es'

const pathsOf = (id: 'home' | 'ideas'): Record<PathLang, string> =>
  Object.fromEntries(publishedLangs(id).map((l) => [l, pagePath(id, l)])) as Record<PathLang, string>

export const HOME_PATH: Record<PathLang, string> = pathsOf('home')
export const IDEAS_PATH: Record<PathLang, string> = pathsOf('ideas')

export const homePath = (lang: string): string => pagePath('home', lang)
export const ideasPath = (lang: string): string => pagePath('ideas', lang)

/** "/en/ideas" → 'en' (also with a trailing slash); anything else → null. */
export function ideasLangOfPath(path: string): PathLang | null {
  const r = resolvePublicPath(path)
  return r && r.page === 'ideas' ? (r.lang as PathLang) : null
}
