// Loading of the MIOLOVE texts for ONE language at a time, on the SERVER (metadata, structured data, and — when a language is published that the browser bundle
// does not hold — the pages that deliver its texts). Never import this from a client component: it would put the dictionaries in the browser bundle. A language
// that is not published has no loader at all.
//
// Each loader is a lazy `import()` of two files per language: the CORE texts (locales/miolove/<lang>.json — the part the browser bundle holds) and the public-page
// texts (locales/miolove/public/<lang>.json — home, guide, service-page titles; delivered by the server with the pages that read them). A namespace is a top-level
// key. A language that goes live later registers a loader here in the same change that flips its status in langs.ts; tests/unit/miolovaI18nRegistry.test.ts
// refuses a live language without a loader and a complete dictionary.
import type { MioloveLang } from './langs'

export type Messages = Record<string, any>

const LOADERS: Partial<Record<MioloveLang, () => Promise<Messages>>> = {
  it: () => Promise.all([import('@/locales/miolove/it.json'), import('@/locales/miolove/public/it.json')]).then(([c, p]) => ({ ...c.default, ...p.default }) as Messages),
  en: () => Promise.all([import('@/locales/miolove/en.json'), import('@/locales/miolove/public/en.json')]).then(([c, p]) => ({ ...c.default, ...p.default }) as Messages),
  fr: () => Promise.all([import('@/locales/miolove/fr.json'), import('@/locales/miolove/public/fr.json')]).then(([c, p]) => ({ ...c.default, ...p.default }) as Messages),
  es: () => Promise.all([import('@/locales/miolove/es.json'), import('@/locales/miolove/public/es.json')]).then(([c, p]) => ({ ...c.default, ...p.default }) as Messages),
}

/** True when the language has a registered dictionary. */
export const hasMessages = (lang: MioloveLang): boolean => lang in LOADERS

/**
 * The texts of one language: the requested namespaces, or every namespace when none is given. A language without a loader is an error: it is never answered
 * with another language's texts.
 */
export async function loadMessages(lang: MioloveLang, namespaces?: readonly string[]): Promise<Messages> {
  const load = LOADERS[lang]
  if (!load) throw new Error(`MIOLOVE: no texts registered for "${lang}"`)
  const all = await load()
  return namespaces ? Object.fromEntries(namespaces.filter((ns) => ns in all).map((ns) => [ns, all[ns]])) : all
}

/**
 * Namespaces that only the public pages (home, guide) read; the server hands them to those two pages. Every other page of the product — sign-in, dashboard,
 * onboarding, guest page, TV screen — needs the rest ("core"), which the browser bundle holds.
 */
export const PUBLIC_ONLY_NAMESPACES = ['home', 'ideas'] as const
/** Namespaces of the public-page file that only the server reads (the titles of sign-in, sign-up… pages). */
export const SERVER_ONLY_NAMESPACES = ['servicePages'] as const

/** Every namespace except the public-only ones. */
export async function loadCoreMessages(lang: MioloveLang): Promise<Messages> {
  const all = await loadMessages(lang)
  const out = [...PUBLIC_ONLY_NAMESPACES, ...SERVER_ONLY_NAMESPACES] as readonly string[]
  return Object.fromEntries(Object.entries(all).filter(([ns]) => !out.includes(ns)))
}

/** Translator over already loaded messages. A missing key yields the key itself (visible in review), NEVER the Italian text: no accidental fallback. */
export function makeT(messages: Messages): (path: string, fallback?: string) => string {
  return (path, fallback) => {
    const v = path.split('.').reduce<any>((acc, k) => (acc != null ? acc[k] : undefined), messages)
    return typeof v === 'string' ? v : fallback ?? path
  }
}
