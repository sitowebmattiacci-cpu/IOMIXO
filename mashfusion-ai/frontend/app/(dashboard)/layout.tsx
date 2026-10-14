import { AuthGate } from '@/lib/auth/AuthProvider'
import { Sidebar } from '@/components/layout/Sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <div className="flex flex-col md:flex-row min-h-screen bg-surface-400">
        <Sidebar />
        <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
          {children}
        </main>
      </div>
    </AuthGate>
  )
}
