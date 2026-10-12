import { getFirebaseDb } from '../firebase/client'
import { waitForAuthReady } from '../firebase/auth'
import { eventToSession, userToLegacy } from './legacyMappers'
import { listOwnerEvents } from '../firebase/repositories/eventRepository'
import { getUser, listEventPasses } from '../firebase/repositories/userRepository'
import { dashboardOn, resolveOwnerEvent } from './ownerService'
import { getGameConfig } from '../firebase/repositories/eventRepository'
import type { LiveSession } from '../api'
import type { EventPass, User } from '@/types'

/**
 * Dashboard READ path on Firestore (owner, no Render): sessions list/detail, account profile + plan, Event Passes.
 * Every method resolves to `null` when it does not apply (flag off, not a Firebase account, event not in Firestore) so lib/api.ts
 * keeps the legacy Express route. Reads are direct Firestore reads allowed by the rules to the owner; nothing is computed server-side
 * (the plan/pass decision stays in lib/access.ts, which mirrors functions/src/entitlements/resolve.ts).
 *
 * Switch: NEXT_PUBLIC_FIRESTORE_DASHBOARD=on|true (default off → behaviour unchanged).
 */
export const dashboardEnabled = dashboardOn

async function account() {
  const user = await waitForAuthReady()
  return user && !user.isAnonymous ? user : null
}

export { eventToSession, userToLegacy }

const iso = (d: Date | null) => (d ?? new Date(0)).toISOString()

export const dashboardOps = {
  /** Owner's events, newest first (bounded 50). `null` = no event in Firestore (soft-deleted ones included) for an account migrated from Supabase (the caller may still try the legacy route); an empty array = nothing to show. */
  async listSessions(): Promise<LiveSession[] | null> {
    if (!dashboardEnabled()) return null
    const user = await account(); if (!user) return null
    const db = getFirebaseDb()
    const all = await listOwnerEvents(db, user.uid, 50, { includeDeleted: true })
    if (all.length > 0) return all.filter((e) => !e.deletedAt).map(eventToSession)
    // Nothing in Firestore (not even deleted events). Only an account migrated from Supabase can still own legacy sessions that were not
    // backfilled: for it the caller may ask the legacy route. A Firebase-native account has nowhere else to look.
    return (await getUser(db, user.uid))?.legacySupabaseId ? null : []
  },

  /** The event + the owner-private games customisation. `hasLegacy` = a Supabase row exists (only then Render may know the presence count). */
  async getSession(id: string): Promise<{ session: LiveSession; hasLegacy: boolean } | null> {
    if (!dashboardEnabled()) return null
    const ev = await resolveOwnerEvent(id); if (!ev) return null
    const cfg = await getGameConfig(getFirebaseDb(), ev.id)
    return {
      session: { ...eventToSession(ev), roulette_penitenze: cfg?.roulettePenitenze ?? null, shoe_game_questions: cfg?.shoeGameQuestions ?? null },
      hasLegacy: Boolean(ev.legacySupabaseId),
    }
  },

  /** users/{uid} in the legacy `User` shape. A missing document reads as FREE (nothing is written from a read path). */
  async me(): Promise<User | null> {
    if (!dashboardEnabled()) return null
    const user = await account(); if (!user) return null
    return userToLegacy(user.uid, await getUser(getFirebaseDb(), user.uid), user.email)
  },

  /** users/{uid}/eventPasses in the legacy `event_passes` row shape (newest first, max 10 like the route). */
  async eventPasses(): Promise<EventPass[] | null> {
    if (!dashboardEnabled()) return null
    const user = await account(); if (!user) return null
    const db = getFirebaseDb()
    const [profile, passes] = await Promise.all([getUser(db, user.uid), listEventPasses(db, user.uid)])
    return passes.slice(0, 10).map((p) => ({
      id: p.legacySupabaseId ?? p.id,
      user_id: profile?.legacySupabaseId ?? user.uid,
      session_id: p.legacySessionId ?? p.eventId ?? null,
      stripe_payment_intent_id: p.stripePaymentIntentId ?? null,
      amount_cents: p.amountCents,
      currency: p.currency,
      valid_until: p.validUntil.toISOString(),
      status: p.status,
      created_at: iso(p.createdAt),
      updated_at: iso(p.updatedAt ?? p.createdAt),
    }))
  },
}
