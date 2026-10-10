import { isFirebaseConfigured } from '@/lib/firebase/client'
import * as fb from '@/lib/firebase/auth'
import { legacy } from './legacySupabaseAuth'

/**
 * Single entry point for authentication used by pages and the API client.
 * Firebase is the primary provider whenever it is configured (NEXT_PUBLIC_FIREBASE_*
 * or emulators); otherwise the legacy Supabase path keeps current production working.
 */
export type AuthProviderName = 'firebase' | 'supabase'

/**
 * Provider selection. NEXT_PUBLIC_AUTH_PROVIDER=supabase forces the legacy provider even when the Firebase
 * config is present (connect Firebase without switching production auth, and keep the Firebase realtime
 * hooks dormant). Unset / 'firebase' → Firebase whenever it is configured (or emulators are on).
 * Emulator mode always wins over the switch so local emulator runs stay on Firebase.
 */
export const authProvider = (): AuthProviderName => {
  if (!isFirebaseConfigured()) return 'supabase'
  if (process.env.NEXT_PUBLIC_AUTH_PROVIDER === 'supabase' && process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS !== 'true') return 'supabase'
  return 'firebase'
}
const isFb = () => authProvider() === 'firebase'

export const authErrorMessage = (err: unknown, fallback: string) =>
  isFb() ? fb.mapAuthError(err) : err instanceof Error ? err.message : fallback

export const signIn = (email: string, password: string) =>
  isFb() ? fb.signInWithEmail(email, password).then(() => undefined) : legacy.signIn(email, password)

export const signUp = (email: string, password: string, fullName: string) =>
  isFb() ? fb.signUpWithEmail(email, password, fullName).then(() => undefined) : legacy.signUp(email, password, fullName)

export const resendVerification = (email: string) =>
  isFb() ? fb.resendVerificationEmail() : legacy.resend(email)

export const signOut = () => (isFb() ? fb.signOut() : legacy.signOut())

export const requestPasswordReset = (email: string) =>
  isFb() ? fb.requestPasswordReset(email) : legacy.requestPasswordReset(email)

/** Bearer token for the Express backend. */
export const getAuthToken = (): Promise<string | null> => (isFb() ? fb.getIdToken() : legacy.getToken())

export { legacy as legacySupabase }
