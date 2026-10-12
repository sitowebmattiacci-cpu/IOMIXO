import axios, { AxiosError, type AxiosInstance } from 'axios'
import { getAuthToken, signOut } from '@/lib/auth'
import { ownerCallablesFlag, dashboardFlag, publicReadFlag } from '@/lib/events/flags'
import type {
  User, Subscription, Payment,
  ApiResponse,
} from '@/types'

// ── Singleton API client ──────────────────────────────────────
let _client: AxiosInstance | null = null

function getClient(): AxiosInstance {
  if (_client) return _client
  _client = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json' },
  })

  // Attach the auth token (Firebase ID token; legacy Supabase JWT as fallback) on every request
  _client.interceptors.request.use(async (cfg) => {
    if (typeof window !== 'undefined') {
      const token = await getAuthToken()
      if (token) cfg.headers.Authorization = `Bearer ${token}`
    }
    return cfg
  })

  // Redirect to login on 401
  _client.interceptors.response.use(
    (res) => res,
    async (err: AxiosError) => {
      if (err.response?.status === 401 && typeof window !== 'undefined' && !(err.config as { skipAuthRedirect?: boolean } | undefined)?.skipAuthRedirect) {
        window.location.href = '/login'
      }
      return Promise.reject(err)
    }
  )

  return _client
}

// ── Helper ────────────────────────────────────────────────────
function apiError(err: unknown): never {
  if (axios.isAxiosError(err)) {
    const msg = (err.response?.data as { error?: string })?.error ?? err.message
    throw new Error(msg)
  }
  throw err
}

// ══════════════════════════════════════════════════════════════
// AUTH — compatibility shim (wraps Supabase + /user/me endpoint)
// ══════════════════════════════════════════════════════════════

/**
 * Dashboard READ path served by Firestore (sessions, user plan, Event Passes) when NEXT_PUBLIC_FIRESTORE_DASHBOARD=on|true;
 * null → not applicable, the legacy Express route is used. Dynamic import: nothing Firebase-related loads while the switch is off.
 */
const dashboard = async () => (dashboardFlag() ? (await import('./events/dashboardService')).dashboardOps : null)

export const auth = {
  /** Returns the full user row from the database. */
  async me(): Promise<User> {
    const fs = await dashboard().then((d) => d?.me()); if (fs) return fs
    try {
      const { data } = await getClient().get<ApiResponse<User>>('/user/me')
      return data.data!
    } catch (e) { apiError(e) }
  },

  /** Sign out of the active auth provider. */
  async logout(): Promise<void> {
    await signOut()
  },
}

