import { getApps, getApp, initializeApp, applicationDefault, type App } from 'firebase-admin/app'
import type { Auth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getStorage, type Storage } from 'firebase-admin/storage'

/**
 * Firebase Admin entry point. Not wired into any route yet (Supabase Auth is
 * still the active middleware). Lazy: nothing is initialised on import.
 *
 * Credentials: never hardcoded. In production use Application Default
 * Credentials (GOOGLE_APPLICATION_CREDENTIALS or the runtime service account).
 * With FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST /
 * FIREBASE_STORAGE_EMULATOR_HOST set, the Admin SDK talks to the emulators
 * and needs no credentials.
 */

const usingEmulators = Boolean(
  process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST
)

/** True when Firebase Admin can verify tokens (project id set, or emulator). */
export function isFirebaseAuthConfigured(): boolean {
  return Boolean(process.env.FIREBASE_PROJECT_ID) || usingEmulators
}

export function getFirebaseAdminApp(): App {
  if (getApps().length) return getApp()
  const projectId = process.env.FIREBASE_PROJECT_ID ?? (usingEmulators ? 'demo-iomixo' : undefined)
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not set')
  return initializeApp({
    projectId,
    ...(usingEmulators ? {} : { credential: applicationDefault() }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  })
}

// Lazy require: 'firebase-admin/auth' pulls ESM-only deps (jose) that Jest cannot load,
// and Firestore-only code paths (repositories) should not pay for them.
export const firebaseAuth = (): Auth =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (require('firebase-admin/auth') as typeof import('firebase-admin/auth')).getAuth(getFirebaseAdminApp())
export const firestore = (): Firestore => getFirestore(getFirebaseAdminApp())
export const firebaseStorage = (): Storage => getStorage(getFirebaseAdminApp())
