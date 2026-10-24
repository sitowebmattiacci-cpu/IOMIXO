/**
 * MIOLOVE account e-mails (address verification, password reset): 2 e-mails × 4 languages, same identity as the album e-mails (logo, colours, sender).
 * Pure module (no I/O). The action link is built by authMail.ts and passed in; it is only ever put in the button and in the text twin.
 */
import { DEFAULT_MIOLOVE_BASE_URL, MIOLOVE_REPLY_TO, esc, type MailLocale } from './templates'

export type AuthMailKind = 'verify_email' | 'reset_password'
export const AUTH_MAIL_KINDS: readonly AuthMailKind[] = ['verify_email', 'reset_password']

interface AuthCopy { subject: string; pre: string; h: string; p: string[]; cta: string; ignore: string; fallback: string }

const COPY: Record<MailLocale, Record<AuthMailKind, AuthCopy>> = {
  it: {
    verify_email: { subject: 'Conferma il tuo indirizzo e-mail per MIOLOVE Album', pre: 'Un ultimo passo per attivare il tuo account.', h: 'Conferma il tuo indirizzo e-mail',
      p: ['Grazie per aver scelto MIOLOVE Album! Conferma il tuo indirizzo e-mail per completare la registrazione e proteggere il tuo account.', 'Il pulsante può essere usato una sola volta ed è valido per un tempo limitato.'],
      cta: 'Conferma l’indirizzo e-mail', ignore: 'Se non hai creato tu l’account puoi ignorare questa e-mail: non verrà fatto nulla.', fallback: 'Se il pulsante non funziona, copia e incolla questo indirizzo nel browser:' },
    reset_password: { subject: 'Reimposta la password di MIOLOVE Album', pre: 'Scegli una nuova password per il tuo account.', h: 'Reimposta la tua password',
      p: ['Abbiamo ricevuto una richiesta per reimpostare la password del tuo account MIOLOVE Album.', 'Il pulsante può essere usato una sola volta ed è valido per un tempo limitato.'],
      cta: 'Scegli una nuova password', ignore: 'Se non hai fatto tu la richiesta puoi ignorare questa e-mail: la tua password resta invariata.', fallback: 'Se il pulsante non funziona, copia e incolla questo indirizzo nel browser:' },
  },
  en: {
    verify_email: { subject: 'Confirm your e-mail address for MIOLOVE Album', pre: 'One last step to activate your account.', h: 'Confirm your e-mail address',
      p: ['Thank you for choosing MIOLOVE Album! Confirm your e-mail address to complete your registration and protect your account.', 'The button can be used only once and is valid for a limited time.'],
      cta: 'Confirm e-mail address', ignore: 'If you did not create this account you can ignore this e-mail: nothing will happen.', fallback: 'If the button does not work, copy and paste this address into your browser:' },
    reset_password: { subject: 'Reset your MIOLOVE Album password', pre: 'Choose a new password for your account.', h: 'Reset your password',
      p: ['We received a request to reset the password of your MIOLOVE Album account.', 'The button can be used only once and is valid for a limited time.'],
      cta: 'Choose a new password', ignore: 'If you did not make this request you can ignore this e-mail: your password stays the same.', fallback: 'If the button does not work, copy and paste this address into your browser:' },
  },
  fr: {
    verify_email: { subject: 'Confirmez votre adresse e-mail pour MIOLOVE Album', pre: 'Une dernière étape pour activer votre compte.', h: 'Confirmez votre adresse e-mail',
      p: ['Merci d’avoir choisi MIOLOVE Album ! Confirmez votre adresse e-mail pour terminer votre inscription et protéger votre compte.', 'Le bouton ne peut être utilisé qu’une seule fois et n’est valable que pour une durée limitée.'],
      cta: 'Confirmer l’adresse e-mail', ignore: 'Si vous n’avez pas créé ce compte, vous pouvez ignorer cet e-mail : rien ne sera fait.', fallback: 'Si le bouton ne fonctionne pas, copiez et collez cette adresse dans votre navigateur :' },
    reset_password: { subject: 'Réinitialisez votre mot de passe MIOLOVE Album', pre: 'Choisissez un nouveau mot de passe pour votre compte.', h: 'Réinitialisez votre mot de passe',
      p: ['Nous avons reçu une demande de réinitialisation du mot de passe de votre compte MIOLOVE Album.', 'Le bouton ne peut être utilisé qu’une seule fois et n’est valable que pour une durée limitée.'],
      cta: 'Choisir un nouveau mot de passe', ignore: 'Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail : votre mot de passe reste inchangé.', fallback: 'Si le bouton ne fonctionne pas, copiez et collez cette adresse dans votre navigateur :' },
  },
  es: {
    verify_email: { subject: 'Confirma tu correo electrónico en MIOLOVE Album', pre: 'Un último paso para activar tu cuenta.', h: 'Confirma tu correo electrónico',
      p: ['¡Gracias por elegir MIOLOVE Album! Confirma tu correo electrónico para completar el registro y proteger tu cuenta.', 'El botón solo se puede usar una vez y es válido durante un tiempo limitado.'],
      cta: 'Confirmar correo electrónico', ignore: 'Si no has creado tú esta cuenta, puedes ignorar este correo: no se hará nada.', fallback: 'Si el botón no funciona, copia y pega esta dirección en tu navegador:' },
    reset_password: { subject: 'Restablece tu contraseña de MIOLOVE Album', pre: 'Elige una nueva contraseña para tu cuenta.', h: 'Restablece tu contraseña',
      p: ['Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de MIOLOVE Album.', 'El botón solo se puede usar una vez y es válido durante un tiempo limitado.'],
      cta: 'Elegir una nueva contraseña', ignore: 'Si no has hecho tú esta solicitud, puedes ignorar este correo: tu contraseña no cambia.', fallback: 'Si el botón no funciona, copia y pega esta dirección en tu navegador:' },
  },
}

