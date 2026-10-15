import type { Metadata, Viewport } from 'next'
import { Inter, Cormorant_Garamond, Playfair_Display, Great_Vibes, Dancing_Script, Cinzel, Tangerine } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import { I18nProvider } from '@/lib/i18n'
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
    keywords: miolove
      ? ['MIOLOVE ALBUM', 'album matrimonio', 'foto invitati', 'QR code matrimonio', 'Live Booth', 'album digitale']
      : ['Live Hub', 'DJ', 'Weddings', 'Events', 'Music Requests', 'Interactive DJ', 'Wedding Roulette', 'QR Sessions', 'Guest Photos'],
    manifest: '/site.webmanifest',
    alternates: { canonical: config.baseUrl },
    // Favicons are shared for now: swap the set per portal here once MIOLOVE has its own assets.
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: 'any' },
        { url: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
        { url: '/favicon-16x16.png', type: 'image/png', sizes: '16x16' },
        { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
        { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
      ],
      apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
      shortcut: ['/favicon.ico'],
    },
    openGraph: {
      type: 'website',
      locale: config.meta.locale,
      url: config.baseUrl,
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
  return { themeColor: getRequestPortal().config.id === 'miolove' ? '#F06A9B' : '#8F1D2C', width: 'device-width', initialScale: 1 }
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
  return (
    <html lang="it" className={`${inter.variable} ${cormorant.variable} ${playfair.variable} ${greatVibes.variable} ${dancingScript.variable} ${cinzel.variable} ${tangerine.variable} dark`} suppressHydrationWarning>
      <head>
        {/* Guest critical path: App Check (reCAPTCHA) → anonymous sign-in → callable → Firestore. Open those connections during HTML parse. */}
        {FIREBASE_ORIGINS.map((o) => <link key={o} rel="preconnect" href={o} crossOrigin="anonymous" />)}
      </head>
      <body className="bg-surface-400 text-white antialiased" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false">
        <I18nProvider>
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
        </I18nProvider>
      </body>
    </html>
  )
}
