import { NextResponse, type NextRequest } from 'next/server'
import { getPortalFromHostname, normalizeHost, PORTAL_CONFIG } from '@/lib/portal'

// MIOLOVE has no marketing landing: its root goes straight to the sign-in (the dashboard guard sends a signed-in Sposi account to its albums).
// IOMIXO and every non-portal host (localhost, hosted.app) keep the existing landing at "/".
// www.miolovealbum.com is a pure alias: every path moves permanently to the canonical apex host (the only origin Firebase Auth, links and QR codes use).
export function middleware(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (getPortalFromHostname(host) === 'miolove') {
    const canonical = PORTAL_CONFIG.miolove
    if (normalizeHost(host) !== canonical.hosts[0]) {
      return NextResponse.redirect(`${canonical.baseUrl}${req.nextUrl.pathname}${req.nextUrl.search}`, 308)
    }
    if (req.nextUrl.pathname === '/') {
      const url = req.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
  }
  return NextResponse.next()
}

export const config = { matcher: ['/((?!_next/).*)'] }
