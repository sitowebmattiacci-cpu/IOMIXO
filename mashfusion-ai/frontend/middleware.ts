import { NextResponse, type NextRequest } from 'next/server'
import { getPortalFromHostname } from '@/lib/portal'

// MIOLOVE has no marketing landing: its root goes straight to the sign-in (the dashboard guard sends a signed-in Sposi account to its albums).
// IOMIXO and every non-portal host (localhost, hosted.app) keep the existing landing at "/".
export function middleware(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (getPortalFromHostname(host) === 'miolove') {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = { matcher: ['/'] }
