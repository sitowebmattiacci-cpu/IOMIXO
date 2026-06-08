/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '100mb' },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.amazonaws.com' },
      { protocol: 'https', hostname: 'res.cloudinary.com' },
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
