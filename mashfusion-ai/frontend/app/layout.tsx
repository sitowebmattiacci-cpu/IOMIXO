import type { Metadata, Viewport } from 'next'
import { Inter, Cormorant_Garamond, Playfair_Display, Great_Vibes, Dancing_Script, Cinzel, Tangerine } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import { I18nProvider } from '@/lib/i18n'
import './globals.css'

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

export const metadata: Metadata = {
  title: {
    default: 'IOMIXO — Live Hub Interattivo per DJ ed Eventi',
    template: '%s | IOMIXO',
  },
  description:
    'La regia interattiva per DJ, eventi e matrimoni. Coinvolgi il tuo pubblico con richieste musicali, dediche su schermo e giochi interattivi in tempo reale.',
  keywords: ['Live Hub', 'DJ', 'Matrimoni', 'Eventi', 'Richieste Musicali', 'Interactive DJ', 'Roulette Matrimonio'],
  openGraph: {
    type: 'website',
    locale: 'it_IT',
    url: 'https://iomixo.ai',
    siteName: 'IOMIXO',
    title: 'IOMIXO — Il Live Hub per il tuo evento',
    description: 'Rendi il tuo evento interattivo con richieste live, messaggi e giochi per il pubblico.',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'IOMIXO',
    description: 'Il Live Hub interattivo per DJ, eventi e matrimoni.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
}

export const viewport: Viewport = {
  themeColor: '#7c3aed',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${inter.variable} ${cormorant.variable} ${playfair.variable} ${greatVibes.variable} ${dancingScript.variable} ${cinzel.variable} ${tangerine.variable} dark`} suppressHydrationWarning>
      <body className="bg-surface-400 text-white antialiased" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false">
        <I18nProvider>
          {children}
          <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: 'rgba(15,15,25,0.95)',
              color: '#f0f0f5',
              border: '1px solid rgba(124,58,237,0.3)',
              backdropFilter: 'blur(20px)',
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
