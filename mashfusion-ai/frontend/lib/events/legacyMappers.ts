import type { EventDoc, UserDoc } from '../firebase/models'
import type { LiveSession } from '../api'
import type { User } from '@/types'

const iso = (d: Date | null) => (d ?? new Date(0)).toISOString()

/**
 * Legacy `LiveSession` shape from an event. `id` stays the Supabase id (dashboard URLs, owner callables) while the event has one;
 * natively created events use the Firestore event id.
 * NOT in the event document (left undefined, never invented): roulette_penitenze / shoe_game_questions (events/{id}/private/gameConfig,
 * merged by the dashboard read path) and online_count (Render presence).
 */
export function eventToSession(e: EventDoc): LiveSession {
  return {
    id: e.legacySupabaseId ?? e.id,
    dj_id: e.ownerUid,
    event_name: e.title,
    dj_name: e.djName,
    description: e.description,
    is_active: e.status === 'live',
    public_slug: e.slug,
    created_at: iso(e.createdAt),
    updated_at: iso(e.updatedAt ?? e.createdAt),
    session_type: e.type,
    couple_names: e.coupleNames,
    wedding_date: e.weddingDate,
    venue_name: e.venueName,
    screen_mode_enabled: e.screenModeEnabled,
    screen_config: (e.screenConfig ?? null) as LiveSession['screen_config'],
    guest_config: (e.guestConfig ?? null) as LiveSession['guest_config'],
  }
}

/** Plan with the same expiry rule as resolveEntitlements: a plan whose validUntil has passed counts as free. */
export function userToLegacy(uid: string, u: UserDoc | null, email: string | null, now = new Date()): User {
  const expired = !!u?.plan.validUntil && u.plan.validUntil.getTime() <= now.getTime()
  return {
    id: u?.legacySupabaseId ?? uid,
    email: u?.email || email || '',
    full_name: u?.displayName ?? null,
    avatar_url: u?.avatarUrl ?? null,
    plan: (expired ? 'free' : u?.plan.tier ?? 'free') as User['plan'],
    credits_remaining: 0,            // not in Firestore (legacy AI-studio credits; no consumer left in the UI)
    credits_reset_at: null,
    created_at: u?.createdAt?.toISOString() ?? '',
  }
}
