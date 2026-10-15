import * as fb from '@/lib/firebase/auth'
import { initAccountProfile } from '@/lib/users/userService'
import type { AccountType } from '@/lib/firebase/models'

/** Single entry point for authentication used by pages: Firebase Auth is the only provider. */
export const authProvider = () => 'firebase' as const

export const authErrorMessage = (err: unknown, _fallback: string) => fb.mapAuthError(err)

export const signIn = (email: string, password: string) => fb.signInWithEmail(email, password).then(() => undefined)

export const signUp = async (email: string, password: string, fullName: string, accountType: AccountType = 'dj') => {
  await fb.signUpWithEmail(email, password, fullName)
  await initAccountProfile(accountType)
}

export const resendVerification = (_email: string) => fb.resendVerificationEmail()

export const signOut = () => fb.signOut()

export const requestPasswordReset = (email: string) => fb.requestPasswordReset(email)
