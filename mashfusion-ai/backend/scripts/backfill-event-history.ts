/**
 * Backfill of the HISTORICAL children (requests, dedications, polls + votes) of events already migrated to Firestore. DRY RUN by default.
 *
 *   # 1) format check + statistics of the exported snapshot (NO Firestore, NO network, no project needed)
 *   npx ts-node --transpile-only scripts/backfill-event-history.ts --input snapshot-history.json --snapshot-only
 *   # 2) dry-run against production (Firestore READS only)
 *   FIREBASE_PROJECT_ID=iomixo-494817 npx ts-node --transpile-only scripts/backfill-event-history.ts --project iomixo-494817 \
 *       --input snapshot-history.json --legacy-user-id <owner supabase users.id> --report backfill-report-history-dryrun.json
 *   # 3) apply (both flags are mandatory on a real project; the 0600 rollback file is written BEFORE the first write)
 *   … --apply --yes-production --rollback-out ./backfill-rollback-history-<ts>.json
 *   # rollback of what a previous apply created/updated (dry-run unless --apply --yes-production)
 *   … --rollback ./backfill-rollback-history-<ts>.json [--apply --yes-production]
 *
 * Flags: --limit N (sessions) · --legacy-user-id <supabase users.id of the owner> · --report out.json (masked).
 * Only sessions whose event already exists in Firestore AND whose owner maps through users/{uid}.legacySupabaseId are touched. No email fallback.
 * Nothing is ever deleted by a run; the rollback removes only documents this run created, and only if unchanged and without sub-documents.
 * Snapshot: scripts/sql/event_history_snapshot.sql → { format: 'iomixo.event_history.snapshot.v1', counts, sessions, requests, dedications, polls, votes }.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { BackfillRefused } from '../src/services/entitlementBackfill'
import { runEventRollback } from '../src/services/eventBackfill'
import { inventoryHistory, runHistoryBackfill, type HistorySnapshot } from '../src/services/eventHistoryBackfill'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }

function loadSnapshot(): HistorySnapshot {
  const path = val('input') ?? (() => { throw new BackfillRefused(['--input <snapshot.json> is required']) })()
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (raw?.format !== 'iomixo.event_history.snapshot.v1') throw new BackfillRefused([`unknown snapshot format: ${raw?.format}`])
  const s: HistorySnapshot = { sessions: raw.sessions, requests: raw.requests, dedications: raw.dedications, polls: raw.polls, votes: raw.votes }
  for (const k of Object.keys(s) as Array<keyof HistorySnapshot>) if (!Array.isArray(s[k])) throw new BackfillRefused([`snapshot.${k} must be an array`])
  for (const k of Object.keys(s) as Array<keyof HistorySnapshot>) {
    if (typeof raw.counts?.[k] === 'number' && raw.counts[k] !== s[k].length) throw new BackfillRefused([`snapshot.${k}: count (${raw.counts[k]}) != length (${s[k].length}): truncated copy?`])
  }
  return s
}

async function main() {
  if (flag('snapshot-only')) { console.log(JSON.stringify({ mode: 'snapshot-only', inventory: inventoryHistory(loadSnapshot()) }, null, 2)); return }
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

  const snapshot = loadSnapshot()
  const rollbackOut = val('rollback-out') ?? `./backfill-rollback-history-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  if (apply && existsSync(rollbackOut)) throw new BackfillRefused([`${rollbackOut} already exists: refusing to overwrite a rollback file`])
  const report = await runHistoryBackfill(snapshot, { apply, projectId: project, yesProduction: yes, legacyUserId: val('legacy-user-id'), limit: val('limit') ? Number(val('limit')) : undefined }, {
    db, onBeforeApply: async (preImage) => { writeFileSync(rollbackOut, JSON.stringify({ project, createdAt: new Date().toISOString(), preImage, entries: [] }), { mode: 0o600 }) },
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
