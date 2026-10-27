// SEO of the MIOLOVE public home: metadata, hreflang alternates and structured data. Pure module (no React / next imports besides types): unit-tested.
import type { Metadata } from 'next'
import { MIOLOVE_FULL } from './fullMessages'
import { PORTAL_CONFIG } from '@/lib/portal'
import { currencyForLocale } from '../pricing'
import { ALBUM_PRICING } from './plans'
import { IDEAS, FAQ_KEYS } from './ideas'
import { DEFAULT_LANG, LANG_META, LIVE_LANGS, type MioloveLang } from './langs'
import { PAGE_IDS, isPublished, pagePath, publishedLangs, type PageId } from './pages'

type L = MioloveLang
// Dictionaries read at build / request time by the SERVER (metadata, structured data): this module is imported by server routes only, never by a client
// component, so these files stay out of the browser bundle. A language is added here together with its files, when it goes live (see langs.ts).
const DICT: Partial<Record<L, any>> = MIOLOVE_FULL
const dict = (lang: L): any => {
  const d = DICT[lang]
  if (!d) throw new Error(`MIOLOVE: no dictionary for "${lang}" (language not published)`)
  return d
}
/** Published languages, in registry order (hreflang, structured data, sitemap). */
export const SEO_LANGUAGES: readonly L[] = LIVE_LANGS
const hreflangs = () => SEO_LANGUAGES.map((l) => LANG_META[l].hreflang)
const ogAlternates = (lang: L) => SEO_LANGUAGES.filter((l) => l !== lang).map((l) => LANG_META[l].og)

const base = () => PORTAL_CONFIG.miolove.baseUrl
/** Absolute URL of a page in a language ("/" = Italian home); a page that is not published in `lang` resolves to its Italian URL. */
export const pageUrl = (id: PageId, lang: L): string => `${base()}${pagePath(id, lang)}`
/** Absolute URL of the home in one language (Italian = the bare root). */
export const homeUrl = (lang: L): string => pageUrl('home', lang)
/** Absolute URL of the "Idee per usare MIOLOVE" guide in one language (/idee, /en/ideas, /fr/idees, /es/ideas). */
export const ideasUrl = (lang: L): string => pageUrl('ideas', lang)

/** hreflang map of a page: ONLY the languages it is published in (drafts never appear), each pointing at its own URL, plus x-default (Italian when it exists). */
export function pageAlternates(id: PageId): Record<string, string> {
  const langs = publishedLangs(id)
  const languages: Record<string, string> = Object.fromEntries(langs.map((l) => [LANG_META[l].hreflang, pageUrl(id, l)]))
  languages['x-default'] = pageUrl(id, langs.includes(DEFAULT_LANG) ? DEFAULT_LANG : langs[0])
  return languages
}

/** A page is never rendered, nor described to search engines, in a language it is not published in. */
function assertPublished(id: PageId, lang: L): void {
  if (!isPublished(id, lang)) throw new Error(`MIOLOVE: page "${id}" is not published in "${lang}"`)
}

export function mioloveHomeMetadata(lang: L = 'it'): Metadata {
  assertPublished('home', lang)
  const m = dict(lang).home.meta as { title: string; description: string; ogTitle: string }
  const languages = pageAlternates('home')
  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: homeUrl(lang), languages },
    openGraph: {
      type: 'website', url: homeUrl(lang), siteName: 'MIOLOVE ALBUM', title: m.ogTitle, description: m.description,
      locale: LANG_META[lang].og, alternateLocale: ogAlternates(lang),
      images: [{ url: `${base()}/brand/miolove/miolove-album-logo.png` }],
    },
    twitter: { card: 'summary', title: m.ogTitle, description: m.description, images: [`${base()}/brand/miolove/miolove-album-logo.png`] },
    robots: { index: true, follow: true },
  }
}

export function mioloveIdeasMetadata(lang: L = 'it'): Metadata {
  assertPublished('ideas', lang)
  const m = dict(lang).ideas.meta as { title: string; description: string; ogTitle: string }
  const languages = pageAlternates('ideas')
  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: ideasUrl(lang), languages },
    openGraph: {
      type: 'article', url: ideasUrl(lang), siteName: 'MIOLOVE ALBUM', title: m.ogTitle, description: m.description,
      locale: LANG_META[lang].og, alternateLocale: ogAlternates(lang),
      images: [{ url: `${base()}/brand/miolove/miolove-album-logo.png` }],
    },
    twitter: { card: 'summary', title: m.ogTitle, description: m.description, images: [`${base()}/brand/miolove/miolove-album-logo.png`] },
    robots: { index: true, follow: true },
  }
}

/** schema.org graph of the guide: the article, its breadcrumb, the list of ideas and the FAQ (only text that is visible on the page). */
export function mioloveIdeasStructuredData(lang: L = 'it') {
  assertPublished('ideas', lang)
  const d = dict(lang).ideas
  const url = ideasUrl(lang), orgId = `${base()}/#organization`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Article', '@id': `${url}#article`, headline: d.hero.titleA + ' ' + d.hero.titleB, description: d.meta.description, inLanguage: LANG_META[lang].hreflang, mainEntityOfPage: url, author: { '@id': orgId }, publisher: { '@id': orgId } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: d.nav.breadcrumbHome, item: homeUrl(lang) },
        { '@type': 'ListItem', position: 2, name: d.nav.breadcrumbIdeas, item: url },
      ] },
      { '@type': 'ItemList', name: d.list.title, itemListElement: IDEAS.map((i, n) => ({ '@type': 'ListItem', position: n + 1, name: d.items[i.id].title, url: `${url}#${i.id}` })) },
      { '@type': 'FAQPage', mainEntity: FAQ_KEYS.map((k) => ({ '@type': 'Question', name: d.faq[k].q, acceptedAnswer: { '@type': 'Answer', text: d.faq[k].a } })) },
    ],
  }
}

