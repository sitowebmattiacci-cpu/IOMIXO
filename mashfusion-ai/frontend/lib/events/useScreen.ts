'use client'
import { useEffect, useMemo, useState } from 'react'
import { authProvider } from '../auth'
import { fetchPublicEvent, publicReadEnabled } from './publicEventService'
import { screenEligibility, composeScreenPayload, type LegacyReason } from './screenModel'
import type { EventDoc, DedicationDoc } from '../firebase/models'
import type { LivePollState } from './usePolls'
import type { LiveGames } from './useGames'
import type { ScreenPayload } from '../api'

/**
 * TV screen read path from Firestore (event document + realtime polls / dedications / games), replacing GET /public/:slug/screen.
 * It is used ONLY when everything the TV needs exists in Firestore:
 *  - NEXT_PUBLIC_FIRESTORE_PUBLIC_READ=on and the event document carries `screenConfig` (migrated by the events backfill / updateEventConfig);
 *  - the owner's plan allows screen mode (getPublicEvent.features.screenMode: the legacy 402 gate);
 *  - the screen does not need photos nor winner-announcement photos (Storage is not migrated: those need the legacy signed URLs).
 * Otherwise `payload` is undefined and `decided` tells the page whether to start the legacy polling (after a short grace period).
 */
const GRACE_MS = 4_000

export function useFirestoreScreen(
  event: EventDoc | null,
  poll: LivePollState | null | undefined,
  games: LiveGames | undefined,
  dedications: DedicationDoc[] | null,
  slug: string | undefined,
): { payload: ScreenPayload | undefined; decided: boolean; legacyReason: LegacyReason | 'pending' | 'disabled' | null } {
  const enabled = publicReadEnabled() && authProvider() === 'firebase'
  const [screenAllowed, setScreenAllowed] = useState<boolean | null>(null)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    setScreenAllowed(null); setTimedOut(false)
    if (!enabled || !slug) return
    let cancelled = false
    const timer = setTimeout(() => !cancelled && setTimedOut(true), GRACE_MS)
    fetchPublicEvent(slug).then((r) => !cancelled && setScreenAllowed(r.features.screenMode === true)).catch(() => !cancelled && setScreenAllowed(false))
    return () => { cancelled = true; clearTimeout(timer) }
  }, [enabled, slug])

  const verdict = useMemo(() => (enabled ? screenEligibility(event, screenAllowed, games) : null), [enabled, event, screenAllowed, games])
  const payload = useMemo<ScreenPayload | undefined>(
    () => (event && verdict?.ok ? composeScreenPayload(event, verdict.config, poll, games, dedications) : undefined),
    [event, verdict, poll, games, dedications])

  // Decided = the page may stop waiting: Firestore serves it, or Firestore cannot (not enabled / definitive legacy reason / grace elapsed).
  const pending = verdict !== null && !verdict.ok && verdict.legacyReason === 'pending'
  const decided = !enabled || !!payload || (verdict !== null && !verdict.ok && !pending && !(verdict.legacyReason === 'no_event' && !timedOut)) || timedOut
  return { payload, decided, legacyReason: !enabled ? 'disabled' : verdict && !verdict.ok ? verdict.legacyReason : null }
}
