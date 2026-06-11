#!/usr/bin/env node
/**
 * IOMIXO — inspect the most recent Checkout Sessions (read-only).
 * Shows payment_method_types and allow_promotion_codes so we can confirm whether
 * the deployed backend is applying our explicit restriction. Secrets NEVER printed.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_... node scripts/stripe-inspect-checkout.mjs
 */
import Stripe from 'stripe'

const KEY = process.argv[2] || process.env.STRIPE_SECRET_KEY
if (!KEY) {
  console.error('❌ Missing Stripe secret key (argv[2] or STRIPE_SECRET_KEY).')
  process.exit(1)
}

const stripe = new Stripe(KEY, { apiVersion: '2024-04-10' })

async function main() {
  console.log(`→ Stripe mode: ${KEY.startsWith('sk_test_') ? 'TEST' : 'LIVE'}\n`)
  const sessions = await stripe.checkout.sessions.list({ limit: 5 })
  for (const s of sessions.data) {
    const created = new Date(s.created * 1000).toISOString()
    console.log(`Session ${s.id}`)
    console.log(`  created:               ${created}`)
    console.log(`  mode:                  ${s.mode}`)
    console.log(`  payment_method_types:  ${JSON.stringify(s.payment_method_types)}`)
    console.log(`  allow_promotion_codes: ${s.allow_promotion_codes}`)
    console.log(`  status:                ${s.status} / payment_status: ${s.payment_status}`)
    console.log('')
  }
}

main().catch((err) => {
  console.error('❌ Errore:', err.message)
  process.exit(1)
})
