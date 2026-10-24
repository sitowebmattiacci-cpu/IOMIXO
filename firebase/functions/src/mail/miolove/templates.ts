/**
 * MIOLOVE e-mail templates: 10 e-mails × 4 languages (it / en / fr / es), one responsive HTML layout with the MIOLOVE identity + a plain-text twin.
 * Pure module (no I/O). Every e-mail is about ONE album: its title, ITS date and links that open THAT album.
 */
import { MIOLOVE_TRIAL_DAYS, MIOLOVE_TRIAL_PHOTO_LIMIT } from '../../photos/trialQuota'

export const MAIL_LOCALES = ['it', 'en', 'fr', 'es'] as const
export type MailLocale = (typeof MAIL_LOCALES)[number]
export const DEFAULT_MAIL_LOCALE: MailLocale = 'it'
export const parseMailLocale = (raw: unknown): MailLocale | null => ((MAIL_LOCALES as readonly unknown[]).includes(raw) ? (raw as MailLocale) : null)

export const MAIL_KINDS = [
  'trial_started', 'trial_ending', 'trial_ended', 'trial_purge_soon', 'trial_deleted',
  'album_activated', 'album_expiry_30', 'album_expiry_7', 'album_expiry_1', 'album_deleted',
] as const
export type MailKind = (typeof MAIL_KINDS)[number]

export const MIOLOVE_SENDER = 'MIOLOVE Album <info@miolovealbum.com>'
export const MIOLOVE_REPLY_TO = 'info@miolovealbum.com'
export const DEFAULT_MIOLOVE_BASE_URL = 'https://miolovealbum.com'

/** Snapshot taken when the e-mail is queued (dates as epoch ms): the e-mail is rendered from it, whatever happens to the album afterwards. */
export interface MailVars {
  title: string; trialEndsAtMs?: number; expiresAtMs?: number; purgeAtMs?: number
  /** What the buyer REALLY paid, from the signature-verified Stripe session (amount_total in minor units + currency). Only set when both are reliable; the e-mail shows it or says nothing. */
  amountCents?: number; currency?: string
}
type Target = 'album' | 'photos' | 'new'
interface Copy { /** Extra paragraph shown only when the paid amount is known. */ paid?: string; subject: string; pre: string; h: string; p: string[]; cta: string; to: Target; also?: { label: string; to: Target } }

const DATE_LOCALE: Record<MailLocale, string> = { it: 'it-IT', en: 'en-GB', fr: 'fr-FR', es: 'es-ES' }
export const formatMailDate = (ms: number, locale: MailLocale): string => new Date(ms).toLocaleDateString(DATE_LOCALE[locale], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' })

// Currency is formatted for the e-mail's language; English uses en-US so USD reads "$19.99" (en-GB would print "US$19.99").
const MONEY_LOCALE: Record<MailLocale, string> = { it: 'it-IT', en: 'en-US', fr: 'fr-FR', es: 'es-ES' }
/** "19,99 €" / "$19.99"... or null when the amount or the currency is not a reliable positive value (then the e-mail simply leaves it out). */
export function formatMailAmount(cents: unknown, currency: unknown, locale: MailLocale): string | null {
  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents <= 0 || typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency)) return null
  try { return new Intl.NumberFormat(MONEY_LOCALE[locale], { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100) } catch { return null }
}

/** Which stored date each e-mail talks about. */
const DATE_OF: Record<MailKind, keyof Omit<MailVars, 'title'> | null> = {
  trial_started: 'trialEndsAtMs', trial_ending: 'trialEndsAtMs', trial_ended: 'purgeAtMs', trial_purge_soon: 'purgeAtMs', trial_deleted: null,
  album_activated: 'expiresAtMs', album_expiry_30: 'expiresAtMs', album_expiry_7: 'expiresAtMs', album_expiry_1: 'expiresAtMs', album_deleted: null,
}

