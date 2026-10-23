'use client'
import useSWR from 'swr'
import { format } from 'date-fns'
import Link from 'next/link'
import { useState } from 'react'
import { billing } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useOwnedAlbums } from '@/lib/miolove/useAlbumPlan'
import { formatAlbumPrice } from '@/lib/miolove/plans'
import { WdPage, WdCard } from '@/components/wedding/admin/WeddingAdminUI'
import { ActivateAlbumButton, AlbumStatusPill, albumStatusLine } from './AlbumStatus'

/**
 * MIOLOVE "Pagamenti": there is NO account plan. Every album is bought on its own (€19.99 / $19.99, one payment, 365 days from ITS activation), so this page lists the albums
 * with their own status and the activation button of each one, then the payments made. "Attiva album" opens the one-time Stripe Checkout of THAT album; it never activates anything itself.
 */
export function MioloveBilling() {
  const { t, locale } = useI18n()
  const { albums, loading } = useOwnedAlbums()
  const [cancelled] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('payment') === 'cancelled')
  const { data: payments } = useSWR(['payments', 'miolove'], () => billing.getPaymentHistory(10, 'miolove'), { onError: () => {} })
  const toPay = albums.filter((a) => a.status?.canActivate).length

  return (
    <div className="flex-1 overflow-y-auto" data-testid="miolove-billing" data-albums={albums.length} data-to-activate={toPay}>
      <WdPage width="wide" title={t('albumPlan.title')} subtitle={t('albumPlan.subtitle').replace('{price}', formatAlbumPrice(locale))}>
        {cancelled && (
          <p className="rounded-2xl border border-wd-border bg-white px-4 py-3 text-sm font-medium text-wd-ink" role="status" data-testid="payment-cancelled">{t('albumPlan.paymentCancelled')}</p>
        )}

        <WdCard title={t('albumPlan.yourAlbums')}>
          {loading ? <p className="text-sm text-wd-muted">…</p> : albums.length === 0 ? (
            <p className="text-sm text-wd-muted" data-testid="billing-no-albums">{t('albumPlan.statusNone')}</p>
          ) : (
            <ul className="divide-y divide-wd-border" data-testid="billing-albums">
              {albums.map(({ album, status }) => (
                <li key={album.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid="billing-album" data-album-id={album.id} data-status={status?.kind}>
                  <div className="min-w-0">
                    <Link href={`/sessions/${album.id}`} className="block truncate text-[15px] font-bold text-wd-ink hover:underline">{album.event_name}</Link>
                    {status && <p className="mt-0.5 text-[13px] text-wd-muted">{albumStatusLine(status, t, locale)}</p>}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 sm:shrink-0 sm:justify-end">
                    {status && <AlbumStatusPill kind={status.kind} />}
                    {status?.canActivate && <ActivateAlbumButton albumId={album.id} compact />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </WdCard>

        <WdCard title={t('albumPlan.howTitle')}>
          <ul className="space-y-2 text-[14px] text-wd-ink" data-testid="billing-how" data-reassure>
            {['how1', 'how2', 'how3', 'how4'].map((k) => <li key={k}>• {t(`albumPlan.${k}`).replace('{price}', formatAlbumPrice(locale))}</li>)}
          </ul>
        </WdCard>

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
