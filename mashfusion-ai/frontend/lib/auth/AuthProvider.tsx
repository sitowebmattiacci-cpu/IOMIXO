'use client'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { authProvider } from './index'
import { onAuthChange, type FirebaseUser } from '@/lib/firebase/auth'

interface AuthState {
  /** Firebase user (null when signed out or when the legacy Supabase provider is active). */
  user:        FirebaseUser | null
  /** True until the persisted session has been restored. */
  loading:     boolean
  isAnonymous: boolean
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, isAnonymous: false })
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: authProvider() === 'firebase', isAnonymous: false })

  useEffect(() => {
    if (authProvider() !== 'firebase') { setState({ user: null, loading: false, isAnonymous: false }); return }
    return onAuthChange((user) => setState({ user, loading: false, isAnonymous: Boolean(user?.isAnonymous) }))
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

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
