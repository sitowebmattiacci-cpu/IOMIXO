import { test } from 'node:test'
import assert from 'node:assert/strict'
import { screenEligibility, composeScreenPayload } from '../../lib/events/screenModel'
import type { EventDoc } from '../../lib/firebase/models'

const ev = (over: Partial<EventDoc> = {}): EventDoc => ({
  id: 'e1', ownerUid: 'o', slug: 's', title: 'Titolo', djName: 'DJ', description: null, type: 'wedding', status: 'live', coupleNames: 'A & B', weddingDate: '2026-09-12',
  venueName: 'Villa', screenModeEnabled: true, guestConfig: null, screenConfig: { show_polls: true, show_dedications: true }, createdAt: new Date(), updatedAt: new Date(), ...over,
})
const round = (id: string, result: unknown = { slot_index: 1 }) => ({ id, game_type: 'x', status: 'completed', config: null, result, created_at: '', updated_at: '' }) as any
const games = { roulette: round('r'), shoeGame: round('s') }

test('Firestore screen is used when the event is complete and the plan allows it', () => {
  const v = screenEligibility(ev(), true, undefined)
  assert.equal(v.ok, true)
})

test('explicit legacy fallback for every case the Firestore data cannot cover', () => {
  const reason = (e: EventDoc | null, allowed: boolean | null = true, g = undefined as any, x: any = {}) => { const v = screenEligibility(e, allowed, g, x); return v.ok ? 'ok' : v.legacyReason }
  assert.equal(reason(null), 'no_event')
  assert.equal(reason(ev({ type: 'standard' })), 'not_screen_type')
  for (const bad of [undefined, null, [], 'x', 5]) assert.equal(reason(ev({ screenConfig: bad as any })), 'no_config', String(bad))
  assert.equal(reason(ev(), null), 'pending')
  assert.equal(reason(ev(), false), 'screen_not_allowed')
  // photos: native events serve them from Firestore once the realtime list is there; a legacy-backed event only after its photos were migrated
  assert.equal(reason(ev({ screenConfig: { show_photos: true } })), 'pending')                                  // realtime list not ready yet
  assert.equal(reason(ev({ screenConfig: { show_photos: true } }), true, undefined, { photos: [] }), 'ok')      // ready, no approved photo: an empty wall, no fallback
  assert.equal(reason(ev({ legacySupabaseId: 'ls1', screenConfig: { show_photos: true } }), true, undefined, { photos: [] }), 'photos')   // legacy photos not migrated → legacy
  assert.equal(reason(ev({ legacySupabaseId: 'ls1', photosMigratedAt: new Date(), screenConfig: { show_photos: true } }), true, undefined, { photos: [] }), 'ok')
  assert.equal(reason(ev({ legacySupabaseId: 'ls1', screenConfig: { show_photos: false } })), 'ok')            // photos hidden: nothing to migrate for the TV
  // winner: names only → Firestore; legacy storage paths → legacy; Firebase paths → need the resolved URLs
  assert.equal(reason(ev({ screenConfig: { show_polls: true, winner_announcement: { enabled: true } } })), 'ok')
  assert.equal(reason(ev({ screenConfig: { winner_announcement: { groom_photo_path: 'x/g.jpg' } } })), 'winner')
  assert.equal(reason(ev({ screenConfig: { winner_announcement: { groom_photo_path: 'events/e1/winner/groom-aaaaaaaaaaaa.jpg' } } })), 'pending')
  assert.equal(reason(ev({ screenConfig: { winner_announcement: { groom_photo_path: 'events/e1/winner/groom-aaaaaaaaaaaa.jpg' } } }), true, undefined, { winnerUrls: { groom: 'u', bride: null } }), 'ok')
  assert.equal(reason(ev({ screenConfig: { winner_announcement: { groom_photo_path: 'events/e1/winner/groom-aaaaaaaaaaaa.jpg', bride_photo_path: 'old/b.jpg' } } }), true, undefined, { winnerUrls: { groom: 'u', bride: null } }), 'winner')
  assert.equal(reason(ev({ screenConfig: { winner_announcement: true as any } })), 'winner')                   // unknown shape → legacy decides
  assert.equal(reason(ev({ screenConfig: { winner_announcement: null } })), 'ok')                            // reset winner → Firestore is fine
  assert.equal(reason(ev({ screenConfig: { show_roulette: true } }), true, undefined), 'pending')            // games still loading
  assert.equal(reason(ev({ screenConfig: { show_roulette: true } }), true, { roulette: null, shoeGame: null }), 'games_pending')   // no history in Firestore → legacy
  assert.equal(reason(ev({ screenConfig: { show_shoe_game: true } }), true, { roulette: round('r'), shoeGame: null }), 'games_pending')
  assert.equal(reason(ev({ screenConfig: { show_roulette: true, show_shoe_game: true } }), true, games), 'ok')
  assert.equal(reason(ev({ screenConfig: { show_roulette: false } }), true, { roulette: null, shoeGame: null }), 'ok')   // hidden sections need no data
})

