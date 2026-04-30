// ────────────────────────────────────────────────────────────
// MASHFUSION AI — Shared TypeScript Types
// ────────────────────────────────────────────────────────────

export type Plan = 'free' | 'pro' | 'studio'
export type JobStatus =
  | 'queued'
  | 'uploading'
  | 'analyzing'
  | 'separating_stems'
  | 'harmonizing'
  | 'composing'
  | 'modernizing'
  | 'mastering'
  | 'rendering'
  | 'complete'
  | 'failed'

export type RemixStyle =
  | 'none'
  | 'edm_festival'
  | 'house_club'
  | 'afro_house'
  | 'deep_emotional'
  | 'pop_radio'
  | 'cinematic'
  | 'chill_sunset'

// ── Remix Director ────────────────────────────────────────────
export interface RemixDirectorParams {
  raw_prompt:           string
  style_profile:        'edm_festival' | 'house_club' | 'deep_emotional' | 'pop_radio' | 'cinematic' | 'chill_sunset' | 'viral_modern' | 'auto'
  target_energy:        'slow_build' | 'medium_slow_rise' | 'steady' | 'high_energy' | 'explosive' | 'dreamy'
  tempo_adjustment:     'slower' | 'slightly_slower' | 'original' | 'slightly_faster' | 'faster'
  vocal_priority:       'track_a' | 'track_b' | 'balanced' | 'instrumental'
  instrument_overlay:   string | null
  transition_density:   'minimal' | 'smooth' | 'dynamic' | 'aggressive'
  finale_intensity:     'fade_out' | 'standard' | 'high' | 'explosive'
  modernity_level:      'classic' | 'modern' | 'cutting_edge' | 'viral'
  surprise_factor:      number
  confidence:           number
  processing_headline:  string
  processing_steps:     string[]
}

// ── Users ────────────────────────────────────────────────────
export interface User {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  plan: Plan
  credits_remaining: number
  credits_reset_at: string | null
  created_at: string
}

// ── Subscriptions ─────────────────────────────────────────────
export interface Subscription {
  id: string
  user_id: string
  stripe_subscription_id: string
  stripe_customer_id: string
  plan: Plan
  status: 'active' | 'canceled' | 'past_due' | 'trialing'
  current_period_start: string
  current_period_end: string
  cancel_at_period_end: boolean
}

// ── Tracks ───────────────────────────────────────────────────
export interface UploadedTrack {
  id: string
  user_id: string
  project_id: string | null
  role: 'track_a' | 'track_b'
  original_filename: string
  s3_key: string
  s3_url: string
  file_size_bytes: number
  duration_seconds: number | null
  mime_type: string
  upload_status: 'uploading' | 'ready' | 'error'
  created_at: string
}

// ── Analysis ─────────────────────────────────────────────────
export interface AnalysisResult {
  id: string
  track_id: string
  bpm: number
  bpm_confidence: number
  musical_key: string
  key_confidence: number
  time_signature: string
  sections: SongSection[]
  beat_timestamps: number[]
  energy_map: EnergyPoint[]
  analyzed_at: string
}

export interface SongSection {
  label: 'intro' | 'verse' | 'pre_chorus' | 'chorus' | 'bridge' | 'drop' | 'breakdown' | 'outro'
  start_time: number
  end_time: number
  energy: number
  confidence: number
}

export interface EnergyPoint {
  time: number
  energy: number
}

// ── Projects ─────────────────────────────────────────────────
export interface Project {
  id: string
  user_id: string
  title: string
  track_a_id: string | null
  track_b_id: string | null
  remix_style: RemixStyle
  output_quality: 'standard' | 'hd' | 'professional'
  remix_prompt?: string
  remix_director_params?: RemixDirectorParams
  credits_consumed: number
  created_at: string
  updated_at: string
  track_a?: UploadedTrack
  track_b?: UploadedTrack
  latest_job?: RenderJob
  analysis_a?: AnalysisResult
  analysis_b?: AnalysisResult
}

// ── Render Jobs ───────────────────────────────────────────────
export interface RenderJob {
  id: string
  project_id: string
  user_id: string
  status: JobStatus
  progress: number                  // 0-100
  current_stage: string
  stage_progress: Record<ProcessingStage, StageStatus>
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  output_quality?: 'standard' | 'hd' | 'professional'
  remix_prompt?: string
  remix_director_params?: RemixDirectorParams
  output?: FinalOutput
}

