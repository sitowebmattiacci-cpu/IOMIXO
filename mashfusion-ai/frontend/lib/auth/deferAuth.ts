import { getPortalFromHostname } from '../portal'
import { resolvePublicPath } from '../miolove/pages'

/**
 * MIOLOVE public pages (home, guide, legal texts in every language) are read by visitors who, almost always, have no account: they need no Firebase, no sign-in check, no App Check and
 * no reCAPTCHA. Firebase is started there ONLY when the browser already holds a Firebase session (a returning customer: the header must show "my albums"). Everything else starts it
 * exactly as before: login, sign-up, the owner's area, guest pages. Pure helpers: unit-tested; IOMIXO is never deferred.
 */
const SINGLE_PUBLIC = new Set(['/privacy', '/terms'])
const clean = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** A public, indexable MIOLOVE page that works without knowing who the visitor is. */
export const isPublicMiolovePath = (path: string): boolean => resolvePublicPath(path) !== null || SINGLE_PUBLIC.has(clean(path))

/** Should Firebase wait on this page of this host? Only MIOLOVE, only its public pages. */
export const mayDeferFirebase = (hostname: string, path: string): boolean => getPortalFromHostname(hostname) === 'miolove' && isPublicMiolovePath(path)

const DB = 'firebaseLocalStorageDb', STORE = 'firebaseLocalStorage'
/**
 * Does this browser hold a Firebase Auth session (signed in or anonymous guest)? Read straight from the SDK's own IndexedDB, without loading the SDK. When the browser cannot tell
 * (no indexedDB.databases(), an error) the answer is "yes": the page then behaves exactly as it did before this optimisation.
 */
export async function hasStoredFirebaseSession(idb: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): Promise<boolean> {
  try {
    if (!idb || typeof idb.databases !== 'function') return true
    if (!(await idb.databases()).some((d) => d.name === DB)) return false
    return await new Promise<boolean>((resolve) => {
      const open = idb.open(DB)
      open.onerror = () => resolve(true)
      open.onsuccess = () => {
        const db = open.result
        try {
          if (!db.objectStoreNames.contains(STORE)) { db.close(); resolve(false); return }
          const keys = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys()
          keys.onsuccess = () => { db.close(); resolve(keys.result.some((k) => String(k).startsWith('firebase:authUser:'))) }
          keys.onerror = () => { db.close(); resolve(true) }
        } catch { db.close(); resolve(true) }
      }
    })
  } catch { return true }
}
