import type { MetadataRoute } from 'next'
import { getRequestPortal } from '@/lib/portalServer'
import { miolovePublicUrls, SEO_LANGUAGES, homeUrl } from '@/lib/miolove/seo'

// MIOLOVE: the public pages only (never an album: albums are private and identified by an unguessable slug). Other hosts: just their root.
export default function sitemap(): MetadataRoute.Sitemap {
  const { config } = getRequestPortal()
  if (config.id !== 'miolove') return [{ url: `${config.baseUrl}/` }]
  const languages = Object.fromEntries(SEO_LANGUAGES.map((l) => [l, homeUrl(l)]))
  const homes = new Set(SEO_LANGUAGES.map(homeUrl))
  return miolovePublicUrls().map((url) => (homes.has(url) ? { url, alternates: { languages } } : { url }))
}
