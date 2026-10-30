import type { Metadata } from 'next'

// Diagnostic tool for the owner's phone tests: never indexed, no web-app manifest.
export const metadata: Metadata = { manifest: null, robots: { index: false, follow: false } }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
