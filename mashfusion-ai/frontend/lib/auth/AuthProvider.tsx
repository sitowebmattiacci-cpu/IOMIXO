'use client'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { authProvider } from './provider'
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
