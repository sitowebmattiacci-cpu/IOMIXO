import { callGuestFunction, GuestCallError } from './guestCallable'

export interface VoteInput { eventId: string; pollId: string; optionIndex: number }
export interface VoteResult { optionIndex: number; changed: boolean; alreadyVoted: boolean }

const MESSAGES: Record<string, string> = {
  poll_closed:     'Sondaggio chiuso.',
  poll_not_found:  'Sondaggio non trovato',
  event_not_found: 'Sessione non trovata',
  event_ended:     'Questa sessione live è terminata.',
  invalid_option:  'Opzione non valida',
  cooldown:        'Riprova tra qualche secondo.',
  already_voted:   'Hai già votato.',
}

export { GuestCallError as VoteError }

export const votePoll = (input: VoteInput) => callGuestFunction<VoteResult>('votePoll', input, MESSAGES)
