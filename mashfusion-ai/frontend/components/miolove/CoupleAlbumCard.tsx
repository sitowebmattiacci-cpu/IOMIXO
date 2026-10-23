'use client'
import Link from 'next/link'
import { useI18n } from '@/lib/i18n'
import { OCCASION_EMOJI } from '@/lib/coupleAlbum'
import { asOccasionType } from '@/lib/occasion'
import { albumStatus } from '@/lib/miolove/albumStatus'
import { ActivateAlbumButton, AlbumStatusPill, albumStatusLine, formatAlbumDate } from './AlbumStatus'

/** One album in "I miei album": name, occasion, event date, ITS OWN status and dates, and its own activation button when it can still be paid. */
export function CoupleAlbumCard({ album }: { album: any }) {
  const { t, locale } = useI18n()
  const status = albumStatus(album)
  const occasion = asOccasionType(album.occasion_type)
  const eventDate = album.wedding_date ? formatAlbumDate(`${album.wedding_date}T12:00:00Z`, locale) : ''
  const line = status ? albumStatusLine(status, t, locale) : null
  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-wd-border bg-white px-5 py-4 transition hover:border-wd-pink/50 sm:flex-row sm:items-center sm:justify-between" data-testid="album-card" data-album-id={album.id} data-status={status?.kind ?? 'none'}>
        <Link href={`/sessions/${album.id}`} className="min-w-0 sm:flex-1" data-testid="album-card-open">
          <p className="flex items-center gap-2 font-semibold text-wd-ink">
            <span aria-hidden>{OCCASION_EMOJI[occasion]}</span>
            <span className="truncate" data-testid="album-card-name">{album.event_name}</span>
          </p>
          <p className="mt-0.5 text-xs text-wd-muted" data-testid="album-card-meta">
            {t(`onboarding.occasion.${occasion}`)}{eventDate ? ` · ${eventDate}` : ''}
          </p>
          {line && <p className="mt-1 text-[13px] text-wd-muted" data-testid="album-card-line">{line}</p>}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3 sm:shrink-0 sm:justify-end">
          {status && <AlbumStatusPill kind={status.kind} />}
          {status?.canActivate && <ActivateAlbumButton albumId={album.id} compact />}
        </div>
    </div>
  )
}
