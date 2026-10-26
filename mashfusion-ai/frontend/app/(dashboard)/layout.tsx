import { AuthGate } from '@/lib/auth/AuthGate'
import { DashboardRoleGuard } from '@/components/auth/RoleGuard'
import { MailLocaleSync } from '@/components/miolove/MailLocaleSync'
import { VerifyEmailNotice } from '@/components/miolove/VerifyEmailNotice'
import { Sidebar } from '@/components/layout/Sidebar'
import type { Metadata } from 'next'
import { getRequestPortal } from '@/lib/portalServer'
import { MIOLOVE_PRIVATE_ROBOTS } from '@/lib/miolove/seo'

// MIOLOVE: the owner's area is never indexed (the middleware also sends X-Robots-Tag). IOMIXO: unchanged.
export function generateMetadata(): Metadata {
  return getRequestPortal().config.id === 'miolove' ? { robots: MIOLOVE_PRIVATE_ROBOTS } : {}
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <DashboardRoleGuard>
        <MailLocaleSync />
        <div className="flex flex-col md:flex-row min-h-screen bg-surface-400">
          <Sidebar />
          <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
            <VerifyEmailNotice />
            {children}
          </main>
        </div>
      </DashboardRoleGuard>
    </AuthGate>
  )
}
