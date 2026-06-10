#!/usr/bin/env node
/**
 * IOMIXO — inspect Stripe PaymentIntents in detail (read-only).
 *
 * Shows status, amount, charge outcome, decline reason, 3DS, created time, and
 * the linked checkout session — to explain mismatches between Stripe and the
 * cardholder's bank notification.
 *
 * Secrets are NEVER printed.
 *
 * Usage:
 *   node scripts/stripe-inspect-pi.mjs <sk_live_key> [customer_email]
 */
import Stripe from 'stripe'

const KEY = process.argv[2] || process.env.STRIPE_SECRET_KEY
const EMAIL = process.argv[3] || process.env.CUSTOMER_EMAIL || null

if (!KEY) {
  console.error('❌ Missing Stripe secret key (argv[2] or STRIPE_SECRET_KEY).')
  process.exit(1)
}

const stripe = new Stripe(KEY, { apiVersion: '2024-04-10' })
const fmt = (cents, cur) => (cents != null ? `${(cents / 100).toFixed(2)} ${(cur || '').toUpperCase()}` : '?')
const when = (ts) => (ts ? new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' ') : '-')

async function main() {
  console.log(`→ Stripe mode: ${KEY.startsWith('sk_test_') ? 'TEST' : 'LIVE'}`)

  let customerId = null
  if (EMAIL) {
    const found = await stripe.customers.list({ email: EMAIL, limit: 100 })
    if (found.data.length > 0) {
      customerId = found.data[0].id
      console.log(`→ Customer ${EMAIL} = ${customerId}`)
    } else {
      console.log(`→ No customer found for ${EMAIL}`)
    }
  }

  // Pull recent one-time checkout sessions (Event Pass) and their PaymentIntents.
  console.log('\n== One-time checkout sessions (mode=payment) ==\n')
  const sessions = []
  for await (const s of stripe.checkout.sessions.list({ limit: 100, expand: ['data.payment_intent'] })) {
    if (s.mode !== 'payment') continue
    if (customerId && s.customer !== customerId) continue
    sessions.push(s)
  }

  if (sessions.length === 0) {
    console.log('  (nessuna sessione mode=payment per questo cliente)')
  }

  for (const s of sessions) {
    const pi = typeof s.payment_intent === 'object' ? s.payment_intent : null
    console.log(`SESSION ${s.id}`)
    console.log(`  created            : ${when(s.created)}`)
    console.log(`  session status     : ${s.status}`)             // open / complete / expired
    console.log(`  payment_status     : ${s.payment_status}`)     // paid / unpaid / no_payment_required
    console.log(`  amount_total       : ${fmt(s.amount_total, s.currency)}`)
    console.log(`  customer           : ${s.customer || '-'}`)

    if (pi) {
      console.log(`  PaymentIntent      : ${pi.id}`)
      console.log(`    pi.status        : ${pi.status}`)
      console.log(`    pi.amount        : ${fmt(pi.amount, pi.currency)} (received ${fmt(pi.amount_received, pi.currency)})`)
      const lastErr = pi.last_payment_error
      if (lastErr) {
        console.log(`    last_error       : code=${lastErr.code || '-'} declineCode=${lastErr.decline_code || '-'}`)
        console.log(`    last_error msg   : ${lastErr.message || '-'}`)
      }
      // Charges + outcome explain the bank-vs-Stripe mismatch.
      const charges = await stripe.charges.list({ payment_intent: pi.id, limit: 10 })
      for (const ch of charges.data) {
        const o = ch.outcome || {}
        console.log(`    charge ${ch.id}`)
        console.log(`      paid=${ch.paid} captured=${ch.captured} status=${ch.status} refunded=${ch.refunded}`)
        console.log(`      outcome.type=${o.type || '-'} network_status=${o.network_status || '-'} reason=${o.reason || '-'}`)
        console.log(`      seller_message=${o.seller_message || '-'}`)
      }
    } else {
      console.log(`  PaymentIntent      : (none / not created)`)
    }
    console.log('')
  }
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err.message)
  process.exit(1)
})
