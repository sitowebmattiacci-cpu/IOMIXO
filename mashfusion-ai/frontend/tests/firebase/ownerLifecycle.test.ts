import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc, collection, getDocs, addDoc } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { newClient, closeClient, denied, type TestClient } from './helpers'
import { seedSet, eventFields } from './seed'
import { listOwnerEvents } from '../../lib/firebase/repositories/eventRepository'

/** Event lifecycle (createEvent / deleteEvent / restoreEvent) and games (ownerGameAction / setGameConfig) against the Functions emulator. */
const clients: TestClient[] = []
after(async () => { await Promise.all(clients.map(closeClient)) })
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }
const callAs = <O = any>(c: TestClient, name: string, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, O>(f, name)(data as any).then((r) => r.data)
}
async function fails(p: Promise<unknown>) { try { await p } catch (e: any) { return `${String(e.code).replace('functions/', '')}:${e.details?.reason ?? ''}` } assert.fail('expected rejection') }
const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
const fsList = async (path: string) => ((await fsGet(path)).documents ?? []) as any[]
let n = 0
const rid = () => `req${Date.now()}${n++}`
const owner = async (tier: 'free' | 'pro' | 'wedding') => { const c = await mk(); await seedSet(`users/${c.uid}`, { uid: c.uid, plan: { tier, source: 'legacy' } }); return c }
const create = (c: TestClient, over: Record<string, unknown> = {}) => callAs<{ eventId: string; slug: string; created: boolean }>(c, 'createEvent', { requestId: rid(), title: 'Serata', type: 'standard', ...over })

// ── createEvent ─────────────────────────────────────────────────────────────
test('L1. create: event + slug written atomically, ownerUid from the token, wedding-only fields only for wedding', async () => {
  const dj = await owner('wedding')
  const w = await create(dj, { type: 'wedding', title: 'Matrimonio', djName: 'DJ X', coupleNames: 'Anna & Marco', weddingDate: '2026-09-12', venueName: 'Villa', screenModeEnabled: true, ownerUid: 'attacker', status: 'ended' })
  assert.equal(w.created, true); assert.match(w.slug, /^[a-z0-9]{10,}$/)
  const e = (await getDoc(doc(dj.db, 'events', w.eventId))).data()!
  assert.equal(e.ownerUid, dj.uid, 'owner comes from the token, never from the payload'); assert.equal(e.status, 'live'); assert.equal(e.slug, w.slug)
  assert.deepEqual([e.title, e.djName, e.type, e.coupleNames, e.weddingDate, e.venueName, e.screenModeEnabled], ['Matrimonio', 'DJ X', 'wedding', 'Anna & Marco', '2026-09-12', 'Villa', true])
  assert.equal(e.guestConfig, null); assert.equal(e.screenConfig, null); assert.equal(e.legacySupabaseId, undefined, 'no Supabase id: Firebase-native')
  assert.equal((await fsGet(`eventSlugs/${w.slug}`)).fields.eventId.stringValue, w.eventId)

  const p = await create(dj, { type: 'party', coupleNames: 'ignored', venueName: 'ignored', screenModeEnabled: true })
  const pe = (await getDoc(doc(dj.db, 'events', p.eventId))).data()!
  assert.deepEqual([pe.coupleNames, pe.venueName, pe.screenModeEnabled], [null, null, false], 'wedding-only fields are dropped for other types (as the legacy insert)')
})

test('L2. create is idempotent per requestId; a different requestId makes a different event; the title is required', async () => {
  const dj = await owner('pro'); const id = rid()
  const a = await callAs(dj, 'createEvent', { requestId: id, title: 'Uno' }), b = await callAs(dj, 'createEvent', { requestId: id, title: 'Uno' })
  assert.equal(a.eventId, b.eventId); assert.equal(a.slug, b.slug); assert.equal(b.created, false)
  assert.equal((await fsList('events')).filter((d) => d.fields.ownerUid?.stringValue === dj.uid).length, 1, 'one document')
  const c = await callAs(dj, 'createEvent', { requestId: rid(), title: 'Due' }); assert.notEqual(c.eventId, a.eventId)
  assert.equal(await fails(callAs(dj, 'createEvent', { requestId: rid(), title: '  ' })), 'invalid-argument:invalid_payload')
  assert.equal(await fails(callAs(dj, 'createEvent', { title: 'x' })), 'invalid-argument:invalid_payload')
  const other = await owner('pro'); const o = await callAs(other, 'createEvent', { requestId: id, title: 'Uno' })
  assert.equal(o.created, true); assert.notEqual(o.eventId, a.eventId, 'the same requestId from ANOTHER account is a different event (id derives from uid + requestId)')
})

