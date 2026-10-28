// Server only: the core texts of the language a MIOLOVE request is rendered in, handed to MioloveI18nProvider with the first HTML.
// Synchronous static imports on purpose (see publicTexts.ts): nothing suspends or awaits in front of the response, so a 404 stays a 404.
// A language that is not published has no texts here, whatever the request says. Never import this from a client component.
import { CORE_FILES } from './fullMessages'
import { isLiveLang, type MioloveLang } from './langs'
import { isSharedLocale } from './locale'

export type ServerTexts = { locale: MioloveLang; texts: Record<string, any> }

/**
 * Platform texts a language shares with the app, for languages with no bundled platform table (the browser bundle holds it / it | en | es | fr only).
 * Empty today: a language that goes live registers `<lang>-shared.json` here, in the same change that flips its status.
 */
const SHARED_FILES: Partial<Record<MioloveLang, Record<string, any>>> = {}

const merge = (base: Record<string, any>, over: Record<string, any>): Record<string, any> => {
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v
  return out
}

/** The core texts of a published language, or undefined. */
export function coreTexts(lang: MioloveLang): ServerTexts | undefined {
  const core = isLiveLang(lang) ? (CORE_FILES as Partial<Record<MioloveLang, Record<string, any>>>)[lang] : undefined
  return core ? { locale: lang, texts: merge(SHARED_FILES[lang] ?? {}, core) } : undefined
}

/**
 * What the layout sends to the browser: only for a language whose texts the bundle does NOT hold. The four published languages are already bundled, so sending
 * them again would add ~4 KB (gzip) to every page for nothing; their pages stay byte-for-byte as they were.
 */
export function messagesToSend(lang: MioloveLang): ServerTexts | undefined {
  return isSharedLocale(lang) ? undefined : coreTexts(lang)
}
