/**
 * Mail transport: the ONLY place that talks to the e-mail provider (Resend, plain REST: no SDK, no new dependency).
 * Brand-agnostic on purpose: a brand owns its own secret, sender and templates (mail/miolove/*); IOMIXO never shares them.
 *
 * Errors carry `retryable`: network failures, 408/425/429, 5xx and 401/403 (an API key / a domain that is not verified YET: fixed in the Resend console, the mail is then
 * delivered by the next attempt) are retried by the outbox; any other 4xx (malformed address, invalid payload) will never succeed and is final.
 */
export interface MailMessage {
  to: string
  from: string
  replyTo?: string
  subject: string
  html: string
  text: string
  /** Same key = same e-mail: the provider drops a repeat (covers a crash between "sent" and our bookkeeping). */
  idempotencyKey: string
  tags?: Array<{ name: string; value: string }>
}
export interface MailTransport { send(m: MailMessage): Promise<{ id: string | null }> }

export class MailError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code: string) { super(message) }
}

const RETRYABLE_STATUS = new Set([401, 403, 408, 425, 429])

export function resendTransport(apiKey: string, fetchImpl: typeof fetch = fetch): MailTransport {
  return {
    async send(m) {
      let res: Response
      try {
        res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'idempotency-key': m.idempotencyKey },
          body: JSON.stringify({ from: m.from, to: [m.to], reply_to: m.replyTo, subject: m.subject, html: m.html, text: m.text, tags: m.tags }),
          signal: AbortSignal.timeout(15_000),
        })
      } catch (e) {
        throw new MailError(String((e as Error)?.message ?? e).slice(0, 120), true, 'network')
      }
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { id?: unknown }
        return { id: typeof body.id === 'string' ? body.id : null }
      }
      throw new MailError(`resend_${res.status}`, res.status >= 500 || RETRYABLE_STATUS.has(res.status), `http_${res.status}`)
    },
  }
}

/** Test / emulator transport: nothing leaves the process. Keeps what it "sent" so a test can read it. */
export function dryRunTransport(): MailTransport & { sent: MailMessage[] } {
  const sent: MailMessage[] = []
  return { sent, async send(m) { sent.push(m); return { id: `dry-${sent.length}` } } }
}

/** MIOLOVE_MAIL_MODE: 'live' = Resend, 'dry' = nothing is sent (emulator / tests), anything else = DISABLED: the queue is kept untouched and drains once it is switched on. */
export type MailMode = 'live' | 'dry' | 'off'
export const mailModeOf = (raw: string | undefined): MailMode => (raw === 'live' || raw === 'dry' ? raw : 'off')
