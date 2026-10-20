'use client'
import useSWR from 'swr'
import { format } from 'date-fns'
import { billing } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useAlbumPlan } from '@/lib/miolove/useAlbumPlan'
import { WdPage, WdCard } from '@/components/wedding/admin/WeddingAdminUI'
import { PlanCards, planBtnSecondary } from './PlanCards'

/**
 * MIOLOVE "Piano": where the album stands (free trial / full album) and the two offers. Nothing about subscriptions, Event Pass or IOMIXO plans.
 *
 * The "Attiva album" button is deliberately NOT wired: the one-time Stripe product for the full album does not exist yet (see MIOLOVE_GO_LIVE.md,
 * blocker B1). A button that opens nothing would be a fake, so until the checkout exists the card says so plainly.
 */
export function MioloveBilling() {
  const { t, locale } = useI18n()
  const { state, loading } = useAlbumPlan()
  const { data: payments } = useSWR(['payments', 'miolove'], () => billing.getPaymentHistory(10, 'miolove'), { onError: () => {} })

  const statusKey = { none: 'albumPlan.statusNone', trial: 'albumPlan.statusTrial', trialEnded: 'albumPlan.statusTrialEnded', active: 'albumPlan.statusActive' }[state.kind]
  const days = state.daysLeft
  const detail = state.kind === 'trial' && days !== null
    ? t(days === 1 ? 'albumPlan.trialLeftOne' : 'albumPlan.trialLeft').replace('{n}', String(days))
    : null
  const media = state.kind !== 'active' && state.used !== null && state.limit !== null
    ? t('albumPlan.mediaUsed').replace('{n}', String(Math.min(state.used, state.limit))).replace('{max}', String(state.limit))
    : null

  return (
    <div className="flex-1 overflow-y-auto" data-testid="miolove-billing" data-plan={state.kind}>
      <WdPage width="wide" title={t('albumPlan.title')} subtitle={t('albumPlan.subtitle')}>
        <WdCard>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-wd-muted">{t('albumPlan.yourPlan')}</p>
          <p className="mt-2 text-2xl font-bold text-wd-ink" data-testid="billing-status">{loading ? '…' : t(statusKey)}</p>
          {(detail || media) && <p className="mt-1 text-sm text-wd-muted">{[detail, media].filter(Boolean).join(' · ')}</p>}
        </WdCard>

        <PlanCards
          current={state.kind}
          trialCta={state.kind === 'none' || state.kind === 'trial' || state.kind === 'trialEnded'
            ? null
            : <a href="/sessions" className={planBtnSecondary}>{t('roles.myAlbums')}</a>}
          albumCta={state.kind === 'active' ? null : (
            <div>
              <button type="button" disabled data-testid="plan-activate" className="inline-flex min-h-[48px] w-full cursor-not-allowed items-center justify-center rounded-2xl bg-wd-pink px-5 text-[15px] font-semibold text-white opacity-50">
                {t('albumPlan.activate')}
              </button>
              <p className="mt-3 text-center text-[13px] text-wd-muted" data-testid="plan-activate-note">{t('albumPlan.activateSoon')}</p>
            </div>
          )}
        />

        {payments && payments.length > 0 && (
          <WdCard title={t('albumPlan.history')}>
            <ul className="divide-y divide-wd-border">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-wd-ink">{p.description}<span className="ml-2 text-wd-muted">{format(new Date(p.created_at), 'd MMM yyyy')}</span></span>
                  <span className="shrink-0 font-semibold tabular-nums text-wd-ink">{(p.amount_cents / 100).toFixed(2).replace('.', locale === 'en' ? '.' : ',')} {p.currency.toUpperCase()}</span>
                </li>
              ))}
            </ul>
          </WdCard>
        )}
      </WdPage>
    </div>
  )
}
