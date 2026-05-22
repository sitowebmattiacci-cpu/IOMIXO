// Arrangement schema mirror — keep in sync with backend/src/schemas/arrangement.ts.

export const ARRANGEMENT_SCHEMA_VERSION = 1

export type ClipAssetKind = 'stem' | 'soundbank' | 'user_sample'

/**
 * Non-destructive per-clip effect chain parameters.
 * Stored in the arrangement JSON; applied at playback/render time.
 * All values are neutral at their defaults (no audible effect).
 */
export interface ClipFx {
  enabled?: boolean        // true = active, false = bypassed
  attack_ms: number         // 0–500 ms (envelope shaper)
  decay_ms: number          // 0–2000 ms
  filter_cutoff_hz: number  // 20–20000 Hz (low-pass)
  resonance: number         // 0–1
  drive: number             // 0–1 (soft saturation)
  transient_punch: number   // 0–1 (transient shaper amount)
  limiter_db: number        // -24–0 dB (0 = off / no limiting)
  reverb: number            // 0–1 (wet mix)
  delay: number             // 0–1 (wet mix)
  stereo_width: number      // 0–2  (1 = unaffected, 0 = mono, 2 = full wide)
}

export const DEFAULT_CLIP_FX: ClipFx = {
  enabled:          true,
  attack_ms:        2,
  decay_ms:         300,
  filter_cutoff_hz: 20000,
  resonance:        0,
  drive:            0,
  transient_punch:  0,
  limiter_db:       0,
  reverb:           0,
  delay:            0,
  stereo_width:     1,
}

export interface Clip {
  id: string
  asset_kind: ClipAssetKind
  asset_ref: string
  start_sec: number
  end_sec: number
  offset_sec: number
  gain_db: number
  fade_in_sec: number
  fade_out_sec: number
  pitch_semitones: number
  time_stretch_ratio: number
  /** Non-destructive effect parameters. Absent = all-neutral / DEFAULT_CLIP_FX. */
  fx?: ClipFx
}

export interface Track {
  id: string
  name: string
  lane: number
  source?: {
    side: 'a' | 'b'
    stem_name: string
    s3_key: string
  }
  user_created?: boolean
  volume_db: number
  mute: boolean
  solo: boolean
  clips: Clip[]
}

export interface AIAssistFlags {
  auto_beat_sync: boolean
  harmonic_match: boolean
  groove_tighten: boolean
}

export interface MasterSettings {
  target_lufs: number
  limiter: boolean
}

export interface Arrangement {
  version: number
  project_id: string
  bpm: number
  musical_key: string | null
  duration_sec: number
  lanes?: Track[]
  tracks: Track[]
  ai_assist_flags: AIAssistFlags
  master: MasterSettings
}

export interface StoredArrangement {
  id: string
  version: number
  source: 'ai_seed' | 'user' | 'ai_assist'
  doc: Arrangement
  created_at: string
  updated_at: string
}

export interface ClipSyncSuggestion {
  clip_id: string
  bpm: number | null
  confidence: number
  suggested_start_sec: number
  suggested_offset_sec: number
  time_stretch_ratio: number
  fade_in_sec: number
}

export interface ProjectStem {
  id: string
  side: 'a' | 'b'
  stem_name: string          // 'vocals' | 'drums' | 'bass' | 'other' | …
  s3_key: string
  duration_sec: number | null
  sample_rate: number | null
  signed_url: string | null
}

// ── Soundbank + user samples ─────────────────────────────────
export type SoundbankCategoryId =
  | 'afro_house'
  | 'deep_house'
  | 'edm'
  | 'chill'
  | 'fx'

export interface SoundbankCategory {
  id:    SoundbankCategoryId
  label: string
}

export interface SoundbankSample {
  id:           string
  category:     SoundbankCategoryId
  name:         string
  s3_key:       string
  duration_sec: number | null
  bpm:          number | null
  musical_key:  string | null
  style:        string | null
  energy:       string | null
  tags:         string[]
  signed_url:   string | null
}

export interface SoundbankList {
  categories: Record<SoundbankCategoryId, SoundbankSample[]>
  total:      number
}

export interface UserSample {
  id:           string
  name:         string
  s3_key:       string
  duration_sec: number | null
  created_at:   string
  signed_url:   string | null
}
