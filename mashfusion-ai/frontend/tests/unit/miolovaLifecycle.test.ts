import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { Timestamp } from '../../../../firebase/functions/node_modules/firebase-admin/lib/firestore'
import { albumExpiryFrom, albumPhase, activationBlockReason, activationDates, trialPurgeAt, uploadBlockReason, ALBUM_RETENTION_DAYS, TRIAL_GRACE_DAYS } from '../../../../firebase/functions/src/photos/albumLifecycle'
import { purgeReasonOf } from '../../../../firebase/functions/src/albums/purge'
import { brandFromEvent } from '../../../../firebase/functions/src/owner/brand'
import { guestAlbumClosure, screenClosedKind } from '../../lib/miolove/guestClosure'

// Multi-album lifecycle: the pure rules (dates, phases, who may pay, who may upload, what the purge job may touch). Server clock is injected as `now`.
const DAY = 86_400_000
const at = (iso: string) => new Date(iso)
const ts = (iso: string) => Timestamp.fromDate(at(iso))
const NOW = at('2026-10-23T09:00:00Z')

test('LC-1. 365 exact days from activation; the trial recovery window is 30 days after the trial end', () => {
  assert.equal(ALBUM_RETENTION_DAYS, 365); assert.equal(TRIAL_GRACE_DAYS, 30)
  assert.equal(albumExpiryFrom(at('2026-10-23T09:00:00Z')).toISOString(), '2027-10-23T09:00:00.000Z')
  assert.equal(albumExpiryFrom(at('2027-04-23T10:30:00Z')).toISOString(), '2028-04-22T10:30:00.000Z', 'a leap day inside the year counts as a day: 365 days, not "one calendar year"')
  assert.equal(trialPurgeAt(at('2026-10-30T09:00:00Z')).toISOString(), '2026-11-29T09:00:00.000Z')
  const d = activationDates(NOW)
  assert.equal(d.expiresAt.toMillis() - d.activatedAt.toMillis(), 365 * DAY); assert.equal(d.purgeAfter.toMillis(), d.expiresAt.toMillis())
})

test('LC-2. two albums, two clocks: activating B never moves A', () => {
  const a = activationDates(at('2026-10-23T09:00:00Z')), b = activationDates(at('2027-04-23T09:00:00Z'))
  assert.equal(a.expiresAt.toDate().toISOString().slice(0, 10), '2027-10-23'); assert.equal(b.expiresAt.toDate().toISOString().slice(0, 10), '2028-04-22')
  assert.notEqual(a.expiresAt.toMillis(), b.expiresAt.toMillis())
})

test('LC-3. phases: trial → trial_ended → trial_lapsed; pending; active → expired; purged; IOMIXO/legacy = null', () => {
  const trial = (end: string) => ({ type: 'wedding', brand: 'miolove', accessMode: 'trial', trialExpiresAt: ts(end) })
  assert.equal(albumPhase(trial('2026-10-30T00:00:00Z'), NOW), 'trial')
  assert.equal(albumPhase(trial('2026-10-22T00:00:00Z'), NOW), 'trial_ended')
  assert.equal(albumPhase(trial('2026-09-22T00:00:00Z'), NOW), 'trial_lapsed')
  assert.equal(albumPhase({ type: 'wedding', accessMode: 'trial' }, NOW), 'trial', 'an older trial without an end never expires')
  assert.equal(albumPhase({ accessMode: 'pending' }, NOW), 'pending')
  assert.equal(albumPhase({ accessMode: 'activated', expiresAt: ts('2027-01-01T00:00:00Z') }, NOW), 'active')
  assert.equal(albumPhase({ accessMode: 'activated', expiresAt: ts('2026-10-23T09:00:00Z') }, NOW), 'expired', 'now >= expiresAt')
  assert.equal(albumPhase({ accessMode: 'activated' }, NOW), 'active', 'activated before the field existed')
  assert.equal(albumPhase({ accessMode: 'purged' }, NOW), 'purged')
  assert.equal(albumPhase({ type: 'party', status: 'live' }, NOW), null); assert.equal(albumPhase({ type: 'wedding' }, NOW), null)
})

