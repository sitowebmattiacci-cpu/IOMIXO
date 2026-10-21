import { collection, getDocs } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getFirebaseDb, getFirebaseFunctions, getFirebaseStorage } from '../firebase/client'
import { waitForAuthReady } from '../firebase/auth'
import { authProvider } from '../auth'
import { dashboardFlag, ownerCallablesFlag } from './flags'
import { eventToSession } from './legacyMappers'
import { getEventById, getOwnerEventByLegacyId } from '../firebase/repositories/eventRepository'
import { getLatestGame } from '../firebase/repositories/gameRepository'
import { listOwnerPhotos, photoUrl, forgetPhotoUrl, subscribeExport, type ExportDoc } from '../firebase/repositories/photoRepository'
import { toLegacyPhotos, extensionOf } from './photoService'
import { ref as storageRef, uploadBytes } from 'firebase/storage'
import { getEventIdBySlug } from '../firebase/repositories/eventRepository'
import { listEventRequests } from '../firebase/repositories/requestRepository'
import { listEventDedications } from '../firebase/repositories/dedicationRepository'
import { fromPollDoc, sumTally } from '../firebase/repositories/pollRepository'
import type { EventDoc } from '../firebase/models'
import type { LiveDedication, LiveGameRound, LivePhoto, LivePoll, LiveRequest, LiveRequestStatus, LiveSession } from '../api'

/**
 * DJ-side operations on Firestore (requests / dedications moderation, polls, event settings) for events that already live in
 * Firestore. EVERY method resolves to `null` when it does not apply (flag off, not signed in as an account, event not in Firestore,
 * unknown item id) so lib/api.ts keeps using the legacy Express routes. Writes go through owner callables only; reads are direct
 * Firestore queries allowed by the rules to the event owner. Items keep Firestore ids; an id → eventId registry (filled by the list
 * calls) lets the id-only legacy signatures (updateRequest(id)) find their event.
 *
 * Switch: NEXT_PUBLIC_FIRESTORE_OWNER_OPS=on|true (default off → behaviour unchanged).
 */
export const ownerOpsEnabled = () => ownerCallablesFlag() && authProvider() === 'firebase'
/** Dashboard switch (NEXT_PUBLIC_FIRESTORE_DASHBOARD): Firestore is AUTHORITATIVE for the event lifecycle, core fields and games. */
export const dashboardOn = () => dashboardFlag() && authProvider() === 'firebase'

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
  session_limit:         'Il tuo piano permette al massimo 1 sessione attiva. Passa a Pro per sessioni illimitate.',
  miolove_trial_album_exists: 'Hai già creato il tuo album gratuito. Puoi continuare a usarlo dalla tua area album.',
  request_id_conflict:   'Richiesta già usata, riprova',
  slug_unavailable:      'Impossibile generare un link univoco, riprova',
  slug_taken:            'Il link della sessione è stato assegnato a un altro evento',
  games_unavailable:     'Funzione disponibile solo per sessioni Party Mode o Wedding Edition.',
  no_active_game:        'Nessun gioco attivo. Avvia il gioco.',
  no_penalties:          'Nessuna penitenza disponibile con le categorie selezionate.',
  photo_not_found:       'Foto non trovata',
  photo_not_ready:       'Il caricamento della foto non è terminato',
  photos_unavailable:    'Album foto disponibile solo per sessioni Party Mode o Wedding Edition.',
  export_requires_album: 'Scaricare tutto è incluso nell\'Album completo.',
  export_empty:          'L\'album non contiene ancora foto o video.',
  export_not_ready:      'L\'archivio non è ancora pronto.',
  export_expired:        'L\'archivio è scaduto: preparane uno nuovo.',
  export_not_found:      'Archivio non trovato.',
  export_media_invalid:  'Alcuni contenuti non fanno parte di questo album.',
  export_busy:           'Stiamo già preparando un altro archivio: riprova tra poco.',
  export_selection_too_large: 'Hai selezionato troppi contenuti: scegline meno o scarica tutto.',
}

async function callOwner<Out>(name: string, payload: object): Promise<Out> {
  try {
    return (await httpsCallable<object, Out>(getFirebaseFunctions(), name)(payload)).data
  } catch (e) {
    const err = e as { message?: string; details?: { reason?: string } }
    // The server reason travels with the error so a screen can show its own (translated) message.
    const reason = err.details?.reason
    throw Object.assign(new Error((reason && MESSAGES[reason]) || err.message || 'Operazione non riuscita'), { reason })
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
      const db = getFirebaseDb()
      const byLegacy = await getOwnerEventByLegacyId(db, user.uid, sessionId)
      if (byLegacy) return byLegacy
      // Events created natively in Firestore have no Supabase id: the dashboard URL then carries the event id (owner check is explicit).
      const byId = await getEventById(db, sessionId).catch(() => null)
      return byId && byId.ownerUid === user.uid ? byId : null
    })().catch(() => null)
    events.set(sessionId, p)
    // A negative answer may become positive (event backfilled meanwhile): do not cache it for long.
    p.then((e) => { if (!e) setTimeout(() => events.delete(sessionId), 30_000) })
  }
  return p
}
const forSession = async (sessionId: string) => (ownerOpsEnabled() ? resolveOwnerEvent(sessionId) : null)
/** Same, but only when the DASHBOARD switch is on (authoritative operations: lifecycle, core fields, games). */
const forDashboard = async (sessionId: string) => (dashboardOn() ? resolveOwnerEvent(sessionId) : null)

