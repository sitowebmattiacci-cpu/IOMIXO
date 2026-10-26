import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore'
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage'
import { getFirebaseApp, host, once, useEmulators } from './app'

/**
 * Firebase Web SDK entry point for the app: everything from ./app (app, App Check, Auth, Functions) plus Firestore and Storage.
 * Code that only needs Auth (the AuthProvider on every page) imports ./app directly so the public pages do not ship Firestore / Storage.
 */
export * from './app'

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
