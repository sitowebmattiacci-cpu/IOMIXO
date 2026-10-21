import { NextResponse, type NextRequest } from 'next/server'
import { getPortalFromHostname, normalizeHost, PORTAL_CONFIG } from '@/lib/portal'
import { ideasLangOfPath } from '@/lib/miolove/paths'

// MIOLOVE: its root is the public home (app/page.tsx picks the portal from the host); "/" no longer redirects to the sign-in.
// IOMIXO and every non-portal host (localhost, hosted.app) keep the existing landing at "/".
// www.miolovealbum.com is a pure alias: every path moves permanently to the canonical apex host (the only origin Firebase Auth, links and QR codes use).
//
// Private surfaces of MIOLOVE are never indexed: guest album pages, the TV screen, the owner's area and the auth action handler answer with
// X-Robots-Tag: noindex (robots.txt alone cannot keep a linked URL out of a search index).
const LANGS = ['it', 'en', 'fr', 'es']
const PRIVATE_PREFIXES = ['/live/', '/booth/', '/screen/', '/remote/', '/sessions', '/onboarding', '/billing', '/settings', '/auth/']

export function middleware(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (getPortalFromHostname(host) === 'miolove') {
    const canonical = PORTAL_CONFIG.miolove
    if (normalizeHost(host) !== canonical.hosts[0]) {
      return NextResponse.redirect(`${canonical.baseUrl}${req.nextUrl.pathname}${req.nextUrl.search}`, 308)
    }
    const path = req.nextUrl.pathname
    // Language home pages: /en, /fr, /es are the same home rendered in that language (hreflang URLs; Italian is the bare root). The language travels to
    // the root layout and the page metadata in a request header (a client-supplied value is always dropped).
    const m = path.match(/^\/(en|fr|es)\/?$/)
    if (path === '/' || m) {
      const headers = new Headers(req.headers)
      headers.delete('x-ml-lang')
      if (m && LANGS.includes(m[1])) headers.set('x-ml-lang', m[1])
      const init = { request: { headers } }
      if (m) { const url = req.nextUrl.clone(); url.pathname = '/'; return NextResponse.rewrite(url, init) }
      return NextResponse.next(init)
    }
    // "Idee per usare MIOLOVE": one route (/idee) served at four public URLs (/idee, /en/ideas, /fr/idees, /es/ideas); same language-header rule as the home.
    const ideasLang = ideasLangOfPath(path)
    if (ideasLang) {
      const headers = new Headers(req.headers)
      headers.delete('x-ml-lang')
      if (ideasLang !== 'it') headers.set('x-ml-lang', ideasLang)
      const init = { request: { headers } }
      if (path.replace(/\/+$/, '') !== '/idee') { const url = req.nextUrl.clone(); url.pathname = '/idee'; return NextResponse.rewrite(url, init) }
      return NextResponse.next(init)
    }
    if (PRIVATE_PREFIXES.some((p) => path.startsWith(p))) {
      const res = NextResponse.next()
      res.headers.set('X-Robots-Tag', 'noindex, nofollow')
      return res
    }
  }
  return NextResponse.next()
}

export const config = { matcher: ['/((?!_next/).*)'] }
