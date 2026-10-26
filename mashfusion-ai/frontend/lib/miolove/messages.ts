// Loading of the MIOLOVE public-site texts for ONE language at a time, on the server. Nothing here is imported by a client component, so no dictionary
// reaches the browser bundle through this module, and a language that is not published has no loader at all.
//
// Each loader is a lazy `import()`: the bundler splits every language into its own chunk and the server reads only the one the URL asks for. Today the four
// published languages still keep all their texts in one file (locales/miolove/<lang>.json); a namespace is its top-level key (home, ideas, albumPlan…).
// A language that goes live later ships as one file per namespace (locales/miolove/<lang>/<namespace>.json) and registers a loader here, in the same change
// that flips its status in langs.ts; tests/unit/miolovaI18nRegistry.test.ts refuses a live language without a loader and a complete dictionary.
import type { MioloveLang } from './langs'

export type Messages = Record<string, any>

const LOADERS: Partial<Record<MioloveLang, () => Promise<Messages>>> = {
  it: () => import('@/locales/miolove/it.json').then((m) => m.default as Messages),
  en: () => import('@/locales/miolove/en.json').then((m) => m.default as Messages),
  fr: () => import('@/locales/miolove/fr.json').then((m) => m.default as Messages),
  es: () => import('@/locales/miolove/es.json').then((m) => m.default as Messages),
}

/** True when the language has a registered dictionary. */
export const hasMessages = (lang: MioloveLang): boolean => lang in LOADERS

/** Only the requested namespaces of one language. A language without a loader is an error: it is never answered with another language's texts. */
export async function loadMessages(lang: MioloveLang, namespaces: readonly string[]): Promise<Messages> {
  const load = LOADERS[lang]
  if (!load) throw new Error(`MIOLOVE: no texts registered for "${lang}"`)
  const all = await load()
  return Object.fromEntries(namespaces.filter((ns) => ns in all).map((ns) => [ns, all[ns]]))
}

/** Translator over already loaded messages. A missing key yields the key itself (visible in review), NEVER the Italian text: no accidental fallback. */
export function makeT(messages: Messages): (path: string, fallback?: string) => string {
  return (path, fallback) => {
    const v = path.split('.').reduce<any>((acc, k) => (acc != null ? acc[k] : undefined), messages)
    return typeof v === 'string' ? v : fallback ?? path
  }
}
