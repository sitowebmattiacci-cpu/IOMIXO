import { collection, getDocs } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getFirebaseDb, getFirebaseFunctions } from '../firebase/client'
import { waitForAuthReady } from '../firebase/auth'
import { authProvider } from '../auth'
import { ownerOpsFlag } from './flags'
import { getOwnerEventByLegacyId } from '../firebase/repositories/eventRepository'
import { listEventRequests } from '../firebase/repositories/requestRepository'
import { listEventDedications } from '../firebase/repositories/dedicationRepository'
import { fromPollDoc, sumTally } from '../firebase/repositories/pollRepository'
import type { EventDoc } from '../firebase/models'
import type { LiveDedication, LivePoll, LiveRequest, LiveRequestStatus } from '../api'

/**
 * DJ-side operations on Firestore (requests / dedications moderation, polls, event settings) for events that already live in
 * Firestore. EVERY method resolves to `null` when it does not apply (flag off, not signed in as an account, event not in Firestore,
 * unknown item id) so lib/api.ts keeps using the legacy Express routes. Writes go through owner callables only; reads are direct
 * Firestore queries allowed by the rules to the event owner. Items keep Firestore ids; an id → eventId registry (filled by the list
 * calls) lets the id-only legacy signatures (updateRequest(id)) find their event.
 *
 * Switch: NEXT_PUBLIC_FIRESTORE_OWNER_OPS=on|true (default off → behaviour unchanged).
 */
export const ownerOpsEnabled = () => ownerOpsFlag() && authProvider() === 'firebase'

const MESSAGES: Record<string, string> = {
  event_access_required: 'Funzione disponibile con il piano Advance o un Event Pass 24H.',
  polls_unavailable:     'Sondaggi disponibili solo per sessioni Party Mode o Wedding Edition.',
  event_not_found:       'Sessione non trovata',
  request_not_found:     'Richiesta non trovata',
  dedication_not_found:  'Dedica non trovata',
  poll_not_found:        'Sondaggio non trovato',
  invalid_payload:       'Dati non validi',
  account_required:      'Accedi con il tuo account',
  unauthenticated:       'Accedi con il tuo account',
}

async function callOwner<Out>(name: string, payload: object): Promise<Out> {
  try {
    return (await httpsCallable<object, Out>(getFirebaseFunctions(), name)(payload)).data
  } catch (e) {
    const err = e as { message?: string; details?: { reason?: string } }
    throw new Error((err.details?.reason && MESSAGES[err.details.reason]) || err.message || 'Operazione non riuscita')
  }
}

// ── event resolution (sessionId = legacy Supabase id, as in the dashboard URL) ──
const events = new Map<string, Promise<EventDoc | null>>()
export function resolveOwnerEvent(sessionId: string): Promise<EventDoc | null> {
  let p = events.get(sessionId)
  if (!p) {
    p = (async () => {
      const user = await waitForAuthReady()
      if (!user || user.isAnonymous) return null
      return getOwnerEventByLegacyId(getFirebaseDb(), user.uid, sessionId)
    })().catch(() => null)
    events.set(sessionId, p)
    // A negative answer may become positive (event backfilled meanwhile): do not cache it for long.
    p.then((e) => { if (!e) setTimeout(() => events.delete(sessionId), 30_000) })
  }
  return p
}
const forSession = async (sessionId: string) => (ownerOpsEnabled() ? resolveOwnerEvent(sessionId) : null)

// id → eventId registry (module memory only)
const owners = { request: new Map<string, string>(), dedication: new Map<string, string>(), poll: new Map<string, string>() }
const eventOf = (kind: keyof typeof owners, id: string) => (ownerOpsEnabled() ? owners[kind].get(id) ?? null : null)
const iso = (d: Date | null) => (d ?? new Date()).toISOString()

