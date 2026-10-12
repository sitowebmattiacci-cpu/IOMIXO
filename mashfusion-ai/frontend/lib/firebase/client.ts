import { getApps, getApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore'
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage'
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from 'firebase/app-check'
import { getFunctions, connectFunctionsEmulator, type Functions } from 'firebase/functions'

/**
 * Firebase Web SDK entry point (modular). Not used by the app yet — the
 * Supabase stack is still live. Config comes only from NEXT_PUBLIC_FIREBASE_*.
 *
 * With NEXT_PUBLIC_FIREBASE_USE_EMULATORS=true everything points to the local
 * Emulator Suite (project "demo-iomixo"), never to real Firebase services.
 */

const useEmulators = process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === 'true'

const cloudConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

// Emulator mode NEVER uses the real project: the Firebase config is replaced by the demo one, even if the
// real NEXT_PUBLIC_FIREBASE_* values are present in the environment. (An emulator serving another project id
// would not apply the rules of the project it was started with.)
const config = useEmulators
  ? { apiKey: 'demo-api-key', authDomain: 'demo-iomixo.firebaseapp.com', projectId: 'demo-iomixo', appId: 'demo-app-id', storageBucket: 'demo-iomixo.firebasestorage.app' }
  : cloudConfig

export function isFirebaseConfigured(): boolean {
  return useEmulators || Boolean(config.apiKey && config.projectId && config.appId)
}

/**
 * App Check (anti-abuse for callables). Public site key only; no secret lives in the frontend.
 * - Emulators: never (the Emulator Suite does not verify App Check).
 * - No key configured: skipped (callables still work while enforcement is off).
 * - Local debug: NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN is honoured ONLY on localhost / 127.0.0.1, so a token that
 *   leaks into a production bundle is inert on iomixo.com. Keep it in .env.local (git-ignored), never in a committed file.
 */
const appCheckKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY
const appCheckProvider = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_PROVIDER === 'v3' ? 'v3' : 'enterprise'

export function isAppCheckEnabled(): boolean {
  return !useEmulators && Boolean(appCheckKey) && typeof window !== 'undefined'
}

function initAppCheckOnce(app: FirebaseApp): void {
  if (!isAppCheckEnabled()) return
  const gl = globalThis as typeof globalThis & { __iomixoAppCheck?: boolean; FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }
  if (gl.__iomixoAppCheck) return // hot reload / repeated calls: initializeAppCheck throws if called twice
  gl.__iomixoAppCheck = true
  const debugToken = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN
  if (debugToken && ['localhost', '127.0.0.1'].includes(window.location.hostname)) gl.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken
  try {
    initializeAppCheck(app, {
      provider: appCheckProvider === 'v3' ? new ReCaptchaV3Provider(appCheckKey!) : new ReCaptchaEnterpriseProvider(appCheckKey!),
      isTokenAutoRefreshEnabled: true,
    })
  } catch (e) {
    // Never break the app because of App Check: calls just go out without a token (the server decides).
    console.warn('[firebase] App Check init failed', (e as Error).message)
  }
}

/** Idempotent: safe across Next.js hot reload and repeated calls. */
export function getFirebaseApp(): FirebaseApp {
  if (getApps().some((a) => a.name === '[DEFAULT]')) return getApp()
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured: set NEXT_PUBLIC_FIREBASE_* or NEXT_PUBLIC_FIREBASE_USE_EMULATORS=true')
  }
  const app = initializeApp(config)
  initAppCheckOnce(app) // right after the app exists and before any service is used
  return app
}

// Emulator connections must happen once per instance, before first use.
// Stored on globalThis so hot reload does not reconnect (which throws).
const g = globalThis as typeof globalThis & { __iomixoFbEmu?: Set<string> }
function once(key: string, fn: () => void) {
  const done = (g.__iomixoFbEmu ??= new Set())
  if (done.has(key)) return
  done.add(key)
  fn()
}

const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST ?? '127.0.0.1'

export function getFirebaseAuth(): Auth {
  const auth = getAuth(getFirebaseApp())
  if (useEmulators) once('auth', () => connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true }))
  return auth
}

export function getFirebaseDb(): Firestore {
  const db = getFirestore(getFirebaseApp())
  if (useEmulators) once('firestore', () => connectFirestoreEmulator(db, host, 8080))
  return db
}

export function getFirebaseStorage(): FirebaseStorage {
  const storage = getStorage(getFirebaseApp())
  if (useEmulators) once('storage', () => connectStorageEmulator(storage, host, 9199))
  return storage
}

/** Cloud Functions 2nd gen live in europe-west1 (see firebase/functions). */
export function getFirebaseFunctions(): Functions {
  const fns = getFunctions(getFirebaseApp(), 'europe-west1')
  if (useEmulators) once('functions', () => connectFunctionsEmulator(fns, host, 5001))
  return fns
}
