import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveAccountType, isCoupleAllowedPath, isCoupleWeddingTab, COUPLE_LABEL, COUPLE_HOME } from '../../lib/roleRules'
import { userToLegacy } from '../../lib/events/legacyMappers'
import type { UserDoc } from '../../lib/firebase/models'

const userDoc = (over: Partial<UserDoc> = {}): UserDoc => ({
  uid: 'u1', email: 'a@b.c', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date(), ...over,
})

test('legacy: no accountType (or garbage) resolves to dj, only an explicit couple restricts', () => {
  assert.equal(resolveAccountType(undefined), 'dj')
  assert.equal(resolveAccountType(null), 'dj')
  assert.equal(resolveAccountType('admin'), 'dj')
  assert.equal(resolveAccountType('dj'), 'dj')
  assert.equal(resolveAccountType('couple'), 'couple')
})

test('legacy mapper: missing user doc / legacy doc => dj; couple doc => couple', () => {
  assert.equal(userToLegacy('u1', null, 'a@b.c').accountType, 'dj')
  assert.equal(userToLegacy('u1', userDoc(), 'a@b.c').accountType, 'dj')
  assert.equal(userToLegacy('u1', userDoc({ legacySupabaseId: 'x' }), 'a@b.c').accountType, 'dj')
  assert.equal(userToLegacy('u1', userDoc({ accountType: 'dj' }), 'a@b.c').accountType, 'dj')
  assert.equal(userToLegacy('u1', userDoc({ accountType: 'couple' }), 'a@b.c').accountType, 'couple')
})

test('couple route allow-list: albums, onboarding, billing, settings only; every DJ route is blocked', () => {
  for (const p of ['/sessions', '/sessions/abc', '/onboarding', '/billing', '/settings']) assert.ok(isCoupleAllowedPath(p), p)
  for (const p of ['/dashboard', '/profile', '/events', '/remote/abc', '/sessionsx', '/onboardingx', '/dashboard/sessions', '', null, undefined]) assert.ok(!isCoupleAllowedPath(p as string), String(p))
  assert.equal(COUPLE_HOME, '/sessions')
})

test('couple wedding tabs: Home, Photos, Privacy, Poster, Settings; no DJ tool', () => {
  for (const k of ['home', 'photos', 'privacy', 'poster', 'settings']) assert.ok(isCoupleWeddingTab(k), k)
  for (const k of ['requests', 'dedications', 'games', 'booth', 'screen']) assert.ok(!isCoupleWeddingTab(k), k)
})

test('wording: the account type is shown ONLY as "Sposi" in every locale', () => {
  assert.equal(COUPLE_LABEL, 'Sposi')
  for (const l of ['it', 'en', 'es', 'fr']) {
    const roles = JSON.parse(readFileSync(new URL(`../../locales/${l}.json`, import.meta.url), 'utf8')).roles as Record<string, string>
    assert.equal(roles.coupleTitle, 'Sposi', l)
    const all = JSON.stringify(roles)
    assert.doesNotMatch(all, /\bsposo\b|\bsposa\b|sposo\/a|\bcouple\b|\bcoppia\b/i, `${l}: forbidden label in roles.*`)
  }
})

test('portal mode: the DOMAIN decides, accountType never moves a user between products (dj / couple / missing all work on both)', async () => {
  const { resolvePortalMode } = await import('../../lib/roleRules')
  for (const type of ['dj', 'couple'] as const) {
    assert.equal(resolvePortalMode('iomixo', type), 'iomixo', `${type} on iomixo.com stays on IOMIXO`)
    assert.equal(resolvePortalMode('miolove', type), 'miolove', `${type} on miolovealbum.com stays on MIOLOVE`)
  }
  assert.equal(resolvePortalMode('iomixo', resolveAccountType(undefined)), 'iomixo', 'legacy account (no accountType) on IOMIXO')
  assert.equal(resolvePortalMode('miolove', resolveAccountType(undefined)), 'miolove', 'legacy account (no accountType) on MIOLOVE')
  assert.equal(resolvePortalMode(null, 'couple'), 'miolove', 'dev / preview host keeps the legacy behaviour')
  assert.equal(resolvePortalMode(null, 'dj'), 'iomixo')
})
