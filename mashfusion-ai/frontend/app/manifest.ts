import type { MetadataRoute } from 'next'
import { getRequestPortal } from '@/lib/portalServer'

// Per-request (the host picks the portal), so each domain serves its own installable-app identity.
export const dynamic = 'force-dynamic'

export default function manifest(): MetadataRoute.Manifest {
  const { config } = getRequestPortal()
  if (config.id === 'miolove') {
    return {
      name: config.brand,
      short_name: 'MIOLOVE',
      description: config.meta.description,
      start_url: '/',
      display: 'standalone',
      background_color: '#FFFDFB',
      theme_color: '#F06A9B',
      icons: [
        { src: '/brand/miolove/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/brand/miolove/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/brand/miolove/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      ],
    }
  }
  return {
    name: config.brand,
    short_name: 'IOMIXO',
    description: 'Interactive platform for DJs, weddings and events.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0A0A0D',
    theme_color: '#0A0A0D',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
