#!/usr/bin/env node
/**
 * IOMIXO — list Stripe subscriptions (read-only test inspection).
 *
 * Usage:
 *   node scripts/stripe-list-subs.mjs <sk_test_key> [customer_email]
 */
import Stripe from 'stripe'

const KEY = process.argv[2] || process.env.STRIPE_SECRET_KEY
const EMAIL = process.argv[3] || process.env.CUSTOMER_EMAIL || null

if (!KEY) {
  console.error('❌ Missing Stripe secret key.')
  process.exit(1)
}

const stripe = new Stripe(KEY, { apiVersion: '2024-04-10' })

async function main() {
  console.log(`→ Account mode: ${KEY.startsWith('sk_test_') ? 'TEST' : 'LIVE'}`)

  let customerId = null
  if (EMAIL) {
    const found = await stripe.customers.list({ email: EMAIL, limit: 100 })
    if (found.data.length === 0) {
      console.log(`(no customer found with email ${EMAIL})`)
    } else {
      customerId = found.data[0].id
      console.log(`→ Customer ${EMAIL} = ${customerId}`)
    }
  }

  const listParams = { status: 'all', limit: 100 }
  if (customerId) listParams.customer = customerId

  const productNames = new Map()
  async function nameFor(productId) {
    if (!productId) return '?'
    if (productNames.has(productId)) return productNames.get(productId)
    try {
      const p = await stripe.products.retrieve(productId)
      productNames.set(productId, p.name)
      return p.name
    } catch { return productId }
  }

  let n = 0
  for await (const sub of stripe.subscriptions.list(listParams)) {
    n++
    const price = sub.items.data[0]?.price
    const prodName = await nameFor(price?.product)
    const amount = price ? `${price.unit_amount / 100} ${price.currency.toUpperCase()}` : '?'
    const created = new Date(sub.created * 1000).toISOString().slice(0, 16).replace('T', ' ')
    console.log(`  [${sub.status.toUpperCase()}] ${sub.id} | ${prodName} ${amount} | created ${created} | cancel_at_period_end=${sub.cancel_at_period_end}`)
  }
  console.log(`\nTotal: ${n} subscription(s).`)
}

main().catch((err) => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