// ══════════════════════════════════════════════════════════════
// LEGACY REMOVED — tracks / projects / soundbank / samples / ai / jobs
// were part of the old MashFusion AI Studio (workstation, render queue,
// soundbank, AI generators). Removed during IOMIXO Live Hub focus cleanup.
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// USER — Credits + Profile
// ══════════════════════════════════════════════════════════════
export const user = {
  async getCredits(): Promise<{ remaining: number; plan: string; resets_at: string | null }> {
    try {
      const { data } = await getClient().get<{ remaining: number; plan: string; resets_at: string | null }>('/user/credits')
      return data
    } catch (e) { apiError(e) }
  },

  async updateProfile(payload: { full_name?: string; avatar_url?: string }): Promise<User> {
    try {
      const { data } = await getClient().patch<ApiResponse<User>>('/user/profile', payload)
      return data.data!
    } catch (e) { apiError(e) }
  },

  async uploadAvatar(file: File): Promise<User> {
    try {
      const form = new FormData()
      form.append('avatar', file)
      const { data } = await getClient().put<ApiResponse<User>>('/user/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return data.data!
    } catch (e) { apiError(e) }
  },
}

// ══════════════════════════════════════════════════════════════
// BILLING — Stripe
// ══════════════════════════════════════════════════════════════
export const billing = {
  async createCheckoutSession(priceId: string, mode: 'subscription' | 'payment' = 'subscription', sessionId?: string, opts?: { trial?: boolean; plan?: string }): Promise<{ url: string }> {
    try {
      const payload: any = {
        price_id: priceId,
        success_url: `${window.location.origin}/dashboard?upgraded=true`,
        cancel_url:  `${window.location.origin}/billing`,
        mode,
      }
      if (sessionId) payload.session_id = sessionId
      if (opts?.trial) payload.trial = true
      if (opts?.plan) payload.plan = opts.plan
      const { data } = await getClient().post<{ url: string }>('/stripe/create-checkout', payload)
      return data
    } catch (e) { apiError(e) }
  },

  async getEventPasses() {
    const fs = await dashboard().then((d) => d?.eventPasses()); if (fs) return fs
    try {
      const { data } = await getClient().get<ApiResponse<any[]>>('/stripe/event-passes')
      return data.data ?? []
    } catch (e) { apiError(e) }
  },

  /** @deprecated use getEventPasses */
  async getWeddingPasses() {
    return this.getEventPasses()
  },

  async createPortalSession(): Promise<{ url: string }> {
    try {
      const { data } = await getClient().post<{ url: string }>('/stripe/create-portal', {
        return_url: `${window.location.origin}/billing`,
      })
      return data
    } catch (e) { apiError(e) }
  },

  async getSubscription(): Promise<Subscription | null> {
    try {
      const { data } = await getClient().get<ApiResponse<Subscription | null>>('/stripe/subscription')
      return data.data
    } catch (e) { apiError(e) }
  },

  async getPaymentHistory(limit = 10): Promise<Payment[]> {
    try {
      const { data } = await getClient().get<ApiResponse<Payment[]>>('/stripe/payments', {
        params: { limit },
      })
      return data.data!
    } catch (e) { apiError(e) }
  },
}

// ══════════════════════════════════════════════════════════════
// IOMIXO LIVE HUB
// ══════════════════════════════════════════════════════════════
export type LiveRequestStatus = 'pending' | 'approved' | 'rejected'
export type SessionType = 'standard' | 'party' | 'wedding'
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
// vengono caricate nel bucket privato `wedding-photos` con il flusso già
// esistente (`/photos/init` + PUT signed URL) e qui sono referenziate SOLO
// tramite `storage_path`. Il payload pubblico dello Screen (`/screen/:slug`)
// rigenera le signed URLs a ogni chiamata.
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
  /** Path relativi nel bucket privato `wedding-photos` (mai URL: le signed
   *  URLs scadono e vengono rigenerate dal backend a ogni /screen/:slug). */
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

/**
 * DJ operations served by Firestore (owner callables) for events already migrated; null/false = not applicable → legacy Express route.
 * Off unless NEXT_PUBLIC_FIRESTORE_OWNER_OPS=on|true. Dynamic import: nothing Firebase-related is loaded while the switch is off.
 */
const owner = async () => (ownerCallablesFlag() ? (await import('./events/ownerService')).ownerOps : null)

async function legacyUpdateSession(id: string, patch: Partial<Pick<LiveSession, 'event_name' | 'dj_name' | 'description' | 'is_active' | 'couple_names' | 'wedding_date' | 'venue_name' | 'screen_mode_enabled' | 'screen_config' | 'guest_config' | 'roulette_penitenze' | 'shoe_game_questions'>>): Promise<LiveSession> {
  try {
    const { data } = await getClient().patch<{ data: LiveSession }>(`/api/live/sessions/${id}`, patch)
    return data.data
  } catch (e) { apiError(e) }
}

export const live = {
  async listSessions(): Promise<LiveSession[]> {
    const d = await dashboard()
    const fs = d ? await d.listSessions() : null
    if (fs) return fs                // Firestore has events for this owner (possibly none visible): it is the source, Render is not asked
    try {
      const { data } = await getClient().get<{ data: LiveSession[] }>('/api/live/sessions')
      return data.data
    } catch (e) {
      if (d) return []           // dashboard on, nothing in Firestore and Render unreachable: an empty list, not an error screen
      apiError(e)
    }
  },
  async getSession(id: string): Promise<LiveSession> {
    // Dashboard on: Firestore is the source (event + owner-private games config). Render is asked ONLY for the live presence count
    // (in-memory on Render), best effort with a short timeout, and only for events that still have a Supabase row.
    const fs = await dashboard().then((d) => d?.getSession(id))
    if (fs) {
      if (!fs.hasLegacy) return fs.session
      try {
        const { data } = await getClient().get<{ data: LiveSession }>(`/api/live/sessions/${id}`, { timeout: 2_500, skipAuthRedirect: true } as object)
        return { ...fs.session, online_count: data.data.online_count }
      } catch { return fs.session }
    }
    let session: LiveSession
    try {
      const { data } = await getClient().get<{ data: LiveSession }>(`/api/live/sessions/${id}`)
      session = data.data
    } catch (e) { apiError(e) }
    // Event config is authoritative in Firestore for migrated events: show what updateSession saved there.
    const o = await owner(); return o ? o.config.overlay(id, session) : session
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
  }): Promise<LiveSession> {
    const fs = await owner().then((o) => o?.sessions.create(input)); if (fs) return fs
    try {
      const { data } = await getClient().post<{ data: LiveSession }>('/api/live/sessions', input)
      return data.data
    } catch (e) { apiError(e) }
  },
  /**
   * Field ownership while the cutover is partial (NEXT_PUBLIC_FIRESTORE_OWNER_OPS):
   *  - CONFIG (screen_config, guest_config, screen_mode_enabled) → Firestore only, via the updateEventConfig callable. Never written to Supabase.
   *  - LEGACY (event_name, dj_name, description, is_active, couple_*, wedding_date, venue_name, roulette_penitenze, shoe_game_questions) → Render/Supabase
   *    first (authoritative), then the simple event fields are MIRRORED to Firestore so guests/TV see them. If the legacy write fails nothing else happens.
   *  - Winner announcement (screen_config.winner_announcement): the legacy route validates/saves the photos, so the whole patch goes there; the winner
   *    object is then mirrored to Firestore as a SIGNAL (the TV falls back to the legacy payload while a winner exists).
   * Sessions that are not in Firestore (or with the switch off) keep the old single legacy PATCH.
   */
  async updateSession(id: string, patch: Partial<Pick<LiveSession, 'event_name' | 'dj_name' | 'description' | 'is_active' | 'couple_names' | 'wedding_date' | 'venue_name' | 'screen_mode_enabled' | 'screen_config' | 'guest_config' | 'roulette_penitenze' | 'shoe_game_questions'>>): Promise<LiveSession> {
    const o = await owner()
    const ev = o ? await o.config.event(id) : null
    if (!o || !ev) return legacyUpdateSession(id, patch)

    // Dashboard switch: Firestore is authoritative for EVERY field the dashboard edits, the winner announcement included (its photos live in
    // Firebase Storage). Nothing is written to Supabase.
    if (dashboardFlag()) {
      const fs: Parameters<typeof o.config.update>[1] = {}
      const dsc = (patch.screen_config ?? null) as Record<string, unknown> | null
      const dashWinner = !!dsc && Object.prototype.hasOwnProperty.call(dsc, 'winner_announcement')
      // The winner announcement is its own field in Firestore (paths validated, replaced photos deleted by updateEventConfig).
      if ('screen_config' in patch) fs.screen_config = dashWinner ? (({ winner_announcement: _w, ...rest }) => (void _w, rest))(dsc!) : patch.screen_config as any
      if (dashWinner) fs.winner_announcement = (dsc!.winner_announcement ?? null) as Record<string, unknown> | null
      if ('guest_config' in patch) fs.guest_config = patch.guest_config as any
      if ('screen_mode_enabled' in patch) fs.screen_mode_enabled = patch.screen_mode_enabled
      const core = Object.fromEntries(Object.entries(patch).filter(([k]) => Object.keys(o.config.MIRRORED_KEYS).concat('is_active').includes(k)))
      if (Object.keys(core).length) fs.mirror = core
      if (Object.keys(fs).length) await o.config.update(id, fs)
      const gameCfg: { roulettePenitenze?: unknown; shoeGameQuestions?: unknown } = {}
      if ('roulette_penitenze' in patch) gameCfg.roulettePenitenze = patch.roulette_penitenze
      if ('shoe_game_questions' in patch) gameCfg.shoeGameQuestions = patch.shoe_game_questions
      if (Object.keys(gameCfg).length) await o.games.setConfig(id, gameCfg)
      return { id } as LiveSession
    }

    const cfgKeys = o.config.CONFIG_KEYS as readonly string[], mirrorKeys = Object.keys(o.config.MIRRORED_KEYS).concat('is_active')
    const sc = (patch.screen_config ?? null) as Record<string, unknown> | null
    const hasWinner = !!sc && Object.prototype.hasOwnProperty.call(sc, 'winner_announcement')
    const legacyPatch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) if (!cfgKeys.includes(k) || (hasWinner && cfgKeys.includes(k))) legacyPatch[k] = v
    let result = { id } as LiveSession
    if (Object.keys(legacyPatch).length) result = await legacyUpdateSession(id, legacyPatch as typeof patch)

    const fs: Parameters<typeof o.config.update>[1] = {}
    if ('screen_config' in patch) fs.screen_config = hasWinner ? (({ winner_announcement: _w, ...rest }) => (void _w, rest))(sc!) : patch.screen_config as any
    if ('guest_config' in patch) fs.guest_config = patch.guest_config as any
    if ('screen_mode_enabled' in patch) fs.screen_mode_enabled = patch.screen_mode_enabled
    if (hasWinner) fs.winner_announcement = (sc!.winner_announcement ?? null) as Record<string, unknown> | null
    const mirror = Object.fromEntries(Object.entries(patch).filter(([k]) => mirrorKeys.includes(k)))
    if (Object.keys(mirror).length) fs.mirror = mirror
    if (Object.keys(fs).length) {
      try { await o.config.update(id, fs) }
      catch (e) { throw new Error(Object.keys(legacyPatch).length ? 'Salvato, ma la sincronizzazione con lo schermo non è riuscita. Riprova.' : (e as Error).message) }
    }
    return result
  },
  async deleteSession(id: string): Promise<void> {
    if (await owner().then((o) => o?.sessions.remove(id))) return        // soft delete in Firestore (dashboard switch)
    try { await getClient().delete(`/api/live/sessions/${id}`) } catch (e) { apiError(e) }
  },
  async listRequests(sessionId: string): Promise<LiveRequest[]> {
    const fs = await owner().then((o) => o?.requests.list(sessionId)); if (fs) return fs
    try {
      const { data } = await getClient().get<{ data: LiveRequest[] }>(`/api/live/sessions/${sessionId}/requests`)
      return data.data
    } catch (e) { apiError(e) }
  },
  async updateRequest(requestId: string, status: LiveRequestStatus): Promise<LiveRequest> {
    if (await owner().then((o) => o?.requests.setStatus(requestId, status))) return { id: requestId, status } as LiveRequest
    try {
      const { data } = await getClient().patch<{ data: LiveRequest }>(`/api/live/requests/${requestId}`, { status })
      return data.data
    } catch (e) { apiError(e) }
  },
  async deleteRequest(requestId: string): Promise<void> {
    if (await owner().then((o) => o?.requests.remove(requestId))) return
    try { await getClient().delete(`/api/live/requests/${requestId}`) } catch (e) { apiError(e) }
  },
}

