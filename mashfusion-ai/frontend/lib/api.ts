import axios, { AxiosError, type AxiosInstance } from 'axios'
import { getAccessToken } from '@/lib/supabase'
import type {
  Project, UploadedTrack, RenderJob, FinalOutput,
  User, Subscription, Payment, AnalysisResult, RemixStyle,
  ApiResponse, PaginatedResponse,
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
  async create(title: string): Promise<Project> {
    try {
      const { data } = await getClient().post<ApiResponse<Project>>('/projects', { title })
      return data.data!
    } catch (e) { apiError(e) }
  },

  async list(page = 1, limit = 20): Promise<PaginatedResponse<Project>> {
    // DEMO MODE
    return { data: [], total: 0, page, limit, has_more: false }
    // try {
    //   const { data } = await getClient().get<PaginatedResponse<Project>>('/projects', {
    //     params: { page, limit },
    //   })
    //   return data
    // } catch (e) { apiError(e) }
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

  async getPreview(jobId: string): Promise<FinalOutput> {
    try {
      const { data } = await getClient().get<ApiResponse<FinalOutput>>(`/jobs/${jobId}/preview`)
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
    // DEMO MODE
    return { remaining: 12, plan: 'pro', resets_at: null }
    // try {
    //   const { data } = await getClient().get('/user/credits')
    //   return data
    // } catch (e) { apiError(e) }
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
  async createCheckoutSession(priceId: string): Promise<{ url: string }> {
    try {
      const { data } = await getClient().post<{ url: string }>('/stripe/create-checkout', {
        price_id: priceId,
        success_url: `${window.location.origin}/dashboard?upgraded=true`,
        cancel_url:  `${window.location.origin}/billing`,
      })
      return data
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
