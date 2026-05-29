/**
 * Helper centralizzato per i tipi di sessione "evento" (party + wedding).
 *
 * Una sessione è di tipo "event" quando ha le funzioni interattive abilitate
 * (booth, screen, foto, polls, dediche, giochi). Sono Party Mode e Wedding
 * Edition: la prima è la modalità per serate DJ/locali/compleanni, la seconda
 * è la modalità matrimonio.
 *
 * NOTA: Mantenere allineato con la CHECK constraint in
 * database/migrations/015_advance_rebrand.sql:
 *   session_type IN ('standard','party','wedding')
 */

export const EVENT_SESSION_TYPES = ['party', 'wedding'] as const
export type EventSessionType = typeof EVENT_SESSION_TYPES[number]

export function isEventSession(sessionType?: string | null): boolean {
  return sessionType === 'wedding' || sessionType === 'party'
}