export const djProfile = {
  async get(): Promise<DjProfile | null> {
    try {
      const { data } = await getClient().get<{ data: DjProfile | null }>('/api/dj/profile')
      return data.data
    } catch (e) { apiError(e) }
  },
  async update(patch: Partial<DjProfile>): Promise<DjProfile> {
    try {
      const { data } = await getClient().patch<{ data: DjProfile }>('/api/dj/profile', patch)
      return data.data
    } catch (e) { apiError(e) }
  },
  async uploadAvatar(file: File): Promise<DjProfile> {
    try {
      const fd = new FormData()
      fd.append('avatar', file)
      const { data } = await getClient().put<{ data: DjProfile }>('/api/dj/profile/avatar', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return data.data
    } catch (e) { apiError(e) }
  },
}

export const djEvents = {
  async list(): Promise<DjEvent[]> {
    try {
      const { data } = await getClient().get<{ data: DjEvent[] }>('/api/dj/events')
      return data.data
    } catch (e) { apiError(e) }
  },
  async create(input: Partial<DjEvent>): Promise<DjEvent> {
    try {
      const { data } = await getClient().post<{ data: DjEvent }>('/api/dj/events', input)
      return data.data
    } catch (e) { apiError(e) }
  },
  async update(id: string, patch: Partial<DjEvent>): Promise<DjEvent> {
    try {
      const { data } = await getClient().patch<{ data: DjEvent }>(`/api/dj/events/${id}`, patch)
      return data.data
    } catch (e) { apiError(e) }
  },
  async remove(id: string): Promise<void> {
    try { await getClient().delete(`/api/dj/events/${id}`) } catch (e) { apiError(e) }
  },
}

/** Public endpoint — no auth header needed; backend allows anonymous. */
export const publicLive = {
  async get(slug: string): Promise<PublicLivePayload> {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
    const res = await fetch(`${base}/api/live/public/${slug}`, { cache: 'no-store' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error ?? `HTTP ${res.status}`)
    }
    const json = await res.json()
    return json.data
  },
  async submitRequest(slug: string, input: { track_title: string; artist?: string; message?: string }): Promise<{ id: string; track_title: string; artist: string | null; status: LiveRequestStatus; created_at: string }> {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
    const res = await fetch(`${base}/api/live/public/${slug}/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error ?? `HTTP ${res.status}`)
    }
    const json = await res.json()
    return json.data
  },
  async myRequests(slug: string, ids: string[]): Promise<Array<{ id: string; track_title: string; artist: string | null; status: LiveRequestStatus; created_at: string }>> {
    if (ids.length === 0) return []
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
    const res = await fetch(`${base}/api/live/public/${slug}/my-requests?ids=${encodeURIComponent(ids.join(','))}`, { cache: 'no-store' })
    if (!res.ok) return []
    const json = await res.json()
    return json.data ?? []
  },
  async heartbeat(slug: string): Promise<void> {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
    try {
      await fetch(`${base}/api/live/public/${slug}/heartbeat`, { method: 'POST', keepalive: true })
    } catch { /* ignore */ }
  },
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

export interface LiveFutureMessage {
  id: string
  session_id?: string
  guest_name: string | null
  message: string
  delivery_year: string | null
  is_selected: boolean
  created_at: string
}

const API_BASE = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

/** Stable per-device id (anti-spam only): isolates each guest even when many
 *  share the same venue WiFi / same phone model. Stored in localStorage. */
function deviceId(): string {
  if (typeof window === 'undefined') return ''
  try {
    let id = window.localStorage.getItem('iomixo_device_id')
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
      window.localStorage.setItem('iomixo_device_id', id)
    }
    return id
  } catch {
    return ''
  }
}

async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE()}${path}`, { cache: 'no-store' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? `HTTP ${res.status}`)
  }
  return (await res.json()).data
}
async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-IOMIXO-Device': deviceId() },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j?.error ?? `HTTP ${res.status}`)
  }
  return (await res.json()).data
}

