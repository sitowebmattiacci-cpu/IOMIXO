import { callGuestFunction, GuestCallError } from './guestCallable'

export interface DedicationInput { eventId: string; senderName?: string; message: string }

const MESSAGES: Record<string, string> = {
  cooldown:                'Riprova tra qualche secondo.',
  guest_limit:             'Hai raggiunto il numero massimo di dediche per questa serata.',
  event_ended:             'Questa sessione live è terminata.',
  event_not_found:         'Sessione non trovata',
  invalid_payload:         'Messaggio obbligatorio',
  dedications_unavailable: 'Funzione disponibile con il piano Advance o un Event Pass 24H.',
}

export { GuestCallError as DedicationError }

export async function sendDedication(input: DedicationInput): Promise<{ dedicationId: string }> {
  const r = await callGuestFunction<{ dedicationId: string; projected: boolean }>('createDedication', input, MESSAGES)
  return { dedicationId: r.dedicationId }
}
