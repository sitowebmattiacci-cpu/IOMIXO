'use client'
import Link from 'next/link'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { WdCard } from './WeddingAdminUI'

/** MIOLOVE free-trial album: "18 / 50 foto" with a progress bar. Nothing for any other album (the limit lives on the server). */
export function TrialQuota({ session, className }: { session: any; className?: string }) {
  const { t } = useI18n()
  if (session?.access_mode !== 'trial' || typeof session.trial_photo_limit !== 'number') return null
  const max: number = session.trial_photo_limit, count: number = Math.min(session.trial_photo_count ?? 0, max)
  const full = count >= max
  return (
    <WdCard className={cn('!p-5 sm:!p-5', className)}>
      <div data-testid="trial-quota" data-full={full ? 'true' : 'false'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full bg-wd-active px-3 py-1 text-xs font-bold text-wd-pink">{t('wdAdmin.trial.badge')}</span>
          <span className="text-sm font-bold tabular-nums text-wd-ink" data-testid="trial-quota-count">{count} / {max} {t('wdAdmin.trial.unit')}</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-wd-active" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={count}>
          <div className="h-full rounded-full bg-wd-pink transition-all" style={{ width: `${Math.round((count / max) * 100)}%` }} />
        </div>
        {full ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-wd-ink">{t('wdAdmin.trial.limitTitle')}</p>
            <Link href="/billing" className="inline-flex items-center rounded-xl bg-wd-pink px-4 py-2 text-sm font-semibold text-white">{t('wdAdmin.trial.activate')}</Link>
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-wd-muted">{t('wdAdmin.trial.hint').replace('{max}', String(max))}</p>
        )}
      </div>
    </WdCard>
  )
}
