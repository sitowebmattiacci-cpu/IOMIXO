import { Router, Request, Response, NextFunction } from 'express'
import Stripe from 'stripe'
import { supabaseAdmin } from '../config/supabase'
import { requireAuth } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { logger } from '../config/logger'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-04-10' })

export const stripeRouter = Router()

// Remap legacy/inactive Stripe price IDs (whose products were archived) to the
// current active price IDs. Acts as a safety net so checkout keeps working even
// if a stale frontend build still sends an old price ID.
const STALE_PRICE_REMAP: Record<string, string> = {
  // legacy Pro    → active Pro (EUR)
  price_1TRfnnK5K6YO4jBDC2AUKQtT: 'price_1TghhxK5K6YO4jBDSLcSF6Az',
  // legacy Studio → active Advance/Wedding (EUR)
  price_1TRfpyK5K6YO4jBDFW333Skh: 'price_1TghhyK5K6YO4jBDJfrAoceZ',
}

// Returns a Stripe customer id that is guaranteed to exist in the CURRENT Stripe
// environment (test or live). If the user has no saved customer, or the saved
// one belongs to another environment (e.g. a test-mode customer after switching
// to live keys), a fresh customer is created and persisted to Supabase.
// This prevents the "No such customer ... a similar object exists in test mode"
// failure when migrating from test to live without dropping the checkout.
async function ensureCustomer(
  userId: string,
  email: string,
  savedCustomerId: string | null,
): Promise<string> {
  if (savedCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(savedCustomerId)
      if (!('deleted' in existing && existing.deleted)) {
        return savedCustomerId
      }
      logger.warn('Stripe customer was deleted; recreating', { userId })
    } catch (err) {
      // resource_missing → the saved id does not exist in this environment.
      if (err instanceof Stripe.errors.StripeError && err.code === 'resource_missing') {
        logger.warn('Saved Stripe customer not found in current environment; recreating', { userId })
      } else {
        throw err
      }
    }
  }

  const customer = await stripe.customers.create({ email, metadata: { user_id: userId } })
  await supabaseAdmin.from('users').update({ stripe_customer_id: customer.id }).eq('id', userId)
  logger.info('Created new Stripe customer', { userId })
  return customer.id
}