export const liveDedications = {
  async listForDj(sessionId: string): Promise<LiveDedication[]> {
    const fs = await owner().then((o) => o?.dedications.list(sessionId)); if (fs) return fs
    try {
      const { data } = await getClient().get<{ data: LiveDedication[] }>(`/api/live/sessions/${sessionId}/dedications`)
      return data.data
    } catch (e) { apiError(e) }
  },
  async setStatus(id: string, status: 'pending' | 'approved' | 'rejected'): Promise<LiveDedication> {
    if (await owner().then((o) => o?.dedications.setStatus(id, status))) return { id, status } as LiveDedication
    try {
      const { data } = await getClient().patch<{ data: LiveDedication }>(`/api/live/dedications/${id}`, { status })
      return data.data
    } catch (e) { apiError(e) }
  },
  async remove(id: string): Promise<void> {
    if (await owner().then((o) => o?.dedications.remove(id))) return
    try { await getClient().delete(`/api/live/dedications/${id}`) } catch (e) { apiError(e) }
  },
  // public
  submit:  (slug: string, body: { guest_name?: string; message: string }) =>
    publicPost<{ id: string; status: string }>(`/api/live/public/${slug}/dedications`, body),
  listApproved: (slug: string) =>
    publicGet<LiveDedication[]>(`/api/live/public/${slug}/dedications`),
}

