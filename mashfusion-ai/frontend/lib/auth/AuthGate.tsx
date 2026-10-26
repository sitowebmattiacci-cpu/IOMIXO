'use client'
import { useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { authProvider } from './provider'
import { useAuth } from './AuthProvider'

// Its own module on purpose: the owner's layout (and the DJ remote) reference it from the server. Next 14 merges the chunk lists of every server reference to a
// client module, so when AuthGate lived in AuthProvider.tsx the public pages (which use the AuthProvider of the root layout) also downloaded the whole
// dashboard bundle (Firestore, repositories, ~900 KB).
/**
 * Client-side gate for protected pages. With Firebase it redirects signed-out
 * and anonymous visitors to /login. With the legacy provider it is a no-op
 * (protection there is the API 401 → /login redirect, as before).
 * Real authorisation always happens on the backend.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, isAnonymous } = useAuth()
  const router = useRouter()
  const gated = authProvider() === 'firebase'
  const allowed = !gated || (user && !isAnonymous)

  useEffect(() => {
    if (gated && !loading && !allowed) router.replace('/login')
  }, [gated, loading, allowed, router])

  if (gated && (loading || !allowed)) {
    return <div className="min-h-screen bg-surface-400" aria-busy="true" />
  }
  return <>{children}</>
}