test('L3. plan gates: premium types need Advance / Event Pass; Free is limited to 1 active session; Pro / Advance are unlimited', async () => {
  const free = await owner('free')
  assert.equal(await fails(create(free, { type: 'wedding' })), 'permission-denied:event_access_required')
  assert.equal(await fails(create(free, { type: 'party' })), 'permission-denied:event_access_required')
  await create(free)                                                                            // first active session: ok
  assert.equal(await fails(create(free)), 'resource-exhausted:session_limit')
  const pro = await owner('pro'); await create(pro); await create(pro); await create(pro)
  assert.equal(await fails(create(pro, { type: 'party' })), 'permission-denied:event_access_required', 'Pro is not Advance')
  const adv = await owner('wedding'); await create(adv, { type: 'party' }); await create(adv, { type: 'wedding' })

  // an active Event Pass unlocks premium for a Free account (legacy hasEventAccess)
  const passer = await owner('free'); await seedSet(`users/${passer.uid}/eventPasses/p1`, { status: 'active', validUntil: new Date(Date.now() + 3_600_000), legacySessionId: null, eventId: null })
  await create(passer, { type: 'wedding' })
  const expired = await owner('free'); await seedSet(`users/${expired.uid}/eventPasses/p1`, { status: 'active', validUntil: new Date(Date.now() - 3_600_000) })
  assert.equal(await fails(create(expired, { type: 'party' })), 'permission-denied:event_access_required')
})

test('L4. an ended or deleted session no longer counts against the Free limit; anonymous / signed-out callers are refused', async () => {
  const free = await owner('free'); const a = await create(free)
  assert.equal(await fails(create(free)), 'resource-exhausted:session_limit')
  await callAs(free, 'updateEventConfig', { eventId: a.eventId, eventFields: { status: 'ended' } })
  await create(free)                                                                            // slot freed by closing
  const free2 = await owner('free'); const b = await create(free2)
  await callAs(free2, 'deleteEvent', { eventId: b.eventId }); await create(free2)               // slot freed by deleting
  const anon = await mk('anonymous')
  assert.equal(await fails(callAs(anon, 'createEvent', { requestId: rid(), title: 'x' })), 'permission-denied:account_required')
})

test('L5. core fields: the owner edits title / djName / is_active on a native event with updateEventConfig; another account cannot', async () => {
  const dj = await owner('wedding'), other = await owner('wedding'); const e = await create(dj, { type: 'wedding' })
  await callAs(dj, 'updateEventConfig', { eventId: e.eventId, eventFields: { title: 'Nuovo titolo', djName: 'DJ Y', description: null, coupleNames: 'A & B', weddingDate: '2027-01-01', venueName: 'Sala', status: 'ended' } })
  const d = (await getDoc(doc(dj.db, 'events', e.eventId))).data()!
  assert.deepEqual([d.title, d.djName, d.coupleNames, d.venueName, d.status, d.slug, d.type], ['Nuovo titolo', 'DJ Y', 'A & B', 'Sala', 'ended', e.slug, 'wedding'], 'slug and type are untouched')
  assert.equal(await fails(callAs(other, 'updateEventConfig', { eventId: e.eventId, eventFields: { title: 'hack' } })), 'not-found:event_not_found')
  await callAs(dj, 'updateEventConfig', { eventId: e.eventId, eventFields: { title: 'T2', slug: 'new', type: 'party', ownerUid: 'x' } })
  const d2 = (await getDoc(doc(dj.db, 'events', e.eventId))).data()!
  assert.deepEqual([d2.title, d2.slug, d2.type, d2.ownerUid], ['T2', e.slug, 'wedding', dj.uid], 'slug, type and owner are immutable through this callable')
})

