import type { Firestore } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { requireAccount, type CallerAuth } from '../../owner/guard'
import { parseMailLocale, type MailLocale } from './templates'

/** The language of an account's e-mails: users/{uid}.locale (server-written only: firestore.rules do not allow a client to set it). */
export function parseSetMailLocaleInput(data: unknown): { locale: MailLocale } {
  const locale = parseMailLocale(data && typeof data === 'object' ? (data as Record<string, unknown>).locale : undefined)
  if (!locale) throw new HttpsError('invalid-argument', 'invalid locale', { reason: 'invalid_payload', field: 'locale' })
  return { locale }
}

/** Saves the caller's language. A missing account document is left alone (never created here: a bare document would look like a legacy DJ account). */
export async function setMailLocale(db: Firestore, request: CallerAuth, input: { locale: MailLocale }): Promise<{ saved: boolean }> {
  const uid = requireAccount(request)
  try { await db.doc(`users/${uid}`).update({ locale: input.locale, localeUpdatedAt: FieldValue.serverTimestamp() }); return { saved: true } }
  catch (e) { if ((e as { code?: number }).code === 5) return { saved: false }; throw e }                       // 5 = NOT_FOUND
}
