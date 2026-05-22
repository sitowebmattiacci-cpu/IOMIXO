import axios, { AxiosError, type AxiosInstance } from 'axios'
import { getAccessToken } from '@/lib/supabase'
import type {
  Project, UploadedTrack, RenderJob,
  User, Subscription, Payment, AnalysisResult, RemixStyle,
  ApiResponse, PaginatedResponse,
} from '@/types'
import type {
  Arrangement, StoredArrangement, ProjectStem,
  ClipSyncSuggestion,
  SoundbankList, SoundbankCategory, UserSample,
} from '@/types/arrangement'

export interface SeedJobStatus {
  id:             string
  status:         'queued' | 'processing' | 'complete' | 'failed' | string
  current_stage:  string | null
  progress:       number | null
  error_message:  string | null
  created_at:     string
  updated_at:     string
}

export interface GenerateSoundInput {
  project_id: string
  prompt: string
  bpm: number
  duration: number
  sound_type?: string
}

export interface GenerateSoundResult {
  audio_url: string
  duration: number
  sample: {
    id: string
    name: string
    s3_key: string
    duration_sec: number | null
    created_at: string
    signed_url: string
  }
}

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
// TRACKS — Upload (presigned URL from backend → PUT direct to Supabase Storage)
// ══════════════════════════════════════════════════════════════
export const tracks = {
  async requestUploadUrl(projectId: string, role: 'track_a' | 'track_b', filename: string, mimeType: string) {
    try {
      const { data } = await getClient().post<{
        upload_url: string
        track_id: string
        storage_path: string
      }>('/tracks/request-upload', { project_id: projectId, role, filename, mime_type: mimeType })
      return data
    } catch (e) { apiError(e) }
  },

  async confirmUpload(trackId: string, durationSeconds: number) {
    try {
      const { data } = await getClient().post<ApiResponse<UploadedTrack>>(
        `/tracks/${trackId}/confirm`,
        { duration_seconds: durationSeconds }
      )
      return data.data!
    } catch (e) { apiError(e) }
  },

  /** PUT file directly to Supabase Storage via presigned upload URL */
  async uploadToStorage(
    presignedUrl: string,
    file: File,
    onProgress?: (pct: number) => void
  ): Promise<void> {
    await axios.put(presignedUrl, file, {
      headers: { 'Content-Type': file.type },
      onUploadProgress: (e) => {
        if (e.total) onProgress?.(Math.round((e.loaded / e.total) * 100))
      },
    })
  },
}

// ══════════════════════════════════════════════════════════════
// PROJECTS
// ══════════════════════════════════════════════════════════════
export const projects = {
  async create(title: string, mode: 'remix' | 'mashup' = 'mashup'): Promise<Project> {
    try {
      const { data } = await getClient().post<ApiResponse<Project>>('/projects', { title, mode })
      return data.data!
    } catch (e) { apiError(e) }
  },

  async list(page = 1, limit = 20): Promise<PaginatedResponse<Project>> {
    try {
      const { data } = await getClient().get<PaginatedResponse<Project>>('/projects', {
        params: { page, limit },
      })
      return data
    } catch (e) { apiError(e) }
  },

  async get(projectId: string): Promise<Project> {
    try {
      const { data } = await getClient().get<ApiResponse<Project>>(`/projects/${projectId}`)
      return data.data!
    } catch (e) { apiError(e) }
  },

  async delete(projectId: string): Promise<void> {
    try {
      await getClient().delete(`/projects/${projectId}`)
    } catch (e) { apiError(e) }
  },

  // ── Workstation: stems ────────────────────────────────────────
  async getStems(projectId: string): Promise<ProjectStem[]> {
    try {
      const { data } = await getClient().get<ApiResponse<ProjectStem[]>>(`/projects/${projectId}/stems`)
      return data.data ?? []
    } catch (e) { apiError(e) }
  },

  // ── Workstation: arrangement load/save ────────────────────────
  async getSeedJob(projectId: string): Promise<SeedJobStatus | null> {
    try {
      const { data } = await getClient().get<ApiResponse<SeedJobStatus>>(`/projects/${projectId}/seed-job`)
      return data.data ?? null
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null
      apiError(err)
    }
  },

  async getArrangement(projectId: string): Promise<StoredArrangement | null> {
    try {
      const { data } = await getClient().get<ApiResponse<StoredArrangement>>(`/projects/${projectId}/arrangement`)
      return data.data ?? null
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null
      apiError(err)
    }
  },

  async saveArrangement(projectId: string, doc: Arrangement): Promise<StoredArrangement> {
    try {
      const { data } = await getClient().put<ApiResponse<StoredArrangement>>(
        `/projects/${projectId}/arrangement`,
        doc,
      )
      return data.data!
    } catch (e) { apiError(e) }
  },

  // ── Workstation: render the saved arrangement ────────────────
  async render(
    projectId: string,
    outputQuality: 'standard' | 'hd' | 'professional' = 'standard',
  ): Promise<RenderJob> {
    try {
      const { data } = await getClient().post<ApiResponse<RenderJob>>(
        `/projects/${projectId}/render`,
        { output_quality: outputQuality },
      )
      return data.data!
    } catch (e) { apiError(e) }
  },

  // ── Workstation: real audio Sync to Beat ─────────────────────
  async syncClipsToBeat(
    projectId: string,
    body: { grid: 'bar' | 'beat' | 'half'; clip_ids: string[] },
  ): Promise<{ suggestions: ClipSyncSuggestion[] }> {
    try {
      const { data } = await getClient().post<ApiResponse<{ suggestions: ClipSyncSuggestion[] }>>(
        `/projects/${projectId}/clips/sync-to-beat`,
        body,
      )
      return data.data ?? { suggestions: [] }
    } catch (e) { apiError(e) }
  },
}

