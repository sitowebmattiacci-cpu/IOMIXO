#!/usr/bin/env node
/**
 * IOMIXO — Stripe setup script.
 *
 * Creates (idempotently) the products, multi-currency prices and the webhook
 * endpoint needed to run payments, then prints every env var to paste into
 * Render (backend) and Vercel (frontend).
 *
 * Pricing:
 *   Pro              €9,99  / $9.99   per month (subscription)
 *   Advance (Wedding)€19,99 / $19.99  per month (subscription)
 *   Event Pass 24H   €7,99  / $7.99   one-time  (payment)
 *
 * Currency routing in the app: EUR for it/fr/es locales, USD for en.
 *
 * Usage:
 *   node scripts/stripe-setup.mjs <sk_test_or_sk_live_key> [webhook_url]
 *   # or
 *   STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-setup.mjs
 *
 * The webhook URL defaults to the production backend:
 *   https://iomixo-backend.onrender.com/stripe/webhook
 */
import Stripe from 'stripe'

const KEY = process.argv[2] || process.env.STRIPE_SECRET_KEY
const WEBHOOK_URL =
  process.argv[3] ||
  process.env.STRIPE_WEBHOOK_URL ||
  'https://iomixo-backend.onrender.com/stripe/webhook'

if (!KEY || !/^sk_(test|live)_/.test(KEY)) {
  console.error('✖ Missing/invalid Stripe secret key.')
  console.error('  Usage: node scripts/stripe-setup.mjs <sk_test_...|sk_live_...> [webhook_url]')
  process.exit(1)
}

const MODE = KEY.startsWith('sk_live_') ? 'LIVE' : 'TEST'
const stripe = new Stripe(KEY, { apiVersion: '2024-04-10' })

// product key → { name, description }
const PRODUCTS = {
  pro:        { name: 'IOMIXO Pro',           description: 'Piano Pro — sessioni e richieste illimitate, social, statistiche.' },
  advance:    { name: 'IOMIXO Advance',       description: 'Piano Advance — Party Mode + Wedding Edition, giochi, screen mode, album.' },
  event_pass: { name: 'IOMIXO Event Pass 24H', description: 'Accesso premium completo per un singolo evento, valido 24 ore.' },
}

// lookup_key → { product, currency, unit_amount, recurring }
const PRICES = {
  pro_monthly_eur:    { product: 'pro',        currency: 'eur', unit_amount: 999,  recurring: true },
  pro_monthly_usd:    { product: 'pro',        currency: 'usd', unit_amount: 999,  recurring: true },
  advance_monthly_eur:{ product: 'advance',    currency: 'eur', unit_amount: 1999, recurring: true },
  advance_monthly_usd:{ product: 'advance',    currency: 'usd', unit_amount: 1999, recurring: true },
  event_pass_eur:     { product: 'event_pass', currency: 'eur', unit_amount: 799,  recurring: false },
  event_pass_usd:     { product: 'event_pass', currency: 'usd', unit_amount: 799,  recurring: false },
}

const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
]

async function findOrCreateProduct(key) {
  const meta = PRODUCTS[key]
  // Search by metadata tag for idempotency.
  const existing = await stripe.products.search({
    query: `metadata['iomixo_product']:'${key}' AND active:'true'`,
  })
  if (existing.data[0]) {
    console.log(`• product ${key.padEnd(11)} → reuse ${existing.data[0].id}`)
    return existing.data[0]
  }
  const product = await stripe.products.create({
    name: meta.name,
    description: meta.description,
    metadata: { iomixo_product: key },
  })
  console.log(`• product ${key.padEnd(11)} → created ${product.id}`)
  return product
}

async function findOrCreatePrice(lookupKey, productId) {
  const spec = PRICES[lookupKey]
  // lookup_key guarantees idempotency.
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  if (existing.data[0]) {
    console.log(`  price ${lookupKey.padEnd(20)} → reuse ${existing.data[0].id}`)
    return existing.data[0]
  }
  const price = await stripe.prices.create({
    product: productId,
    currency: spec.currency,
    unit_amount: spec.unit_amount,
    lookup_key: lookupKey,
    ...(spec.recurring ? { recurring: { interval: 'month' } } : {}),
    metadata: { iomixo_price: lookupKey },
  })
  console.log(`  price ${lookupKey.padEnd(20)} → created ${price.id}`)
  return price
}