const requestId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '')

// id → eventId registry (module memory only)
const owners = { request: new Map<string, string>(), dedication: new Map<string, string>(), poll: new Map<string, string>(), photo: new Map<string, string>() }
const eventOf = (kind: keyof typeof owners, id: string) => (ownerOpsEnabled() ? owners[kind].get(id) ?? null : null)
const iso = (d: Date | null) => (d ?? new Date()).toISOString()

const GAME_TYPE = { roulette: 'wedding_roulette', shoe: 'shoe_game' } as const
const roundToLegacy = (g: NonNullable<Awaited<ReturnType<typeof getLatestGame>>>): LiveGameRound => ({
  id: g.id, game_type: g.type, status: g.status, config: g.config as LiveGameRound['config'], result: g.result as LiveGameRound['result'],
  created_at: (g.createdAt ?? new Date()).toISOString(), updated_at: (g.updatedAt ?? new Date()).toISOString(),
})

export const ownerOps = {
  /** Event lifecycle (dashboard switch): the event is created / soft-deleted in Firestore only, nothing reaches Render or Supabase. */
  sessions: {
    async create(input: {
      event_name: string; dj_name?: string; description?: string; session_type?: string
      couple_names?: string; wedding_date?: string; venue_name?: string; screen_mode_enabled?: boolean; occasion_type?: string; brand?: 'iomixo' | 'miolove'
    }): Promise<LiveSession | null> {
      if (!dashboardOn()) return null
      const r = await callOwner<{ eventId: string; slug: string }>('createEvent', {
        requestId: requestId(), title: input.event_name, djName: input.dj_name, description: input.description, type: input.session_type,
        coupleNames: input.couple_names, weddingDate: input.wedding_date, venueName: input.venue_name, screenModeEnabled: input.screen_mode_enabled,
        occasionType: input.occasion_type, brand: input.brand,
      })
      const ev = await getEventById(getFirebaseDb(), r.eventId)
      if (!ev) throw new Error('Sessione creata ma non ancora leggibile, riprova')
      return eventToSession(ev)
    },
    async remove(sessionId: string): Promise<boolean> {
      const ev = await forDashboard(sessionId); if (!ev) return false
      await callOwner('deleteEvent', { eventId: ev.id })
      events.delete(sessionId); return true
    },
    async restore(sessionId: string, eventId: string): Promise<void> {
      await callOwner('restoreEvent', { eventId }); events.delete(sessionId)
    },
  },
  /**
   * Photos (dashboard switch): the owner's lists / moderation / winner photos. Lists fill an id → eventId registry so the id-only legacy signatures
   * (setStatus(id)) can find their event, as for requests and polls.
   */
  photos: {
    async list(sessionId: string, onlyBooth = false): Promise<LivePhoto[] | null> {
      const ev = await forDashboard(sessionId); if (!ev) return null
      const docs = await listOwnerPhotos(getFirebaseDb(), ev.id)
      docs.forEach((p) => owners.photo.set(p.id, ev.id))
      const rows = await toLegacyPhotos(docs.filter((p) => !onlyBooth || p.source === 'live_booth'), { owner: true })
      return rows.map((r) => ({ ...r, session_id: sessionId } as LivePhoto))
    },
    async moderate(photoId: string, body: { action: 'set_status'; status: 'pending' | 'approved' | 'rejected' } | { action: 'set_featured'; isFeatured: boolean } | { action: 'delete' }): Promise<boolean> {
      const eventId = dashboardOn() ? owners.photo.get(photoId) : null; if (!eventId) return false
      await callOwner('moderatePhoto', { eventId, photoId, ...body })
      const doc = owners.photo.get(photoId); void doc
      return true
    },
    /** URL of the ORIGINAL file of one media (owner only: storage.rules give nobody else the original of a new photo). null = not applicable. */
    async originalUrl(path: string): Promise<string | null> {
      if (!dashboardOn() || !path) return null
      return photoUrl(getFirebaseStorage(), path)
    },
    /** "Download everything": asks the server for ONE archive with the originals. The progress comes from `watchExport`. */
    async requestExport(sessionId: string, mediaIds?: string[]): Promise<{ exportId: string; eventId: string; status: string; total: number } | null> {
      const ev = await forDashboard(sessionId); if (!ev) return null
      const r = await callOwner<{ exportId: string; status: string; total: number }>('requestAlbumExport', mediaIds?.length ? { eventId: ev.id, mediaIds } : { eventId: ev.id })
      return { ...r, eventId: ev.id }
    },
    watchExport(eventId: string, exportId: string, onChange: (x: ExportDoc | null) => void, onError?: (e: Error) => void): (() => void) {
      return subscribeExport(getFirebaseDb(), eventId, exportId, onChange, onError)
    },
    /** A fresh, short-lived URL of a READY archive. */
    async exportUrl(eventId: string, exportId: string): Promise<{ url: string; bytes: number | null; expiresAt: number; fileName: string }> {
      return callOwner('getAlbumExportUrl', { eventId, exportId })
    },
    /** Winner-announcement photo: straight to Storage under the event's winner folder (rules: owner only). Returns the path stored in screenConfig. */
    async uploadWinnerPhoto(slug: string, file: File, role: 'groom' | 'bride'): Promise<{ storage_path: string } | null> {
      if (!dashboardOn()) return null
      const eventId = await getEventIdBySlug(getFirebaseDb(), slug); if (!eventId) return null
      const token = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9]/g, '')
      const path = `events/${eventId}/winner/${role}-${token}.${extensionOf(file)}`
      const type = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
      try { await uploadBytes(storageRef(getFirebaseStorage(), path), file, { contentType: type }) } catch { throw new Error('Caricamento non riuscito, riprova.') }
      return { storage_path: path }
    },
    /** URLs to preview the stored winner photos; null = not applicable (legacy preview). Firebase paths only. */
    async winnerUrls(cfg: { groom_photo_path?: string | null; bride_photo_path?: string | null }): Promise<{ groom: string | null; bride: string | null } | null> {
      if (!dashboardOn()) return null
      const st = getFirebaseStorage()
      const one = (p?: string | null) => (p && p.startsWith('events/') ? photoUrl(st, p) : Promise.resolve(null))
      return { groom: await one(cfg.groom_photo_path), bride: await one(cfg.bride_photo_path) }
    },
    forget: forgetPhotoUrl,
  },

  /** DJ games (dashboard switch). Every action returns the round as the legacy UI expects it, read back from Firestore. */
  games: {
    async act(sessionId: string, game: 'roulette' | 'shoe', action: 'start' | 'spin' | 'next' | 'reset', extra: { categories?: string[]; questions?: string[] } = {}): Promise<{ round: LiveGameRound | null } | null> {
      const ev = await forDashboard(sessionId); if (!ev) return null
      const r = await callOwner<{ roundId: string | null }>('ownerGameAction', { eventId: ev.id, game, action, ...extra })
      if (!r.roundId) return { round: null }
      const latest = await getLatestGame(getFirebaseDb(), ev.id, GAME_TYPE[game])
      return { round: latest ? roundToLegacy(latest) : null }
    },
    async latest(sessionId: string, game: 'roulette' | 'shoe'): Promise<{ round: LiveGameRound | null } | null> {
      const ev = await forDashboard(sessionId); if (!ev) return null
      const latest = await getLatestGame(getFirebaseDb(), ev.id, GAME_TYPE[game])
      return { round: latest ? roundToLegacy(latest) : null }
    },
    async setConfig(sessionId: string, patch: { roulettePenitenze?: unknown; shoeGameQuestions?: unknown }): Promise<boolean> {
      const ev = await forDashboard(sessionId); if (!ev) return false
      await callOwner('setGameConfig', { eventId: ev.id, ...patch }); return true
    },
  },
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
    CONFIG_KEYS: ['screen_config', 'guest_config', 'poster_config', 'screen_mode_enabled'] as const,
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
      winner_announcement?: Record<string, unknown> | null; poster_config?: Record<string, unknown> | null; mirror?: Record<string, unknown>
    }): Promise<boolean> {
      const ev = await forSession(sessionId); if (!ev) return false
      const eventFields: Record<string, unknown> = {}
      for (const [legacy, fs] of Object.entries(ownerOps.config.MIRRORED_KEYS)) if (input.mirror && legacy in input.mirror) eventFields[fs] = input.mirror[legacy]
      if (input.mirror && typeof input.mirror.is_active === 'boolean') eventFields.status = input.mirror.is_active ? 'live' : 'ended'
      await callOwner('updateEventConfig', {
        eventId: ev.id,
        ...('screen_config' in input ? { screenConfig: input.screen_config } : {}),
        ...('guest_config' in input ? { guestConfig: input.guest_config } : {}),
        ...('poster_config' in input ? { posterConfig: input.poster_config } : {}),
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
        ...(ev.posterConfig ? { poster_config: ev.posterConfig } : {}),
        screen_mode_enabled: ev.screenModeEnabled,
      }
    },
  },
}
