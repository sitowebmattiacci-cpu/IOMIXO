'use client'
import { useEffect, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAccountRole, isCoupleAllowedPath, COUPLE_HOME, type AccountType } from '@/lib/roles'
import { wrongPortalTarget } from '@/lib/portal'
import { useI18n } from '@/lib/i18n'

const Blank = () => <div className="min-h-screen bg-surface-400" aria-busy="true" />

/**
 * An account that opened the other portal's domain (couple on iomixo.com, DJ on miolovealbum.com) is sent to its own domain. Only active on real portal
 * hosts. Returns true while the redirect is in flight so the caller paints NOTHING of the wrong portal.
 */
function useWrongPortalRedirect(ready: boolean, accountType: AccountType): boolean {
  const pathname = usePathname()
  const target = ready && typeof window !== 'undefined'
    ? wrongPortalTarget({ accountType, hostname: window.location.hostname, pathname: pathname ?? '/', search: window.location.search })
    : null
  useEffect(() => { if (target) window.location.replace(target) }, [target])
  return !!target
}

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
  const { ready, isCouple, failed, retry, accountType } = useAccountRole()
  const router = useRouter()
  const wrongPortal = useWrongPortalRedirect(ready, accountType)
  useEffect(() => { if (ready && isCouple && !wrongPortal) router.replace(redirectTo) }, [ready, isCouple, wrongPortal, redirectTo, router])
  if (failed) return <RoleError onRetry={retry} />
  if (!ready || isCouple || wrongPortal) return <Blank />
  return <>{children}</>
}

/** Dashboard-wide gate: a Sposi account only gets the album routes; any other URL is replaced before it renders. */
export function DashboardRoleGuard({ children }: { children: ReactNode }) {
  const { ready, isCouple, failed, retry, accountType } = useAccountRole()
  const pathname = usePathname()
  const router = useRouter()
  const wrongPortal = useWrongPortalRedirect(ready, accountType)
  const blocked = isCouple && !isCoupleAllowedPath(pathname)
  useEffect(() => { if (ready && blocked && !wrongPortal) router.replace(COUPLE_HOME) }, [ready, blocked, wrongPortal, router])
  if (failed) return <RoleError onRetry={retry} />
  if (!ready || blocked || wrongPortal) return <Blank />
  // Sposi get the light MIOLOVE theme (CSS scope); DJ keeps the current dark one untouched.
  // Albums (/sessions/[id]) bring their own full MIOLOVE shell: the CSS scope is only for the shared dashboard pages.
  const themed = isCouple && !/^\/sessions\/[^/]+/.test(pathname ?? '')
  return <div className={themed ? 'couple-theme wedding-admin' : 'contents'} data-role={isCouple ? 'couple' : 'dj'}>{children}</div>
}
