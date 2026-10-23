'use client'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Check, Minus } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { ALBUM_INCLUDED, TRIAL_EXCLUDED, TRIAL_INCLUDED, formatAlbumListPrice, formatAlbumPrice, visibleItems } from '@/lib/miolove/plans'

/** The two MIOLOVE offers, side by side: the free trial (one per account) and the full album (one payment PER album, 365 days). Used by the public home. */
export function PlanCards({ trialCta, albumCta, className }: {
  trialCta: ReactNode
  albumCta: ReactNode
  className?: string
}) {
  const { t, locale } = useI18n()
  const row = (key: string, ok: boolean) => (
    <li key={key} className={cn('flex items-start gap-3 text-[15px] leading-snug', ok ? 'text-wd-ink' : 'text-wd-muted')}>
      <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full', ok ? 'bg-wd-active text-wd-pink' : 'bg-wd-bg text-wd-muted')}>
        {ok ? <Check className="h-3 w-3" strokeWidth={3} /> : <Minus className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span>{t(`albumPlan.f.${key}`)}</span>
    </li>
  )
  return (
    <div className={cn('grid gap-5 md:grid-cols-2', className)} data-testid="plan-cards">
      {/* Free trial */}
      <article className="flex flex-col rounded-[28px] border border-wd-border bg-white p-6 sm:p-8" data-testid="plan-trial">
        <header>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xl font-bold text-wd-ink">{t('albumPlan.trialName')}</h3>
          </div>
          <p className="mt-4 text-4xl font-bold tracking-tight text-wd-ink">{t('albumPlan.trialPrice')}</p>
          <p className="mt-1 text-sm text-wd-muted">{t('albumPlan.trialSub')}</p>
        </header>
        <div className="mt-6 flex-1">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-wd-muted">{t('albumPlan.included')}</p>
          <ul className="space-y-3">{visibleItems(TRIAL_INCLUDED).map((i) => row(i.key, true))}</ul>
          <p className="mb-3 mt-6 text-xs font-semibold uppercase tracking-[0.14em] text-wd-muted">{t('albumPlan.notIncluded')}</p>
          <ul className="space-y-3">{visibleItems(TRIAL_EXCLUDED).map((i) => row(i.key, false))}</ul>
        </div>
        <div className="mt-8">{trialCta}</div>
      </article>

      {/* Full album */}
      <article className="relative flex flex-col rounded-[28px] border-2 border-wd-pink bg-white p-6 shadow-[0_18px_50px_rgba(240,106,155,0.14)] sm:p-8" data-testid="plan-album">
        <span className="absolute -top-3 left-6 rounded-full bg-wd-pink px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">{t('albumPlan.popular')}</span>
        <header>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xl font-bold text-wd-ink">{t('albumPlan.albumName')}</h3>
          </div>
          <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <s className="text-2xl font-semibold text-wd-muted/80 decoration-wd-pink/70 decoration-2" data-testid="album-list-price" aria-label={t('albumPlan.listPrice')}>{formatAlbumListPrice(locale)}</s>
            <span className="text-5xl font-bold tracking-tight text-wd-ink" data-testid="album-price">{formatAlbumPrice(locale)}</span>
          </p>
          <p className="mt-1.5 text-[15px] font-semibold text-wd-pink-hover" data-testid="album-price-line">{t('albumPlan.albumOnce')} · {t('albumPlan.noSubscription')}</p>
          {/* The five reassurances: they deny a subscription on purpose (tests ignore this block when they look for subscription wording). */}
          <ul className="mt-3 flex flex-wrap gap-2" data-reassure="true">
            {['oneTime', 'notMonthly', 'notPerGuest', 'noUpgrade'].map((k) => (
              <li key={k} className="rounded-full bg-wd-active px-3 py-1 text-xs font-semibold text-wd-pink-hover">{t(`albumPlan.${k}`)}</li>
            ))}
          </ul>
        </header>
        <div className="mt-6 flex-1">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-wd-muted">{t('albumPlan.included')}</p>
          <ul className="space-y-3">{visibleItems(ALBUM_INCLUDED).map((i) => row(i.key, true))}</ul>
        </div>
        <div className="mt-8">{albumCta}</div>
      </article>
    </div>
  )
}

export const planBtn = 'inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl px-5 text-[15px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/40'
export const planBtnPrimary = `${planBtn} bg-wd-pink text-white hover:bg-wd-pink-hover`
export const planBtnSecondary = `${planBtn} border border-wd-border bg-white text-wd-ink hover:bg-wd-active`

/** Public-home call to action: both offers start from the free trial. */
export function PublicPlanCards() {
  const { t } = useI18n()
  return (
    <PlanCards
      trialCta={<Link href="/register" className={planBtnSecondary} data-testid="plan-trial-cta">{t('albumPlan.tryFree')}</Link>}
      albumCta={<Link href="/register" className={planBtnPrimary} data-testid="plan-album-cta">{t('albumPlan.startFree')}</Link>}
    />
  )
}
