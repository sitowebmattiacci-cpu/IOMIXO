import { z } from 'zod';

/**
 * Arrangement JSON schema — Phase 0 of remix workstation pivot.
 *
 * Mirrors ai-engine/schemas/arrangement.py. Keep both sides in sync.
 *
 * The arrangement is the canonical timeline document: produced by the
 * AI Seed Generator, edited in the browser workstation, persisted to
 * `arrangements.doc`, and rendered into a mastered audio file.
 */

export const SCHEMA_VERSION = 1;

const clipFxSchema = z.object({
  enabled: z.boolean().default(true),
  attack_ms: z.number().default(2),
  decay_ms: z.number().default(300),
  filter_cutoff_hz: z.number().default(20000),
  resonance: z.number().default(0),
  drive: z.number().default(0),
  transient_punch: z.number().default(0),
  limiter_db: z.number().default(0),
  reverb: z.number().default(0),
  delay: z.number().default(0),
  stereo_width: z.number().default(1),
});

export const clipSchema = z.object({
  id: z.string(),
  asset_kind: z.enum(['stem', 'soundbank', 'user_sample']),
  asset_ref: z.string(),

  start_sec: z.number().nonnegative(),
  end_sec: z.number().nonnegative(),
  offset_sec: z.number().nonnegative().default(0),

  gain_db: z.number().default(0),
  fade_in_sec: z.number().nonnegative().default(0),
  fade_out_sec: z.number().nonnegative().default(0),
  pitch_semitones: z.number().default(0),
  time_stretch_ratio: z.number().positive().default(1),
  fx: clipFxSchema.optional(),
});

export const trackSchema = z.object({
  id: z.string(),
  name: z.string(),
  lane: z.number().int().nonnegative(),
  source: z.object({
    side: z.enum(['a', 'b']),
    stem_name: z.string(),
    s3_key: z.string(),
  }).optional(),
  user_created: z.boolean().optional(),
  volume_db: z.number().default(0),
  mute: z.boolean().default(false),
  solo: z.boolean().default(false),
  clips: z.array(clipSchema).default([]),
});

export const aiAssistFlagsSchema = z.object({
  auto_beat_sync: z.boolean().default(false),
  harmonic_match: z.boolean().default(false),
  groove_tighten: z.boolean().default(false),
});

export const masterSettingsSchema = z.object({
  target_lufs: z.number().default(-14),
  limiter: z.boolean().default(true),
});

export const arrangementSchema = z.object({
  version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  project_id: z.string().uuid(),
  bpm: z.number().positive(),
  musical_key: z.string().nullable().optional(),
  duration_sec: z.number().nonnegative(),
  lanes: z.array(trackSchema).optional(),
  tracks: z.array(trackSchema).default([]),
  ai_assist_flags: aiAssistFlagsSchema.default({}),
  master: masterSettingsSchema.default({}),
});

export type Clip = z.infer<typeof clipSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Arrangement = z.infer<typeof arrangementSchema>;