export const ownerOps = {
  requests: {
    async list(sessionId: string): Promise<LiveRequest[] | null> {
      const ev = await forSession(sessionId); if (!ev) return null
      const rows = await listEventRequests(getFirebaseDb(), ev.id)
      rows.forEach((r) => owners.request.set(r.id, ev.id))
      return rows.map((r) => ({
        id: r.id, session_id: sessionId, track_title: r.songTitle, artist: r.artist, message: r.message,
        status: r.status, ip_hash: null, created_at: iso(r.createdAt), updated_at: iso(r.updatedAt),
      }))
    },
    async setStatus(requestId: string, status: LiveRequestStatus): Promise<boolean> {
      const eventId = eventOf('request', requestId); if (!eventId) return false
      await callOwner('moderateRequest', { eventId, requestId, action: 'set_status', status }); return true
    },
    async remove(requestId: string): Promise<boolean> {
      const eventId = eventOf('request', requestId); if (!eventId) return false
      await callOwner('moderateRequest', { eventId, requestId, action: 'delete' }); return true
    },
  },
  dedications: {
    async list(sessionId: string): Promise<LiveDedication[] | null> {
      const ev = await forSession(sessionId); if (!ev) return null
      const rows = await listEventDedications(getFirebaseDb(), ev.id)
      rows.forEach((r) => owners.dedication.set(r.id, ev.id))
      return rows.map((r) => ({ id: r.id, session_id: sessionId, guest_name: r.senderName, message: r.message, status: r.status, created_at: iso(r.createdAt) }))
    },
    async setStatus(dedicationId: string, status: LiveDedication['status']): Promise<boolean> {
      const eventId = eventOf('dedication', dedicationId); if (!eventId) return false
      await callOwner('moderateDedication', { eventId, dedicationId, action: 'set_status', status }); return true
    },
    async remove(dedicationId: string): Promise<boolean> {
      const eventId = eventOf('dedication', dedicationId); if (!eventId) return false
      await callOwner('moderateDedication', { eventId, dedicationId, action: 'delete' }); return true
    },
  },
  polls: {
    async list(sessionId: string): Promise<LivePoll[] | null> {
      const ev = await forSession(sessionId); if (!ev) return null
      const db = getFirebaseDb()
      const snap = await getDocs(collection(db, 'events', ev.id, 'polls'))
      const polls = snap.docs.map((d) => fromPollDoc(d.id, d.data())).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
      return Promise.all(polls.map(async (p) => {
        owners.poll.set(p.id, ev.id)
        const shards = await getDocs(collection(db, 'events', ev.id, 'polls', p.id, 'tally'))
        return { id: p.id, session_id: sessionId, question: p.question, options: p.options, is_active: p.status === 'open',
                 tally: sumTally(shards.docs.map((s) => s.data()), p.options.length), created_at: iso(p.createdAt) }
      }))
    },
    async create(sessionId: string, body: { question: string; options: string[] }): Promise<LivePoll | null> {
      const ev = await forSession(sessionId); if (!ev) return null
      const r = await callOwner<{ pollId: string }>('createPoll', { eventId: ev.id, question: body.question, options: body.options })
      owners.poll.set(r.pollId, ev.id)
      return { id: r.pollId, session_id: sessionId, question: body.question, options: body.options, is_active: true, tally: body.options.map(() => 0), created_at: new Date().toISOString() }
    },
    async setActive(pollId: string, open: boolean): Promise<boolean> {
      const eventId = eventOf('poll', pollId); if (!eventId) return false
      await callOwner('setPollStatus', { eventId, pollId, open }); return true
    },
  },
  config: {
    /** Fields of `live_sessions` whose AUTHORITY moved to Firestore (event config the TV and the guest page read). */
    CONFIG_KEYS: ['screen_config', 'guest_config', 'screen_mode_enabled'] as const,
    /** Fields still AUTHORITATIVE in Supabase; Firestore only mirrors them (legacy write first, then this mirror). */
    MIRRORED_KEYS: { event_name: 'title', dj_name: 'djName', description: 'description', couple_names: 'coupleNames', wedding_date: 'weddingDate', venue_name: 'venueName' } as const,
    /** The Firestore event of a dashboard session, or null when this switch/event does not apply (→ legacy only). */
    event: (sessionId: string) => forSession(sessionId),
    /**
     * One call = one atomic Firestore update: config (authoritative here), winner-announcement signal, and the mirror of legacy-owned event
     * fields. Throws on failure so the caller can tell the owner to retry (the legacy write, if any, is idempotent).
     */
    async update(sessionId: string, input: {
      screen_config?: Record<string, unknown> | null; guest_config?: Record<string, unknown> | null; screen_mode_enabled?: boolean
      winner_announcement?: Record<string, unknown> | null; mirror?: Record<string, unknown>
    }): Promise<boolean> {
      const ev = await forSession(sessionId); if (!ev) return false
      const eventFields: Record<string, unknown> = {}
      for (const [legacy, fs] of Object.entries(ownerOps.config.MIRRORED_KEYS)) if (input.mirror && legacy in input.mirror) eventFields[fs] = input.mirror[legacy]
      if (input.mirror && typeof input.mirror.is_active === 'boolean') eventFields.status = input.mirror.is_active ? 'live' : 'ended'
      await callOwner('updateEventConfig', {
        eventId: ev.id,
        ...('screen_config' in input ? { screenConfig: input.screen_config } : {}),
        ...('guest_config' in input ? { guestConfig: input.guest_config } : {}),
        ...('screen_mode_enabled' in input ? { screenModeEnabled: input.screen_mode_enabled } : {}),
        ...('winner_announcement' in input ? { winnerAnnouncement: input.winner_announcement } : {}),
        ...(Object.keys(eventFields).length ? { eventFields } : {}),
      })
      events.delete(sessionId); return true
    },
    /** Overlay the Firestore-authoritative config onto a session read from the legacy API (so the dashboard shows what was saved). */
    async overlay<S extends Record<string, any>>(sessionId: string, session: S): Promise<S> {
      const ev = await forSession(sessionId); if (!ev) return session
      return {
        ...session,
        ...(ev.screenConfig !== undefined ? { screen_config: ev.screenConfig } : {}),
        ...(ev.guestConfig !== undefined ? { guest_config: ev.guestConfig } : {}),
        screen_mode_enabled: ev.screenModeEnabled,
      }
    },
  },
}
