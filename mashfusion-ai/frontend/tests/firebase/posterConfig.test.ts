import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, updateDoc } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { newClient, closeClient, denied, type TestClient } from './helpers'
import { seedSet, eventFields } from './seed'

/** MIOLOVE table sign: the owner's poster overrides live in events/{id}.posterConfig, written only through updateEventConfig. */
const clients: TestClient[] = []
after(async () => { await Promise.all(clients.map(closeClient)) })
const mk = async () => { const c = await newClient('account'); clients.push(c); return c }
const callAs = <O = any>(c: TestClient, name: string, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, O>(f, name)(data as any).then((r) => r.data)
}
async function fails(p: Promise<unknown>) { try { await p } catch (e: any) { return `${String(e.code).replace('functions/', '')}:${e.details?.reason ?? ''}:${e.details?.field ?? ''}` } assert.fail('expected rejection') }
const fsGet = async (path: string) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } })).json()) as any
let n = 0

async function couple(accessMode: 'trial' | 'activated' = 'trial') {
  const owner = await mk(), id = `pc${Date.now()}${n++}`
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, accountType: 'couple', plan: { tier: accessMode === 'trial' ? 'free' : 'wedding', source: 'legacy' } })
  await seedSet(`events/${id}`, eventFields(owner.uid, `pcs${id}`, { type: 'wedding', accessMode })); await seedSet(`eventSlugs/pcs${id}`, { eventId: id })
  return { owner, id }
}
const save = (c: TestClient, eventId: string, posterConfig: unknown) => callAs(c, 'updateEventConfig', { eventId, posterConfig })

test('PC1. a trial couple saves poster overrides (no paywall); they are stored as sent and returned by the event doc', async () => {
  const { owner, id } = await couple('trial')
  const cfg = { format: 'A5', primaryColor: '#5B7C99', backgroundColor: '#FFFFFF', titleFont: 'cinzel', scriptFont: 'dancing', bodyFont: 'cormorant', titleSize: 'l', title1: 'GRAZIE', title2: '', displayName: 'Anna & Marco', displayDate: '12 giugno 2027' }
  assert.deepEqual(await save(owner, id, cfg), { updated: ['posterConfig'] })
  const f = (await fsGet(`events/${id}`)).fields.posterConfig.mapValue.fields
  assert.deepEqual([f.format.stringValue, f.primaryColor.stringValue, f.title1.stringValue, f.title2.stringValue, f.titleFont.stringValue], ['A5', '#5B7C99', 'GRAZIE', '', 'cinzel'])
  assert.equal((await fsGet(`events/${id}`)).fields.accessMode.stringValue, 'trial', 'nothing else changed')
})

test('PC2. activated couple and a later save replaces the previous overrides; null restores the defaults', async () => {
  const { owner, id } = await couple('activated')
  await save(owner, id, { title1: 'A', primaryColor: '#B5573B' }); await save(owner, id, { title3: 'B' })
  let f = (await fsGet(`events/${id}`)).fields.posterConfig.mapValue.fields
  assert.deepEqual([f.title3.stringValue, f.title1, f.primaryColor], ['B', undefined, undefined], 'a save replaces the whole override set')
  await save(owner, id, null); assert.equal((await fsGet(`events/${id}`)).fields.posterConfig.nullValue, null)
})

test('PC3. invalid posterConfig is refused field by field, never stored; unknown keys (like a QR link) are dropped', async () => {
  const { owner, id } = await couple()
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ primaryColor: 'red' }, 'posterConfig.primaryColor'], [{ backgroundColor: '#12345' }, 'posterConfig.backgroundColor'], [{ format: 'A3' }, 'posterConfig.format'],
    [{ titleFont: 'comic' }, 'posterConfig.titleFont'], [{ titleSize: 'xl' }, 'posterConfig.titleSize'], [{ title1: 'x'.repeat(25) }, 'posterConfig.title1'],
    [{ displayName: 'x'.repeat(81) }, 'posterConfig.displayName'], [{ instruction1: 5 }, 'posterConfig.instruction1'],
  ]
  for (const [cfg, field] of bad) assert.equal(await fails(save(owner, id, cfg)), `invalid-argument:invalid_payload:${field}`, field)
  assert.equal(await fails(save(owner, id, [1])), 'invalid-argument:invalid_payload:posterConfig'); assert.equal((await fsGet(`events/${id}`)).fields.posterConfig, undefined)
  await save(owner, id, { title1: 'OK', qrUrl: 'https://evil.example', link: 'x' })
  const f = (await fsGet(`events/${id}`)).fields.posterConfig.mapValue.fields
  assert.deepEqual(Object.keys(f), ['title1'], 'only known keys are kept: the QR target cannot be set')
})

test('PC4. only the owner can save, and no client can write posterConfig directly', async () => {
  const { owner, id } = await couple(); const other = await mk()
  assert.equal((await fails(save(other, id, { title1: 'X' }))).split(':')[0], 'not-found')
  assert.ok(await denied(updateDoc(doc(owner.db, 'events', id), { posterConfig: { title1: 'X' } })))
})
