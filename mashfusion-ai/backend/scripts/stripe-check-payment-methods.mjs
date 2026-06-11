#!/usr/bin/env node
/**
 * IOMIXO — check which Stripe payment methods are active on the account (read-only).
 *
 * Verifies in particular whether PayPal is enabled, so we know if Checkout can
 * use payment_method_types: ['card', 'paypal']. Secrets are NEVER printed.
 *
 * Usage:
 *   node scripts/stripe-check-payment-methods.mjs <sk_live_key>
 *   STRIPE_SECRET_KEY=sk_... node scripts/stripe-check-payment-methods.mjs
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

  // Active payment method configurations (Dashboard → Settings → Payment methods)
  const configs = await stripe.paymentMethodConfigurations.list({ limit: 10 })

  if (configs.data.length === 0) {
    console.log('  (nessuna payment method configuration trovata)')
  }

  for (const cfg of configs.data) {
    console.log(`Configuration: ${cfg.name ?? cfg.id}${cfg.is_default ? ' (default)' : ''}`)
    const interesting = ['card', 'paypal', 'link', 'klarna', 'amazon_pay', 'mb_way', 'bancontact', 'eps', 'apple_pay', 'google_pay']
    for (const pm of interesting) {
      const entry = cfg[pm]
      if (entry && entry.display_preference) {
        const pref = entry.display_preference.value // 'on' | 'off'
        const flag = pref === 'on' ? '✅' : '  '
        console.log(`  ${flag} ${pm.padEnd(12)} → ${pref}`)
      }
    }
    console.log('')
  }

  const paypalOn = configs.data.some(
    (cfg) => cfg.paypal?.display_preference?.value === 'on',
  )
  console.log('────────────────────────────────────────')
  console.log(
    paypalOn
      ? '✅ PayPal è ATTIVO → Checkout può usare ["card","paypal"] per Event Pass.'
      : '⚠️  PayPal NON risulta attivo → rimuovere "paypal" e usare solo ["card"].',
  )
}

main().catch((err) => {
  console.error('❌ Errore:', err.message)
  process.exit(1)
})
