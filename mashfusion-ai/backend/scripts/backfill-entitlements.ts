/**
 * Backfill of legacy plans + Event Passes into Firestore. DRY RUN by default.
 *
 *   # inventory / dry-run from an exported snapshot (no network except Firestore reads)
 *   FIREBASE_PROJECT_ID=iomixo-494817 npx ts-node --transpile-only scripts/backfill-entitlements.ts --project iomixo-494817 --input snapshot.json
 *   # dry-run reading Supabase READ-ONLY (GET only; needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment)
 *   … --from-supabase
 *   # apply (both flags are mandatory on a real project)
 *   … --apply --yes-production --rollback-out ./backfill-rollback-<ts>.json
 *   # rollback of what a previous apply wrote
 *   … --rollback ./backfill-rollback-<ts>.json [--apply --yes-production]
 *
 * Format check only (no Firestore, no network):  … --input snapshot.json --snapshot-only
 * Other flags: --limit N · --user-email x · --legacy-user-id uuid · --email-fallback · --allow-unversioned-downgrade · --report out.json
 * The report is masked (ids, emails, Stripe keys); passwords, tokens and service keys are never printed. This script does NOT create Firebase users.
 * Snapshot format (alias: "eventPasses" for "passes"): { "users": [{id,email,plan,stripe_customer_id,created_at,updated_at}], "passes": [{id,user_id,session_id,stripe_payment_intent_id,
 *                    amount_cents,currency,valid_until,status,created_at,updated_at}] }
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { firestore, firebaseAuth, isFirebaseAuthConfigured } from '../src/lib/firebaseAdmin'
import { runBackfill, runRollback, BackfillRefused, type LegacyUserRow } from '../src/services/entitlementBackfill'
import type { LegacyEventPassRow } from '../src/repositories/entitlementRepository'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }

/** Read-only PostgREST GET with pagination. Never logs the key. */
async function readSupabase(): Promise<{ users: LegacyUserRow[]; passes: LegacyEventPassRow[] }> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('--from-supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment')
  const all = async <T,>(table: string, select: string): Promise<T[]> => {
    const rows: T[] = []
    for (let from = 0; ; from += 1000) {
      const res = await fetch(`${url}/rest/v1/${table}?select=${select}&order=id.asc`, { method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } })
      if (!res.ok) throw new Error(`supabase GET ${table} failed: ${res.status}`)
      const page = (await res.json()) as T[]; rows.push(...page); if (page.length < 1000) return rows
    }
  }
  return {
    users: await all<LegacyUserRow>('users', 'id,email,plan,stripe_customer_id,created_at,updated_at'),
    passes: await all<LegacyEventPassRow>('event_passes', 'id,user_id,session_id,stripe_payment_intent_id,amount_cents,currency,valid_until,status,created_at,updated_at'),
  }
}

async function loadInput(): Promise<{ users: LegacyUserRow[]; passes: LegacyEventPassRow[] }> {
  const raw = flag('from-supabase') ? await readSupabase() : JSON.parse(readFileSync(val('input') ?? (() => { throw new BackfillRefused(['--input <snapshot.json> or --from-supabase is required']) })(), 'utf8'))
  const input = { users: raw.users ?? [], passes: raw.passes ?? raw.eventPasses ?? [] }          // `eventPasses` accepted as an alias of `passes`
  if (!Array.isArray(input.users) || !Array.isArray(input.passes)) throw new BackfillRefused(['snapshot must be { users: [...], passes: [...] }'])
  return input
}

async function main() {
  // --snapshot-only: validates the exported file and prints its statistics. NO Firestore, NO network, no project needed.
  if (flag('snapshot-only')) {
    const { inventorySnapshot } = await import('../src/services/entitlementBackfill')
    const input = await loadInput()
    console.log(JSON.stringify({ mode: 'snapshot-only', inventory: inventorySnapshot(input.users, input.passes) }, null, 2)); return
  }
  const project = val('project'), envProject = process.env.FIREBASE_PROJECT_ID
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
  if (!project) throw new BackfillRefused(['--project is required (explicit target)'])
  if (!emulator && envProject !== project) throw new BackfillRefused([`FIREBASE_PROJECT_ID (${envProject ?? 'unset'}) must equal --project (${project})`])
  if (emulator && !project.startsWith('demo-')) throw new BackfillRefused(['emulator host set but --project is not a demo-* project'])
  if (!isFirebaseAuthConfigured()) throw new BackfillRefused(['Firebase Admin is not configured'])
  const apply = flag('apply'), yes = flag('yes-production')
  if ((apply || val('rollback')) && apply && !emulator && !yes) throw new BackfillRefused(['--apply on a real project requires --yes-production (checked before any Firestore access)'])
  const db = firestore()

  if (val('rollback')) {
    const file = JSON.parse(readFileSync(val('rollback')!, 'utf8'))
    const r = await runRollback(db, file, { apply, projectId: project, yesProduction: yes })
    console.log(JSON.stringify({ mode: apply ? 'rollback-apply' : 'rollback-dry-run', ...r }, null, 2)); return
  }

  const input = await loadInput()
  const rollbackOut = val('rollback-out') ?? `./backfill-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  if (apply && existsSync(rollbackOut)) throw new BackfillRefused([`${rollbackOut} already exists: refusing to overwrite a rollback file`])
  const report = await runBackfill(input, {
    apply, projectId: project, yesProduction: yes, emailFallback: flag('email-fallback'), allowUnversionedDowngrade: flag('allow-unversioned-downgrade'),
    limit: val('limit') ? Number(val('limit')) : undefined, userEmail: val('user-email'), legacyUserId: val('legacy-user-id'),
  }, {
    db, auth: flag('email-fallback') ? firebaseAuth() : undefined,
    onBeforeApply: async (preImage) => { writeFileSync(rollbackOut, JSON.stringify({ project, createdAt: new Date().toISOString(), preImage, entries: [] }), { mode: 0o600 }) },
  })
  if (apply && report.rollbackEntries) {
    const f = JSON.parse(readFileSync(rollbackOut, 'utf8')); f.entries = report.rollbackEntries; writeFileSync(rollbackOut, JSON.stringify(f), { mode: 0o600 })
  }
  const { rollbackEntries, ...printable } = report
  void rollbackEntries
  if (val('report')) writeFileSync(val('report')!, JSON.stringify(printable, null, 2))
  console.log(JSON.stringify(printable, null, 2))
  if (apply) console.log(`rollback file: ${rollbackOut} (local, NOT to be committed)`)
}

main().catch((e) => { console.error(e instanceof BackfillRefused ? `REFUSED: ${e.reasons.join('; ')}` : `ERROR: ${(e as Error).message}`); process.exit(2) })
