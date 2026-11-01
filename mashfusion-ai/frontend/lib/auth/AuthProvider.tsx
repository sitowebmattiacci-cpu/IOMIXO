'use client'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { authProvider } from './provider'
import { hasStoredFirebaseSession, mayDeferFirebase } from './deferAuth'
import type { FirebaseUser } from '@/lib/firebase/auth'     // type only: the SDK itself is loaded on demand (below), so a public page never downloads it

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
  const unsub = useRef<(() => void) | null>(null)
  const generation = useRef(0)                                                   // bumped on unmount: a late SDK load from a previous mount must not subscribe
  const pathname = usePathname()

  // Firebase (Auth + App Check + reCAPTCHA) starts once and stays on. The only exception is a MIOLOVE public page (home, guide, legal texts) opened by a browser that holds no Firebase session:
  // there is nobody to recognise, so nothing is loaded; the first page that needs Firebase (login, sign-up, the owner's area, a guest page) starts it, exactly as before.
  useEffect(() => {
    if (authProvider() !== 'firebase') { setState({ user: null, loading: false, isAnonymous: false }); return }
    if (unsub.current) return
    let cancelled = false
    const start = () => {
      if (cancelled || unsub.current) return
      setState((s) => (s.loading ? s : { ...s, loading: true }))
      unsub.current = () => {}                                                  // claimed: a second start() must not subscribe again while the SDK is loading
      const mine = generation.current
      import('@/lib/firebase/auth').then(({ onAuthChange }) => {
        if (generation.current !== mine) return                                  // unmounted meanwhile
        unsub.current = onAuthChange((user) => setState({ user, loading: false, isAnonymous: Boolean(user?.isAnonymous) }))
      })
    }
    if (!mayDeferFirebase(window.location.hostname, window.location.pathname)) { start(); return () => { cancelled = true } }
    hasStoredFirebaseSession().then((has) => {
      if (cancelled) return
      if (has) start()
      else setState({ user: null, loading: false, isAnonymous: false })
    })
    return () => { cancelled = true }
  }, [pathname])

  useEffect(() => () => { generation.current++; unsub.current?.(); unsub.current = null }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}
