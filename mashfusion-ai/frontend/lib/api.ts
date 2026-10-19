import { signOut } from '@/lib/auth'
import type { User, Subscription, Payment } from '@/types'

// Firebase is the only runtime (Auth, Firestore, Storage, Functions, Stripe via callables). There is no HTTP backend.
// The services are loaded lazily so a page that never calls the API does not pull the Firebase SDK.

const unavailable = (msg: string): never => { throw new Error(msg) }
/** A service returns null/false when it does not apply (not signed in as an account, unknown event): surface it as an error. */
const need = <T,>(v: T | null | undefined | false, msg = 'Accedi con il tuo account'): T => (v === null || v === undefined || v === false ? unavailable(msg) : v)

const profile = async () => (await import('./events/profileService')).profileOps
const billingFs = async () => (await import('./events/billingService')).billingOps
const dashboard = async () => (await import('./events/dashboardService')).dashboardOps
const owner = async () => (await import('./events/ownerService')).ownerOps
const photoGuest = async () => import('./events/photoService')
const NOT_FOUND = 'Sessione non trovata'

export const auth = {
  /** Returns the account document (plan included) from Firestore. */
  async me(): Promise<User> {
    return need(await (await dashboard()).me())
  },

  async logout(): Promise<void> {
    await signOut()
  },
}

// ══════════════════════════════════════════════════════════════
// USER — Profile
// ══════════════════════════════════════════════════════════════
export const user = {
  async updateProfile(payload: { full_name?: string; avatar_url?: string }): Promise<User> {
    const ops = await profile()
    // The avatar URL is server-published (commitAvatar): a client can only clear it.
    if (payload.avatar_url === '' && payload.full_name === undefined) return need(await ops.removeUserAvatar())
    if (payload.full_name !== undefined && payload.avatar_url === undefined) return need(await ops.updateName(payload.full_name))
    return unavailable('Operazione non supportata')
  },

  async uploadAvatar(file: File): Promise<User> {
    return need(await (await profile()).uploadUserAvatar(file))
  },
}

// ══════════════════════════════════════════════════════════════
// BILLING — Stripe through Firebase callables + Firestore
// ══════════════════════════════════════════════════════════════
export const billing = {
  /** The server decides mode, URLs, metadata and the customer; `sessionId` (a Firebase event id) only scopes an Event Pass. */
  async createCheckoutSession(priceId: string, _mode: 'subscription' | 'payment' = 'subscription', sessionId?: string, opts?: { trial?: boolean; plan?: string; portal?: 'iomixo' | 'miolove' }): Promise<{ url: string }> {
    return need(await (await billingFs()).checkout(priceId, { trial: opts?.trial, eventId: sessionId, portal: opts?.portal }))
  },

  async getEventPasses() {
    return need(await (await billingFs()).eventPasses()).data
  },

  /** @deprecated use getEventPasses */
  async getWeddingPasses() {
    return this.getEventPasses()
  },

  async createPortalSession(portal?: 'iomixo' | 'miolove'): Promise<{ url: string }> {
    return need(await (await billingFs()).portal(portal))
  },

  async getSubscription(): Promise<Subscription | null> {
    return need(await (await billingFs()).subscription()).data
  },

  async getPaymentHistory(limit = 10): Promise<Payment[]> {
    return need(await (await billingFs()).payments(limit)).data
  },
}

// ══════════════════════════════════════════════════════════════
// IOMIXO LIVE HUB
// ══════════════════════════════════════════════════════════════
export type LiveRequestStatus = 'pending' | 'approved' | 'rejected'
export type SessionType = 'standard' | 'party' | 'wedding'
/** What a MIOLOVE album is for; the album's `session_type` stays 'wedding' whatever the occasion. */
export type OccasionType = 'wedding' | 'birthday' | 'baptism' | 'other'
/** MIOLOVE access of an album ('trial' = the free first album); absent for every event created outside the couple flow. */
export type AccessMode = 'trial' | 'activated'
export type PlanTier = 'free' | 'pro' | 'wedding'

