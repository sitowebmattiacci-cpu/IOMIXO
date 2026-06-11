#!/usr/bin/env node
/**
 * IOMIXO — list recent Stripe one-time payments (read-only test inspection).
 *
 * Usage:
 *   node scripts/stripe-list-payments.mjs <sk_test_key> [customer_email]
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
    if (found.data.length > 0) {
      customerId = found.data[0].id
      console.log(`→ Customer ${EMAIL} = ${customerId}`)
    }
  }

  console.log('\n== Checkout Sessions (mode=payment) ==')
  let n = 0
  for await (const s of stripe.checkout.sessions.list({ limit: 100 })) {
    if (s.mode !== 'payment') continue
    if (customerId && s.customer !== customerId) continue
    n++
    const amount = s.amount_total != null ? `${s.amount_total / 100} ${(s.currency || '').toUpperCase()}` : '?'
    const created = new Date(s.created * 1000).toISOString().slice(0, 16).replace('T', ' ')
    console.log(`  [${s.payment_status}] ${s.id} | ${amount} | created ${created}`)
  }
  if (n === 0) console.log('  (nessuna sessione di pagamento una-tantum trovata)')

  console.log('\n== TUTTI i Checkout Sessions mode=payment (qualsiasi cliente) ==')
  let g = 0
  for await (const s of stripe.checkout.sessions.list({ limit: 100 })) {
    if (s.mode !== 'payment') continue
    g++
    const amount = s.amount_total != null ? `${s.amount_total / 100} ${(s.currency || '').toUpperCase()}` : '?'
    const created = new Date(s.created * 1000).toISOString().slice(0, 16).replace('T', ' ')
    console.log(`  [${s.payment_status}] ${s.id} | ${amount} | cust=${s.customer || '-'} | ${created}`)
  }
  if (g === 0) console.log('  (NESSUN checkout mode=payment in tutto laccount)')

  console.log('\n== PaymentIntents recenti ==')
  let m = 0
  const piParams = { limit: 20 }
  if (customerId) piParams.customer = customerId
  for await (const pi of stripe.paymentIntents.list(piParams)) {
    m++
    const amount = `${pi.amount / 100} ${pi.currency.toUpperCase()}`
    const created = new Date(pi.created * 1000).toISOString().slice(0, 16).replace('T', ' ')
    console.log(`  [${pi.status}] ${pi.id} | ${amount} | created ${created}`)
    if (m >= 20) break
  }
  if (m === 0) console.log('  (nessun PaymentIntent trovato)')
}

main().catch((err) => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
