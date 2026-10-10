import { callGuestFunction, GuestCallError } from './guestCallable'

export interface MusicRequestInput { eventId: string; songTitle: string; artist?: string; message?: string }

/** Messages reuse the legacy wording so the guest UI does not change. */
const MESSAGES: Record<string, string> = {
  cooldown:          'Puoi inviare una richiesta ogni 20 secondi.',
  guest_limit:       'Hai raggiunto il numero massimo di richieste per questa serata.',
  event_limit:       'Il DJ ha raggiunto il limite massimo di richieste per questa sessione.',
  event_ended:       'Questa sessione live è terminata.',
  requests_disabled: 'Le richieste non sono attive per questo evento.',
  event_not_found:   'Sessione non trovata',
  invalid_payload:   'Titolo canzone obbligatorio',
}

export { GuestCallError as RequestError }

export async function sendMusicRequest(input: MusicRequestInput): Promise<{ requestId: string }> {
  const r = await callGuestFunction<{ requestId: string; projected: boolean }>('createMusicRequest', input, MESSAGES)
  return { requestId: r.requestId }
}