export const liveGames = {
  async startRoulette(sessionId: string, categories?: string[]): Promise<LiveGameRound> {
    const fs = await owner().then((o) => o?.games.act(sessionId, 'roulette', 'start', categories ? { categories } : {})); if (fs?.round) return fs.round
    try {
      const { data } = await getClient().post<{ data: LiveGameRound }>(
        `/api/live/sessions/${sessionId}/games/roulette/start`,
        categories ? { categories } : {},
      )
      return data.data
    } catch (e) { apiError(e) }
  },
  async spinRoulette(sessionId: string): Promise<LiveGameRound> {
    const fs = await owner().then((o) => o?.games.act(sessionId, 'roulette', 'spin')); if (fs?.round) return fs.round
    try {
      const { data } = await getClient().post<{ data: LiveGameRound }>(
        `/api/live/sessions/${sessionId}/games/roulette/spin`, {})
      return data.data
    } catch (e) { apiError(e) }
  },
  async resetRoulette(sessionId: string): Promise<void> {
    if (await owner().then((o) => o?.games.act(sessionId, 'roulette', 'reset'))) return
    try { await getClient().post(`/api/live/sessions/${sessionId}/games/roulette/reset`, {}) }
    catch (e) { apiError(e) }
  },
  publicLatest: (slug: string) =>
    publicGet<{ roulette: LiveGameRound | null; shoeGame: LiveGameRound | null }>(`/api/live/public/${slug}/games`),
  /** DJ-side current roulette round: Firestore for dashboard events, the public legacy payload otherwise. */
  async getRouletteState(sessionId: string, slug: string): Promise<LiveGameRound | null> {
    const fs = await owner().then((o) => o?.games.latest(sessionId, 'roulette')); if (fs) return fs.round
    return liveGames.publicLatest(slug).then((d) => d.roulette).catch(() => null)
  },

  // Gioco della Scarpa
  async getShoeState(sessionId: string): Promise<LiveGameRound | null> {
    const fs = await owner().then((o) => o?.games.latest(sessionId, 'shoe')); if (fs) return fs.round
    try {
      const { data } = await getClient().get<{ data: LiveGameRound | null }>(
        `/api/live/sessions/${sessionId}/games/shoe/state`)
      return data.data
    } catch (e) { apiError(e) }
  },
  async startShoe(sessionId: string, questions?: string[]): Promise<LiveGameRound> {
    const fs = await owner().then((o) => o?.games.act(sessionId, 'shoe', 'start', questions ? { questions } : {})); if (fs?.round) return fs.round
    try {
      const { data } = await getClient().post<{ data: LiveGameRound }>(
        `/api/live/sessions/${sessionId}/games/shoe/start`,
        questions ? { questions } : {},
      )
      return data.data
    } catch (e) { apiError(e) }
  },
  async nextShoe(sessionId: string): Promise<LiveGameRound> {
    const fs = await owner().then((o) => o?.games.act(sessionId, 'shoe', 'next')); if (fs?.round) return fs.round
    try {
      const { data } = await getClient().post<{ data: LiveGameRound }>(
        `/api/live/sessions/${sessionId}/games/shoe/next`, {})
      return data.data
    } catch (e) { apiError(e) }
  },
  async resetShoe(sessionId: string): Promise<void> {
    if (await owner().then((o) => o?.games.act(sessionId, 'shoe', 'reset'))) return
    try { await getClient().post(`/api/live/sessions/${sessionId}/games/shoe/reset`, {}) }
    catch (e) { apiError(e) }
  },
}

