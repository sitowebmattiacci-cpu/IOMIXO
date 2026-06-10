#!/usr/bin/env node
/**
 * IOMIXO — inspect the Stripe Billing Customer Portal configuration (read-only).
 *
 * Confirms how cancellations behave (at period end vs immediately) and which
 * features are enabled. Secrets are NEVER printed.
 *
 * Usage:
 *   node scripts/stripe-portal-config.mjs <sk_live_key>
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

  const configs = await stripe.billingPortal.configurations.list({ limit: 10 })
  if (configs.data.length === 0) {
    console.log('  (nessuna configurazione Customer Portal trovata → Stripe usa i default)')
    return
  }

  for (const c of configs.data) {
    const f = c.features || {}
    const cancel = f.subscription_cancel || {}
    console.log(`CONFIG ${c.id}${c.is_default ? '  [DEFAULT]' : ''}  active=${c.active}`)
    console.log(`  subscription_cancel.enabled : ${cancel.enabled}`)
    console.log(`  cancellation mode           : ${cancel.mode || '-'}`)   // 'at_period_end' | 'immediately'
    console.log(`  proration on cancel         : ${cancel.proration_behavior || '-'}`)
    console.log(`  subscription_update.enabled : ${f.subscription_update?.enabled}`)
    if (f.subscription_update?.enabled) {
      console.log(`    update proration          : ${f.subscription_update.proration_behavior || '-'}`)
      console.log(`    allowed updates           : ${(f.subscription_update.default_allowed_updates || []).join(', ') || '-'}`)
    }
    console.log(`  payment_method_update       : ${f.payment_method_update?.enabled}`)
    console.log(`  invoice_history             : ${f.invoice_history?.enabled}`)
    console.log('')
  }
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err.message)
  process.exit(1)
})
