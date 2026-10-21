// SEO of the MIOLOVE public home: metadata, hreflang alternates and structured data. Pure module (no React / next imports besides types): unit-tested.
import type { Metadata } from 'next'
import it from '@/locales/miolove/it.json'
import en from '@/locales/miolove/en.json'
import fr from '@/locales/miolove/fr.json'
import es from '@/locales/miolove/es.json'
import { PORTAL_CONFIG } from '@/lib/portal'
import { currencyForLocale } from '../pricing'
import { ALBUM_PRICING } from './plans'
import { IDEAS_PATH, HOME_PATH } from './paths'
import { IDEAS, FAQ_KEYS } from './ideas'

type L = 'it' | 'en' | 'fr' | 'es'
const DICT: Record<L, any> = { it, en, fr, es }
const OG_LOCALE: Record<L, string> = { it: 'it_IT', en: 'en_GB', fr: 'fr_FR', es: 'es_ES' }
export const SEO_LANGUAGES: L[] = ['it', 'en', 'fr', 'es']

const base = () => PORTAL_CONFIG.miolove.baseUrl
/** Absolute URL of the home in one language (Italian = the bare root). */
export const homeUrl = (lang: L): string => (lang === 'it' ? `${base()}/` : `${base()}${HOME_PATH[lang]}`)
/** Absolute URL of the "Idee per usare MIOLOVE" guide in one language (/idee, /en/ideas, /fr/idees, /es/ideas). */
export const ideasUrl = (lang: L): string => `${base()}${IDEAS_PATH[lang]}`

export function mioloveHomeMetadata(lang: L = 'it'): Metadata {
  const m = DICT[lang].home.meta as { title: string; description: string; ogTitle: string }
  const languages: Record<string, string> = Object.fromEntries(SEO_LANGUAGES.map((l) => [l, homeUrl(l)]))
  languages['x-default'] = homeUrl('it')
  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: homeUrl(lang), languages },
    openGraph: {
      type: 'website', url: homeUrl(lang), siteName: 'MIOLOVE ALBUM', title: m.ogTitle, description: m.description,
      locale: OG_LOCALE[lang], alternateLocale: SEO_LANGUAGES.filter((l) => l !== lang).map((l) => OG_LOCALE[l]),
      images: [{ url: `${base()}/brand/miolove/miolove-album-logo.png` }],
    },
    twitter: { card: 'summary', title: m.ogTitle, description: m.description, images: [`${base()}/brand/miolove/miolove-album-logo.png`] },
    robots: { index: true, follow: true },
  }
}

export function mioloveIdeasMetadata(lang: L = 'it'): Metadata {
  const m = DICT[lang].ideas.meta as { title: string; description: string; ogTitle: string }
  const languages: Record<string, string> = Object.fromEntries(SEO_LANGUAGES.map((l) => [l, ideasUrl(l)]))
  languages['x-default'] = ideasUrl('it')
  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: ideasUrl(lang), languages },
    openGraph: {
      type: 'article', url: ideasUrl(lang), siteName: 'MIOLOVE ALBUM', title: m.ogTitle, description: m.description,
      locale: OG_LOCALE[lang], alternateLocale: SEO_LANGUAGES.filter((l) => l !== lang).map((l) => OG_LOCALE[l]),
      images: [{ url: `${base()}/brand/miolove/miolove-album-logo.png` }],
    },
    twitter: { card: 'summary', title: m.ogTitle, description: m.description, images: [`${base()}/brand/miolove/miolove-album-logo.png`] },
    robots: { index: true, follow: true },
  }
}

/** schema.org graph of the guide: the article, its breadcrumb, the list of ideas and the FAQ (only text that is visible on the page). */
export function mioloveIdeasStructuredData(lang: L = 'it') {
  const d = DICT[lang].ideas
  const url = ideasUrl(lang), orgId = `${base()}/#organization`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Article', '@id': `${url}#article`, headline: d.hero.titleA + ' ' + d.hero.titleB, description: d.meta.description, inLanguage: lang, mainEntityOfPage: url, author: { '@id': orgId }, publisher: { '@id': orgId } },
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
  const m = DICT[lang].home.meta as { title: string; description: string }
  const orgId = `${base()}/#organization`, siteId = `${base()}/#website`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': orgId, name: 'MIOLOVE ALBUM', url: base(), logo: `${base()}/brand/miolove/miolove-album-logo.png` },
      { '@type': 'WebSite', '@id': siteId, url: base(), name: 'MIOLOVE ALBUM', inLanguage: SEO_LANGUAGES, publisher: { '@id': orgId } },
      {
        '@type': 'SoftwareApplication', name: 'MIOLOVE ALBUM', url: base(), description: m.description, applicationCategory: 'LifestyleApplication',
        operatingSystem: 'Web', inLanguage: SEO_LANGUAGES, publisher: { '@id': orgId },
        offers: [
          { '@type': 'Offer', name: DICT[lang].albumPlan.trialName, price: '0', priceCurrency: 'EUR', url: `${base()}/register` },
          { '@type': 'Offer', name: DICT[lang].albumPlan.albumName, price: ALBUM_PRICING.current[currencyForLocale(lang)].toFixed(2), priceCurrency: currencyForLocale(lang).toUpperCase(), url: `${base()}/register` },
        ],
      },
    ],
  }
}

/** Paths of MIOLOVE that must never be crawled (robots.txt): the owner's area, guest album pages, the TV screen and the auth handlers. */
export const MIOLOVE_DISALLOW = ['/live/', '/booth/', '/screen/', '/remote/', '/sessions', '/onboarding', '/billing', '/settings', '/auth/', '/api/']
/** Public, indexable URLs of MIOLOVE (sitemap.xml). */
export const miolovePublicUrls = (): string[] => [...SEO_LANGUAGES.map(homeUrl), ...SEO_LANGUAGES.map(ideasUrl), `${base()}/login`, `${base()}/register`, `${base()}/privacy`, `${base()}/terms`]
