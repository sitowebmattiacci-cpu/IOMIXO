import type { Metadata } from 'next'
import { getRequestPortal } from '@/lib/portalServer'
import { guestPageMetadata } from '@/lib/guestPageMetadata'

// Guest surface: no web-app manifest (see lib/guestPageMetadata.ts); MIOLOVE also gets the noindex meta tag.
export function generateMetadata(): Metadata {
  return guestPageMetadata(getRequestPortal().config.id === 'miolove')
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
