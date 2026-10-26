import { NextResponse, type NextRequest } from 'next/server'
import { getPortalFromHostname, normalizeHost, PORTAL_CONFIG } from '@/lib/portal'
import { resolvePublicPath } from '@/lib/miolove/pages'
import { DEFAULT_LANG } from '@/lib/miolove/langs'
import { mioloveRobotsHeader } from '@/lib/miolove/indexing'

// MIOLOVE: its root is the public home (app/page.tsx picks the portal from the host); "/" no longer redirects to the sign-in.
// IOMIXO and every non-portal host (localhost, hosted.app) keep the existing landing at "/".
// www.miolovealbum.com is a pure alias: every path moves permanently to the canonical apex host (the only origin Firebase Auth, links and QR codes use).
//
// Private surfaces of MIOLOVE are never indexed: guest album pages, the TV screen, the owner's area and the auth action handler answer with
// X-Robots-Tag: noindex (robots.txt alone cannot keep a linked URL out of a search index). Login, sign-up and the password / e-mail pages are noindex too
// but stay crawlable. Which paths are which lives in lib/miolove/indexing.ts.
export function middleware(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (getPortalFromHostname(host) === 'miolove') {
    const canonical = PORTAL_CONFIG.miolove
    if (normalizeHost(host) !== canonical.hosts[0]) {
      return NextResponse.redirect(`${canonical.baseUrl}${req.nextUrl.pathname}${req.nextUrl.search}`, 308)
    }
    const path = req.nextUrl.pathname
    // Public pages in a language (home, guide: lib/miolove/pages.ts): /en, /fr, /es, /en/ideas… are the same Next route rendered in that language (hreflang URLs;
    // Italian is the bare root). Only PUBLISHED pages match: a draft language has no entry here, so its URLs fall through and answer 404. The language travels
    // to the root layout and the page metadata in a request header (a client-supplied value is always dropped).
    const hit = resolvePublicPath(path)
    if (hit) {
      const headers = new Headers(req.headers)
      headers.delete('x-ml-lang')
      if (hit.lang !== DEFAULT_LANG) headers.set('x-ml-lang', hit.lang)
      const init = { request: { headers } }
      if (path !== hit.route && path.replace(/\/+$/, '') !== hit.route) { const url = req.nextUrl.clone(); url.pathname = hit.route; return NextResponse.rewrite(url, init) }
      return NextResponse.next(init)
    }
    const robotsTag = mioloveRobotsHeader(path)
    if (robotsTag) {
      const res = NextResponse.next()
      res.headers.set('X-Robots-Tag', robotsTag)
      return res
    }
  }
  return NextResponse.next()
}

export const config = { matcher: ['/((?!_next/).*)'] }
