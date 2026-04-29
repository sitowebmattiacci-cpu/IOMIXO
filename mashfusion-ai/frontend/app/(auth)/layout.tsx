import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: {
    template: '%s — IOMIXO',
    default:  'IOMIXO',
  },
}

// Each auth page manages its own full-screen layout.
// This layout is a transparent passthrough to avoid double min-h-screen wrappers.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
