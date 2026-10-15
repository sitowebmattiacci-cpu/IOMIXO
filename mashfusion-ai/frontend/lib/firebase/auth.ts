import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut,
  signInAnonymously, onAuthStateChanged, sendPasswordResetEmail, sendEmailVerification,
  confirmPasswordReset, verifyPasswordResetCode, applyActionCode, updateProfile,
  type User, type Unsubscribe,
} from 'firebase/auth'
import { getFirebaseAuth } from './client'
import { getPortalFromHostname, PORTAL_CONFIG } from '../portal'

/**
 * Centralised Firebase Auth service. UI code must go through this module (or
 * `lib/auth`) instead of calling the Firebase SDK directly.
 * Session persistence is the SDK default (IndexedDB, survives reload).
 */

export type { User as FirebaseUser }

/** Verification / reset emails send the user back to the portal they signed up on (its canonical origin on a real portal host, the current origin elsewhere). */
const actionSettings = () => {
  const portal = getPortalFromHostname(window.location.hostname)
  return { url: `${portal ? PORTAL_CONFIG[portal].baseUrl : window.location.origin}/login` }
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(getFirebaseAuth(), email, password)
  return cred.user
}

/** Creates the account, stores the display name and sends the verification email. */
export async function signUpWithEmail(email: string, password: string, fullName: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password)
  if (fullName) await updateProfile(cred.user, { displayName: fullName })
  await sendEmailVerification(cred.user, actionSettings())
  return cred.user
}

export async function resendVerificationEmail(): Promise<void> {
  const u = getFirebaseAuth().currentUser
  if (!u) throw new Error('Sign in again to resend the verification email.')
  await sendEmailVerification(u, actionSettings())
}

export const signOut = () => fbSignOut(getFirebaseAuth())

export const requestPasswordReset = (email: string) =>
  sendPasswordResetEmail(getFirebaseAuth(), email, actionSettings())

/** Returns the account email for a valid reset code (throws if expired/invalid). */
export const checkPasswordResetCode = (oobCode: string) =>
  verifyPasswordResetCode(getFirebaseAuth(), oobCode)

export const completePasswordReset = (oobCode: string, newPassword: string) =>
  confirmPasswordReset(getFirebaseAuth(), oobCode, newPassword)

export const confirmEmailVerification = (oobCode: string) =>
  applyActionCode(getFirebaseAuth(), oobCode)

export function onAuthChange(cb: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(getFirebaseAuth(), cb)
}

/** Resolves once the persisted session (if any) has been restored. */
export async function waitForAuthReady(): Promise<User | null> {
  const auth = getFirebaseAuth()
  await auth.authStateReady()
  return auth.currentUser
}

/** Current user's ID token; the SDK refreshes it automatically when expired. */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const user = await waitForAuthReady()
  return user ? user.getIdToken(forceRefresh) : null
}

/**
 * Guest / TV / Remote identity. Reuses any existing session (anonymous or not)
 * so no throw-away anonymous accounts are created on every visit.
 */
// One in-flight sign-in: concurrent callers (page hooks + callables) must not each create an anonymous account.
let anonymousInFlight: Promise<User> | null = null

export async function ensureAnonymousSession(): Promise<User> {
  const existing = await waitForAuthReady()
  if (existing) return existing
  anonymousInFlight ??= signInAnonymously(getFirebaseAuth())
    .then((c) => c.user)
    .finally(() => { anonymousInFlight = null })
  return anonymousInFlight
}

/** Maps Firebase auth error codes to messages suitable for the UI. */
export function mapAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':       return 'Invalid email or password'
    case 'auth/invalid-email':        return 'Invalid email address'
    case 'auth/email-already-in-use': return 'An account with this email already exists'
    case 'auth/weak-password':        return 'Password must be at least 8 characters'
    case 'auth/too-many-requests':    return 'Too many attempts. Try again in a few minutes'
    case 'auth/network-request-failed': return 'Network error. Check your connection'
    case 'auth/user-disabled':        return 'This account has been disabled'
    case 'auth/expired-action-code':
    case 'auth/invalid-action-code':  return 'This link is invalid or has expired'
    default: return err instanceof Error ? err.message : 'Authentication failed'
  }
}
