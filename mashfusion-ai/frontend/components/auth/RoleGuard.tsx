'use client'
import { useEffect, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAccountRole, isCoupleAllowedPath, COUPLE_HOME } from '@/lib/roles'
import { useI18n } from '@/lib/i18n'

const Blank = () => <div className="min-h-screen bg-surface-400" aria-busy="true" />

/** Role read failed: never guess a role (and never paint DJ UI); offer a retry. */
function RoleError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-400 p-6" role="alert" data-testid="role-error">
      <div className="max-w-sm text-center">
        <p className="text-sm text-white/70">{t('roles.loadError')}</p>
        <button type="button" onClick={onRetry} data-testid="role-retry" className="mt-4 rounded-xl bg-[#FF2D8D] px-5 py-2.5 text-sm font-semibold text-white">{t('roles.retry')}</button>
      </div>
    </div>
  )
}

/** Renders nothing (never the DJ UI) until the role is known; a Sposi account is redirected away. */
export function DjOnly({ children, redirectTo = COUPLE_HOME }: { children: ReactNode; redirectTo?: string }) {
  const { ready, isCouple, failed, retry } = useAccountRole()
  const router = useRouter()
  useEffect(() => { if (ready && isCouple) router.replace(redirectTo) }, [ready, isCouple, redirectTo, router])
  if (failed) return <RoleError onRetry={retry} />
  if (!ready || isCouple) return <Blank />
  return <>{children}</>
}

/** Dashboard-wide gate: a Sposi account only gets the album routes; any other URL is replaced before it renders. */
export function DashboardRoleGuard({ children }: { children: ReactNode }) {
  const { ready, isCouple, failed, retry } = useAccountRole()
  const pathname = usePathname()
  const router = useRouter()
  const blocked = isCouple && !isCoupleAllowedPath(pathname)
  useEffect(() => { if (ready && blocked) router.replace(COUPLE_HOME) }, [ready, blocked, router])
  if (failed) return <RoleError onRetry={retry} />
  if (!ready || blocked) return <Blank />
  // Sposi get the light MIOLOVE theme (CSS scope); DJ keeps the current dark one untouched.
  // Albums (/sessions/[id]) bring their own full MIOLOVE shell: the CSS scope is only for the shared dashboard pages.
  const themed = isCouple && !/^\/sessions\/[^/]+/.test(pathname ?? '')
  return <div className={themed ? 'couple-theme wedding-admin' : 'contents'} data-role={isCouple ? 'couple' : 'dj'}>{children}</div>
}
