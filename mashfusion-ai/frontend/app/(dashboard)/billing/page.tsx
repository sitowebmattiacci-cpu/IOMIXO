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
  if (p === 'pro') return 'pro'
  if (p === 'wedding' || p === 'club' || p === 'studio') return 'wedding'
  return 'free'
}

export default function BillingPage() {
  const { data: me, isLoading: loadingMe } = useSWR<User>('me', () => auth.me())
  const { data: subscription } = useSWR('subscription', () => billing.getSubscription())
  const { data: payments }     = useSWR('payments', () => billing.getPaymentHistory(10))
  const { data: weddingPasses, error: passesError } = useSWR('wedding-passes', () => billing.getWeddingPasses(), {
    onError: (err) => {
      console.warn('Wedding passes API non disponibile:', err)
    }
  })

  const [loading, setLoading] = useState<Plan | 'portal' | 'wedding-pass' | null>(null)

  const handleUpgrade = async (plan: Plan) => {
    const meta = PLAN_METADATA[plan]
    if (!meta.stripePriceId) {
      toast.error('Price ID Stripe non configurato per questo piano.')
      return
    }
    setLoading(plan)
    try {
      const { url } = await billing.createCheckoutSession(meta.stripePriceId)
      window.location.href = url
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Impossibile aprire il checkout')
      setLoading(null)
    }
  }

  const handlePortal = async () => {
    setLoading('portal')
    try {
      const { url } = await billing.createPortalSession()
      window.location.href = url
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Impossibile aprire il portale')
      setLoading(null)
    }
  }

  const handleWeddingPass = async () => {
    const priceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_WEDDING_PASS
    if (!priceId) {
      toast.error('Wedding Pass non configurato. Contatta il supporto.')
      return
    }
    setLoading('wedding-pass')
    try {
      const { url } = await billing.createCheckoutSession(priceId, 'payment')
      window.location.href = url
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Impossibile aprire il checkout')
      setLoading(null)
    }
  }

  const currentPlan = normalisePlan(me?.plan)

  // Wedding Pass attivo
  const activePass = weddingPasses?.find((p: any) =>
    p.status === 'active' && new Date(p.valid_until) > new Date()
  )
  const hasActivePass = !!activePass

  // Mostra Wedding Pass se: dati caricati E piano non è wedding
  const showWeddingPass = !loadingMe && currentPlan !== 'wedding'

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-5xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white">Abbonamento</h1>
        <p className="text-sm text-white/40 mt-1">Gestisci il tuo piano IOMIXO Live Hub.</p>
      </div>

      {/* Current plan */}
      <div className="glass rounded-2xl p-6 mb-8 border border-purple-500/20">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 ${PLAN_COLORS[currentPlan]}`}>
              {PLAN_ICONS[currentPlan]}
            </div>
            <div>
              <p className="font-semibold text-white">Piano {PLAN_METADATA[currentPlan].name}</p>
              <p className="text-xs text-white/40">
                {subscription?.current_period_end ? (
                  <>Rinnovo: {format(new Date(subscription.current_period_end), 'd MMM yyyy')}</>
                ) : currentPlan === 'free' ? (
                  'Stai usando il piano gratuito'
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
              Gestisci abbonamento
            </Button>
          )}
        </div>

        {subscription?.cancel_at_period_end && (
          <div className="mt-4 flex items-center gap-2 text-sm text-amber-400">
            <Clock className="h-4 w-4" />
            L&apos;abbonamento si annullerà a fine periodo
          </div>
        )}
      </div>

      {/* Wedding Pass 24H */}
      {showWeddingPass && (
        <div className="mb-10">
          <div className="mb-4">
            <h2 className="font-bold text-white">Wedding Pass 24H</h2>
            <p className="text-sm text-white/40 mt-1">
              Prova tutte le funzioni Wedding Edition per 24 ore
            </p>
          </div>

          <motion.div
            whileHover={{ y: -4 }}
            className="relative rounded-2xl p-6 bg-gradient-to-br from-pink-600/20 to-rose-600/10 border-2 border-pink-500/40"
          >
            {hasActivePass && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-3 py-1 text-[10px] font-semibold text-white flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Attivo
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
                    <p className="text-xs uppercase tracking-wide text-pink-300">Accesso temporaneo</p>
                    <p className="font-bold text-white text-lg">Wedding Pass</p>
                  </div>
                </div>

                <p className="text-4xl font-black text-white mb-1">€7,99</p>
                <p className="text-sm text-white/40 mb-6">Valido 24 ore dal pagamento</p>

                <ul className="space-y-2 mb-6">
                  <li className="flex items-start gap-2 text-sm text-white/80">
                    <CheckCircle2 className="h-4 w-4 text-pink-400 flex-shrink-0 mt-0.5" />
                    <span>Dediche romantiche live</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-white/80">
                    <CheckCircle2 className="h-4 w-4 text-pink-400 flex-shrink-0 mt-0.5" />
                    <span>Roulette penitenze</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-white/80">
                    <CheckCircle2 className="h-4 w-4 text-pink-400 flex-shrink-0 mt-0.5" />
                    <span>Gioco della scarpa</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-white/80">
                    <CheckCircle2 className="h-4 w-4 text-pink-400 flex-shrink-0 mt-0.5" />
                    <span>Album foto ospiti</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-white/80">
                    <CheckCircle2 className="h-4 w-4 text-pink-400 flex-shrink-0 mt-0.5" />
                    <span>Screen mode per videoproiettore</span>
                  </li>
                </ul>

                {!hasActivePass ? (
                  <Button
                    variant="primary"
                    className="w-full bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600"
                    loading={loading === 'wedding-pass'}
                    onClick={handleWeddingPass}
                  >
                    Acquista Wedding Pass 24H
                  </Button>
                ) : (
                  <div className="text-center py-2 text-sm text-pink-300 font-medium">
                    ✓ Wedding Pass attivo
                  </div>
                )}
              </div>

              {hasActivePass && activePass && (
                <div className="bg-black/20 rounded-xl p-5 border border-pink-500/30">
                  <p className="text-xs uppercase tracking-wide text-pink-300 mb-3 font-semibold">
                    Pass attivo
                  </p>

                  <div className="mb-4">
                    <p className="text-sm text-white/60 mb-1">Scadenza</p>
                    <p className="text-lg font-semibold text-white">
                      {format(new Date(activePass.valid_until), 'd MMM yyyy, HH:mm')}
                    </p>
                  </div>

                  <div className="mb-4">
                    <p className="text-sm text-white/60 mb-1">Tempo rimanente</p>
                    <p className="text-lg font-semibold text-pink-300">
                      {(() => {
                        const hoursLeft = Math.max(0, (new Date(activePass.valid_until).getTime() - Date.now()) / (1000 * 60 * 60))
                        return hoursLeft > 1
                          ? `${hoursLeft.toFixed(1)} ore`
                          : `${Math.floor(hoursLeft * 60)} minuti`
                      })()}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-pink-500/20">
                    <p className="text-xs text-white/40 italic">
                      Tutte le funzioni Wedding Edition sono disponibili fino alla scadenza
                    </p>
                  </div>
                </div>
              )}

              {!hasActivePass && (
                <div className="bg-black/20 rounded-xl p-5 border border-pink-500/30">
                  <p className="text-xs uppercase tracking-wide text-pink-300 mb-3 font-semibold">
                    Ideale per
                  </p>
                  <ul className="space-y-3 text-sm text-white/70">
                    <li className="flex items-start gap-2">
                      <span className="text-pink-400">•</span>
                      <span>Provare le funzioni Wedding prima di abbonarti</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-pink-400">•</span>
                      <span>Evento singolo (matrimonio, anniversario)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-pink-400">•</span>
                      <span>Accesso temporaneo senza abbonamento</span>
                    </li>
                  </ul>

                  <div className="mt-5 pt-4 border-t border-pink-500/20">
                    <p className="text-xs text-white/50">
                      💡 <span className="font-medium">Suggerimento:</span> Se organizzi matrimoni regolarmente,
                      il piano Wedding Edition mensile è più conveniente
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
                    Più scelto
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className={PLAN_COLORS[plan]}>{PLAN_ICONS[plan]}</div>
                {isCurrent && <Badge variant="complete">Attivo</Badge>}
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-white/40">{meta.tagline}</p>
                <p className="font-bold text-white mt-1">{meta.name}</p>
                <p className="text-3xl font-black text-white mt-2">
                  {meta.priceMonthly === 0 ? 'Gratis' : `€${meta.priceMonthly.toFixed(2)}`}
                  {meta.priceMonthly > 0 && <span className="text-sm font-normal text-white/30">/mese</span>}
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
                  Passa a {meta.name}
                </Button>
              )}
              {isCurrent && (
                <div className="text-center text-xs text-white/25">Piano attivo</div>
              )}
            </motion.div>
          )
        })}
      </div>

      {/* Payment history */}
      <div>
        <h2 className="font-bold text-white mb-4">Cronologia pagamenti</h2>
        {!payments || payments.length === 0 ? (
          <div className="glass rounded-xl p-8 text-center">
            <p className="text-sm text-white/30">Nessun pagamento ancora.</p>
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