/**
 * Guest Visibility — controls which interactive functions guests see/use on
 * the public live page (QR Code). Independent from screen_config (TV view).
 * Premium gating (Advance / Event Pass) still applies on top. When null or a
 * key is undefined, only song requests are visible by default.
 */
export interface GuestConfig {
  requests?: boolean
  photos?: boolean
  dedications?: boolean
  shoe_game?: boolean
  polls?: boolean
  live_booth?: boolean
  music_battle?: boolean
  roulette?: boolean
}

export type VideoLiveCommand = 'play' | 'pause' | 'mute' | 'unmute' | 'restart' | 'stop'
export type VideoLivePlaybackState = 'playing' | 'paused' | 'stopped'
export type StandUpGuessStatus = 'idle' | 'instruction' | 'guessing' | 'reveal' | 'finished'

export interface StandUpGuessRound {
  id: string
  guest_instruction: string
  answer: string
  hint?: string
  enabled: boolean
  order: number
}

export interface StandUpGuessConfig {
  enabled: boolean
  status: StandUpGuessStatus
  current_round_id: string | null
  current_index: number
  rounds: StandUpGuessRound[]
  score: {
    guessed: number
    missed: number
  }
  updated_at: string
}

/**
 * Remote-control state for Video Live. The DJ dashboard is the director: every
 * transport action writes a new `command_id` so the Screen Mode player executes
 * the command exactly once. `volume` (0-100) is applied reactively and does NOT
 * bump `command_id` to avoid replaying the last transport command.
 * `playback_state` reflects the DJ's intended state (playing/paused/stopped) and
 * drives the dashboard Play/Pause button highlight — independent of
 * `show_video_live` (which only controls box visibility).
 */
export interface VideoLiveControl {
  command?: VideoLiveCommand
  command_id?: string
  volume?: number
  playback_state?: VideoLivePlaybackState
  updated_at?: string
}

// ── Wedding Edition: Proclamazione Vincitore (Strumenti finali) ──
// Overlay indipendente sul Wedding Screen usato dal DJ per proclamare
// manualmente il vincitore (sposo/sposa) al termine di una prova. NON è un
// gioco: nessun punteggio, nessuna casualità, nessuna classifica. Le foto
// sono su Firebase Storage (events/{id}/winner/) e qui sono referenziate SOLO
// tramite il loro path.
export type WinnerAnnouncementRole = 'groom' | 'bride'
export type WinnerAnnouncementPhase = 'hidden' | 'running' | 'revealed' | 'stopped'

export interface WinnerAnnouncementConfig {
  /** Stato corrente dell'overlay sullo Screen. `hidden` = nulla renderizzato. */
  phase: WinnerAnnouncementPhase
  /** Cambia SOLO ad ogni pressione di "Avvia proclamazione". Lo Screen usa
   *  `run_id` per riprodurre la suspense una sola volta. */
  run_id: string | null
  /** Scelta manuale del DJ. Mai casuale. */
  winner: WinnerAnnouncementRole | null
  /** Path relativi in Firebase Storage (mai URL). */
  groom_photo_path: string | null
  bride_photo_path: string | null
  /** Nomi opzionali dedicati (per split affidabile). Fallback → couple_names. */
  groom_name: string | null
  bride_name: string | null
  /** ISO. Riferimento temporale per calcolare, lato Screen, se la suspense è
   *  ancora in corso o se mostrare direttamente il reveal (reload safe). */
  started_at: string | null
  updated_at: string
}

