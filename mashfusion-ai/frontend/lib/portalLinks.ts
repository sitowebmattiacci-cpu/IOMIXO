'use client'
import { djToolsBase, publicBaseFor, type AccountType } from './portal'

// Client-side entry points for every public / shared link. Never build an origin by hand: the event type decides the portal (see lib/portal.ts).
const ctx = () => {
  if (typeof window === 'undefined') return { hostname: null, origin: process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? null }
  // On a non-portal host (localhost, hosted.app) the optional public base env keeps the pre-portal behaviour.
  return { hostname: window.location.hostname, origin: process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || window.location.origin }
}

/**
 * Origin for guest-facing links (guest page, Live Booth, QR codes, poster, copied links) of an event: Sposi album → MIOLOVE,
 * Party / standard / Wedding DJ → IOMIXO. Pass the owner's account type whenever it is known (the dashboard always knows it).
 */
export const publicOriginFor = (eventType: string | null | undefined, owner?: AccountType | null): string => publicBaseFor(eventType, { ...ctx(), owner })

/** Origin for DJ tools (Remote, Regia): always IOMIXO, whatever the event type. */
export const djToolsOrigin = (): string => djToolsBase(ctx())
