/**
 * IOMIXO — Mailer Service
 *
 * Sends transactional emails via SMTP (nodemailer).
 * Falls back to a JSON transport that logs to console when SMTP_HOST
 * is not set (dev/test mode).
 *
 * Required env vars:
 *   SMTP_HOST         — e.g. smtp.resend.com / smtp.sendgrid.net
 *   SMTP_PORT         — default 587
 *   SMTP_USER         — SMTP username / API key
 *   SMTP_PASS         — SMTP password / API secret
 *   MAIL_FROM         — sender address, e.g. "IOMIXO <noreply@iomixo.com>"
 *   FRONTEND_URL      — base URL for links, e.g. https://app.iomixo.com
 */

import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { logger } from '../config/logger'

// ── Transporter singleton ─────────────────────────────────────

let _transporter: Transporter | null = null

function getTransporter(): Transporter {
  if (_transporter) return _transporter

  const host = process.env.SMTP_HOST
  if (!host) {
    // Dev-mode: no SMTP configured — use ethereal stub that logs to console
    _transporter = nodemailer.createTransport({ jsonTransport: true })
    return _transporter
  }

  _transporter = nodemailer.createTransport({
    host,
    port:   parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    pool:            true,
    maxConnections:  5,
    maxMessages:     100,
    connectionTimeout: 10_000,
    greetingTimeout:   10_000,
  })

  return _transporter
}

// ══════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════

/**
 * Verify SMTP connectivity at startup.
 * Call this from index.ts if SMTP is configured.
 * Returns true on success, false on failure (non-fatal).
 */
export async function verifySmtpConnection(): Promise<boolean> {
  if (!process.env.SMTP_HOST) return true  // dev mode always "ok"
  try {
    await getTransporter().verify()
    logger.info('mailer: SMTP connection verified')
    return true
  } catch (err) {
    logger.warn('mailer: SMTP connection failed (emails will be skipped)', { err })
    return false
  }
}

