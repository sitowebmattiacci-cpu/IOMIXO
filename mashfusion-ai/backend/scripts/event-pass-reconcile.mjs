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

async function isPaid(paymentIntentId) {
  if (!paymentIntentId) return false
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
    return pi.status === 'succeeded'
  } catch (err) {
    // resource_missing → PI does not exist in this Stripe environment → not paid.
    if (err instanceof Stripe.errors.StripeError && err.code === 'resource_missing') return false
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

  let toCancel = 0
  for (const p of passes) {
    const paid = await isPaid(p.stripe_payment_intent_id)
    const amount = p.amount_cents != null ? `${p.amount_cents / 100} ${(p.currency || '').toUpperCase()}` : '?'
    const tag = paid ? 'PAID ✅ keep' : 'NOT PAID ❌ cancel'
    console.log(`  [${tag}] pass=${mask(p.id)} user=${mask(p.user_id)} pi=${mask(p.stripe_payment_intent_id)} | ${amount} | valid_until=${p.valid_until}`)

    if (!paid) {
      toCancel++
      if (APPLY) {
        const { error: upErr } = await supabase
          .from('event_passes')
          .update({ status: 'expired' })
          .eq('id', p.id)
        if (upErr) console.error(`     ⚠️  failed to expire ${mask(p.id)}:`, upErr.message)
        else console.log(`     → expired`)
      }
    }
  }

  console.log(`\n== Summary ==`)
  console.log(`  active passes checked : ${passes.length}`)
  console.log(`  not paid (phantom)    : ${toCancel}`)
  console.log(`  ${APPLY ? 'canceled' : 'would cancel'}              : ${toCancel}`)
  if (!APPLY && toCancel > 0) console.log(`\nRe-run with --apply to cancel the phantom passes.`)
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err.message)
  process.exit(1)
})
