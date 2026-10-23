import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { newClient, closeClient, type TestClient } from './helpers'
import { seedSet, eventFields } from './seed'
import { SCREEN_BACKGROUND_IDS } from '../../lib/miolove/screenBackgrounds'

/** MIOLOVE album screen background: screenConfig.backgroundTheme, whitelisted id, owner only. */
const clients: TestClient[] = []
after(async () => { await Promise.all(clients.map(closeClient)) })
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }
const callAs = <O = any>(c: TestClient, name: string, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, O>(f, name)(data as any).then((r) => r.data)
}
async function fails(p: Promise<unknown>) { try { await p } catch (e: any) { return `${String(e.code).replace('functions/', '')}:${e.details?.reason ?? ''}` } assert.fail('expected rejection') }
let n = 0
const album = async (over: Record<string, unknown> = {}) => {
  const owner = await mk(); const id = `bg${Date.now()}${n++}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, accountType: 'couple', plan: { tier: 'free', source: 'default' } })
  await seedSet(`events/${id}`, eventFields(owner.uid, `s${id}`, { type: 'wedding', brand: 'miolove', accessMode: 'activated', guestConfig: null, screenConfig: null, ...over }))
  return { owner, id }
}
const ev = async (c: TestClient, id: string) => (await getDoc(doc(c.db, 'events', id))).data()!

test('BG1. the MIOLOVE owner can set every whitelisted theme; it persists; field absent on a fresh album', async () => {
  const { owner, id } = await album()
  assert.equal((await ev(owner, id)).screenConfig, null)
  for (const theme of SCREEN_BACKGROUND_IDS) {
    assert.deepEqual((await callAs(owner, 'updateEventConfig', { eventId: id, screenConfig: { backgroundTheme: theme } })).updated, ['screenConfig'])
    assert.equal((await ev(owner, id)).screenConfig.backgroundTheme, theme)
  }
})

test('BG2. other screen keys are untouched: show_photos kept, and both keys can be sent together; extra keys are dropped', async () => {
  const { owner, id } = await album({ screenConfig: { show_photos: false, couple_font: 'cormorant' } })
  await callAs(owner, 'updateEventConfig', { eventId: id, screenConfig: { backgroundTheme: 'botanical_green_mist', show_polls: true, show_roulette: true } })
  assert.deepEqual((await ev(owner, id)).screenConfig, { show_photos: false, couple_font: 'cormorant', backgroundTheme: 'botanical_green_mist' })
  await callAs(owner, 'updateEventConfig', { eventId: id, screenConfig: { show_photos: true } })
  assert.deepEqual((await ev(owner, id)).screenConfig, { show_photos: true, couple_font: 'cormorant', backgroundTheme: 'botanical_green_mist' })
})

test('BG3. arbitrary values are refused and nothing is stored', async () => {
  const { owner, id } = await album({ screenConfig: { backgroundTheme: 'romantic_pink_bokeh' } })
  for (const v of ['nope', '', '/miolove/screen-backgrounds/x.webp', '../../etc', 'ROMANTIC_PINK_BOKEH', 5, null, {}, ['default']]) {
    assert.equal(await fails(callAs(owner, 'updateEventConfig', { eventId: id, screenConfig: { backgroundTheme: v } })), 'invalid-argument:invalid_payload', JSON.stringify(v))
  }
  assert.equal((await ev(owner, id)).screenConfig.backgroundTheme, 'romantic_pink_bokeh')
})

test('BG4. denied: anonymous, signed-in non-owner, owner of ANOTHER album, unknown event; the stored theme is unchanged', async () => {
  const a = await album(); const b = await album({ screenConfig: { backgroundTheme: 'violet_light_ribbons' } })
  const anon = await mk('anonymous'), stranger = await mk(); const data = { screenConfig: { backgroundTheme: 'romantic_pink_bokeh' } }
  assert.equal(await fails(callAs(anon, 'updateEventConfig', { eventId: a.id, ...data })), 'permission-denied:account_required')
  assert.equal(await fails(callAs(stranger, 'updateEventConfig', { eventId: a.id, ...data })), 'not-found:event_not_found')
  assert.equal(await fails(callAs(b.owner, 'updateEventConfig', { eventId: a.id, ...data })), 'not-found:event_not_found')
  assert.equal(await fails(callAs(a.owner, 'updateEventConfig', { eventId: 'nope' + a.id, ...data })), 'not-found:event_not_found')
  assert.equal((await ev(a.owner, a.id)).screenConfig, null)
})

test('BG5. per album: A pink and B green do not interfere', async () => {
  const a = await album(), b = await album()
  await callAs(a.owner, 'updateEventConfig', { eventId: a.id, screenConfig: { backgroundTheme: 'romantic_pink_bokeh' } })
  await callAs(b.owner, 'updateEventConfig', { eventId: b.id, screenConfig: { backgroundTheme: 'botanical_green_mist' } })
  assert.equal((await ev(a.owner, a.id)).screenConfig.backgroundTheme, 'romantic_pink_bokeh'); assert.equal((await ev(b.owner, b.id)).screenConfig.backgroundTheme, 'botanical_green_mist')
})

test('BG6. album still refuses the rest of the DJ screen (winner, Screen Mode, null/empty config); IOMIXO event unchanged', async () => {
  const { owner, id } = await album(); const deny = 'permission-denied:dj_account_required'
  for (const data of [{ screenConfig: null }, { screenConfig: {} }, { screenConfig: { show_polls: true } }, { winnerAnnouncement: null }, { screenModeEnabled: true },
    { screenConfig: { backgroundTheme: 'default' }, screenModeEnabled: true }, { screenConfig: { backgroundTheme: 'default' }, winnerAnnouncement: null }]) {
    assert.equal(await fails(callAs(owner, 'updateEventConfig', { eventId: id, ...data })), deny, JSON.stringify(data))
  }
  const dj = await mk(); const djId = `bgdj${Date.now()}${n++}`
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, email: dj.email, accountType: 'dj', plan: { tier: 'wedding', source: 'legacy' } })
  await seedSet(`events/${djId}`, eventFields(dj.uid, `s${djId}`, { type: 'wedding', brand: 'iomixo' }))
  const r = await callAs(dj, 'updateEventConfig', { eventId: djId, screenConfig: { show_photos: true, show_polls: true }, screenModeEnabled: true })
  assert.deepEqual(r.updated.sort(), ['screenConfig', 'screenModeEnabled'])
  assert.deepEqual((await ev(dj, djId)).screenConfig, { show_photos: true, show_polls: true })
})
