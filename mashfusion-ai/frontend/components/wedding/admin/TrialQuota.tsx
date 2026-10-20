'use client'
import Link from 'next/link'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { WdCard } from './WeddingAdminUI'

const DAY = 86_400_000

/** Whole days left until the end of the trial (display only: the server clock decides what is blocked). null = this trial has no end date (older album). */
export function trialDaysLeft(expiresAt: string | null | undefined, now = Date.now()): number | null {
  const end = expiresAt ? Date.parse(expiresAt) : NaN
  if (Number.isNaN(end)) return null
  return Math.max(0, Math.ceil((end - now) / DAY))
}

/**
 * MIOLOVE free-trial album: "18 / 50 foto", the days left and a progress bar. Once the 7 days are over (or the 50 are used) new uploads are closed
 * and the album offers "Attiva album"; nothing is deleted. Nothing is shown for any other album (the limits live on the server).
 */
export function TrialQuota({ session, className }: { session: any; className?: string }) {
  const { t } = useI18n()
  if (session?.access_mode !== 'trial' || typeof session.trial_photo_limit !== 'number') return null
  const max: number = session.trial_photo_limit, count: number = Math.min(session.trial_photo_count ?? 0, max)
  const days = trialDaysLeft(session.trial_expires_at)
  const expired = days === 0
  const full = count >= max
  const blocked = full || expired
  return (
    <WdCard className={cn('!p-5 sm:!p-5', className)}>
      <div data-testid="trial-quota" data-full={full ? 'true' : 'false'} data-expired={expired ? 'true' : 'false'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full bg-wd-active px-3 py-1 text-xs font-bold text-wd-pink">{t('wdAdmin.trial.badge')}</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-bold tabular-nums text-wd-ink">
            {days !== null && !expired && <span data-testid="trial-days">{t(days === 1 ? 'wdAdmin.trial.dayLeft' : 'wdAdmin.trial.daysLeft').replace('{n}', String(days))}</span>}
            <span data-testid="trial-quota-count">{count} / {max} {t('wdAdmin.trial.unit')}</span>
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-wd-active" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={count}>
          <div className="h-full rounded-full bg-wd-pink transition-all" style={{ width: `${Math.round((count / max) * 100)}%` }} />
        </div>
        {blocked ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-wd-ink">{expired ? t('wdAdmin.trial.expiredTitle') : t('wdAdmin.trial.limitTitle')}</p>
            <Link href="/billing" className="inline-flex items-center rounded-xl bg-wd-pink px-4 py-2 text-sm font-semibold text-white">{t('wdAdmin.trial.activate')}</Link>
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-wd-muted">{t('wdAdmin.trial.hint').replace('{max}', String(max))}</p>
        )}
        {expired && <p className="mt-2 text-[13px] text-wd-muted">{t('wdAdmin.trial.expiredHint')}</p>}
      </div>
    </WdCard>
  )
}
