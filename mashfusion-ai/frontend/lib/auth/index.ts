import * as fb from '@/lib/firebase/auth'
import { initAccountProfile } from '@/lib/users/userService'
import type { AccountType } from '@/lib/firebase/models'

/** Single entry point for authentication used by pages: Firebase Auth is the only provider. */
export const authProvider = () => 'firebase' as const

export const authErrorMessage = (err: unknown, _fallback: string) => fb.mapAuthError(err)

/** i18n key (auth.err.*) for a Firebase auth error code, or null when unmapped. */
export const authErrorI18nKey = (err: unknown): string | null => {
  switch ((err as { code?: string })?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'auth.err.invalidCredential'
    case 'auth/missing-email':
    case 'auth/invalid-email': return 'auth.err.invalidEmail'
    case 'auth/email-already-in-use': return 'auth.err.emailInUse'
    case 'auth/missing-password':
    case 'auth/weak-password': return 'auth.passwordMin8'
    case 'auth/too-many-requests': return 'auth.err.tooMany'
    case 'auth/network-request-failed': return 'auth.err.network'
    case 'auth/user-disabled': return 'auth.err.disabled'
    case 'auth/expired-action-code':
    case 'auth/invalid-action-code': return 'auth.err.badLink'
    default: return null
  }
}

/** Translated, user-facing message for any auth error: never the raw (English / technical) Firebase text. */
export const authErrorText = (err: unknown, t: (path: string) => string): string => t(authErrorI18nKey(err) ?? 'auth.err.generic')

export const signIn = (email: string, password: string) => fb.signInWithEmail(email, password).then(() => undefined)

export const signUp = async (email: string, password: string, fullName: string, accountType: AccountType = 'dj') => {
  await fb.signUpWithEmail(email, password, fullName)
  await initAccountProfile(accountType)
}

/**
 * Google sign-in for a portal. The account document is created ONLY when this uid has none yet (initAccountProfile is a no-op otherwise), so
 * signing in with Google on the other portal, or after an e-mail sign-up, never creates a second profile and never changes the stored role.
 */
export const signInWithGoogle = async (accountType: AccountType = 'dj') => {
  const { user, isNewUser } = await fb.signInWithGoogle()
  await initAccountProfile(accountType)
  return { user, isNewUser }
}

/** i18n key for a failed Google sign-in; null = the user simply closed / replaced the popup (nothing to say). */
export const googleErrorI18nKey = (err: unknown): string | null => {
  switch ((err as { code?: string })?.code) {
    case 'auth/cancelled-popup-request': return null
    case 'auth/popup-closed-by-user': return 'auth.google.closed'
    case 'auth/popup-blocked': return 'auth.google.blocked'
    case 'auth/account-exists-with-different-credential':
    case 'auth/credential-already-in-use':
    case 'auth/email-already-in-use': return 'auth.google.collision'
    case 'auth/network-request-failed': return 'auth.err.network'
    case 'auth/too-many-requests': return 'auth.err.tooMany'
    case 'auth/user-disabled': return 'auth.err.disabled'
    case 'auth/operation-not-allowed':
    case 'auth/unauthorized-domain': return 'auth.google.unavailable'
    default: return 'auth.google.failed'
  }
}

export const resendVerification = (_email: string) => fb.resendVerificationEmail()

export const signOut = () => fb.signOut()

export const requestPasswordReset = (email: string) => fb.requestPasswordReset(email)
