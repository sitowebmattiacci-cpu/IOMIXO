import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasStoredFirebaseSession, isPublicMiolovePath, mayDeferFirebase } from '../../lib/auth/deferAuth'

// Pre-launch performance: the public MIOLOVE pages do not start Firebase / App Check / reCAPTCHA for a visitor without a session. IOMIXO and every other page keep today's behaviour.
test('DEFER-1. only MIOLOVE public pages (every published language, privacy, terms) may defer Firebase', () => {
  for (const p of ['/', '/idee', '/en', '/en/ideas', '/fr', '/fr/idees', '/es', '/es/ideas', '/privacy', '/terms', '/privacy/', '/en/']) assert.equal(isPublicMiolovePath(p), true, p)
  for (const p of ['/login', '/register', '/forgot-password', '/verify-email', '/sessions', '/sessions/abc', '/live/x', '/booth/x', '/screen/x', '/auth/action', '/onboarding', '/billing', '/de', '/kontakt', '/impressum', '/widerruf', '/nonexistent', '/dashboard']) assert.equal(isPublicMiolovePath(p), false, p)
})

test('DEFER-2. IOMIXO and unknown hosts never defer; the MIOLOVE host defers only its public pages', () => {
  for (const host of ['iomixo.com', 'www.iomixo.com', 'localhost', '127.0.0.1', 'something.hosted.app']) for (const p of ['/', '/privacy', '/en']) assert.equal(mayDeferFirebase(host, p), false, `${host}${p}`)
  assert.equal(mayDeferFirebase('miolovealbum.com', '/'), true); assert.equal(mayDeferFirebase('www.miolovealbum.com', '/en/ideas'), true)
  assert.equal(mayDeferFirebase('miolovealbum.com', '/login'), false); assert.equal(mayDeferFirebase('miolovealbum.com', '/sessions'), false)
})

// A tiny in-memory IndexedDB: just the calls hasStoredFirebaseSession makes.
function fakeIdb(opts: { dbs?: string[] | 'unsupported'; keys?: string[]; hasStore?: boolean; openError?: boolean }): IDBFactory {
  const ok = (v: unknown) => { const r: any = { result: v }; queueMicrotask(() => r.onsuccess?.()); return r }
  const f: any = {
    open: () => {
      const r: any = {}
      queueMicrotask(() => {
        if (opts.openError) { r.onerror?.(); return }
        r.result = { objectStoreNames: { contains: () => opts.hasStore !== false }, close() {}, transaction: () => ({ objectStore: () => ({ getAllKeys: () => ok(opts.keys ?? []) }) }) }
        r.onsuccess?.()
      })
      return r
    },
  }
  if (opts.dbs !== 'unsupported') f.databases = async () => ((opts.dbs as string[] | undefined) ?? []).map((name) => ({ name }))
  return f as IDBFactory
}
test('DEFER-3. a stored Firebase session starts Firebase; no database, an empty store or only unrelated keys do not; any doubt starts it (today\'s behaviour)', async () => {
  assert.equal(await hasStoredFirebaseSession(fakeIdb({ dbs: [] })), false, 'a first visit: no database')
  assert.equal(await hasStoredFirebaseSession(fakeIdb({ dbs: ['firebaseLocalStorageDb'], keys: [] })), false, 'signed out: empty store')
  assert.equal(await hasStoredFirebaseSession(fakeIdb({ dbs: ['firebaseLocalStorageDb'], keys: ['firebase:persistence:abc'] })), false, 'no user key')
  assert.equal(await hasStoredFirebaseSession(fakeIdb({ dbs: ['firebaseLocalStorageDb'], hasStore: false })), false)
  assert.equal(await hasStoredFirebaseSession(fakeIdb({ dbs: ['other', 'firebaseLocalStorageDb'], keys: ['firebase:authUser:AIza:[DEFAULT]'] })), true, 'a returning customer')
  assert.equal(await hasStoredFirebaseSession(fakeIdb({ dbs: 'unsupported' })), true, 'cannot tell → load Firebase')
  assert.equal(await hasStoredFirebaseSession(fakeIdb({ dbs: ['firebaseLocalStorageDb'], openError: true })), true, 'error → load Firebase')
  assert.equal(await hasStoredFirebaseSession(undefined), true, 'no IndexedDB at all → load Firebase')
})
