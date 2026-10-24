import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAIL_LOCALES, MIOLOVE_SENDER } from '../../../../firebase/functions/src/mail/miolove/templates'
import { AUTH_MAIL_KINDS, renderAuthMail } from '../../../../firebase/functions/src/mail/miolove/authTemplates'
import { actionLinkOf, clientIpOf, ipBucketOf, RESET_GLOBAL_LIMITS, oobCodeOf, parseResetInput, parseVerifyInput } from '../../../../firebase/functions/src/mail/miolove/authMail'

const LINK = 'https://miolovealbum.com/auth/action?mode=verifyEmail&oobCode=abcDEF123_-xyz&lang=it'

test('AUTHMAIL-T1. verification + reset render in all 4 languages: own subject, branded responsive HTML, logo, one button to OUR domain, text twin, nothing left over', () => {
  const subjects = new Set<string>()
  for (const locale of MAIL_LOCALES) for (const kind of AUTH_MAIL_KINDS) {
    const m = renderAuthMail({ kind, locale, link: LINK })
    for (const part of [m.subject, m.html, m.text]) assert.doesNotMatch(part, /\{[a-z]+\}|undefined|NaN/, `${locale}/${kind}`)
    assert.match(m.html, new RegExp(`<html lang="${locale}"`)); assert.match(m.html, /name="viewport"/); assert.match(m.html, /@media only screen/)
    assert.match(m.html, /https:\/\/miolovealbum\.com\/brand\/miolove\/email\/miolove-email-logo\.png/)
    assert.equal(m.html.match(/class="btn"/g)?.length, 1, 'one button')
    assert.ok(m.html.includes(`href="${LINK.replace(/&/g, '&amp;')}"`), 'the button opens the MIOLOVE action page'); assert.ok(m.text.includes(LINK))
    assert.doesNotMatch(m.html + m.text, /firebaseapp\.com|googleapis|project-\d+/, 'no technical Firebase address anywhere')
    assert.match(m.html + m.text, /info@miolovealbum\.com/)
    subjects.add(`${locale}|${m.subject}`)
  }
  assert.equal(subjects.size, 8)
  assert.equal(MIOLOVE_SENDER, 'MIOLOVE Album <info@miolovealbum.com>')
})

test('AUTHMAIL-T2. no validity period is promised (Firebase decides it); the e-mail says one-time and what to do if it was not requested', () => {
  for (const locale of MAIL_LOCALES) for (const kind of AUTH_MAIL_KINDS) assert.doesNotMatch(renderAuthMail({ kind, locale, link: LINK }).text, /\b\d+\s*(ore|ora|giorni|hours?|days?|heures?|jours?|horas?|días)\b/i)
})

test('AUTHMAIL-T3. a hostile link cannot break out of the HTML attribute', () => {
  const m = renderAuthMail({ kind: 'verify_email', locale: 'en', link: 'https://x.test/?a="><script>alert(1)</script>' })
  assert.doesNotMatch(m.html, /<script>/); assert.match(m.html, /&quot;&gt;&lt;script&gt;/)
})

test('AUTHMAIL-T4. the one-time code is read from the Firebase link and rebuilt on our domain per kind and language; a link without a valid code is refused', () => {
  const fb = 'https://project-1.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=CODE_abc-123456&apiKey=k&lang=en'
  assert.equal(oobCodeOf(fb), 'CODE_abc-123456')
  assert.equal(oobCodeOf('https://x/?mode=verifyEmail'), null); assert.equal(oobCodeOf('not a url'), null); assert.equal(oobCodeOf('https://x/?oobCode=a b<'), null)
  assert.equal(actionLinkOf('https://miolovealbum.com/', 'verify_email', 'CODE_abc-123456', 'fr'), 'https://miolovealbum.com/auth/action?mode=verifyEmail&oobCode=CODE_abc-123456&lang=fr')
  assert.equal(actionLinkOf('https://miolovealbum.com', 'reset_password', 'CODE_abc-123456', 'es'), 'https://miolovealbum.com/auth/action?mode=resetPassword&oobCode=CODE_abc-123456&lang=es')
})

test('AUTHMAIL-T5. payload parsing ignores everything but language / address (the verification address is never taken from the client)', () => {
  assert.deepEqual(parseVerifyInput({ locale: 'fr', email: 'victim@x.com', uid: 'u2' }), { locale: 'fr' })
  assert.deepEqual(parseVerifyInput(null), { locale: undefined })
  assert.deepEqual(parseResetInput({ email: 'a@b.it', locale: 'es', extra: 1 }), { email: 'a@b.it', locale: 'es' })
  assert.deepEqual(parseResetInput('x'), { email: undefined, locale: undefined })
})

