import type { Metadata } from 'next'
import { getRequestPortal } from '@/lib/portalServer'
import { mioloveServiceMetadata } from '@/lib/miolove/seo'

// MIOLOVE: own title / description for this service page (the page itself is a client component). Other portals: nothing, the group layout applies.
export function generateMetadata(): Metadata {
  return getRequestPortal().config.id === 'miolove' ? mioloveServiceMetadata('verify') : {}
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
