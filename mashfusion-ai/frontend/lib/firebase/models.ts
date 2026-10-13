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
  /** Server-written (commitAvatar): tokenised Storage URL + its path. Legacy docs may carry an old Supabase URL without a path. */
  avatarUrl?:  string | null
  avatarPath?: string | null
  plan:        PlanState
  /** TRANSITIONAL, server-only: Supabase users.id of the owner / legacy records. */
  legacySupabaseId?: string
  createdAt:   Date | null
  updatedAt:   Date | null
}

/** users/{uid}/eventPasses/{key} — server-written (legacy backfill now, Stripe webhook later). */
export interface EventPassDoc {
  id:         string
  status:     'active' | 'expired' | 'refunded'
  validUntil: Date
  /** Legacy Supabase session id this pass is scoped to (null = valid for any event). */
  legacySessionId?: string | null
  eventId?:   string | null
  legacySupabaseId?: string | null
  stripePaymentIntentId?: string | null
  amountCents: number
  currency:   string
  createdAt:  Date | null
  updatedAt:  Date | null
}

/** Client-writable account fields. The avatar is NOT one of them (commitAvatar / removeAvatar callables). */
/** users/{uid}/subscriptions/{stripeSubscriptionId} — server-written. `historical` docs come from the legacy backfill (their status is NOT authoritative). */
export interface SubscriptionDoc {
  id: string; status: string; historical: boolean; stale: boolean; tier: PlanTier | null
  stripeSubscriptionId: string; stripeCustomerId: string | null
  currentPeriodStart: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; createdAt: Date | null
}

/** users/{uid}/payments/{id} — billing ledger, server-written. */
export interface PaymentDoc {
  id: string; userRef: string; stripePaymentIntentId: string; amountCents: number; currency: string
  status: string; description: string; createdAt: Date | null
}

export type UserProfilePatch = Partial<Pick<UserDoc, 'displayName'>>

/** djProfiles/{firebaseUid} */
export interface DjProfileDoc {
  displayName?:   string | null
  bio?:           string | null
  /** Server-written (commitAvatar), like UserDoc.avatarUrl. */
  avatarUrl?:     string | null
  avatarPath?:    string | null
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

export type DjProfilePatch = Partial<Omit<DjProfileDoc, 'publicSlug' | 'avatarUrl' | 'avatarPath' | 'createdAt' | 'updatedAt'>>

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
  /** TV screen section toggles (`show_*`, stand-up config...). Public data; written by the updateEventConfig callable / the events backfill. Undefined = never migrated (use the legacy payload). */
  screenConfig?:     Record<string, unknown> | null
  /** Soft delete (deleteEvent callable): the event is hidden everywhere; the data is kept and restorable. */
  deletedAt?:        Date | null
  /** Set by the photos backfill once this legacy event's photos (metadata AND binaries) are served from Firebase. Native events never need it. */
  photosMigratedAt?: Date | null
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

/** events/{eventId}/private/gameConfig — owner-only customisation of the games (absent field = defaults). Written only by the setGameConfig callable. */
export interface GameConfigDoc {
  roulettePenitenze?: Array<{ label: string; category: 'soft' | 'party' | 'wild'; enabled: boolean }>
  shoeGameQuestions?: string[]
}

export type PhotoStatus = 'uploading' | 'pending' | 'approved' | 'rejected'
export type PhotoSource = 'guest_upload' | 'live_booth'

/**
 * events/{eventId}/photos/{photoId} — guest album + Live Booth. Created only by createPhotoUpload / finalizePhoto, moderated only by moderatePhoto.
 * The bytes live in Storage at `storagePath` (events/{eventId}/photos/{photoId}/original.{ext}); `legacyStoragePath` is set on backfilled photos whose
 * binary has not been copied yet (they are not served from Firebase until it is).
 */
export interface PhotoDoc {
  id:          string
  guestUid:    string | null
  guestName:   string | null
  caption:     string | null
  source:      PhotoSource
  status:      PhotoStatus
  isFeatured:  boolean
  storagePath: string
  legacySupabaseId?: string
  legacyStoragePath?: string
  createdAt:   Date | null
  updatedAt:   Date | null
}
