#!/usr/bin/env node
/**
 * IOMIXO — reconcile Event Pass 24H against the REAL Stripe payment status.
 *
 * Before the webhook guard fix, an Event Pass could be activated even when the
 * payment was never actually collected (declined card, etc.). This script finds
 * every active `event_passes` row whose Stripe payment is NOT confirmed paid and
 * cancels it.
 *
 * Read-only by default (dry-run). Pass --apply to actually cancel the passes.
 *
 * Secrets are NEVER printed. Provide them via argv / env only.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/event-pass-reconcile.mjs <sk_live_key> [--apply]
 */
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const KEY = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : process.env.STRIPE_SECRET_KEY
const APPLY = process.argv.includes('--apply')

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

const mask = (id) => (id ? `${id.slice(0, 8)}…${id.slice(-4)}` : '-')

// Returns the real settlement state of a PaymentIntent:
//   'paid'     → succeeded and not refunded → access stays active
//   'refunded' → succeeded but fully/partially refunded → revoke access
//   'unpaid'   → never succeeded, or does not exist in this environment
async function settlementState(paymentIntentId) {
  if (!paymentIntentId) return 'unpaid'
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
    if (pi.status !== 'succeeded') return 'unpaid'
    const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null
    if (charge && (charge.refunded || (charge.amount_refunded || 0) > 0)) return 'refunded'
    return 'paid'
  } catch (err) {
    // resource_missing → PI does not exist in this Stripe environment → not paid.
    if (err instanceof Stripe.errors.StripeError && err.code === 'resource_missing') return 'unpaid'
    throw err
  }
}

async function main() {
  console.log(`→ Stripe mode: ${KEY.startsWith('sk_test_') ? 'TEST' : 'LIVE'}`)
  console.log(`→ Action: ${APPLY ? 'APPLY (will cancel)' : 'DRY-RUN (no changes)'}\n`)

  const { data: passes, error } = await supabase
    .from('event_passes')
    .select('id, user_id, stripe_payment_intent_id, status, valid_until, amount_cents, currency, created_at')
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('❌ Supabase query failed:', error.message)
    process.exit(1)
  }

  console.log(`== Active event_passes: ${passes.length} ==\n`)

  let toFix = 0
  for (const p of passes) {
    const state = await settlementState(p.stripe_payment_intent_id)
    const amount = p.amount_cents != null ? `${p.amount_cents / 100} ${(p.currency || '').toUpperCase()}` : '?'
    // Map the Stripe settlement state to the target DB status.
    //   paid     → keep active
    //   refunded → 'refunded'
    //   unpaid   → 'expired' (phantom pass that should never have been granted)
    const target = state === 'paid' ? null : state === 'refunded' ? 'refunded' : 'expired'
    const tag = state === 'paid' ? 'PAID ✅ keep' : state === 'refunded' ? 'REFUNDED ↩︎ revoke' : 'NOT PAID ❌ revoke'
    console.log(`  [${tag}] pass=${mask(p.id)} user=${mask(p.user_id)} pi=${mask(p.stripe_payment_intent_id)} | ${amount} | valid_until=${p.valid_until}`)

    if (target) {
      toFix++
      if (APPLY) {
        const { error: upErr } = await supabase
          .from('event_passes')
          .update({ status: target })
          .eq('id', p.id)
        if (upErr) console.error(`     ⚠️  failed to set ${target} on ${mask(p.id)}:`, upErr.message)
        else console.log(`     → ${target}`)
      }
    }
  }

  console.log(`\n== Summary ==`)
  console.log(`  active passes checked : ${passes.length}`)
  console.log(`  to revoke             : ${toFix}`)
  console.log(`  ${APPLY ? 'revoked' : 'would revoke'}               : ${toFix}`)
  if (!APPLY && toFix > 0) console.log(`\nRe-run with --apply to revoke these passes.`)
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err.message)
  process.exit(1)
})
