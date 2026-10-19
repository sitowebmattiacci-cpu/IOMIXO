'use client'
import useSWR from 'swr'
import { auth } from '@/lib/api'
import { useAuth } from '@/lib/auth/AuthProvider'
import type { User } from '@/types'
import { usePortal } from '@/components/portal/PortalProvider'
import type { PortalId } from '@/lib/portal'

export * from './roleRules'
import { resolveAccountType, resolvePortalMode, type AccountType } from './roleRules'

export interface AccountRole {
  /** False until the account document has been read: never render role-specific UI before. */
  ready: boolean
  /** The account document could not be read (error, not "missing"): no role is assumed. */
  failed: boolean
  retry: () => void
  /** Legacy users/{uid}.accountType. Informational only: it never decides the portal, the lists or the redirects. */
  accountType: AccountType
  /** The product the user is currently in (from the domain). */
  portal: PortalId
  /** true = the MIOLOVE portal is open (Sposi UI). Decided by the DOMAIN, so one account can use both products. */
  isCouple: boolean
  isDj: boolean
  user: User | undefined
}

export function useAccountRole(): AccountRole {
  const { user: authUser } = useAuth()
  const { config, matched } = usePortal()
  // Keyed by uid: the in-memory SWR cache must never leak a role from the previous account on the same tab.
  const { data: user, error, isLoading, mutate } = useSWR<User>(authUser ? ['account-role', authUser.uid] : null, () => auth.me(), { dedupingInterval: 30_000, shouldRetryOnError: false })
  // A missing doc / field is a legacy DJ (me() resolves). A read ERROR assumes nothing: ready stays false, failed is true.
  const failed = !!authUser && !user && !!error
  const accountType = resolveAccountType(user?.accountType)
  // Real portal domain: the domain is the product. Any other host (localhost, previews) keeps the legacy account-type behaviour so dev setups still work.
  const portal: PortalId = resolvePortalMode(matched ? config.id : null, accountType)
  return { ready: !!authUser && !isLoading && !!user, failed, retry: () => { void mutate() }, accountType, portal, isCouple: portal === 'miolove', isDj: portal === 'iomixo', user }
}
