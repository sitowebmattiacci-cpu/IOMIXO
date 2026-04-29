'use client'
import { motion } from 'framer-motion'
import useSWR from 'swr'
import { CheckCircle2, Zap, Crown, Sparkles, ExternalLink, Clock } from 'lucide-react'
import { auth, billing } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PLAN_METADATA, type Plan, type User } from '@/types'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { useState } from 'react'

const PLAN_ICONS: Record<Plan, React.ReactNode> = {
  free:   <Zap    className="h-5 w-5" />,
  pro:    <Crown  className="h-5 w-5" />,
  studio: <Sparkles className="h-5 w-5" />,
}

const PLAN_COLORS: Record<Plan, string> = {
  free:   'text-white/50',
  pro:    'text-purple-400',
  studio: 'text-amber-400',
}

export default function BillingPage() {
  const { data: me }           = useSWR<User>('me', () => auth.me())
  const { data: subscription } = useSWR('subscription', () => billing.getSubscription())
  const { data: payments }     = useSWR('payments', () => billing.getPaymentHistory(10))

  const [loading, setLoading] = useState<Plan | 'portal' | null>(null)

  const handleUpgrade = async (plan: Plan) => {
    const meta = PLAN_METADATA[plan]
    if (!meta.stripePriceId) return
    setLoading(plan)
    try {
      const { url } = await billing.createCheckoutSession(meta.stripePriceId)
      window.location.href = url
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to open checkout')
      setLoading(null)
    }
  }

  const handlePortal = async () => {
    setLoading('portal')
    try {
      const { url } = await billing.createPortalSession()
      window.location.href = url
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to open portal')
      setLoading(null)
    }
  }

  const currentPlan = me?.plan ?? 'free'

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-4xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white">Billing & Plans</h1>
        <p className="text-sm text-white/40 mt-1">Manage your subscription and usage.</p>
      </div>

      {/* Current plan */}
      <div className="glass rounded-2xl p-6 mb-8 border border-purple-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 ${PLAN_COLORS[currentPlan]}`}>
              {PLAN_ICONS[currentPlan]}
            </div>
            <div>
              <p className="font-semibold text-white">{PLAN_METADATA[currentPlan].name} Plan</p>
              <p className="text-xs text-white/40">
                {me?.credits_remaining ?? 0} credits remaining
                {subscription?.current_period_end && (
                  <> · Renews {format(new Date(subscription.current_period_end), 'MMM d, yyyy')}</>
                )}
              </p>
            </div>
          </div>

          {subscription && (
            <Button
              variant="ghost"
              size="sm"
              loading={loading === 'portal'}
              onClick={handlePortal}
              icon={<ExternalLink className="h-3.5 w-3.5" />}
            >
              Manage subscription
            </Button>
          )}
        </div>

        {subscription?.cancel_at_period_end && (
          <div className="mt-4 flex items-center gap-2 text-sm text-amber-400">
            <Clock className="h-4 w-4" />
            Subscription will cancel at end of billing period
          </div>
        )}
      </div>

      {/* Plan cards */}
      <div className="grid md:grid-cols-3 gap-4 mb-10">
        {(Object.keys(PLAN_METADATA) as Plan[]).map((plan) => {
          const meta       = PLAN_METADATA[plan]
          const isCurrent  = plan === currentPlan
          const isHigher   = plan === 'pro' || plan === 'studio'
          const canUpgrade = !isCurrent && isHigher

          return (
            <motion.div
              key={plan}
              whileHover={canUpgrade ? { y: -4 } : {}}
              className={`relative rounded-2xl p-6 flex flex-col gap-4 ${
                plan === 'pro'
                  ? 'bg-gradient-to-b from-purple-600/20 to-pink-600/10 border border-purple-500/40'
                  : 'glass'
              }`}
            >
              {plan === 'pro' && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="rounded-full bg-gradient-brand px-3 py-1 text-[10px] font-semibold text-white">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className={PLAN_COLORS[plan]}>{PLAN_ICONS[plan]}</div>
                {isCurrent && <Badge variant="complete">Current</Badge>}
              </div>

              <div>
                <p className="font-bold text-white">{meta.name}</p>
                <p className="text-3xl font-black text-white mt-1">
                  {meta.priceMonthly === 0 ? 'Free' : `$${meta.priceMonthly}`}
                  {meta.priceMonthly > 0 && <span className="text-sm font-normal text-white/30">/mo</span>}
                </p>
              </div>

              <ul className="space-y-2 flex-1">
                <li className="flex items-center gap-2 text-sm text-white/60">
                  <CheckCircle2 className="h-3.5 w-3.5 text-purple-400 flex-shrink-0" />
                  {meta.monthlyCredits} AI transformation{meta.monthlyCredits !== 1 ? 's' : ''}/mo
                </li>
                {meta.quality.map((q) => (
                  <li key={q} className="flex items-center gap-2 text-sm text-white/60">
                    <CheckCircle2 className="h-3.5 w-3.5 text-purple-400 flex-shrink-0" />
                    {q}
                  </li>
                ))}
              </ul>

              {canUpgrade && (
                <Button
                  variant={plan === 'pro' ? 'primary' : 'secondary'}
                  className="w-full"
                  loading={loading === plan}
                  onClick={() => handleUpgrade(plan)}
                >
                  Upgrade to {meta.name}
                </Button>
              )}
              {isCurrent && (
                <div className="text-center text-xs text-white/25">Current plan</div>
              )}
            </motion.div>
          )
        })}
      </div>

      {/* Payment history */}
      <div>
        <h2 className="font-bold text-white mb-4">Payment History</h2>
        {!payments || payments.length === 0 ? (
          <div className="glass rounded-xl p-8 text-center">
            <p className="text-sm text-white/30">No payments yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p.id} className="glass rounded-xl px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{p.description}</p>
                  <p className="text-xs text-white/30">{format(new Date(p.created_at), 'MMM d, yyyy')}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-white">
                    ${(p.amount_cents / 100).toFixed(2)} {p.currency.toUpperCase()}
                  </p>
                  <Badge variant={p.status === 'succeeded' ? 'complete' : 'failed'}>
                    {p.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
