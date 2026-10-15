'use client'
import { djToolsBase, publicBaseFor } from './portal'

// Client-side entry points for every public / shared link. Never build an origin by hand: the event type decides the portal (see lib/portal.ts).
const ctx = () => {
  if (typeof window === 'undefined') return { hostname: null, origin: process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? null }
  // On a non-portal host (localhost, hosted.app) the optional public base env keeps the pre-portal behaviour.
  return { hostname: window.location.hostname, origin: process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || window.location.origin }
}

/** Origin for guest-facing links (guest page, Live Booth, QR codes, poster, copied links) of an event: Wedding → MIOLOVE, Party / standard → IOMIXO. */
export const publicOriginFor = (eventType: string | null | undefined): string => publicBaseFor(eventType, ctx())

/** Origin for DJ tools (Remote, Regia): always IOMIXO, whatever the event type. */
export const djToolsOrigin = (): string => djToolsBase(ctx())
