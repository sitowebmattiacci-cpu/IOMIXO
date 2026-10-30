'use client'
import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n'

/** After this long a guest page that has not rendered shows a way out instead of a spinner-less "Caricamento…" that may never end (slow or filtered network, in-app browser). */
export const GUEST_SLOW_MS = 12_000

/**
 * Loading state of the guest pages (album, Live Booth). Plain "Loading…" first; if the page is still waiting after GUEST_SLOW_MS (a request that hangs
 * in a restrictive in-app browser never fails by itself) it says so and offers a retry. `onRetry` re-requests the data; without it the page reloads.
 */
export function GuestLoading({ onRetry }: { onRetry?: () => void }) {
  const { t } = useI18n()
  const [slow, setSlow] = useState(false)
  useEffect(() => { const id = setTimeout(() => setSlow(true), GUEST_SLOW_MS); return () => clearTimeout(id) }, [])
  return (
    <div className="text-center" data-testid="guest-loading">
      <p className="text-white/50">{t('live.loading')}</p>
      {slow && (
        <div className="mt-4" data-testid="guest-slow">
          <p className="text-white/70 text-sm mb-3">{t('live.slowLoad')}</p>
          <RetryButton onRetry={onRetry} />
        </div>
      )}
    </div>
  )
}

/** The data could not be fetched (network, App Check, server): not the same thing as "this album does not exist", so the guest is told to retry. */
export function GuestLoadError({ onRetry }: { onRetry?: () => void }) {
  const { t } = useI18n()
  return (
    <div className="text-center" data-testid="guest-load-error">
      <p className="text-white/70 mb-3">{t('live.loadError')}</p>
      <RetryButton onRetry={onRetry} />
    </div>
  )
}

function RetryButton({ onRetry }: { onRetry?: () => void }) {
  const { t } = useI18n()
  return (
    <button type="button" onClick={() => (onRetry ? onRetry() : window.location.reload())}
      className="rounded-full border border-white/25 px-5 py-2 text-sm font-semibold text-white active:scale-[0.98]">
      {t('live.retry')}
    </button>
  )
}
