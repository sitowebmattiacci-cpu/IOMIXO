// Public paths of the MIOLOVE pages that exist in four languages. Pure module (safe in client components, middleware and unit tests).
// Italian is the bare path; the other languages carry a language prefix (the middleware rewrites them to the Italian route and forwards the language).
export type PathLang = 'it' | 'en' | 'fr' | 'es'

export const HOME_PATH: Record<PathLang, string> = { it: '/', en: '/en', fr: '/fr', es: '/es' }
export const IDEAS_PATH: Record<PathLang, string> = { it: '/idee', en: '/en/ideas', fr: '/fr/idees', es: '/es/ideas' }

export const homePath = (lang: string): string => HOME_PATH[lang as PathLang] ?? '/'
export const ideasPath = (lang: string): string => IDEAS_PATH[lang as PathLang] ?? '/idee'

/** "/en/ideas" → 'en' (also with a trailing slash); anything else → null. */
export function ideasLangOfPath(path: string): PathLang | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path
  for (const [lang, v] of Object.entries(IDEAS_PATH)) if (v === p) return lang as PathLang
  return null
}