async function findOrCreateWebhook(url) {
  const list = await stripe.webhookEndpoints.list({ limit: 100 })
  const existing = list.data.find((w) => w.url === url)
  if (existing) {
    console.log(`• webhook → reuse ${existing.id} (secret hidden; reuse the whsec_ you already saved)`)
    return { id: existing.id, secret: null }
  }
  const wh = await stripe.webhookEndpoints.create({
    url,
    enabled_events: WEBHOOK_EVENTS,
    description: 'IOMIXO backend webhook',
  })
  console.log(`• webhook → created ${wh.id}`)
  return { id: wh.id, secret: wh.secret }
}

async function main() {
  console.log(`\n=== IOMIXO Stripe setup (${MODE} mode) ===\n`)

  const products = {}
  for (const key of Object.keys(PRODUCTS)) {
    products[key] = await findOrCreateProduct(key)
  }

  const priceIds = {}
  for (const [lookupKey, spec] of Object.entries(PRICES)) {
    const price = await findOrCreatePrice(lookupKey, products[spec.product].id)
    priceIds[lookupKey] = price.id
  }

  const webhook = await findOrCreateWebhook(WEBHOOK_URL)

  const whLine = webhook.secret
    ? `STRIPE_WEBHOOK_SECRET=${webhook.secret}`
    : `STRIPE_WEBHOOK_SECRET=<reuse the whsec_ saved when this endpoint was first created>`

  console.log(`\n\n──────────────────────────────────────────────────────────`)
  console.log(` BACKEND env vars (Render · ${MODE})`)
  console.log(`──────────────────────────────────────────────────────────`)
  console.log(`STRIPE_SECRET_KEY=${KEY}`)
  console.log(whLine)
  console.log(`STRIPE_PRICE_PRO_MONTHLY_EUR=${priceIds.pro_monthly_eur}`)
  console.log(`STRIPE_PRICE_PRO_MONTHLY_USD=${priceIds.pro_monthly_usd}`)
  console.log(`STRIPE_PRICE_WEDDING_MONTHLY_EUR=${priceIds.advance_monthly_eur}`)
  console.log(`STRIPE_PRICE_WEDDING_MONTHLY_USD=${priceIds.advance_monthly_usd}`)
  console.log(`STRIPE_PRICE_EVENT_PASS_EUR=${priceIds.event_pass_eur}`)
  console.log(`STRIPE_PRICE_EVENT_PASS_USD=${priceIds.event_pass_usd}`)

  console.log(`\n──────────────────────────────────────────────────────────`)
  console.log(` FRONTEND env vars (Vercel · ${MODE})`)
  console.log(`──────────────────────────────────────────────────────────`)
  console.log(`NEXT_PUBLIC_STRIPE_PRO_PRICE_ID_EUR=${priceIds.pro_monthly_eur}`)
  console.log(`NEXT_PUBLIC_STRIPE_PRO_PRICE_ID_USD=${priceIds.pro_monthly_usd}`)
  console.log(`NEXT_PUBLIC_STRIPE_WEDDING_PRICE_ID_EUR=${priceIds.advance_monthly_eur}`)
  console.log(`NEXT_PUBLIC_STRIPE_WEDDING_PRICE_ID_USD=${priceIds.advance_monthly_usd}`)
  console.log(`NEXT_PUBLIC_STRIPE_PRICE_EVENT_PASS_EUR=${priceIds.event_pass_eur}`)
  console.log(`NEXT_PUBLIC_STRIPE_PRICE_EVENT_PASS_USD=${priceIds.event_pass_usd}`)
  console.log(`\n✓ Done. Paste these into the respective dashboards and redeploy.\n`)
}

main().catch((err) => {
  console.error('\n✖ Stripe setup failed:', err.message)
  process.exit(1)
})
