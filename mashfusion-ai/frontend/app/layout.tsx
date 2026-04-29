import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'IOMIXO — AI-Powered Mashup & Remix Studio',
    template: '%s | IOMIXO',
  },
  description:
    'Professional AI-powered music mashup, remix, and fusion studio. Upload two songs and let our AI create a professional DJ-quality mashup in minutes.',
  keywords: ['AI mashup', 'AI remix', 'song fusion', 'music AI', 'stem separation', 'DJ tool'],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://iomixo.ai',
    siteName: 'IOMIXO',
    title: 'IOMIXO — AI-Powered Mashup & Remix Studio',
    description: 'Transform any two songs into a professional mashup with AI.',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'IOMIXO',
    description: 'AI-powered professional mashup & remix studio.',
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
    <html lang="en" translate="no" className={`${inter.variable} dark`} suppressHydrationWarning>
      <body className="bg-surface-400 text-white antialiased" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false">
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
      </body>
    </html>
  )
}
