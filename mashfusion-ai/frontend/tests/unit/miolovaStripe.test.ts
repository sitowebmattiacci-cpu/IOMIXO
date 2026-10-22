import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildPriceTable, buildMiolovePriceTable, checkoutPrice, albumActivationPrice, priceInfo } from '../../../../firebase/functions/src/billing/prices'
import { parseAlbumCheckoutInput, albumCurrencyFor } from '../../../../firebase/functions/src/billing/albumCheckout'
import { currencyForLocale } from '../../lib/pricing'
import { ALBUM_PRICING, albumPlanState } from '../../lib/miolove/plans'

const ENV = { STRIPE_PRICE_PRO_EUR: 'price_PROEUR000001', STRIPE_PRICE_EVENT_PASS_EUR: 'price_PASSEUR00001', STRIPE_PRICE_MIOLOVE_ALBUM_EUR: 'price_ALBEUR000001', STRIPE_PRICE_MIOLOVE_ALBUM_USD: 'price_ALBUSD000001' }

test('STRIPE-U1. server currency = the currency the page shows (English → USD, it / fr / es → EUR); both 19.99', () => {
  for (const l of ['it', 'en', 'fr', 'es'] as const) assert.equal(albumCurrencyFor(l), currencyForLocale(l), l)
  assert.equal(ALBUM_PRICING.current.eur, 19.99); assert.equal(ALBUM_PRICING.current.usd, 19.99); assert.equal(ALBUM_PRICING.list.eur, 39.99)
})
test('STRIPE-U2. portal scope: album prices are MIOLOVE one-time; every other price stays IOMIXO; the generic checkout never offers the album price', () => {
  const t = buildPriceTable(ENV), m = buildMiolovePriceTable(ENV)
  const eur = albumActivationPrice(m, 'eur')!, usd = albumActivationPrice(m, 'usd')!
  assert.deepEqual([eur.info.scope, eur.info.mode, eur.info.product, eur.info.tier, eur.info.currency], ['miolove', 'payment', 'album_activation', null, 'eur'])
  assert.deepEqual([usd.info.scope, usd.info.currency], ['miolove', 'usd'])
  assert.equal(priceInfo(t, ENV.STRIPE_PRICE_PRO_EUR).scope, 'iomixo'); assert.equal(priceInfo(t, ENV.STRIPE_PRICE_EVENT_PASS_EUR).scope, 'iomixo')
  assert.equal(t.has(ENV.STRIPE_PRICE_MIOLOVE_ALBUM_EUR), false, 'the IOMIXO table never holds an album price'); assert.equal(checkoutPrice(t, ENV.STRIPE_PRICE_MIOLOVE_ALBUM_EUR), null); assert.ok(checkoutPrice(t, ENV.STRIPE_PRICE_PRO_EUR))
  assert.equal(m.has(ENV.STRIPE_PRICE_PRO_EUR) || m.has(ENV.STRIPE_PRICE_EVENT_PASS_EUR), false, 'the MIOLOVE table never holds an IOMIXO price')
  assert.equal(albumActivationPrice(buildMiolovePriceTable({ STRIPE_PRICE_PRO_EUR: ENV.STRIPE_PRICE_PRO_EUR }), 'eur'), null, 'not configured → no checkout')
})
test('STRIPE-U3. client input: only eventId + a language enum are read; price / amount / currency / mode are not', () => {
  assert.deepEqual(parseAlbumCheckoutInput({ eventId: 'abc_1', locale: 'fr', priceId: 'price_x', amount: 1, currency: 'jpy', mode: 'subscription', successUrl: 'https://evil' }), { eventId: 'abc_1', locale: 'fr' })
  assert.equal(parseAlbumCheckoutInput({ eventId: 'abc_1', locale: 'xx' }).locale, 'it')
  for (const bad of [{}, { eventId: '' }, { eventId: 'a/b' }, { eventId: 7 }, null]) assert.throws(() => parseAlbumCheckoutInput(bad))
})
test('STRIPE-U4. an activated album shows no pay state', () => {
  const state = albumPlanState({ access_mode: 'activated' } as any); assert.equal(state.kind, 'active')
})

test('STRIPE-U5. wiring (functions/src/index.ts): IOMIXO callables / webhook keep the IOMIXO secrets; the album checkout and its webhook use ONLY the MIOLOVE ones', () => {
  const src = readFileSync(__dirname + '/../../../../firebase/functions/src/index.ts', 'utf8')
  const block = (name: string) => { const i = src.indexOf(`export const ${name}`); assert.ok(i > 0, name); const j = src.indexOf('\nexport const', i + 10); return src.slice(i, j < 0 ? undefined : j) }
  for (const n of ['createAlbumCheckoutSession', 'mioloveStripeWebhook']) {
    const b = block(n); assert.match(b, /STRIPE_MIOLOVE_SECRET_KEY/, n); assert.doesNotMatch(b.replace(/STRIPE_MIOLOVE_[A-Z_]+/g, ''), /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|buildPriceTable\(/, `${n} must not touch the IOMIXO Stripe`)
  }
  assert.match(block('mioloveStripeWebhook'), /STRIPE_MIOLOVE_WEBHOOK_SECRET/)
  for (const n of ['createCheckoutSession', 'createPortalSession', 'stripeWebhook']) assert.doesNotMatch(block(n), /MIOLOVE_(SECRET|WEBHOOK)|buildMiolovePriceTable|handleMioloveWebhook/, `${n} stays on the IOMIXO Stripe`)
  assert.match(block('stripeWebhook'), /STRIPE_WEBHOOK_SECRET\.value\(\)/)
})
