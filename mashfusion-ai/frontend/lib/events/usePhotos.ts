'use client'
import { useEffect, useMemo, useState } from 'react'
import { getFirebaseDb, getFirebaseStorage } from '../firebase/client'
import { onAuthChange } from '../firebase/auth'
import { authProvider } from '../auth'
import { subscribeApprovedPhotos, subscribeOwnerPhotos, photoUrl, docToLivePhoto } from '../firebase/repositories/photoRepository'
import { useEventChildSignal } from './useRequests'
import type { LivePhoto } from '../api'

/**
 * TV / Live Booth: the newest APPROVED photos of one event in realtime, with their Storage URLs, in the shape the legacy screen payload had.
 * `undefined` = not ready or unavailable (no event, Firebase off, rules / network error): the caller keeps waiting, then falls back to the legacy
 * polling. Photos whose binary is not served from Storage yet (legacy-only backfill) are skipped.
 */
export function useApprovedPhotos(eventId: string | undefined, max = 12): LivePhoto[] | undefined {
  const [photos, setPhotos] = useState<LivePhoto[] | undefined>(undefined)

  useEffect(() => {
    setPhotos(undefined)
    if (!eventId || authProvider() !== 'firebase') return
    let unsubscribe: (() => void) | undefined, seq = 0, cancelled = false
    const stopAuth = onAuthChange((user) => {
      unsubscribe?.(); unsubscribe = undefined
      if (!user) return
      const storage = getFirebaseStorage()
      unsubscribe = subscribeApprovedPhotos(getFirebaseDb(), eventId, max, async (docs) => {
        const mine = ++seq
        const rows = await Promise.all(docs.filter((d) => d.storagePath).map((d) => docToLivePhoto(storage, d)))
        if (!cancelled && mine === seq) setPhotos(rows.filter((r) => r.url))        // a newer snapshot already won: drop this one
      }, () => !cancelled && setPhotos(undefined))
    })
    return () => { cancelled = true; stopAuth(); unsubscribe?.() }
  }, [eventId, max])

  return photos
}

const subscribePhotosSignal = (db: ReturnType<typeof getFirebaseDb>, id: string, onChange: () => void, onError: () => void) =>
  subscribeOwnerPhotos(db, id, onChange, () => onError())

/** Owner: change signal for the open event's photos (see useEventChildSignal). */
export const usePhotosSignal = (sessionId: string | undefined) => useEventChildSignal(sessionId, subscribePhotosSignal)

export interface WinnerUrls { groom: string | null; bride: string | null }
const FIREBASE_PATH = /^events\//

/**
 * Storage URLs of the winner-announcement photos stored in screenConfig. `null` = the announcement has no Firebase photo (nothing to resolve);
 * `undefined` = resolving. Legacy paths are NOT resolved here (the legacy screen payload serves them).
 */
export function useWinnerUrls(winner: unknown): WinnerUrls | null | undefined {
  const w = (winner && typeof winner === 'object' ? winner : {}) as Record<string, unknown>
  const groom = typeof w.groom_photo_path === 'string' && FIREBASE_PATH.test(w.groom_photo_path) ? w.groom_photo_path : null
  const bride = typeof w.bride_photo_path === 'string' && FIREBASE_PATH.test(w.bride_photo_path) ? w.bride_photo_path : null
  const [urls, setUrls] = useState<WinnerUrls | undefined>(undefined)
  const key = `${groom ?? ''}|${bride ?? ''}`

  useEffect(() => {
    setUrls(undefined)
    if ((!groom && !bride) || authProvider() !== 'firebase') return
    let cancelled = false
    const unsub = onAuthChange((user) => {
      if (!user || cancelled) return
      const st = getFirebaseStorage()
      Promise.all([groom ? photoUrl(st, groom) : null, bride ? photoUrl(st, bride) : null]).then(([g, b]) => !cancelled && setUrls({ groom: g, bride: b }))
    })
    return () => { cancelled = true; unsub() }
  }, [key])    // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => (!groom && !bride ? null : urls), [groom, bride, urls])
}
