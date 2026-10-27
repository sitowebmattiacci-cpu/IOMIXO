// Server only: the texts that ONLY the MIOLOVE public pages (home, guide) read, for the language of their URL. Static, synchronous imports on purpose — an async
// load in the page would put a suspending step in front of the response (and the status code of a 404 with it). They never reach the browser bundle through
// this module; the page hands them to the client with the HTML (components/miolove/PublicTexts.tsx). A language is added here when it goes live.
import { PUBLIC_FILES } from './fullMessages'
import { PUBLIC_ONLY_NAMESPACES } from './messages'
import type { MioloveLang } from './langs'

const DICTS: Partial<Record<MioloveLang, Record<string, any>>> = PUBLIC_FILES

export function publicTexts(lang: MioloveLang): Record<string, any> {
  const d = DICTS[lang]
  if (!d) throw new Error(`MIOLOVE: no public texts for "${lang}" (language not published)`)
  return Object.fromEntries(PUBLIC_ONLY_NAMESPACES.map((ns) => [ns, d[ns]]))
}
