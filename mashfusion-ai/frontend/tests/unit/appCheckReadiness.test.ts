import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Static guarantees behind "ready for enforce=true": the server options are the platform enforcement, and the client has ONE way to call callables. */
const root = join(__dirname, '..', '..')
const fnSrc = readFileSync(join(root, '..', '..', 'firebase', 'functions', 'src', 'index.ts'), 'utf8')
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (/node_modules|\.next|tests/.test(p) ? [] : walk(p)) : /\.(ts|tsx)$/.test(p) ? [p] : [] })

test('every callable declares enforceAppCheck from its own parameter; none hard-codes false or reads the token by hand', () => {
  const callables = Array.from(fnSrc.matchAll(/export const (\w+)\s*=\s*(onCall|ownerCall)/g)).map((m) => m[1])
  assert.deepEqual(callables.sort(), ['commitAvatar', 'createAlbumCheckoutSession', 'createCheckoutSession', 'createDedication', 'createEvent', 'createMusicRequest', 'createPhotoUpload', 'createPoll', 'createPortalSession', 'deleteEvent', 'finalizePhoto', 'getAlbumExportUrl', 'getPublicEvent', 'moderateDedication', 'moderatePhoto', 'moderateRequest', 'ownerGameAction', 'removeAvatar', 'requestAlbumExport', 'restoreEvent', 'setGameConfig', 'setMailLocale', 'setPollStatus', 'updateEventConfig', 'votePoll'])
  assert.ok(!/enforceAppCheck:\s*(false|true)\b/.test(fnSrc), 'enforceAppCheck must come from a parameter (default false, flipped per environment), never a literal')
  assert.ok(!/consumeAppCheckToken|verifyToken|appCheck\(\)\.verify/.test(fnSrc), 'no manual token handling / bypass')
  assert.match(fnSrc, /const ENFORCE_OWNER\s*=\s*defineBoolean\('APPCHECK_ENFORCE_OWNER',\s*\{ default: false \}\)/)
  assert.match(fnSrc, /const ENFORCE_PUBLIC_EVENT\s*=\s*defineBoolean\('APPCHECK_ENFORCE_PUBLIC_EVENT',\s*\{ default: false \}\)/)
  for (const fn of ['createPoll', 'setPollStatus', 'moderateRequest', 'moderateDedication', 'updateEventConfig', 'createEvent', 'deleteEvent', 'restoreEvent', 'ownerGameAction', 'setGameConfig', 'moderatePhoto', 'requestAlbumExport', 'getAlbumExportUrl', 'commitAvatar', 'removeAvatar']) assert.match(fnSrc, new RegExp(`export const ${fn}\\s*=\\s*ownerCall\\('${fn}'`))
  assert.match(fnSrc, /const ENFORCE_PHOTO\s*=\s*defineBoolean\('APPCHECK_ENFORCE_PHOTO',\s*\{ default: false \}\)/)
  assert.match(fnSrc, /photoCallOptions = \{ \.\.\.guestCallOptions\(ENFORCE_PHOTO\)/)
  assert.match(fnSrc, /const ENFORCE_BILLING\s*=\s*defineBoolean\('APPCHECK_ENFORCE_BILLING',\s*\{ default: false \}\)/)
  assert.match(fnSrc, /billingCallOptions = \{ \.\.\.guestCallOptions\(ENFORCE_BILLING\)/)
  assert.match(fnSrc, /defineSecret\('STRIPE_SECRET_KEY'\)/); assert.match(fnSrc, /defineSecret\('STRIPE_WEBHOOK_SECRET'\)/)
  assert.match(fnSrc, /ownerCallOptions = \{ \.\.\.guestCallOptions\(ENFORCE_OWNER\)/)
  assert.match(fnSrc, /onCall\(\{ \.\.\.guestCallOptions\(ENFORCE_PUBLIC_EVENT\)/)
  assert.equal(Array.from(fnSrc.matchAll(/observeAppCheck\(/g)).length >= 3, true, 'each callable logs app_check valid|absent')
})

test('environment files keep the NEW enforcements OFF (task constraint)', () => {
  const env = readFileSync(join(root, '..', '..', 'firebase', 'functions', '.env.iomixo-494817'), 'utf8')
  assert.match(env, /^APPCHECK_ENFORCE_OWNER=false$/m); assert.match(env, /^APPCHECK_ENFORCE_PUBLIC_EVENT=false$/m); assert.match(env, /^APPCHECK_ENFORCE_PHOTO=false$/m)
})

test('the client calls callables ONLY through getFirebaseFunctions() (the app that carries App Check); no raw fetch to callable URLs', () => {
  const offenders: string[] = []
  for (const f of [...walk(join(root, 'lib')), ...walk(join(root, 'app')), ...walk(join(root, 'components'))]) {
    const s = readFileSync(f, 'utf8')
    for (const m of Array.from(s.matchAll(/httpsCallable(?:<[^(]*?>)?\(\s*([^,]+?)\s*,/g))) if (!/getFirebaseFunctions\(\)/.test(m[1])) offenders.push(`${f}: ${m[0]}`)
    if (/cloudfunctions\.net|\/europe-west1\/(createMusicRequest|createDedication|votePoll|moderate|createPoll|setPollStatus|updateEventConfig|getPublicEvent)/.test(s)) offenders.push(`${f}: raw callable URL`)
  }
  assert.deepEqual(offenders, [])
})

test('billing: no Stripe secret / webhook secret / live key anywhere in the Functions source or deploy env (Secret Manager only)', () => {
  const root = join(__dirname, '..', '..', '..', '..', 'firebase', 'functions')
  const files = [...walk(join(root, 'src')), join(root, '.env.iomixo-494817'), join(root, '.env.example')]
  for (const f of files) {
    const t = readFileSync(f, 'utf8')
    assert.ok(!/sk_(live|test)_[A-Za-z0-9]{8,}|rk_(live|test)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{16,}/.test(t), `secret-looking value in ${f}`)
    assert.ok(!/^STRIPE_(SECRET_KEY|WEBHOOK_SECRET)\s*=/m.test(t), `secret assigned in ${f}`)
  }
})
