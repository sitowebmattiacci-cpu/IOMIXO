#!/usr/bin/env node
/**
 * IOMIXO — cancel active Stripe subscriptions (test cleanup).
 *
 * Immediately cancels every active/trialing/past_due subscription so you can
 * start a clean billing test. Optionally restrict to a single customer email.
 *
 * Usage:
 *   node scripts/stripe-cancel-subs.mjs <sk_test_key> [customer_email]
 *   # or
 *   STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-cancel-subs.mjs
 */
import Stripe from 'stripe'

const KEY = process.argv[2] || process.env.STRIPE_SECRET_KEY
const EMAIL = process.argv[3] || process.env.CUSTOMER_EMAIL || null

if (!KEY) {
  console.error('❌ Missing Stripe secret key. Pass it as the first argument.')
  process.exit(1)
}
if (!KEY.startsWith('sk_test_')) {
  console.error('❌ Refusing to run: this cleanup is for TEST keys only (sk_test_...).')
  process.exit(1)
}

const stripe = new Stripe(KEY, { apiVersion: '2024-04-10' })
const CANCELABLE = new Set(['active', 'trialing', 'past_due', 'unpaid'])

async function main() {
  let customerId = null
  if (EMAIL) {
    const found = await stripe.customers.list({ email: EMAIL, limit: 100 })
    if (found.data.length === 0) {
      console.error(`❌ No customer found with email ${EMAIL}`)
      process.exit(1)
    }
    customerId = found.data[0].id
    console.log(`→ Limiting to customer ${EMAIL} (${customerId})`)
  }

  const listParams = { status: 'all', limit: 100 }
  if (customerId) listParams.customer = customerId

  let canceled = 0
  let skipped = 0
  for await (const sub of stripe.subscriptions.list(listParams)) {
    if (!CANCELABLE.has(sub.status)) { skipped++; continue }
    const price = sub.items.data[0]?.price
    const label = price ? `${price.unit_amount / 100} ${price.currency.toUpperCase()}` : '?'
    await stripe.subscriptions.cancel(sub.id)
    canceled++
    console.log(`  ✓ canceled ${sub.id} (${label}, was ${sub.status})`)
  }

  console.log(`\nDone. Canceled ${canceled} subscription(s), skipped ${skipped} non-active.`)
}

main().catch((err) => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
