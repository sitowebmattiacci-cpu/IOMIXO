/**
 * Copy of the legacy AVATAR binaries (Supabase Storage bucket `avatars`) to Firebase Storage + Firestore finalize, driven by the manifest written by
 * `backfill-profiles.ts --plan-binaries`. DRY RUN by default. Nothing is ever deleted from Supabase; no Firebase object is ever overwritten.
 *
 *   # dry-run: reads Supabase + Firebase Storage metadata + Firestore docs, writes nothing remote (report is a local 0600 file)
 *   npx ts-node --transpile-only scripts/copy-avatar-binaries.ts --manifest ./avatar-binaries-manifest.json --project iomixo-494817 --report ./avatar-binaries-dryrun.json
 *   # apply (both flags mandatory; the 0600 rollback file is written BEFORE the first upload and updated after every step)
 *   … --apply --yes-production --rollback-out ./avatar-binaries-rollback-<ts>.json
 *   # rollback: reverts the Firestore fields it wrote (only if still untouched), then deletes ONLY the objects it created (generation-matched)
 *   … --rollback ./avatar-binaries-rollback-<ts>.json [--apply --yes-production]
 *
 * Two phases, ALL-OR-NOTHING for Firestore:
 *   A. per file: download → size/magic/type checks → sha256 → destination (absent: create-only upload + md5/size verification; identical: reuse; different: BLOCKER).
 *   B. only if every file of phase A is verified: per file, a Firestore TRANSACTION sets exactly `avatarPath` + `avatarUrl` on users/{uid} (kind user) or
 *      djProfiles/{uid} (kind dj). Preconditions: the doc exists, was backfilled from this very legacy URL (`legacyAvatarUrl`), and has no avatar yet
 *      (or already the same one → noop). Any other field is untouched. A failure in A writes NO metadata at all.
 * avatarUrl = Firebase download URL with the object's download token (same strategy as the commitAvatar callable); never an expiring signed URL.
 *
 * Credentials (never in the repo, never printed): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the process env or backend/.env (gitignored);
 * Firebase: Application Default Credentials.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
class Refused extends Error {}

interface Entry { kind: 'user' | 'dj'; uid: string; legacyUserId: string; legacyBucket: string; legacyPath: string; legacyUrl: string; targetPath: string; contentType: string }
type Status = 'would-copy' | 'copied' | 'skip-identical' | 'conflict' | 'missing-source' | 'rejected' | 'error'
interface Row { kind: string; target: string; status: Status; bytes?: number; sha256?: string; token?: string; generation?: string; note?: string }
interface Change { path: string; before: { avatarPath?: string; avatarUrl?: string }; after: { avatarPath: string; avatarUrl: string } }

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])
const SAFE_TARGET = /^profiles\/([A-Za-z0-9]{1,128})\/avatar\/(user|dj)-[A-Za-z0-9_-]{16,64}\.(jpg|png|webp)$/
const SAFE_SOURCE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/
const mask = (s: string) => (s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-3)}` : s)
const docPath = (e: Pick<Entry, 'kind' | 'uid'>) => `${e.kind === 'user' ? 'users' : 'djProfiles'}/${e.uid}`

function loadDotenv(): void {
  const p = resolve(__dirname, '../.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

function audit(entries: Entry[]): string[] {
  const problems: string[] = [], src = new Set<string>(), dst = new Set<string>(), slot = new Set<string>()
  for (const e of entries) {
    const m = SAFE_TARGET.test(e.targetPath) ? SAFE_TARGET.exec(e.targetPath)! : null
    if (!m || m[1] !== e.uid || m[2] !== e.kind) problems.push(`unsafe/mismatched target: ${e.targetPath}`)
    if (!SAFE_SOURCE.test(e.legacyPath) || e.legacyPath.includes('..') || !e.legacyPath.startsWith(`${e.legacyUserId}/`)) problems.push(`unsafe source path (entry ${e.targetPath})`)
    if (e.legacyBucket !== 'avatars') problems.push(`unexpected bucket ${e.legacyBucket}`)
    if (!ALLOWED.has(e.contentType)) problems.push(`content-type not allowed: ${e.targetPath}`)
    if (src.has(e.legacyPath)) problems.push(`duplicate source: ${e.legacyPath}`)
    if (dst.has(e.targetPath)) problems.push(`destination collision: ${e.targetPath}`)
    if (slot.has(`${e.kind}:${e.uid}`)) problems.push(`two avatars for the same ${e.kind} slot`)
    src.add(e.legacyPath); dst.add(e.targetPath); slot.add(`${e.kind}:${e.uid}`)
  }
  return problems
}

async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown
  for (let i = 0; i < tries; i++) { try { return await fn() } catch (e) { last = e; await new Promise((r) => setTimeout(r, 500 * 2 ** i)) } }
  throw last
}

async function main() {
  const apply = flag('apply'), yes = flag('yes-production')
  const project = val('project')
  if (!project) throw new Refused('--project is required (explicit target)')
  if (apply && !yes) throw new Refused('--apply requires --yes-production (checked before any network access)')
  const bucketName = val('bucket') ?? process.env.FIREBASE_STORAGE_BUCKET ?? `${project}.firebasestorage.app`
  if (!process.env.FIRESTORE_EMULATOR_HOST && !bucketName.startsWith(project)) throw new Refused(`bucket ${bucketName} does not belong to project ${project}`)
  process.env.FIREBASE_PROJECT_ID = project
  process.env.FIREBASE_STORAGE_BUCKET = bucketName
  const { firestore, firebaseStorage } = await import('../src/lib/firebaseAdmin')
  const { FieldValue } = await import('firebase-admin/firestore')
  const db = firestore(), bucket = firebaseStorage().bucket()
  const urlFor = (path: string, token: string) =>
    `${process.env.FIREBASE_STORAGE_EMULATOR_HOST ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : 'https://firebasestorage.googleapis.com'}/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`

  // ---- rollback: Firestore first (only fields still holding what we wrote), then the objects (generation-matched) ----
  if (val('rollback')) {
    const rb = JSON.parse(readFileSync(val('rollback')!, 'utf8')) as { changes: Change[]; created: Array<{ target: string; generation: string }> }
    const out: string[] = []
    for (const c of (rb.changes ?? []).slice().reverse()) {
      const ref = db.doc(c.path), snap = await ref.get(), cur = snap.data() ?? {}
      if (!snap.exists || cur.avatarPath !== c.after.avatarPath || cur.avatarUrl !== c.after.avatarUrl) { out.push(`skipped (changed since): ${mask(c.path)}`); continue }
      if (apply) await ref.update({
        avatarPath: c.before.avatarPath === undefined ? FieldValue.delete() : c.before.avatarPath,
        avatarUrl: c.before.avatarUrl === undefined ? FieldValue.delete() : c.before.avatarUrl,
      })
      out.push(`${apply ? 'reverted' : 'would-revert'}: ${mask(c.path)}`)
    }
    for (const c of rb.created ?? []) {
      const f = bucket.file(c.target)
      if (!(await f.exists())[0]) { out.push(`already-absent: ${mask(c.target)}`); continue }
      const [md] = await f.getMetadata()
      if (String(md.generation) !== String(c.generation)) { out.push(`generation-changed, left untouched: ${mask(c.target)}`); continue }
      if (apply) await f.delete({ ifGenerationMatch: c.generation })
      out.push(`${apply ? 'deleted' : 'would-delete'}: ${mask(c.target)}`)
    }
    console.log(JSON.stringify({ mode: apply ? 'rollback-apply' : 'rollback-dry-run', results: out }, null, 2)); return
  }

  // ---- manifest audit ----
  const mpath = val('manifest') ?? (() => { throw new Refused('--manifest is required') })()
  const manifest = JSON.parse(readFileSync(mpath, 'utf8'))
  if (manifest.project !== project) throw new Refused(`manifest project (${manifest.project}) != --project (${project})`)
  const entries: Entry[] = manifest.entries
  const problems = audit(entries)
  if (problems.length) throw new Refused(`manifest audit failed:\n - ${problems.join('\n - ')}`)

  loadDotenv()
  const sbUrl = process.env.SUPABASE_URL, sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!sbUrl || !sbKey) throw new Refused('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment (or backend/.env, gitignored)')
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(sbUrl, sbKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const rollbackOut = val('rollback-out') ?? `./avatar-binaries-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const created: Array<{ target: string; generation: string; sha256: string }> = [], changes: Change[] = []
  const saveRollback = () => writeFileSync(rollbackOut, JSON.stringify({ project, bucket: bucketName, createdAt: new Date().toISOString(), created, changes }), { mode: 0o600 })
  if (apply) {
    if (existsSync(rollbackOut)) throw new Refused(`${rollbackOut} already exists: refusing to overwrite`)
    saveRollback()
  }

  // ---- phase A: binaries ----
  const rows: Row[] = []
  for (const e of entries) {
    const row: Row = { kind: e.kind, target: e.targetPath.replace(e.uid, mask(e.uid)), status: 'error' }
    rows.push(row)
    try {
      const dl = await retry(async () => {
        const r = await supabase.storage.from(e.legacyBucket).download(e.legacyPath)
        if (r.error) {
          if (/not.?found|404|Object not found/i.test(`${r.error.message} ${(r.error as { statusCode?: string }).statusCode ?? ''}`)) return null
          throw new Error(r.error.message)
        }
        return Buffer.from(await r.data.arrayBuffer())
      })
      if (!dl) { row.status = 'missing-source'; continue }
      row.bytes = dl.length; row.sha256 = createHash('sha256').update(dl).digest('hex')
      if (dl.length === 0 || dl.length > MAX_BYTES) { row.status = 'rejected'; row.note = `size ${dl.length} out of (0, 5MB]`; continue }
      const isJpeg = dl[0] === 0xff && dl[1] === 0xd8 && dl[2] === 0xff
      const isPng = dl.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      const isWebp = dl.subarray(0, 4).toString('latin1') === 'RIFF' && dl.subarray(8, 12).toString('latin1') === 'WEBP'
      const magic = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : isWebp ? 'image/webp' : null
      if (magic !== e.contentType) { row.status = 'rejected'; row.note = `magic bytes (${magic}) != expected ${e.contentType}`; continue }

      const f = bucket.file(e.targetPath), md5 = createHash('md5').update(dl).digest('base64')
      if ((await retry(() => f.exists()))[0]) {
        const [md] = await retry(() => f.getMetadata())
        if (md.md5Hash === md5 && Number(md.size) === dl.length) {
          row.status = 'skip-identical'; row.generation = String(md.generation)
          row.token = String(md.metadata?.firebaseStorageDownloadTokens ?? '').split(',')[0] || undefined
          if (!row.token && apply) { row.token = randomUUID(); await retry(() => f.setMetadata({ metadata: { firebaseStorageDownloadTokens: row.token } })) }   // content untouched; only the access token is added
        } else { row.status = 'conflict'; row.note = 'destination exists with different content: NOT overwritten' }
        continue
      }
      if (!apply) { row.status = 'would-copy'; continue }
      row.token = randomUUID()
      await retry(() => f.save(dl, {
        resumable: false, preconditionOpts: { ifGenerationMatch: 0 },              // create-only: never overwrites
        metadata: { contentType: e.contentType, cacheControl: 'public,max-age=31536000,immutable', metadata: { firebaseStorageDownloadTokens: row.token, legacySha256: row.sha256, legacyPath: e.legacyPath } },
      }))
      const [md] = await retry(() => f.getMetadata())
      row.generation = String(md.generation)
      created.push({ target: e.targetPath, generation: row.generation, sha256: row.sha256 }); saveRollback()
      if (md.md5Hash !== md5 || Number(md.size) !== dl.length) { row.status = 'error'; row.note = 'post-upload verification FAILED (size/md5): object left in place and listed in rollback'; continue }
      row.status = 'copied'
    } catch (err) { row.status = 'error'; row.note = (err as Error).message.slice(0, 200) }
  }

  // ---- phase B: Firestore (dry-run: only evaluates the preconditions) ----
  const count = (s: Status) => rows.filter((r) => r.status === s).length
  const phaseABlockers = rows.filter((r) => ['conflict', 'missing-source', 'rejected', 'error'].includes(r.status))
  const fsPlan: Array<{ e: Entry; row: Row; action: 'update' | 'noop' | 'blocked'; note?: string }> = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i], row = rows[i], snap = await db.doc(docPath(e)).get(), d = snap.data() ?? {}
    if (!snap.exists) { fsPlan.push({ e, row, action: 'blocked', note: 'Firestore doc missing (run the profile metadata backfill first)' }); continue }
    if (e.kind === 'user' && d.legacySupabaseId !== e.legacyUserId) { fsPlan.push({ e, row, action: 'blocked', note: 'users/{uid}.legacySupabaseId does not match the manifest' }); continue }
    if (e.kind === 'dj' && d.legacySupabaseId !== e.legacyUserId) { fsPlan.push({ e, row, action: 'blocked', note: 'djProfiles/{uid}.legacySupabaseId does not match the manifest' }); continue }
    if (d.legacyAvatarUrl !== e.legacyUrl) { fsPlan.push({ e, row, action: 'blocked', note: 'doc was not backfilled from this legacy avatar URL' }); continue }
    if (d.avatarPath === e.targetPath) { fsPlan.push({ e, row, action: 'noop' }); continue }
    if (d.avatarPath || d.avatarUrl) { fsPlan.push({ e, row, action: 'blocked', note: 'doc already has a different avatar (set by the owner?): not replaced' }); continue }
    fsPlan.push({ e, row, action: 'update' })
  }
  const fsBlockers = fsPlan.filter((p) => p.action === 'blocked').map((p) => `firestore-blocked: ${p.e.kind} ${mask(p.e.uid)} (${p.note})`)

  let firestoreUpdated = 0
  if (apply && phaseABlockers.length === 0 && fsBlockers.length === 0) {
    for (const p of fsPlan) {
      if (p.action !== 'update') continue
      const avatarUrl = urlFor(p.e.targetPath, p.row.token!)
      const ref = db.doc(docPath(p.e))
      await db.runTransaction(async (tx) => {
        const cur = (await tx.get(ref)).data()
        if (!cur || cur.legacyAvatarUrl !== p.e.legacyUrl || cur.avatarPath || cur.avatarUrl) throw new Error(`precondition failed for ${p.e.kind} ${mask(p.e.uid)} (changed meanwhile)`)
        tx.update(ref, { avatarPath: p.e.targetPath, avatarUrl })       // exactly these two fields
      })
      changes.push({ path: docPath(p.e), before: {}, after: { avatarPath: p.e.targetPath, avatarUrl } }); saveRollback(); firestoreUpdated++
    }
  }

  const summary = {
    mode: apply ? 'apply' : 'dry-run', project, bucket: bucketName,
    filesTotal: rows.length, readableSource: rows.filter((r) => r.sha256).length, missingSource: count('missing-source'), rejected: count('rejected'),
    destinationExisting: count('skip-identical') + count('conflict'), checksumMatch: count('skip-identical'), checksumConflict: count('conflict'),
    wouldCopy: count('would-copy'), copied: count('copied'), errors: count('error'),
    accountAvatar: rows.filter((r) => r.kind === 'user').length, djAvatar: rows.filter((r) => r.kind === 'dj').length,
    bytesTotal: rows.reduce((a, r) => a + (r.bytes ?? 0), 0),
    firestoreWouldUpdate: fsPlan.filter((p) => p.action === 'update').length, firestoreNoop: fsPlan.filter((p) => p.action === 'noop').length,
    ...(apply ? { firestoreUpdated } : {}),
    blockers: [...phaseABlockers.map((r) => `${r.status}: ${r.target}${r.note ? ` (${r.note})` : ''}`), ...fsBlockers],
  }
  if (apply && summary.blockers.length) summary.blockers.push('NO Firestore metadata was written (all-or-nothing)')
  if (val('report')) writeFileSync(val('report')!, JSON.stringify({ summary, rows }, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(summary, null, 2))
  if (apply) console.log(`rollback file: ${rollbackOut} (local, NOT to be committed)`)
  if (summary.blockers.length) process.exitCode = 1
}

main().catch((e) => { console.error(e instanceof Refused ? `REFUSED: ${e.message}` : `ERROR: ${(e as Error).message}`); process.exit(2) })
