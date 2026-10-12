/**
 * Backfill of the legacy photo domain (live_photos + vote counts + winner photo paths) into Firestore. DRY RUN by default; METADATA ONLY.
 *
 *   # 1) format check + statistics of the exported snapshot (NO Firestore, NO network, no project needed)
 *   npx ts-node --transpile-only scripts/backfill-photos.ts --input snapshot-photos.json --snapshot-only
 *   # 2) dry-run against production (Firestore READS only)
 *   FIREBASE_PROJECT_ID=iomixo-494817 npx ts-node --transpile-only scripts/backfill-photos.ts --project iomixo-494817 --input snapshot-photos.json \
 *       --legacy-user-id <owner supabase users.id> --report backfill-report-photos-dryrun.json
 *   # 3) PLAN of the binary copy (no network, no Storage; writes a 0600 manifest, nothing else)
 *   … --plan-binaries --manifest-out ./photo-binaries-manifest.json
 *   # 4) apply (metadata only; both flags are mandatory on a real project; the 0600 rollback file is written BEFORE the first write)
 *   … --apply --yes-production --rollback-out ./backfill-rollback-photos-<ts>.json
 *   # rollback of what an apply created (dry-run unless --apply --yes-production)
 *   … --rollback ./backfill-rollback-photos-<ts>.json [--apply --yes-production]
 *
 * Snapshot: scripts/sql/live_photos_snapshot.sql → { format: 'iomixo.live_photos.snapshot.v1', counts, photos, votes, sessions }.
 * The binaries are NOT copied by this tool: see PHOTO_BINARY_MIGRATION.md. Nothing is ever deleted by a run.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { BackfillRefused } from '../src/services/entitlementBackfill'
import { inventoryPhotos, runPhotoBackfill, runPhotoRollback, buildBinaryManifest, type PhotoSnapshot } from '../src/services/photoBackfill'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }

function loadSnapshot(): PhotoSnapshot {
  const path = val('input') ?? (() => { throw new BackfillRefused(['--input <snapshot.json> is required']) })()
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (raw?.format !== 'iomixo.live_photos.snapshot.v1') throw new BackfillRefused([`unknown snapshot format: ${raw?.format}`])
  const s: PhotoSnapshot = { photos: raw.photos, votes: raw.votes, sessions: raw.sessions }
  for (const k of Object.keys(s) as Array<keyof PhotoSnapshot>) if (!Array.isArray(s[k])) throw new BackfillRefused([`snapshot.${k} must be an array`])
  if (typeof raw.counts?.photos === 'number' && raw.counts.photos !== s.photos.length) throw new BackfillRefused([`snapshot.photos: count (${raw.counts.photos}) != length (${s.photos.length}): truncated copy?`])
  if (typeof raw.counts?.sessions === 'number' && raw.counts.sessions !== s.sessions.length) throw new BackfillRefused([`snapshot.sessions: count (${raw.counts.sessions}) != length (${s.sessions.length}): truncated copy?`])
  return s
}

async function main() {
  if (flag('snapshot-only')) { console.log(JSON.stringify({ mode: 'snapshot-only', inventory: inventoryPhotos(loadSnapshot()) }, null, 2)); return }
  const { firestore, isFirebaseAuthConfigured } = await import('../src/lib/firebaseAdmin')
  const project = val('project'), envProject = process.env.FIREBASE_PROJECT_ID
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
  if (!project) throw new BackfillRefused(['--project is required (explicit target)'])
  if (!emulator && envProject !== project) throw new BackfillRefused([`FIREBASE_PROJECT_ID (${envProject ?? 'unset'}) must equal --project (${project})`])
  if (emulator && !project.startsWith('demo-')) throw new BackfillRefused(['emulator host set but --project is not a demo-* project'])
  if (!isFirebaseAuthConfigured()) throw new BackfillRefused(['Firebase Admin is not configured'])
  const apply = flag('apply'), yes = flag('yes-production')
  if (apply && !emulator && !yes) throw new BackfillRefused(['--apply on a real project requires --yes-production (checked before any Firestore access)'])
  const db = firestore()

  if (val('rollback')) {
    const file = JSON.parse(readFileSync(val('rollback')!, 'utf8'))
    console.log(JSON.stringify({ mode: apply ? 'rollback-apply' : 'rollback-dry-run', ...(await runPhotoRollback(db, file.entries ?? [], { apply, projectId: project, yesProduction: yes })) }, null, 2)); return
  }
  const snap = loadSnapshot()
  if (flag('plan-binaries')) {
    const out = val('manifest-out') ?? './photo-binaries-manifest.json'
    if (existsSync(out)) throw new BackfillRefused([`${out} already exists: refusing to overwrite`])
    const m = await buildBinaryManifest(snap, db, { legacyUserId: val('legacy-user-id') })
    writeFileSync(out, JSON.stringify({ project, createdAt: new Date().toISOString(), ...m }), { mode: 0o600 })
    console.log(JSON.stringify({ mode: 'plan-binaries', files: m.entries.length, photos: m.entries.filter((e) => e.kind === 'photo').length, winner: m.entries.filter((e) => e.kind === 'winner').length, unmapped: m.unmapped, skipped: m.skipped, manifest: out }, null, 2)); return
  }
  const rollbackOut = val('rollback-out') ?? `./backfill-rollback-photos-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  if (apply && existsSync(rollbackOut)) throw new BackfillRefused([`${rollbackOut} already exists: refusing to overwrite a rollback file`])
  const report = await runPhotoBackfill(snap, { apply, projectId: project, yesProduction: yes, limit: val('limit') ? Number(val('limit')) : undefined, legacyUserId: val('legacy-user-id') }, { db })
  const { entries, ...printable } = report
  if (apply && entries) writeFileSync(rollbackOut, JSON.stringify({ project, createdAt: new Date().toISOString(), entries }), { mode: 0o600 })
  if (val('report')) writeFileSync(val('report')!, JSON.stringify(printable, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(printable, null, 2))
  if (apply) console.log(`rollback file: ${rollbackOut} (local, NOT to be committed)`)
}

main().catch((e) => { console.error(e instanceof BackfillRefused ? `REFUSED: ${e.reasons.join('; ')}` : `ERROR: ${(e as Error).message}`); process.exit(2) })
