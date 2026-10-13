/**
 * Backfill of the legacy BILLING HISTORY (customer mapping, subscriptions, payments) into Firestore. DRY RUN by default. No Stripe call, no entitlement,
 * users/{uid}.plan and the migrated eventPasses are never touched (see src/services/billingBackfill.ts).
 *
 *   # 1) format check + statistics of the exported snapshot (NO Firestore, NO network, no project needed)
 *   npx ts-node --transpile-only scripts/backfill-billing.ts --input snapshot-billing-2026-10-13.json --snapshot-only
 *   # 2) dry-run against production (Firestore READS only)
 *   FIREBASE_PROJECT_ID=iomixo-494817 npx ts-node --transpile-only scripts/backfill-billing.ts --project iomixo-494817 --input snapshot-billing-2026-10-13.json \
 *       --legacy-user-id <owner supabase users.id> --report backfill-report-billing-dryrun.json
 *   # 3) apply (both flags are mandatory on a real project; the 0600 rollback file is written BEFORE the first write)
 *   … --apply --yes-production --rollback-out ./backfill-rollback-billing-<ts>.json
 *   # rollback of what an apply created (dry-run unless --apply --yes-production)
 *   … --rollback ./backfill-rollback-billing-<ts>.json [--apply --yes-production]
 *
 * Snapshot: scripts/sql/billing_snapshot.sql → { format: 'iomixo.billing.snapshot.v1', generatedAt, counts, columns, users, subscriptions, payments, eventPasses }.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { BackfillRefused } from '../src/services/entitlementBackfill'
import { inventoryBilling, runBillingBackfill, runBillingRollback, type BillingSnapshot } from '../src/services/billingBackfill'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }

function loadSnapshot(): BillingSnapshot {
  const path = val('input') ?? (() => { throw new BackfillRefused(['--input <snapshot.json> is required']) })()
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (raw?.format !== 'iomixo.billing.snapshot.v1') throw new BackfillRefused([`unknown snapshot format: ${raw?.format}`])
  const s = { generatedAt: raw.generatedAt, users: raw.users, subscriptions: raw.subscriptions, payments: raw.payments, eventPasses: raw.eventPasses } as BillingSnapshot
  for (const k of ['users', 'subscriptions', 'payments', 'eventPasses'] as const) if (!Array.isArray(s[k])) throw new BackfillRefused([`snapshot.${k} must be an array`])
  // `users` is exported filtered (billing-relevant accounts only): its count is checked against counts.usersBilling, the others against their table count.
  if (typeof raw.counts?.usersBilling === 'number' && raw.counts.usersBilling !== s.users.length) throw new BackfillRefused([`snapshot.users: count (${raw.counts.usersBilling}) != length (${s.users.length}): truncated copy?`])
  for (const k of ['subscriptions', 'payments', 'eventPasses'] as const) if (typeof raw.counts?.[k] === 'number' && raw.counts[k] !== s[k].length) throw new BackfillRefused([`snapshot.${k}: count (${raw.counts[k]}) != length (${s[k].length}): truncated copy?`])
  return s
}

async function main() {
  if (flag('snapshot-only')) { console.log(JSON.stringify({ mode: 'snapshot-only', inventory: inventoryBilling(loadSnapshot()) }, null, 2)); return }
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
    console.log(JSON.stringify({ mode: apply ? 'rollback-apply' : 'rollback-dry-run', ...(await runBillingRollback(db, file.entries ?? [], { apply, projectId: project, yesProduction: yes })) }, null, 2)); return
  }
  const snap = loadSnapshot()
  const rollbackOut = val('rollback-out') ?? `./backfill-rollback-billing-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  if (apply && existsSync(rollbackOut)) throw new BackfillRefused([`${rollbackOut} already exists: refusing to overwrite a rollback file`])
  const report = await runBillingBackfill(snap, { apply, projectId: project, yesProduction: yes, legacyUserId: val('legacy-user-id') }, { db })
  const { entries, ...printable } = report
  if (apply && entries) writeFileSync(rollbackOut, JSON.stringify({ project, createdAt: new Date().toISOString(), entries }), { mode: 0o600 })
  if (val('report')) writeFileSync(val('report')!, JSON.stringify(printable, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(printable, null, 2))
  if (apply) console.log(`rollback file: ${rollbackOut} (local, NOT to be committed)`)
}

main().catch((e) => { console.error(e instanceof BackfillRefused ? `REFUSED: ${e.reasons.join('; ')}` : `ERROR: ${(e as Error).message}`); process.exit(2) })
