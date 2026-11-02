// Verifies, with ONE temporary file in an ISOLATED project, that replacing a Firebase Storage download token really kills the old link — the behaviour the
// MIOLOVE "Galleria condivisa" revocation (owner/config.ts → photos/storage.ts revokeDownloadToken) relies on. It exercises the REAL compiled helper.
//
//   npm run build                                                                  (the script loads lib/photos/storage.js)
//   emulator (safe, no cloud; can only say INCONCLUSIVE, see below):
//     firebase emulators:exec --config ../firebase.json --project demo-iomixo --only storage "node scripts/verify-token-revocation.cjs --emulator"
//   cloud (ONLY with the owner's authorisation, ONLY a test project that is NOT production):
//     ISOLATED_TEST_PROJECT_CONFIRM=<project> node scripts/verify-token-revocation.cjs --cloud --project <project> --bucket <bucket>
//
// Safety: it writes and deletes exactly one object under `__token-revocation-test__/<random>.txt`; it never lists, reads or touches any other object; it refuses
// the production project (.firebaserc), a bucket that is not named after the confirmed project, and any run without the explicit confirmation variable.
// Exit codes: 0 = PASS, 1 = FAIL (old link still works in the cloud: revocation NOT guaranteed), 2 = INCONCLUSIVE (emulator), 3 = refused / error.
'use strict'
const { randomUUID } = require('node:crypto')
const { join } = require('node:path')
const PROD = 'iomixo-494817'
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
const has = (n) => process.argv.includes(n)
const refuse = (m) => { console.error('REFUSED: ' + m); process.exit(3) }

const cloud = has('--cloud'), emu = has('--emulator')
if (cloud === emu) refuse('choose exactly one of --emulator or --cloud')
let project, bucketName
if (emu) {
  if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST && !process.env.STORAGE_EMULATOR_HOST) refuse('--emulator needs the Storage emulator (run it through firebase emulators:exec)')
  project = process.env.GCLOUD_PROJECT || 'demo-iomixo'; bucketName = `${project}.firebasestorage.app`
} else {
  project = arg('--project'); bucketName = arg('--bucket')
  if (!project || !bucketName) refuse('--project and --bucket are required')
  if (project === PROD) refuse('this is the PRODUCTION project')
  if (process.env.ISOLATED_TEST_PROJECT_CONFIRM !== project) refuse('set ISOLATED_TEST_PROJECT_CONFIRM=<project> to confirm that this is an isolated test project')
  if (!bucketName.startsWith(project)) refuse('the bucket must belong to the confirmed project')
  if (process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST) refuse('an emulator variable is set: that would not be the cloud')
}
process.env.GCLOUD_PROJECT = project; process.env.STORAGE_BUCKET = bucketName

const { initializeApp } = require('firebase-admin/app')
const { getStorage } = require('firebase-admin/storage')
initializeApp({ projectId: project, storageBucket: bucketName })
const { revokeDownloadToken } = require(join(__dirname, '..', 'lib', 'photos', 'storage.js'))

const path = `__token-revocation-test__/${randomUUID()}.txt`
const file = getStorage().bucket(bucketName).file(path)
const base = emu ? ((h) => (/^https?:\/\//.test(h) ? h : `http://${h}`))(process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST) : 'https://firebasestorage.googleapis.com'
const url = (t) => `${base}/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${t}`
const status = async (t) => (await fetch(url(t))).status
const tokensOf = async () => String(((await file.getMetadata())[0].metadata || {}).firebaseStorageDownloadTokens || '').split(',').filter(Boolean)

;(async () => {
  let verdict = 3
  try {
    const A = randomUUID()
    await file.save('token revocation probe — safe to delete', { contentType: 'text/plain', metadata: { metadata: { firebaseStorageDownloadTokens: A } } })
    const s1 = await status(A); console.log(`1. link with token A: HTTP ${s1} (expected 200)`)
    const r = await revokeDownloadToken(path); console.log(`2. revokeDownloadToken → ${r} (expected "revoked")`)
    const tokens = await tokensOf(); const B = tokens[tokens.length - 1]
    console.log(`3. tokens now: ${tokens.length} (expected exactly 1, and not A): ${tokens.includes(A) ? 'A STILL LISTED' : 'A gone'}`)
    const s2 = await status(A); console.log(`4. OLD link (token A): HTTP ${s2} (expected 403 or 404)`)
    const s3 = B ? await status(B) : 0; console.log(`5. NEW link (token B): HTTP ${s3} (expected 200)`)
    const ok = s1 === 200 && r === 'revoked' && tokens.length === 1 && !tokens.includes(A) && (s2 === 403 || s2 === 404) && s3 === 200
    if (ok) { console.log('PASS: the old link is dead and the new one works.'); verdict = 0 }
    else if (emu && s2 === 200 && tokens.includes(A)) { console.log('INCONCLUSIVE: the Storage EMULATOR appends the new token instead of replacing the old one, so it cannot show the old link dying. Run the cloud mode on an isolated test project.'); verdict = 2 }
    else { console.log('FAIL: revocation is NOT guaranteed (see the steps above).'); verdict = 1 }
  } catch (e) { console.error('ERROR: ' + (e && e.message)); verdict = 3 }
  finally { await file.delete({ ignoreNotFound: true }).then(() => console.log('cleanup: temporary object deleted')).catch((e) => console.error('cleanup FAILED, delete manually: ' + path + ' — ' + e.message)) }
  process.exit(verdict)
})()
