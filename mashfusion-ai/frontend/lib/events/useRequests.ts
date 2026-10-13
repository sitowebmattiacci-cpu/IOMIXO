'use client'
import { useEffect, useState } from 'react'
import { getFirebaseDb } from '../firebase/client'
import { onAuthChange } from '../firebase/auth'
import { authProvider } from '../auth'
import { subscribeGuestRequests, subscribeEventRequests } from '../firebase/repositories/requestRepository'
import { resolveOwnerEvent } from './ownerService'
import type { RequestDoc } from '../firebase/models'

/**
 * The guest's own requests for an event (realtime). `null` = realtime unavailable
 * (no event / Firebase off / listener error) → caller keeps the legacy polling.
 */
export function useGuestRequests(eventId: string | undefined): RequestDoc[] | null {
  const [requests, setRequests] = useState<RequestDoc[] | null>(null)

  useEffect(() => {
    setRequests(null)
    if (!eventId || authProvider() !== 'firebase') return
    let unsubscribe: (() => void) | undefined
    // Wait for the (anonymous) identity: the query is filtered by the guest's uid.
    const stopAuth = onAuthChange((user) => {
      unsubscribe?.(); unsubscribe = undefined
      if (!user) return
      unsubscribe = subscribeGuestRequests(getFirebaseDb(), eventId, user.uid, setRequests, () => setRequests(null))
    })
    return () => { stopAuth(); unsubscribe?.() }
  }, [eventId])

  return requests
}

type SignalSubscribe = (db: ReturnType<typeof getFirebaseDb>, eventId: string, onChange: () => void, onError: () => void) => () => void

/**
 * DJ dashboard: a realtime CHANGE SIGNAL for one child collection (requests, dedications...) of the
 * open event. Supabase is still authoritative, so the page re-fetches the legacy API whenever `tick`
 * changes instead of rendering Firestore data directly (no divergence if a projection is missed).
 * Returns { live, tick }: live=false → keep polling; tick increments on every remote change.
 * Never listens across events.
 */
export function useEventChildSignal(sessionId: string | undefined, subscribe: SignalSubscribe): { live: boolean; tick: number } {
  const [state, setState] = useState({ live: false, tick: 0 })

  useEffect(() => {
    setState({ live: false, tick: 0 })
    if (!sessionId || authProvider() !== 'firebase') return
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    let first = true

    const stopAuth = onAuthChange(async (user) => {
      unsubscribe?.(); unsubscribe = undefined
      if (!user || user.isAnonymous) return
      try {
        const db = getFirebaseDb()
        const ev = await resolveOwnerEvent(sessionId)
        if (!ev || cancelled) return
        unsubscribe = subscribe(
          db, ev.id,
          () => setState((s) => ({ live: true, tick: first ? (first = false, s.tick) : s.tick + 1 })),
          () => setState({ live: false, tick: 0 }),
        )
      } catch { /* stay on polling */ }
    })
    return () => { cancelled = true; stopAuth(); unsubscribe?.() }
  }, [sessionId, subscribe])

  return state
}

const subscribeRequestsSignal: SignalSubscribe = (db, id, onChange, onError) => subscribeEventRequests(db, id, () => onChange(), () => onError())
export const useRequestsSignal = (sessionId: string | undefined) => useEventChildSignal(sessionId, subscribeRequestsSignal)
