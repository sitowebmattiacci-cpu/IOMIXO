import { getRequestPortal } from '@/lib/portalServer'

// Bare /favicon.ico requests (crawlers, legacy browsers) get the icon of the portal whose host was asked, never the other brand's.
export const dynamic = 'force-dynamic'

// Relative Location: always resolves against the host the client asked for, whatever host the proxy hands to Next.
export function GET() {
  return new Response(null, { status: 307, headers: { Location: getRequestPortal().config.icons.favicon } })
}
