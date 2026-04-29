/**
 * MASHFUSION AI — Mailer Service
 *
 * Sends transactional emails via SMTP (nodemailer).
 * Falls back to console.log when SMTP_HOST is not set (dev/test mode).
 *
 * Required env vars:
 *   SMTP_HOST         — e.g. smtp.resend.com / smtp.sendgrid.net
 *   SMTP_PORT         — default 587
 *   SMTP_USER         — SMTP username / API key
 *   SMTP_PASS         — SMTP password / API secret
 *   MAIL_FROM         — sender address, e.g. "MASHFUSION AI <noreply@mashfusion.ai>"
 *   FRONTEND_URL      — base URL for links, e.g. https://app.mashfusion.ai
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

const FROM = process.env.MAIL_FROM   ?? 'MASHFUSION AI <noreply@mashfusion.ai>'
const BASE  = process.env.FRONTEND_URL ?? 'https://app.mashfusion.ai'

// ── Plan labels ───────────────────────────────────────────────

const PLAN_LABEL: Record<string, string> = {
  free:    'Free',
  pro:     'Pro',
  studio:  'Studio',
}

// ── Types ─────────────────────────────────────────────────────

export interface JobCompleteEmailParams {
  to:          string
  userName:    string | null | undefined
  previewUrl:  string | null | undefined
  plan:        string | null | undefined
  jobId?:      string
}

// ══════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ══════════════════════════════════════════════════════════════

function jobCompleteHtml(p: JobCompleteEmailParams): string {
  const name      = p.userName || 'there'
  const dashLink  = p.previewUrl || `${BASE}/dashboard`
  const planLabel = PLAN_LABEL[p.plan ?? ''] ?? 'Free'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your mashup is ready!</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: #0d0d14; color: #e2e8f0; }
  </style>
</head>
<body style="background:#0d0d14; padding: 40px 20px;">
  <table role="presentation" width="100%" style="max-width:560px; margin:0 auto;">
    <tr><td>

      <!-- Header -->
      <div style="text-align:center; margin-bottom:32px;">
        <div style="display:inline-flex; align-items:center; gap:8px;
                    background:linear-gradient(135deg,#7c3aed,#db2777);
                    padding:8px 20px; border-radius:100px;">
          <span style="font-size:16px; font-weight:900; color:#fff; letter-spacing:-0.5px;">
            ✦ MASHFUSION AI
          </span>
        </div>
      </div>

      <!-- Card -->
      <div style="background:#16162a; border:1px solid rgba(124,58,237,0.2);
                  border-radius:20px; padding:40px; text-align:center;">

        <!-- Icon -->
        <div style="width:72px; height:72px; background:linear-gradient(135deg,rgba(124,58,237,0.2),rgba(219,39,119,0.2));
                    border-radius:20px; margin:0 auto 24px; display:flex; align-items:center; justify-content:center;
                    font-size:32px; line-height:72px;">
          🎵
        </div>

        <h1 style="font-size:24px; font-weight:800; color:#fff; margin-bottom:8px;">
          Your mashup is ready!
        </h1>
        <p style="font-size:15px; color:rgba(255,255,255,0.5); margin-bottom:32px;">
          Hey ${name}, the AI has finished processing your track.
        </p>

        <!-- CTA -->
        <a href="${dashLink}"
           style="display:inline-block; background:linear-gradient(135deg,#7c3aed,#9333ea);
                  color:#fff; font-weight:700; font-size:15px; text-decoration:none;
                  padding:14px 36px; border-radius:12px; margin-bottom:32px;">
          Listen &amp; Download →
        </a>

        <hr style="border:none; border-top:1px solid rgba(255,255,255,0.06); margin:0 0 24px;" />

        <!-- Details -->
        <table role="presentation" style="width:100%; text-align:left; border-spacing:0;">
          <tr>
            <td style="padding:6px 0; font-size:13px; color:rgba(255,255,255,0.35);">Plan</td>
            <td style="padding:6px 0; font-size:13px; color:rgba(255,255,255,0.7); text-align:right;">
              ${planLabel}
            </td>
          </tr>
          ${p.jobId ? `
          <tr>
            <td style="padding:6px 0; font-size:13px; color:rgba(255,255,255,0.35);">Job ID</td>
            <td style="padding:6px 0; font-size:11px; color:rgba(255,255,255,0.3); text-align:right; font-family:monospace;">
              ${p.jobId}
            </td>
          </tr>` : ''}
        </table>
      </div>

      <!-- Footer -->
      <p style="text-align:center; font-size:12px; color:rgba(255,255,255,0.2); margin-top:24px;">
        You're receiving this because you have an active MASHFUSION AI account.<br />
        <a href="${BASE}/settings" style="color:rgba(255,255,255,0.3);">Manage email preferences</a>
      </p>

    </td></tr>
  </table>
</body>
</html>`
}

function jobCompleteText(p: JobCompleteEmailParams): string {
  const name = p.userName || 'there'
  const link = p.previewUrl || `${BASE}/dashboard`
  return [
    `MASHFUSION AI — Your mashup is ready!`,
    ``,
    `Hey ${name},`,
    ``,
    `Your AI mashup has finished processing. Head to the dashboard to listen and download:`,
    `${link}`,
    ``,
    `—`,
    `MASHFUSION AI`,
    `${BASE}`,
  ].join('\n')
}

// ══════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════

/**
 * Send a job-complete notification to the user.
 * Never throws — errors are logged and swallowed so the calling
 * webhook handler always returns 200 OK.
 */
export async function sendJobCompleteEmail(p: JobCompleteEmailParams): Promise<void> {
  if (!p.to || !p.to.includes('@')) {
    logger.warn(`mailer: skipping email — invalid address: "${p.to}"`)
    return
  }

  const transporter = getTransporter()
  const msg = {
    from:    FROM,
    to:      p.to,
    subject: '🎵 Your MASHFUSION AI mashup is ready!',
    text:    jobCompleteText(p),
    html:    jobCompleteHtml(p),
  }

  try {
    if (!process.env.SMTP_HOST) {
      // Dev mode: log the email instead of sending
      logger.info(`[mailer DEV] Would send to ${p.to}: ${msg.subject}`)
      logger.debug(`[mailer DEV] ${JSON.stringify(msg, null, 2)}`)
      return
    }

    const info = await transporter.sendMail(msg)
    logger.info(`mailer: sent job-complete email → ${p.to} (messageId=${info.messageId})`)
  } catch (err) {
    // Non-fatal: log and continue
    logger.error(`mailer: failed to send email to ${p.to}`, { err })
  }
}

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
