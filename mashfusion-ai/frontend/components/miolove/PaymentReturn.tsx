'use client'
import { useEffect, useRef, useState } from 'react'
import { mutate } from 'swr'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

const POLL_MS = 2500, GIVE_UP_MS = 90_000

/**
 * Back from Stripe Checkout (`?payment=success`): the redirect proves nothing, so this banner only WATCHES the album — it says "payment received" while
 * `access_mode` is still 'trial' and "album activated" once the verified webhook has written 'activated'. It never changes anything itself.
 */
export function PaymentReturn({ session }: { session: { id: string; access_mode?: string | null } }) {
  const { t } = useI18n()
  const [returned] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('payment') === 'success')
  const [gaveUp, setGaveUp] = useState(false)
  const activated = session.access_mode === 'activated'
  const start = useRef(Date.now())
  useEffect(() => {
    if (!returned || activated) return
    const timer = setInterval(() => { if (Date.now() - start.current > GIVE_UP_MS) { setGaveUp(true); clearInterval(timer) } else void mutate(['session', session.id]) }, POLL_MS)
    return () => clearInterval(timer)
  }, [returned, activated, session.id])
  if (!returned) return null
  if (activated) return (
    <p className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800" role="status" data-testid="payment-activated"><CheckCircle2 className="h-4 w-4 shrink-0" />{t('albumPlan.albumActivated')}</p>
  )
  return (
    <p className="flex items-center gap-2 rounded-2xl border border-wd-border bg-white px-4 py-3 text-sm font-medium text-wd-ink" role="status" data-testid="payment-pending">
      {!gaveUp && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-wd-pink" />}{t(gaveUp ? 'albumPlan.paymentSlow' : 'albumPlan.paymentReceived')}
    </p>
  )
}
