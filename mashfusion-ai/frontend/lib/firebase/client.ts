import { getFirestore, initializeFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore'
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage'
import { getFirebaseApp, host, once, useEmulators } from './app'

/**
 * Firebase Web SDK entry point for the app: everything from ./app (app, App Check, Auth, Functions) plus Firestore and Storage.
 * Code that only needs Auth (the AuthProvider on every page) imports ./app directly so the public pages do not ship Firestore / Storage.
 */
export * from './app'

/**
 * Firestore with automatic transport detection: the default streaming channel (WebChannel) is held up by some in-app browsers, proxies and
 * privacy layers, and a guest on such a phone would wait forever for the album's first read (and for the upload's event lookup). With auto-detect
 * the SDK falls back to long polling when streaming does not connect; where streaming works nothing changes. Not used with the emulators.
 * initializeFirestore may only run once per app, so a second call (hot reload, another module got there first) falls back to getFirestore.
 */
function firestoreInstance(): Firestore {
  const app = getFirebaseApp()
  if (useEmulators) return getFirestore(app)
  try { return initializeFirestore(app, { experimentalAutoDetectLongPolling: true }) } catch { return getFirestore(app) }
}

export function getFirebaseDb(): Firestore {
  const db = firestoreInstance()
  if (useEmulators) once('firestore', () => connectFirestoreEmulator(db, host, 8080))
  return db
}

export function getFirebaseStorage(): FirebaseStorage {
  const storage = getStorage(getFirebaseApp())
  if (useEmulators) once('storage', () => connectStorageEmulator(storage, host, 9199))
  return storage
}