export interface LiveSession {
  id: string
  dj_id: string
  event_name: string
  dj_name: string | null
  description: string | null
  is_active: boolean
  public_slug: string
  created_at: string
  updated_at: string
  online_count?: number | null
  session_type?: SessionType
  occasion_type?: OccasionType
  access_mode?: AccessMode
  /** Product the event was created in; absent on events created before the field. */
  brand?: 'iomixo' | 'miolove'
  trial_photo_count?: number
  trial_photo_limit?: number
  poster_config?: Record<string, unknown> | null
  couple_names?: string | null
  wedding_date?: string | null
  venue_name?: string | null
  screen_mode_enabled?: boolean
  roulette_penitenze?: Array<{
    label: string
    category: 'soft' | 'party' | 'wild'
    enabled: boolean
  }> | null
  shoe_game_questions?: string[] | null
  screen_config?: {
    show_photos?: boolean
    show_dedications?: boolean
    show_roulette?: boolean
    show_shoe_game?: boolean
    show_polls?: boolean
    stand_up_guess?: StandUpGuessConfig | null
    show_video_live?: boolean
    video_url?: string
    video_title?: string
    video_live?: VideoLiveControl | null
    winner_announcement?: WinnerAnnouncementConfig | null
    couple_font?: 'cormorant' | 'playfair' | 'great-vibes' | 'dancing' | 'cinzel' | 'tangerine'
    couple_font_size?: 'small' | 'medium' | 'large' | 'xlarge'
  } | null
  guest_config?: GuestConfig | null
}

export interface LiveRequest {
  id: string
  session_id: string
  track_title: string
  artist: string | null
  message: string | null
  status: LiveRequestStatus
  ip_hash: string | null
  created_at: string
  updated_at: string
}

export interface DjProfile {
  id?: string
  user_id?: string
  display_name: string | null
  bio: string | null
  instagram_url: string | null
  tiktok_url: string | null
  spotify_url: string | null
  soundcloud_url: string | null
  website_url: string | null
  avatar_url: string | null
  public_slug: string | null
}

export interface DjEvent {
  id: string
  title: string
  event_date: string | null
  venue_name: string | null
  city: string | null
  ticket_url: string | null
  is_public: boolean
}

export interface PublicLivePayload {
  session: {
    id: string
    event_name: string
    dj_name: string | null
    description: string | null
    is_active: boolean
    session_type: SessionType
    couple_names: string | null
    wedding_date: string | null
    venue_name: string | null
    screen_mode_enabled: boolean
    guest_config: GuestConfig | null
    /** Event owner's account type (brand / portal of the guest pages). null = the server could not read it; absent on an older server. */
    owner_account_type?: 'dj' | 'couple' | null
    /** Couple albums only: 'trial' | 'activated'. */
    access_mode?: 'trial' | 'activated' | null
    /** Product the event was created in (explicit); null/absent on events created before the field. */
    event_brand?: 'iomixo' | 'miolove' | null
  }
  profile: Omit<DjProfile, 'public_slug' | 'id' | 'user_id'> | null
  events: Array<Omit<DjEvent, 'is_public'>>
  plan: PlanTier
  branding: 'none' | 'reduced' | 'full'
  features: {
    weddingDedications: boolean
    weddingGames:       boolean
    livePolls:          boolean
    guestPhotoAlbum:    boolean
    screenMode:         boolean
  }
  requestsRemaining: number | null
}

type SessionPatch = Partial<Pick<LiveSession, 'event_name' | 'dj_name' | 'description' | 'is_active' | 'couple_names' | 'wedding_date' | 'venue_name' | 'screen_mode_enabled' | 'screen_config' | 'guest_config' | 'poster_config' | 'roulette_penitenze' | 'shoe_game_questions'>>