const COPY: Record<MailLocale, Record<MailKind, Copy>> = {
  it: {
    trial_started: { subject: 'Il tuo album “{title}” è pronto', pre: 'La prova gratuita è iniziata.', h: 'Il tuo album è pronto',
      p: ['Hai creato l’album “{title}” e la prova gratuita è iniziata: dura {days} giorni e comprende al massimo {limit} tra foto e video in totale. Puoi provare il QR, il caricamento degli ospiti e lo schermo.', 'La prova termina il {date}. Per tenere l’album e continuare a raccogliere ricordi potrai attivarlo in qualsiasi momento.'], cta: 'Apri il tuo album', to: 'album' },
    trial_ending: { subject: 'La prova di “{title}” sta per finire', pre: 'Attiva l’album per non interrompere i caricamenti.', h: 'La prova gratuita sta per finire',
      p: ['La prova gratuita dell’album “{title}” termina il {date}.', 'Dopo quella data i caricamenti si fermano. Attiva l’album per continuare a raccogliere foto e video per 365 giorni.'], cta: 'Attiva l’album', to: 'album', also: { label: 'Scarica i tuoi contenuti', to: 'photos' } },
    trial_ended: { subject: 'La prova di “{title}” è terminata', pre: 'Hai ancora tempo per attivare l’album o scaricare i contenuti.', h: 'La prova gratuita è terminata',
      p: ['La prova gratuita dell’album “{title}” è finita e i caricamenti sono in pausa.', 'Foto e video restano al sicuro fino al {date}: entro quella data puoi attivare l’album oppure scaricare i tuoi contenuti. Dopo, l’album verrà eliminato definitivamente.'], cta: 'Attiva l’album', to: 'album', also: { label: 'Scarica i tuoi contenuti', to: 'photos' } },
    trial_purge_soon: { subject: 'Ultimi giorni per salvare “{title}”', pre: 'L’album verrà eliminato il {date}.', h: 'Scarica i tuoi ricordi',
      p: ['L’album “{title}” verrà eliminato definitivamente il {date}, insieme a tutte le sue foto e i suoi video.', 'Scarica ora i tuoi contenuti, oppure attiva l’album per conservarlo per 365 giorni.'], cta: 'Scarica i tuoi contenuti', to: 'photos', also: { label: 'Attiva l’album', to: 'album' } },
    trial_deleted: { subject: 'L’album “{title}” è stato eliminato', pre: 'Il periodo di recupero è terminato.', h: 'Album eliminato',
      p: ['Il periodo di prova e di recupero dell’album “{title}” è terminato: foto, video e link sono stati eliminati definitivamente.', 'Puoi creare un nuovo album quando vuoi.'], cta: 'Crea un nuovo album', to: 'new' },
    album_activated: { paid: 'Importo pagato: {amount}.', subject: 'Il tuo album “{title}” è attivo', pre: 'Disponibile per 365 giorni.', h: 'Album attivato, grazie!',
      p: ['L’album “{title}” è attivo ed è disponibile fino al {date} (365 giorni).', 'Puoi raccogliere foto e video senza limiti di prova e scaricare tutto in un unico file quando vuoi.'], cta: 'Apri il tuo album', to: 'album' },
    album_expiry_30: { subject: '“{title}” scade tra 30 giorni', pre: 'Scarica i tuoi contenuti prima del {date}.', h: 'Il tuo album scade tra 30 giorni',
      p: ['L’album “{title}” è disponibile fino al {date}. Dopo quella data foto e video vengono eliminati definitivamente.', 'Ti consigliamo di scaricare ora tutti i contenuti in un unico file ZIP.'], cta: 'Vai all’album e scarica tutto', to: 'photos' },
    album_expiry_7: { subject: '“{title}” scade tra 7 giorni', pre: 'Scarica i tuoi contenuti prima del {date}.', h: 'Mancano 7 giorni',
      p: ['L’album “{title}” scade il {date}: da quel momento foto e video non saranno più recuperabili.', 'Scarica ora i tuoi ricordi in un unico file ZIP.'], cta: 'Vai all’album e scarica tutto', to: 'photos' },
    album_expiry_1: { subject: 'Ultimo giorno per scaricare “{title}”', pre: 'L’album scade il {date}.', h: 'Ultimo giorno',
      p: ['L’album “{title}” scade il {date} e verrà eliminato definitivamente.', 'Scarica adesso tutti i tuoi contenuti: dopo non sarà più possibile recuperarli.'], cta: 'Vai all’album e scarica tutto', to: 'photos' },
    album_deleted: { subject: 'L’album “{title}” è stato eliminato', pre: 'I 365 giorni sono terminati.', h: 'Album eliminato',
      p: ['I 365 giorni dell’album “{title}” sono terminati: foto, video e link sono stati eliminati definitivamente, come previsto.', 'Grazie per aver scelto MIOLOVE Album. Puoi creare un nuovo album quando vuoi.'], cta: 'Crea un nuovo album', to: 'new' },
  },
  en: {
    trial_started: { subject: 'Your album “{title}” is ready', pre: 'Your free trial has started.', h: 'Your album is ready',
      p: ['You created the album “{title}” and your free trial has started: it lasts {days} days and includes a maximum of {limit} photos and videos in total. You can try the QR code, guest uploads and the screen.', 'The trial ends on {date}. To keep the album and keep collecting memories, you can activate it at any time.'], cta: 'Open your album', to: 'album' },
    trial_ending: { subject: 'The trial of “{title}” is about to end', pre: 'Activate the album to keep uploads going.', h: 'Your free trial is about to end',
      p: ['The free trial of the album “{title}” ends on {date}.', 'After that date uploads stop. Activate the album to keep collecting photos and videos for 365 days.'], cta: 'Activate the album', to: 'album', also: { label: 'Download your content', to: 'photos' } },
    trial_ended: { subject: 'The trial of “{title}” has ended', pre: 'You still have time to activate it or download your content.', h: 'Your free trial has ended',
      p: ['The free trial of the album “{title}” is over and uploads are paused.', 'Your photos and videos are safe until {date}: by then you can activate the album or download your content. After that, the album will be permanently deleted.'], cta: 'Activate the album', to: 'album', also: { label: 'Download your content', to: 'photos' } },
    trial_purge_soon: { subject: 'Last days to save “{title}”', pre: 'The album will be deleted on {date}.', h: 'Download your memories',
      p: ['The album “{title}” will be permanently deleted on {date}, together with all its photos and videos.', 'Download your content now, or activate the album to keep it for 365 days.'], cta: 'Download your content', to: 'photos', also: { label: 'Activate the album', to: 'album' } },
    trial_deleted: { subject: 'The album “{title}” has been deleted', pre: 'The recovery period is over.', h: 'Album deleted',
      p: ['The trial and recovery period of the album “{title}” is over: photos, videos and links have been permanently deleted.', 'You can create a new album whenever you like.'], cta: 'Create a new album', to: 'new' },
    album_activated: { paid: 'Amount paid: {amount}.', subject: 'Your album “{title}” is active', pre: 'Available for 365 days.', h: 'Album activated, thank you!',
      p: ['The album “{title}” is active and available until {date} (365 days).', 'You can collect photos and videos with no trial limits and download everything in a single file whenever you want.'], cta: 'Open your album', to: 'album' },
    album_expiry_30: { subject: '“{title}” expires in 30 days', pre: 'Download your content before {date}.', h: 'Your album expires in 30 days',
      p: ['The album “{title}” is available until {date}. After that date photos and videos are permanently deleted.', 'We recommend downloading all your content now as a single ZIP file.'], cta: 'Go to the album and download everything', to: 'photos' },
    album_expiry_7: { subject: '“{title}” expires in 7 days', pre: 'Download your content before {date}.', h: '7 days left',
      p: ['The album “{title}” expires on {date}: after that, photos and videos can no longer be recovered.', 'Download your memories now as a single ZIP file.'], cta: 'Go to the album and download everything', to: 'photos' },
    album_expiry_1: { subject: 'Last day to download “{title}”', pre: 'The album expires on {date}.', h: 'Last day',
      p: ['The album “{title}” expires on {date} and will be permanently deleted.', 'Download all your content right now: afterwards it can no longer be recovered.'], cta: 'Go to the album and download everything', to: 'photos' },
    album_deleted: { subject: 'The album “{title}” has been deleted', pre: 'Your 365 days are over.', h: 'Album deleted',
      p: ['The 365 days of the album “{title}” are over: photos, videos and links have been permanently deleted, as planned.', 'Thank you for choosing MIOLOVE Album. You can create a new album whenever you like.'], cta: 'Create a new album', to: 'new' },
  },
  fr: {
    trial_started: { subject: 'Votre album « {title} » est prêt', pre: 'Votre essai gratuit a commencé.', h: 'Votre album est prêt',
      p: ['Vous avez créé l’album « {title} » et votre essai gratuit a commencé : il dure {days} jours et comprend au maximum {limit} photos et vidéos au total. Vous pouvez tester le QR code, les envois des invités et l’écran.', 'L’essai se termine le {date}. Pour garder l’album et continuer à collecter des souvenirs, vous pourrez l’activer à tout moment.'], cta: 'Ouvrir votre album', to: 'album' },
    trial_ending: { subject: 'L’essai de « {title} » va bientôt se terminer', pre: 'Activez l’album pour ne pas interrompre les envois.', h: 'Votre essai gratuit va bientôt se terminer',
      p: ['L’essai gratuit de l’album « {title} » se termine le {date}.', 'Après cette date, les envois s’arrêtent. Activez l’album pour continuer à collecter photos et vidéos pendant 365 jours.'], cta: 'Activer l’album', to: 'album', also: { label: 'Télécharger vos contenus', to: 'photos' } },
    trial_ended: { subject: 'L’essai de « {title} » est terminé', pre: 'Il vous reste du temps pour activer l’album ou télécharger vos contenus.', h: 'Votre essai gratuit est terminé',
      p: ['L’essai gratuit de l’album « {title} » est terminé et les envois sont en pause.', 'Vos photos et vidéos sont conservées jusqu’au {date} : d’ici là, vous pouvez activer l’album ou télécharger vos contenus. Ensuite, l’album sera supprimé définitivement.'], cta: 'Activer l’album', to: 'album', also: { label: 'Télécharger vos contenus', to: 'photos' } },
    trial_purge_soon: { subject: 'Derniers jours pour sauvegarder « {title} »', pre: 'L’album sera supprimé le {date}.', h: 'Téléchargez vos souvenirs',
      p: ['L’album « {title} » sera supprimé définitivement le {date}, avec toutes ses photos et vidéos.', 'Téléchargez vos contenus dès maintenant, ou activez l’album pour le conserver 365 jours.'], cta: 'Télécharger vos contenus', to: 'photos', also: { label: 'Activer l’album', to: 'album' } },
    trial_deleted: { subject: 'L’album « {title} » a été supprimé', pre: 'La période de récupération est terminée.', h: 'Album supprimé',
      p: ['La période d’essai et de récupération de l’album « {title} » est terminée : photos, vidéos et liens ont été supprimés définitivement.', 'Vous pouvez créer un nouvel album quand vous le souhaitez.'], cta: 'Créer un nouvel album', to: 'new' },
    album_activated: { paid: 'Montant payé : {amount}.', subject: 'Votre album « {title} » est actif', pre: 'Disponible pendant 365 jours.', h: 'Album activé, merci !',
      p: ['L’album « {title} » est actif et disponible jusqu’au {date} (365 jours).', 'Vous pouvez collecter photos et vidéos sans limite d’essai et tout télécharger en un seul fichier quand vous le souhaitez.'], cta: 'Ouvrir votre album', to: 'album' },
    album_expiry_30: { subject: '« {title} » expire dans 30 jours', pre: 'Téléchargez vos contenus avant le {date}.', h: 'Votre album expire dans 30 jours',
      p: ['L’album « {title} » est disponible jusqu’au {date}. Après cette date, photos et vidéos sont supprimées définitivement.', 'Nous vous conseillons de télécharger dès maintenant tous vos contenus dans un seul fichier ZIP.'], cta: 'Accéder à l’album et tout télécharger', to: 'photos' },
    album_expiry_7: { subject: '« {title} » expire dans 7 jours', pre: 'Téléchargez vos contenus avant le {date}.', h: 'Plus que 7 jours',
      p: ['L’album « {title} » expire le {date} : ensuite, photos et vidéos ne pourront plus être récupérées.', 'Téléchargez dès maintenant vos souvenirs dans un seul fichier ZIP.'], cta: 'Accéder à l’album et tout télécharger', to: 'photos' },
    album_expiry_1: { subject: 'Dernier jour pour télécharger « {title} »', pre: 'L’album expire le {date}.', h: 'Dernier jour',
      p: ['L’album « {title} » expire le {date} et sera supprimé définitivement.', 'Téléchargez tous vos contenus maintenant : ensuite, il sera impossible de les récupérer.'], cta: 'Accéder à l’album et tout télécharger', to: 'photos' },
    album_deleted: { subject: 'L’album « {title} » a été supprimé', pre: 'Vos 365 jours sont écoulés.', h: 'Album supprimé',
      p: ['Les 365 jours de l’album « {title} » sont écoulés : photos, vidéos et liens ont été supprimés définitivement, comme prévu.', 'Merci d’avoir choisi MIOLOVE Album. Vous pouvez créer un nouvel album quand vous le souhaitez.'], cta: 'Créer un nouvel album', to: 'new' },
  },
  es: {
    trial_started: { subject: 'Tu álbum «{title}» está listo', pre: 'Tu prueba gratuita ha comenzado.', h: 'Tu álbum está listo',
      p: ['Has creado el álbum «{title}» y tu prueba gratuita ha comenzado: dura {days} días y incluye un máximo de {limit} entre fotos y vídeos en total. Puedes probar el QR, las subidas de los invitados y la pantalla.', 'La prueba termina el {date}. Para conservar el álbum y seguir recogiendo recuerdos, podrás activarlo en cualquier momento.'], cta: 'Abrir tu álbum', to: 'album' },
    trial_ending: { subject: 'La prueba de «{title}» está a punto de terminar', pre: 'Activa el álbum para no interrumpir las subidas.', h: 'Tu prueba gratuita está a punto de terminar',
      p: ['La prueba gratuita del álbum «{title}» termina el {date}.', 'Después de esa fecha las subidas se detienen. Activa el álbum para seguir recogiendo fotos y vídeos durante 365 días.'], cta: 'Activar el álbum', to: 'album', also: { label: 'Descargar tus contenidos', to: 'photos' } },
    trial_ended: { subject: 'La prueba de «{title}» ha terminado', pre: 'Aún tienes tiempo para activar el álbum o descargar tus contenidos.', h: 'Tu prueba gratuita ha terminado',
      p: ['La prueba gratuita del álbum «{title}» ha terminado y las subidas están en pausa.', 'Tus fotos y vídeos están a salvo hasta el {date}: antes de esa fecha puedes activar el álbum o descargar tus contenidos. Después, el álbum se eliminará de forma definitiva.'], cta: 'Activar el álbum', to: 'album', also: { label: 'Descargar tus contenidos', to: 'photos' } },
    trial_purge_soon: { subject: 'Últimos días para guardar «{title}»', pre: 'El álbum se eliminará el {date}.', h: 'Descarga tus recuerdos',
      p: ['El álbum «{title}» se eliminará de forma definitiva el {date}, junto con todas sus fotos y vídeos.', 'Descarga ahora tus contenidos, o activa el álbum para conservarlo durante 365 días.'], cta: 'Descargar tus contenidos', to: 'photos', also: { label: 'Activar el álbum', to: 'album' } },
    trial_deleted: { subject: 'El álbum «{title}» ha sido eliminado', pre: 'El periodo de recuperación ha terminado.', h: 'Álbum eliminado',
      p: ['El periodo de prueba y de recuperación del álbum «{title}» ha terminado: fotos, vídeos y enlaces se han eliminado de forma definitiva.', 'Puedes crear un nuevo álbum cuando quieras.'], cta: 'Crear un nuevo álbum', to: 'new' },
    album_activated: { paid: 'Importe pagado: {amount}.', subject: 'Tu álbum «{title}» está activo', pre: 'Disponible durante 365 días.', h: '¡Álbum activado, gracias!',
      p: ['El álbum «{title}» está activo y disponible hasta el {date} (365 días).', 'Puedes recoger fotos y vídeos sin los límites de la prueba y descargarlo todo en un solo archivo cuando quieras.'], cta: 'Abrir tu álbum', to: 'album' },
    album_expiry_30: { subject: '«{title}» caduca en 30 días', pre: 'Descarga tus contenidos antes del {date}.', h: 'Tu álbum caduca en 30 días',
      p: ['El álbum «{title}» está disponible hasta el {date}. Después de esa fecha, fotos y vídeos se eliminan de forma definitiva.', 'Te recomendamos descargar ahora todos tus contenidos en un solo archivo ZIP.'], cta: 'Ir al álbum y descargarlo todo', to: 'photos' },
    album_expiry_7: { subject: '«{title}» caduca en 7 días', pre: 'Descarga tus contenidos antes del {date}.', h: 'Quedan 7 días',
      p: ['El álbum «{title}» caduca el {date}: después, las fotos y los vídeos ya no se podrán recuperar.', 'Descarga ahora tus recuerdos en un solo archivo ZIP.'], cta: 'Ir al álbum y descargarlo todo', to: 'photos' },
    album_expiry_1: { subject: 'Último día para descargar «{title}»', pre: 'El álbum caduca el {date}.', h: 'Último día',
      p: ['El álbum «{title}» caduca el {date} y se eliminará de forma definitiva.', 'Descarga ahora todos tus contenidos: después ya no será posible recuperarlos.'], cta: 'Ir al álbum y descargarlo todo', to: 'photos' },
    album_deleted: { subject: 'El álbum «{title}» ha sido eliminado', pre: 'Tus 365 días han terminado.', h: 'Álbum eliminado',
      p: ['Los 365 días del álbum «{title}» han terminado: fotos, vídeos y enlaces se han eliminado de forma definitiva, como estaba previsto.', 'Gracias por elegir MIOLOVE Album. Puedes crear un nuevo álbum cuando quieras.'], cta: 'Crear un nuevo álbum', to: 'new' },
  },
}