export const livePolls = {
  async list(sessionId: string): Promise<LivePoll[]> {
    const fs = await owner().then((o) => o?.polls.list(sessionId)); if (fs) return fs
    try {
      const { data } = await getClient().get<{ data: LivePoll[] }>(`/api/live/sessions/${sessionId}/polls`)
      return data.data
    } catch (e) { apiError(e) }
  },
  async create(sessionId: string, body: { question: string; options: string[] }): Promise<LivePoll> {
    const fs = await owner().then((o) => o?.polls.create(sessionId, body)); if (fs) return fs
    try {
      const { data } = await getClient().post<{ data: LivePoll }>(`/api/live/sessions/${sessionId}/polls`, body)
      return data.data
    } catch (e) { apiError(e) }
  },
  async setActive(id: string, isActive: boolean): Promise<LivePoll> {
    if (await owner().then((o) => o?.polls.setActive(id, isActive))) return { id, is_active: isActive } as LivePoll
    try {
      const { data } = await getClient().patch<{ data: LivePoll }>(`/api/live/polls/${id}`, { is_active: isActive })
      return data.data
    } catch (e) { apiError(e) }
  },
  publicActive: (slug: string) =>
    publicGet<LivePoll | null>(`/api/live/public/${slug}/polls/active`),
  publicVote: (slug: string, pollId: string, optionIndex: number) =>
    publicPost<{ ok: boolean }>(`/api/live/public/${slug}/polls/${pollId}/vote`, { option_index: optionIndex }),
}

