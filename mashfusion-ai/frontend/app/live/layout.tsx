import type { Metadata } from 'next'
import { getRequestPortal } from '@/lib/portalServer'
import { MIOLOVE_PRIVATE_ROBOTS } from '@/lib/miolove/seo'

// MIOLOVE: this page is never indexed. The middleware already sends X-Robots-Tag noindex; this adds the matching meta tag (the root layout's default is
// "index, follow", which contradicted the header). Other portals: nothing.
export function generateMetadata(): Metadata {
  return getRequestPortal().config.id === 'miolove' ? { robots: MIOLOVE_PRIVATE_ROBOTS } : {}
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
