import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAIL_KINDS, MAIL_LOCALES, formatMailAmount, renderMiolovaMail, parseMailLocale, MIOLOVE_SENDER, type MailKind, type MailLocale } from '../../../../firebase/functions/src/mail/miolove/templates'
import { dueMailKind, skipReason, varsOfAlbum } from '../../../../firebase/functions/src/mail/miolove/outbox'
import { mailModeOf } from '../../../../firebase/functions/src/mail/transport'
import { createRequire } from 'node:module'
const { Timestamp } = createRequire(__dirname + '/../../../../firebase/functions/package.json')('firebase-admin/firestore')

const DAY = 86_400_000
const NOW = new Date('2026-10-23T08:00:00Z')
const VARS = { title: 'Nozze Anna & Marco', trialEndsAtMs: NOW.getTime() + 2 * DAY, expiresAtMs: NOW.getTime() + 30 * DAY, purgeAtMs: NOW.getTime() + 9 * DAY }
const ts = (ms: number) => Timestamp.fromMillis(ms)

test('MAIL-T1. all 10 e-mails × 4 languages render: subject, responsive HTML, text twin, no placeholder left, the album title and ITS link', () => {
  assert.equal(MAIL_KINDS.length, 10); assert.deepEqual([...MAIL_LOCALES], ['it', 'en', 'fr', 'es'])
  const seen = new Set<string>()
  for (const locale of MAIL_LOCALES) for (const kind of MAIL_KINDS) {
    const m = renderMiolovaMail({ kind, locale, vars: VARS, eventId: 'evt123' })
    for (const part of [m.subject, m.html, m.text]) assert.doesNotMatch(part, /\{title\}|\{date\}|undefined|NaN/, `${locale}/${kind}`)
    assert.match(m.subject, /Anna & Marco/); assert.match(m.html, /Anna &amp; Marco/); assert.match(m.text, /Anna & Marco/)
    assert.match(m.html, /<html lang="/); assert.match(m.html, /name="viewport"/); assert.match(m.html, /@media only screen/); assert.match(m.html, /miolove-album-logo-on-light\.png/); assert.match(m.html, /info@miolovealbum\.com/)
    assert.ok(m.links.primary.startsWith('https://miolovealbum.com/')); assert.ok(m.html.includes(m.links.primary.replace(/&/g, '&amp;'))); assert.match(m.links.primary, new RegExp(`lang=${locale}`))
    if (kind !== 'trial_deleted' && kind !== 'album_deleted') assert.match(m.links.primary, /\/sessions\/evt123\?/, 'opens THAT album')
    seen.add(`${locale}|${m.subject}`)
  }
  assert.equal(seen.size, 36, 'every e-mail has its own subject in every language (the two "deleted" ones share it)')
})

test('MAIL-T2. expiry / purge e-mails carry the link that downloads the content (the album\'s Photos tab); deleted e-mails invite a new album; dates are the album\'s own', () => {
  for (const locale of MAIL_LOCALES) {
    for (const kind of ['album_expiry_30', 'album_expiry_7', 'album_expiry_1', 'trial_purge_soon'] as MailKind[]) assert.match(renderMiolovaMail({ kind, locale, vars: VARS, eventId: 'e1' }).links.primary, /\/sessions\/e1\?tab=photos&lang=/, `${locale}/${kind}`)
    for (const kind of ['trial_ending', 'trial_ended'] as MailKind[]) assert.match(renderMiolovaMail({ kind, locale, vars: VARS, eventId: 'e1' }).links.secondary ?? '', /tab=photos/, `${locale}/${kind}: activate + download`)
    for (const kind of ['trial_deleted', 'album_deleted'] as MailKind[]) assert.match(renderMiolovaMail({ kind, locale, vars: VARS, eventId: 'e1' }).links.primary, /\/sessions\?lang=/)
  }
  const a = renderMiolovaMail({ kind: 'album_expiry_30', locale: 'it', vars: { title: 'A', expiresAtMs: Date.UTC(2027, 5, 12, 10) }, eventId: 'a' }), b = renderMiolovaMail({ kind: 'album_expiry_30', locale: 'it', vars: { title: 'B', expiresAtMs: Date.UTC(2027, 8, 3, 10) }, eventId: 'b' })
  assert.match(a.text, /12 giugno 2027/); assert.match(b.text, /3 settembre 2027/); assert.doesNotMatch(a.text, /settembre/)
  assert.match(renderMiolovaMail({ kind: 'album_expiry_7', locale: 'en', vars: { title: 'A', expiresAtMs: Date.UTC(2027, 5, 12, 10) }, eventId: 'a' }).text, /12 June 2027/)
  assert.match(renderMiolovaMail({ kind: 'album_expiry_7', locale: 'fr', vars: { title: 'A', expiresAtMs: Date.UTC(2027, 5, 12, 10) }, eventId: 'a' }).text, /12 juin 2027/)
  assert.match(renderMiolovaMail({ kind: 'album_expiry_7', locale: 'es', vars: { title: 'A', expiresAtMs: Date.UTC(2027, 5, 12, 10) }, eventId: 'a' }).text, /12 de junio de 2027/)
})

test('MAIL-T3. a hostile title cannot inject HTML; sender is MIOLOVE Album <info@miolovealbum.com>; unknown locale / mode are rejected', () => {
  const m = renderMiolovaMail({ kind: 'album_activated', locale: 'it', vars: { title: '<script>alert(1)</script>"x', expiresAtMs: NOW.getTime() }, eventId: 'e' })
  assert.doesNotMatch(m.html, /<script>/); assert.match(m.html, /&lt;script&gt;/)
  assert.equal(MIOLOVE_SENDER, 'MIOLOVE Album <info@miolovealbum.com>')
  assert.equal(parseMailLocale('de'), null); assert.equal(parseMailLocale(undefined), null); assert.equal(parseMailLocale('fr'), 'fr')
  assert.deepEqual(['live', 'dry', undefined, 'yes'].map((x) => mailModeOf(x as string | undefined)), ['live', 'dry', 'off', 'off'])
  assert.equal(varsOfAlbum({ title: 'Line1\r\nLine2' }).title, 'Line1 Line2')
})

test('MAIL-T4. which e-mail an album is due for: paid 30 / 7 / 1 days, trial 2 days before the end / at the end / 7 days before deletion; nothing else', () => {
  const paid = (days: number) => ({ accessMode: 'activated', expiresAt: ts(NOW.getTime() + days * DAY - 1000) })
  assert.equal(dueMailKind(paid(200), NOW), null); assert.equal(dueMailKind(paid(31), NOW), null)
  assert.deepEqual([30, 29.5, 8, 7, 3, 1, 0.5].map((d) => dueMailKind(paid(d), NOW)?.kind), ['album_expiry_30', 'album_expiry_30', 'album_expiry_30', 'album_expiry_7', 'album_expiry_7', 'album_expiry_1', 'album_expiry_1'])
  assert.equal(dueMailKind({ accessMode: 'activated', expiresAt: ts(NOW.getTime() - 1) }, NOW), null, 'already expired: the purge e-mail takes over')
  const trial = (endIn: number) => ({ accessMode: 'trial', trialExpiresAt: ts(NOW.getTime() + endIn * DAY), purgeAfter: ts(NOW.getTime() + (endIn + 30) * DAY) })
  assert.deepEqual([5, 2, 1, -1, -10, -22, -23, -29].map((d) => dueMailKind(trial(d), NOW)?.kind ?? null), [null, 'trial_ending', 'trial_ending', 'trial_ended', 'trial_ended', 'trial_ended', 'trial_purge_soon', 'trial_purge_soon'])
  for (const x of [{ accessMode: 'pending' }, { accessMode: 'purged' }, { accessMode: 'activated', deletedAt: ts(1), expiresAt: ts(NOW.getTime() + DAY) }, { accessMode: 'trial' }]) assert.equal(dueMailKind(x, NOW), null)
})

test('MAIL-T5. an e-mail that no longer applies is dropped at send time (paid meanwhile, deleted by the owner, expired); deletion e-mails always go', () => {
  const act = { accessMode: 'activated', expiresAt: ts(NOW.getTime() + 20 * DAY) }, tr = { accessMode: 'trial', trialExpiresAt: ts(NOW.getTime() + DAY) }
  assert.equal(skipReason('album_expiry_30', act, NOW), null); assert.equal(skipReason('album_expiry_30', { ...act, deletedAt: ts(1) }, NOW), 'album_gone')
  assert.equal(skipReason('album_expiry_7', { accessMode: 'activated', expiresAt: ts(NOW.getTime() - 1) }, NOW), 'state_changed')
  assert.equal(skipReason('trial_ending', tr, NOW), null); assert.equal(skipReason('trial_ending', act, NOW), 'state_changed', 'paid meanwhile: no "trial ending"')
  assert.equal(skipReason('trial_ended', act, NOW), 'state_changed'); assert.equal(skipReason('album_activated', tr, NOW), 'state_changed')
  assert.equal(skipReason('album_deleted', undefined, NOW), null); assert.equal(skipReason('trial_deleted', { accessMode: 'purged', deletedAt: ts(1) }, NOW), null)
  assert.equal(skipReason('trial_started', undefined, NOW), 'album_gone')
})

const flat = (x: string) => x.replace(/[\u00a0\u202f]/g, ' ')

test('MAIL-T6. trial_started states the trial length (7 days) and its cap (50 photos/videos in total) in every language, from the real limits', () => {
  for (const locale of MAIL_LOCALES) {
    const m = renderMiolovaMail({ kind: 'trial_started', locale, vars: VARS, eventId: 'e' })
    assert.match(m.text, /\b7\b/, locale); assert.match(m.text, /\b50\b/, locale); assert.doesNotMatch(m.text, /\{days\}|\{limit\}/)
  }
  assert.match(renderMiolovaMail({ kind: 'trial_started', locale: 'it', vars: VARS, eventId: 'e' }).text, /dura 7 giorni e comprende al massimo 50 tra foto e video in totale/)
  assert.match(renderMiolovaMail({ kind: 'trial_started', locale: 'en', vars: VARS, eventId: 'e' }).text, /lasts 7 days and includes a maximum of 50 photos and videos in total/)
  assert.match(renderMiolovaMail({ kind: 'trial_started', locale: 'fr', vars: VARS, eventId: 'e' }).text, /dure 7 jours et comprend au maximum 50 photos et vidéos au total/)
  assert.match(renderMiolovaMail({ kind: 'trial_started', locale: 'es', vars: VARS, eventId: 'e' }).text, /dura 7 días y incluye un máximo de 50 entre fotos y vídeos en total/)
})

test('MAIL-T7. album_activated shows the amount REALLY paid in the e-mail\'s own format: EUR and USD, all four languages; no figure at all when it is not reliable', () => {
  const at = (locale: any, cents: any, currency: any) => renderMiolovaMail({ kind: 'album_activated', locale, vars: { title: 'A', expiresAtMs: NOW.getTime(), amountCents: cents, currency }, eventId: 'e' })
  assert.match(flat(at('it', 1999, 'eur').text), /Importo pagato: 19,99 €\./); assert.match(flat(at('fr', 1999, 'eur').text), /Montant payé : 19,99 €\./)
  assert.match(flat(at('es', 1999, 'eur').text), /Importe pagado: 19,99 €\./); assert.match(flat(at('en', 1999, 'usd').text), /Amount paid: \$19\.99\./)
  // the currency is the one PAID, never inferred from the language
  assert.match(flat(at('en', 1999, 'eur').text), /Amount paid: €19\.99\./); assert.match(flat(at('it', 1999, 'usd').text), /Importo pagato: 19,99 USD\./); assert.match(flat(at('fr', 1999, 'USD').text), /19,99 \$US/)
  assert.match(flat(at('it', 1500, 'eur').text), /15,00 €/, 'a discounted payment shows what was paid'); assert.match(at('it', 1999, 'eur').html, /Importo pagato/)
  for (const locale of MAIL_LOCALES) for (const [c, cur] of [[undefined, undefined], [undefined, 'eur'], [1999, undefined], [0, 'eur'], [-5, 'eur'], [19.99, 'eur'], [1999, 'euro'], [1999, 'e1r'], [NaN, 'eur'], ['1999', 'eur']] as const) {
    const m = at(locale, c, cur); assert.doesNotMatch(m.text + m.html, /Importo pagato|Amount paid|Montant payé|Importe pagado|undefined|NaN|\{amount\}/, `${locale} ${c} ${cur}`)
  }
  assert.equal(formatMailAmount(1999, 'zzz9', 'it'), null); assert.match(flat(formatMailAmount(1999, 'eur', 'it')!), /^19,99 €$/); assert.equal(flat(formatMailAmount(1999, 'usd', 'en')!), '$19.99')
  // the other nine e-mails never show an amount even if one is stored
  for (const kind of MAIL_KINDS.filter((k) => k !== 'album_activated')) assert.doesNotMatch(renderMiolovaMail({ kind, locale: 'it', vars: { ...VARS, amountCents: 1999, currency: 'eur' }, eventId: 'e' }).text, /19,99|Importo/)
})

test('MAIL-T8. paid-album expiry e-mails: CTA "go to the album and download everything" (4 languages), still the Photos-tab link, no promise of an automatic download; trial e-mails keep theirs', () => {
  const want = { it: 'Vai all’album e scarica tutto', en: 'Go to the album and download everything', fr: 'Accéder à l’album et tout télécharger', es: 'Ir al álbum y descargarlo todo' } as Record<MailLocale, string>
  for (const locale of MAIL_LOCALES) {
    for (const kind of ['album_expiry_30', 'album_expiry_7', 'album_expiry_1'] as MailKind[]) {
      const m = renderMiolovaMail({ kind, locale, vars: VARS, eventId: 'e1' })
      assert.match(m.text, new RegExp(`${want[locale]}: https://miolovealbum.com/sessions/e1\\?tab=photos&lang=${locale}`), `${locale}/${kind}`); assert.ok(m.html.includes(`>${want[locale]}</a>`))
    }
    assert.doesNotMatch(renderMiolovaMail({ kind: 'trial_purge_soon', locale, vars: VARS, eventId: 'e1' }).text, new RegExp(want[locale]), 'trial e-mails are unchanged')
  }
  assert.match(renderMiolovaMail({ kind: 'trial_purge_soon', locale: 'it', vars: VARS, eventId: 'e1' }).text, /Scarica i tuoi contenuti: /)
})
