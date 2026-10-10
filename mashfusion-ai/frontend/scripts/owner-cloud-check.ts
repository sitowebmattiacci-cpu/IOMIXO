/**
 * Isolated Firebase auth check for the OWNER account, as a real client would do it.
 *
 *   cloud     : npm run check:owner-cloud -- --email you@example.com --legacy-id <supabase uuid>
 *               (asks for the password with hidden input; it is never printed, stored or logged)
 *   emulator  : OWNER_CHECK_PASSWORD=… FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *               npx tsx scripts/owner-cloud-check.ts --email … --legacy-id … --emulator
 *
 * Reads the public web config from .env.production.local. Only writes: a reversible displayName change on the
 * owner's own users/{uid} document (restored at the end). Never changes NEXT_PUBLIC_AUTH_PROVIDER or any app config.
 */
import { readFileSync } from 'fs'
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, updateDoc, deleteField, serverTimestamp, collection } from 'firebase/firestore'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined }
const emulator = process.argv.includes('--emulator')

function envFile(path: string): Record<string, string> {
  try { return Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])) } catch { return {} }
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt)
    const stdin = process.stdin
    if (!stdin.isTTY) { let d = ''; stdin.on('data', (c) => (d += c)); stdin.on('end', () => resolve(d.trim())); return }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8')
    let buf = ''
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); resolve(buf) }
      else if (ch === '\u0003') process.exit(130)
      else if (ch === '\u007f') buf = buf.slice(0, -1)
      else buf += ch
    }
    stdin.on('data', onData)
  })
}

let failed = 0
const t = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++ }
const denied = async (p: Promise<unknown>) => { try { await p; return false } catch (e: any) { return e.code === 'permission-denied' } }

;(async () => {
  const email = arg('email'), legacy = arg('legacy-id')
  if (!email || !legacy) throw new Error('usage: --email <email> --legacy-id <supabase uuid> [--emulator]')
  let password: string
  if (emulator) {
    if (!process.env.OWNER_CHECK_PASSWORD) throw new Error('emulator mode needs OWNER_CHECK_PASSWORD')
    password = process.env.OWNER_CHECK_PASSWORD
  } else {
    if (process.env.OWNER_CHECK_PASSWORD) throw new Error('Refusing: OWNER_CHECK_PASSWORD is for the emulator only; the cloud password is typed interactively')
    password = await askHidden(`Password for ${email} (hidden): `)
  }

  const cfg = envFile('.env.production.local')
  const app = emulator
    ? initializeApp({ apiKey: 'demo-api-key', projectId: 'demo-iomixo', appId: 'demo' }, 'owner-check')
    : initializeApp({ apiKey: cfg.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: cfg.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: cfg.NEXT_PUBLIC_FIREBASE_PROJECT_ID, appId: cfg.NEXT_PUBLIC_FIREBASE_APP_ID }, 'owner-check')
  if (!emulator && cfg.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== 'iomixo-494817') throw new Error('Unexpected project in .env.production.local')
  const auth = getAuth(app), db = getFirestore(app)
  if (emulator) { connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); connectFirestoreEmulator(db, '127.0.0.1', 8080) }
  console.log(`target: ${emulator ? 'EMULATOR (demo-iomixo)' : 'CLOUD iomixo-494817'}`)

  // 1-3 login → ID token → claim
  const c1 = await signInWithEmailAndPassword(auth, email, password).catch((e) => { throw new Error(`login failed: ${e.code}`) })
  const r1 = await c1.user.getIdTokenResult()
  t('Firebase login (email/password)', !!c1.user.uid && c1.user.isAnonymous === false)
  t('ID token valid (provider password, not anonymous, expiry set)', r1.signInProvider === 'password' && !!r1.expirationTime)
  t('legacyUserId present in the ID token', r1.claims.legacyUserId === legacy)
  console.log(`      uid=${c1.user.uid}`)

  // 4 own document
  const ref = doc(db, 'users', c1.user.uid)
  const snap = await getDoc(ref)
  t('read own users/{uid}', snap.exists() && snap.data()?.legacySupabaseId === legacy)
  t('plan is the verified legacy one (wedding/legacy)', snap.data()?.plan?.tier === 'wedding' && snap.data()?.plan?.source === 'legacy')
  t('listing users is denied', await denied(getDocs(collection(db, 'users'))))
  t("another user's document is denied", await denied(getDoc(doc(db, 'users', 'someone-else'))))

  // 5 allowed field (reversible)
  const before = snap.data()?.displayName
  await updateDoc(ref, { displayName: 'Owner (check)', updatedAt: serverTimestamp() })
  t('displayName update allowed', (await getDoc(ref)).data()?.displayName === 'Owner (check)')
  await updateDoc(ref, { displayName: before ?? deleteField(), updatedAt: serverTimestamp() })
  t('displayName restored', (await getDoc(ref)).data()?.displayName === before)

  // 6-7 forbidden fields
  t('plan change denied', await denied(updateDoc(ref, { plan: { tier: 'free', source: 'default' }, updatedAt: serverTimestamp() })))
  t('plan.tier change denied', await denied(updateDoc(ref, { 'plan.tier': 'free', updatedAt: serverTimestamp() })))
  t('legacySupabaseId change denied', await denied(updateDoc(ref, { legacySupabaseId: 'x', updatedAt: serverTimestamp() })))
  t('email change denied', await denied(updateDoc(ref, { email: 'evil@example.com', updatedAt: serverTimestamp() })))
  const after = (await getDoc(ref)).data()!
  t('document intact after the attempts', after.plan.tier === 'wedding' && after.plan.source === 'legacy' && after.legacySupabaseId === legacy)

  // 8-10 logout → new login → refreshed token
  await signOut(auth)
  t('logout (no current user)', auth.currentUser === null)
  t('signed out: document no longer readable', await denied(getDoc(ref)))
  const c2 = await signInWithEmailAndPassword(auth, email, password)
  const r2 = await c2.user.getIdTokenResult(true)
  t('new login: same uid, fresh token, claim still present', c2.user.uid === c1.user.uid && r2.token !== r1.token && r2.claims.legacyUserId === legacy)
  t('own document readable again', (await getDoc(ref)).exists())
  await signOut(auth)

  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error('ERROR:', e.message); process.exit(2) })