// ── deleteEvent / restoreEvent ───────────────────────────────────────────────
test('L6. delete = SOFT: slug unresolvable, document and children kept, guest cannot read it, owner list hides it; idempotent; not-yours is not-found', async () => {
  const dj = await owner('wedding'), other = await owner('wedding'), guest = await mk('anonymous')
  const e = await create(dj, { type: 'party' })
  await seedSet(`events/${e.eventId}/requests/r1`, { guestUid: guest.uid, songTitle: 'S', artist: null, message: null, status: 'pending', createdAt: new Date(), updatedAt: new Date() })
  assert.equal(await fails(callAs(other, 'deleteEvent', { eventId: e.eventId })), 'not-found:event_not_found')
  assert.deepEqual(await callAs(dj, 'deleteEvent', { eventId: e.eventId }), { deleted: true })
  assert.deepEqual(await callAs(dj, 'deleteEvent', { eventId: e.eventId }), { deleted: false }, 'idempotent')

  assert.equal((await fsGet(`eventSlugs/${e.slug}`)).fields, undefined, 'the slug no longer resolves')
  const raw = await fsGet(`events/${e.eventId}`)
  assert.ok(raw.fields.deletedAt && raw.fields.deletedBy.stringValue === dj.uid && raw.fields.status.stringValue === 'ended', 'soft delete markers')
  assert.equal((await fsList(`events/${e.eventId}/requests`)).length, 1, 'subcollections are preserved (no blind deletion)')
  assert.ok(await denied(getDoc(doc(guest.db, 'events', e.eventId))), 'a guest can no longer read the event by id')
  assert.equal((await getDoc(doc(guest.db, 'eventSlugs', e.slug))).exists(), false, 'and the slug is gone')
  assert.equal(await fails(callAs(guest, 'getPublicEvent', { slug: e.slug })), 'not-found:event_not_found')
  assert.equal(await fails(callAs(dj, 'updateEventConfig', { eventId: e.eventId, eventFields: { title: 'zombie' } })), 'not-found:event_not_found', 'a deleted event is not editable')
  assert.equal(await fails(callAs(dj, 'ownerGameAction', { eventId: e.eventId, game: 'shoe', action: 'start' })), 'not-found:event_not_found')
  assert.ok(!(await listOwnerEvents(dj.db, dj.uid)).some((x) => x.id === e.eventId), 'the dashboard list filters it out')
})

test('L7. restore brings the event back (ended) with its slug; a slug taken meanwhile blocks it; restoring a live event is a no-op', async () => {
  const dj = await owner('wedding'); const e = await create(dj)
  assert.deepEqual(await callAs(dj, 'restoreEvent', { eventId: e.eventId }), { restored: false, slug: e.slug })
  await callAs(dj, 'deleteEvent', { eventId: e.eventId })
  assert.deepEqual(await callAs(dj, 'restoreEvent', { eventId: e.eventId }), { restored: true, slug: e.slug })
  assert.equal((await fsGet(`eventSlugs/${e.slug}`)).fields.eventId.stringValue, e.eventId)
  const back = (await getDoc(doc(dj.db, 'events', e.eventId))).data()!
  assert.equal(back.deletedAt, undefined); assert.equal(back.status, 'ended')

  await callAs(dj, 'deleteEvent', { eventId: e.eventId })
  await seedSet(`eventSlugs/${e.slug}`, { eventId: 'someone-else' })                            // the freed slug was taken
  assert.equal(await fails(callAs(dj, 'restoreEvent', { eventId: e.eventId })), 'already-exists:slug_taken')
})

// ── games ──────────────────────────────────────────────────────────────────
const act = (c: TestClient, eventId: string, game: string, action: string, extra: Record<string, unknown> = {}) => callAs<{ roundId: string | null; status: string | null }>(c, 'ownerGameAction', { eventId, game, action, ...extra })
const rounds = async (eventId: string, type: string) => (await fsList(`events/${eventId}/games`)).filter((d) => d.fields.type.stringValue === type)
const cfgOf = (d: any) => d.fields.config.mapValue.fields
const pen = (...labels: string[]) => labels.map((label) => ({ label, category: 'soft', enabled: true }))
async function party(tier: 'wedding' | 'free' = 'wedding', type = 'party') {
  const dj = await owner(tier)
  const id = `gev${Date.now()}${n++}`
  await seedSet(`events/${id}`, eventFields(dj.uid, `gs${id}`, { type })); await seedSet(`eventSlugs/gs${id}`, { eventId: id })
  return { dj, id }
}

