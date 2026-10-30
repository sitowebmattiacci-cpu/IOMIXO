import type { Metadata } from 'next'
import { getRequestPortal } from '@/lib/portalServer'
import { guestPageMetadata } from '@/lib/guestPageMetadata'

// MIOLOVE: this page is never indexed. The middleware already sends X-Robots-Tag noindex; this adds the matching meta tag (the root layout's default is
// "index, follow", which contradicted the header). Other portals: nothing.
// Guest pages (every portal) are not an installable app: no web-app manifest here, so a phone never offers to install a guest link, and an installed
// MIOLOVE / IOMIXO app is not offered as the handler of a link a guest opens (see lib/guestPageMetadata.ts).
export function generateMetadata(): Metadata {
  return guestPageMetadata(getRequestPortal().config.id === 'miolove')
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
