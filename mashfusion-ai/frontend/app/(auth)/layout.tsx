import type { Metadata } from 'next'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { MioloveLanguageSwitcher } from '@/components/wedding/MioloveLanguageSwitcher'
import { getRequestPortal } from '@/lib/portalServer'

export function generateMetadata(): Metadata {
  const { config } = getRequestPortal()
  const name = config.id === 'miolove' ? config.brand : 'IOMIXO'
  return { title: { template: `%s — ${name}`, default: name } }
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
