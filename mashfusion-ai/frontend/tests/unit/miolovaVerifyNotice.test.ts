import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { VERIFY_RECHECK_MS, VERIFY_RESEND_COOLDOWN_MS, shouldShowVerifyNotice, verifyNoticeDismissKey, verifyNoticeHiddenHere, type NoticeInput } from '../../lib/miolove/verifyNotice'

const fe = join(__dirname, '..', '..')
const base: NoticeInput = { user: { isAnonymous: false, emailVerified: false }, isCouple: true, accountType: 'couple', ready: true, dismissed: false }

test('VNOTICE-1. the notice shows ONLY for a MIOLOVE couple account with an unverified address, once its profile is read and it was not closed', () => {
  assert.equal(shouldShowVerifyNotice(base), true)
  const off: Array<[string, Partial<NoticeInput>]> = [
    ['verified', { user: { isAnonymous: false, emailVerified: true } }], ['anonymous guest', { user: { isAnonymous: true, emailVerified: false } }], ['signed out', { user: null }],
    ['IOMIXO portal', { isCouple: false }], ['dj profile on the MIOLOVE domain (the server would refuse the mail)', { accountType: 'dj' }], ['no profile type', { accountType: undefined }],
    ['profile not read yet', { ready: false }], ['closed', { dismissed: true }],
  ]
  for (const [why, over] of off) assert.equal(shouldShowVerifyNotice({ ...base, ...over }), false, why)
})

test('VNOTICE-2. IOMIXO is untouched: a DJ / party account never gets the notice, whatever its verification state', () => {
  for (const emailVerified of [true, false]) for (const accountType of ['dj', undefined, null]) assert.equal(shouldShowVerifyNotice({ ...base, isCouple: false, accountType, user: { isAnonymous: false, emailVerified } }), false)
})

test('VNOTICE-3. timings mirror the server (60 s between two sends) and keep the re-check cheap (>= 10 s)', () => {
  assert.equal(VERIFY_RESEND_COOLDOWN_MS, 60_000); assert.ok(VERIFY_RECHECK_MS >= 10_000 && VERIFY_RECHECK_MS <= 60_000)
  assert.equal(verifyNoticeDismissKey('u1'), 'miolove.verifyNotice.dismissed.u1'); assert.notEqual(verifyNoticeDismissKey('u1'), verifyNoticeDismissKey('u2'))
})

test('VNOTICE-4. texts exist, are translated and differ in it / en / fr / es; they promise no link duration and say the app keeps working', () => {
  const seen: Record<string, Set<string>> = {}
  for (const l of ['it', 'en', 'fr', 'es']) {
    const a = JSON.parse(readFileSync(join(fe, `locales/miolove/${l}.json`), 'utf8')).auth
    for (const k of ['verifyNoticeText', 'verifyNoticeResend', 'verifyNoticeSent', 'verifyNoticeClose']) { assert.ok(typeof a[k] === 'string' && a[k].length >= 4, `${l}.${k}`); (seen[k] ??= new Set()).add(a[k]) }
    assert.doesNotMatch(a.verifyNoticeText, /\b\d+\s*(ore|ora|giorni|hours?|days?|heures?|jours?|horas?|días)\b/i)
  }
  for (const k of Object.keys(seen)) assert.equal(seen[k].size, 4, `${k} is translated in every language`)
})

test('VNOTICE-5. wiring (source): one notice in the shared dashboard layout, no redirect / gate / blocking in the component, sessionStorage guarded, the user is re-read on focus', () => {
  const layout = readFileSync(join(fe, 'app/(dashboard)/layout.tsx'), 'utf8'), comp = readFileSync(join(fe, 'components/miolove/VerifyEmailNotice.tsx'), 'utf8')
  assert.equal(layout.match(/<VerifyEmailNotice \/>/g)?.length, 1); assert.match(layout, /<AuthGate>[\s\S]*<VerifyEmailNotice \/>[\s\S]*\{children\}/)
  assert.doesNotMatch(comp, /useRouter|router\.|redirect|window\.location|disabled=\{[^}]*verified/i, 'it never navigates or blocks')
  assert.match(comp, /try \{ return window\.sessionStorage\.getItem[\s\S]*catch \{ return false \}/); assert.match(comp, /try \{ if \(uid\) window\.sessionStorage\.setItem[\s\S]*catch/)
  assert.match(comp, /user\.reload\(\)/); assert.match(comp, /addEventListener\('focus'/); assert.match(comp, /visibilitychange/)
  assert.match(comp, /resendVerification\(user\?\.email \?\? '', 'couple', locale\)/, 'the resend goes through the existing MIOLOVE path with its server limits')
})

test('VNOTICE-6. exactly one notice at a time: on /onboarding the layout one steps aside and the onboarding one shows; everywhere else it is the layout one', () => {
  for (const p of ['/onboarding', '/onboarding/', '/onboarding/x']) { assert.equal(verifyNoticeHiddenHere('layout', p), true, p); assert.equal(verifyNoticeHiddenHere('onboarding', p), false, p) }
  for (const p of ['/sessions', '/sessions/abc', '/billing', '/settings', '/onboardingx', '/', null, undefined]) { assert.equal(verifyNoticeHiddenHere('layout', p as string), false, String(p)); assert.equal(verifyNoticeHiddenHere('onboarding', p as string), false) }
})

test('VNOTICE-7. onboarding wiring (source): the first-album screen renders ONE onboarding-placement notice between the header and the form, and the layout still has one; IOMIXO files are untouched', () => {
  const ob = readFileSync(join(fe, 'components/wedding/onboarding/CoupleOnboarding.tsx'), 'utf8'), layout = readFileSync(join(fe, 'app/(dashboard)/layout.tsx'), 'utf8')
  assert.equal(ob.match(/<VerifyEmailNotice placement="onboarding" \/>/g)?.length, 1); assert.match(ob, /<\/header>\s*<VerifyEmailNotice placement="onboarding" \/>\s*<main/)
  assert.equal(layout.match(/<VerifyEmailNotice \/>/g)?.length, 1); assert.doesNotMatch(layout, /placement/)
  assert.doesNotMatch(ob, /disabled=\{[^}]*verif/i, 'creating the first album never waits for verification')
})
