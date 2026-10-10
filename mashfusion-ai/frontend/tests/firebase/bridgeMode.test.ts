import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bridgeFromEnv, bridgeMode, mockBridge } from '../../../../firebase/functions/src/requests/legacyBridge'

test('LEGACY_BRIDGE: missing or unknown fails closed (never an implicit Supabase)', () => {
  for (const v of [undefined, '', 'Supabase', 'true', 'prod', 'off']) {
    assert.throws(() => bridgeMode({ LEGACY_BRIDGE: v } as unknown as NodeJS.ProcessEnv), /LEGACY_BRIDGE must be one of/)
    assert.throws(() => bridgeFromEnv({ LEGACY_BRIDGE: v } as unknown as NodeJS.ProcessEnv))
  }
  assert.equal(bridgeFromEnv({ LEGACY_BRIDGE: 'none' } as unknown as NodeJS.ProcessEnv), null)
  assert.throws(() => bridgeFromEnv({ LEGACY_BRIDGE: 'supabase' } as unknown as NodeJS.ProcessEnv), /not set/)
})

test('mock bridge: no network, synthetic ids, logs only the operation, test-only failure injection', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (() => { throw new Error('network is forbidden in mock mode') }) as typeof fetch
  try {
    const logs: string[] = []
    const b = mockBridge({ log: (op) => logs.push(op) })
    assert.match(await b.insert({ sessionId: 's', songTitle: 't', artist: null, message: null }), /^mock-[0-9a-f-]{36}$/)
    assert.match(await b.insertDedication({ sessionId: 's', senderName: null, message: 'm' }), /^mock-/)
    await b.upsertPollVote({ pollId: 'p', guestKey: 'fb:u', optionIndex: 0 })
    assert.equal(await b.count('s'), 0)
    assert.deepEqual(logs, ['insert', 'insertDedication', 'upsertPollVote', 'count'])
    await assert.rejects(mockBridge({ log: () => {}, failOn: ['insert'] }).insert({ sessionId: 's', songTitle: 't', artist: null, message: null }))
    // env-selected mock cannot be told to fail from the outside
    assert.equal(typeof bridgeFromEnv({ LEGACY_BRIDGE: 'mock', MOCK_FAIL: 'insert' } as unknown as NodeJS.ProcessEnv)?.insert, 'function')
    const ok = bridgeFromEnv({ LEGACY_BRIDGE: 'mock', MOCK_FAIL: 'insert' } as unknown as NodeJS.ProcessEnv)!
    await ok.insert({ sessionId: 's', songTitle: 't', artist: null, message: null })
  } finally { globalThis.fetch = realFetch }
})

test('mock bridge source contains no network code', () => {
  const src = readFileSync(new URL('../../../../firebase/functions/src/requests/legacyBridge.ts', import.meta.url), 'utf8')
  const mock = src.slice(src.indexOf('export function mockBridge'), src.indexOf('export function bridgeFromEnv'))
  assert.doesNotMatch(mock, /fetch|http|supabase\.co|SERVICE_ROLE|process\.env/i)
})