test('AUTHMAIL-T6. IOMIXO invariance (source check): the Firebase flows are still the default of every shared function; MIOLOVE alone is routed to the callables', () => {
  const fe = join(__dirname, '..', '..')
  const fb = readFileSync(join(fe, 'lib/firebase/auth.ts'), 'utf8'), idx = readFileSync(join(fe, 'lib/auth/index.ts'), 'utf8')
  assert.match(fb, /if \(opts\.sendVerification !== false\) await sendEmailVerification\(cred\.user, actionSettings\(\)\)/, 'default sign-up still sends the Firebase e-mail')
  assert.match(fb, /export const requestPasswordReset = \(email: string\) =>\s+sendPasswordResetEmail\(getFirebaseAuth\(\), email, actionSettings\(\)\)/, 'Firebase reset untouched')
  assert.match(idx, /signUpWithEmail\(email, password, fullName, \{ sendVerification: !couple \}\)/)
  assert.match(idx, /accountType === 'couple' \? fb\.sendMioloveVerificationEmail\(locale\) : fb\.resendVerificationEmail\(\)/)
  assert.match(idx, /accountType === 'couple' \? fb\.requestMiolovePasswordReset\(email, locale\) : fb\.requestPasswordReset\(email\)/)
  assert.match(idx, /accountType: AccountType = 'dj'/, 'the default account type is IOMIXO')
})

test('AUTHMAIL-T7. the per-IP limit uses the address Cloud Run appends (LAST X-Forwarded-For entry); a client-forged leftmost value or garbage is never trusted; unknown = no shared bucket', () => {
  assert.equal(clientIpOf({ headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' } }), '203.0.113.9')
  assert.equal(clientIpOf({ headers: { 'x-forwarded-for': '2001:db8::1' } }), '2001:db8::1')
  assert.equal(clientIpOf({ headers: { 'x-forwarded-for': ['1.1.1.1', '198.51.100.4'] } }), '198.51.100.4')
  for (const bad of [{}, undefined, { headers: {} }, { headers: { 'x-forwarded-for': 'not-an-ip' } }, { headers: { 'x-forwarded-for': '1.1.1.1, <script>' } }, { headers: { 'x-forwarded-for': '' } }]) assert.equal(clientIpOf(bad as never), null)
})

test('AUTHMAIL-T8. registration sends ONE verification e-mail on MIOLOVE (the Firebase one is skipped, the branded one is requested once), and the MIOLOVE screen promises no link duration', () => {
  const fe = join(__dirname, '..', '..')
  const idx = readFileSync(join(fe, 'lib/auth/index.ts'), 'utf8'), reg = readFileSync(join(fe, 'app/(auth)/register/page.tsx'), 'utf8')
  const signUp = idx.slice(idx.indexOf('export const signUp'), idx.indexOf('export const signInWithGoogle') > 0 ? idx.indexOf('/**\n * Google sign-in') : undefined)
  assert.equal(signUp.match(/sendMioloveVerificationEmail/g)?.length, 1); assert.equal(signUp.match(/signUpWithEmail/g)?.length, 1)
  const couple = reg.slice(reg.indexOf('if (isCouple) {'), reg.indexOf('return (', reg.indexOf('if (isCouple) {') + 1000) > 0 ? reg.indexOf('<div className="grid w-full max-w-4xl') : undefined)
  assert.doesNotMatch(couple, /linkExpires24h/, 'no unverified validity period on the MIOLOVE screen')
  assert.match(reg, /if \(!verificationSent\) toast\.error\(t\('auth\.verifyNotSent'\)\)/, 'a failed first send is shown, with the resend button available')
})

test('AUTHMAIL-T9. IPv6 is counted per /64 (a household cannot dodge the limit by rotating addresses); IPv4 and IPv4-mapped addresses count as the IPv4; different networks never share a bucket', () => {
  const same = ['2001:db8:abcd:12::1', '2001:db8:abcd:12:ffff:ffff:ffff:ffff', '2001:0DB8:ABCD:0012:0:0:0:5', '2001:db8:abcd:12::', '2001:db8:abcd:12::1%eth0']
  assert.equal(new Set(same.map(ipBucketOf)).size, 1); assert.equal(ipBucketOf(same[0]), '2001:0db8:abcd:0012::/64')
  assert.notEqual(ipBucketOf('2001:db8:abcd:13::1'), ipBucketOf('2001:db8:abcd:12::1'), 'the next /64 is another customer')
  assert.notEqual(ipBucketOf('2001:db8:abcd:12::1'), ipBucketOf('2001:db9:abcd:12::1'))
  assert.equal(ipBucketOf('::1'), '0000:0000:0000:0000::/64'); assert.equal(ipBucketOf('::'), '0000:0000:0000:0000::/64')
  assert.equal(ipBucketOf('203.0.113.9'), '203.0.113.9'); assert.equal(ipBucketOf('::ffff:203.0.113.9'), '203.0.113.9'); assert.equal(ipBucketOf('::ffff:cb00:7109'), '203.0.113.9')
  assert.notEqual(ipBucketOf('203.0.113.9'), ipBucketOf('203.0.113.10'), 'IPv4 is per address')
  assert.equal(ipBucketOf('2001:db8::1:2:3:4'), '2001:0db8:0000:0000::/64')
})

test('AUTHMAIL-T10. the global reset cap is far above normal use (a handful a day) and below any realistic quota-burning rate', () => {
  assert.ok(RESET_GLOBAL_LIMITS.maxPerHour >= 20 && RESET_GLOBAL_LIMITS.maxPerHour <= 60); assert.ok(RESET_GLOBAL_LIMITS.maxPerDay >= RESET_GLOBAL_LIMITS.maxPerHour * 4 && RESET_GLOBAL_LIMITS.maxPerDay <= 500)
})
