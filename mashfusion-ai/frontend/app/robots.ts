import type { MetadataRoute } from 'next'
import { getRequestPortal } from '@/lib/portalServer'
import { MIOLOVE_DISALLOW } from '@/lib/miolove/seo'

// Per portal. MIOLOVE: everything is crawlable except /api/; private and service pages are kept out of the index by noindex (X-Robots-Tag + meta), which a
// crawler can only read if it may fetch them (lib/miolove/indexing.ts). IOMIXO and every other host: open, exactly as
// before this file existed (no robots.txt = everything allowed).
export default function robots(): MetadataRoute.Robots {
  const { config } = getRequestPortal()
  if (config.id !== 'miolove') return { rules: { userAgent: '*', allow: '/' } }
  return { rules: { userAgent: '*', allow: '/', disallow: MIOLOVE_DISALLOW }, sitemap: `${config.baseUrl}/sitemap.xml`, host: config.baseUrl }
}