export type ProcessingStage =
  | 'stem_separation'
  | 'music_analysis'
  | 'harmonic_matching'
  | 'mashup_composition'
  | 'sound_modernization'
  | 'mastering'
  | 'rendering'

export interface StageStatus {
  status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped'
  progress: number
  started_at: string | null
  completed_at: string | null
  message: string | null
}

// ── Outputs ───────────────────────────────────────────────────
export interface FinalOutput {
  id: string
  job_id: string
  project_id: string
  preview_mp3_url: string
  full_wav_url: string | null
  full_mp3_url: string | null
  duration_seconds: number
  loudness_lufs: number
  sample_rate: number
  bit_depth: number
  file_size_bytes: number
  expires_at: string
  created_at: string
}

// ── Payments ──────────────────────────────────────────────────
export interface Payment {
  id: string
  user_id: string
  stripe_payment_intent_id: string
  amount_cents: number
  currency: string
  status: 'succeeded' | 'pending' | 'failed'
  description: string
  created_at: string
}

// ── API Responses ─────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T | null
  error: string | null
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  has_more: boolean
}

// ── Upload State ──────────────────────────────────────────────
export interface UploadState {
  file: File | null
  progress: number
  status: 'idle' | 'uploading' | 'done' | 'error'
  track?: UploadedTrack
  error?: string
}

// ── Studio Store State ────────────────────────────────────────
export interface StudioState {
  projectId: string | null
  trackAUpload: UploadState
  trackBUpload: UploadState
  remixStyle: RemixStyle
  outputQuality: 'standard' | 'hd' | 'professional'
  currentJob: RenderJob | null
  analysisA: AnalysisResult | null
  analysisB: AnalysisResult | null
}

// ── Plan metadata ─────────────────────────────────────────────
export const PLAN_METADATA: Record<Plan, {
  name: string
  monthlyCredits: number
  priceMonthly: number
  quality: string[]
  stripePriceId: string | null
}> = {
  free: {
    name: 'Free',
    monthlyCredits: 1,
    priceMonthly: 0,
    quality: ['Standard MP3'],
    stripePriceId: null,
  },
  pro: {
    name: 'Pro',
    monthlyCredits: 20,
    priceMonthly: 29,
    quality: ['HD MP3', 'WAV Export'],
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID ?? '',
  },
  studio: {
    name: 'Studio',
    monthlyCredits: 100,
    priceMonthly: 79,
    quality: ['Professional WAV', 'Stems Download', 'Priority Queue'],
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_STUDIO_PRICE_ID ?? '',
  },
}

export const JOB_STAGE_LABELS: Record<ProcessingStage, string> = {
  stem_separation:     'Separating Stems',
  music_analysis:      'Analyzing Music',
  harmonic_matching:   'Harmonic Matching',
  mashup_composition:  'Composing Mashup',
  sound_modernization: 'Modernizing Sound',
  mastering:           'Mastering',
  rendering:           'Final Render',
}

export const REMIX_STYLE_LABELS: Record<RemixStyle, { label: string; description: string; icon: string }> = {
  none:          { label: 'Original Style', description: 'Preserve both songs original sonic character', icon: '🎵' },
  edm_festival:  { label: 'EDM Festival',   description: 'Big room drops, festival energy, supersaw leads', icon: '⚡' },
  house_club:    { label: 'House Club',      description: 'Deep 4/4 groove, punchy kick, club-ready mix', icon: '🏠' },
  afro_house:    { label: 'Afro House',      description: 'Rolling bassline, organic percussion, wide spacious mix — Black Coffee feel', icon: '🥁' },
  deep_emotional:{ label: 'Deep Emotional',  description: 'Atmospheric pads, cinematic tension, emotional build', icon: '🌊' },
  pop_radio:     { label: 'Pop Radio',       description: 'Radio-ready compression, polished production', icon: '📻' },
  cinematic:     { label: 'Cinematic',       description: 'Orchestral elements, epic transitions, film score feel', icon: '🎬' },
  chill_sunset:  { label: 'Chill Sunset',    description: 'Lo-fi textures, warm tones, relaxed groove', icon: '🌅' },
}
