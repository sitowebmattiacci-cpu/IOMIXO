import { httpsCallable } from 'firebase/functions'
import { getFirebaseFunctions } from '../firebase/client'
import { ensureAnonymousSession } from '../firebase/auth'

/**
 * Shared client side of the guest callables (music requests, dedications): ensures an
 * (anonymous) identity, calls the function, and turns failures into a GuestCallError telling
 * the caller whether to fall back to the legacy Express endpoint.
 */
export class GuestCallError extends Error {
  constructor(message: string, readonly reason: string | null, readonly fallbackToLegacy: boolean) { super(message) }
}

/** Reasons/codes for which the caller should transparently use the legacy endpoint. */
const FALLBACK_REASONS = new Set(['event_not_ready', 'bridge_failed'])
const FALLBACK_CODES = new Set(['functions/unavailable', 'functions/internal', 'functions/not-found', 'functions/deadline-exceeded'])

export async function callGuestFunction<Out>(
  name: string, payload: object, messages: Record<string, string>,
): Promise<Out> {
  await ensureAnonymousSession()
  try {
    return (await httpsCallable<object, Out>(getFirebaseFunctions(), name)(payload)).data
  } catch (e) {
    const err = e as { code?: string; message?: string; details?: { reason?: string } }
    const reason = err.details?.reason ?? null
    const fallback = (reason !== null && FALLBACK_REASONS.has(reason)) || (reason === null && (!err.code || FALLBACK_CODES.has(err.code)))
    throw new GuestCallError((reason && messages[reason]) || err.message || 'Request failed', reason, fallback)
  }
}