const FOOT: Record<MailLocale, { why: string; help: string }> = {
  it: { why: 'Hai ricevuto questa e-mail perché è stata fatta una richiesta con questo indirizzo su MIOLOVE Album.', help: 'Per assistenza rispondi a questa e-mail o scrivi a' },
  en: { why: 'You received this e-mail because a request was made with this address on MIOLOVE Album.', help: 'For help, reply to this e-mail or write to' },
  fr: { why: 'Vous recevez cet e-mail car une demande a été faite avec cette adresse sur MIOLOVE Album.', help: 'Pour toute aide, répondez à cet e-mail ou écrivez à' },
  es: { why: 'Has recibido este correo porque se hizo una solicitud con esta dirección en MIOLOVE Album.', help: 'Para ayuda, responde a este correo o escribe a' },
}

export interface AuthRenderInput { kind: AuthMailKind; locale: MailLocale; link: string; baseUrl?: string }
export interface RenderedAuthMail { subject: string; html: string; text: string }

export function renderAuthMail(i: AuthRenderInput): RenderedAuthMail {
  const c = COPY[i.locale][i.kind], f = FOOT[i.locale], base = (i.baseUrl ?? DEFAULT_MIOLOVE_BASE_URL).replace(/\/+$/, '')
  const html = `<!doctype html>
<html lang="${i.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(c.subject)}</title>
<style>@media only screen and (max-width:620px){.wrap{width:100%!important}.card{padding:28px 20px!important}.btn a{display:block!important}h1{font-size:24px!important}}</style></head>
<body style="margin:0;padding:0;background:#FFF5F9;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#FFF5F9;">${esc(c.pre)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FFF5F9;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="wrap" width="600" cellspacing="0" cellpadding="0" style="width:600px;max-width:600px;">
<tr><td align="center" style="padding:8px 0 20px;"><a href="${esc(base)}" style="text-decoration:none;"><img src="${esc(base)}/brand/miolove/email/miolove-email-logo.png" width="190" alt="MIOLOVE Album" style="display:block;border:0;width:190px;max-width:70%;height:auto;font:700 20px Arial,sans-serif;color:#F06A9B;"></a></td></tr>
<tr><td class="card" style="background:#FFFFFF;border:1px solid #F3D3E0;border-radius:20px;padding:36px 36px 32px;font-family:Arial,Helvetica,sans-serif;color:#2B2424;">
<h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#2B2424;">${esc(c.h)}</h1>
${c.p.map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#2B2424;">${esc(p)}</p>`).join('\n')}
<table role="presentation" class="btn" cellspacing="0" cellpadding="0" style="margin:22px 0 6px;"><tr><td style="border-radius:14px;background:#F06A9B;"><a href="${esc(i.link)}" style="display:inline-block;padding:14px 26px;font:700 16px Arial,Helvetica,sans-serif;color:#FFFFFF;text-decoration:none;border-radius:14px;">${esc(c.cta)}</a></td></tr></table>
<p style="margin:18px 0 6px;font-size:13px;line-height:1.5;color:#6E6468;">${esc(c.ignore)}</p>
<p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:#8A7F85;">${esc(c.fallback)}<br><a href="${esc(i.link)}" style="color:#8A7F85;word-break:break-all;">${esc(i.link)}</a></p>
</td></tr>
<tr><td align="center" style="padding:20px 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8A7F85;">${esc(f.why)}<br>${esc(f.help)} <a href="mailto:${MIOLOVE_REPLY_TO}" style="color:#8A7F85;">${MIOLOVE_REPLY_TO}</a><br>MIOLOVE Album · miolovealbum.com</td></tr>
</table></td></tr></table></body></html>`
  const text = [c.h, '', ...c.p.flatMap((p) => [p, '']), `${c.cta}: ${i.link}`, '', c.ignore, '', '--', f.why, `${f.help} ${MIOLOVE_REPLY_TO}`, 'MIOLOVE Album · miolovealbum.com'].join('\n')
  return { subject: c.subject, html, text }
}
