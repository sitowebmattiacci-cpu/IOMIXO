import type { Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { str } from '../requests/validation'
import { fail } from '../shared/guard'
import { loadEventEntitlements } from '../entitlements/load'
import { PLAN_LIMITS } from '../entitlements/plans'

export function parseSlug(data: unknown): string {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const slug = str(d.slug, 'slug', 200, true)!
  if (slug.includes('/')) throw new HttpsError('invalid-argument', 'invalid slug', { reason: 'invalid_payload', field: 'slug' })
  return slug
}

/**
 * Replacement of GET /api/live/public/:slug. Same payload shape (snake_case, so the guest page does not change), computed server-side:
 * plan / branding / features / profile socials depend on the owner's EFFECTIVE entitlements, which clients cannot read.
 * `events` (upcoming gigs, Supabase dj_events) has no Firestore home yet → always []. Any signed-in identity (incl. anonymous guests).
 */
export async function getPublicEvent(db: Firestore, slug: string, now: Date = new Date()) {
  const s = await db.collection('eventSlugs').doc(slug).get()
  if (!s.exists) throw fail('not-found', 'Event not found', 'event_not_found')
  const eventId = String(s.data()!.eventId)
  const evSnap = await db.collection('events').doc(eventId).get()
  if (!evSnap.exists) throw fail('not-found', 'Event not found', 'event_not_found')
  const e = evSnap.data()!
  const ent = await loadEventEntitlements(db, eventId, now)
  const limits = PLAN_LIMITS[ent.effectiveTier]

  const [profileSnap, counter] = await Promise.all([
    db.collection('djProfiles').doc(ent.ownerUid).get(),
    db.collection('events').doc(eventId).collection('state').doc('requests').get(),
  ])
  const p = profileSnap.data()
  const social = (v: unknown) => (limits.profileSocials ? (v ?? null) : null)
  const used = counter.exists ? Number(counter.data()!.total ?? 0) : 0
  return {
    eventId,
    session: {
      id: eventId, event_name: e.title, dj_name: e.djName ?? null, description: e.description ?? null, is_active: e.status === 'live',
      session_type: e.type ?? 'standard', couple_names: e.coupleNames ?? null, wedding_date: e.weddingDate ?? null, venue_name: e.venueName ?? null,
      screen_mode_enabled: e.screenModeEnabled === true, guest_config: e.guestConfig ?? null,
    },
    profile: p ? {
      display_name: p.displayName ?? null, bio: p.bio ?? null, avatar_url: p.avatarUrl ?? null,
      instagram_url: social(p.instagramUrl), tiktok_url: social(p.tiktokUrl), spotify_url: social(p.spotifyUrl),
      soundcloud_url: social(p.soundcloudUrl), website_url: social(p.websiteUrl),
    } : null,
    events: [] as unknown[],
    plan: ent.effectiveTier,
    branding: limits.customBranding,
    features: {
      weddingDedications: limits.weddingDedications, weddingGames: limits.weddingGames, livePolls: limits.livePolls,
      guestPhotoAlbum: limits.guestPhotoAlbum, screenMode: limits.screenMode,
    },
    requestsRemaining: Number.isFinite(limits.maxRequestsPerSession) ? Math.max(0, limits.maxRequestsPerSession - used) : null,
  }
}
