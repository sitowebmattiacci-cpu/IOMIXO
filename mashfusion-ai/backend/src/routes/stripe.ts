import { Router, Request, Response, NextFunction } from 'express'
import Stripe from 'stripe'
import { v4 as uuid } from 'uuid'
import { supabaseAdmin } from '../config/supabase'
import { requireAuth } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { logger } from '../config/logger'
import { queueMashupJob } from '../services/queue'

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
        if (session.metadata?.kind === 'upgrade_full') {
          await handleUpgradeFull(session)
        } else {
          await handleCheckoutComplete(session)
        }
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

// ── Upgrade-to-full handler (one-shot Stripe Checkout) ─────────
//
// Triggered by checkout.session.completed when metadata.kind === 'upgrade_full'.
// Creates a NEW render_jobs row with mode='full' and parent_job_id pointing at
// the preview job. The full-mode child reuses cached_analysis_json so the heavy
// upstream stages (stems / analysis / harmonic match) are skipped.
async function handleUpgradeFull(session: Stripe.Checkout.Session) {
  const userId        = session.metadata?.user_id
  const previewJobId  = session.metadata?.preview_job_id
  if (!userId || !previewJobId) {
    logger.warn('upgrade_full session missing metadata', { session_id: session.id })
    return
  }

  // Idempotency: if a child full-mode job for this preview already exists, no-op.
  const { data: existingChild } = await supabaseAdmin
    .from('render_jobs')
    .select('id')
    .eq('parent_job_id', previewJobId)
    .eq('mode', 'full')
    .maybeSingle()
  if (existingChild) {
    logger.info(`upgrade_full: child job already exists for preview ${previewJobId}`)
    return
  }

  const { data: previewJob } = await supabaseAdmin
    .from('render_jobs')
    .select('id, project_id, user_id, remix_style, output_quality, cached_analysis_json')
    .eq('id', previewJobId)
    .maybeSingle()
  if (!previewJob) {
    logger.warn(`upgrade_full: preview job ${previewJobId} not found`)
    return
  }

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('*, track_a:uploaded_tracks!track_a_id(s3_key), track_b:uploaded_tracks!track_b_id(s3_key)')
    .eq('id', previewJob.project_id).single()
  const taKey = (project?.track_a as any)?.s3_key
  const tbKey = (project?.track_b as any)?.s3_key
  if (!taKey || !tbKey) {
    logger.warn(`upgrade_full: tracks missing for project ${previewJob.project_id}`)
    return
  }

  const { data: userRow } = await supabaseAdmin
    .from('users').select('plan').eq('id', userId).single()

  const fullJobId = uuid()
  const initialStageProgress = {
    stem_separation:     { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
    music_analysis:      { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
    harmonic_matching:   { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
    mashup_composition:  { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
    sound_modernization: { status: previewJob.remix_style === 'none' ? 'skipped' : 'pending', progress: 0, started_at: null, completed_at: null, message: null },
    mastering:           { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
    rendering:           { status: 'pending', progress: 0, started_at: null, completed_at: null, message: null },
  }

  await supabaseAdmin.from('render_jobs').insert({
    id:                   fullJobId,
    project_id:           previewJob.project_id,
    user_id:              userId,
    status:               'queued',
    progress:             0,
    current_stage:        'Queued for full render',
    stage_progress:       initialStageProgress,
    remix_style:          previewJob.remix_style,
    output_quality:       previewJob.output_quality,
    mode:                 'full',
    parent_job_id:        previewJobId,
    cached_analysis_json: previewJob.cached_analysis_json,
    idempotency_key:      `full-upgrade:${session.id}`,
  })

  await supabaseAdmin.from('payments').upsert({
    user_id:                  userId,
    stripe_payment_intent_id: session.payment_intent as string,
    amount_cents:             session.amount_total ?? 0,
    currency:                 session.currency ?? 'usd',
    status:                   'succeeded',
    description:              `Full mashup upgrade (preview ${previewJobId.slice(0, 8)})`,
  }, { ignoreDuplicates: true, onConflict: 'stripe_payment_intent_id' })

  await queueMashupJob({
    job_id:               fullJobId,
    project_id:           previewJob.project_id,
    user_id:              userId,
    user_plan:            userRow?.plan ?? 'free',
    track_a_s3_key:       taKey,
    track_b_s3_key:       tbKey,
    remix_style:          previewJob.remix_style,
    output_quality:       previewJob.output_quality,
    mode:                 'full',
    cached_analysis:      previewJob.cached_analysis_json ?? null,
    parent_job_id:        previewJobId,
  })

  logger.info(`upgrade_full: queued full job ${fullJobId} for preview ${previewJobId}`)
}