// ── POST /stripe/create-checkout ───────────────────────────────
stripeRouter.post('/create-checkout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { price_id: rawPriceId, success_url, cancel_url, mode = 'subscription', session_id } = req.body
    const price_id = STALE_PRICE_REMAP[rawPriceId] ?? rawPriceId

    if (!rawPriceId || !success_url || !cancel_url) throw new AppError('Missing required fields', 400)
    if (!['subscription', 'payment'].includes(mode)) throw new AppError('Invalid mode', 400)

    const { data: userRow, error: userErr } = await supabaseAdmin
      .from('users').select('email, stripe_customer_id').eq('id', userId).single()
    if (userErr || !userRow) throw new AppError('User not found', 404)

    const customerId = await ensureCustomer(userId, userRow.email, userRow.stripe_customer_id)

    const metadata: Record<string, string> = { user_id: userId }
    if (session_id) metadata.session_id = session_id

    // Restrict payment methods to card + PayPal for every checkout (one-time and
    // subscription). Apple Pay and Google Pay are offered automatically via 'card'
    // on compatible devices/browsers (they are NOT separate payment_method_types).
    // Setting this explicitly excludes Link, Klarna, Amazon Pay, MB WAY,
    // Bancontact, EPS, etc. — even though they are enabled at the account level.
    const paymentMethodTypes: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] = ['card', 'paypal']

    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      customer:    customerId,
      mode:        mode as 'subscription' | 'payment',
      payment_method_types: paymentMethodTypes,
      allow_promotion_codes: true,
      line_items:  [{ price: price_id, quantity: 1 }],
      success_url: `${success_url}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url,
      metadata,
    }

    if (mode === 'subscription') {
      sessionConfig.subscription_data = { metadata }
    }

    let session: Stripe.Checkout.Session
    try {
      session = await stripe.checkout.sessions.create(sessionConfig)
    } catch (stripeErr) {
      if (stripeErr instanceof Stripe.errors.StripeError) {
        logger.error('Stripe checkout creation failed', {
          type: stripeErr.type, code: stripeErr.code, param: stripeErr.param,
          message: stripeErr.message, price_id, mode,
        })
        throw new AppError(`Stripe: ${stripeErr.message}`, 400)
      }
      throw stripeErr
    }

    res.json({ url: session.url })
  } catch (err) { next(err) }
})

// ── POST /stripe/create-portal ─────────────────────────────────
stripeRouter.post('/create-portal', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { return_url } = req.body

    const { data: userRow } = await supabaseAdmin
      .from('users').select('stripe_customer_id').eq('id', userId).single()
    const customerId = userRow?.stripe_customer_id
    if (!customerId) throw new AppError('No billing account found', 404)

    const session = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: return_url ?? process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL,
    })
    res.json({ url: session.url })
  } catch (err) { next(err) }
})

// ── GET /stripe/subscription ───────────────────────────────────
stripeRouter.get('/subscription', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { data } = await supabaseAdmin
      .from('subscriptions').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    res.json({ data: data ?? null, error: null })
  } catch (err) { next(err) }
})

// ── GET /stripe/payments ───────────────────────────────────────
stripeRouter.get('/payments', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const limit  = Math.min(50, parseInt(req.query.limit as string) || 10)
    const { data } = await supabaseAdmin
      .from('payments').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(limit)
    res.json({ data: data ?? [], error: null })
  } catch (err) { next(err) }
})

// ── GET /stripe/event-passes (alias: /wedding-passes per back-compat) ──
async function listEventPassesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub
    const { data } = await supabaseAdmin
      .from('event_passes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10)
    res.json({ data: data ?? [], error: null })
  } catch (err) { next(err) }
}
stripeRouter.get('/event-passes',   requireAuth, listEventPassesHandler)
stripeRouter.get('/wedding-passes', requireAuth, listEventPassesHandler)

// ── POST /stripe/webhook ───────────────────────────────────────
stripeRouter.post('/webhook', async (req: Request, res: Response) => {
  const sig    = req.headers['stripe-signature'] as string
  const secret = process.env.STRIPE_WEBHOOK_SECRET!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret)
  } catch (err: unknown) {
    logger.warn('Stripe webhook signature verification failed', { err })
    return res.sendStatus(400)
  }

  logger.info(`Stripe event: ${event.type}`)

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode === 'subscription') {
          await handleCheckoutComplete(session)
        } else if (session.mode === 'payment') {
          // One-time Event Pass 24H. Activates when the checkout is complete and
          // payment_status is 'paid' OR 'no_payment_required' (100% coupon → 0€).
          await handleEventPassPayment(session)
        }
        break
      }

      // Delayed/async payment methods (e.g. bank debits) confirm later than the
      // initial redirect. Activate the Event Pass only once the bank confirms.
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode === 'payment') {
          await handleEventPassPayment(session)
        }
        break
      }

      // Async payment ultimately failed → never grant access.
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object as Stripe.Checkout.Session
        logger.warn('Checkout async payment failed; no access granted', {
          sessionId: session.id,
          userId: session.metadata?.user_id,
          paymentStatus: session.payment_status,
        })
        break
      }

      // Card/charge declined at the payment-intent level → no access.
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        logger.warn('Payment intent failed; no access granted', {
          paymentIntentId: pi.id,
          userId: pi.metadata?.user_id,
          lastError: pi.last_payment_error?.message,
        })
        break
      }

      // Refund (full or partial) on a one-time Event Pass charge → revoke access.
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        await handleChargeRefunded(charge)
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await handleSubscriptionChange(sub)
        break
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        await handlePaymentSucceeded(invoice)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        await handlePaymentFailed(invoice)
        break
      }
    }
  } catch (err) {
    logger.error('Error handling Stripe webhook', { event: event.type, err })
  }

  res.json({ received: true })
})

// ── Webhook handlers ───────────────────────────────────────────
// New env vars take priority; legacy STRIPE_PRO_PRICE_ID / STRIPE_STUDIO_PRICE_ID
// remain as fallback so existing deployments don't break.
import { PLAN_CREDITS, normalizePlan, type PlanTier } from '../config/plans'

function buildPlanPriceMap(): Record<string, PlanTier> {
  const map: Record<string, PlanTier> = {}
  const proIds = [
    process.env.STRIPE_PRICE_PRO_MONTHLY_EUR,
    process.env.STRIPE_PRICE_PRO_MONTHLY_USD,
    process.env.STRIPE_PRICE_PRO_MONTHLY,
    process.env.STRIPE_PRO_PRICE_ID,
  ].filter(Boolean) as string[]
  const weddingIds = [
    process.env.STRIPE_PRICE_WEDDING_MONTHLY_EUR,
    process.env.STRIPE_PRICE_WEDDING_MONTHLY_USD,
    process.env.STRIPE_PRICE_WEDDING_MONTHLY,
    process.env.STRIPE_PRICE_CLUB_MONTHLY,   // legacy alias → wedding
    process.env.STRIPE_STUDIO_PRICE_ID,      // legacy alias → wedding
  ].filter(Boolean) as string[]
  for (const id of proIds)     map[id] = 'pro'
  for (const id of weddingIds) map[id] = 'wedding'
  return map
}
const PLAN_PRICE_MAP = buildPlanPriceMap()

// Higher number = higher tier. Used to pick the best active plan a customer holds.
const PLAN_RANK: Record<PlanTier, number> = { free: 0, pro: 1, wedding: 2 }

// When a customer switches plan we keep only the newest subscription active and
// cancel every other still-active one, so they are never billed for two plans.
async function cancelOtherActiveSubscriptions(customerId: string, keepSubId: string) {
  if (!customerId) return
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
  for (const s of subs.data) {
    if (s.id === keepSubId) continue
    if (s.status !== 'active' && s.status !== 'trialing' && s.status !== 'past_due') continue
    try {
      await stripe.subscriptions.cancel(s.id)
      await supabaseAdmin.from('subscriptions')
        .update({ status: 'canceled', cancel_at_period_end: false })
        .eq('stripe_subscription_id', s.id)
    } catch (err) {
      logger.warn('Failed to cancel superseded subscription', { sub: s.id, err })
    }
  }
}

// Recompute the user's effective plan from the subscriptions still active in Stripe.
// This avoids a cancellation webhook wrongly downgrading a user who just switched plan.
async function recomputeUserPlan(userId: string, customerId: string) {
  let best: PlanTier = 'free'
  let bestPeriodEnd: number | null = null
  if (customerId) {
    try {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
      for (const s of subs.data) {
        if (s.status !== 'active' && s.status !== 'trialing') continue
        const tier = normalizePlan(PLAN_PRICE_MAP[s.items.data[0]?.price.id] ?? 'pro')
        if (PLAN_RANK[tier] >= PLAN_RANK[best]) {
          best = tier
          bestPeriodEnd = s.current_period_end
        }
      }
    } catch (err) {
      logger.warn('Failed to recompute user plan from Stripe', { userId, err })
    }
  }
  const update: Record<string, unknown> = { plan: best, credits_remaining: PLAN_CREDITS[best] }
  if (bestPeriodEnd) update.credits_reset_at = new Date(bestPeriodEnd * 1000).toISOString()
  await supabaseAdmin.from('users').update(update).eq('id', userId)
}

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.user_id
  if (!userId) return

  // Never grant the plan unless Stripe actually collected payment. For trials
  // the first invoice may legitimately require no payment.
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    logger.warn('Subscription checkout completed but payment not confirmed; skipping activation', {
      sessionId: session.id,
      userId,
      paymentStatus: session.payment_status,
    })
    return
  }

  const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
  const priceId      = subscription.items.data[0]?.price.id
  const plan         = normalizePlan(PLAN_PRICE_MAP[priceId] ?? 'pro')
  const customerId   = session.customer as string

  await supabaseAdmin.from('subscriptions').upsert({
    user_id:                userId,
    stripe_subscription_id: subscription.id,
    stripe_customer_id:     customerId,
    plan,
    status:                 subscription.status,
    current_period_start:   new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end:     new Date(subscription.current_period_end * 1000).toISOString(),
  }, { onConflict: 'stripe_subscription_id' })

  await supabaseAdmin.from('users').update({
    plan,
    credits_remaining:  PLAN_CREDITS[plan],
    stripe_customer_id: customerId,
    credits_reset_at:   new Date(subscription.current_period_end * 1000).toISOString(),
  }).eq('id', userId)

  // Plan switch → cancel any previous subscription so only the new one stays active.
  await cancelOtherActiveSubscriptions(customerId, subscription.id)
}

async function handleSubscriptionChange(sub: Stripe.Subscription) {
  const { data: subRow } = await supabaseAdmin
    .from('subscriptions').select('user_id').eq('stripe_subscription_id', sub.id).single()
  if (!subRow) return

  const userId  = subRow.user_id
  const priceId = sub.items.data[0]?.price.id
  const plan    = (sub.status === 'active' || sub.status === 'trialing')
    ? normalizePlan(PLAN_PRICE_MAP[priceId] ?? 'pro')
    : 'free'

  await supabaseAdmin.from('subscriptions').update({
    status:               sub.status,
    plan,
    current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
    current_period_end:   new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
  }).eq('stripe_subscription_id', sub.id)

  // Derive the user's plan from whatever is still active, not just this one
  // subscription — prevents a cancellation event from downgrading a user who
  // still holds another active plan.
  await recomputeUserPlan(userId, sub.customer as string)
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string
  const { data: userRow } = await supabaseAdmin
    .from('users').select('id').eq('stripe_customer_id', customerId).single()
  if (!userRow) return

  await supabaseAdmin.from('payments').upsert({
    user_id:                  userRow.id,
    stripe_payment_intent_id: invoice.payment_intent as string,
    amount_cents:             invoice.amount_paid,
    currency:                 invoice.currency,
    status:                   'succeeded',
    description:              `Subscription payment — ${invoice.period_start ? new Date(invoice.period_start * 1000).toDateString() : ''}`,
  }, { ignoreDuplicates: true, onConflict: 'stripe_payment_intent_id' })

  // Reset credits on renewal
  const subId = invoice.subscription as string
  if (subId) {
    const { data: subRow } = await supabaseAdmin
      .from('subscriptions').select('plan').eq('stripe_subscription_id', subId).single()
    if (subRow) {
      const plan = normalizePlan(subRow.plan)
      await supabaseAdmin.from('users').update({
        credits_remaining: PLAN_CREDITS[plan],
      }).eq('id', userRow.id)
    }
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string
  const { data: userRow } = await supabaseAdmin
    .from('users').select('id').eq('stripe_customer_id', customerId).single()
  if (!userRow) return
  logger.warn(`Payment failed for user ${userRow.id}`)
}

// ── Event Pass 24H handler (Party Mode + Wedding Edition) ─────
async function handleEventPassPayment(session: Stripe.Checkout.Session) {
  // TEMP debug log for 0€/coupon checkouts. Remove once verified in production.
  console.log('[stripe checkout completed]', {
    id: session.id,
    status: session.status,
    payment_status: session.payment_status,
    amount_total: session.amount_total,
    amount_discount: session.total_details?.amount_discount,
    metadata: session.metadata,
  })

  const userId = session.metadata?.user_id
  if (!userId) {
    logger.warn('Event Pass payment: missing user_id in metadata')
    return
  }

  // SECURITY: activate the pass only once Stripe confirms the checkout is complete
  // AND the payment is settled. A 100% coupon makes the total 0€ → Stripe reports
  // payment_status='no_payment_required' (and creates NO payment_intent); that is
  // a VALID completed purchase and must still grant the pass. Declined cards or
  // unpaid/async-pending checkouts are excluded so they never unlock access.
  const isCompleted = session.status === 'complete'
  const isValidCheckoutPayment =
    session.payment_status === 'paid' ||
    session.payment_status === 'no_payment_required'

  if (!isCompleted || !isValidCheckoutPayment) {
    logger.warn('Event Pass checkout not eligible for activation; skipping', {
      sessionId: session.id,
      userId,
      status: session.status,
      paymentStatus: session.payment_status,
    })
    return
  }

  // A 0€ (100% coupon) checkout has no payment_intent. Fall back to the checkout
  // session id as the dedup key: it keeps the UNIQUE constraint working (so webhook
  // retries don't create duplicate passes) and never collides with a real charge's
  // payment_intent, so the refund handler won't touch coupon-only passes.
  const paymentIntentId = (session.payment_intent as string | null) ?? session.id

  const sessionId = session.metadata?.session_id || null
  const amountTotal = session.amount_total ?? 0
  const currency = session.currency || 'eur'

  // Crea event pass valido 24h da adesso
  const validUntil = new Date()
  validUntil.setHours(validUntil.getHours() + 24)

  const { error: insertError } = await supabaseAdmin.from('event_passes').insert({
    user_id: userId,
    session_id: sessionId,
    stripe_payment_intent_id: paymentIntentId,
    amount_cents: amountTotal,
    currency,
    valid_until: validUntil.toISOString(),
    status: 'active',
  })

  if (insertError) {
    logger.error('Failed to create event pass', { userId, error: insertError })
    return
  }

  // Registra pagamento (amount 0 per coupon 100% è valido)
  await supabaseAdmin.from('payments').upsert({
    user_id: userId,
    stripe_payment_intent_id: paymentIntentId,
    amount_cents: amountTotal,
    currency,
    status: 'succeeded',
    description: `Event Pass 24H — valido fino al ${validUntil.toISOString()}`,
  }, { ignoreDuplicates: true, onConflict: 'stripe_payment_intent_id' })

  logger.info(`Event Pass created for user ${userId}, valid until ${validUntil.toISOString()}`, {
    paymentStatus: session.payment_status,
    amountTotal,
  })
}

// ── Refund handler ───────────────────────────────────────────
// When a one-time Event Pass charge is refunded (full or partial), revoke the
// related active pass so it no longer grants premium access. Also mark the
// payment row as refunded. Subscription invoice refunds are handled separately
// by the subscription lifecycle events and are ignored here.
async function handleChargeRefunded(charge: Stripe.Charge) {
  const paymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id
  if (!paymentIntentId) {
    logger.warn('charge.refunded without payment_intent; nothing to revoke')
    return
  }

  const { data: passes, error } = await supabaseAdmin
    .from('event_passes')
    .select('id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('status', 'active')

  if (error) {
    logger.error('charge.refunded: failed to query event_passes', { paymentIntentId, error })
    return
  }

  if (passes && passes.length > 0) {
    const { error: upErr } = await supabaseAdmin
      .from('event_passes')
      .update({ status: 'refunded' })
      .eq('stripe_payment_intent_id', paymentIntentId)
      .eq('status', 'active')
    if (upErr) logger.error('charge.refunded: failed to revoke event pass', { paymentIntentId, error: upErr })
    else logger.info(`charge.refunded: revoked ${passes.length} event pass(es)`, { paymentIntentId })
  }

  // Keep the payments ledger consistent (no-op if the row does not exist).
  await supabaseAdmin
    .from('payments')
    .update({ status: 'refunded' })
    .eq('stripe_payment_intent_id', paymentIntentId)
}

