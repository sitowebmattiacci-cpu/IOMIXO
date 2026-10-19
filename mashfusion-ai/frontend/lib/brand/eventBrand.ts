// Which brand an event belongs to. Pure module (no React): used by guest pages, the DJ dashboard, link helpers and unit tests.
//
// MIOLOVE ALBUM owns ONLY the Sposi albums: Wedding events created by a couple account (photo album, Live Booth, poster).
// Everything a DJ runs (standard, Party and Wedding DJ / Wedding Games) is IOMIXO, with no photo features.
import { getPortalFromHostname, type AccountType } from '@/lib/portal'
import { certainEventPortal } from './portalRedirect'

export type EventBrand = 'iomixo' | 'miolove'

export interface EventBrandInput {
  /** Event type: 'standard' | 'party' | 'wedding'. */
  type?: string | null
  /** Owner account type, when known (getPublicEvent `owner_account_type`, or the signed-in owner in the dashboard). */
  ownerAccountType?: AccountType | string | null
  /** events.accessMode: only couple albums ever carry 'trial' / 'activated'. */
  accessMode?: string | null
  /** events.brand: the product the event was created in (explicit, wins over everything else). */
  brand?: string | null
  /** Current hostname: the last fallback for a legacy couple album whose owner is not known yet. */
  hostname?: string | null
}

// The event's own data decides (see certainEventPortal: brand, then accessMode, then the owner's account type); the hostname is only the last
// fallback when the owner is unknown (server read failed, or a server that does not send owner_account_type yet).
export function eventBrandOf(input: EventBrandInput): EventBrand {
  const certain = certainEventPortal(input)
  if (certain) return certain
  if (input.type !== 'wedding') return 'iomixo'
  return getPortalFromHostname(input.hostname) === 'miolove' ? 'miolove' : 'iomixo'
}

/** Brand of one of the SIGNED-IN owner's own events (dashboard lists, detail page). Legacy events without a brand fall back to the owner's account type. */
export function ownedEventBrand(s: { session_type?: string | null; access_mode?: string | null; brand?: string | null }, ownerAccountType: AccountType): EventBrand {
  return eventBrandOf({ type: s.session_type ?? 'standard', brand: s.brand, accessMode: s.access_mode, ownerAccountType })
}

/** The owner's events of ONE product (the dashboard of a portal never lists the other product's events). */
export function sessionsOfBrand<T extends { session_type?: string | null; access_mode?: string | null; brand?: string | null }>(
  list: T[] | undefined, brand: EventBrand, ownerAccountType: AccountType,
): T[] | undefined {
  return list?.filter((s) => ownedEventBrand(s, ownerAccountType) === brand)
}

/** Photo features (guest album, Live Booth, photos on the TV screen) exist only on MIOLOVE albums. */
export const hasPhotoFeatures = (brand: EventBrand): boolean => brand === 'miolove'

export const EVENT_BRAND_NAME: Record<EventBrand, string> = { iomixo: 'IOMIXO Live Hub', miolove: 'MIOLOVE ALBUM' }