test('LC-4. uploads: only an open trial or an active album takes them; pending / paused / expired are refused with their own reason', () => {
  assert.equal(uploadBlockReason({ accessMode: 'trial', trialExpiresAt: ts('2026-10-30T00:00:00Z') }, NOW), null)
  assert.equal(uploadBlockReason({ accessMode: 'activated', expiresAt: ts('2027-01-01T00:00:00Z') }, NOW), null)
  assert.equal(uploadBlockReason({ accessMode: 'pending' }, NOW), 'miolove_album_not_activated')
  assert.equal(uploadBlockReason({ accessMode: 'trial', trialExpiresAt: ts('2026-10-22T00:00:00Z') }, NOW), 'miolove_trial_expired')
  assert.equal(uploadBlockReason({ accessMode: 'activated', expiresAt: ts('2026-10-01T00:00:00Z') }, NOW), 'miolove_album_expired')
  assert.equal(uploadBlockReason({ type: 'party' }, NOW), null, 'IOMIXO events are not governed by the album lifecycle')
})

test('LC-5. who may pay: pending, trial, paused trial inside 30 days; never an activated, lapsed, purging, purged or deleted album', () => {
  const ok = (ev: object) => activationBlockReason(ev, NOW)
  assert.equal(ok({ accessMode: 'pending' }), null)
  assert.equal(ok({ accessMode: 'trial', trialExpiresAt: ts('2026-10-30T00:00:00Z') }), null)
  assert.equal(ok({ accessMode: 'trial', trialExpiresAt: ts('2026-10-10T00:00:00Z') }), null, 'inside the 30-day window')
  assert.equal(ok({ accessMode: 'trial', trialExpiresAt: ts('2026-09-01T00:00:00Z') }), 'album_not_eligible', 'past the window: an old Checkout cannot revive it')
  assert.equal(ok({ accessMode: 'activated', expiresAt: ts('2027-01-01T00:00:00Z') }), 'already_activated')
  assert.equal(ok({ accessMode: 'activated', expiresAt: ts('2026-01-01T00:00:00Z') }), 'already_activated', 'an expired paid album is not "re-activated" by a stray payment')
  assert.equal(ok({ accessMode: 'purged' }), 'album_not_eligible')
  assert.equal(ok({ accessMode: 'pending', purge: { state: 'running' } }), 'album_gone')
  assert.equal(ok({ accessMode: 'pending', deletedAt: ts('2026-10-01T00:00:00Z') }), 'album_gone')
})

test('LC-6. purge selection: due only by the authoritative fields; pending / IOMIXO / undecided legacy / purged are never touched', () => {
  const act = (end: string) => ({ type: 'wedding', brand: 'miolove', accessMode: 'activated', expiresAt: ts(end) })
  assert.equal(purgeReasonOf(act('2026-10-23T09:00:00Z'), NOW), 'album_expired')
  assert.equal(purgeReasonOf(act('2026-10-23T09:00:01Z'), NOW), null)
  const trial = (end: string) => ({ type: 'wedding', brand: 'miolove', accessMode: 'trial', trialExpiresAt: ts(end) })
  assert.equal(purgeReasonOf(trial('2026-09-23T09:00:00Z'), NOW), 'trial_lapsed')
  assert.equal(purgeReasonOf(trial('2026-09-24T09:00:00Z'), NOW), null, 'still inside the 30 days')
  assert.equal(purgeReasonOf({ type: 'wedding', brand: 'miolove', accessMode: 'pending' }, NOW), null)
  assert.equal(purgeReasonOf({ type: 'wedding', brand: 'miolove', accessMode: 'activated' }, NOW), null, 'no expiresAt = no purge (needs the backfill first)')
  assert.equal(purgeReasonOf({ type: 'party', status: 'live', expiresAt: ts('2020-01-01T00:00:00Z') }, NOW), null, 'IOMIXO event, even with a stray date')
  assert.equal(purgeReasonOf({ type: 'wedding', brand: 'iomixo', accessMode: 'activated', expiresAt: ts('2020-01-01T00:00:00Z') }, NOW), null, 'explicit IOMIXO brand wins')
  assert.equal(purgeReasonOf({ type: 'wedding', accessMode: 'activated', expiresAt: ts('2020-01-01T00:00:00Z') }, NOW), 'album_expired', 'legacy wedding with a server accessMode is a MIOLOVE album')
  assert.equal(purgeReasonOf({ accessMode: 'purged', purgedAt: ts('2026-01-01T00:00:00Z') }, NOW), null)
  assert.equal(brandFromEvent({ type: 'wedding', accessMode: 'pending' }), 'miolove')
})