// ══════════════════════════════════════════════════════════════
// SOUNDBANK + USER SAMPLES — workstation library
// ══════════════════════════════════════════════════════════════
export const soundbank = {
  async listCategories(): Promise<SoundbankCategory[]> {
    try {
      const { data } = await getClient().get<ApiResponse<SoundbankCategory[]>>('/soundbank/categories')
      return data.data ?? []
    } catch (e) { apiError(e) }
  },

  async list(): Promise<SoundbankList> {
    try {
      const { data } = await getClient().get<ApiResponse<SoundbankList>>('/soundbank')
      return data.data ?? { categories: { afro_house: [], deep_house: [], edm: [], chill: [], fx: [] }, total: 0 }
    } catch (e) { apiError(e) }
  },
}

export const samples = {
  async list(): Promise<UserSample[]> {
    try {
      const { data } = await getClient().get<ApiResponse<UserSample[]>>('/samples')
      return data.data ?? []
    } catch (e) { apiError(e) }
  },

  async requestUploadUrl(filename: string, contentType: string, sizeBytes: number): Promise<{ upload_url: string; s3_key: string }> {
    try {
      const { data } = await getClient().post<ApiResponse<{ upload_url: string; s3_key: string }>>(
        '/samples/upload-url',
        { filename, content_type: contentType, size_bytes: sizeBytes },
      )
      return data.data!
    } catch (e) { apiError(e) }
  },

  async register(name: string, s3_key: string, duration_sec: number | null): Promise<UserSample> {
    try {
      const { data } = await getClient().post<ApiResponse<UserSample>>('/samples', {
        name, s3_key, duration_sec,
      })
      return data.data!
    } catch (e) { apiError(e) }
  },
}

export const ai = {
  async generateSound(input: GenerateSoundInput): Promise<GenerateSoundResult> {
    try {
      const { data } = await getClient().post<ApiResponse<GenerateSoundResult>>('/api/ai/generate-sound', input)
      return data.data!
    } catch (e) { apiError(e) }
  },
}

// ══════════════════════════════════════════════════════════════
// JOBS — Analysis + Remix
// ══════════════════════════════════════════════════════════════
export const jobs = {
  async startAnalysis(projectId: string): Promise<{ job_id: string }> {
    try {
      const { data } = await getClient().post<{ job_id: string }>('/jobs/start-analysis', {
        project_id: projectId,
      })
      return data
    } catch (e) { apiError(e) }
  },

  async startRemix(
    projectId: string,
    remixStyle: RemixStyle,
    outputQuality: 'standard' | 'hd' | 'professional',
    remixPrompt?: string,
  ): Promise<RenderJob> {
    try {
      const { data } = await getClient().post<ApiResponse<RenderJob>>('/jobs/start-remix', {
        project_id:   projectId,
        remix_style:  remixStyle,
        output_quality: outputQuality,
        ...(remixPrompt ? { remix_prompt: remixPrompt } : {}),
      })
      return data.data!
    } catch (e) { apiError(e) }
  },

  async getStatus(jobId: string): Promise<RenderJob> {
    try {
      const { data } = await getClient().get<ApiResponse<RenderJob>>(`/jobs/${jobId}/status`)
      return data.data!
    } catch (e) { apiError(e) }
  },

  async getAnalysis(projectId: string): Promise<{ a: AnalysisResult; b: AnalysisResult }> {
    try {
      const { data } = await getClient().get<ApiResponse<{ a: AnalysisResult; b: AnalysisResult }>>(
        `/jobs/analysis/${projectId}`
      )
      return data.data!
    } catch (e) { apiError(e) }
  },

  async getDownloadLinks(jobId: string): Promise<{
    mp3_url: string
    wav_url: string | null
    expires_at: string
  }> {
    try {
      const { data } = await getClient().get<ApiResponse<{
        mp3_url: string; wav_url: string | null; expires_at: string
      }>>(`/jobs/${jobId}/download`)
      return data.data!
    } catch (e) { apiError(e) }
  },
}

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
  async createCheckoutSession(priceId: string, mode: 'subscription' | 'payment' = 'subscription', sessionId?: string): Promise<{ url: string }> {
    try {
      const payload: any = {
        price_id: priceId,
        success_url: `${window.location.origin}/dashboard?upgraded=true`,
        cancel_url:  `${window.location.origin}/billing`,
        mode,
      }
      if (sessionId) payload.session_id = sessionId
      const { data } = await getClient().post<{ url: string }>('/stripe/create-checkout', payload)
      return data
    } catch (e) { apiError(e) }
  },

  async getWeddingPasses() {
    try {
      const { data } = await getClient().get<ApiResponse<any[]>>('/stripe/wedding-passes')
      return data.data ?? []
    } catch (e) { apiError(e) }
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
export type SessionType = 'standard' | 'wedding'
export type PlanTier = 'free' | 'pro' | 'wedding'

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
    couple_font?: 'cormorant' | 'playfair' | 'great-vibes' | 'dancing' | 'cinzel' | 'tangerine'
  } | null
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
  async updateSession(id: string, patch: Partial<Pick<LiveSession, 'event_name' | 'dj_name' | 'description' | 'is_active' | 'couple_names' | 'wedding_date' | 'venue_name' | 'screen_mode_enabled' | 'screen_config' | 'roulette_penitenze' | 'shoe_game_questions'>>): Promise<LiveSession> {
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
    method: 'POST', headers: { 'Content-Type': 'application/json' },
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
}

export interface ScreenPayload {
  session: {
    event_name: string
    dj_name: string | null
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
      couple_font?: 'cormorant' | 'playfair' | 'great-vibes' | 'dancing' | 'cinzel' | 'tangerine'
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
