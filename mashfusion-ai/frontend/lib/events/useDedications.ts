'use client'
import { useEffect, useState } from 'react'
import { getFirebaseDb } from '../firebase/client'
import { onAuthChange } from '../firebase/auth'
import { authProvider } from '../auth'
import { subscribeApprovedDedications, subscribeEventDedications } from '../firebase/repositories/dedicationRepository'
import { useEventChildSignal } from './useRequests'
import type { DedicationDoc } from '../firebase/models'

/**
 * Guest: realtime wall of APPROVED dedications of one event. `null` = realtime unavailable → the
 * caller keeps the legacy polling. The listener is closed on unmount / event change.
 */
export function useApprovedDedications(eventId: string | undefined): DedicationDoc[] | null {
  const [items, setItems] = useState<DedicationDoc[] | null>(null)

  useEffect(() => {
    setItems(null)
    if (!eventId || authProvider() !== 'firebase') return
    let unsubscribe: (() => void) | undefined
    const stopAuth = onAuthChange((user) => {
      unsubscribe?.(); unsubscribe = undefined
      if (!user) return
      unsubscribe = subscribeApprovedDedications(getFirebaseDb(), eventId, setItems, () => setItems(null))
    })
    return () => { stopAuth(); unsubscribe?.() }
  }, [eventId])

  return items
}

const subscribeDedicationsSignal = (db: ReturnType<typeof getFirebaseDb>, id: string, onChange: () => void, onError: () => void) =>
  subscribeEventDedications(db, id, () => onChange(), () => onError())

/** DJ: change signal for the open event's dedications (see useEventChildSignal). */
export const useDedicationsSignal = (sessionId: string | undefined) => useEventChildSignal(sessionId, subscribeDedicationsSignal)
