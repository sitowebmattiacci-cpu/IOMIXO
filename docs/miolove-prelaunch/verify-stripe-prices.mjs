// READ-ONLY check of the two LIVE Stripe prices of MIOLOVE ALBUM. Not run by the build, not part of the app: a human runs it once, on their own machine.
//   STRIPE_RESTRICTED_KEY=rk_live_… PRICE_EUR=price_… PRICE_USD=price_… node verify-stripe-prices.mjs
// What it does: two HTTPS GET requests (GET /v1/prices/{id}?expand[]=product). It never writes, never creates a session, never charges anything.
// What it never does: print the key (not even a prefix), echo a Stripe error body, or accept anything but GET. Use a RESTRICTED key with ONLY "Prices: Read" and
// "Products: Read", and delete it in the dashboard afterwards. The price ids are public identifiers (firebase/functions/.env.iomixo-494817, STRIPE_PRICE_MIOLOVE_ALBUM_*).
// STRIPE_API_BASE exists only for the offline self-test and is honoured only for 127.0.0.1.
const KEY = process.env.STRIPE_RESTRICTED_KEY || '', IDS = { eur: process.env.PRICE_EUR || '', usd: process.env.PRICE_USD || '' }
const base = /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.STRIPE_API_BASE || '') ? process.env.STRIPE_API_BASE : 'https://api.stripe.com'
const EXPECT = { unit_amount: 1999 }   // 19.99 in the smallest unit of both currencies (cents)
if (!/^(rk|sk)_(live|test)_[A-Za-z0-9]+$/.test(KEY)) { console.error('STRIPE_RESTRICTED_KEY missing or malformed (value not shown).'); process.exit(2) }
for (const [c, id] of Object.entries(IDS)) if (!/^price_[A-Za-z0-9]{8,120}$/.test(id)) { console.error(`PRICE_${c.toUpperCase()} missing or malformed.`); process.exit(2) }

async function getPrice(id) {
  const res = await fetch(`${base}/v1/prices/${id}?expand[]=product`, { method: 'GET', headers: { authorization: `Bearer ${KEY}` } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${id.slice(0, 12)}… (body not shown)`)
  return res.json()
}
const checks = (cur, p) => {
  const prod = p.product && typeof p.product === 'object' ? p.product : null
  return [
    ['live mode', p.livemode === true],
    ['active price', p.active === true],
    ['one-time (not recurring)', p.type === 'one_time' && !p.recurring],
    [`currency = ${cur}`, p.currency === cur],
    [`amount = ${EXPECT.unit_amount} (smallest unit)`, p.unit_amount === EXPECT.unit_amount],
    ['flat price, not tiered', p.billing_scheme === 'per_unit' && !p.tiers_mode],
    ['product present and active', !!prod && prod.active === true],
  ]
}
let fail = false
const seen = new Set()
for (const cur of ['eur', 'usd']) {
  let p
  try { p = await getPrice(IDS[cur]) } catch (e) { console.log(`\n${cur.toUpperCase()}: ERROR ${e.message}`); fail = true; continue }
  const prod = typeof p.product === 'object' ? p.product : {}
  console.log(`\n${cur.toUpperCase()}  ${IDS[cur].slice(0, 12)}…  product: "${prod.name ?? '?'}" (${String(prod.id ?? '?').slice(0, 10)}…)  tax_behavior: ${p.tax_behavior ?? 'unspecified'}  nickname: ${p.nickname ?? '-'}`)
  for (const [label, ok] of checks(cur, p)) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fail = true }
  if (prod.id) seen.add(prod.id)
}
console.log(`\nSame product for both prices: ${seen.size === 1 ? 'yes' : 'NO (or unreadable)'}  — a human must confirm the product name above is the MIOLOVE "Album completo".`)
console.log(`tax_behavior is informational: whether 19.99 includes VAT is a fiscal decision (see legal-checklist-final.md).`)
console.log(fail || seen.size !== 1 ? '\nRESULT: NOT CONFIRMED' : '\nRESULT: CONFIRMED (amount, currency, one-time, active, live, same product)')
process.exit(fail || seen.size !== 1 ? 1 : 0)
