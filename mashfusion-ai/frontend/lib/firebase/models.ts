/** Firestore document shapes (camelCase). Timestamps are read back as Date. */

export type PlanTier = 'free' | 'pro' | 'wedding' // 'wedding' == Advance (see lib/plan.ts)
export type PlanSource = 'default' | 'legacy' | 'stripe'

/** Server-written. Clients can read it but never write it (see firestore.rules). */
export interface PlanState {
  tier:        PlanTier
  source:      PlanSource
  /** Reserved for the future Stripe webhook (subscription period end). */
  validUntil?: Date | null
}

/** users/{firebaseUid} */
export interface UserDoc {
  uid:         string
  email:       string
  displayName?: string | null
  avatarUrl?:  string | null
  plan:        PlanState
  /** TRANSITIONAL, server-only: Supabase users.id of the owner / legacy records. */
  legacySupabaseId?: string
  createdAt:   Date | null
  updatedAt:   Date | null
}

export type UserProfilePatch = Partial<Pick<UserDoc, 'displayName' | 'avatarUrl'>>

/** djProfiles/{firebaseUid} */
export interface DjProfileDoc {
  displayName?:   string | null
  bio?:           string | null
  avatarUrl?:     string | null
  instagramUrl?:  string | null
  tiktokUrl?:     string | null
  spotifyUrl?:    string | null
  soundcloudUrl?: string | null
  websiteUrl?:    string | null
  /** Server-only (uniqueness enforced by backend). */
  publicSlug?:    string | null
  createdAt:      Date | null
  updatedAt:      Date | null
}

export type DjProfilePatch = Partial<Omit<DjProfileDoc, 'publicSlug' | 'createdAt' | 'updatedAt'>>

export type EventType   = 'standard' | 'party' | 'wedding'
export type EventStatus = 'live' | 'ended'

/**
 * events/{eventId} — public event data. Written only by the backend (Admin SDK).
 * Live/high-frequency state (games, polls, requests, presence) does NOT live here:
 * it belongs to its own collections so this document is rewritten rarely.
 */
export interface EventDoc {
  id:                string
  ownerUid:          string
  /** TRANSITIONAL: Supabase live_sessions.id, used by the not-yet-migrated child domains. */
  legacySupabaseId?: string
  slug:              string
  title:             string
  djName:            string | null
  description:       string | null
  type:              EventType
  status:            EventStatus
  coupleNames:       string | null
  weddingDate:       string | null
  venueName:         string | null
  screenModeEnabled: boolean
  guestConfig:       Record<string, unknown> | null
  createdAt:         Date | null
  updatedAt:         Date | null
}

export type RequestStatus = 'pending' | 'approved' | 'rejected'

/**
 * events/{eventId}/requests/{requestId}. Created only by the createMusicRequest Cloud Function
 * (or projected from the legacy route, in which case guestUid is null).
 */
export interface RequestDoc {
  id:         string
  /** Anonymous (or account) Firebase UID of the guest; null for requests projected from the legacy route. */
  guestUid:   string | null
  songTitle:  string
  artist:     string | null
  message:    string | null
  status:     RequestStatus
  /** TRANSITIONAL: Supabase live_requests.id */
  legacySupabaseId?: string
  createdAt:  Date | null
  updatedAt:  Date | null
}

export type DedicationStatus = 'pending' | 'approved' | 'rejected'

/**
 * events/{eventId}/dedications/{id}. Created only by the createDedication Cloud Function (or projected
 * from the legacy route). No guestUid: guests read the approved wall of everybody.
 */
export interface DedicationDoc {
  id:         string
  senderName: string | null
  message:    string
  status:     DedicationStatus
  /** TRANSITIONAL: Supabase live_dedications.id */
  legacySupabaseId?: string
  createdAt:  Date | null
  updatedAt:  Date | null
}

export type PollStatus = 'open' | 'closed'

/**
 * events/{eventId}/polls/{pollId}. Written only by the backend projection (Supabase is authoritative).
 * Options are plain strings addressed by index (legacy: 2–4 options). Counts live in the `tally` shards.
 */
export interface PollDoc {
  id:        string
  question:  string
  options:   string[]
  status:    PollStatus
  /** TRANSITIONAL: Supabase live_polls.id (used for the legacy-endpoint fallback). */
  legacySupabaseId?: string
  createdAt: Date | null
  updatedAt: Date | null
}

/**
 * events/{eventId}/games/{roundId} — projection of the legacy live_game_rounds rows (id == Supabase row id).
 * `status`, `config` and `result` keep the legacy vocabulary and shape verbatim.
 */
export type GameType = 'wedding_roulette' | 'shoe_game'
export type GameStatus = 'idle' | 'running' | 'completed'
export interface GameRoundDoc {
  id:        string
  type:      GameType
  status:    GameStatus
  config:    Record<string, unknown> | null
  result:    Record<string, unknown> | null
  createdAt: Date | null
  updatedAt: Date | null
}
