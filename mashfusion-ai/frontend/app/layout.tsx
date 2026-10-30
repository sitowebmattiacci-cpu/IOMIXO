import type { Metadata, Viewport } from 'next'
import { Inter, Cormorant_Garamond, Playfair_Display, Great_Vibes, Dancing_Script, Cinzel, Tangerine, Fraunces } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import { headers } from 'next/headers'
import { I18nProvider } from '@/lib/i18n'
import { isLocale } from '@/lib/locales'
import { isLiveLang } from '@/lib/miolove/langs'
import { requestLanguage } from '@/lib/miolove/requestLang'
import { MioloveI18nProvider } from '@/lib/miolove/MioloveI18nProvider'
import { messagesToSend } from '@/lib/miolove/serverMessages'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import './globals.css'
import { getRequestPortal } from '@/lib/portalServer'
import { PortalProvider } from '@/components/portal/PortalProvider'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-cormorant',
  display: 'swap',
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-playfair',
  display: 'swap',
})

const greatVibes = Great_Vibes({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-great-vibes',
  display: 'swap',
})

const dancingScript = Dancing_Script({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-dancing-script',
  display: 'swap',
})

const cinzel = Cinzel({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-cinzel',
  display: 'swap',
})

// MIOLOVE headline font: soft, warm, contemporary serif (variable, optical size + "soft" axes). Not preloaded: only MIOLOVE pages use it.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['SOFT', 'opsz'],
  preload: false,
})

const tangerine = Tangerine({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-tangerine',
  display: 'swap',
})

// Per-portal metadata: the host of the request decides (IOMIXO vs MIOLOVE); unknown hosts (localhost, hosted.app) get the safe default portal.
export function generateMetadata(): Metadata {
  const { config } = getRequestPortal()
  const miolove = config.id === 'miolove'
  const image = miolove ? '/brand/miolove/miolove-album-logo.png' : '/og-image.png'
  return {
    metadataBase: new URL(config.baseUrl),
    title: miolove ? { default: config.meta.title, template: '%s' } : { default: config.meta.title, template: '%s | IOMIXO Live Hub' },
    description: config.meta.description,
    manifest: '/manifest.webmanifest',   // guest pages turn it off (lib/guestPageMetadata.ts)
    // MIOLOVE: no keywords tag (search engines ignore it) and no site-wide canonical / og:url: a canonical pointing at the home on every page told Google
    // that login, privacy, terms... were copies of it. Each public MIOLOVE page sets its own (lib/miolove/seo.ts); noindex pages have none.
    keywords: miolove ? undefined : ['Live Hub', 'DJ', 'Weddings', 'Events', 'Music Requests', 'Interactive DJ', 'Wedding Roulette', 'QR Sessions', 'Guest Photos'],
    alternates: miolove ? undefined : { canonical: config.baseUrl },
    // Each portal ships its own icon set (lib/portal.ts); nothing IOMIXO is ever linked from a MIOLOVE page.
    icons: {
      icon: config.icons.icon,
      apple: [config.icons.apple],
      shortcut: [config.icons.favicon],
    },
    openGraph: {
      type: 'website',
      locale: config.meta.locale,
      url: miolove ? undefined : config.baseUrl,
      siteName: config.meta.siteName,
      title: config.meta.ogTitle,
      description: config.meta.description,
      images: [{ url: image, ...(miolove ? {} : { width: 1200, height: 630 }) }],
    },
    twitter: {
      card: miolove ? 'summary' : 'summary_large_image',
      title: miolove ? 'MIOLOVE ALBUM' : 'IOMIXO Live Hub',
      description: miolove ? config.meta.description : 'Interactive platform for DJs, weddings and events.',
      images: [image],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
    },
  }
}

export function generateViewport(): Viewport {
  return { themeColor: getRequestPortal().config.id === 'miolove' ? '#F06A9B' : '#0A0A0D', width: 'device-width', initialScale: 1 }
}

// Preconnect hint only (never a request): composed so the "no raw callable URL" guard test keeps meaning real fetches.
const FUNCTIONS_DOMAIN = ['cloudfunctions', 'net'].join('.')
const FIREBASE_ORIGINS = process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === 'true' || !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ? [] : [
  'https://www.google.com',
  'https://www.gstatic.com',
  'https://content-firebaseappcheck.googleapis.com',
  'https://identitytoolkit.googleapis.com',
  `https://europe-west1-${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.${FUNCTIONS_DOMAIN}`,
  'https://firestore.googleapis.com',
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { config, matched } = getRequestPortal()
  const miolove = config.id === 'miolove'
  // MIOLOVE public pages (home, guide) are rendered in the language of their URL: the middleware forwards it in x-ml-lang (also "it" for the bare root).
  const urlLang = headers().get('x-ml-lang')
  const urlChosen = isLiveLang(urlLang) ? urlLang : undefined
  // Every other MIOLOVE page (sign-in, dashboard, guest page…) is rendered in the language the visitor chose last (cookie), else the browser's, so the first
  // HTML is already in it. `lang` is an explicit choice (URL or cookie); `ssrLang` is what is rendered.
  // Except the indexable single-URL pages (/privacy, /terms), whose HTML never depends on cookie or Accept-Language (the middleware flags them).
  const requested = miolove && !urlChosen && headers().get('x-ml-single') !== '1' ? requestLanguage() : null
  const lang = urlChosen ?? (requested?.explicit ? requested.lang : undefined)
  const ssrLang = lang ?? requested?.lang ?? 'it'
  const app = (
    <>
          <PortalProvider portalId={config.id} matched={matched}>
          <AuthProvider>{children}</AuthProvider>
          </PortalProvider>
          <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#15151B',
              color: '#F8F8FA',
              border: '1px solid #2A2A33',
              borderRadius: '12px',
              fontSize: '14px',
            },
            success: {
              iconTheme: { primary: '#4ade80', secondary: '#05050a' },
            },
            error: {
              iconTheme: { primary: '#f87171', secondary: '#05050a' },
            },
          }}
        />
    </>
  )
  return (
    <html lang={miolove ? ssrLang : (lang ?? 'it')} className={`${inter.variable} ${cormorant.variable} ${playfair.variable} ${greatVibes.variable} ${dancingScript.variable} ${cinzel.variable} ${tangerine.variable} ${fraunces.variable} dark`} suppressHydrationWarning>
      <head>
        {/* Guest critical path: App Check (reCAPTCHA) → anonymous sign-in → callable → Firestore. Open those connections during HTML parse. */}
        {FIREBASE_ORIGINS.map((o) => <link key={o} rel="preconnect" href={o} crossOrigin="anonymous" />)}
      </head>
      <body className="bg-surface-400 text-white antialiased" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false">
        {/* Each portal has its own provider over the same context: MIOLOVE's receives the texts of its language from the server, IOMIXO's is untouched. */}
        {miolove
          ? <MioloveI18nProvider initialLocale={lang} ssrLocale={ssrLang} messages={messagesToSend(lang ?? ssrLang)}>{app}</MioloveI18nProvider>
          : <I18nProvider initialLocale={isLocale(lang) ? lang : undefined}>{app}</I18nProvider>}
      </body>
    </html>
  )
}