test('G1. roulette: start closes the previous round, spin picks from the round and completes it, reset clears the result', async () => {
  const { dj, id } = await party()
  const r1 = await act(dj, id, 'roulette', 'start'); assert.equal(r1.status, 'idle')
  const first = (await rounds(id, 'wedding_roulette'))[0]
  const defaults = cfgOf(first).penitenze.arrayValue.values.length; assert.equal(defaults, 16, '9 defaults + the 7 soft/party ones that WILD re-adds (legacy behaviour, ported as is)')
  const s1 = await act(dj, id, 'roulette', 'spin'); assert.equal(s1.roundId, r1.roundId); assert.equal(s1.status, 'completed')
  const spun = (await rounds(id, 'wedding_roulette'))[0].fields.result.mapValue.fields
  assert.ok(spun.slot_label.stringValue && spun.picked_at.stringValue && spun.slot_index.integerValue !== undefined)
  assert.equal(await fails(act(dj, id, 'roulette', 'spin')), 'failed-precondition:no_active_game', 'the round is completed: nothing active')

  const r2 = await act(dj, id, 'roulette', 'start'); assert.notEqual(r2.roundId, r1.roundId)
  await act(dj, id, 'roulette', 'start')                                                          // the previous idle round is closed
  const all = await rounds(id, 'wedding_roulette'); assert.equal(all.length, 3)
  assert.equal(all.filter((d) => d.fields.status.stringValue !== 'completed').length, 1, 'exactly one active round')
  await act(dj, id, 'roulette', 'reset')
  assert.equal((await rounds(id, 'wedding_roulette')).filter((d) => d.fields.status.stringValue !== 'completed').length, 0)
  const newest = (await rounds(id, 'wedding_roulette')).sort((a, b) => b.createTime.localeCompare(a.createTime))[0]
  assert.ok(!newest.fields.result?.mapValue, 'the active round result is cleared')
})

test('G2. roulette custom penalties live in the owner-private config; categories filter (WILD pulls soft + party); smart random never repeats back-to-back', async () => {
  const { dj, id } = await party('wedding', 'wedding'); const guest = await mk('anonymous')
  await callAs(dj, 'setGameConfig', { eventId: id, roulettePenitenze: [{ label: 'A', category: 'soft', enabled: true }, { label: 'B', category: 'soft', enabled: true }, { label: 'W', category: 'wild', enabled: true }, { label: 'X', category: 'party', enabled: false }] })
  const priv = (await getDoc(doc(dj.db, 'events', id, 'private', 'gameConfig'))).data()!
  assert.equal(priv.roulettePenitenze.length, 4); assert.ok(await denied(getDoc(doc(guest.db, 'events', id, 'private', 'gameConfig'))), 'guests cannot read the private config')

  await act(dj, id, 'roulette', 'start', { categories: ['soft'] })
  assert.deepEqual((await rounds(id, 'wedding_roulette'))[0].fields.config.mapValue.fields.penitenze.arrayValue.values.map((v: any) => v.mapValue.fields.label.stringValue).sort(), ['A', 'B'])
  await act(dj, id, 'roulette', 'start', { categories: ['wild'] })
  const labels = (await rounds(id, 'wedding_roulette')).find((d) => d.fields.status.stringValue === 'idle')!.fields.config.mapValue.fields.penitenze.arrayValue.values.map((v: any) => v.mapValue.fields.label.stringValue).sort()
  assert.deepEqual(labels, ['A', 'B', 'W'], 'WILD also pulls the enabled soft + party penalties')
  assert.equal(await fails(act(dj, id, 'roulette', 'start', { categories: ['party'] })), 'failed-precondition:no_penalties', 'the only party penalty is disabled')

  await callAs(dj, 'setGameConfig', { eventId: id, roulettePenitenze: pen('P', 'Q') })
  const picks: string[] = []
  for (let i = 0; i < 6; i++) { await act(dj, id, 'roulette', 'start'); await act(dj, id, 'roulette', 'spin'); picks.push((await rounds(id, 'wedding_roulette')).sort((a, b) => b.createTime.localeCompare(a.createTime))[0].fields.result.mapValue.fields.slot_label.stringValue) }
  for (let i = 1; i < picks.length; i++) assert.notEqual(picks[i], picks[i - 1], `no immediate repeat: ${picks.join(',')}`)
  await callAs(dj, 'setGameConfig', { eventId: id, roulettePenitenze: null })
  assert.equal((await getDoc(doc(dj.db, 'events', id, 'private', 'gameConfig'))).data()!.roulettePenitenze, undefined, 'null = back to defaults')
})