/** Guest-side photos on Firebase (callables + Storage) when NEXT_PUBLIC_FIRESTORE_PUBLIC_READ=on|true; null/undefined → legacy routes. Dynamic import. */
const photoGuest = async () => (publicReadFlag() ? await import('./events/photoService') : null)

export const livePhotos = {
  async listForDj(sessionId: string): Promise<LivePhoto[]> {
    const fs = await owner().then((o) => o?.photos.list(sessionId)); if (fs) return fs
    try {
      const { data } = await getClient().get<{ data: LivePhoto[] }>(`/api/live/sessions/${sessionId}/photos`)
      return data.data
    } catch (e) { apiError(e) }
  },
  async listBoothPhotos(sessionId: string): Promise<LivePhoto[]> {
    const fs = await owner().then((o) => o?.photos.list(sessionId, true)); if (fs) return fs
    try {
      const { data } = await getClient().get<{ data: LivePhoto[] }>(`/api/live/sessions/${sessionId}/booth/photos`)
      return data.data
    } catch (e) { apiError(e) }
  },
  async setStatus(id: string, status: 'pending' | 'approved' | 'rejected'): Promise<LivePhoto> {
    if (await owner().then((o) => o?.photos.moderate(id, { action: 'set_status', status }))) return { id, status } as LivePhoto
    try {
      const { data } = await getClient().patch<{ data: LivePhoto }>(`/api/live/photos/${id}`, { status })
      return data.data
    } catch (e) { apiError(e) }
  },
  async setFeatured(id: string, is_featured: boolean): Promise<LivePhoto> {
    if (await owner().then((o) => o?.photos.moderate(id, { action: 'set_featured', isFeatured: is_featured }))) return { id, is_featured } as LivePhoto
    try {
      const { data } = await getClient().patch<{ data: LivePhoto }>(`/api/live/photos/${id}/feature`, { is_featured })
      return data.data
    } catch (e) { apiError(e) }
  },
  async approve(id: string): Promise<LivePhoto> {
    if (await owner().then((o) => o?.photos.moderate(id, { action: 'set_status', status: 'approved' }))) return { id, status: 'approved' } as LivePhoto
    try {
      const { data } = await getClient().patch<{ data: LivePhoto }>(`/api/live/photos/${id}/approve`, {})
      return data.data
    } catch (e) { apiError(e) }
  },
  async remove(id: string): Promise<void> {
    if (await owner().then((o) => o?.photos.moderate(id, { action: 'delete' }))) return
    try { await getClient().delete(`/api/live/photos/${id}`) } catch (e) { apiError(e) }
  },
  // public 2-step upload (guest album): Firebase = createPhotoUpload → Storage → finalizePhoto; legacy = signed URL on Supabase
  async publicUpload(slug: string, file: File, meta: { guest_name?: string; caption?: string }): Promise<{ id: string }> {
    const fs = await photoGuest().then((g) => g?.uploadGuestPhoto(slug, file, meta, 'guest_upload')); if (fs) return fs
    const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase()
    const init = await publicPost<{ upload_url: string; storage_path: string }>(
      `/api/live/public/${slug}/photos/init`, { ext, size: file.size },
    )
    await fetch(init.upload_url, { method: 'PUT', headers: { 'Content-Type': file.type || 'image/jpeg' }, body: file })
    return publicPost<{ id: string }>(`/api/live/public/${slug}/photos`, {
      storage_path: init.storage_path,
      guest_name:   meta.guest_name,
      caption:      meta.caption,
    })
  },
  // Live Booth: single-step upload
  async boothUpload(slug: string, file: File, meta: { guest_name?: string; caption?: string }): Promise<{ id: string }> {
    const fs = await photoGuest().then((g) => g?.uploadGuestPhoto(slug, file, meta, 'live_booth')); if (fs) return fs
    const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase()
    const init = await publicPost<{ upload_url: string; storage_path: string }>(
      `/api/live/public/${slug}/photos/init`, { ext, size: file.size },
    )
    await fetch(init.upload_url, { method: 'PUT', headers: { 'Content-Type': file.type || 'image/jpeg' }, body: file })
    return publicPost<{ id: string }>(`/api/live/public/${slug}/booth-photo`, {
      storage_path: init.storage_path,
      guest_name:   meta.guest_name,
      caption:      meta.caption,
    })
  },
  async publicListApproved(slug: string): Promise<LivePhoto[]> {
    const fs = await photoGuest().then((g) => g?.listApprovedForGuest(slug)); if (fs) return fs
    return publicGet<LivePhoto[]>(`/api/live/public/${slug}/photos`)
  },
  // Wedding · Proclamazione Vincitore: foto sposo/sposa. Firebase (dashboard switch): Storage direct under events/{id}/winner/, rules = owner only.
  // Legacy: bucket privato `wedding-photos` riusando `photos/init` + PUT signed URL (NON compare nell'album né nel Live Booth).
  // Il path viene poi salvato dal DJ in `screen_config.winner_announcement`.
  async winnerUploadPhoto(slug: string, file: File, role: 'groom' | 'bride' = 'groom'): Promise<{ storage_path: string }> {
    const fs = await owner().then((o) => o?.photos.uploadWinnerPhoto(slug, file, role)); if (fs) return fs
    const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase()
    const init = await publicPost<{ upload_url: string; storage_path: string }>(
      `/api/live/public/${slug}/photos/init`, { ext, size: file.size },
    )
    await fetch(init.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'image/jpeg' },
      body: file,
    })
    return { storage_path: init.storage_path }
  },
  /** Preview URLs of the stored winner photos: Storage for Firebase paths (dashboard switch), the legacy screen payload otherwise. */
  async winnerPreviewUrls(slug: string, cfg: { groom_photo_path?: string | null; bride_photo_path?: string | null }): Promise<{ groom: string | null; bride: string | null }> {
    const fs = await owner().then((o) => o?.photos.winnerUrls(cfg)); if (fs && (fs.groom || fs.bride || !(cfg.groom_photo_path || cfg.bride_photo_path))) return fs
    const w = ((await liveScreen.get(slug).catch(() => null))?.session?.screen_config as any)?.winner_announcement
    return { groom: w?.groom_photo_url ?? null, bride: w?.bride_photo_url ?? null }
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
      /** Backend arricchisce con `groom_photo_url` e `bride_photo_url` (signed
       *  URLs 1h) accanto ai path se `winner_announcement` è presente. */
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

export const liveScreen = {
  get: (slug: string) => publicGet<ScreenPayload>(`/api/live/public/${slug}/screen`),
}

export const futureMessages = {
  async listForDj(sessionId: string): Promise<LiveFutureMessage[]> {
    try {
      const { data } = await getClient().get<{ data: LiveFutureMessage[] }>(`/api/live/sessions/${sessionId}/future-messages`)
      return data.data
    } catch (e) { apiError(e) }
  },
  async toggleSelected(id: string, isSelected: boolean): Promise<LiveFutureMessage> {
    try {
      const { data } = await getClient().patch<{ data: LiveFutureMessage }>(`/api/live/future-messages/${id}`, { is_selected: isSelected })
      return data.data
    } catch (e) { apiError(e) }
  },
  async delete(id: string): Promise<void> {
    try { await getClient().delete(`/api/live/future-messages/${id}`) }
    catch (e) { apiError(e) }
  },
  submitPublic: (slug: string, body: { guest_name?: string; message: string; delivery_year?: string }) =>
    publicPost<LiveFutureMessage>(`/api/live/public/${slug}/future-messages`, body),
  getSelectedPublic: (slug: string) =>
    publicGet<LiveFutureMessage[]>(`/api/live/public/${slug}/future-messages/selected`),
}

export const bestPhoto = {
  async getVotesForDj(sessionId: string): Promise<LivePhoto[]> {
    try {
      const { data } = await getClient().get<{ data: LivePhoto[] }>(`/api/live/sessions/${sessionId}/photos/votes`)
      return data.data
    } catch (e) { apiError(e) }
  },
  votePublic: (slug: string, photoId: string) =>
    publicPost<{ ok: boolean }>(`/api/live/public/${slug}/photos/${photoId}/vote`, {}),
  getVotesPublic: (slug: string) =>
    publicGet<LivePhoto[]>(`/api/live/public/${slug}/photos/votes`),
}
