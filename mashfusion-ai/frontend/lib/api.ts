import axios, { AxiosError, type AxiosInstance } from 'axios'
import { getAccessToken } from '@/lib/supabase'
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

  // Attach Supabase JWT on every request
  _client.interceptors.request.use(async (cfg) => {
    if (typeof window !== 'undefined') {
      const token = await getAccessToken()
      if (token) cfg.headers.Authorization = `Bearer ${token}`
    }
    return cfg
  })

  // Redirect to login on 401
  _client.interceptors.response.use(
    (res) => res,
    async (err: AxiosError) => {
      if (err.response?.status === 401 && typeof window !== 'undefined') {
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

export const auth = {
  /** Returns the full user row from the database. */
  async me(): Promise<User> {
    try {
      const { data } = await getClient().get<ApiResponse<User>>('/user/me')
      return data.data!
    } catch (e) { apiError(e) }
  },

  /** Sign out via Supabase and redirect. */
  async logout(): Promise<void> {
    const { getSupabaseClient } = await import('@/lib/supabase')
    await getSupabaseClient().auth.signOut()
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

export const live = {
  async listSessions(): Promise<LiveSession[]> {
    try {
      const { data } = await getClient().get<{ data: LiveSession[] }>('/api/live/sessions')
      return data.data
    } catch (e) { apiError(e) }
  },
  async getSession(id: string): Promise<LiveSession> {
    try {
      const { data } = await getClient().get<{ data: LiveSession }>(`/api/live/sessions/${id}`)
      return data.data
    } catch (e) { apiError(e) }
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
    try {
      const { data } = await getClient().post<{ data: LiveSession }>('/api/live/sessions', input)
      return data.data
    } catch (e) { apiError(e) }
  },
  async updateSession(id: string, patch: Partial<Pick<LiveSession, 'event_name' | 'dj_name' | 'description' | 'is_active' | 'couple_names' | 'wedding_date' | 'venue_name' | 'screen_mode_enabled' | 'screen_config' | 'guest_config' | 'roulette_penitenze' | 'shoe_game_questions'>>): Promise<LiveSession> {
    try {
      const { data } = await getClient().patch<{ data: LiveSession }>(`/api/live/sessions/${id}`, patch)
      return data.data
    } catch (e) { apiError(e) }
  },
  async deleteSession(id: string): Promise<void> {
    try { await getClient().delete(`/api/live/sessions/${id}`) } catch (e) { apiError(e) }
  },
  async listRequests(sessionId: string): Promise<LiveRequest[]> {
    try {
      const { data } = await getClient().get<{ data: LiveRequest[] }>(`/api/live/sessions/${sessionId}/requests`)
      return data.data
    } catch (e) { apiError(e) }
  },
  async updateRequest(requestId: string, status: LiveRequestStatus): Promise<LiveRequest> {
    try {
      const { data } = await getClient().patch<{ data: LiveRequest }>(`/api/live/requests/${requestId}`, { status })
      return data.data
    } catch (e) { apiError(e) }
  },
  async deleteRequest(requestId: string): Promise<void> {
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
    try {
      const { data } = await getClient().get<{ data: LiveDedication[] }>(`/api/live/sessions/${sessionId}/dedications`)
      return data.data
    } catch (e) { apiError(e) }
  },
  async setStatus(id: string, status: 'pending' | 'approved' | 'rejected'): Promise<LiveDedication> {
    try {
      const { data } = await getClient().patch<{ data: LiveDedication }>(`/api/live/dedications/${id}`, { status })
      return data.data
    } catch (e) { apiError(e) }
  },
  async remove(id: string): Promise<void> {
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
    try {
      const { data } = await getClient().post<{ data: LiveGameRound }>(
        `/api/live/sessions/${sessionId}/games/roulette/start`,
        categories ? { categories } : {},
      )
      return data.data
    } catch (e) { apiError(e) }
  },
  async spinRoulette(sessionId: string): Promise<LiveGameRound> {
    try {
      const { data } = await getClient().post<{ data: LiveGameRound }>(
        `/api/live/sessions/${sessionId}/games/roulette/spin`, {})
      return data.data
    } catch (e) { apiError(e) }
  },
  async resetRoulette(sessionId: string): Promise<void> {
    try { await getClient().post(`/api/live/sessions/${sessionId}/games/roulette/reset`, {}) }
    catch (e) { apiError(e) }
  },
  publicLatest: (slug: string) =>
    publicGet<{ roulette: LiveGameRound | null; shoeGame: LiveGameRound | null }>(`/api/live/public/${slug}/games`),

  // Gioco della Scarpa
  async getShoeState(sessionId: string): Promise<LiveGameRound | null> {
    try {
      const { data } = await getClient().get<{ data: LiveGameRound | null }>(
        `/api/live/sessions/${sessionId}/games/shoe/state`)
      return data.data
    } catch (e) { apiError(e) }
  },
  async startShoe(sessionId: string, questions?: string[]): Promise<LiveGameRound> {
    try {
      const { data } = await getClient().post<{ data: LiveGameRound }>(
        `/api/live/sessions/${sessionId}/games/shoe/start`,
        questions ? { questions } : {},
      )
      return data.data
    } catch (e) { apiError(e) }
  },
  async nextShoe(sessionId: string): Promise<LiveGameRound> {
    try {
      const { data } = await getClient().post<{ data: LiveGameRound }>(
        `/api/live/sessions/${sessionId}/games/shoe/next`, {})
      return data.data
    } catch (e) { apiError(e) }
  },
  async resetShoe(sessionId: string): Promise<void> {
    try { await getClient().post(`/api/live/sessions/${sessionId}/games/shoe/reset`, {}) }
    catch (e) { apiError(e) }
  },
}

export const livePolls = {
  async list(sessionId: string): Promise<LivePoll[]> {
    try {
      const { data } = await getClient().get<{ data: LivePoll[] }>(`/api/live/sessions/${sessionId}/polls`)
      return data.data
    } catch (e) { apiError(e) }
  },
  async create(sessionId: string, body: { question: string; options: string[] }): Promise<LivePoll> {
    try {
      const { data } = await getClient().post<{ data: LivePoll }>(`/api/live/sessions/${sessionId}/polls`, body)
      return data.data
    } catch (e) { apiError(e) }
  },
  async setActive(id: string, isActive: boolean): Promise<LivePoll> {
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

export const livePhotos = {
  async listForDj(sessionId: string): Promise<LivePhoto[]> {
    try {
      const { data } = await getClient().get<{ data: LivePhoto[] }>(`/api/live/sessions/${sessionId}/photos`)
      return data.data
    } catch (e) { apiError(e) }
  },
  async listBoothPhotos(sessionId: string): Promise<LivePhoto[]> {
    try {
      const { data } = await getClient().get<{ data: LivePhoto[] }>(`/api/live/sessions/${sessionId}/booth/photos`)
      return data.data
    } catch (e) { apiError(e) }
  },
  async setStatus(id: string, status: 'pending' | 'approved' | 'rejected'): Promise<LivePhoto> {
    try {
      const { data } = await getClient().patch<{ data: LivePhoto }>(`/api/live/photos/${id}`, { status })
      return data.data
    } catch (e) { apiError(e) }
  },
  async setFeatured(id: string, is_featured: boolean): Promise<LivePhoto> {
    try {
      const { data } = await getClient().patch<{ data: LivePhoto }>(`/api/live/photos/${id}/feature`, { is_featured })
      return data.data
    } catch (e) { apiError(e) }
  },
  async approve(id: string): Promise<LivePhoto> {
    try {
      const { data } = await getClient().patch<{ data: LivePhoto }>(`/api/live/photos/${id}/approve`, {})
      return data.data
    } catch (e) { apiError(e) }
  },
  async remove(id: string): Promise<void> {
    try { await getClient().delete(`/api/live/photos/${id}`) } catch (e) { apiError(e) }
  },
  // public 2-step upload (guest album)
  async publicUpload(slug: string, file: File, meta: { guest_name?: string; caption?: string }): Promise<{ id: string }> {
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
  publicListApproved: (slug: string) =>
    publicGet<LivePhoto[]>(`/api/live/public/${slug}/photos`),
  // Wedding · Proclamazione Vincitore: upload della foto sposo/sposa nel
  // bucket privato `wedding-photos` riusando `photos/init` + PUT signed URL.
  // A differenza di publicUpload / boothUpload NON chiama il confirm su
  // `live_photos`: la foto NON compare nell'album ospiti / Live Booth.
  // Il path viene poi salvato dal DJ in `screen_config.winner_announcement`.
  async winnerUploadPhoto(slug: string, file: File): Promise<{ storage_path: string }> {
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
