'use client'
import { motion } from 'framer-motion'
import useSWR from 'swr'
import { CheckCircle2, Zap, Crown, Heart, ExternalLink, Clock } from 'lucide-react'
import { auth, billing } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PLAN_METADATA, type Plan, type User } from '@/types'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { normalisePlan as normalisePlanShared } from '@/lib/plan'
import {
  currencyForLocale, formatPrice, planPriceId, eventPassPriceId,
  PLAN_PRICING, EVENT_PASS_PRICING, type PaidPlan,
} from '@/lib/pricing'

const PLAN_ICONS: Record<Plan, React.ReactNode> = {
  free: <Zap className="h-5 w-5" />,
  pro:  <Crown className="h-5 w-5" />,
  wedding: <Heart className="h-5 w-5" />,
}

const PLAN_COLORS: Record<Plan, string> = {
  free: 'text-white/50',
  pro:  'text-purple-400',
  wedding: 'text-pink-400',
}

function normalisePlan(p: string | undefined): Plan {
  // delega all'helper centralizzato: ogni alias Advance → 'wedding'.
  return normalisePlanShared(p) as Plan
}

export default function BillingPage() {
  const { t, locale } = useI18n()
  const currency = currencyForLocale(locale)
  const { data: me, isLoading: loadingMe } = useSWR<User>('me', () => auth.me())
  const { data: subscription } = useSWR('subscription', () => billing.getSubscription())
  const { data: payments }     = useSWR('payments', () => billing.getPaymentHistory(10))
  const { data: eventPasses, error: passesError } = useSWR('event-passes', () => billing.getEventPasses(), {
    onError: (err) => {
      console.warn('Event passes API non disponibile:', err)
    }
  })

  const [loading, setLoading] = useState<Plan | 'portal' | 'event-pass' | null>(null)

  const handleUpgrade = async (plan: Plan) => {
    const priceId = plan === 'free' ? '' : planPriceId(plan as PaidPlan, currency)
    if (!priceId) {
      toast.error(t('billing.errPriceMissing'))
      return
    }
    setLoading(plan)
    try {
      const { url } = await billing.createCheckoutSession(priceId)
      window.location.href = url
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('billing.errCheckout'))
      setLoading(null)
    }
  }

  const handlePortal = async () => {
    setLoading('portal')
    try {
      const { url } = await billing.createPortalSession()
      window.location.href = url
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('billing.errPortal'))
      setLoading(null)
    }
  }

  const handleEventPass = async () => {
    const priceId = eventPassPriceId(currency)
    if (!priceId) {
      toast.error(t('billing.errPassNotConfigured'))
      return
    }
    setLoading('event-pass')
    try {
      const { url } = await billing.createCheckoutSession(priceId, 'payment')
      window.location.href = url
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('billing.errCheckout'))
      setLoading(null)
    }
  }

  const currentPlan = normalisePlan(me?.plan)

  // Event Pass attivo
  const activePass = eventPasses?.find((p: any) =>
    p.status === 'active' && new Date(p.valid_until) > new Date()
  )
  const hasActivePass = !!activePass

  // Mostra Event Pass se: dati caricati E piano non è wedding/advance
  const showEventPass = !loadingMe && currentPlan !== 'wedding'

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-5xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white">{t('billing.title')}</h1>
        <p className="text-sm text-white/40 mt-1">{t('billing.subtitle')}</p>
      </div>

      {/* Current plan */}
      <div className="glass rounded-2xl p-6 mb-8 border border-purple-500/20">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 ${PLAN_COLORS[currentPlan]}`}>
              {PLAN_ICONS[currentPlan]}
            </div>
            <div>
              <p className="font-semibold text-white">{t('billing.planPrefix')} {PLAN_METADATA[currentPlan].name}</p>
              <p className="text-xs text-white/40">
                {subscription?.current_period_end ? (
                  <>{t('billing.renewing')}: {format(new Date(subscription.current_period_end), 'd MMM yyyy')}</>
                ) : currentPlan === 'free' ? (
                  t('billing.usingFree')
                ) : null}
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
              {t('billing.manageSubscription')}
            </Button>
          )}
        </div>

        {subscription?.cancel_at_period_end && (
          <div className="mt-4 flex items-center gap-2 text-sm text-amber-400">
            <Clock className="h-4 w-4" />
            {t('billing.cancelAtEnd')}
          </div>
        )}
      </div>

      {/* Event Pass 24H */}
      {showEventPass && (
        <div className="mb-10">
          <div className="mb-4">
            <h2 className="font-bold text-white">{t('billing.eventPassTitle')}</h2>
            <p className="text-sm text-white/40 mt-1">
              {t('billing.eventPassSubtitle')}
            </p>
          </div>

          <motion.div
            whileHover={{ y: -4 }}
            className="relative rounded-2xl p-6 bg-gradient-to-br from-pink-600/20 to-rose-600/10 border-2 border-pink-500/40"
          >
            {hasActivePass && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-3 py-1 text-[10px] font-semibold text-white flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {t('billing.active')}
                </span>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-500">
                    <Heart className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-pink-300">{t('billing.tempAccess')}</p>
                    <p className="font-bold text-white text-lg">{t('billing.eventPass')}</p>
                  </div>
                </div>

                <p className="text-4xl font-black text-white mb-1">{formatPrice(EVENT_PASS_PRICING[currency], currency)}</p>
                <p className="text-sm text-white/40 mb-6">{t('billing.validFor24h')}</p>

                <ul className="space-y-2 mb-6">
                  <li className="flex items-start gap-2 text-sm text-white/80">
                    <CheckCircle2 className="h-4 w-4 text-pink-400 flex-shrink-0 mt-0.5" />
                    <span>{t('billing.feat1')}</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-white/80">
                    <CheckCircle2 className="h-4 w-4 text-pink-400 flex-shrink-0 mt-0.5" />
                    <span>{t('billing.feat2')}</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-white/80">
                    <CheckCircle2 className="h-4 w-4 text-pink-400 flex-shrink-0 mt-0.5" />
                    <span>{t('billing.feat3')}</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-white/80">
                    <CheckCircle2 className="h-4 w-4 text-pink-400 flex-shrink-0 mt-0.5" />
                    <span>{t('billing.feat4')}</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-white/80">
                    <CheckCircle2 className="h-4 w-4 text-pink-400 flex-shrink-0 mt-0.5" />
                    <span>{t('billing.feat5')}</span>
                  </li>
                </ul>

                {!hasActivePass ? (
                  <Button
                    variant="primary"
                    className="w-full bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600"
                    loading={loading === 'event-pass'}
                    onClick={handleEventPass}
                  >
                    {t('billing.buyPass')}
                  </Button>
                ) : (
                  <div className="text-center py-2 text-sm text-pink-300 font-medium">
                    {t('billing.passActiveCheck')}
                  </div>
                )}
              </div>

              {hasActivePass && activePass && (
                <div className="bg-black/20 rounded-xl p-5 border border-pink-500/30">
                  <p className="text-xs uppercase tracking-wide text-pink-300 mb-3 font-semibold">
                    {t('billing.passActive')}
                  </p>

                  <div className="mb-4">
                    <p className="text-sm text-white/60 mb-1">{t('billing.expires')}</p>
                    <p className="text-lg font-semibold text-white">
                      {format(new Date(activePass.valid_until), 'd MMM yyyy, HH:mm')}
                    </p>
                  </div>

                  <div className="mb-4">
                    <p className="text-sm text-white/60 mb-1">{t('billing.timeLeft')}</p>
                    <p className="text-lg font-semibold text-pink-300">
                      {(() => {
                        const hoursLeft = Math.max(0, (new Date(activePass.valid_until).getTime() - Date.now()) / (1000 * 60 * 60))
                        return hoursLeft > 1
                          ? `${hoursLeft.toFixed(1)} ${t('billing.hours')}`
                          : `${Math.floor(hoursLeft * 60)} ${t('billing.minutes')}`
                      })()}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-pink-500/20">
                    <p className="text-xs text-white/40 italic">
                      {t('billing.allFeaturesAvailable')}
                    </p>
                  </div>
                </div>
              )}

              {!hasActivePass && (
                <div className="bg-black/20 rounded-xl p-5 border border-pink-500/30">
                  <p className="text-xs uppercase tracking-wide text-pink-300 mb-3 font-semibold">
                    {t('billing.idealFor')}
                  </p>
                  <ul className="space-y-3 text-sm text-white/70">
                    <li className="flex items-start gap-2">
                      <span className="text-pink-400">•</span>
                      <span>{t('billing.ideal1')}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-pink-400">•</span>
                      <span>{t('billing.ideal2')}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-pink-400">•</span>
                      <span>{t('billing.ideal3')}</span>
                    </li>
                  </ul>

                  <div className="mt-5 pt-4 border-t border-pink-500/20">
                    <p className="text-xs text-white/50">
                      💡 <span className="font-medium">{t('billing.tip')}:</span> {t('billing.tipMsg')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Plan cards */}
      <div className="grid md:grid-cols-3 gap-4 mb-10">
        {(Object.keys(PLAN_METADATA) as Plan[]).map((plan) => {
          const meta       = PLAN_METADATA[plan]
          const isCurrent  = plan === currentPlan
          const canUpgrade = !isCurrent && plan !== 'free'

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
                    {t('billing.mostChosen')}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className={PLAN_COLORS[plan]}>{PLAN_ICONS[plan]}</div>
                {isCurrent && <Badge variant="complete">{t('billing.active')}</Badge>}
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-white/40">{meta.tagline}</p>
                <p className="font-bold text-white mt-1">{meta.name}</p>
                <p className="text-3xl font-black text-white mt-2">
                  {plan === 'free' ? t('billing.free') : formatPrice(PLAN_PRICING[plan as PaidPlan][currency], currency)}
                  {plan !== 'free' && <span className="text-sm font-normal text-white/30">{t('billing.perMonth')}</span>}
                </p>
              </div>

              <ul className="space-y-2 flex-1">
                {meta.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-white/60">
                    <CheckCircle2 className="h-3.5 w-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
                    <span>{f}</span>
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
                  {t('billing.switchTo')} {meta.name}
                </Button>
              )}
              {isCurrent && (
                <div className="text-center text-xs text-white/25">{t('billing.currentPlan')}</div>
              )}
            </motion.div>
          )
        })}
      </div>

      {/* Payment history */}
      <div>
        <h2 className="font-bold text-white mb-4">{t('billing.history')}</h2>
        {!payments || payments.length === 0 ? (
          <div className="glass rounded-xl p-8 text-center">
            <p className="text-sm text-white/30">{t('billing.noPayments')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p.id} className="glass rounded-xl px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{p.description}</p>
                  <p className="text-xs text-white/30">{format(new Date(p.created_at), 'd MMM yyyy')}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-white">
                    {(p.amount_cents / 100).toFixed(2)} {p.currency.toUpperCase()}
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
