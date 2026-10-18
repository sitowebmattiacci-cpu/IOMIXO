// Cross-portal redirect of the public event pages (guest page, Live Booth, TV screen). Pure module (no React): unit-tested.
//
// An event opened on the wrong domain moves to its own portal, keeping path, slug, query and hash: a DJ event (Party, standard,
// Wedding DJ) lives on iomixo.com, a couple's album on miolovealbum.com. This keeps every QR code / link already printed or shared
// working: it lands on the old domain and is forwarded once.
//
// Loop safety: the target is decided ONLY from the event's own data (type, owner account type, accessMode), never from the current
// host, so on the target host the same event resolves to the same portal and no further redirect happens. When the data is not
// conclusive (owner unknown, e.g. a failed server read) there is no redirect at all.
import { getPortalFromHostname, isMioloveLive, PORTAL_CONFIG, type PortalId } from '@/lib/portal'

export interface EventPortalFacts {
  /** Event type: 'standard' | 'party' | 'wedding'. */
  type?: string | null
  /** getPublicEvent `owner_account_type`: 'dj' | 'couple', or null when the server could not read it. */
  ownerAccountType?: string | null
  /** getPublicEvent `access_mode` / events.accessMode: only couple albums carry 'trial' / 'activated'. */
  accessMode?: string | null
}

/** The portal an event certainly belongs to, or null when its data does not say (no guess from the hostname here). */
export function certainEventPortal(f: EventPortalFacts): PortalId | null {
  if (!f.type) return null
  if (f.type !== 'wedding') return 'iomixo'                                         // only couples own albums, and couples can only create Weddings
  if (f.accessMode === 'trial' || f.accessMode === 'activated') return 'miolove'    // written by the server only for couple albums
  if (f.ownerAccountType === 'couple') return 'miolove'
  if (f.ownerAccountType === 'dj') return 'iomixo'
  return null
}

/** Public event paths that may move between portals (the slug is the only identifier in them). */
const PUBLIC_EVENT_PATH = /^\/(live|booth|screen)\/[^/]+\/?$/

export interface RedirectInput extends EventPortalFacts {
  hostname: string | null | undefined
  pathname: string
  search?: string
  hash?: string
  /** Overrides NEXT_PUBLIC_MIOLOVE_LIVE (tests). */
  mioloveLive?: boolean
}

/** Absolute URL the page must move to, or null to stay. */
export function guestPortalRedirect(input: RedirectInput): string | null {
  const current = getPortalFromHostname(input.hostname)
  if (!current) return null                                                         // localhost / hosted.app / previews: never redirected
  if (!PUBLIC_EVENT_PATH.test(input.pathname)) return null
  const target = certainEventPortal(input)
  if (!target || target === current) return null
  if (target === 'miolove' && !(input.mioloveLive ?? isMioloveLive())) return null  // MIOLOVE domain not connected yet: stay
  return `${PORTAL_CONFIG[target].baseUrl}${input.pathname}${input.search ?? ''}${input.hash ?? ''}`
}