export const live = {
  async listSessions(): Promise<LiveSession[]> {
    return need(await (await dashboard()).listSessions())
  },
  async getSession(id: string): Promise<LiveSession> {
    return need(await (await dashboard()).getSession(id), NOT_FOUND).session
  },
  async createSession(input: {
    event_name: string
    dj_name?: string
    description?: string
    session_type?: SessionType
    couple_names?: string
    wedding_date?: string
    venue_name?: string
    screen_mode_enabled?: boolean
    occasion_type?: OccasionType
    /** Product the owner creates from (the portal). */
    brand?: 'iomixo' | 'miolove'
  }): Promise<LiveSession> {
    return need(await (await owner()).sessions.create(input))
  },
  /** Firestore is authoritative for every field the dashboard edits (winner announcement included: its photos live in Firebase Storage). */
  async updateSession(id: string, patch: SessionPatch): Promise<LiveSession> {
    const o = await owner()
    need(await o.config.event(id), NOT_FOUND)
    const fs: Parameters<typeof o.config.update>[1] = {}
    const dsc = (patch.screen_config ?? null) as Record<string, unknown> | null
    const hasWinner = !!dsc && Object.prototype.hasOwnProperty.call(dsc, 'winner_announcement')
    if ('screen_config' in patch) fs.screen_config = hasWinner ? (({ winner_announcement: _w, ...rest }) => (void _w, rest))(dsc!) : patch.screen_config as any
    if (hasWinner) fs.winner_announcement = (dsc!.winner_announcement ?? null) as Record<string, unknown> | null
    if ('guest_config' in patch) fs.guest_config = patch.guest_config as any
    if ('poster_config' in patch) fs.poster_config = patch.poster_config as any
    if ('screen_mode_enabled' in patch) fs.screen_mode_enabled = patch.screen_mode_enabled
    const mirrorKeys = Object.keys(o.config.MIRRORED_KEYS).concat('is_active')
    const core = Object.fromEntries(Object.entries(patch).filter(([k]) => mirrorKeys.includes(k)))
    if (Object.keys(core).length) fs.mirror = core
    if (Object.keys(fs).length) await o.config.update(id, fs)
    const gameCfg: { roulettePenitenze?: unknown; shoeGameQuestions?: unknown } = {}
    if ('roulette_penitenze' in patch) gameCfg.roulettePenitenze = patch.roulette_penitenze
    if ('shoe_game_questions' in patch) gameCfg.shoeGameQuestions = patch.shoe_game_questions
    if (Object.keys(gameCfg).length) await o.games.setConfig(id, gameCfg)
    return { id } as LiveSession
  },
  async deleteSession(id: string): Promise<void> {
    need(await (await owner()).sessions.remove(id), NOT_FOUND)
  },
  async listRequests(sessionId: string): Promise<LiveRequest[]> {
    return need(await (await owner()).requests.list(sessionId), NOT_FOUND)
  },
  async updateRequest(requestId: string, status: LiveRequestStatus): Promise<LiveRequest> {
    need(await (await owner()).requests.setStatus(requestId, status), 'Richiesta non trovata')
    return { id: requestId, status } as LiveRequest
  },
  async deleteRequest(requestId: string): Promise<void> {
    need(await (await owner()).requests.remove(requestId), 'Richiesta non trovata')
  },
}

export const djProfile = {
  async get(): Promise<DjProfile | null> {
    return need(await (await profile()).getDj()).data
  },
  async update(patch: Partial<DjProfile>): Promise<DjProfile> {
    return need(await (await profile()).updateDj(patch))
  },
  async removeAvatar(): Promise<DjProfile | null> {
    return need(await (await profile()).removeDjAvatar())
  },
  async uploadAvatar(file: File): Promise<DjProfile> {
    return need(await (await profile()).uploadDjAvatar(file))
  },
}

/** DJ upcoming dates (djProfiles/{uid}/dates); the public ones reach guests through getPublicEvent. */
export const djEvents = {
  async list(): Promise<DjEvent[]> { return (await import('./events/djDateService')).djDates.list() },
  async create(input: Partial<DjEvent>): Promise<DjEvent> { return (await import('./events/djDateService')).djDates.create(input) },
  async update(id: string, patch: Partial<DjEvent>): Promise<DjEvent> { return (await import('./events/djDateService')).djDates.update(id, patch) },
  async remove(id: string): Promise<void> { return (await import('./events/djDateService')).djDates.remove(id) },
}

// ══════════════════════════════════════════════════════════════
// WEDDING EDITION
// ══════════════════════════════════════════════════════════════

