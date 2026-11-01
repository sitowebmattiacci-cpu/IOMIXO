'use client'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { billing } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { formatAlbumPrice } from '@/lib/miolove/plans'
import type { AlbumStatus, AlbumStatusKind } from '@/lib/miolove/albumStatus'

const DATE_LOCALES: Record<string, string> = { it: 'it-IT', en: 'en-GB', fr: 'fr-FR', es: 'es-ES' }
export const formatAlbumDate = (iso: string | null | undefined, locale: string): string =>
  iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString(DATE_LOCALES[locale] ?? 'it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

const STATUS_KEYS: Record<AlbumStatusKind, string> = {
  trial: 'albumPlan.statusTrial', trialEnded: 'albumPlan.statusTrialEnded', pending: 'albumPlan.statusPending', active: 'albumPlan.statusActive', expired: 'albumPlan.statusExpired',
}
const STATUS_TONE: Record<AlbumStatusKind, string> = {
  trial: 'bg-wd-active text-wd-pink', trialEnded: 'bg-amber-100 text-amber-800', pending: 'bg-amber-100 text-amber-800', active: 'bg-emerald-100 text-emerald-800', expired: 'bg-wd-bg text-wd-muted',
}

/** Opens the one-time Stripe Checkout of ONE album (server-side price, €19.99 / $19.99, tied to that album's id). Nothing is activated here: only the verified webhook does that. */
export function useActivateAlbum() {
  const { t, locale } = useI18n()
  const [busyId, setBusyId] = useState<string | null>(null)
  const activate = async (albumId: string) => {
    if (busyId) return
    setBusyId(albumId)
    try { window.location.assign((await billing.createAlbumCheckout(albumId, locale)).url) }
    catch (e: any) { setBusyId(null); toast.error(e?.message ?? t('common.errorGeneric')) }
  }
  return { activate, busyId }
}

export function AlbumStatusPill({ kind, className }: { kind: AlbumStatusKind; className?: string }) {
  const { t } = useI18n()
  return (
    <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-xs font-bold', STATUS_TONE[kind], className)} data-testid="album-status" data-status={kind}>{t(STATUS_KEYS[kind])}</span>
  )
}

/** The date line under the status: "Disponibile fino al …" · "N giorni rimanenti" / trial end / recovery deadline. null = nothing to say. */
export function albumStatusLine(s: AlbumStatus, t: (k: string) => string, locale: string): string | null {
  const date = formatAlbumDate(s.until, locale)
  const days = s.daysLeft
  const left = days === null ? null : t(days === 1 ? 'albumPlan.dayRemaining' : 'albumPlan.daysRemaining').replace('{n}', String(days))
  switch (s.kind) {
    case 'active': return date ? [t('albumPlan.availableUntil').replace('{date}', date), left].filter(Boolean).join(' · ') : null
    case 'trial': return date ? [t('albumPlan.trialUntil').replace('{date}', date), left].filter(Boolean).join(' · ') : null
    case 'trialEnded': return s.canActivate && date ? t('albumPlan.activateBefore').replace('{date}', date) : null
    case 'pending': return t('albumPlan.pendingHint')
    case 'expired': return t('albumPlan.expiredHint')
  }
}

/** "Attiva album — 19,99 €" for the album with this id. */
export function ActivateAlbumButton({ albumId, className, compact }: { albumId: string; className?: string; compact?: boolean }) {
  const { t, locale } = useI18n()
  const { activate, busyId } = useActivateAlbum()
  const busy = busyId === albumId
  return (
    <button
      type="button" data-testid="album-activate" data-album-id={albumId} disabled={!!busyId}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void activate(albumId) }}
      className={cn('inline-flex items-center justify-center rounded-2xl bg-wd-pink font-semibold text-wd-ink transition hover:bg-wd-pink-hover disabled:cursor-not-allowed disabled:opacity-60', compact ? 'min-h-[40px] px-4 text-sm' : 'min-h-[48px] w-full px-5 text-[15px]', className)}
    >
      {busy ? t('albumPlan.activating') : t('albumPlan.activateAlbum').replace('{price}', formatAlbumPrice(locale))}
    </button>
  )
}