const FOOT: Record<MailLocale, { why: string; help: string }> = {
  it: { why: 'Hai ricevuto questa email perché hai un album su MIOLOVE Album.', help: 'Per assistenza rispondi a questa email o scrivi a' },
  en: { why: 'You received this email because you have an album on MIOLOVE Album.', help: 'For help, reply to this email or write to' },
  fr: { why: 'Vous recevez cet e-mail car vous avez un album sur MIOLOVE Album.', help: 'Pour toute aide, répondez à cet e-mail ou écrivez à' },
  es: { why: 'Has recibido este correo porque tienes un álbum en MIOLOVE Album.', help: 'Para ayuda, responde a este correo o escribe a' },
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fill = (s: string, v: { title: string; date: string; amount?: string }) =>
  s.replace(/\{title\}/g, v.title).replace(/\{date\}/g, v.date).replace(/\{days\}/g, String(MIOLOVE_TRIAL_DAYS)).replace(/\{limit\}/g, String(MIOLOVE_TRIAL_PHOTO_LIMIT)).replace(/\{amount\}/g, v.amount ?? '')

export interface RenderInput { kind: MailKind; locale: MailLocale; vars: MailVars; eventId: string; baseUrl?: string }
export interface RenderedMail { subject: string; html: string; text: string; links: { primary: string; secondary: string | null } }

const link = (base: string, to: Target, eventId: string, locale: MailLocale): string => {
  const b = base.replace(/\/+$/, '')
  if (to === 'new') return `${b}/sessions?lang=${locale}`
  return `${b}/sessions/${encodeURIComponent(eventId)}?${to === 'photos' ? 'tab=photos&' : ''}lang=${locale}`
}

export function renderMiolovaMail(i: RenderInput): RenderedMail {
  const c = COPY[i.locale][i.kind], f = FOOT[i.locale], base = i.baseUrl ?? DEFAULT_MIOLOVE_BASE_URL
  const dateKey = DATE_OF[i.kind], ms = dateKey ? i.vars[dateKey] : undefined
  const amount = c.paid ? formatMailAmount(i.vars.amountCents, i.vars.currency, i.locale) : null
  const raw = { title: i.vars.title, date: typeof ms === 'number' ? formatMailDate(ms, i.locale) : '', amount: amount ?? '' }
  const safe = { title: esc(raw.title), date: esc(raw.date), amount: esc(raw.amount) }
  const primary = link(base, c.to, i.eventId, i.locale), secondary = c.also ? link(base, c.also.to, i.eventId, i.locale) : null
  const subject = fill(c.subject, raw), pre = fill(c.pre, raw), heading = fill(c.h, raw)
  const all = amount && c.paid ? [...c.p, c.paid] : c.p                                  // the "amount paid" line exists only when the amount is known
  const paras = all.map((p) => fill(p, safe)), parasText = all.map((p) => fill(p, raw))

  const html = `<!doctype html>
<html lang="${i.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title>
<style>@media only screen and (max-width:620px){.wrap{width:100%!important}.card{padding:28px 20px!important}.btn a{display:block!important}h1{font-size:24px!important}}</style></head>
<body style="margin:0;padding:0;background:#FFF5F9;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#FFF5F9;">${esc(pre)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FFF5F9;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="wrap" width="600" cellspacing="0" cellpadding="0" style="width:600px;max-width:600px;">
<tr><td align="center" style="padding:8px 0 20px;"><a href="${esc(base)}" style="text-decoration:none;"><img src="${esc(base.replace(/\/+$/, ''))}/brand/miolove/email/miolove-email-logo.png" width="190" alt="MIOLOVE Album" style="display:block;border:0;width:190px;max-width:70%;height:auto;font:700 20px Arial,sans-serif;color:#F06A9B;"></a></td></tr>
<tr><td class="card" style="background:#FFFFFF;border:1px solid #F3D3E0;border-radius:20px;padding:36px 36px 32px;font-family:Arial,Helvetica,sans-serif;color:#2B2424;">
<h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#2B2424;">${esc(heading)}</h1>
${paras.map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#2B2424;">${p}</p>`).join('\n')}
<table role="presentation" class="btn" cellspacing="0" cellpadding="0" style="margin:22px 0 6px;"><tr><td style="border-radius:14px;background:#F06A9B;"><a href="${esc(primary)}" style="display:inline-block;padding:14px 26px;font:700 16px Arial,Helvetica,sans-serif;color:#FFFFFF;text-decoration:none;border-radius:14px;">${esc(c.cta)}</a></td></tr></table>
${secondary && c.also ? `<p style="margin:14px 0 0;font-size:15px;"><a href="${esc(secondary)}" style="color:#E8538A;font-weight:700;">${esc(c.also.label)}</a></p>` : ''}
</td></tr>
<tr><td align="center" style="padding:20px 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8A7F85;">${esc(f.why)}<br>${esc(f.help)} <a href="mailto:${MIOLOVE_REPLY_TO}" style="color:#8A7F85;">${MIOLOVE_REPLY_TO}</a><br>MIOLOVE Album · miolovealbum.com</td></tr>
</table></td></tr></table></body></html>`

  const text = [heading, '', ...parasText.flatMap((p) => [p, '']), `${c.cta}: ${primary}`, ...(secondary && c.also ? [`${c.also.label}: ${secondary}`] : []), '', '--', f.why, `${f.help} ${MIOLOVE_REPLY_TO}`, 'MIOLOVE Album · miolovealbum.com'].join('\n')
  return { subject, html, text, links: { primary, secondary } }
}
