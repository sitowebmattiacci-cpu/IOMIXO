import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recipientResolver } from '../../../../firebase/functions/src/mail/miolove/recipient'

/** Pure tests (no emulator, no network): only "user not found" may mean "no address"; every other failure must surface so the outbox retries. */
const authError = (code: string) => Object.assign(new Error(code), { code })

test('RCP-1. an existing account returns its address, lower-cased; an account without an address returns null', async () => {
  assert.equal(await recipientResolver(async () => ({ email: 'Anna@Example.COM' }))('u1'), 'anna@example.com')
  assert.equal(await recipientResolver(async () => ({}))('u1'), null)
  assert.equal(await recipientResolver(async () => ({ email: null }))('u1'), null)
})

test('RCP-2. auth/user-not-found (the account is gone) is the ONLY error that means "no address"', async () => {
  assert.equal(await recipientResolver(async () => { throw authError('auth/user-not-found') })('gone'), null)
})

test('RCP-3. authorization denied is NOT swallowed: it is rethrown with its code', async () => {
  await assert.rejects(recipientResolver(async () => { throw authError('auth/insufficient-permission') })('u1'), (e: any) => e.code === 'auth/insufficient-permission')
})

test('RCP-4. temporary errors (Auth internal error, quota, network, plain Error, non-error throws) are rethrown, never turned into null', async () => {
  for (const err of [authError('auth/internal-error'), authError('auth/quota-exceeded'), Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' }), new Error('boom'), 'string failure', undefined, null]) {
    await assert.rejects(recipientResolver(async () => { throw err })('u1'), undefined, `${String(err)}`)
  }
})
