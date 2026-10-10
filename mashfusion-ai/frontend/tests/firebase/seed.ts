/**
 * Server-side seeding through the Firestore emulator REST API with the emulator's
 * "owner" bypass token (equivalent to the Admin SDK: security rules are skipped).
 * Emulator only. Avoids a dependency on @firebase/rules-unit-testing.
 */
const BASE = 'http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents'

type FsValue = Record<string, unknown>
function enc(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null }
  if (v instanceof Date) return { timestampValue: v.toISOString() }
  if (typeof v === 'string') return { stringValue: v }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, enc(x)])) } }
}
const fields = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, enc(v)]))

async function patch(path: string, data: Record<string, unknown>, maskKeys?: string[]) {
  const mask = maskKeys ? '?' + maskKeys.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&') : ''
  const res = await fetch(`${BASE}/${path}${mask}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: fields(data) }),
  })
  if (!res.ok) throw new Error(`seed ${path}: ${res.status} ${await res.text()}`)
}

export const seedSet    = (path: string, data: Record<string, unknown>) => patch(path, data)
export const seedUpdate = (path: string, data: Record<string, unknown>) => patch(path, data, Object.keys(data))

export const eventFields = (ownerUid: string, slug: string, extra: Record<string, unknown> = {}) => ({
  ownerUid, slug, legacySupabaseId: `legacy-${slug}`,
  title: 'Wedding Anna & Marco', djName: 'DJ X', description: null, type: 'wedding', status: 'live',
  coupleNames: 'Anna & Marco', weddingDate: '2026-09-12', venueName: 'Villa', screenModeEnabled: true,
  guestConfig: { requests: true }, requestLimit: 30, createdAt: new Date(), updatedAt: new Date(), ...extra,
})
