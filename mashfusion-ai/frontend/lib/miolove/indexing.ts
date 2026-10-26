// What search engines may index on miolovealbum.com. Pure module with no imports (the middleware runs on the edge and the unit tests import it directly).
//
// Three kinds of URL:
//   • private  — the owner's area, guest album pages, the TV screen, the auth action handler: X-Robots-Tag "noindex, nofollow".
//   • service  — login, sign-up and password / e-mail pages: X-Robots-Tag "noindex, follow"; no canonical, not in the sitemap.
//   • public   — home, guide, legal pages: indexable, each with its own canonical (lib/miolove/seo.ts).
//
// RULE: a path that carries noindex is NEVER in robots.txt Disallow. A crawler that may not fetch a URL never sees its noindex, and a blocked URL that
// is linked from elsewhere can still be listed (URL only). So these pages stay crawlable and the header does the keeping-out. What protects the data is
// not robots.txt: the pages are client-rendered shells (no album or customer data in the HTML), and the data sits behind sign-in / anonymous guest
// auth, App Check and the Firestore and Functions rules.

/** Private surfaces. A trailing slash means "only below this folder" (/live/<slug>); otherwise the path itself and everything below it. */
export const MIOLOVE_PRIVATE_PREFIXES = ['/live/', '/booth/', '/screen/', '/remote/', '/sessions', '/onboarding', '/billing', '/settings', '/auth/', '/dashboard', '/events', '/profile']
/** Pages a visitor needs but a search engine must not list. */
export const MIOLOVE_SERVICE_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email']
/** robots.txt Disallow list: only the API (no page, nothing to index there). Nothing that carries noindex may ever be added. */
export const MIOLOVE_DISALLOW = ['/api/']

const clean = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path)
const under = (path: string, prefix: string): boolean => (prefix.endsWith('/') ? path.startsWith(prefix) : clean(path) === prefix || path.startsWith(`${prefix}/`))

/** Value of the X-Robots-Tag header MIOLOVE sends for a path, or null when the page is public. */
export function mioloveRobotsHeader(path: string): string | null {
  if (MIOLOVE_PRIVATE_PREFIXES.some((p) => under(path, p))) return 'noindex, nofollow'
  if (MIOLOVE_SERVICE_PATHS.includes(clean(path))) return 'noindex, follow'
  return null
}
