'use client'
import { useEffect, useState } from 'react'
import { getFirebaseDb } from '../firebase/client'
import { onAuthChange } from '../firebase/auth'
import { authProvider } from '../auth'
import { subscribeActivePoll, subscribePollTally, subscribeMyVote, subscribeEventPolls } from '../firebase/repositories/pollRepository'
import { useEventChildSignal } from './useRequests'
import type { PollDoc } from '../firebase/models'

export interface LivePollState {
  poll:    PollDoc
  tally:   number[]
  /** The signed-in guest's own vote (from Firestore, so it survives reloads); null = not voted. */
  myVote:  number | null
}

/**
 * Guest / TV: the open poll of one event with live results.
 * Exactly three small listeners: the open-poll query (1 doc), the tally shards (≤6 docs) and the guest's own
 * vote doc — never the votes collection. `undefined` = realtime unavailable (caller keeps legacy polling),
 * `null` = realtime works and there is no open poll.
 */
export function useActivePoll(eventId: string | undefined): LivePollState | null | undefined {
  const [poll, setPoll] = useState<PollDoc | null | undefined>(undefined)
  const [tally, setTally] = useState<number[] | null>(null)
  const [myVote, setMyVote] = useState<number | null>(null)
  const [uid, setUid] = useState<string | null>(null)

  useEffect(() => {
    setPoll(undefined); setTally(null); setMyVote(null)
    if (!eventId || authProvider() !== 'firebase') return
    let unsubscribe: (() => void) | undefined
    const stopAuth = onAuthChange((user) => {
      unsubscribe?.(); unsubscribe = undefined
      setUid(user?.uid ?? null)
      if (!user) return
      unsubscribe = subscribeActivePoll(getFirebaseDb(), eventId, setPoll, () => setPoll(undefined))
    })
    return () => { stopAuth(); unsubscribe?.() }
  }, [eventId])

  const pollId = poll?.id, optionCount = poll?.options.length ?? 0
  useEffect(() => {
    setTally(null); setMyVote(null)
    if (!eventId || !pollId || !uid) return
    const db = getFirebaseDb()
    const u1 = subscribePollTally(db, eventId, pollId, optionCount, setTally, () => setTally(null))
    const u2 = subscribeMyVote(db, eventId, pollId, uid, setMyVote, () => setMyVote(null))
    return () => { u1(); u2() }
  }, [eventId, pollId, optionCount, uid])

  if (poll === undefined) return undefined
  if (poll === null) return null
  return { poll, tally: tally ?? new Array(optionCount).fill(0), myVote }
}

/** Shape the legacy UI components already understand. */
export function toLegacyPoll(s: LivePollState) {
  return {
    id: s.poll.id, legacy_id: s.poll.legacySupabaseId, question: s.poll.question, options: s.poll.options,
    is_active: true, tally: s.tally, created_at: (s.poll.createdAt ?? new Date()).toISOString(),
  }
}

/**
 * DJ dashboard: change signal for the open event's polls — the polls collection (create/close) plus the tally
 * shards of each OPEN poll. Supabase is authoritative, so the page re-fetches the legacy list on every tick.
 */
export const usePollsSignal = (sessionId: string | undefined) => useEventChildSignal(sessionId, subscribePollsSignal)

/** Trailing throttle: at most one signal per `ms`, so a burst of votes triggers one legacy re-fetch, not hundreds. */
function throttled(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const wrapped = () => { if (timer) return; timer = setTimeout(() => { timer = null; fn() }, ms) }
  wrapped.cancel = () => { if (timer) clearTimeout(timer); timer = null }
  return wrapped
}

function subscribePollsSignal(db: ReturnType<typeof getFirebaseDb>, eventId: string, rawOnChange: () => void, onError: () => void) {
  const onChange = throttled(rawOnChange, 2_000)
  const tallyUnsubs = new Map<string, () => void>()
  const stopPolls = subscribeEventPolls(db, eventId, (polls) => {
    const open = new Map(polls.filter((p) => p.status === 'open').map((p) => [p.id, p]))
    tallyUnsubs.forEach((un, id) => { if (!open.has(id)) { un(); tallyUnsubs.delete(id) } })
    open.forEach((p, id) => {
      if (tallyUnsubs.has(id)) return
      let first = true
      tallyUnsubs.set(id, subscribePollTally(db, eventId, id, p.options.length, () => { if (first) first = false; else onChange() }, onError))
    })
    onChange()
  }, onError)
  return () => { stopPolls(); tallyUnsubs.forEach((un) => un()); tallyUnsubs.clear(); onChange.cancel() }
}
