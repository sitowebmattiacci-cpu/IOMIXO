import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInAnonymously } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore'

/** An isolated Firebase client (own app instance) signed in as a fresh user. Emulators only. */
export interface TestClient { app: FirebaseApp; db: Firestore; uid: string; email: string; isAnonymous: boolean }

let n = 0
export async function newClient(kind: 'account' | 'anonymous' = 'account'): Promise<TestClient> {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: 'demo-iomixo' }, `t${Date.now()}-${n++}`)
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  const email = `u${Date.now()}${n}@example.com`
  const cred = kind === 'anonymous'
    ? await signInAnonymously(auth)
    : await createUserWithEmailAndPassword(auth, email, 'password123')
  return { app, db, uid: cred.user.uid, email, isAnonymous: kind === 'anonymous' }
}
export const closeClient = (c: TestClient) => deleteApp(c.app)

export async function denied(p: Promise<unknown>): Promise<boolean> {
  try { await p; return false } catch (e) { return (e as { code?: string }).code === 'permission-denied' }
}

/** A Firestore client with NO signed-in user. */
export function newSignedOutDb() {
  const app = initializeApp({ projectId: 'demo-iomixo' }, `signedout-${Date.now()}-${n++}`)
  const db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  return { app, db }
}
