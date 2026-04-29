import { Router, Request, Response, NextFunction } from 'express'
import Stripe from 'stripe'
import { supabaseAdmin } from '../config/supabase'
import { requireAuth } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { logger } from '../config/logger'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-04-10' })

export const stripeRouter = Router()

// ── POST /stripe/create-checkout ───────────────────────────────
stripeRouter.post('/create-checkout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.sub
    const { price_id, success_url, cancel_url } = req.body

    if (!price_id || !success_url || !cancel_url) throw new AppError('Missing required fields', 400)

    const { data: userRow, error: userErr } = await supabaseAdmin
      .from('users').select('email, stripe_customer_id').eq('id', userId).single()
    if (userErr || !userRow) throw new AppError('User not found', 404)

    let customerId: string = userRow.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({ email: userRow.email, metadata: { user_id: userId } })
      customerId = customer.id
      await supabaseAdmin.from('users').update({ stripe_customer_id: customerId }).eq('id', userId)
    }

    const session = await stripe.checkout.sessions.create({
      customer:    customerId,
      mode:        'subscription',
      line_items:  [{ price: price_id, quantity: 1 }],
      success_url: `${success_url}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url,
      metadata:    { user_id: userId },
      subscription_data: { metadata: { user_id: userId } },
    })

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
        await handleCheckoutComplete(session)
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await handleSubscriptionChange(sub)
        break
      }

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
const PLAN_PRICE_MAP: Record<string, string> = {
  [process.env.STRIPE_PRO_PRICE_ID!]:    'pro',
  [process.env.STRIPE_STUDIO_PRICE_ID!]: 'studio',
}

import { PLAN_CREDITS } from '../config/plans'

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.user_id
  if (!userId) return

  const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
  const priceId      = subscription.items.data[0]?.price.id
  const plan         = PLAN_PRICE_MAP[priceId] ?? 'pro'

  await supabaseAdmin.from('subscriptions').upsert({
    user_id:                userId,
    stripe_subscription_id: subscription.id,
    stripe_customer_id:     session.customer as string,
    plan,
    status:                 subscription.status,
    current_period_start:   new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end:     new Date(subscription.current_period_end * 1000).toISOString(),
  }, { onConflict: 'stripe_subscription_id' })

  await supabaseAdmin.from('users').update({
    plan,
    credits_remaining:  PLAN_CREDITS[plan],
    stripe_customer_id: session.customer as string,
    credits_reset_at:   new Date(subscription.current_period_end * 1000).toISOString(),
  }).eq('id', userId)
}

async function handleSubscriptionChange(sub: Stripe.Subscription) {
  const { data: subRow } = await supabaseAdmin
    .from('subscriptions').select('user_id').eq('stripe_subscription_id', sub.id).single()
  if (!subRow) return

  const userId  = subRow.user_id
  const priceId = sub.items.data[0]?.price.id
  const plan    = sub.status === 'active' ? (PLAN_PRICE_MAP[priceId] ?? 'pro') : 'free'

  await supabaseAdmin.from('subscriptions').update({
    status:               sub.status,
    plan,
    current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
    current_period_end:   new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
  }).eq('stripe_subscription_id', sub.id)

  await supabaseAdmin.from('users').update({
    plan,
    credits_remaining: PLAN_CREDITS[plan],
  }).eq('id', userId)
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
      await supabaseAdmin.from('users').update({
        credits_remaining: PLAN_CREDITS[subRow.plan],
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