test('LC-7. guest pages: the server flags decide; pending / expired / paused are closed; a paid, trial or IOMIXO page is not', () => {
  const now = NOW.getTime()
  assert.equal(guestAlbumClosure({ access_mode: 'pending' }, true, now).kind, 'pending')
  assert.equal(guestAlbumClosure({ access_mode: 'activated', album_phase: 'expired' }, true, now).kind, 'expired')
  assert.equal(guestAlbumClosure({ access_mode: 'activated', expires_at: '2026-10-01T00:00:00Z' }, true, now).kind, 'expired', 'an open page crosses the end date')
  assert.equal(guestAlbumClosure({ access_mode: 'trial', trial_expired: true }, true, now).key, 'guestAlbum.trialEnded')
  assert.equal(guestAlbumClosure({ access_mode: 'activated', expires_at: '2027-10-01T00:00:00Z' }, true, now).closed, false)
  assert.equal(guestAlbumClosure({ access_mode: 'trial', trial_expires_at: '2026-10-30T00:00:00Z' }, true, now).closed, false)
  assert.equal(guestAlbumClosure({ access_mode: 'pending' }, false, now).closed, false, 'not a MIOLOVE page')
  assert.equal(screenClosedKind({ accessMode: 'pending' }, now), 'pending')
  assert.equal(screenClosedKind({ accessMode: 'activated', expiresAt: new Date('2026-10-01') }, now), 'expired')
  assert.equal(screenClosedKind({ accessMode: 'activated', expiresAt: new Date('2027-10-01') }, now), null)
  assert.equal(screenClosedKind({ accessMode: 'trial' }, now), null, 'a paused trial keeps its slideshow')
})

test('LC-8. wiring: the retention job is a daily Europe/Rome schedule that runs the album purge only; the Stripe secrets stay out of it; the album checkout never writes expiry itself', () => {
  const src = readFileSync(__dirname + '/../../../../firebase/functions/src/index.ts', 'utf8')
  const i = src.indexOf('export const purgeExpiredMioloveAlbums'); assert.ok(i > 0)
  const block = src.slice(i, src.indexOf('\n)\n', i) + 3)
  assert.match(block, /onSchedule/); assert.match(block, /schedule: 'every day [0-9:]+'/); assert.match(block, /timeZone: 'Europe\/Rome'/); assert.match(block, /purgeExpiredAlbums\(getFirestore\(\)\)/)
  assert.doesNotMatch(block, /STRIPE|secrets/i)
  const checkout = readFileSync(__dirname + '/../../../../firebase/functions/src/billing/albumCheckout.ts', 'utf8')
  assert.doesNotMatch(checkout, /\.(update|set|runTransaction)\(/, 'the checkout writes nothing to Firestore: only the verified webhook activates')
  const webhook = readFileSync(__dirname + '/../../../../firebase/functions/src/billing/mioloveWebhook.ts', 'utf8')
  assert.match(webhook, /activationDates\(now\)/, 'dates come from the server clock')
  const purge = readFileSync(__dirname + '/../../../../firebase/functions/src/albums/purge.ts', 'utf8')
  assert.doesNotMatch(purge, /(collection|doc)\(\s*['"`](users|mioloveStripeEvents|trialAlbums|stripeCustomers)/, 'the purge never touches payment / audit / reservation collections')
})
