import type { Metadata } from 'next'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

export const metadata: Metadata = {
  title: {
    template: '%s — IOMIXO',
    default:  'IOMIXO',
  },
}

// Each auth page manages its own full-screen layout.
// We add a floating language switcher in the top-right so users can change
// language from any auth page (the choice persists across the whole site).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="fixed top-4 right-4 z-50">
        <LanguageSwitcher />
      </div>
      {children}
    </>
  )
}
