import type { MetadataRoute } from 'next'
import { getRequestPortal } from '@/lib/portalServer'
import { MIOLOVE_DISALLOW } from '@/lib/miolove/seo'

// Per portal. MIOLOVE: public home and legal pages are crawlable, album pages and the owner's area are not. IOMIXO and every other host: open, exactly as
// before this file existed (no robots.txt = everything allowed).
export default function robots(): MetadataRoute.Robots {
  const { config } = getRequestPortal()
  if (config.id !== 'miolove') return { rules: { userAgent: '*', allow: '/' } }
  return { rules: { userAgent: '*', allow: '/', disallow: MIOLOVE_DISALLOW }, sitemap: `${config.baseUrl}/sitemap.xml`, host: config.baseUrl }
}