/** schema.org graph: Organization + WebSite + SoftwareApplication with the two real offers. No aggregateRating / reviews: none exist. */
export function mioloveStructuredData(lang: L = 'it') {
  assertPublished('home', lang)
  const m = dict(lang).home.meta as { title: string; description: string }
  const orgId = `${base()}/#organization`, siteId = `${base()}/#website`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': orgId, name: 'MIOLOVE ALBUM', url: base(), logo: `${base()}/brand/miolove/miolove-album-logo.png` },
      { '@type': 'WebSite', '@id': siteId, url: base(), name: 'MIOLOVE ALBUM', inLanguage: hreflangs(), publisher: { '@id': orgId } },
      {
        '@type': 'SoftwareApplication', name: 'MIOLOVE ALBUM', url: base(), description: m.description, applicationCategory: 'LifestyleApplication',
        operatingSystem: 'Web', inLanguage: hreflangs(), publisher: { '@id': orgId },
        offers: [
          { '@type': 'Offer', name: dict(lang).albumPlan.trialName, price: '0', priceCurrency: 'EUR', url: `${base()}/register` },
          { '@type': 'Offer', name: dict(lang).albumPlan.albumName, price: ALBUM_PRICING.current[currencyForLocale(lang)].toFixed(2), priceCurrency: currencyForLocale(lang).toUpperCase(), url: `${base()}/register` },
        ],
      },
    ],
  }
}

/** robots.txt Disallow list of MIOLOVE (only /api/): pages that must stay out of the index use noindex instead and remain crawlable. Lives in indexing.ts. */
export { MIOLOVE_DISALLOW } from './indexing'
export { SINGLE_URL_PATHS } from './indexing'
import { SINGLE_URL_PATHS } from './indexing'
/** Public, indexable URLs of MIOLOVE (sitemap.xml), generated from the page registry: published pages only, pages first (registry order), then the legal documents. Login and sign-up are service pages (noindex): they are not listed. */
export const miolovePublicUrls = (): string[] => [...PAGE_IDS.flatMap((id) => publishedLangs(id).map((l) => pageUrl(id, l))), ...SINGLE_URL_PATHS.map((p) => `${base()}${p}`)]

// ── Secondary pages ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Login, sign-up, password and e-mail pages are client components whose language is the visitor's (unknown to the server), so their title / description
// follow the language the visitor last chose (server-readable cookie), Italian by default. They are noindex (follow: the link back to the home still counts) and carry NO canonical: the root layout no longer
// hands every page the home as canonical.
const SERVICE_META = {
  login: { title: 'Accedi', description: 'Accedi a MIOLOVE ALBUM per gestire i tuoi album, le foto degli invitati e lo slideshow dell’evento.' },
  register: { title: 'Crea il tuo account', description: 'Crea il tuo account MIOLOVE ALBUM e prova gratis per 7 giorni: un album condiviso dove gli invitati caricano le foto con un QR code.' },
  forgot: { title: 'Password dimenticata', description: 'Recupera l’accesso al tuo account MIOLOVE ALBUM: ti inviamo un’e-mail per scegliere una nuova password.' },
  reset: { title: 'Scegli una nuova password', description: 'Scegli una nuova password per il tuo account MIOLOVE ALBUM.' },
  verify: { title: 'Conferma la tua e-mail', description: 'Conferma l’indirizzo e-mail del tuo account MIOLOVE ALBUM.' },
} as const
export type MioloveServicePage = keyof typeof SERVICE_META

/** Robots directive of the service pages: kept out of the index, links still followed. */
export const MIOLOVE_SERVICE_ROBOTS = { index: false, follow: true } as const
/** Robots directive of the private area. */
export const MIOLOVE_PRIVATE_ROBOTS = { index: false, follow: false } as const

/** Title (the auth layout appends " — MIOLOVE ALBUM") and description of a service page; the robots directive comes from the auth layout. */
export function mioloveServiceMetadata(page: MioloveServicePage, lang: L = 'it'): Metadata {
  // The visitor's language (cookie) picks the wording; Italian constants are the fallback. Still noindex, no canonical, not in the sitemap.
  const m: { title: string; description: string } = DICT[lang]?.servicePages?.[page] ?? SERVICE_META[page]
  return { title: m.title, description: m.description, robots: MIOLOVE_SERVICE_ROBOTS }
}

const LEGAL_META = {
  privacy: { path: '/privacy', title: 'Informativa sulla privacy — MIOLOVE ALBUM', description: 'Come MIOLOVE ALBUM raccoglie, usa e protegge i dati dell’account e le foto degli album, e quali diritti hai sui tuoi dati (GDPR).' },
  terms: { path: '/terms', title: 'Termini di servizio — MIOLOVE ALBUM', description: 'Le condizioni che regolano l’uso di MIOLOVE ALBUM: account, album, contenuti degli invitati, pagamento e responsabilità.' },
} as const

/** Privacy policy / terms: indexable, each with its own canonical (the document itself follows the visitor's language; there is one URL per document). */
export function mioloveLegalMetadata(kind: 'privacy' | 'terms'): Metadata {
  const m = LEGAL_META[kind], url = `${base()}${m.path}`
  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url, siteName: 'MIOLOVE ALBUM', title: m.title, description: m.description, locale: LANG_META.it.og, images: [{ url: `${base()}/brand/miolove/miolove-album-logo.png` }] },
    twitter: { card: 'summary', title: m.title, description: m.description, images: [`${base()}/brand/miolove/miolove-album-logo.png`] },
    robots: { index: true, follow: true },
  }
}
