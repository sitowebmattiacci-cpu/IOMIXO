'use client'
import { useI18n } from '@/lib/i18n'
import { albumStatus } from '@/lib/miolove/albumStatus'
import { ActivateAlbumButton, AlbumStatusPill, albumStatusLine } from './AlbumStatus'

/**
 * Top of ONE album's dashboard: where THIS album stands (pending / trial paused / active with its own end date / expired) and, if it can still be paid, its own
 * "Attiva album — €19,99" button. A running trial shows nothing here (its quota card already says it); there is no account-level state anywhere.
 */
export function AlbumLifecycleBanner({ session }: { session: any }) {
  const { t, locale } = useI18n()
  const status = albumStatus(session)
  if (!status || status.kind === 'trial') return null
  const line = albumStatusLine(status, t, locale)
  if (status.kind === 'active') {
    return (
      <div className="mb-5 mt-4 rounded-[16px] border border-emerald-200 bg-emerald-50 px-4 py-2 text-[13px] font-medium text-emerald-800" data-testid="album-lifecycle" data-status={status.kind}>
        {line && <p data-testid="album-lifecycle-line">{line}</p>}
      </div>
    )
  }
  return (
    <div className="mb-5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-wd-border bg-white px-5 py-3" data-testid="album-lifecycle" data-status={status.kind}>
      <div className="min-w-0">
        <div className="flex items-center gap-2"><AlbumStatusPill kind={status.kind} /></div>
        {line && <p className="mt-2 text-[14px] text-wd-ink" data-testid="album-lifecycle-line">{line}</p>}
      </div>
      {status.canActivate && <div className="shrink-0"><ActivateAlbumButton albumId={session.id} /></div>}
    </div>
  )
}
