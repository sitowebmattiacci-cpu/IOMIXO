/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '100mb' },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.amazonaws.com' },
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      // Firebase Storage download URLs (profile avatars, server-published by commitAvatar)
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      // Local Storage emulator (browser tests only)
      ...(process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === 'true' ? [{ protocol: 'http', hostname: '127.0.0.1', port: '9199' }] : []),
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options',    value: 'nosniff' },
          { key: 'X-Frame-Options',           value: 'DENY' },
          { key: 'X-XSS-Protection',          value: '1; mode=block' },
          { key: 'Referrer-Policy',            value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',         value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
      // The owner's dashboard previews embed the REAL guest page and TV screen (same origin only: other sites still cannot frame them).
      {
        source: '/live/:slug',
        headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
      },
      {
        source: '/screen/:slug',
        headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
      },
    ]
  },
  // Redirect dei vecchi percorsi MashFusion AI (studio remix / progetti / download)
  // verso la dashboard IOMIXO Live Hub. Aggiunti 2026-06-08 nella pulizia legacy.
  async redirects() {
    return [
      { source: '/studio',          destination: '/dashboard', permanent: true },
      { source: '/studio/:path*',   destination: '/dashboard', permanent: true },
      { source: '/projects',        destination: '/dashboard', permanent: true },
      { source: '/projects/:path*', destination: '/dashboard', permanent: true },
      { source: '/download',        destination: '/dashboard', permanent: true },
      { source: '/download/:path*', destination: '/dashboard', permanent: true },
    ]
  },
}

module.exports = nextConfig