export interface LiveDedication {
  id: string
  session_id?: string
  guest_name: string | null
  message: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

export interface LivePoll {
  id: string
  session_id?: string
  question: string
  options: string[]
  is_active: boolean
  tally?: number[]
  created_at: string
}

export interface LiveGameRound {
  id: string
  game_type: 'wedding_roulette' | 'shoe_game' | string
  status: 'idle' | 'running' | 'completed'
  config: { slots?: string[]; questions?: string[]; current_index?: number; is_active?: boolean } | null
  result: { slot_index?: number; slot_label?: string; picked_at?: string; finished_at?: string; total?: number } | null
  created_at: string
  updated_at: string
}

export interface LivePhoto {
  id: string
  guest_name: string | null
  caption: string | null
  status?: 'pending' | 'approved' | 'rejected'
  url: string | null
  votes?: number
  is_featured?: boolean
  source?: 'guest_upload' | 'live_booth' | string
  created_at: string
}

export const liveDedications = {
  async listForDj(sessionId: string): Promise<LiveDedication[]> {
    return need(await (await owner()).dedications.list(sessionId), NOT_FOUND)
  },
  async setStatus(id: string, status: 'pending' | 'approved' | 'rejected'): Promise<LiveDedication> {
    need(await (await owner()).dedications.setStatus(id, status), 'Dedica non trovata')
    return { id, status } as LiveDedication
  },
  async remove(id: string): Promise<void> {
    need(await (await owner()).dedications.remove(id), 'Dedica non trovata')
  },
}

export const liveGames = {
  async startRoulette(sessionId: string, categories?: string[]): Promise<LiveGameRound> {
    const r = need(await (await owner()).games.act(sessionId, 'roulette', 'start', categories ? { categories } : {}), NOT_FOUND)
    return need(r.round, 'Nessun gioco attivo. Avvia il gioco.')
  },
  async spinRoulette(sessionId: string): Promise<LiveGameRound> {
    const r = need(await (await owner()).games.act(sessionId, 'roulette', 'spin'), NOT_FOUND)
    return need(r.round, 'Nessun gioco attivo. Avvia il gioco.')
  },
  async resetRoulette(sessionId: string): Promise<void> {
    need(await (await owner()).games.act(sessionId, 'roulette', 'reset'), NOT_FOUND)
  },
  /** DJ-side current roulette round (Firestore). */
  async getRouletteState(sessionId: string, _slug?: string): Promise<LiveGameRound | null> {
    return need(await (await owner()).games.latest(sessionId, 'roulette'), NOT_FOUND).round
  },

  // Gioco della Scarpa
  async getShoeState(sessionId: string): Promise<LiveGameRound | null> {
    return need(await (await owner()).games.latest(sessionId, 'shoe'), NOT_FOUND).round
  },
  async startShoe(sessionId: string, questions?: string[]): Promise<LiveGameRound> {
    const r = need(await (await owner()).games.act(sessionId, 'shoe', 'start', questions ? { questions } : {}), NOT_FOUND)
    return need(r.round, 'Nessun gioco attivo. Avvia il gioco.')
  },
  async nextShoe(sessionId: string): Promise<LiveGameRound> {
    const r = need(await (await owner()).games.act(sessionId, 'shoe', 'next'), NOT_FOUND)
    return need(r.round, 'Nessun gioco attivo. Avvia il gioco.')
  },
  async resetShoe(sessionId: string): Promise<void> {
    need(await (await owner()).games.act(sessionId, 'shoe', 'reset'), NOT_FOUND)
  },
}

export const livePolls = {
  async list(sessionId: string): Promise<LivePoll[]> {
    return need(await (await owner()).polls.list(sessionId), NOT_FOUND)
  },
  async create(sessionId: string, body: { question: string; options: string[] }): Promise<LivePoll> {
    return need(await (await owner()).polls.create(sessionId, body), NOT_FOUND)
  },
  async setActive(id: string, isActive: boolean): Promise<LivePoll> {
    need(await (await owner()).polls.setActive(id, isActive), 'Sondaggio non trovato')
    return { id, is_active: isActive } as LivePoll
  },
}

export const livePhotos = {
  async listForDj(sessionId: string): Promise<LivePhoto[]> {
    return need(await (await owner()).photos.list(sessionId), NOT_FOUND)
  },
  async listBoothPhotos(sessionId: string): Promise<LivePhoto[]> {
    return need(await (await owner()).photos.list(sessionId, true), NOT_FOUND)
  },
  async setStatus(id: string, status: 'pending' | 'approved' | 'rejected'): Promise<LivePhoto> {
    need(await (await owner()).photos.moderate(id, { action: 'set_status', status }), 'Foto non trovata')
    return { id, status } as LivePhoto
  },
  async setFeatured(id: string, is_featured: boolean): Promise<LivePhoto> {
    need(await (await owner()).photos.moderate(id, { action: 'set_featured', isFeatured: is_featured }), 'Foto non trovata')
    return { id, is_featured } as LivePhoto
  },
  async approve(id: string): Promise<LivePhoto> {
    need(await (await owner()).photos.moderate(id, { action: 'set_status', status: 'approved' }), 'Foto non trovata')
    return { id, status: 'approved' } as LivePhoto
  },
  async remove(id: string): Promise<void> {
    need(await (await owner()).photos.moderate(id, { action: 'delete' }), 'Foto non trovata')
  },
  // Guest album: createPhotoUpload → Storage → finalizePhoto
  async publicUpload(slug: string, file: File, meta: { guest_name?: string; caption?: string }, onProgress?: (pct: number) => void): Promise<{ id: string }> {
    return need(await (await photoGuest()).uploadGuestPhoto(slug, file, meta, 'guest_upload', onProgress), NOT_FOUND)
  },
  // Live Booth: same flow, different source
  async boothUpload(slug: string, file: File, meta: { guest_name?: string; caption?: string }, onProgress?: (pct: number) => void): Promise<{ id: string }> {
    return need(await (await photoGuest()).uploadGuestPhoto(slug, file, meta, 'live_booth', onProgress), NOT_FOUND)
  },
  warmUpload(slug: string): void {
    void photoGuest().then((m) => m.warmGuestPhotoUpload(slug)).catch(() => {})
  },
  async publicListApproved(slug: string): Promise<LivePhoto[]> {
    return need(await (await photoGuest()).listApprovedForGuest(slug), NOT_FOUND)
  },
  // Wedding · Proclamazione Vincitore: Storage direct under events/{id}/winner/, rules = owner only. NOT in the album nor Live Booth.
  // The path is then saved by the DJ in `screen_config.winner_announcement`.
  async winnerUploadPhoto(slug: string, file: File, role: 'groom' | 'bride' = 'groom'): Promise<{ storage_path: string }> {
    return need(await (await owner()).photos.uploadWinnerPhoto(slug, file, role), NOT_FOUND)
  },
  /** Preview URLs of the stored winner photos (Firebase Storage). */
  async winnerPreviewUrls(_slug: string, cfg: { groom_photo_path?: string | null; bride_photo_path?: string | null }): Promise<{ groom: string | null; bride: string | null }> {
    return need(await (await owner()).photos.winnerUrls(cfg))
  },
}

export interface ScreenPayload {
  session: {
    event_name: string
    dj_name: string | null
    session_type?: SessionType
    couple_names: string | null
    wedding_date: string | null
    venue_name: string | null
    is_active: boolean
    screen_config?: {
      show_photos?: boolean
      show_dedications?: boolean
      show_roulette?: boolean
      show_shoe_game?: boolean
      show_polls?: boolean
      stand_up_guess?: StandUpGuessConfig | null
      show_video_live?: boolean
      video_url?: string
      video_title?: string
      video_live?: VideoLiveControl | null
      /** Arricchito con `groom_photo_url` e `bride_photo_url` (URL Storage)
       *  accanto ai path se `winner_announcement` è presente. */
      winner_announcement?: (WinnerAnnouncementConfig & {
        groom_photo_url?: string | null
        bride_photo_url?: string | null
      }) | null
      live_booth_layout?: 'single' | 'grid' | 'auto'
      couple_font?: 'cormorant' | 'playfair' | 'great-vibes' | 'dancing' | 'cinzel' | 'tangerine'
      couple_font_size?: 'small' | 'medium' | 'large' | 'xlarge'
    } | null
  }
  roulette: LiveGameRound | null
  shoe_game: LiveGameRound | null
  active_poll: LivePoll | null
  dedications: LiveDedication[]
  photos: LivePhoto[]
}
