/**
 * Backfill of Supabase live_sessions → Firestore events/{eventId} + eventSlugs/{slug}. DRY RUN by default.
 *
 *   # 1) format check + statistics of the exported snapshot (NO Firestore, NO network, no project needed)
 *   npx ts-node --transpile-only scripts/backfill-events.ts --input snapshot-sessions.json --snapshot-only
 *   # 2) dry-run against production (Firestore READS only)
 *   FIREBASE_PROJECT_ID=iomixo-494817 npx ts-node --transpile-only scripts/backfill-events.ts --project iomixo-494817 --input snapshot-sessions.json --report backfill-report-events-dryrun.json
 *   # 3) apply (both flags are mandatory on a real project; the rollback file is written 0600 BEFORE the first write)
 *   … --apply --yes-production --rollback-out ./backfill-rollback-events-<ts>.json
 *   # rollback of what a previous apply created/updated (dry-run unless --apply --yes-production)
 *   … --rollback ./backfill-rollback-events-<ts>.json [--apply --yes-production]
 *
 * Flags: --limit N · --legacy-user-id <supabase users.id> · --report out.json (masked).
 * Owner mapping is ONLY users/{uid}.legacySupabaseId (there is no email fallback). Nothing is ever deleted by a run.
 * Snapshot format (SQL: scripts/sql/live_sessions_snapshot.sql): { "format": "iomixo.live_sessions.snapshot.v1", "generatedAt", "count", "sessions": [ {id, dj_id, public_slug,
 *   event_name, dj_name, description, is_active, session_type, couple_names, wedding_date, venue_name, screen_mode_enabled, guest_config, screen_config,
 *   roulette_penitenze, shoe_game_questions, created_at, updated_at} ] }   (a bare array of sessions is accepted too)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { BackfillRefused } from '../src/services/entitlementBackfill'
import { inventoryEvents, runEventBackfill, runEventRollback, type LegacySessionSnapshotRow } from '../src/services/eventBackfill'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }

function loadSessions(): LegacySessionSnapshotRow[] {
  const path = val('input') ?? (() => { throw new BackfillRefused(['--input <snapshot.json> is required']) })()
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const sessions = Array.isArray(raw) ? raw : raw?.sessions
  if (!Array.isArray(sessions)) throw new BackfillRefused(['snapshot must be { sessions: [...] } or a bare array'])
  if (!Array.isArray(raw) && raw.format && raw.format !== 'iomixo.live_sessions.snapshot.v1') throw new BackfillRefused([`unknown snapshot format: ${raw.format}`])
  if (!Array.isArray(raw) && typeof raw.count === 'number' && raw.count !== sessions.length) throw new BackfillRefused([`snapshot count (${raw.count}) != sessions length (${sessions.length}): truncated copy?`])
  return sessions
}

async function main() {
  if (flag('snapshot-only')) {
    console.log(JSON.stringify({ mode: 'snapshot-only', inventory: inventoryEvents(loadSessions()) }, null, 2)); return
  }
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
    const r = await runEventRollback(db, file, { apply, projectId: project, yesProduction: yes })
    console.log(JSON.stringify({ mode: apply ? 'rollback-apply' : 'rollback-dry-run', ...r }, null, 2)); return
  }

  const sessions = loadSessions()
  const rollbackOut = val('rollback-out') ?? `./backfill-rollback-events-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  if (apply && existsSync(rollbackOut)) throw new BackfillRefused([`${rollbackOut} already exists: refusing to overwrite a rollback file`])
  const report = await runEventBackfill({ sessions }, {
    apply, projectId: project, yesProduction: yes, limit: val('limit') ? Number(val('limit')) : undefined, legacyUserId: val('legacy-user-id'),
  }, {
    db,
    onBeforeApply: async (preImage) => { writeFileSync(rollbackOut, JSON.stringify({ project, createdAt: new Date().toISOString(), preImage, entries: [] }), { mode: 0o600 }) },
  })
  if (apply && report.rollbackEntries) {
    const f = JSON.parse(readFileSync(rollbackOut, 'utf8')); f.entries = report.rollbackEntries; writeFileSync(rollbackOut, JSON.stringify(f), { mode: 0o600 })
  }
  const { rollbackEntries, ...printable } = report
  void rollbackEntries
  if (val('report')) writeFileSync(val('report')!, JSON.stringify(printable, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(printable, null, 2))
  if (apply) console.log(`rollback file: ${rollbackOut} (local, NOT to be committed)`)
}

main().catch((e) => { console.error(e instanceof BackfillRefused ? `REFUSED: ${e.reasons.join('; ')}` : `ERROR: ${(e as Error).message}`); process.exit(2) })
