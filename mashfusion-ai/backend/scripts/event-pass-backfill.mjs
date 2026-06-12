#!/usr/bin/env node
/**
 * IOMIXO — backfill Event Pass 24H for completed checkouts that were NOT activated.
 *
 * Before the webhook fix, a 100%-coupon (0€) checkout left the user without an
 * Event Pass because the old handler bailed out on `no_payment_required` / missing
 * payment_intent. This script replays the activation logic for any recent completed
 * Event Pass checkout that has no matching `event_passes` row yet.
 *
 * It mirrors the webhook exactly:
 *   - eligible when status === 'complete' AND payment_status in (paid, no_payment_required)
 *   - dedup key = payment_intent ?? checkout session id
 *   - valid_until = NOW + 24h, status = 'active'
 *
 * Read-only by default (dry-run). Pass --apply to actually create the passes.
 * Secrets are NEVER printed. Provide them via argv / env only.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/event-pass-backfill.mjs <sk_live_key> [--apply] [--limit=20]
 */
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const KEY = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : process.env.STRIPE_SECRET_KEY
const APPLY = process.argv.includes('--apply')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Math.max(1, Math.min(100, parseInt(limitArg.split('=')[1]) || 20)) : 20

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!KEY) {
  console.error('❌ Missing Stripe secret key (argv[2] or STRIPE_SECRET_KEY).')
  process.exit(1)
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.')
  process.exit(1)
}

const stripe = new Stripe(KEY, { apiVersion: '2024-04-10' })
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const mask = (id) => (id ? `${id.slice(0, 10)}…${id.slice(-4)}` : '-')

async function main() {
  console.log(`→ Stripe mode: ${KEY.startsWith('sk_test_') ? 'TEST' : 'LIVE'}`)
  console.log(`→ Action: ${APPLY ? 'APPLY (will create passes)' : 'DRY-RUN (no changes)'}`)
  console.log(`→ Scanning last ${LIMIT} checkout sessions\n`)

  const sessions = await stripe.checkout.sessions.list({ limit: LIMIT })

  let created = 0
  let skipped = 0
  for (const s of sessions.data) {
    if (s.mode !== 'payment') continue

    const isCompleted = s.status === 'complete'
    const isValidPayment = s.payment_status === 'paid' || s.payment_status === 'no_payment_required'
    const userId = s.metadata?.user_id

    if (!isCompleted || !isValidPayment) continue
    if (!userId) {
      console.log(`  [skip] ${mask(s.id)} — no user_id in metadata`)
      continue
    }

    const dedupId = (typeof s.payment_intent === 'string' ? s.payment_intent : null) ?? s.id

    // Already activated?
    const { data: existing, error: qErr } = await supabase
      .from('event_passes')
      .select('id, status, valid_until')
      .eq('stripe_payment_intent_id', dedupId)
      .maybeSingle()

    if (qErr) {
      console.error(`  ⚠️  query failed for ${mask(s.id)}:`, qErr.message)
      continue
    }

    if (existing) {
      skipped++
      console.log(`  [exists] ${mask(s.id)} user=${mask(userId)} pass=${mask(existing.id)} status=${existing.status}`)
      continue
    }

    const amountTotal = s.amount_total ?? 0
    const amountDiscount = s.total_details?.amount_discount ?? 0
    const currency = s.currency || 'eur'
    const sessionId = s.metadata?.session_id || null
    const validUntil = new Date()
    validUntil.setHours(validUntil.getHours() + 24)

    console.log(
      `  [MISSING → activate] ${mask(s.id)} user=${mask(userId)} ` +
        `payment_status=${s.payment_status} total=${amountTotal} discount=${amountDiscount}`,
    )

    if (APPLY) {
      const { error: insErr } = await supabase.from('event_passes').insert({
        user_id: userId,
        session_id: sessionId,
        stripe_payment_intent_id: dedupId,
        amount_cents: amountTotal,
        currency,
        valid_until: validUntil.toISOString(),
        status: 'active',
      })
      if (insErr) {
        console.error(`     ⚠️  insert failed:`, insErr.message)
        continue
      }
      await supabase.from('payments').upsert(
        {
          user_id: userId,
          stripe_payment_intent_id: dedupId,
          amount_cents: amountTotal,
          currency,
          status: 'succeeded',
          description: `Event Pass 24H (backfill) — valido fino al ${validUntil.toISOString()}`,
        },
        { ignoreDuplicates: true, onConflict: 'stripe_payment_intent_id' },
      )
      created++
      console.log(`     → event pass active until ${validUntil.toISOString()}`)
    }
  }

  console.log(`\n== Summary ==`)
  console.log(`  already active : ${skipped}`)
  console.log(`  ${APPLY ? 'created' : 'would create'}        : ${created || (APPLY ? 0 : '(see MISSING above)')}`)
  if (!APPLY) console.log(`\nRe-run with --apply to create the missing passes.`)
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err.message)
  process.exit(1)
})
