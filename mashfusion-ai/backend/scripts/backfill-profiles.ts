/**
 * Backfill of the legacy profile domain (users.full_name + dj_profiles) into Firestore. DRY RUN by default; METADATA ONLY (avatars are only PLANNED).
 *
 *   # 1) format check + statistics of the exported snapshot (NO Firestore, NO network, no project needed)
 *   npx ts-node --transpile-only scripts/backfill-profiles.ts --input snapshot-profiles.json --snapshot-only
 *   # 2) dry-run against production (Firestore READS only)
 *   FIREBASE_PROJECT_ID=iomixo-494817 npx ts-node --transpile-only scripts/backfill-profiles.ts --project iomixo-494817 --input snapshot-profiles.json \
 *       --legacy-user-id <owner supabase users.id> --report backfill-report-profiles-dryrun.json
 *   # 3) PLAN of the avatar binary copy (no network, no Storage; writes a 0600 manifest, nothing else)
 *   … --plan-binaries --manifest-out ./avatar-binaries-manifest.json
 *   # 4) apply (metadata only; both flags are mandatory on a real project; the 0600 rollback file is written BEFORE the first write)
 *   … --apply --yes-production --rollback-out ./backfill-rollback-profiles-<ts>.json
 *   # rollback of what an apply created (dry-run unless --apply --yes-production)
 *   … --rollback ./backfill-rollback-profiles-<ts>.json [--apply --yes-production]
 *
 * Snapshot: scripts/sql/profiles_snapshot.sql → { format: 'iomixo.profiles.snapshot.v1', counts, users, djProfiles }. Nothing is ever deleted by a run.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { BackfillRefused } from '../src/services/entitlementBackfill'
import { inventoryProfiles, runProfileBackfill, runProfileRollback, buildAvatarManifest, type ProfileSnapshot } from '../src/services/profileBackfill'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }

function loadSnapshot(): ProfileSnapshot {
  const path = val('input') ?? (() => { throw new BackfillRefused(['--input <snapshot.json> is required']) })()
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (raw?.format !== 'iomixo.profiles.snapshot.v1') throw new BackfillRefused([`unknown snapshot format: ${raw?.format}`])
  const s: ProfileSnapshot = { users: raw.users, djProfiles: raw.djProfiles }
  for (const k of Object.keys(s) as Array<keyof ProfileSnapshot>) if (!Array.isArray(s[k])) throw new BackfillRefused([`snapshot.${k} must be an array`])
  // `users` is exported filtered (only accounts with a name or an avatar): the count is an upper bound, not an equality.
  if (typeof raw.counts?.users === 'number' && s.users.length > raw.counts.users) throw new BackfillRefused([`snapshot.users: more rows (${s.users.length}) than counts.users (${raw.counts.users})`])
  if (typeof raw.counts?.djProfiles === 'number' && raw.counts.djProfiles !== s.djProfiles.length) throw new BackfillRefused([`snapshot.djProfiles: count (${raw.counts.djProfiles}) != length (${s.djProfiles.length}): truncated copy?`])
  return s
}

async function main() {
  if (flag('snapshot-only')) { console.log(JSON.stringify({ mode: 'snapshot-only', inventory: inventoryProfiles(loadSnapshot()) }, null, 2)); return }
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
    console.log(JSON.stringify({ mode: apply ? 'rollback-apply' : 'rollback-dry-run', ...(await runProfileRollback(db, file.entries ?? [], { apply, projectId: project, yesProduction: yes })) }, null, 2)); return
  }
  const snap = loadSnapshot()
  if (flag('plan-binaries')) {
    const out = val('manifest-out') ?? './avatar-binaries-manifest.json'
    if (existsSync(out)) throw new BackfillRefused([`${out} already exists: refusing to overwrite`])
    const m = await buildAvatarManifest(snap, db, { legacyUserId: val('legacy-user-id') })
    writeFileSync(out, JSON.stringify({ project, createdAt: new Date().toISOString(), ...m }), { mode: 0o600 })
    console.log(JSON.stringify({ mode: 'plan-binaries', files: m.entries.length, user: m.entries.filter((e) => e.kind === 'user').length, dj: m.entries.filter((e) => e.kind === 'dj').length, unmapped: m.unmapped, skipped: m.skipped, manifest: out }, null, 2)); return
  }
  const rollbackOut = val('rollback-out') ?? `./backfill-rollback-profiles-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  if (apply && existsSync(rollbackOut)) throw new BackfillRefused([`${rollbackOut} already exists: refusing to overwrite a rollback file`])
  const report = await runProfileBackfill(snap, { apply, projectId: project, yesProduction: yes, limit: val('limit') ? Number(val('limit')) : undefined, legacyUserId: val('legacy-user-id') }, { db })
  const { entries, ...printable } = report
  if (apply && entries) writeFileSync(rollbackOut, JSON.stringify({ project, createdAt: new Date().toISOString(), entries }), { mode: 0o600 })
  if (val('report')) writeFileSync(val('report')!, JSON.stringify(printable, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(printable, null, 2))
  if (apply) console.log(`rollback file: ${rollbackOut} (local, NOT to be committed)`)
}

main().catch((e) => { console.error(e instanceof BackfillRefused ? `REFUSED: ${e.reasons.join('; ')}` : `ERROR: ${(e as Error).message}`); process.exit(2) })
