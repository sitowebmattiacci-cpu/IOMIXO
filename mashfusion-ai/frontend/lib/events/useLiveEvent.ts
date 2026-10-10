'use client'
import { useEffect, useState } from 'react'
import { authProvider } from '../auth'
import { resolveEventIdForGuest, watchEvent } from './eventService'
import type { EventDoc } from '../firebase/models'

/**
 * Realtime event for the public live page. Returns null whenever realtime is not
 * available (Firebase not configured, event not projected yet, permission error),
 * letting the caller fall back to the legacy polling. The listener is closed on
 * unmount / slug change, so React strict-mode and Next hot reload never leak it.
 */
export function useLiveEvent(slug: string | undefined): EventDoc | null {
  const [event, setEvent] = useState<EventDoc | null>(null)

  useEffect(() => {
    setEvent(null)
    if (!slug || authProvider() !== 'firebase') return
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    resolveEventIdForGuest(slug)
      .then((id) => {
        if (cancelled || !id) return
        unsubscribe = watchEvent(id, (e) => !cancelled && setEvent(e), () => !cancelled && setEvent(null))
      })
      .catch(() => { /* realtime unavailable → polling fallback */ })

    return () => { cancelled = true; unsubscribe?.() }
  }, [slug])

  return event
}