test('G3. shoe game: start (defaults / custom config / explicit questions), next advances, finishing completes with a total, reset', async () => {
  const { dj, id } = await party('wedding', 'wedding')
  await act(dj, id, 'shoe', 'start')
  let r = (await rounds(id, 'shoe_game'))[0]; assert.equal(cfgOf(r).questions.arrayValue.values.length, 15); assert.equal(cfgOf(r).current_index.integerValue, '0'); assert.equal(r.fields.status.stringValue, 'running')

  await callAs(dj, 'setGameConfig', { eventId: id, shoeGameQuestions: ['Uno?', 'Due?', 'Tre?'] })
  await act(dj, id, 'shoe', 'start')
  r = (await rounds(id, 'shoe_game')).find((d) => d.fields.status.stringValue === 'running')!
  assert.deepEqual(cfgOf(r).questions.arrayValue.values.map((v: any) => v.stringValue), ['Uno?', 'Due?', 'Tre?'])
  assert.equal((await rounds(id, 'shoe_game')).filter((d) => d.fields.status.stringValue === 'running').length, 1, 'the previous round was closed')

  assert.deepEqual((await act(dj, id, 'shoe', 'next')).status, 'running'); assert.deepEqual((await act(dj, id, 'shoe', 'next')).status, 'running')
  assert.deepEqual((await act(dj, id, 'shoe', 'next')).status, 'completed', 'past the last question the game completes')
  r = (await rounds(id, 'shoe_game')).sort((a, b) => b.createTime.localeCompare(a.createTime))[0]
  assert.equal(r.fields.result.mapValue.fields.total.integerValue, '3'); assert.equal(cfgOf(r).is_active.booleanValue, false); assert.equal(cfgOf(r).current_index.integerValue, '2')
  assert.equal(await fails(act(dj, id, 'shoe', 'next')), 'failed-precondition:no_active_game')

  await act(dj, id, 'shoe', 'start', { questions: ['  Solo questa?  ', ''] })
  assert.deepEqual(cfgOf((await rounds(id, 'shoe_game')).find((d) => d.fields.status.stringValue === 'running')!).questions.arrayValue.values.map((v: any) => v.stringValue), ['Solo questa?'])
  await act(dj, id, 'shoe', 'reset')
  assert.equal((await rounds(id, 'shoe_game')).filter((d) => d.fields.status.stringValue !== 'completed').length, 0)
})

test('G4. game guards: ownership, premium gate (Free without a pass is refused), event type, payload validation; guests can read rounds but never write', async () => {
  const { dj, id } = await party('wedding', 'party'); const intruder = await owner('wedding'), guest = await mk('anonymous')
  assert.equal(await fails(act(intruder, id, 'roulette', 'start')), 'not-found:event_not_found')
  assert.equal(await fails(act(guest, id, 'roulette', 'start')), 'permission-denied:account_required')
  assert.equal(await fails(callAs(intruder, 'setGameConfig', { eventId: id, shoeGameQuestions: ['x'] })), 'not-found:event_not_found')
  const free = await party('free', 'party'); assert.equal(await fails(act(free.dj, free.id, 'shoe', 'start')), 'permission-denied:event_access_required')
  const std = await party('wedding', 'standard'); assert.equal(await fails(act(std.dj, std.id, 'roulette', 'start')), 'failed-precondition:games_unavailable')
  assert.equal(await fails(act(dj, id, 'roulette', 'next')), 'invalid-argument:invalid_payload'); assert.equal(await fails(act(dj, id, 'bingo', 'start')), 'invalid-argument:invalid_payload')
  assert.equal(await fails(callAs(dj, 'setGameConfig', { eventId: id, roulettePenitenze: [{ label: 'x', category: 'evil' }] })), 'invalid-argument:invalid_payload')
  assert.equal(await fails(callAs(dj, 'setGameConfig', { eventId: id })), 'invalid-argument:invalid_payload')
  await act(dj, id, 'shoe', 'start')
  assert.equal((await getDocs(collection(guest.db, 'events', id, 'games'))).size, 1, 'guests / TV can read the rounds')
  assert.ok(await denied(addDoc(collection(guest.db, 'events', id, 'games'), { type: 'shoe_game', status: 'running' })), 'but not write them')
  assert.ok(await denied(addDoc(collection(dj.db, 'events', id, 'games'), { type: 'shoe_game', status: 'running' })), 'not even the owner: only the callable writes')
})
