// Single source of truth for the two portals that share ONE Firebase project / App Hosting backend (iomixo-web).
// Pure module (no React / Next / Firebase imports): used by the server layout, client components, Functions-mirroring tests and unit tests.

export type PortalId = 'iomixo' | 'miolove'
export type AccountType = 'dj' | 'couple'

export interface PortalConfig {
  id: PortalId
  /** Brand shown in the UI and metadata. */
  brand: string
  /** Exact hostnames (no port) that belong to the portal. The first one is the canonical host. */
  hosts: readonly string[]
  /** Canonical origin used for every public / return link generated FOR this portal. */
  baseUrl: string
  /** Role every sign-up on this portal gets (the UI never lets the user pick). */
  accountType: AccountType
  theme: 'party' | 'wedding'
  /** Where a signed-in account of this portal lands. */
  home: string
  meta: { title: string; description: string; ogTitle: string; siteName: string; locale: string }
  /** Browser / home-screen icons of the portal. `favicon` is what a bare /favicon.ico request resolves to. */
  icons: { favicon: string; icon: { url: string; sizes: string; type: string }[]; apple: { url: string; sizes: string } }
}

export const PORTAL_CONFIG: Record<PortalId, PortalConfig> = {
  iomixo: {
    id: 'iomixo',
    brand: 'IOMIXO Live Hub',
    hosts: ['iomixo.com', 'www.iomixo.com'],
    baseUrl: 'https://iomixo.com',
    accountType: 'dj',
    theme: 'party',
    home: '/dashboard',
    meta: {
      title: 'IOMIXO Live Hub — Interactive platform for DJs, karaoke and weddings',
      description: 'Create live QR sessions, receive music requests, run karaoke nights and wedding games, and drive the room from your phone and the big screen.',
      ogTitle: 'IOMIXO Live Hub — Interactive platform for DJs, karaoke and weddings',
      siteName: 'IOMIXO Live Hub',
      locale: 'it_IT',
    },
    icons: {
      favicon: '/brand/iomixo/favicon.ico',
      icon: [
        { url: '/brand/iomixo/favicon.ico', sizes: 'any', type: 'image/x-icon' },
        { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
        { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
        { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      apple: { url: '/apple-touch-icon.png', sizes: '180x180' },
    },
  },
  miolove: {
    id: 'miolove',
    brand: 'MIOLOVE ALBUM',
    hosts: ['miolovealbum.com', 'www.miolovealbum.com'],
    baseUrl: 'https://miolovealbum.com',
    accountType: 'couple',
    theme: 'wedding',
    home: '/sessions',
    meta: {
      title: 'MIOLOVE ALBUM',
      description: "Raccogli le foto degli invitati, condividi il QR code e crea l'album digitale del tuo matrimonio. Senza app da installare.",
      ogTitle: 'MIOLOVE ALBUM — il tuo album digitale di matrimonio',
      siteName: 'MIOLOVE ALBUM',
      locale: 'it_IT',
    },
    icons: {
      favicon: '/brand/miolove/miolove-album-logo-on-light.png',
      icon: [{ url: '/brand/miolove/miolove-album-logo-on-light.png', sizes: '1254x1254', type: 'image/png' }],
      apple: { url: '/brand/miolove/miolove-album-logo-on-light.png', sizes: '1254x1254' },
    },
  },
}

/** Portal used on hosts that belong to none (localhost, emulators, *.hosted.app, previews). Overridable at build time for local QA of the other portal. */
export const DEFAULT_PORTAL: PortalId = process.env.NEXT_PUBLIC_PORTAL_DEFAULT === 'miolove' ? 'miolove' : 'iomixo'

/** "Host:3000" / "WWW.Host" / "a, b" (proxy lists) → "host" / "www.host" / "a". */
export function normalizeHost(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.split(',')[0].trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}

/** The portal a hostname belongs to, or null for any other host (localhost, hosted.app, previews). */
export function getPortalFromHostname(host: string | null | undefined): PortalId | null {
  const h = normalizeHost(host)
  if (!h) return null
  for (const p of Object.values(PORTAL_CONFIG)) if (p.hosts.includes(h)) return p.id
  return null
}

export function getPortalConfig(id: PortalId): PortalConfig { return PORTAL_CONFIG[id] }

export interface ResolvedPortal { config: PortalConfig; /** true = a real portal domain, false = the safe default (dev / preview host) */ matched: boolean }
export function resolvePortal(host: string | null | undefined): ResolvedPortal {
  const id = getPortalFromHostname(host)
  return { config: PORTAL_CONFIG[id ?? DEFAULT_PORTAL], matched: id !== null }
}

/**
 * Portal that owns the PUBLIC links of an event: a Sposi album (Wedding owned by a couple account) → MIOLOVE, everything a DJ runs
 * (party, standard and Wedding DJ) → IOMIXO. `owner` omitted keeps the legacy rule (every Wedding → MIOLOVE).
 */
export const portalForEventType = (type: string | null | undefined, owner?: AccountType | null): PortalId =>
  (type === 'wedding' && owner !== 'dj' ? 'miolove' : 'iomixo')

/**
 * Go-live switch for MIOLOVE-domain links. Until miolovealbum.com is connected to App Hosting, Wedding links keep using the current origin
 * (nothing breaks); set NEXT_PUBLIC_MIOLOVE_LIVE=true (build + runtime env) when the domain answers.
 */
export const isMioloveLive = (): boolean => process.env.NEXT_PUBLIC_MIOLOVE_LIVE === 'true'

export interface LinkContext { hostname?: string | null; origin?: string | null; mioloveLive?: boolean; /** Account type of the event owner (a DJ's Wedding stays on IOMIXO). */ owner?: AccountType | null }
/**
 * Origin for the public/guest links of an event: on a real portal host the canonical base of the event's portal (so a DJ on iomixo.com still gets
 * miolovealbum.com links for a Sposi album, iomixo.com links for a Wedding DJ event); on any other host the current origin, so dev / preview / hosted.app keep working unchanged.
 */
export function publicBaseFor(eventType: string | null | undefined, ctx: LinkContext = {}): string {
  const live = ctx.mioloveLive ?? isMioloveLive()
  const target = portalForEventType(eventType, ctx.owner)
  if (target === 'miolove' && !live) return ctx.origin || PORTAL_CONFIG.iomixo.baseUrl
  if (getPortalFromHostname(ctx.hostname) !== null) return PORTAL_CONFIG[target].baseUrl
  return ctx.origin || PORTAL_CONFIG[target].baseUrl
}

/** DJ tools (Remote, Regia) always live on the IOMIXO portal, even for a Wedding event. */
export function djToolsBase(ctx: LinkContext = {}): string {
  if (getPortalFromHostname(ctx.hostname) !== null) return PORTAL_CONFIG.iomixo.baseUrl
  return ctx.origin || PORTAL_CONFIG.iomixo.baseUrl
}

/** Origin of another portal a Firebase action link (continueUrl) points to, so /auth/action can hop there; null when it is this portal or not a portal. */
export function actionHopOrigin(continueUrl: string | null | undefined, currentHostname: string | null | undefined): string | null {
  if (!continueUrl) return null
  let u: URL
  try { u = new URL(continueUrl) } catch { return null }
  const target = getPortalFromHostname(u.hostname)
  if (!target || u.protocol !== 'https:') return null
  if (getPortalFromHostname(currentHostname) === target) return null
  return PORTAL_CONFIG[target].baseUrl
}
