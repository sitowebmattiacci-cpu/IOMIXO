'use client'
import useSWR from 'swr'
import { auth } from '@/lib/api'
import { useAuth } from '@/lib/auth/AuthProvider'
import type { User } from '@/types'

export * from './roleRules'
import { resolveAccountType, type AccountType } from './roleRules'

export interface AccountRole {
  /** False until the account document has been read: never render role-specific UI before. */
  ready: boolean
  /** The account document could not be read (error, not "missing"): no role is assumed. */
  failed: boolean
  retry: () => void
  accountType: AccountType
  isCouple: boolean
  isDj: boolean
  user: User | undefined
}

export function useAccountRole(): AccountRole {
  const { user: authUser } = useAuth()
  // Keyed by uid: the in-memory SWR cache must never leak a role from the previous account on the same tab.
  const { data: user, error, isLoading, mutate } = useSWR<User>(authUser ? ['account-role', authUser.uid] : null, () => auth.me(), { dedupingInterval: 30_000, shouldRetryOnError: false })
  // A missing doc / field is a legacy DJ (me() resolves). A read ERROR assumes nothing: ready stays false, failed is true.
  const failed = !!authUser && !user && !!error
  const accountType = resolveAccountType(user?.accountType)
  return { ready: !!authUser && !isLoading && !!user, failed, retry: () => { void mutate() }, accountType, isCouple: accountType === 'couple', isDj: accountType === 'dj', user }
}
