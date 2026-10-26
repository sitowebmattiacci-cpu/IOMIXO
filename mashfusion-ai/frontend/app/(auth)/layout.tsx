import type { Metadata } from 'next'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { MioloveLanguageSwitcher } from '@/components/wedding/MioloveLanguageSwitcher'
import { getRequestPortal } from '@/lib/portalServer'
import { MIOLOVE_SERVICE_ROBOTS } from '@/lib/miolove/seo'

export function generateMetadata(): Metadata {
  const { config } = getRequestPortal()
  const miolove = config.id === 'miolove'
  const name = miolove ? config.brand : 'IOMIXO'
  // MIOLOVE: sign-in / sign-up / password / e-mail pages are not for search engines (noindex, links still followed). IOMIXO: unchanged.
  return { title: { template: `%s — ${name}`, default: name }, ...(miolove ? { robots: MIOLOVE_SERVICE_ROBOTS } : {}) }
}

// Each auth page manages its own full-screen layout.
// We add a floating language switcher in the top-right so users can change
// language from any auth page (the choice persists across the whole site).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { config } = getRequestPortal()
  return (
    <>
      <div className="fixed top-4 right-4 z-50">
        {config.id === 'miolove' ? <MioloveLanguageSwitcher /> : <LanguageSwitcher />}
      </div>
      {children}
    </>
  )
}
