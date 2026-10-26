import type { MetadataRoute } from 'next'
import { getRequestPortal } from '@/lib/portalServer'
import { SINGLE_URL_PATHS, pageUrl } from '@/lib/miolove/seo'
import { LANG_META } from '@/lib/miolove/langs'
import { PAGE_IDS, publishedLangs } from '@/lib/miolove/pages'

// MIOLOVE: the public pages only (never an album: albums are private and identified by an unguessable slug), generated from the page registry
// (lib/miolove/pages.ts): a page appears in a language only when it is published there, and its alternates list only the languages it is published in.
// Other hosts: just their root.
export default function sitemap(): MetadataRoute.Sitemap {
  const { config } = getRequestPortal()
  if (config.id !== 'miolove') return [{ url: `${config.baseUrl}/` }]
  const pages = PAGE_IDS.flatMap((id) => {
    const langs = publishedLangs(id)
    const languages = Object.fromEntries(langs.map((l) => [LANG_META[l].hreflang, pageUrl(id, l)]))
    return langs.map((l) => ({ url: pageUrl(id, l), alternates: { languages } }))
  })
  return [...pages, ...SINGLE_URL_PATHS.map((p) => ({ url: `${config.baseUrl}${p}` }))]
}
