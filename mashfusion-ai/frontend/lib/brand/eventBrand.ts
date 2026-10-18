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
  /** Current hostname: the last fallback for a legacy couple album whose owner is not known yet. */
  hostname?: string | null
}

// The event's own data decides (see certainEventPortal: accessMode, then the owner's account type); the hostname is only the last
// fallback when the owner is unknown (server read failed, or a server that does not send owner_account_type yet).
export function eventBrandOf(input: EventBrandInput): EventBrand {
  if (input.type !== 'wedding') return 'iomixo'
  const certain = certainEventPortal(input)
  if (certain) return certain
  return getPortalFromHostname(input.hostname) === 'miolove' ? 'miolove' : 'iomixo'
}

/** Photo features (guest album, Live Booth, photos on the TV screen) exist only on MIOLOVE albums. */
export const hasPhotoFeatures = (brand: EventBrand): boolean => brand === 'miolove'

export const EVENT_BRAND_NAME: Record<EventBrand, string> = { iomixo: 'IOMIXO Live Hub', miolove: 'MIOLOVE ALBUM' }
