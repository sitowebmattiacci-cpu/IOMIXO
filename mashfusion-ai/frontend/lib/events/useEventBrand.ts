'use client'
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { authProvider } from '../auth'
import { resolveEventIdForGuest, watchEvent } from './eventService'
import { fetchPublicLive } from './publicEventService'
import { eventBrandOf, type EventBrand } from '../brand/eventBrand'
import { certainEventPortal, guestPortalRedirect } from '../brand/portalRedirect'

/**
 * Brand of a public event page (guest page, Live Booth, TV screen). `undefined` while it is being decided (or while the page moves to
 * its own portal), so a page never flashes the wrong brand or blocks a MIOLOVE album by mistake.
 *
 * Source of truth: the owner's account type sent by getPublicEvent (`owner_account_type`, same SWR entry as the guest page), so historic
 * events without accessMode keep their brand too. accessMode (payload or the event doc) and then the hostname are only fallbacks, for an
 * owner the server could not read or a server that does not send the field yet. When the event certainly belongs to the other portal,
 * the page is replaced by the same path on that portal (QR codes and links already shared keep working; see lib/brand/portalRedirect).
 */
export function useEventBrand(slug: string | undefined, eventType: string | null | undefined): EventBrand | undefined {
  const isWedding = eventType === 'wedding'
  const firebase = authProvider() === 'firebase'
  const { data: payload, error: payloadError } = useSWR(
    slug && eventType && firebase ? ['public-live', slug] : null,
    () => fetchPublicLive(slug!),
  )
  const [watchedAccessMode, setWatchedAccessMode] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    setWatchedAccessMode(undefined)
    if (!slug || !isWedding) return
    if (!firebase) { setWatchedAccessMode(null); return }
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    resolveEventIdForGuest(slug)
      .then((id) => {
        if (cancelled) return
        if (!id) { setWatchedAccessMode(null); return }
        unsubscribe = watchEvent(id, (e) => !cancelled && setWatchedAccessMode(e?.accessMode ?? null), () => !cancelled && setWatchedAccessMode(null))
      })
      .catch(() => { if (!cancelled) setWatchedAccessMode(null) })
    return () => { cancelled = true; unsubscribe?.() }
  }, [slug, isWedding, firebase])

  const loc = typeof window === 'undefined' ? null : window.location
  const facts = {
    type: eventType,
    ownerAccountType: payload?.session.owner_account_type ?? null,
    accessMode: payload?.session.access_mode ?? watchedAccessMode ?? null,
    brand: payload?.session.event_brand ?? null,
  }
  const certain = certainEventPortal(facts)
  const redirectTo = certain && loc
    ? guestPortalRedirect({ ...facts, hostname: loc.hostname, pathname: loc.pathname, search: loc.search, hash: loc.hash })
    : null

  useEffect(() => { if (redirectTo) window.location.replace(redirectTo) }, [redirectTo])

  if (!eventType || redirectTo) return undefined
  if (certain) return certain
  // Wedding with no conclusive data yet: wait for the payload and the event doc before falling back to the hostname.
  const payloadPending = firebase && !!slug && payload === undefined && !payloadError
  if (payloadPending || watchedAccessMode === undefined) return undefined
  return eventBrandOf({ ...facts, hostname: loc?.hostname ?? null })
}