test('composeScreenPayload: photos only when shown (max 12), winner enriched with the resolved URLs', () => {
  const photos = Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, guest_name: null, caption: null, url: `u${i}`, created_at: '' })) as any
  assert.equal(composeScreenPayload(ev(), { show_photos: true }, undefined, undefined, [], { photos }).photos.length, 12)
  assert.equal(composeScreenPayload(ev(), { show_photos: false }, undefined, undefined, [], { photos }).photos.length, 0)
  assert.equal(composeScreenPayload(ev(), { show_photos: true }, undefined, undefined, [], {}).photos.length, 0)
  const w = { phase: 'running', groom_photo_path: 'events/e1/winner/groom-aaaaaaaaaaaa.jpg', bride_photo_path: null }
  const withWinner = composeScreenPayload(ev(), { winner_announcement: w }, undefined, undefined, [], { winnerUrls: { groom: 'G', bride: null } }).session.screen_config as any
  assert.deepEqual([withWinner.winner_announcement.groom_photo_url, withWinner.winner_announcement.bride_photo_url, withWinner.winner_announcement.phase], ['G', null, 'running'])
  assert.equal((composeScreenPayload(ev(), { show_polls: true }, undefined, undefined, []).session.screen_config as any).winner_announcement, undefined)
})

test('composeScreenPayload: only enabled sections, never throws on an empty config, no photos', () => {
  const dedications = Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, senderName: i ? `G${i}` : null, message: `m${i}`, status: 'approved' as const, createdAt: new Date(2026, 0, i + 1), updatedAt: null }))
  const poll = { poll: { id: 'p', question: 'Q?', options: ['A', 'B'], status: 'open' as const, createdAt: new Date(), updatedAt: null }, tally: [3, 1], myVote: null }
  const p = composeScreenPayload(ev(), { show_polls: true, show_dedications: true }, poll, undefined, dedications)
  assert.equal(p.session.event_name, 'Titolo'); assert.equal(p.session.is_active, true); assert.equal(p.photos.length, 0)
  assert.equal(p.dedications.length, 6); assert.equal(p.dedications[0].guest_name, null)
  assert.deepEqual(p.active_poll?.tally, [3, 1]); assert.equal(p.active_poll?.question, 'Q?')
  assert.equal(p.roulette, null); assert.equal(p.shoe_game, null)

  const empty = composeScreenPayload(ev({ status: 'ended' }), {}, poll, games, dedications)                      // no toggles → nothing shown, nothing crashes
  assert.deepEqual([empty.dedications, empty.active_poll, empty.roulette, empty.shoe_game, empty.session.is_active], [[], null, null, null, false])
  const noData = composeScreenPayload(ev(), { show_polls: true, show_dedications: true, show_roulette: true, show_shoe_game: true }, null, undefined, null)
  assert.deepEqual([noData.dedications, noData.active_poll, noData.roulette, noData.shoe_game], [[], null, null, null])
  assert.equal(composeScreenPayload(ev(), { show_roulette: true }, undefined, { roulette: round('r', null), shoeGame: null }, []).roulette, null)   // round without result is not shown (legacy rule)
})
